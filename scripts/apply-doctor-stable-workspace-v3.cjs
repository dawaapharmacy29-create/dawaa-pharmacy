const fs = require('fs');
const path = require('path');

const sidebarPath = path.join(process.cwd(), 'src/components/layout/Sidebar.tsx');
let source = fs.readFileSync(sidebarPath, 'utf8');

source = source.replace(
  `{ path: '/reviews', icon: ClipboardCheck, label: 'تقييم المحادثات', permission: 'view_reviews' },`,
  `{ path: '/doctor-dashboard?tab=reviews', icon: ClipboardCheck, label: 'تقييماتي الشخصية', permission: 'view_reviews' },`
);

source = source.replace(
  `{ path: '/doctor-dashboard?tab=reviews', icon: ClipboardCheck, label: 'تقييماتي الشخصية', permission: 'view_reviews' },\n      { path: '/points', icon: Star, label: 'النقاط والحافز', permission: 'view_points' },`,
  `{ path: '/doctor-dashboard?tab=reviews', icon: ClipboardCheck, label: 'تقييماتي الشخصية', permission: 'view_reviews' },\n      { path: '/doctor-dashboard?tab=notifications', icon: BellRing, label: 'إشعاراتي', permission: 'view_doctor_dashboard' },\n      { path: '/points', icon: Star, label: 'النقاط والحافز', permission: 'view_points' },`
);

fs.writeFileSync(sidebarPath, source);
console.log('[doctor-stable-workspace-v3] applied');
