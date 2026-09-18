const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/WhatsAppReviewQueueV4.tsx');
let src = fs.readFileSync(file, 'utf8');

function patch(label, from, to) {
  if (src.includes(to)) { console.log(`[whatsapp-product-conversion-v21] ${label}: already applied`); return; }
  if (!src.includes(from)) throw new Error(`[whatsapp-product-conversion-v21] ${label}: anchor not found`);
  src = src.replace(from, to);
  console.log(`[whatsapp-product-conversion-v21] ${label}: applied`);
}

patch(
  'import product conversion dashboard',
  `import WhatsAppOpportunityFunnelV20 from '@/components/reviews/WhatsAppOpportunityFunnelV20';`,
  `import WhatsAppOpportunityFunnelV20 from '@/components/reviews/WhatsAppOpportunityFunnelV20';\nimport WhatsAppProductConversionV21 from '@/components/reviews/WhatsAppProductConversionV21';`
);

patch(
  'render product conversion after evidence funnel',
  `      <WhatsAppOpportunityFunnelV20 />`,
  `      <WhatsAppOpportunityFunnelV20 />\n      <WhatsAppProductConversionV21 onOpenSource={openQueueSource} />`
);

fs.writeFileSync(file, src);
console.log('[whatsapp-product-conversion-v21] verified conversation-vs-product conversion dashboard wired successfully');
