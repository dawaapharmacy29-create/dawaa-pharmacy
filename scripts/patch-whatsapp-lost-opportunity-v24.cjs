const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/WhatsAppReviewQueueV4.tsx');
let src = fs.readFileSync(file, 'utf8');

function patch(label, from, to) {
  if (src.includes(to)) { console.log(`[whatsapp-lost-opportunity-v24] ${label}: already applied`); return; }
  if (!src.includes(from)) throw new Error(`[whatsapp-lost-opportunity-v24] ${label}: anchor not found`);
  src = src.replace(from, to);
  console.log(`[whatsapp-lost-opportunity-v24] ${label}: applied`);
}

patch(
  'import lost opportunity analytics',
  `import WhatsAppCaseKpisV23 from '@/components/reviews/WhatsAppCaseKpisV23';`,
  `import WhatsAppCaseKpisV23 from '@/components/reviews/WhatsAppCaseKpisV23';\nimport WhatsAppLostOpportunityAnalyticsV24 from '@/components/reviews/WhatsAppLostOpportunityAnalyticsV24';`
);

patch(
  'render lost opportunity analytics after doctor case kpis',
  `      <WhatsAppCaseKpisV23 mode="doctors" />`,
  `      <WhatsAppCaseKpisV23 mode="doctors" />\n      <WhatsAppLostOpportunityAnalyticsV24 onOpenSource={openQueueSource} />`
);

fs.writeFileSync(file, src);
console.log('[whatsapp-lost-opportunity-v24] loss, leakage and rescue analytics wired successfully');
require('./patch-whatsapp-governance-v25.cjs');
