import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// notification_events_v2 is an RLS-heavy read model: every scanned row runs the visibility
// predicate and the view's correlated checks. These guards keep the header (mounted on every
// page for every staff session) on a small window and keep background tabs from polling it
// at the foreground rate.

const root = path.resolve(__dirname, '../../..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const hook = read('src/hooks/useNotifications.ts');

describe('notification read load budget', () => {
  it('reads a 100-row header window unless a full notification center is mounted', () => {
    expect(hook).toMatch(/HEADER_NOTIFICATION_WINDOW = 100;/);
    expect(hook).toMatch(/CENTER_NOTIFICATION_WINDOW = 500;/);
    expect(hook).toMatch(/getRecentNotifications\(\{ limit \}\)/);
    expect(hook).not.toMatch(/getRecentNotifications\(\{ limit: 500 \}\)/);
  });

  it('only the full notification centers request the 500-row window', () => {
    expect(read('src/components/layout/Header.tsx')).toMatch(/useNotifications\(\);/);
    expect(read('src/pages/OperationsCenter2027.tsx')).toMatch(
      /useNotifications\(\{ scope: 'center' \}\)/
    );
    expect(read('src/pages/StaffDetailLegacy.tsx')).toMatch(
      /useNotifications\(\{ scope: 'center' \}\)/
    );
  });

  it('a cached header window never satisfies a center that needs more rows', () => {
    expect(hook).toMatch(/notificationRuntime\.loadedLimit >= limit/);
    expect(hook).toMatch(/inFlightLimit < limit/);
  });

  it('background tabs refresh at most every 10 minutes and there is no table-wide realtime reload', () => {
    expect(hook).toMatch(/NOTIFICATION_HIDDEN_POLL_INTERVAL_MS = 600_000;/);
    expect(hook).toMatch(/document\.visibilityState === 'hidden' &&/);
    expect(hook).not.toMatch(/postgres_changes/);
  });
});
