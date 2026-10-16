import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  ROLES,
  getRoleLandingPath,
  getRoutePermissions,
  hasPermission,
} from '@/lib/core/permissionSystem';

const root = resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

describe('application consolidation — permission alignment', () => {
  it('permissionSystem alone grants the self-service operations center (no import-time mutation)', () => {
    for (const { key } of ROLES) {
      expect(hasPermission(key, 'view_operations')).toBe(true);
    }
    expect(getRoutePermissions('/accessories')).toEqual(['view_inventory', 'manage_operations']);
    for (const route of ['/offers', '/stories', '/training']) {
      expect(getRoutePermissions(route)).toEqual(['manage_operations']);
    }
    const sidebarEntry = read('src/components/layout/Sidebar.tsx');
    expect(sidebarEntry).not.toMatch(/ROLE_PERMISSION_PRESETS|ROUTE_PERMISSION_MAP/);
  });

  it('incentive governance is decided by the canonical manage_incentives contract only', () => {
    expect(getRoutePermissions('/incentive-governance')).toEqual(['manage_incentives']);
    const app = read('src/App.tsx');
    const block = app.slice(app.indexOf('path="/incentive-governance"'), app.indexOf('path="/penalty-incentive"'));
    expect(block).not.toMatch(/permission=/);
  });

  it('every role landing target is a page that role may open', () => {
    for (const { key } of ROLES) {
      const landing = getRoleLandingPath(key);
      if (!landing) continue;
      const required = getRoutePermissions(landing) || [];
      expect({ role: key, landing, allowed: required.some((permission) => hasPermission(key, permission)) })
        .toEqual({ role: key, landing, allowed: true });
    }
    expect(getRoleLandingPath('customer_service')).toBe('/customer-service');
  });
});
