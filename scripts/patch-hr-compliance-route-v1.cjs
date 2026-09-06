const fs = require('fs');

function patch(path, transform) {
  let s = fs.readFileSync(path, 'utf8');
  const next = transform(s);
  if (next === s) console.log(`no-op ${path}`);
  else { fs.writeFileSync(path, next); console.log(`patched ${path}`); }
}

patch('src/App.tsx', (s) => {
  if (!s.includes("const HRComplianceCenter = lazy(() => import('@/pages/HRComplianceCenter'));")) {
    s = s.replace(
      "const AttendanceReport = lazy(() => import('@/pages/AttendanceReport'));",
      "const AttendanceReport = lazy(() => import('@/pages/AttendanceReport'));\nconst HRComplianceCenter = lazy(() => import('@/pages/HRComplianceCenter'));"
    );
  }
  if (!s.includes('path="/hr-compliance"')) {
    const anchor = `      <Route\n        path="/attendance-report"\n        element={<ProtectedRoute>{routeSuspense(<AttendanceReport />, 'الحضور')}</ProtectedRoute>}\n      />`;
    const block = `${anchor}\n      <Route\n        path="/hr-compliance"\n        element={<ProtectedRoute>{routeSuspense(<HRComplianceCenter />, 'مركز الموارد البشرية والالتزام')}</ProtectedRoute>}\n      />`;
    if (!s.includes(anchor)) throw new Error('Attendance route anchor not found');
    s = s.replace(anchor, block);
  }
  return s;
});

patch('src/components/layout/SidebarBase.tsx', (s) => {
  if (!s.includes("path: '/hr-compliance'")) {
    const anchor = `    { path: '/attendance-report', icon: ClipboardCheck, label: 'تسجيل/تقرير الحضور', permission: ['view_attendance_leaves','record_attendance'] },`;
    const block = `${anchor}\n    { path: '/hr-compliance', icon: ShieldCheck, label: 'مركز الموارد البشرية والالتزام', allowedRoles: ['general_manager', 'executive_manager', 'branches_manager', 'branch_manager'] },`;
    if (!s.includes(anchor)) throw new Error('Sidebar attendance anchor not found');
    s = s.replace(anchor, block);
  }
  return s;
});

patch('src/components/layout/Layout.tsx', (s) => {
  if (!s.includes("'/hr-compliance': 'مركز الموارد البشرية والالتزام'")) {
    const anchor = `  '/attendance-report': 'تقرير الحضور الشهري',`;
    const block = `${anchor}\n  '/hr-compliance': 'مركز الموارد البشرية والالتزام',`;
    if (!s.includes(anchor)) throw new Error('Layout title anchor not found');
    s = s.replace(anchor, block);
  }
  return s;
});
