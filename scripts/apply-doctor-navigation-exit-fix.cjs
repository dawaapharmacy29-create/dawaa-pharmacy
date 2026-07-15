const fs = require('fs');
const path = require('path');

function patchFile(relativePath, replacements) {
  const filePath = path.join(process.cwd(), relativePath);
  let source = fs.readFileSync(filePath, 'utf8');
  for (const { before, after, label } of replacements) {
    if (source.includes(after)) continue;
    if (!source.includes(before)) throw new Error(`${relativePath}: ${label}`);
    source = source.replace(before, after);
  }
  fs.writeFileSync(filePath, source);
}

patchFile('src/components/layout/Sidebar.tsx', [
  {
    label: 'hard exit helper for doctor dashboard',
    before: `  const goTo = (target: string) => {
    if (navigationGuard) navigationGuard.requestNavigation(target);
    else navigate(target);
  };`,
    after: `  const shouldHardExitDoctorDashboard = (target: string) =>
    isDoctorRole(user) &&
    location.pathname === '/doctor-dashboard' &&
    navItemBasePath(target) !== '/doctor-dashboard';

  const goTo = (target: string) => {
    if (navigationGuard?.hasActiveDirtyGuard()) {
      navigationGuard.requestNavigation(target);
      return;
    }
    if (shouldHardExitDoctorDashboard(target)) {
      window.location.assign(target);
      return;
    }
    navigate(target);
  };`,
  },
  {
    label: 'native hard navigation from doctor dashboard sidebar items',
    before: `                        onClick={(event) => {
                          if (navigationGuard?.hasActiveDirtyGuard()) {
                            event.preventDefault();
                            navigationGuard.requestNavigation(item.path);
                          }
                          onMobileClose();
                        }}`,
    after: `                        onClick={(event) => {
                          if (navigationGuard?.hasActiveDirtyGuard()) {
                            event.preventDefault();
                            navigationGuard.requestNavigation(item.path);
                          } else if (shouldHardExitDoctorDashboard(item.path)) {
                            event.preventDefault();
                            window.location.assign(item.path);
                          }
                          onMobileClose();
                        }}`,
  },
]);

patchFile('src/index.css', [
  {
    label: 'safer doctor dashboard rendering containment',
    before: `.doctor-dashboard-page > section {
  content-visibility: auto;
  contain: layout paint style;
  contain-intrinsic-size: auto 520px;
}

.doctor-dashboard-page > section:first-of-type,
.doctor-dashboard-page > section:nth-of-type(2) {
  content-visibility: visible;
  contain: none;
}`,
    after: `.doctor-dashboard-page > section {
  content-visibility: visible;
}

.doctor-dashboard-page > section:nth-of-type(n + 4) {
  content-visibility: auto;
  contain-intrinsic-size: auto 520px;
}`,
  },
]);

require('./apply-doctor-interaction-freeze-fix.cjs');
console.log('[doctor-navigation-exit-fix] applied');
