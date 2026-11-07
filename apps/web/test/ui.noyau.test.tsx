import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { routeFetch } from './setup';

localStorage.clear();
localStorage.setItem('gp.settings', JSON.stringify({ mode: 'simulator', onboarded: true }));
const { NoyauCard } = await import('../src/components/NoyauCard');
const { store } = await import('../src/store');
const set = (p: object) => (store as unknown as { set: (p: object) => void }).set(p);
afterEach(cleanup);


describe('Noyau card', () => {
  it('is hidden in a browser that is neither a phone nor connected to a hub', () => {
    const { container } = render(<NoyauCard />);
    expect(container.innerHTML).toBe('');
  });

  it('signs in with name + password (POST /api/auth/token, app=GlowPilot), keeps only the token', async () => {
    set({ hub: true, hubNoyau: { url: '', musicSync: false, colors: ['#ff0000', '#00ff00'], target: 'all', hasToken: false, status: 'off', playing: false } });
    const saveHub = vi.spyOn(store, 'saveHubNoyau');
    const calls = routeFetch({ '/api/auth/token': () => ({ token: 'music-key', user: 'erwann' }) });
    render(<NoyauCard />);
    const inputs = document.querySelectorAll('input');
    fireEvent.change(inputs[0], { target: { value: 'https://noyau.test/' } });
    fireEvent.change(inputs[1], { target: { value: ' erwann ' } });
    fireEvent.change(inputs[2], { target: { value: 'secret' } });
    await act(async () => { fireEvent.click(screen.getByText('Sign in')); });
    const call = calls.find((c) => c.url === 'https://noyau.test/api/auth/token')!;
    expect(call.init!.method).toBe('POST');
    expect(JSON.parse(String(call.init!.body))).toEqual({ name: 'erwann', password: 'secret', app: 'GlowPilot' });
    expect(screen.getByText('Signed in as erwann.')).toBeTruthy();
    expect(store.state.settings).toMatchObject({ noyauUrl: 'https://noyau.test', noyauToken: 'music-key', noyauUser: 'erwann' });
    expect(JSON.stringify(store.state.settings)).not.toContain('secret');
    expect(saveHub).toHaveBeenCalledWith({ url: 'https://noyau.test', token: 'music-key' });
    expect((document.querySelectorAll('input')[2] as HTMLInputElement).value).toBe('');

    // Hub options: music sync, colours, sign out.
    await act(async () => { fireEvent.click(screen.getByText('Add')); });
    expect(saveHub).toHaveBeenLastCalledWith({ colors: ['#ff0000', '#00ff00', '#8b5cf6'] });
    await act(async () => { fireEvent.click(screen.getByText('Sign out')); });
    expect(store.state.settings.noyauToken).toBe('');
  });

  it('shows the error Noyau gives for a wrong password', async () => {
    routeFetch({ '/api/auth/token': () => new Response(JSON.stringify({ error: { message: 'Wrong name or password' } }), { status: 401 }) });
    render(<NoyauCard />);
    const inputs = document.querySelectorAll('input');
    fireEvent.change(inputs[1], { target: { value: 'erwann' } });
    fireEvent.change(inputs[2], { target: { value: 'bad' } });
    await act(async () => { fireEvent.keyDown(inputs[2], { key: 'Enter' }); });
    expect(screen.getByText('Wrong name or password')).toBeTruthy();
    routeFetch({ '/api/auth/token': () => new Response('oops', { status: 502 }) });
    fireEvent.change(inputs[2], { target: { value: 'bad' } });
    await act(async () => { fireEvent.click(screen.getByText('Sign in')); });
    expect(screen.getByText('Noyau answered 502')).toBeTruthy();
  });
});
