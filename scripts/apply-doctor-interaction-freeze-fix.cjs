const fs = require('fs');
const path = require('path');

function patch(relativePath, transform) {
  const filePath = path.join(process.cwd(), relativePath);
  const current = fs.readFileSync(filePath, 'utf8');
  const next = transform(current);
  if (next !== current) fs.writeFileSync(filePath, next);
}

patch('src/components/layout/Sidebar.tsx', (source) => {
  source = source.replace(
`  useEffect(() => {
    setExpandedGroups((prev) => {
      const next = { ...prev };
      for (const group of groups) {
        const active = group.items.some((item) => isRouteActive(item.path, location.pathname));
        if (active) next[group.title] = true;
      }
      return next;
    });
  }, [location.pathname, groups]);`,
`  useEffect(() => {
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
  }, [location.pathname, groups]);`
  );

  return source;
});

patch('src/index.css', (source) => {
  source = source.replace(
`/* Doctor dashboard scroll performance */
.doctor-dashboard-page > section {
  content-visibility: visible;
}

.doctor-dashboard-page > section:nth-of-type(n + 4) {
  content-visibility: auto;
  contain-intrinsic-size: auto 520px;
}

@media (prefers-reduced-motion: reduce) {`,
`/* Doctor dashboard stability: keep every section interactive. */
.doctor-dashboard-page,
.doctor-dashboard-page > section {
  content-visibility: visible !important;
  contain: none !important;
  pointer-events: auto;
}

@media (prefers-reduced-motion: reduce) {`
  );
  source = source.replace(
`/* Doctor dashboard scroll performance */
.doctor-dashboard-page > section {
  content-visibility: auto;
  contain: layout paint style;
  contain-intrinsic-size: auto 520px;
}

.doctor-dashboard-page > section:first-of-type,
.doctor-dashboard-page > section:nth-of-type(2) {
  content-visibility: visible;
  contain: none;
}

@media (prefers-reduced-motion: reduce) {`,
`/* Doctor dashboard stability: keep every section interactive. */
.doctor-dashboard-page,
.doctor-dashboard-page > section {
  content-visibility: visible !important;
  contain: none !important;
  pointer-events: auto;
}

@media (prefers-reduced-motion: reduce) {`
  );
  return source;
});

console.log('[doctor-interaction-freeze-fix] applied');
