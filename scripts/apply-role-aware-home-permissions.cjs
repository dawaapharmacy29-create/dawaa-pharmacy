const fs = require('fs');
const path = require('path');

function patch(relativePath, replacements) {
  const filePath = path.join(process.cwd(), relativePath);
  let source = fs.readFileSync(filePath, 'utf8');
  for (const { before, after, label } of replacements) {
    if (source.includes(after)) continue;
    if (!source.includes(before)) throw new Error(`${relativePath}: ${label}`);
    source = source.replace(before, after);
  }
  fs.writeFileSync(filePath, source);
}

patch('src/lib/core/permissionSystem.ts', [
  {
    label: 'shift supervisor doctor permissions',
    before: `const SHIFT_SUPERVISOR_BASE = [
  'view_dashboard',
  'view_shift_performance',`,
    after: `const SHIFT_SUPERVISOR_BASE = [
  'view_dashboard',
  'view_doctor_dashboard',
  'view_own_performance',
  'view_analytics_sales',
  'view_incentive_medicines',
  'view_shift_performance',`,
  },
]);

patch('src/lib/security/userDataScope.ts', [
  {
    label: 'role home helper',
    before: `export function isManagerRole(user: ScopeUser): boolean {
  return ['general_manager', 'executive_manager', 'branches_manager', 'branch_manager'].includes(
    normalizeRole(user?.role)
  );
}`,
    after: `export function isManagerRole(user: ScopeUser): boolean {
  return ['general_manager', 'executive_manager', 'branches_manager', 'branch_manager'].includes(
    normalizeRole(user?.role)
  );
}

/** الصفحة الرئيسية الرسمية حسب الدور، بدون خلط بين مساحة الدكتور والإدارة. */
export function getRoleHomeRoute(user: ScopeUser): string {
  const role = normalizeRole(user?.role);
  if (['pharmacist', 'shift_supervisor_morning', 'shift_supervisor_evening'].includes(role)) {
    return '/doctor-dashboard';
  }
  if (role === 'customer_service_manager' || role === 'customer_service') {
    return '/customer-service';
  }
  if (['general_manager', 'executive_manager', 'branches_manager', 'branch_manager'].includes(role)) {
    return '/executive-2027';
  }
  return '/';
}`,
  },
]);

patch('src/App.tsx', [
  {
    label: 'import role home helper',
    before: `import { isDoctorRole } from '@/lib/security/userDataScope';`,
    after: `import { getRoleHomeRoute, isDoctorRole } from '@/lib/security/userDataScope';`,
  },
  {
    label: 'root role routing',
    before: `  if (location.pathname === '/' && isDoctorRole(user)) {
    return <Navigate to="/doctor-dashboard" replace />;
  }`,
    after: `  if (location.pathname === '/') {
    const homeRoute = getRoleHomeRoute(user);
    if (homeRoute !== '/') return <Navigate to={homeRoute} replace />;
  }`,
  },
]);

console.log('[role-aware-home-permissions] applied');
