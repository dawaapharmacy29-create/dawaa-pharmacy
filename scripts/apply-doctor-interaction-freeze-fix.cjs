const fs = require('fs');
const path = require('path');

const sidebarPath = path.join(process.cwd(), 'src/components/layout/Sidebar.tsx');
let source = fs.readFileSync(sidebarPath, 'utf8');

const before = `  useEffect(() => {
    setExpandedGroups((prev) => {
      const next = { ...prev };
      for (const group of groups) {
        const active = group.items.some((item) => isRouteActive(item.path, location.pathname));
        if (active) next[group.title] = true;
      }
      return next;
    });
  }, [location.pathname, groups]);`;

const after = `  useEffect(() => {
    setExpandedGroups((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const group of groups) {
        const active = group.items.some((item) => isRouteActive(item.path, location.pathname));
        if (active && next[group.title] !== true) {
          next[group.title] = true;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [location.pathname, groups]);`;

if (!source.includes(after) && source.includes(before)) {
  source = source.replace(before, after);
  fs.writeFileSync(sidebarPath, source);
}

console.log('[doctor-interaction-freeze-fix] applied');
