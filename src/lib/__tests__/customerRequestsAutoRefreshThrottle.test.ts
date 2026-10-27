import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

// Runs public/customer-requests-sync-refresh.js with a fake page and clock.
function loadScript() {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'public/customer-requests-sync-refresh.js'),
    'utf8'
  );
  let now = 1_000_000;
  let clicks = 0;
  const windowListeners = new Map<string, Array<() => void>>();
  const documentListeners = new Map<string, Array<() => void>>();
  let intervalCallback: (() => void) | null = null;
  const refreshButton = {
    textContent: 'تحديث',
    disabled: false,
    click: () => {
      clicks += 1;
    },
  };
  const document = {
    hidden: false,
    querySelectorAll: (selector: string) => (selector === 'button' ? [refreshButton] : []),
    addEventListener: (type: string, fn: () => void) =>
      documentListeners.set(type, [...(documentListeners.get(type) || []), fn]),
    documentElement: {},
  };
  const window = {
    location: { pathname: '/customer-requests', href: 'https://example.test/customer-requests' },
    history: { state: null, replaceState: () => undefined },
    addEventListener: (type: string, fn: () => void) =>
      windowListeners.set(type, [...(windowListeners.get(type) || []), fn]),
    setInterval: (fn: () => void) => {
      intervalCallback = fn;
      return 1;
    },
    clearInterval: () => undefined,
  };
  vm.runInNewContext(source, {
    window,
    document,
    Date: { now: () => now },
    URL,
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
  });
  return {
    clicks: () => clicks,
    advance: (ms: number) => {
      now += ms;
    },
    returnToTab: () => {
      (documentListeners.get('visibilitychange') || []).forEach((fn) => fn());
      (windowListeners.get('focus') || []).forEach((fn) => fn());
    },
    tick: () => intervalCallback?.(),
    setHidden: (hidden: boolean) => {
      document.hidden = hidden;
    },
  };
}

describe('customer requests automatic refresh throttle', () => {
  it('returning to the tab (visibilitychange + focus) refreshes once, not twice', () => {
    const page = loadScript();
    page.returnToTab();
    expect(page.clicks()).toBe(1);
  });

  it('rapid tab switching within 15 s does not reload again', () => {
    const page = loadScript();
    page.returnToTab();
    for (let i = 0; i < 6; i += 1) {
      page.advance(2_000);
      page.returnToTab();
    }
    expect(page.clicks()).toBe(1);
    page.advance(4_000);
    page.returnToTab();
    expect(page.clicks()).toBe(2);
  });

  it('the 45 s timer keeps refreshing and hidden tabs never refresh', () => {
    const page = loadScript();
    page.advance(45_000);
    page.tick();
    page.advance(45_000);
    page.tick();
    expect(page.clicks()).toBe(2);
    page.setHidden(true);
    page.advance(45_000);
    page.tick();
    expect(page.clicks()).toBe(2);
  });
});
