const fs = require('fs');
const path = require('path');

function read(rel) {
  const file = path.join(process.cwd(), rel);
  if (!fs.existsSync(file)) throw new Error(`[permission-routing-fixes] missing ${rel}`);
  return { file, source: fs.readFileSync(file, 'utf8') };
}
function write(file, before, after, label) {
  if (before !== after) fs.writeFileSync(file, after);
  console.log(`[permission-routing-fixes] ${label}: changed=${before !== after}`);
}

// 1) Sidebar: assistants use doctor workspace via isDoctorRole, and leave admin page is manager-only.
{
  const { file, source: before } = read('src/components/layout/Sidebar.tsx');
  let source = before.replace(
    "{ path: '/time-off', icon: Calendar, label: 'الأذونات والإجازات', permission: ['view_attendance_leaves','create_leave_request'] }",
    "{ path: '/time-off', icon: Calendar, label: 'الأذونات والإجازات', permission: 'view_attendance_leaves' }"
  );
  if (!source.includes("permission: 'view_attendance_leaves'")) {
    throw new Error('[permission-routing-fixes] sidebar time-off restriction not applied');
  }
  write(file, before, source, 'sidebar');
}

// 2) Auth: assistants inherit the same personal doctor workspace permissions, without extra admin permissions.
{
  const { file, source: before } = read('src/hooks/useAuth.ts');
  let source = before.replace(
    "roleKey === 'shift_supervisor_evening') {\n    for (const key of DOCTOR_WORKSPACE_PERMISSIONS)",
    "roleKey === 'shift_supervisor_evening' || roleKey === 'assistant') {\n    for (const key of DOCTOR_WORKSPACE_PERMISSIONS)"
  );
  if (!source.includes("roleKey === 'assistant') {\n    for (const key of DOCTOR_WORKSPACE_PERMISSIONS)")) {
    throw new Error('[permission-routing-fixes] assistant doctor workspace permissions not applied');
  }
  write(file, before, source, 'useAuth');
}

// 3) Core permission model: actual route permissions and cleaning page access.
{
  const { file, source: before } = read('src/lib/core/permissionSystem.ts');
  let source = before
    .replace(
      "cleaning_supervisor: ['view_dashboard'],",
      "cleaning_supervisor: ['view_dashboard', 'view_operations', 'record_attendance', 'create_leave_request'],"
    )
    .replace(
      "'/time-off': ['view_attendance_leaves', 'create_leave_request'],",
      "'/time-off': ['view_attendance_leaves'],"
    );
  if (!source.includes("cleaning_supervisor: ['view_dashboard', 'view_operations', 'record_attendance', 'create_leave_request']")) {
    throw new Error('[permission-routing-fixes] cleaning supervisor permissions not applied');
  }
  if (!source.includes("'/time-off': ['view_attendance_leaves']")) {
    throw new Error('[permission-routing-fixes] time-off route restriction not applied');
  }
  write(file, before, source, 'permissionSystem');
}

// 4) Scope: assistant is an operational doctor-workspace role.
{
  const { file, source: before } = read('src/lib/security/userDataScope.ts');
  let source = before.replace(
    "['pharmacist', 'shift_supervisor_morning', 'shift_supervisor_evening'].includes(",
    "['pharmacist', 'shift_supervisor_morning', 'shift_supervisor_evening', 'assistant'].includes("
  );
  if (!source.includes("'shift_supervisor_evening', 'assistant'].includes")) {
    throw new Error('[permission-routing-fixes] assistant isDoctorRole not applied');
  }
  write(file, before, source, 'userDataScope');
}

// 5) Executive dashboard: role-safe automatic routing; avoid loops after restricting /time-off.
{
  const { file, source: before } = read('src/pages/ExecutiveDashboard2027.tsx');
  let source = before;
  if (!source.includes("import { normalizeRole } from '@/lib/core/permissionSystem';")) {
    const anchor = "import { getDashboardBranchOverride, isDoctorRole, isManagerRole } from '@/lib/security/userDataScope';";
    if (!source.includes(anchor)) throw new Error('[permission-routing-fixes] executive import anchor missing');
    source = source.replace(anchor, `${anchor}\nimport { normalizeRole } from '@/lib/core/permissionSystem';`);
  }

  if (!source.includes('function roleHomePath(')) {
    const anchor = 'export default function ExecutiveDashboard2027() {';
    if (!source.includes(anchor)) throw new Error('[permission-routing-fixes] executive component anchor missing');
    const helper = `function roleHomePath(user: { role?: unknown } | null | undefined): string {\n  if (isDoctorRole(user as any)) return '/doctor-dashboard';\n  const role = normalizeRole(user?.role);\n  if (role === 'delivery') return '/delivery';\n  if (role === 'cleaning_supervisor') return '/branch-cleaning';\n  if (role === 'inventory_assistant') return '/inventory-counts';\n  if (role === 'customer_service' || role === 'customer_service_manager') return '/customer-service';\n  if (['general_manager','executive_manager','branches_manager','branch_manager'].includes(role)) return '/';\n  return '/schedule';\n}\n\n`;
    source = source.replace(anchor, `${helper}${anchor}`);
  }

  if (!source.includes('const redirectPath = roleHomePath(user);')) {
    const anchor = "    checkPermission('view_branch_dashboard');";
    if (!source.includes(anchor)) throw new Error('[permission-routing-fixes] canViewExecutive anchor missing');
    source = source.replace(anchor, `${anchor}\n  const redirectPath = roleHomePath(user);\n  useEffect(() => {\n    if (!canViewExecutive) navigate(redirectPath, { replace: true });\n  }, [canViewExecutive, navigate, redirectPath]);`);
  }

  source = source.replace(
    "onClick={() => navigate(isDoctorRole(user) ? '/doctor-dashboard' : '/')}",
    "onClick={() => navigate(redirectPath)}"
  );

  const required = [
    "function roleHomePath(",
    "const redirectPath = roleHomePath(user);",
    "if (!canViewExecutive) navigate(redirectPath, { replace: true });",
  ];
  for (const marker of required) if (!source.includes(marker)) throw new Error(`[permission-routing-fixes] missing ${marker}`);
  if (!source.includes("onClick={() => navigate(redirectPath)}")) {
    console.log('[permission-routing-fixes] dashboard action markup changed; redirect guard is present, so button rewrite was skipped');
  }
  write(file, before, source, 'ExecutiveDashboard2027');
}

console.log('[permission-routing-fixes] all role, routing, and leave restrictions verified');
