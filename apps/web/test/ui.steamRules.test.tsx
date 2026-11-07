import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Real case (08/11): "Add my Steam games" showed Timberborn and Satisfactory on "Gaming" although they
// already had rules (Relax / Gaming), and did not say so.
const games = [
  { appid: '1', name: 'BOMBANANA!', exes: ['BOMBANANA.exe'] },
  { appid: '2', name: 'Satisfactory', exes: ['FactoryGameSteam-Win64-Shipping.exe', 'FactoryGame.exe'] },
  { appid: '3', name: 'Timberborn', exes: ['Timberborn.exe'] },
];
const bridge = {
  onActivity: vi.fn(), onBluetoothDevices: vi.fn(), onRemoteCommand: vi.fn(), onTogglePause: vi.fn(), onPower: vi.fn(),
  onPrepareQuit: vi.fn(), onUpdate: vi.fn(), selectBluetoothDevice: vi.fn(), autoSelect: vi.fn(), requestAutoconnect: vi.fn(),
  setTrustedDevice: vi.fn(), publishState: vi.fn(), setWakeTasks: vi.fn(), setKeepAwake: vi.fn(), setPausedInTray: vi.fn(),
  steamGames: vi.fn(async () => games),
};
(window as unknown as { glowpilotDesktop: typeof bridge }).glowpilotDesktop = bridge;
localStorage.clear();
localStorage.setItem('gp.settings', JSON.stringify({ mode: 'simulator', onboarded: true }));
localStorage.setItem('gp.rules', JSON.stringify([
  { id: 'sf', name: 'Satisfactory', enabled: true, process: 'FactoryGame*.exe', trigger: 'running', sceneId: 'gaming', priority: 80, cooldownSec: 10, restorePrevious: true },
  { id: 'tb', name: 'Timberborn', enabled: true, process: 'Timberborn.exe', trigger: 'running', sceneId: 'relax', priority: 80, cooldownSec: 10, restorePrevious: true },
]));
const { Automation } = await import('../src/pages/Automation');
const { store } = await import('../src/store');
afterEach(cleanup);

// Inside the Steam dialog only (the rule list behind it shows the same names).
const dialog = () => screen.getByText(/Found in your Steam library/).parentElement as HTMLElement;
const row = (name: string) => within(dialog()).getByText(name).closest('.rounded-xl') as HTMLElement;
const open = async () => {
  render(<Automation />);
  await act(async () => { fireEvent.click(screen.getByText('🎮 Add my Steam games')); });
};

describe('Add my Steam games with rules that already exist', () => {
  it('shows the existing rule and its scene (Timberborn on Relax), only new games are to add', async () => {
    await open();
    expect(within(row('Timberborn')).getByText('Has a rule')).toBeTruthy();
    expect((within(row('Timberborn')).getByRole('combobox') as HTMLSelectElement).value).toBe('relax');
    expect(within(row('Satisfactory')).getByText('Has a rule')).toBeTruthy(); // matched through the FactoryGame*.exe wildcard
    expect(within(row('BOMBANANA!')).queryByText('Has a rule')).toBeNull();
    expect(screen.getByText('Add 1 rule')).toBeTruthy();
  });

  it('changing an existing game updates its rule instead of adding a duplicate', async () => {
    await open();
    const before = store.state.rules.length;
    fireEvent.change(within(row('Timberborn')).getByRole('combobox'), { target: { value: 'night' } });
    await act(async () => { fireEvent.click(screen.getByText('Add 1 rule, update 1')); });
    const rules = store.state.rules;
    expect(rules.filter((r) => r.name === 'Timberborn')).toHaveLength(1);
    expect(rules.find((r) => r.id === 'tb')!.sceneId).toBe('night');
    expect(rules.filter((r) => r.name === 'Satisfactory')).toHaveLength(1);
    expect(rules.some((r) => r.name === 'BOMBANANA!' && r.process === 'BOMBANANA.exe')).toBe(true);
    expect(rules).toHaveLength(before + 1);
  });

  it('opening it again changes nothing by itself', async () => {
    await open();
    expect((screen.getByText('Nothing to change').closest('button') as HTMLButtonElement).disabled).toBe(true);
  });
});
