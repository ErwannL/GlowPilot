import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

localStorage.clear();
localStorage.setItem('gp.settings', JSON.stringify({ mode: 'simulator', onboarded: true }));
const { Dashboard } = await import('../src/pages/Dashboard');
const { store } = await import('../src/store');
const { DEFAULT_QUICK_ACTIONS } = await import('../src/components/QuickActions');
afterEach(cleanup);

const buttons = () => [...within(screen.getByTestId('quick-actions')).queryAllByRole('button')].map((b) => b.textContent?.trim());
const saved = () => JSON.parse(localStorage.getItem('gp.settings')!).quickActions;
const openEditor = () => {
  const card = screen.getByTestId('quick-actions').closest('section')!;
  fireEvent.click(within(card).getByText('Edit'));
};

describe('Quick actions, chosen per device', () => {
  it('shows the usual five by default', () => {
    render(<Dashboard />);
    expect(DEFAULT_QUICK_ACTIONS).toHaveLength(5);
    expect(buttons()).toEqual(['⏸ Pause (use the remote)', 'Turn off', '🎬 Cinema', '💤 Sleep in 30 min', '⚪ White']);
  });

  it('adds a scene, a sleep timer, a brightness and an effect; each button really runs its command', async () => {
    render(<Dashboard />);
    openEditor();
    for (const id of ['scene:relax', 'sleep:60', 'bright:10', 'effect:breathe']) await act(async () => { fireEvent.click(screen.getByTestId(`qa-${id}`)); });
    fireEvent.click(screen.getByText('Done'));
    expect(saved()).toEqual([...DEFAULT_QUICK_ACTIONS, 'scene:relax', 'sleep:60', 'bright:10', 'effect:breathe']);
    const exec = vi.spyOn(store, 'exec');
    for (const label of ['🌿 Relax', '💤 Sleep in 60 min', '☀ 10 %', '✺ Breathing']) fireEvent.click(screen.getByText(label));
    expect(exec.mock.calls.map((c) => c[0].type)).toEqual(['scene', 'sleepTimer', 'brightness', 'softwareEffect']);
    expect(exec.mock.calls[1][0]).toEqual({ type: 'sleepTimer', minutes: 60 });
    exec.mockRestore();
  });

  it('reorders and removes, and adds a custom colour', async () => {
    render(<Dashboard />);
    openEditor();
    const chosen = screen.getByTestId('quick-actions-chosen');
    await act(async () => { fireEvent.click(within(chosen).getAllByLabelText('Move down')[0]); });
    expect(saved().slice(0, 2)).toEqual(['power', 'pause']);
    await act(async () => { fireEvent.click(within(chosen).getByLabelText('Remove ⚪ White')); });
    expect(saved()).not.toContain('white');
    fireEvent.change(screen.getByLabelText('Colour'), { target: { value: '#ff2a00' } });
    await act(async () => { fireEvent.click(screen.getByText('Add this colour')); });
    expect(saved().at(-1)).toBe('color:#ff2a00');
    fireEvent.click(screen.getByText('Done'));
    const exec = vi.spyOn(store, 'exec');
    fireEvent.click(screen.getByText('#FF2A00'));
    expect(exec).toHaveBeenCalledWith({ type: 'color', color: { r: 255, g: 42, b: 0 } });
    exec.mockRestore();
  });

  it('empty list explains itself; Reset brings the defaults back; a deleted scene just disappears', async () => {
    await act(async () => { store.updateSettings({ quickActions: ['scene:gone'] }); });
    render(<Dashboard />);
    expect(screen.getByText(/No quick action on this device/)).toBeTruthy();
    openEditor();
    await act(async () => { fireEvent.click(screen.getAllByText('Reset').at(-1)!); });
    expect(store.state.settings.quickActions).toBeUndefined();
  });

  it('quick scenes can be reordered too', async () => {
    await act(async () => { store.updateSettings({ quickScenes: ['work', 'relax'] }); });
    render(<Dashboard />);
    const card = screen.getAllByText('Quick scenes')[0].closest('section')!;
    fireEvent.click(within(card).getByText('Edit'));
    await act(async () => { fireEvent.click(screen.getByLabelText('Move Relax up')); });
    expect(store.state.settings.quickScenes).toEqual(['relax', 'work']);
  });
});
