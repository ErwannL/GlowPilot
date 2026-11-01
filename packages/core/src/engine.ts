import { hexToRgb, mixRgb, type RGB } from './color';
import { DeviceController, type LightState } from './controller';
import { alarmAt, EffectRunner, realClock, type AlarmCurve, type Clock, type SoftwareEffect } from './effects';
import { Emitter } from './emitter';
import { playableSteps, sceneRgb, stepScene, type Scene, type SceneStep } from './scenes';
import { dueSchedules, rampLevel, type Schedule } from './schedule';

/** Every way to change the lights. Local UI, the local API and automation all go through this. */
export type Command =
  | { type: 'power'; on: boolean }
  | { type: 'color'; color: RGB }
  | { type: 'brightness'; level: number }
  | { type: 'speed'; level: number }
  | { type: 'controllerEffect'; id: number }
  | { type: 'softwareEffect'; effect: SoftwareEffect }
  | { type: 'colorTemperature'; warm: number }
  | { type: 'scene'; sceneId: string; source?: 'manual' | 'automation' | 'schedule' }
  | { type: 'sleepTimer'; minutes: number | null };

export interface EngineSnapshot {
  light: LightState;
  activeSceneId: string | null;
  softwareEffect: SoftwareEffect | null;
  sleepTimerEndsAt: number | null;
  ramp: { kind: 'sunrise' | 'sunset' | 'alarm'; endsAt: number } | null;
  /** For a scene mix: the step scene currently playing. */
  mixStepSceneId: string | null;
  activeRule: string | null;
}

export interface EngineEvents {
  snapshot: EngineSnapshot;
  /** Fired when the user changed something by hand (automation should back off). */
  manual: Command;
}

export class GlowEngine extends Emitter<EngineEvents> {
  scenes: Scene[] = [];
  activeSceneId: string | null = null;
  activeRule: string | null = null;
  sleepTimerEndsAt: number | null = null;
  ramp: EngineSnapshot['ramp'] = null;
  readonly effects: EffectRunner;
  private timers: unknown[] = [];
  private rampHandle: unknown = null;
  private revertHandle: ReturnType<typeof setTimeout> | null = null;
  private mixHandle: ReturnType<typeof setTimeout> | null = null;
  private mixStep: string | null = null;

  constructor(public controller: DeviceController, private clock: Clock = realClock) {
    super();
    this.effects = new EffectRunner((c) => controller.renderFrame(c), clock);
    controller.on('state', () => this.publish());
  }

  snapshot(): EngineSnapshot {
    return {
      light: this.controller.state,
      activeSceneId: this.activeSceneId,
      softwareEffect: this.effects.current,
      sleepTimerEndsAt: this.sleepTimerEndsAt,
      ramp: this.ramp,
      activeRule: this.activeRule,
      mixStepSceneId: this.mixStep,
    };
  }

  exec(cmd: Command): void {
    const c = this.controller;
    const isManual = cmd.type !== 'scene' || (cmd.source ?? 'manual') === 'manual';
    // Any manual action (or turning off) stops a ringing alarm.
    if (this.ramp?.kind === 'alarm' && isManual) this.cancelRamp();
    if (cmd.type === 'power' && !cmd.on) this.cancelRamp();
    if (cmd.type !== 'brightness' && cmd.type !== 'power' && cmd.type !== 'speed' && cmd.type !== 'sleepTimer') {
      this.cancelRamp();
      this.stopMix();
      if (cmd.type !== 'scene') this.activeSceneId = null;
    }
    switch (cmd.type) {
      case 'power':
        if (!cmd.on) {
          this.effects.stop();
          this.stopMix();
        }
        c.setPower(cmd.on);
        break;
      case 'color':
        this.effects.stop();
        c.setColor(cmd.color);
        break;
      case 'brightness':
        c.setBrightness(cmd.level);
        break;
      case 'speed':
        c.setSpeed(cmd.level);
        if (this.effects.current) this.effects.run({ ...this.effects.current, speed: cmd.level });
        break;
      case 'controllerEffect':
        this.effects.stop();
        c.setControllerEffect(cmd.id);
        break;
      case 'softwareEffect':
        if (!c.state.on) c.setPower(true);
        if (cmd.effect.type === 'static') {
          this.effects.stop();
          c.setColor(cmd.effect.colors[0]);
        } else this.effects.run(cmd.effect);
        break;
      case 'colorTemperature':
        this.effects.stop();
        c.setColorTemperature(cmd.warm);
        break;
      case 'scene':
        this.applyScene(cmd.sceneId);
        break;
      case 'sleepTimer':
        this.setSleepTimer(cmd.minutes);
        break;
    }
    if (isManual) this.emit('manual', cmd);
    this.publish();
  }

