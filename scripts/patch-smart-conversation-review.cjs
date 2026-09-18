const fs = require('fs');
const path = require('path');

const appFile = path.join(process.cwd(), 'src/App.tsx');
let app = fs.readFileSync(appFile, 'utf8');
const importLine = `const SmartConversationReview = lazy(() => import('@/pages/SmartConversationReview'));`;
if (!app.includes(importLine)) {
  const anchor = `const Diagnostics = lazy(() => import('@/pages/Diagnostics'));`;
  if (!app.includes(anchor)) throw new Error('[smart-conversation-review] App lazy import anchor not found');
  app = app.replace(anchor, `${anchor}\n${importLine}`);
  console.log('[smart-conversation-review] route import: applied');
}

if (!app.includes('path="/smart-conversation-review"')) {
  const anchor = `      <Route\n        path="/reviews"`;
  if (!app.includes(anchor)) throw new Error('[smart-conversation-review] reviews route anchor not found');
  const route = `      <Route\n        path="/smart-conversation-review"\n        element={<ProtectedRoute>{routeSuspense(<SmartConversationReview />, 'مراجعة المحادثات الذكية')}</ProtectedRoute>}\n      />\n`;
  app = app.replace(anchor, `${route}${anchor}`);
  console.log('[smart-conversation-review] route: applied');
}
fs.writeFileSync(appFile, app);

const sidebarFile = path.join(process.cwd(), 'src/components/layout/SidebarBase.tsx');
let sidebar = fs.readFileSync(sidebarFile, 'utf8');
const sidebarItem = `{ path: '/smart-conversation-review', icon: Sparkles, label: 'مراجعة المحادثات الذكية', permission: 'view_reviews' },`;
if (!sidebar.includes(sidebarItem)) {
  const anchor = `{ path: '/reviews', icon: ClipboardCheck, label: 'تقييم المحادثات', permission: 'view_reviews' },`;
  if (!sidebar.includes(anchor)) throw new Error('[smart-conversation-review] sidebar reviews anchor not found');
  sidebar = sidebar.replace(anchor, `${anchor}\n    ${sidebarItem}`);
  console.log('[smart-conversation-review] sidebar item: applied');
}
fs.writeFileSync(sidebarFile, sidebar);

console.log('[smart-conversation-review] separate smart review workspace wired successfully');
