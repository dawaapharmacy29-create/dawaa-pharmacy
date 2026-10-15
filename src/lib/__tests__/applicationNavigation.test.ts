import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  GROUPS,
  PHARMACIST_GROUPS,
  activeItem,
  isNavItemVisible,
  type NavGroup,
} from '@/components/layout/SidebarBase';
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
  return (pharmacistView ? PHARMACIST_GROUPS : GROUPS)
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

const LEGACY_PAGE_FILES: Record<string, string> = {
  '/whatsapp-folder-watcher': 'WhatsAppFolderWatcher',
  '/whatsapp-followup-requests': 'WhatsAppAutoFollowupRequests',
  '/whatsapp-doctor-performance': 'WhatsAppDoctorPerformance',
  '/whatsapp-customer-history': 'WhatsAppCustomerHistory',
  '/whatsapp-lost-opportunities': 'WhatsAppLostOpportunities',
  '/whatsapp-branch-comparison': 'WhatsAppBranchComparison',
};

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

  it('legacy WhatsApp surfaces stay routable but out of the menu', () => {
    for (const route of LEGACY_WHATSAPP_ROUTES) {
      expect(appRoutes.has(route)).toBe(true);
      expect(allNavPaths.map(basePath).includes(route)).toBe(false);
      expect(read(`src/pages/${LEGACY_PAGE_FILES[route]}.tsx`)).toMatch(/<LegacySurfaceNotice/);
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
});
