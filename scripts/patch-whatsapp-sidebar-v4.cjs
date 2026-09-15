const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/components/layout/SidebarBase.tsx');
let src = fs.readFileSync(file, 'utf8');

const anchor = `    { path: '/reviews', icon: ClipboardCheck, label: 'تقييم المحادثات', permission: 'view_reviews' },`;
const replacement = `    { path: '/reviews', icon: ClipboardCheck, label: 'تقييم المحادثات', permission: 'view_reviews' },\n    { path: '/reviews/whatsapp-analyzer', icon: MessageCircle, label: 'محلل محادثات واتساب', permission: 'view_reviews' },\n    { path: '/reviews/whatsapp-queue', icon: ClipboardList, label: 'طابور مراجعة واتساب', permission: 'view_reviews' },`;

if (src.includes(`/reviews/whatsapp-analyzer`)) {
  console.log('[whatsapp-sidebar-v4] sidebar items already applied');
} else {
  if (!src.includes(anchor)) throw new Error('[whatsapp-sidebar-v4] reviews anchor not found');
  src = src.replace(anchor, replacement);
  fs.writeFileSync(file, src);
  console.log('[whatsapp-sidebar-v4] added analyzer and queue to customer service sidebar');
}
