const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/WhatsAppReviewQueueV4.tsx');
let src = fs.readFileSync(file, 'utf8');

function patch(label, from, to) {
  if (src.includes(to)) { console.log(`[whatsapp-v26] ${label}: already applied`); return; }
  if (!src.includes(from)) throw new Error(`[whatsapp-v26] ${label}: anchor not found`);
  src = src.replace(from, to);
  console.log(`[whatsapp-v26] ${label}: applied`);
}

patch(
  'import deep intelligence dashboard',
  `import WhatsAppReviewGovernanceV25 from '@/components/reviews/WhatsAppReviewGovernanceV25';`,
  `import WhatsAppReviewGovernanceV25 from '@/components/reviews/WhatsAppReviewGovernanceV25';\nimport WhatsAppDeepConversationIntelligenceV26 from '@/components/reviews/WhatsAppDeepConversationIntelligenceV26';`
);

patch(
  'render deep intelligence after governance',
  `      <WhatsAppReviewGovernanceV25 onOpenSource={openQueueSource} />`,
  `      <WhatsAppReviewGovernanceV25 onOpenSource={openQueueSource} />\n      <WhatsAppDeepConversationIntelligenceV26 />`
);

fs.writeFileSync(file, src);
console.log('[whatsapp-v26] response metrics, sample quality and deep conversation dashboard wired successfully');
require('./patch-whatsapp-case-decision-v26.cjs');
require('./check-whatsapp-deep-intelligence-v26.cjs');
