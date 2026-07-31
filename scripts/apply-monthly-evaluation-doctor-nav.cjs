const fs = require('fs');
const path = require('path');

function patch(relative, transform) {
  const file = path.join(process.cwd(), relative);
  if (!fs.existsSync(file)) throw new Error(`[monthly-eval-nav] missing ${relative}`);
  const before = fs.readFileSync(file, 'utf8');
  const after = transform(before);
  if (after !== before) fs.writeFileSync(file, after);
  console.log(`[monthly-eval-nav] ${relative}: ${after === before ? 'already applied' : 'updated'}`);
}

patch('src/components/layout/Sidebar.tsx', (input) => {
  let source = input;
  const anchor = "    { path: '/doctor-dashboard?tab=reviews', icon: ClipboardCheck, label: 'تقييماتي الشخصية', permission: 'view_doctor_dashboard' },";
  const item = "    { path: '/staff-monthly-evaluation', icon: Star, label: 'تقييمي الشهري', permission: 'view_doctor_dashboard' },";
  if (!source.includes(item)) source = source.replace(anchor, `${anchor}\n${item}`);
  if (!source.includes(item)) throw new Error('[monthly-eval-nav] doctor item insertion failed');
  return source;
});

patch('src/components/layout/Layout.tsx', (input) => {
  let source = input;
  const anchor = "  '/attendance-report': 'تقرير الحضور الشهري',";
  const item = "  '/staff-monthly-evaluation': 'تقييم الدكاترة الشهري',";
  if (!source.includes(item)) source = source.replace(anchor, `${anchor}\n${item}`);
  return source;
});
