import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

localStorage.clear();
localStorage.setItem('gp.settings', JSON.stringify({ mode: 'simulator', onboarded: true }));
const { Dashboard } = await import('../src/pages/Dashboard');
const { store } = await import('../src/store');
afterEach(cleanup);

const quickNames = () => [...document.querySelectorAll('section')].find((s) => s.textContent?.startsWith('Quick scenes'))!
  .querySelectorAll('.grid > button').length;

describe('Quick scenes are chosen per device', () => {
  it('shows the default six until this device picks its own', () => {
    render(<Dashboard />);
    expect(quickNames()).toBe(6);
  });

  it('Edit removes and adds scenes, in the order picked, saved on this device only', async () => {
    render(<Dashboard />);
    fireEvent.click(within(screen.getAllByText('Quick scenes')[0].closest('section')!).getByText('Edit'));
    await act(async () => { fireEvent.click(screen.getByTestId('quick-work')); });
    await act(async () => { fireEvent.click(screen.getByTestId('quick-work')); });
    expect(store.state.settings.quickScenes).toEqual(['relax', 'cinema', 'gaming', 'night', 'halloween', 'work']);
    expect(JSON.parse(localStorage.getItem('gp.settings')!).quickScenes).toEqual(['relax', 'cinema', 'gaming', 'night', 'halloween', 'work']);
    for (const id of ['relax', 'cinema', 'gaming', 'night', 'halloween']) await act(async () => { fireEvent.click(screen.getByTestId(`quick-${id}`)); });
    fireEvent.click(screen.getByText('Done'));
    expect(quickNames()).toBe(1);
  });

  it('with nothing picked it says how to add some; Reset brings the defaults back', async () => {
    await act(async () => { store.updateSettings({ quickScenes: [] }); });
    render(<Dashboard />);
    expect(screen.getByText(/No quick scene on this device/)).toBeTruthy();
    fireEvent.click(within(screen.getAllByText('Quick scenes')[0].closest('section')!).getByText('Edit'));
    await act(async () => { fireEvent.click(screen.getAllByText('Reset').at(-1)!); });
    expect(store.state.settings.quickScenes).toBeUndefined();
  });
});
