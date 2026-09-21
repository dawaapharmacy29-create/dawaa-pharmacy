const fs = require('fs');
const path = require('path');

function patchFile(rel, mutate) {
  const file = path.join(process.cwd(), rel);
  let src = fs.readFileSync(file, 'utf8');
  const next = mutate(src);
  if (next !== src) fs.writeFileSync(file, next);
}

patchFile('src/App.tsx', (source) => {
  let src = source;
  const importAnchor = `const Reviews = lazy(() => import('@/pages/ReviewsEnhanced'));`;
  const importLine = `const SmartConversationReviewRebuild = lazy(() => import('@/pages/SmartConversationReviewRebuild'));`;
  const watcherImport = `const WhatsAppSmartFolderWatcher = lazy(() => import('@/pages/WhatsAppSmartFolderWatcher'));`;
  if (!src.includes(importLine)) {
    if (!src.includes(importAnchor)) throw new Error('[smart-review-rebuild] app import anchor not found');
    src = src.replace(importAnchor, `${importAnchor}\n${importLine}`);
  }
  if (!src.includes(watcherImport)) {
    src = src.replace(importLine, `${importLine}\n${watcherImport}`);
  }

  const routeAnchor = `      <Route\n        path="/reviews"\n        element={<ProtectedRoute>{routeSuspense(<Reviews />, 'التقييمات')}</ProtectedRoute>}\n      />`;
  const routeLine = `      <Route\n        path="/smart-conversation-review-rebuild"\n        element={<ProtectedRoute permission="view_reviews">{routeSuspense(<SmartConversationReviewRebuild />, 'المراجعة الذكية الجديدة')}</ProtectedRoute>}\n      />`;
  if (!src.includes('path="/smart-conversation-review-rebuild"')) {
    if (!src.includes(routeAnchor)) throw new Error('[smart-review-rebuild] app route anchor not found');
    src = src.replace(routeAnchor, `${routeAnchor}\n${routeLine}`);
  }
  const watcherRoute = `      <Route\n        path="/whatsapp-smart-folder-watcher"\n        element={<ProtectedRoute permission="view_reviews">{routeSuspense(<WhatsAppSmartFolderWatcher />, 'التقاط واتساب تلقائيًا')}</ProtectedRoute>}\n      />`;
  if (!src.includes('path="/whatsapp-smart-folder-watcher"')) {
    src = src.replace(routeLine, `${routeLine}\n${watcherRoute}`);
  }
  return src;
});

patchFile('src/components/layout/SidebarBase.tsx', (source) => {
  let src = source;
  const anchor = `    { path: '/reviews', icon: ClipboardCheck, label: 'تقييم المحادثات', permission: 'view_reviews' },`;
  const item = `    { path: '/smart-conversation-review-rebuild', icon: MessageCircle, label: 'المراجعة الذكية الجديدة', permission: 'view_reviews' },`;
  if (!src.includes(item)) {
    if (!src.includes(anchor)) throw new Error('[smart-review-rebuild] sidebar anchor not found');
    src = src.replace(anchor, `${anchor}\n${item}`);
  }
  const watcherItem = `    { path: '/whatsapp-smart-folder-watcher', icon: MessageCircle, label: 'التقاط واتساب تلقائيًا', permission: 'view_reviews' },`;
  if (!src.includes(watcherItem)) {
    src = src.replace(item, `${item}\n${watcherItem}`);
  }
  return src;
});

console.log('[smart-review-rebuild] route and sidebar wired');
require('./patch-smart-intelligence-panel-v2.cjs');
