import { describe, expect, it } from 'vitest';
import {
  STAFF_SESSION_STORAGE_KEY,
  buildDawaaRequestHeaders,
  readStoredStaffSessionToken,
} from '@/lib/supabase';

type StorageMap = Record<string, string>;

function withBrowserStorage(values: StorageMap, run: () => void) {
  const g = globalThis as unknown as { window?: unknown; localStorage?: unknown };
  const previousWindow = g.window;
  const previousStorage = g.localStorage;
  const storage = {
    getItem: (key: string) => (key in values ? values[key] : null),
    setItem: (key: string, value: string) => {
      values[key] = value;
    },
    removeItem: (key: string) => {
      delete values[key];
    },
  };
  g.localStorage = storage;
  g.window = { localStorage: storage };
  try {
    run();
  } finally {
    g.window = previousWindow;
    g.localStorage = previousStorage;
  }
}

const TOKEN = 'a'.repeat(64);
const USER = JSON.stringify({ id: '748fad73-5aab-4e61-bfd6-8be299af8aa9', username: 'x' });

describe('request identity headers', () => {
  it('sends the opaque staff session token so the server can verify the caller', () => {
    withBrowserStorage({ [STAFF_SESSION_STORAGE_KEY]: TOKEN, dawaa_auth_user_v2: USER }, () => {
      const headers = buildDawaaRequestHeaders();
      expect(headers.get('x-dawaa-session-token')).toBe(TOKEN);
    });
  });

  it('never invents a session token when none is stored', () => {
    withBrowserStorage({ dawaa_auth_user_v2: USER }, () => {
      expect(buildDawaaRequestHeaders().get('x-dawaa-session-token')).toBe(null);
    });
  });

  it('rejects malformed stored tokens instead of forwarding them', () => {
    withBrowserStorage({ [STAFF_SESSION_STORAGE_KEY]: 'short' }, () => {
      expect(readStoredStaffSessionToken()).toBe(null);
    });
    withBrowserStorage({ [STAFF_SESSION_STORAGE_KEY]: 'x'.repeat(600) }, () => {
      expect(readStoredStaffSessionToken()).toBe(null);
    });
  });

  it('keeps caller-provided headers (apikey/authorization) intact', () => {
    withBrowserStorage({ [STAFF_SESSION_STORAGE_KEY]: TOKEN }, () => {
      const headers = buildDawaaRequestHeaders({
        apikey: 'anon-key',
        Authorization: 'Bearer anon',
      });
      expect(headers.get('apikey')).toBe('anon-key');
      expect(headers.get('authorization')).toBe('Bearer anon');
      expect(headers.get('x-dawaa-session-token')).toBe(TOKEN);
    });
  });

  it('is a no-op outside the browser (server bundles)', () => {
    expect(buildDawaaRequestHeaders().get('x-dawaa-session-token')).toBe(null);
  });
});
