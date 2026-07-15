const fs = require('fs');
const path = require('path');

function patchFile(relativePath, replacements) {
  const filePath = path.join(process.cwd(), relativePath);
  let source = fs.readFileSync(filePath, 'utf8');
  for (const { before, after, label } of replacements) {
    if (source.includes(after)) continue;
    if (!source.includes(before)) throw new Error(`${relativePath}: patch failed (${label})`);
    source = source.replace(before, after);
  }
  fs.writeFileSync(filePath, source);
}

patchFile('src/App.tsx', [
  {
    label: 'doctor root redirect',
    before: `  if (location.pathname === '/' && isDoctorRole(user) && !checkPermission('view_executive_dashboard')) {
    return <Navigate to="/doctor-dashboard" replace />;
  }`,
    after: `  if (location.pathname === '/' && isDoctorRole(user)) {
    return <Navigate to="/doctor-dashboard" replace />;
  }`,
  },
  {
    label: 'unauthorized doctor redirect',
    before: `  if (
    effectivePermissions &&
    (Array.isArray(effectivePermissions)
      ? !effectivePermissions.some((permission) => checkPermission(permission))
      : !checkPermission(effectivePermissions))
  ) {
    return (
      <Layout>
        <div className="stat-card text-center text-slate-300 py-16" dir="rtl">
          ليس لديك صلاحية للوصول إلى هذه الصفحة.
        </div>
      </Layout>
    );
  }`,
    after: `  const permissionDenied =
    effectivePermissions &&
    (Array.isArray(effectivePermissions)
      ? !effectivePermissions.some((permission) => checkPermission(permission))
      : !checkPermission(effectivePermissions));

  if (permissionDenied) {
    if (isDoctorRole(user) && location.pathname !== '/doctor-dashboard') {
      return <Navigate to="/doctor-dashboard" replace />;
    }
    if (!(isDoctorRole(user) && location.pathname === '/doctor-dashboard')) {
      return (
        <Layout>
          <div className="stat-card text-center text-slate-300 py-16" dir="rtl">
            ليس لديك صلاحية للوصول إلى هذه الصفحة.
          </div>
        </Layout>
      );
    }
  }`,
  },
]);

patchFile('src/components/layout/Sidebar.tsx', [
  {
    label: 'doctor sidebar source',
    before: `  const pharmacistView = isDoctorRole(user) && !checkPermission('view_executive_dashboard');`,
    after: `  const pharmacistView = isDoctorRole(user);`,
  },
  {
    label: 'doctor dashboard always visible',
    before: `  const canAccessItem = (item: NavItem) => {
    if (item.adminOnly && !privileged) return false;`,
    after: `  const canAccessItem = (item: NavItem) => {
    if (pharmacistView && navItemBasePath(item.path) === '/doctor-dashboard') return true;
    if (item.adminOnly && !privileged) return false;`,
  },
]);

console.log('[doctor-home-route-fix] applied');
