import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  BRANCH_MANAGER_GROUPS,
  GROUPS,
  PHARMACIST_GROUPS,
  activeItem,
  isNavItemVisible,
  menuGroupsFor,
  type NavGroup,
} from '@/components/layout/SidebarBase';
import { ASSISTANT_GROUPS, assistantGroupsFor } from '@/components/layout/AssistantSidebar';
import { ROLES, hasPermission } from '@/lib/core/permissionSystem';

const root = resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');
const appSource = read('src/App.tsx');
const appRoutes = new Set([...appSource.matchAll(/path="([^"]+)"/g)].map((match) => match[1]));

const basePath = (path: string) => path.split('?')[0];

function routeExists(path: string) {
  const base = basePath(path);
  if (appRoutes.has(base)) return true;
  return [...appRoutes].some((route) => {
    if (!route.includes(':')) return false;
    const pattern = new RegExp(`^${route.replace(/:[^/]+/g, '[^/]+')}$`);
    return pattern.test(base);
  });
}

function visibleGroups(role: string): NavGroup[] {
  const user = { role, permissions: {} };
  const checkPermission = (permission: string) => hasPermission(user, permission);
  const privileged = ['general_manager', 'executive_manager', 'branches_manager'].includes(role);
  const pharmacistView =
    ['pharmacist', 'shift_supervisor_morning', 'shift_supervisor_evening'].includes(role) &&
    !checkPermission('view_executive_dashboard');
  const menu = menuGroupsFor(role, pharmacistView);
  return [...menu.main, ...menu.more]
    .filter((group) => group.title !== 'التوصيل')
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        isNavItemVisible(item, { rawRole: role, role, privileged, checkPermission })
      ),
    }))
    .filter((group) => group.items.length > 0);
}

const LEGACY_WHATSAPP_ROUTES = [
  '/whatsapp-folder-watcher',
  '/whatsapp-followup-requests',
  '/whatsapp-doctor-performance',
  '/whatsapp-customer-history',
  '/whatsapp-lost-opportunities',
  '/whatsapp-branch-comparison',
];

