import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

function loadRecoveryGuard() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const main = fs.readFileSync(path.join(ROOT, 'src/main.tsx'), 'utf8');
  const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1])
    .find((contents) => contents.includes('RECOVERY_DELAY_MS'));

  if (!script) throw new Error('Startup recovery guard script not found');

  const root = { textContent: 'جاري التحميل...', innerHTML: '' };
  const timers = new Map<number, { callback: () => void; delay: number }>();
  const listeners = new Map<string, Array<(event: Record<string, unknown>) => void>>();
  const storage = new Map<string, string>();
  let nextTimerId = 1;
  const window = {
    location: { origin: 'http://localhost:5173', pathname: '/sales-intelligence/qa' },
    __DAWAA_REACT_BOOTSTRAPPED: false,
    addEventListener: (type: string, listener: (event: Record<string, unknown>) => void) => {
      listeners.set(type, [...(listeners.get(type) || []), listener]);
    },
    setTimeout: (callback: () => void, delay: number) => {
      const id = nextTimerId++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout: (id: number) => timers.delete(id),
  };
  const context = {
    window,
    document: { getElementById: (id: string) => (id === 'root' ? root : null) },
    sessionStorage: {
      setItem: (key: string, value: string) => storage.set(key, value),
    },
    URL,
    Date,
    console: { info: () => undefined, warn: () => undefined },
  };

  vm.runInNewContext(script, context);

  return {
    root,
    timers,
    listeners,
    main,
    markBootstrapped: () => window.__DAWAA_MARK_REACT_BOOTSTRAPPED?.(),
    fire: (type: string, event: Record<string, unknown>) =>
      (listeners.get(type) || []).forEach((listener) => listener(event)),
    fireStartupTimeout: () => {
      const timer = [...timers.values()].find(({ delay }) => delay === 20000);
      if (!timer) throw new Error('Startup recovery timeout was not scheduled');
      timer.callback();
    },
  };
}

describe('startup recovery guard', () => {
  it('cancels startup recovery after the first React commit, even while a route is loading', () => {
    const guard = loadRecoveryGuard();
    guard.markBootstrapped();

    expect(guard.root.innerHTML).toBe('');
    expect(guard.timers.size).toBe(0);
  });

  it('shows recovery when React has not bootstrapped by the timeout', () => {
    const guard = loadRecoveryGuard();
    guard.fireStartupTimeout();

    expect(guard.root.innerHTML).toContain('تعذر إكمال تحميل التطبيق');
  });

  it('shows recovery for a genuine module failure before React bootstrap', () => {
    const guard = loadRecoveryGuard();
    guard.fire('error', { message: 'Failed to fetch dynamically imported module' });

    expect(guard.root.innerHTML).toContain('تعذر إكمال تحميل التطبيق');
  });

  it('ignores transient module errors after bootstrap, including during HMR', () => {
    const guard = loadRecoveryGuard();
    guard.markBootstrapped();
    guard.fire('error', { message: 'Failed to fetch dynamically imported module' });
    guard.fire('unhandledrejection', { reason: new Error('Loading chunk 42 failed') });

    expect(guard.root.innerHTML).toBe('');
    expect(guard.timers.size).toBe(0);
  });

  it('marks bootstrap only from a committed React effect outside the route Suspense boundary', () => {
    expect(guardMainCallsAfterCommit()).toBe(true);
  });
});

function guardMainCallsAfterCommit() {
  const marker = /function ReactBootstrapMarker\(\)\s*\{\s*useLayoutEffect\(\(\)\s*=>\s*\{\s*window\.__DAWAA_MARK_REACT_BOOTSTRAPPED\?\.\(\);/s;
  const placement = /<ThemeProvider>\s*<ReactBootstrapMarker\s*\/>\s*<Suspense/s;
  const main = fs.readFileSync(path.join(ROOT, 'src/main.tsx'), 'utf8');
  return marker.test(main) && placement.test(main);
}
