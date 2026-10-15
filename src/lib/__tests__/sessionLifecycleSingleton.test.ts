import { describe, expect, it } from 'vitest';
import { acquireSessionLifecycle } from '@/hooks/useAuth';

type Listener = { event: string; handler: unknown };

function installFakeWindow() {
  const active: Listener[] = [];
  const target = {
    addEventListener: (event: string, handler: unknown) => active.push({ event, handler }),
    removeEventListener: (event: string, handler: unknown) => {
      const index = active.findIndex((item) => item.event === event && item.handler === handler);
      if (index >= 0) active.splice(index, 1);
    },
  };
  const g = globalThis as Record<string, unknown>;
  const previous = { window: g.window, document: g.document };
  g.window = { ...target, setTimeout: () => 1, clearTimeout: () => undefined, setInterval: () => 1, clearInterval: () => undefined };
  g.document = { ...target, visibilityState: 'visible' };
  return {
    active,
    restore: () => {
      g.window = previous.window;
      g.document = previous.document;
    },
  };
}

describe('useAuth session lifecycle is app-wide, not per consumer', () => {
  it('many useAuth consumers share one set of session listeners', () => {
    const fake = installFakeWindow();
    try {
      const releases = Array.from({ length: 12 }, () => acquireSessionLifecycle('staff-1'));
      const perInstall = fake.active.length;
      expect(perInstall).toBeGreaterThan(0);
      expect(perInstall).toBeLessThan(12);
      releases.slice(0, 11).forEach((release) => release());
      expect(fake.active.length).toBe(perInstall);
      releases[11]();
      expect(fake.active.length).toBe(0);
    } finally {
      fake.restore();
    }
  });

  it('a different signed-in user reinstalls the lifecycle instead of stacking a second one', () => {
    const fake = installFakeWindow();
    try {
      const first = acquireSessionLifecycle('staff-1');
      const perInstall = fake.active.length;
      const second = acquireSessionLifecycle('staff-2');
      expect(fake.active.length).toBe(perInstall);
      first();
      second();
      expect(fake.active.length).toBe(0);
    } finally {
      fake.restore();
    }
  });
});
