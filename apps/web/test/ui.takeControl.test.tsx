import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

localStorage.clear();
localStorage.setItem('gp.settings', JSON.stringify({ mode: 'local', onboarded: true }));
localStorage.setItem('gp.devices', JSON.stringify([{ id: 'BE:27:DA:00:7C:83', name: 'ELK-BLEDDM', driverId: 'elk' }]));
const { App } = await import('../src/App');
const { store } = await import('../src/store');
afterEach(cleanup);

describe('"Take control" banner', () => {
  it('shows while this device does not hold the light, and says who has it', async () => {
    render(<App />);
    expect(screen.getAllByText('Take control').length).toBeGreaterThan(0);
    await act(async () => { (store as unknown as { set: (p: object) => void }).set({ lostTo: 'your PC' }); });
    expect(screen.getByTestId('take-control').textContent).toContain('The lights are on your PC');
    const take = vi.spyOn(store, 'takeControl').mockResolvedValue();
    await act(async () => { fireEvent.click(screen.getByText('Take control')); });
    expect(take).toHaveBeenCalled();
  });

  it('is hidden once the light is connected here', async () => {
    await act(async () => { (store as unknown as { set: (p: object) => void }).set({ lostTo: null, status: 'connected' }); });
    render(<App />);
    expect(screen.queryByText('Take control')).toBeNull();
  });
});
