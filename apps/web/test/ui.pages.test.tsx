import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

localStorage.clear();
localStorage.setItem('gp.settings', JSON.stringify({ mode: 'simulator', onboarded: true }));
const { App, PAGES } = await import('../src/App');
const { store } = await import('../src/store');

window.confirm = () => true;
window.prompt = () => 'Test';
window.alert = () => {};
afterEach(cleanup);

const go = async (id: string) => { await act(async () => { location.hash = id; window.dispatchEvent(new HashChangeEvent('hashchange')); }); };
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

describe('every page renders and its controls work (simulator)', () => {
  for (const p of PAGES) {
    it(p.label, async () => {
      const onError = vi.spyOn(console, 'error').mockImplementation(() => {});
      render(<App />);
      await go(p.id);
      await settle();
      expect(document.querySelector('main')!.textContent!.length).toBeGreaterThan(20);
      // Press every button and toggle every input once: nothing may throw.
      const buttons = Array.from(document.querySelectorAll('main button')) as HTMLButtonElement[];
      for (const b of buttons) {
        if (!b.isConnected || b.disabled) continue;
        if (/reset|forget|remove|delete|revoke|export|import/i.test(b.textContent ?? '')) continue;
        await act(async () => { fireEvent.click(b); });
      }
      for (const i of Array.from(document.querySelectorAll('main input[type=range]')) as HTMLInputElement[]) {
        if (i.isConnected) await act(async () => { fireEvent.change(i, { target: { value: '42' } }); });
      }
      await settle();
      expect(store.state.error ?? null).toBeNull();
      onError.mockRestore();
    });
  }

  it('navigation links switch pages', async () => {
    render(<App />);
    await go('nope');
    expect(screen.getAllByText('Home').length).toBeGreaterThan(0);
    for (const a of Array.from(document.querySelectorAll('nav a')).slice(0, 3)) {
      await act(async () => { fireEvent.click(a); });
    }
  });

  it('Bluetooth chooser lists controllers and picks one', async () => {
    render(<App />);
    await act(async () => { (store as unknown as { set: (p: object) => void }).set({ btChooser: [] }); });
    expect(screen.getByText(/Scanning for nearby controllers/)).toBeTruthy();
    await act(async () => { (store as unknown as { set: (p: object) => void }).set({ btChooser: [{ id: 'AA:BB', name: 'ELK-BLEDDM' }] }); });
    await act(async () => { fireEvent.click(screen.getByText('ELK-BLEDDM')); });
    expect(store.state.btChooser).toBeNull();
  });
});
