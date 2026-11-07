import { describe, expect, it, vi } from 'vitest';

localStorage.clear();
localStorage.setItem('gp.settings', JSON.stringify({ mode: 'simulator', onboarded: true }));
const { store, targetLabel } = await import('../src/store');

const until = async (f: () => boolean) => { for (let i = 0; i < 100 && !f(); i++) await new Promise((r) => setTimeout(r, 10)); expect(f()).toBe(true); };

describe('store in simulator mode', () => {
  it('starts with one simulated light that connects', async () => {
    await until(() => store.state.lights[0]?.status === 'connected');
    expect(store.state.mode).toBe('simulator');
    expect(store.state.transportKind).toBe('simulator');
    expect(targetLabel(store.state, 'all')).toBeTruthy();
  });

  it('commands reach the light and are saved per light', async () => {
    store.exec({ type: 'power', on: true });
    store.exec({ type: 'color', color: { r: 0, g: 0, b: 255 } });
    store.exec({ type: 'brightness', level: 14 });
    await until(() => store.state.snapshot.light.brightness === 14);
    expect(store.state.snapshot.light.color).toEqual({ r: 0, g: 0, b: 255 });
    const saved = JSON.parse(localStorage.getItem('gp.light.SIM:00:00:00:00:01')!);
    expect(saved.brightness).toBe(14);
    await until(() => store.state.log.length > 0);
  });

  it('remembers the scene shown and brings it back after a reconnect (restoreLook)', async () => {
    const scene = store.state.scenes.find((s) => !s.steps?.length)!;
    store.exec({ type: 'scene', sceneId: scene.id });
    await until(() => JSON.parse(localStorage.getItem('gp.look.SIM:00:00:00:00:01') ?? '{}').sceneId === scene.id);
    const light = store.lights[0];
    light.engine.activeSceneId = null; // as after a restart: nothing running, the saved look is kept
    expect(light.restoreLook()).toBe(true);
    expect(light.engine.activeSceneId).toBe(scene.id);
  });

  it('never re-lights unseen: in the background the look waits until the app is visible', async () => {
    const light = store.lights[0];
    light.engine.activeSceneId = null;
    const vis = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    expect(light.restoreLook()).toBe(false);
    expect(light.engine.activeSceneId).toBeNull();
    light.restored = false;
    vis.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(light.restored).toBe(true);
    expect(light.engine.activeSceneId).not.toBeNull();
    vis.mockRestore();
  });

  it('does not bring back a ringing alarm, nor anything when the light is off', () => {
    const light = store.lights[0];
    localStorage.setItem('gp.look.SIM:00:00:00:00:01', JSON.stringify({ sceneId: null, effect: null, ramp: 'alarm' }));
    light.engine.halt();
    expect(light.restoreLook()).toBe(true);
    expect(light.engine.activeSceneId).toBeNull();
    localStorage.setItem('gp.look.SIM:00:00:00:00:01', JSON.stringify({ sceneId: null, effect: { type: 'rainbow', colors: [], speed: 50 }, ramp: null }));
    expect(light.restoreLook()).toBe(true);
    expect(light.engine.effects.current?.type).toBe('rainbow');
    light.engine.halt();
  });

  it('an IR remote frame pauses GlowPilot and mirrors the colour; resume brings the look back', async () => {
    const light = store.lights[0];
    light.onExternal!(new Uint8Array([0x7e, 0x07, 0x05, 0x03, 10, 20, 30, 0x10, 0xef]));
    expect(store.state.paused?.reason).toBe('remote');
    expect(light.controller.state.color).toEqual({ r: 10, g: 20, b: 30 });
    light.applyExternal(new Uint8Array([0x7e, 0x04, 0x04, 0x00, 0, 0, 0xff, 0, 0xef]));
    expect(light.controller.state.on).toBe(false);
    light.applyExternal(new Uint8Array([0x7e, 0x04, 0x01, 33, 0xff, 0xff, 0xff, 0, 0xef]));
    expect(light.controller.state.brightness).toBe(33);
    light.applyExternal(new Uint8Array([0x7e, 0x05, 0x03, 0x87, 3, 0xff, 0xff, 0, 0xef]));
    expect(light.controller.state.controllerEffect).toBe(0x87);
    light.applyExternal(new Uint8Array([1, 2]));
    store.resume();
    expect(store.state.paused).toBeNull();
    store.togglePause();
    expect(store.state.paused?.reason).toBe('manual');
    store.togglePause();
    expect(store.state.paused).toBeNull();
  });

  it('adds, renames, groups, targets and removes lights', async () => {
    store.addSimulatedLight();
    await until(() => store.state.lights.length === 2 && store.state.lights[1].status === 'connected');
    const id = store.state.lights[1].id;
    store.renameLight(id, 'Desk');
    expect(store.state.lights[1].device.alias).toBe('Desk');
    store.saveGroups([{ id: 'g1', name: 'Room', icon: '*', deviceIds: [id] }]);
    store.setTarget('g1');
    expect(store.deviceIdsFor('g1')).toEqual([id]);
    expect(targetLabel(store.state, 'g1')).toContain('Room');
    expect(targetLabel(store.state, `dev:${id}`)).toContain('Desk');
    store.setTarget(`dev:${id}`);
    store.removeLight(id);
    expect(store.state.lights).toHaveLength(1);
    expect(store.state.target).toBe('all');
  });

  it('saves scenes, rules, schedules and settings', () => {
    const scenes = store.state.scenes;
    store.saveScenes([...scenes, { ...scenes[0], id: 'mine', name: 'Mine' }]);
    expect(JSON.parse(localStorage.getItem('gp.scenes')!).some((s: { id: string }) => s.id === 'mine')).toBe(true);
    store.resetScene(scenes[0].id);
    store.saveRules([]);
    expect(store.state.rules).toEqual([]);
    store.saveSchedules([{ id: 'x', name: 'X', enabled: true, time: '07:00', days: [1], action: { type: 'on' } }]);
    expect(store.state.schedules).toHaveLength(1);
    store.testSchedule(store.state.schedules[0]);
    store.updateSettings({ overrideMinutes: 7 });
    expect(JSON.parse(localStorage.getItem('gp.settings')!).overrideMinutes).toBe(7);
    store.clearOverride();
    store.exec({ type: 'sleepTimer', minutes: 5 });
    expect(store.state.snapshot.sleepTimerEndsAt).toBeGreaterThan(Date.now());
  });

  it('disconnects and reconnects', async () => {
    await store.disconnect();
    await until(() => store.state.lights[0].status === 'disconnected');
    store.reconnect();
    await until(() => store.state.lights[0].status === 'connected');
  });
});
