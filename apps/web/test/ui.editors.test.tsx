import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { byText, go, sweep } from './sweep';

localStorage.clear();
localStorage.setItem('gp.settings', JSON.stringify({ mode: 'simulator', onboarded: true }));
const { App } = await import('../src/App');
const { store } = await import('../src/store');
window.confirm = () => true;
afterEach(cleanup);

const open = async (re: RegExp) => { const b = byText(re); expect(b).toBeTruthy(); await act(async () => { fireEvent.click(b!); }); };

describe('editors', () => {
  it('schedule editor: every action kind, alarm options, save', async () => {
    render(<App />);
    await go('schedules');
    const before = store.state.schedules.length;
    await open(/new|add/i);
    const modal = document.querySelector('[role=dialog]') ?? document.body;
    const action = Array.from(modal.querySelectorAll('select')).find((s) => Array.from(s.options).some((o) => o.value === 'alarm'))!;
    for (const v of ['on', 'off', 'scene', 'sunrise', 'sunset', 'alarm']) await act(async () => { fireEvent.change(action, { target: { value: v } }); });
    await sweep(modal, /delete|test now|save|cancel|close|✕|remove|pick|choose|noyau/i);
    await open(/^save$/i);
    expect(store.state.schedules.length).toBe(before + 1);
    await open(/^edit$/i);
    await open(/test now/i);
    await open(/^delete$/i);
    expect(store.state.schedules.length).toBe(before);
  });

  it('scene editor: single look and mix with steps', async () => {
    render(<App />);
    await go('scenes');
    const before = store.state.scenes.length;
    await open(/new scene|^\+?\s*new/i);
    await sweep(document.body, /save|cancel|close|delete|reset|import|export|mix|single|✕|remove|duplicate/i);
    await open(/^scene mix$/i);
    await open(/\+ effect step/i);
    await open(/\+ scene step/i);
    await sweep(document.body, /save|cancel|close|delete|reset|import|export|single|✕|remove|mix|duplicate/i);
    for (const b of Array.from(document.querySelectorAll('button[aria-label^=Move]'))) await act(async () => { fireEvent.click(b); });
    await open(/^save$/i);
    expect(store.state.scenes.length).toBe(before + 1);
    const dupe = byText(/duplicate/i)!;
    await act(async () => { fireEvent.click(dupe); });
    for (const b of Array.from(document.querySelectorAll('button')).filter((x) => /^(delete|reset)$/i.test(x.textContent ?? ''))) await act(async () => { fireEvent.click(b); });
  });

  it('devices page: add a simulated light, rename, calibrate, remove', async () => {
    render(<App />);
    await go('devices');
    await sweep(document.body, /delete|import|export|bluetooth|direct|via/i);
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    for (const b of Array.from(document.querySelectorAll('button')).filter((x) => /forget|remove/i.test(x.textContent ?? ''))) {
      if (b.isConnected) await act(async () => { fireEvent.click(b); });
    }
    expect(store.state.error ?? null).toBeNull();
  });
});
