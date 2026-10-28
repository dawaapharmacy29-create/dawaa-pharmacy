import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  ROLES,
  canManageBranchTargets,
  canManageStaffAccounts,
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

  it('branch manager runs one branch: no account admin, system health, audit log or procurement', () => {
    const opens = (path: string) => (getRoutePermissions(path) || []).some((p) => hasPermission('branch_manager', p));
    for (const path of ['/staff-accounts', '/staff-duplicate-audit', '/data-health', '/activity-log', '/purchases',
      '/purchase-returns', '/purchase-cycle-report', '/supplier-accounts', '/supplier-performance', '/purchase-order-log']) {
      expect({ path, open: opens(path) }).toEqual({ path, open: false });
    }
    for (const path of ['/', '/team', '/schedule', '/attendance', '/customers', '/customer-requests', '/reviews',
      '/shift-performance', '/staff-monthly-evaluation', '/daily-manager-checklist', '/points', '/stagnant-medicines',
      '/shortages', '/inventory-counts', '/delivery', '/shift-handovers']) {
      expect({ path, open: opens(path) }).toEqual({ path, open: true });
    }
    // Procurement keeps its pages and shift handovers.
    expect(['/purchases', '/shift-handovers'].every((path) =>
      (getRoutePermissions(path) || []).some((p) => hasPermission('procurement_manager', p)))).toBe(true);
  });

  it('branch targets and account edits follow the database authority (top management only)', () => {
    const none = () => false;
    for (const role of ['general_manager', 'executive_manager', 'branches_manager']) {
      expect(canManageBranchTargets(role, none)).toBe(true);
      expect(canManageStaffAccounts(role, none)).toBe(true);
    }
    for (const role of ['branch_manager', 'customer_service_manager', 'pharmacist']) {
      expect(canManageBranchTargets(role, none)).toBe(false);
      expect(canManageStaffAccounts(role, none)).toBe(false);
    }
    expect(read('supabase/migrations/20261028160000_branch_targets_top_management_only_v1.sql'))
      .toContain("if v_role in ('general_manager','executive_manager','branches_manager') then return true;");
  });

  it('owner decisions 2026-10-28: points edits, WhatsApp tools, own attendance', () => {
    const opens = (role: string, path: string) => (getRoutePermissions(path) || []).some((p) => hasPermission(role, p));
    const rolesWith = (key: string) => ROLES.map((r) => r.key).filter((role) => hasPermission(role, key)).sort();
    expect(rolesWith('edit_points_transaction')).toEqual(['branches_manager', 'executive_manager', 'general_manager']);
    for (const path of ['/whatsapp-smart-folder-watcher', '/whatsapp-folder-watcher', '/sales-intelligence/qa', '/sales-intelligence/qa/case-1']) {
      expect({ path, roles: ROLES.map((r) => r.key).filter((role) => opens(role, path)).sort() }).toEqual({
        path,
        roles: ['branch_manager', 'branches_manager', 'customer_service', 'customer_service_manager', 'general_manager'],
      });
    }
    expect(opens('pharmacist', '/reviews')).toBe(true);
    expect(opens('branch_manager', '/my-attendance')).toBe(true);
  });
});
