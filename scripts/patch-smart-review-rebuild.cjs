const fs = require('fs');
const path = require('path');

function patchFile(rel, mutate) {
  const file = path.join(process.cwd(), rel);
  let src = fs.readFileSync(file, 'utf8');
  const next = mutate(src);
  if (next !== src) fs.writeFileSync(file, next);
}

patchFile('src/App.tsx', (src) => {
  const importLine = `const SmartConversationReviewRebuild = lazy(() => import('@/pages/SmartConversationReviewRebuild'));`;
  if (!src.includes(importLine)) {
    const anchor = `const WhatsappAnalytics = lazy(() => import('@/pages/WhatsappAnalytics'));`;
    if (!src.includes(anchor)) throw new Error('[smart-review-rebuild] App import anchor not found');
    src = src.replace(anchor, `${anchor}\n${importLine}`);
  }

  if (!src.includes('path="/smart-conversation-review-rebuild"')) {
    const anchor = `      <Route\n        path="/whatsapp-analytics"`;
    if (!src.includes(anchor)) throw new Error('[smart-review-rebuild] App route anchor not found');
    const route = `      <Route\n        path="/smart-conversation-review-rebuild"\n        element={\n          <ProtectedRoute permission="view_reviews">\n            {routeSuspense(<SmartConversationReviewRebuild />, 'مراجعة المحادثات الذكية')}\n          </ProtectedRoute>\n        }\n      />\n`;
    src = src.replace(anchor, `${route}${anchor}`);
  }
  return src;
});

patchFile('src/components/layout/SidebarBase.tsx', (src) => {
  const item = `{ path: '/smart-conversation-review-rebuild', icon: Sparkles, label: 'المراجعة الذكية الجديدة', permission: 'view_reviews' },`;
  if (src.includes(item)) return src;
  const anchor = `{ path: '/reviews', icon: ClipboardCheck, label: 'تقييم المحادثات', permission: 'view_reviews' },`;
  if (!src.includes(anchor)) throw new Error('[smart-review-rebuild] sidebar anchor not found');
  return src.replace(anchor, `${anchor}\n    ${item}`);
});

console.log('[smart-review-rebuild] standalone smart review route wired');