describe('application navigation consolidation', () => {
  const allNavPaths = [...GROUPS, ...PHARMACIST_GROUPS].flatMap((group) =>
    group.items.map((item) => item.path)
  );

  it('every nav entry points to a registered route', () => {
    const missing = allNavPaths.filter((path) => !routeExists(path));
    expect(missing).toEqual([]);
  });

  it('no role sees the same page twice in its sidebar', () => {
    for (const { key } of ROLES) {
      const paths = visibleGroups(key).flatMap((group) => group.items.map((item) => item.path));
      const duplicates = paths.filter((path, index) => paths.indexOf(path) !== index);
      expect(duplicates).toEqual([]);
    }
  });

  it('the attendance center is one nav entry; its tabs live inside the page', () => {
    const attendance = allNavPaths.filter((path) => basePath(path) === '/attendance-report');
    expect(attendance).toEqual(['/attendance-report']);
    expect(read('src/pages/AttendanceReport.tsx')).toMatch(/const TAB_ALIASES/);
  });

  it('the quick follow-up modal is an action, not a nav entry', () => {
    expect(allNavPaths.filter((path) => path.includes('quickFollowup'))).toEqual([]);
  });

  it('retired WhatsApp addresses forward to the page that replaced them, out of the menu', () => {
    for (const route of LEGACY_WHATSAPP_ROUTES) {
      expect(appSource).toMatch(new RegExp(`path="${route}" element=\\{<CompatibilityRedirect to="/`));
      expect(allNavPaths.map(basePath).includes(route)).toBe(false);
    }
  });

  it('keeps the canonical WhatsApp workflow in one ordered group', () => {
    const group = GROUPS.find((item) => item.title === 'واتساب وذكاء المبيعات');
    expect(group?.items.map((item) => item.path)).toEqual([
      '/whatsapp-smart-folder-watcher',
      '/sales-intelligence/qa',
      '/reviews',
      '/whatsapp-analytics',
    ]);
  });

  it('a tab-less item stays active on its in-page tabs unless a sibling owns the tab', () => {
    expect(activeItem('/attendance-report', '/attendance-report', '?tab=resolution', ['/attendance-report'])).toBe(true);
    const doctorNav = ['/doctor-dashboard', '/doctor-dashboard?tab=followups'];
    expect(activeItem('/doctor-dashboard', '/doctor-dashboard', '?tab=followups', doctorNav)).toBe(false);
    expect(activeItem('/doctor-dashboard?tab=followups', '/doctor-dashboard', '?tab=followups', doctorNav)).toBe(true);
    expect(activeItem('/doctor-dashboard', '/doctor-dashboard', '?tab=payroll', doctorNav)).toBe(true);
    expect(activeItem('/', '/customers', '', ['/'])).toBe(false);
  });

  it('retired alias paths forward to their canonical route', () => {
    expect(appSource).toMatch(/path="\/executive-2027" element=\{<CompatibilityRedirect to="\/" \/>\}/);
    expect(appSource).toMatch(
      /path="\/customer-service-classic" element=\{<CompatibilityRedirect to="\/customer-service" \/>\}/
    );
  });

  it('routes with no provisioned backend render a retired notice, never a failing fetch (APP-024)', () => {
    for (const route of ['/returns', '/today-brief']) {
      const start = appSource.indexOf(`path="${route}"`);
      const block = appSource.slice(start, appSource.indexOf('/>', appSource.indexOf('<RetiredSurfacePage', start)));
      expect(block).toMatch(/<RetiredSurfacePage/);
      expect(allNavPaths.map(basePath).includes(route)).toBe(false);
    }
    const appAndPages = [appSource, read('src/components/system/RetiredSurfacePage.tsx')].join('\n');
    expect(appAndPages).not.toMatch(/from\('return_orders'\)|rpc\('get_today_command_summary'/);
  });
});

describe('short menu per role', () => {
  const count = (groups: { items: unknown[] }[]) => groups.reduce((sum, group) => sum + group.items.length, 0);
  const paths = (role: string) => visibleGroups(role).flatMap((group) => group.items.map((item) => item.path));
  const assistantPaths = (permissions: string[], staffId = 'someone') =>
    assistantGroupsFor((permission) => permissions.includes(permission), staffId).flatMap((group) =>
      group.items.map((item) => item.path)
    );
  const allAssistant = ASSISTANT_GROUPS.flatMap((group) => group.items.map((item) => item.path));
  const everyPermission = [
    ...new Set(ASSISTANT_GROUPS.flatMap((group) => group.items.map((item) => item.permission as string))),
  ];
  const ALPHA = '82b9c2a1-6139-4b07-9937-ef80a6e926d8';

  it('keeps every role to a short list of pages', () => {
    expect(count(visibleGroups('pharmacist'))).toBeLessThanOrEqual(9);
    expect(count(visibleGroups('branch_manager'))).toBeLessThanOrEqual(15);
    expect(assistantPaths(everyPermission).length).toBeLessThanOrEqual(12);
  });

  it('builds the manager menu from the main one, with every page found', () => {
    const items = BRANCH_MANAGER_GROUPS.flatMap((group) => group.items);
    const main = GROUPS.flatMap((group) => group.items);
    expect(items).toHaveLength(15);
    for (const item of items) expect(main).toContain(item);
  });

  it('opens top management on a short menu and loses no page behind it', () => {
    const paths = (groups: NavGroup[]) => groups.flatMap((group) => group.items.map((item) => item.path));
    for (const role of ['general_manager', 'executive_manager', 'branches_manager']) {
      const menu = menuGroupsFor(role, false);
      expect(new Set(paths(menu.main)).size).toBeLessThanOrEqual(26);
      expect(new Set([...paths(menu.main), ...paths(menu.more)])).toEqual(new Set(paths(GROUPS)));
      expect(paths(menu.main).filter((path) => paths(menu.more).includes(path))).toEqual([]);
      const titles = [...menu.main, ...menu.more].map((group) => group.title);
      expect(new Set(titles).size).toBe(titles.length);
    }
  });

  it('keeps the pages a role has no other way to reach', () => {
    expect(paths('pharmacist')).toContain('/point-appeals');
    expect(paths('pharmacist')).toContain('/monthly-report-360');
    expect(paths('branch_manager')).toContain('/point-appeals');
    expect(paths('branch_manager')).toContain('/monthly-report-360');
  });

  it('keeps the hidden pages as routes, so a link or a saved URL still opens', () => {
    for (const path of ['/quick-replies', '/welcome-messages', '/doctor-competition', '/customer-points-ledger', '/staff-payroll']) {
      expect(routeExists(path)).toBe(true);
    }
  });

  it('gives the reviews and invoice accuracy pages to Team Dawaa Alpha only', () => {
    expect(allAssistant).toContain('/reviews');
    expect(assistantPaths(everyPermission)).not.toContain('/reviews');
    expect(assistantPaths(everyPermission)).not.toContain('/purchase-invoice-accuracy');
    expect(assistantPaths(everyPermission, ALPHA)).toContain('/reviews');
    expect(assistantPaths(everyPermission, ALPHA)).toContain('/purchase-invoice-accuracy');
    expect(assistantPaths(everyPermission, ALPHA)).not.toContain('/pharmacy-zone-tasks');
  });

  it('gives every assistant their own schedule and points', () => {
    const own = assistantGroupsFor((permission) => hasPermission('assistant', permission), 'someone').flatMap((group) =>
      group.items.map((item) => item.path)
    );
    expect(own).toContain('/schedule');
    expect(own).toContain('/points');
    expect(own).toHaveLength(6);
    expect(read('src/pages/Points.tsx')).toMatch(/isDoctorRole(user) || normalizeRole(user?.role) === 'assistant'/);
  });

  it('still narrows the short menu by the account permissions', () => {
    expect(assistantPaths(['view_dashboard'])).not.toContain('/purchases');
    expect(assistantPaths(['view_dashboard'])).not.toContain('/points');
    expect(assistantPaths(['view_dashboard'])).toContain('/purchase-invoice-entry');
  });
});
