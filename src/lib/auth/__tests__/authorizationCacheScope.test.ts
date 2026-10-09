import { describe, expect, it } from 'vitest';
import {
  authorizationCacheScopeKey,
  hasAuthorizationScopeChanged,
  performanceSalesCacheKey,
} from '@/lib/auth/authorizationCacheScope';

const dates = {
  staffId: 'doctor-1',
  windowStart: '2026-08-26',
  windowEnd: '2026-11-26',
  currentStart: '2026-10-26',
  elapsedDays: 10,
};

describe('authorization-scoped performance cache', () => {
  const gm = { id: 'account-gm', role: 'general_manager', branch: 'فرع الشامي', permissions: { view_sales: true } };
  const shamy = { id: 'account-shamy', role: 'branch_manager', branch: 'فرع الشامي', permissions: { view_sales: true } };
  const shokry = { id: 'account-shokry', role: 'branch_manager', branch: 'فرع شكري', permissions: { view_sales: true } };

  it('separates GM, Shamy, and Shokry cache entries for the same staff and cycle', () => {
    const keys = [gm, shamy, shokry].map((viewer) =>
      performanceSalesCacheKey(authorizationCacheScopeKey(viewer)!, dates),
    );
    expect(new Set(keys).size).toBe(3);
  });

  it('detects account, branch, role, and permission changes that require cache disposal', () => {
    expect(hasAuthorizationScopeChanged(gm, shamy)).toBe(true);
    expect(hasAuthorizationScopeChanged(shamy, shokry)).toBe(true);
    expect(hasAuthorizationScopeChanged(shamy, { ...shamy, permissions: { view_sales: false } })).toBe(true);
  });

  it('keeps the same cache scope when only non-authorization identity fields change', () => {
    expect(authorizationCacheScopeKey({ ...shamy, permissions: { view_sales: true, view_reviews: false } }))
      .toBe(authorizationCacheScopeKey({ ...shamy, permissions: { view_reviews: false, view_sales: true } }));
    expect(hasAuthorizationScopeChanged(shamy, { ...shamy, name: 'Changed display name' })).toBe(false);
    expect(hasAuthorizationScopeChanged(null, shamy)).toBe(false);
  });
});
