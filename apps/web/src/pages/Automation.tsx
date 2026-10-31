import { useState } from 'react';
import { findConflicts, newId, type AutomationRule } from '@glowpilot/core';
import { desktop, store, useStore } from '../store';
import { Badge, Button, Card, Field, inputCls, Modal, PageHeader, Toggle } from '../components/ui';

export function Automation() {
  const s = useStore((x) => x);
  const [edit, setEdit] = useState<AutomationRule | null>(null);
  const [steam, setSteam] = useState<{ appid: string; name: string; exes: string[]; pick: boolean; sceneId: string }[] | null>(null);
  const openSteam = async () => {
    const games = (await desktop?.steamGames?.()) ?? [];
    const has = (g: { name: string; exes: string[] }) => s.rules.some((r) => r.name.toLowerCase() === g.name.toLowerCase() || g.exes.some((e) => r.process.toLowerCase().split('|').map((x) => x.trim()).includes(e.toLowerCase())));
    setSteam(games.map((g) => ({ ...g, pick: !has(g), sceneId: 'gaming' })));
  };
  const conflicts = findConflicts(s.rules);
  const canDetect = !!desktop || s.mode === 'remote';
  const overridden = store.automation.overrideUntil > Date.now();
  // Apps worth matching: hide Windows services and helpers so the list stays readable.
  const running = (s.activity?.processes ?? []).filter((p) => !SYSTEM_PROCESS.test(p)).sort();
  const save = (r: AutomationRule) => store.saveRules(s.rules.some((x) => x.id === r.id) ? s.rules.map((x) => (x.id === r.id ? r : x)) : [...s.rules, r]);

  return (
    <div className="space-y-5">
      <PageHeader title="Automation" subtitle="Lights that follow what you do on your PC."
        action={<div className="flex flex-wrap gap-2">{desktop?.steamGames && <Button onClick={() => void openSteam()}>🎮 Add my Steam games</Button>}<Button variant="primary" onClick={() => setEdit({ id: newId('rule'), name: '', enabled: true, process: s.foreground ?? '', trigger: 'running', sceneId: 'gaming', priority: 50, cooldownSec: 10, restorePrevious: true })}>+ New rule</Button></div>} />

      {!canDetect && (
        <Card className="border-orange-400/20">
          <div className="font-semibold">App detection needs GlowPilot Desktop</div>
          <p className="mt-1 text-sm text-white/55">Browsers cannot see which programs run on your computer. Install GlowPilot Desktop on Windows, or connect to it from Settings. Rules you create here sync to it.</p>
        </Card>
      )}

      <Card title="Live activity" action={<div className="flex items-center gap-3 text-sm text-white/60">Automation <Toggle on={s.settings.automationEnabled} onChange={(v) => store.updateSettings({ automationEnabled: v })} /></div>}>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-white/50">Focused app:</span>
          <code className="rounded-lg bg-white/5 px-2 py-1">{s.foreground ?? '—'}</code>
          {s.foreground && <Button variant="soft" onClick={() => setEdit({ id: newId('rule'), name: s.foreground!.replace(/\.exe$/i, ''), enabled: true, process: s.foreground!, trigger: 'foreground', sceneId: 'work', priority: 50, cooldownSec: 10, restorePrevious: true })}>Create rule for this app</Button>}
          {overridden && <span className="ml-auto flex items-center gap-2"><Badge tone="orange">Paused by manual change</Badge><Button onClick={() => store.clearOverride()}>Resume</Button></span>}
        </div>
        <p className="mt-3 text-xs text-white/40">Avoid rules for apps that are open all day (browser, VS Code): they would pin the lights to one scene. Those rules are off by default.</p>
        <p className="mt-1 text-xs text-white/40">When you pick a scene by hand while a rule is active, automation pauses for {s.settings.overrideMinutes} minutes (change in Settings).</p>
      </Card>

      <div className="space-y-3">
        {s.rules.map((r) => {
          const scene = s.scenes.find((x) => x.id === r.sceneId);
          const conflict = conflicts.find((c) => c.ruleId === r.id);
          return (
            <div key={r.id} className={`glass gp-in flex flex-wrap items-center gap-4 rounded-3xl p-4 ${s.snapshot.activeRule === r.id ? 'ring-2 ring-violet-400/60' : ''}`}>
              <Toggle on={r.enabled} onChange={(enabled) => save({ ...r, enabled })} />
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{r.name || r.process}</div>
                <div className="text-sm text-white/50">
                  IF <code className="text-violet-200">{r.process.split('|').join(' or ')}</code> {r.trigger === 'foreground' ? 'is focused' : 'is running'} THEN {scene?.icon} {scene?.name ?? 'missing scene'}
                  {r.targetGroupId ? ` on ${s.groups.find((g) => g.id === r.targetGroupId)?.name ?? 'missing group'}` : ''}
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <Badge>Priority {r.priority}</Badge><Badge>Cooldown {r.cooldownSec}s</Badge>
                  {r.restorePrevious && <Badge tone="blue">Restores previous</Badge>}
                  {conflict && <Badge tone="orange">Never wins: same app as another rule</Badge>}
                  {s.snapshot.activeRule === r.id && <Badge tone="green">Active now</Badge>}
                </div>
              </div>
              <Button onClick={() => setEdit(r)}>Edit</Button>
            </div>
          );
        })}
      </div>

      <Card title="Media & streaming">
        <p className="text-sm text-white/55">A running browser does not mean a film is playing, so GlowPilot never assumes it. Use the <b>Cinema</b> scene manually or from a schedule. GlowPilot Desktop also reports when Windows media playback starts (Windows media session), which you can use with a <code>media:playing</code> rule.</p>
      </Card>

      {steam && (
        <Modal open onClose={() => setSteam(null)} title="Your Steam games">
          {steam.length === 0 ? <p className="text-sm text-white/55">No installed Steam game found.</p> : (
            <div className="space-y-2">
              <p className="text-sm text-white/55">Found in your Steam library. Each checked game gets a rule: <i>while it runs, play this scene</i>. Games that already have a rule are unchecked.</p>
              {steam.map((g, i) => (
                <div key={g.appid} className="flex flex-wrap items-center gap-3 rounded-xl bg-white/5 px-3 py-2">
                  <input type="checkbox" checked={g.pick} onChange={(e) => setSteam(steam.map((x, j) => (j === i ? { ...x, pick: e.target.checked } : x)))} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{g.name}</div>
                    <div className="truncate font-mono text-[11px] text-white/40">{g.exes.join(' | ')}</div>
                  </div>
                  <select className={inputCls.replace('w-full', 'w-40') + ' py-1.5'} value={g.sceneId} onChange={(e) => setSteam(steam.map((x, j) => (j === i ? { ...x, sceneId: e.target.value } : x)))}>
                    {s.scenes.map((sc) => <option key={sc.id} value={sc.id}>{sc.icon} {sc.name}</option>)}
                  </select>
                </div>
              ))}
              <div className="flex justify-end pt-2">
                <Button variant="primary" disabled={!steam.some((g) => g.pick)} onClick={() => {
                  const added = steam.filter((g) => g.pick).map((g): AutomationRule => ({ id: newId('rule'), name: g.name, enabled: true, process: g.exes.join('|'), trigger: 'running', sceneId: g.sceneId, priority: 80, cooldownSec: 10, restorePrevious: true }));
                  store.saveRules([...s.rules, ...added]);
                  setSteam(null);
                }}>Add {steam.filter((g) => g.pick).length} rule(s)</Button>
              </div>
            </div>
          )}
        </Modal>
      )}

      {edit && (
        <Modal open onClose={() => setEdit(null)} title="Automation rule">
          <div className="space-y-4">
            <Field label="Name"><input className={inputCls} value={edit.name} placeholder="Cyberpunk 2077" onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Program (executable)" hint="Start the game, then pick it in the list below. Wildcards allowed: steam*.exe. Use media:playing for media playback.">
              <input className={inputCls + ' font-mono'} value={edit.process} placeholder="Cyberpunk2077.exe" onChange={(e) => setEdit({ ...edit, process: e.target.value })} />
            </Field>
            {running.length > 0 && (
              <Field label="Or pick a running app">
                <select className={inputCls} value="" onChange={(e) => e.target.value && setEdit({ ...edit, process: e.target.value, name: edit.name || e.target.value.replace(/[.]exe$/i, '') })}>
                  <option value="">{running.length} apps running…</option>
                  {running.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </Field>
            )}
            <Field label="When">
              <select className={inputCls} value={edit.trigger} onChange={(e) => setEdit({ ...edit, trigger: e.target.value as AutomationRule['trigger'] })}>
                <option value="running">The program is running (games)</option>
                <option value="foreground">Its window is in front (apps)</option>
              </select>
            </Field>
            <Field label="Activate scene">
              <select className={inputCls} value={edit.sceneId} onChange={(e) => setEdit({ ...edit, sceneId: e.target.value })}>
                {s.scenes.map((sc) => <option key={sc.id} value={sc.id}>{sc.icon} {sc.name}</option>)}
              </select>
            </Field>
            {s.groups.length > 0 && (
              <Field label="Lights">
                <select className={inputCls} value={edit.targetGroupId ?? ''} onChange={(e) => setEdit({ ...edit, targetGroupId: e.target.value || null })}>
                  <option value="">All lights</option>
                  {s.groups.map((g) => <option key={g.id} value={g.id}>{g.icon} {g.name}</option>)}
                </select>
              </Field>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Priority (higher wins)"><input type="number" className={inputCls} value={edit.priority} onChange={(e) => setEdit({ ...edit, priority: +e.target.value })} /></Field>
              <Field label="Cooldown (s)"><input type="number" min={0} className={inputCls} value={edit.cooldownSec} onChange={(e) => setEdit({ ...edit, cooldownSec: Math.max(0, +e.target.value) })} /></Field>
            </div>
            <label className="flex items-center justify-between text-sm">Restore previous scene afterwards <Toggle on={edit.restorePrevious} onChange={(restorePrevious) => setEdit({ ...edit, restorePrevious })} /></label>
            <div className="flex justify-between pt-2">
              <Button variant="danger" onClick={() => { store.saveRules(s.rules.filter((x) => x.id !== edit.id)); setEdit(null); }}>Delete</Button>
              <Button variant="primary" disabled={!edit.process.trim()} onClick={() => { save({ ...edit, name: edit.name.trim() || edit.process }); setEdit(null); }}>Save rule</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

const SYSTEM_PROCESS = /^(svchost|system|registry|smss|csrss|wininit|winlogon|services|lsass|lsaiso|dwm|conhost|runtimebroker|backgroundtaskhost|searchhost|searchindexer|sihost|taskhostw|fontdrvhost|ctfmon|dllhost|wmiprvse|audiodg|spoolsv|memory compression|idle|smartscreen|securityhealthservice|textinputhost|startmenuexperiencehost|shellexperiencehost|applicationframehost|wudfhost|msmpeng|nissrv|powershell|bash|node|cmd|openconsole|windowsterminal|explorer|aggregatorhost|amdfendrsr|atiesrxx|atieclxx|widgets|widgetservice|phoneexperiencehost|crashpad_handler|msedgewebview2)\.exe$/i;