  applyScene(sceneId: string): void {
    const scene = this.scenes.find((s) => s.id === sceneId);
    if (!scene) return;
    const prev = this.activeSceneId !== scene.id ? this.activeSceneId : null;
    this.activeSceneId = scene.id;
    this.stopMix();
    const steps = playableSteps(scene, this.scenes);
    if (steps.length) this.runMix(steps, 0);
    else if (scene.steps?.length) return; // a mix whose steps all vanished: do nothing
    else this.renderScene(scene);
    if (this.revertHandle) clearTimeout(this.revertHandle);
    this.revertHandle = null;
    if (scene.durationMin) {
      this.revertHandle = setTimeout(() => (prev ? this.applyScene(prev) : this.exec({ type: 'power', on: false })), scene.durationMin * 60_000);
    }
  }

  /** Scene mix: play each step scene for its duration, then loop. */
  private runMix(steps: SceneStep[], i: number): void {
    const step = steps[i % steps.length];
    const scene = stepScene(step, this.scenes);
    if (scene) this.renderScene(scene);
    this.mixStep = step.sceneId ?? `step:${i % steps.length}`;
    this.publish();
    this.mixHandle = setTimeout(() => this.runMix(steps, i + 1), step.seconds * 1000);
  }

  private stopMix(): void {
    if (this.mixHandle) clearTimeout(this.mixHandle);
    this.mixHandle = null;
    this.mixStep = null;
  }

  /** Show one (non-mix) scene's look without touching activeSceneId or timers. */
  private renderScene(scene: Scene): void {
    const c = this.controller;
    const colors = sceneRgb(scene);
    if (!c.state.on) c.setPower(true);
    c.setBrightness(scene.brightness);
    if (scene.animation.kind === 'controller') {
      this.effects.stop();
      c.setSpeed(scene.speed);
      c.setControllerEffect(scene.animation.effectId);
    } else if (scene.animation.effect === 'static' || colors.length === 0) {
      this.transitionTo(colors[0] ?? { r: 255, g: 255, b: 255 }, scene.transitionMs);
    } else {
      this.effects.run({ type: scene.animation.effect, colors, speed: scene.speed });
    }
  }

  /** Crossfade the static colour using software frames, then commit it as the stored colour. */
  private transitionTo(target: RGB, ms: number): void {
    this.effects.stop();
    const c = this.controller;
    const from = c.state.controllerEffect == null ? c.state.color : target;
    if (ms <= 0 || c.status !== 'connected') return c.setColor(target);
    const start = this.clock.now();
    const h = this.clock.setInterval(() => {
      const f = Math.min(1, (this.clock.now() - start) / ms);
      if (f >= 1) {
        this.clock.clearInterval(h);
        c.setColor(target);
      } else c.renderFrame(mixRgb(from, target, f));
    }, 60);
  }

  setSleepTimer(minutes: number | null): void {
    this.sleepTimerEndsAt = minutes ? this.clock.now() + minutes * 60_000 : null;
    this.publish();
  }

