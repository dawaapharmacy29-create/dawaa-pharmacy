const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/App.tsx');
let src = fs.readFileSync(file, 'utf8');

function patch(label, from, to) {
  if (src.includes(to)) {
    console.log(`[wa-analyzer-v1] ${label}: already applied`);
    return;
  }
  if (!src.includes(from)) throw new Error(`[wa-analyzer-v1] ${label}: anchor not found`);
  src = src.replace(from, to);
  console.log(`[wa-analyzer-v1] ${label}: applied`);
}

patch(
  'lazy analyzer pages',
  `const Reviews = lazy(() => import('@/pages/ReviewsEnhanced'));`,
  `const Reviews = lazy(() => import('@/pages/ReviewsEnhanced'));\nconst WhatsAppConversationAnalyzer = lazy(() => import('@/pages/WhatsAppConversationAnalyzer'));\nconst WhatsAppReviewQueueV4 = lazy(() => import('@/pages/WhatsAppReviewQueueV4'));`
);

patch(
  'protected analyzer routes',
  `      <Route\n        path="/reviews"\n        element={<ProtectedRoute>{routeSuspense(<Reviews />, 'التقييمات')}</ProtectedRoute>}\n      />`,
  `      <Route\n        path="/reviews"\n        element={<ProtectedRoute>{routeSuspense(<Reviews />, 'التقييمات')}</ProtectedRoute>}\n      />\n      <Route\n        path="/reviews/whatsapp-analyzer"\n        element={<ProtectedRoute>{routeSuspense(<WhatsAppConversationAnalyzer />, 'تحليل محادثات واتساب')}</ProtectedRoute>}\n      />\n      <Route\n        path="/reviews/whatsapp-queue"\n        element={<ProtectedRoute>{routeSuspense(<WhatsAppReviewQueueV4 />, 'قائمة مراجعة واتساب')}</ProtectedRoute>}\n      />`
);

fs.writeFileSync(file, src);
console.log('[wa-analyzer-v1] analyzer + queue routes patch complete');