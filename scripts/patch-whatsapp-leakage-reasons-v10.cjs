const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/WhatsAppReviewQueueV4.tsx');
let src = fs.readFileSync(file, 'utf8');

function patch(label, from, to) {
  if (src.includes(to)) { console.log(`[whatsapp-leakage-reasons-v10] ${label}: already applied`); return; }
  if (!src.includes(from)) throw new Error(`[whatsapp-leakage-reasons-v10] ${label}: anchor not found`);
  src = src.replace(from, to);
  console.log(`[whatsapp-leakage-reasons-v10] ${label}: applied`);
}

patch(
  'import leakage reasons dashboard',
  `import WhatsAppConversionFunnelV9 from '@/components/reviews/WhatsAppConversionFunnelV9';`,
  `import WhatsAppConversionFunnelV9 from '@/components/reviews/WhatsAppConversionFunnelV9';\nimport WhatsAppLeakageReasonsV10 from '@/components/reviews/WhatsAppLeakageReasonsV10';`
);

patch(
  'render leakage reasons dashboard',
  `      <WhatsAppConversionFunnelV9 onOpenSource={(sourceId) => { setStatus('all'); setSelectedId(sourceId); }} />`,
  `      <WhatsAppConversionFunnelV9 onOpenSource={(sourceId) => { setStatus('all'); setSelectedId(sourceId); }} />\n\n      <WhatsAppLeakageReasonsV10 onOpenSource={(sourceId) => { setStatus('all'); setSelectedId(sourceId); }} />`
);

fs.writeFileSync(file, src);
console.log('[whatsapp-leakage-reasons-v10] dashboard wired successfully');
