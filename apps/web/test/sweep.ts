import { act, fireEvent } from '@testing-library/react';

const SKIP = /reset|forget|remove|delete|revoke|export|import|bluetooth|direct|via|simulator|sign out|✕/i;

/** Press every button, flip every select/checkbox and nudge every range input under `root` once. */
export async function sweep(root: ParentNode = document, skip = SKIP) {
  for (const s of Array.from(root.querySelectorAll('select')) as HTMLSelectElement[]) {
    for (const o of Array.from(s.options)) if (s.isConnected) await act(async () => { fireEvent.change(s, { target: { value: o.value } }); });
  }
  for (const i of Array.from(root.querySelectorAll('input')) as HTMLInputElement[]) {
    if (!i.isConnected) continue;
    if (i.type === 'checkbox') await act(async () => { fireEvent.click(i); });
    else if (i.type === 'range' || i.type === 'number') await act(async () => { fireEvent.change(i, { target: { value: '42' } }); });
    else if (i.type === 'time') await act(async () => { fireEvent.change(i, { target: { value: '06:30' } }); });
    else if (i.type === 'color') await act(async () => { fireEvent.change(i, { target: { value: '#123456' } }); });
  }
  for (const b of Array.from(root.querySelectorAll('button')) as HTMLButtonElement[]) {
    if (!b.isConnected || b.disabled || skip.test(b.textContent ?? '') || skip.test(b.getAttribute('aria-label') ?? '')) continue;
    await act(async () => { fireEvent.click(b); });
  }
}

export const go = (id: string) => act(async () => { location.hash = id; window.dispatchEvent(new HashChangeEvent('hashchange')); });
export const byText = (re: RegExp) => (Array.from(document.querySelectorAll('button')) as HTMLButtonElement[]).find((b) => re.test(b.textContent ?? ''));