  /** Start a brightness ramp (sunrise/sunset). */
  startRamp(kind: 'sunrise' | 'sunset', minutes: number, target = 100, color?: string): void {
    this.cancelRamp();
    const c = this.controller;
    const total = minutes * 60_000;
    const from = kind === 'sunrise' ? 1 : c.state.brightness;
    const to = kind === 'sunrise' ? target : 0;
    if (kind === 'sunrise') {
      this.effects.stop();
      c.setPower(true);
      c.setColor(hexToRgb(color ?? '#ff9a40') ?? { r: 255, g: 154, b: 64 });
      c.setBrightness(from);
    }
    const start = this.clock.now();
    this.ramp = { kind, endsAt: start + total };
    this.rampHandle = this.clock.setInterval(() => {
      const el = this.clock.now() - start;
      const lvl = rampLevel(el, total, from, to);
      if (lvl !== c.state.brightness) c.setBrightness(Math.max(kind === 'sunset' ? 0 : 1, lvl));
      if (el >= total) {
        this.cancelRamp();
        if (kind === 'sunset') this.exec({ type: 'power', on: false });
      }
    }, 2000);
    this.publish();
  }

  /**
   * Stop everything GlowPilot is animating (effects, mixes, ramps, alarm) without sending anything,
   * so whatever the light shows now (e.g. a colour set with the IR remote) stays.
   */
  halt(): void {
    this.cancelRamp();
    this.stopMix();
    this.effects.stop();
    this.activeSceneId = null;
    this.activeRule = null;
    this.controller.cancelPending();
    if (this.revertHandle) clearTimeout(this.revertHandle);
    this.revertHandle = null;
    this.publish();
  }

  /** Stop a ringing alarm (from the phone's Stop button): lights stay on, steady, in the alarm colour. */
  stopAlarm(): void {
    if (this.ramp?.kind !== 'alarm') return;
    const color = this.alarmColor;
    this.cancelRamp();
    if (color) this.controller.setColor(color);
    this.publish();
  }

  private alarmColor: RGB | null = null;

  /** Wake-up alarm: see alarmAt(). Runs until a manual action or power off. */
  startAlarm(minutes: number, color = '#ff8a30', curve: AlarmCurve = {}): void {
    this.cancelRamp();
    this.stopMix();
    this.effects.stop();
    this.activeSceneId = null;
    const c = this.controller;
    const rgb = hexToRgb(color) ?? { r: 255, g: 138, b: 48 };
    this.alarmColor = rgb;
    c.setPower(true);
    c.setBrightness(100);
    const total = minutes * 60_000;
    const start = this.clock.now();
    this.ramp = { kind: 'alarm', endsAt: start + total };
    this.rampHandle = this.clock.setInterval(() => {
      const { level, on } = alarmAt(this.clock.now() - start, total, curve);
      c.renderFrame(on ? { r: Math.round(rgb.r * level), g: Math.round(rgb.g * level), b: Math.round(rgb.b * level) } : { r: 0, g: 0, b: 0 });
    }, 100);
    this.publish();
  }

  private cancelRamp(): void {
    if (this.rampHandle != null) this.clock.clearInterval(this.rampHandle);
    this.rampHandle = null;
    this.ramp = null;
  }

  /** Runs schedules and the sleep timer. Returns a stop function. */
  startScheduler(getSchedules: () => Schedule[], onFired: (s: Schedule) => void, everyMs = 15_000): () => void {
    let prev = new Date(this.clock.now());
    const h = this.clock.setInterval(() => {
      const now = new Date(this.clock.now());
      for (const s of dueSchedules(getSchedules(), prev, now)) {
        this.runScheduleAction(s);
        onFired(s);
      }
      if (this.sleepTimerEndsAt && now.getTime() >= this.sleepTimerEndsAt) {
        this.sleepTimerEndsAt = null;
        this.startRamp('sunset', 1);
      }
      prev = now;
    }, everyMs);
    this.timers.push(h);
    return () => this.clock.clearInterval(h);
  }

  runScheduleAction(s: Schedule): void {
    const a = s.action;
    if (a.type === 'on') this.exec({ type: 'power', on: true });
    else if (a.type === 'off') this.exec({ type: 'power', on: false });
    else if (a.type === 'scene') this.exec({ type: 'scene', sceneId: a.sceneId, source: 'schedule' });
    else if (a.type === 'sunrise') this.startRamp('sunrise', a.minutes, a.brightness, a.color);
    else if (a.type === 'sunset') this.startRamp('sunset', a.minutes);
    else if (a.type === 'alarm') this.startAlarm(a.minutes, a.color, a);
  }

  publish(): void {
    this.emit('snapshot', this.snapshot());
  }
}
