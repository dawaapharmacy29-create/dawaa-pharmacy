import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGIN = 'https://dawaa-pharmacy.vercel.app';

// Runs the real startup guard from index.html with a fake browser.
function loadIndexGuard(options: { refreshOk?: boolean; storage?: Map<string, string> } = {}) {
  const html = fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf8');
  const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1])
    .find((contents) => contents.includes('RECOVERY_DELAY_MS'));
  if (!script) throw new Error('startup guard not found');

  const root = { innerHTML: '' };
  const listeners = new Map<string, Array<(event: Record<string, unknown>) => void>>();
  const storage = options.storage ?? new Map<string, string>();
  const fetches: Array<{ url: string; init: Record<string, unknown> }> = [];
  let reloads = 0;
  const window: Record<string, unknown> = {
    location: {
      origin: ORIGIN,
      pathname: '/doctor-competition',
      reload: () => {
        reloads += 1;
      },
    },
    addEventListener: (type: string, listener: (event: Record<string, unknown>) => void) =>
      listeners.set(type, [...(listeners.get(type) || []), listener]),
    setTimeout: () => 1,
    clearTimeout: () => undefined,
    fetch: async (url: string, init: Record<string, unknown>) => {
      fetches.push({ url, init });
      return { ok: options.refreshOk ?? true };
    },
  };
  vm.runInNewContext(script, {
    window,
    document: { getElementById: (id: string) => (id === 'root' ? root : null) },
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
    URL,
    Date,
    Promise,
    JSON,
    console: { info: () => undefined, warn: () => undefined },
  });
  const scriptError = (src: string) =>
    (listeners.get('error') || []).forEach((listener) =>
      listener({ target: { tagName: 'SCRIPT', src }, message: '' })
    );
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { root, fetches, storage, scriptError, settle, reloads: () => reloads, window };
}

describe('index.html: cached 404 for a hashed asset', () => {
  it('re-requests the failed asset bypassing the HTTP cache, then reloads once', async () => {
    const guard = loadIndexGuard();
    guard.scriptError(`${ORIGIN}/assets/index-D5CJPrKx.js`);
    await guard.settle();
    expect(guard.fetches).toEqual([
      {
        url: `${ORIGIN}/assets/index-D5CJPrKx.js`,
        init: { cache: 'reload', credentials: 'same-origin' },
      },
    ]);
    expect(guard.reloads()).toBe(1);
    expect(guard.root.innerHTML).toBe('');
  });

  it('does not loop: a second failure within a minute shows the recovery screen', async () => {
    const storage = new Map<string, string>();
    const first = loadIndexGuard({ storage });
    first.scriptError(`${ORIGIN}/assets/index-D5CJPrKx.js`);
    await first.settle();
    const second = loadIndexGuard({ storage });
    second.scriptError(`${ORIGIN}/assets/index-D5CJPrKx.js`);
    await second.settle();
    expect(second.reloads()).toBe(0);
    expect(second.root.innerHTML).toContain('تعذر إكمال تحميل التطبيق');
  });

  it('shows the recovery screen when the asset is really missing', async () => {
    const guard = loadIndexGuard({ refreshOk: false });
    guard.scriptError(`${ORIGIN}/assets/index-gone.js`);
    await guard.settle();
    expect(guard.reloads()).toBe(0);
    expect(guard.root.innerHTML).toContain('تعذر إكمال تحميل التطبيق');
  });

  it('leaves third-party and non-/assets/ scripts to the existing recovery path', async () => {
    const guard = loadIndexGuard();
    guard.scriptError('https://cdn.example.com/assets/x.js');
    guard.scriptError(`${ORIGIN}/customer-requests-sync-refresh.js`);
    await guard.settle();
    expect(guard.fetches).toHaveLength(0);
    expect(guard.root.innerHTML).toContain('تعذر إكمال تحميل التطبيق');
  });

  it('the repair button refreshes the failed asset before reloading', async () => {
    const guard = loadIndexGuard({ refreshOk: false });
    guard.scriptError(`${ORIGIN}/assets/index-D5CJPrKx.js`);
    await guard.settle();
    expect(guard.root.innerHTML).toContain('dawaa-index-repair');
  });
});

describe('appRecovery: refreshFailedAssetCache', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('refreshes recorded, error-named and Resource-Timing-failed /assets/ URLs only', async () => {
    const fetches: Array<[string, RequestInit]> = [];
    const storage = new Map<string, string>([
      ['dawaa_failed_assets', JSON.stringify([`${ORIGIN}/assets/index-A.js`])],
    ]);
    vi.stubGlobal('window', {
      location: { origin: ORIGIN },
      sessionStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        removeItem: (key: string) => storage.delete(key),
      },
      performance: {
        getEntriesByType: () => [
          { name: `${ORIGIN}/assets/Page-B.js`, responseStatus: 404 },
          { name: `${ORIGIN}/assets/ok-C.js`, responseStatus: 200 },
          { name: 'https://api.example.com/assets/D.js', responseStatus: 404 },
        ],
      },
      fetch: async (url: string, init: RequestInit) => {
        fetches.push([url, init]);
        return { ok: true };
      },
    });
    const { refreshFailedAssetCache } = await import('../appRecovery');
    const refreshed = await refreshFailedAssetCache(
      new TypeError(`Failed to fetch dynamically imported module: ${ORIGIN}/assets/Lazy-E.js`)
    );
    expect(fetches.map(([url]) => url).sort()).toEqual(
      [
        `${ORIGIN}/assets/Lazy-E.js`,
        `${ORIGIN}/assets/Page-B.js`,
        `${ORIGIN}/assets/index-A.js`,
      ].sort()
    );
    expect(fetches.every(([, init]) => init.cache === 'reload')).toBe(true);
    expect(refreshed).toBe(3);
    expect(storage.has('dawaa_failed_assets')).toBe(false);
  });
});
