import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Both outcomes of registering the worker, which a browser cannot be made to
 * show on demand.
 *
 * The failure path is easy to see by accident — it is what happens in a sandbox,
 * a private window, or over plain http — and the success path is the one that
 * matters and is hard to stage. So the navigator is stubbed and both are asked
 * for directly.
 *
 * The module keeps its state at module scope, so each case re-imports it with a
 * fresh registry rather than trying to reset it from outside.
 */

const original = globalThis.navigator;

function stubServiceWorker(register: () => Promise<unknown>): void {
  Object.defineProperty(globalThis, 'navigator', {
    value: { serviceWorker: { register } },
    configurable: true,
    writable: true,
  });
}

function stubNoServiceWorker(): void {
  Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true, writable: true });
}

beforeEach(() => {
  vi.resetModules();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  Object.defineProperty(globalThis, 'navigator', { value: original, configurable: true, writable: true });
  vi.restoreAllMocks();
});

describe('offline readiness', () => {
  it('starts out not knowing, rather than claiming either', async () => {
    stubServiceWorker(() => new Promise(() => {}));
    const { offlineReadiness } = await import('./offline');
    // Before registration settles. A screen must not warn about offline being
    // broken in the second before it works.
    expect(offlineReadiness()).toBe('unknown');
  });

  it('reports ready once the worker registers', async () => {
    stubServiceWorker(() => Promise.resolve({}));
    const { registerOfflineSupport, offlineReadiness, offlineReason } = await import('./offline');
    registerOfflineSupport();
    await vi.waitFor(() => expect(offlineReadiness()).toBe('ready'));
    expect(offlineReason()).toBe('');
  });

  it('reports unavailable, with the browser\'s own reason, when it does not', async () => {
    // The reason matters: "storage is disabled" and "the script 404ed" are
    // different problems for whoever is setting the till up, and neither is
    // something this code could work out for itself.
    stubServiceWorker(() => Promise.reject(new Error('An unknown error occurred when fetching the script.')));
    const { registerOfflineSupport, offlineReadiness, offlineReason } = await import('./offline');
    registerOfflineSupport();
    await vi.waitFor(() => expect(offlineReadiness()).toBe('unavailable'));
    expect(offlineReason()).toContain('fetching the script');
  });

  it('says so on a browser with no service workers at all', async () => {
    stubNoServiceWorker();
    const { registerOfflineSupport, offlineReadiness, offlineReason } = await import('./offline');
    registerOfflineSupport();
    expect(offlineReadiness()).toBe('unavailable');
    expect(offlineReason()).toContain('не поддерживает');
  });

  it('tells the screens when it changes', async () => {
    // The screen mounts before registration settles, so a value read once would
    // stay "unknown" for the life of the session.
    stubServiceWorker(() => Promise.resolve({}));
    const { registerOfflineSupport, subscribeOfflineReadiness } = await import('./offline');
    const seen: string[] = [];
    const stop = subscribeOfflineReadiness(() => seen.push('notified'));
    registerOfflineSupport();
    await vi.waitFor(() => expect(seen).toEqual(['notified']));
    stop();
  });

  it('stops telling a screen that has gone', async () => {
    stubServiceWorker(() => Promise.resolve({}));
    const { registerOfflineSupport, subscribeOfflineReadiness } = await import('./offline');
    let calls = 0;
    const stop = subscribeOfflineReadiness(() => { calls += 1; });
    stop();
    registerOfflineSupport();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toBe(0);
  });

  it('does not throw when the browser rejects with something that is not an Error', async () => {
    // Browsers have been known to reject with a string or a DOMException. A
    // till must not white-screen because the failure was the wrong shape.
    stubServiceWorker(() => Promise.reject('nope'));
    const { registerOfflineSupport, offlineReadiness, offlineReason } = await import('./offline');
    registerOfflineSupport();
    await vi.waitFor(() => expect(offlineReadiness()).toBe('unavailable'));
    expect(offlineReason()).toBe('nope');
  });
});
