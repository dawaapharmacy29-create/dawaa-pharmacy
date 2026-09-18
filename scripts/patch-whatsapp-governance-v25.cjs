const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/WhatsAppReviewQueueV4.tsx');
let src = fs.readFileSync(file, 'utf8');

function patch(label, from, to) {
  if (src.includes(to)) {
    console.log(`[whatsapp-governance-v25] ${label}: already applied`);
    return;
  }
  if (!src.includes(from)) throw new Error(`[whatsapp-governance-v25] ${label}: anchor not found`);
  src = src.replace(from, to);
  console.log(`[whatsapp-governance-v25] ${label}: applied`);
}

patch(
  'import governance center',
  `import WhatsAppLostOpportunityAnalyticsV24 from '@/components/reviews/WhatsAppLostOpportunityAnalyticsV24';`,
  `import WhatsAppLostOpportunityAnalyticsV24 from '@/components/reviews/WhatsAppLostOpportunityAnalyticsV24';\nimport WhatsAppReviewGovernanceV25 from '@/components/reviews/WhatsAppReviewGovernanceV25';`
);

patch(
  'render governance center after v24 analytics',
  `      <WhatsAppLostOpportunityAnalyticsV24 onOpenSource={openQueueSource} />`,
  `      <WhatsAppLostOpportunityAnalyticsV24 onOpenSource={openQueueSource} />\n      <WhatsAppReviewGovernanceV25 onOpenSource={openQueueSource} />`
);

fs.writeFileSync(file, src);
console.log('[whatsapp-governance-v25] safe automation, human sampling and coaching center wired successfully');
require('./check-whatsapp-governance-v25.cjs');
require('./patch-whatsapp-deep-intelligence-v26.cjs');
