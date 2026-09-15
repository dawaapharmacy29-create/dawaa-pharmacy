const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/WhatsAppReviewQueueV4.tsx');
let src = fs.readFileSync(file, 'utf8');

function patch(label, from, to) {
  if (src.includes(to)) { console.log(`[whatsapp-recoverable-v10] ${label}: already applied`); return; }
  if (!src.includes(from)) throw new Error(`[whatsapp-recoverable-v10] ${label}: anchor not found`);
  src = src.replace(from, to);
  console.log(`[whatsapp-recoverable-v10] ${label}: applied`);
}

patch(
  'import recoverable opportunities',
  `import WhatsAppConversionFunnelV9 from '@/components/reviews/WhatsAppConversionFunnelV9';`,
  `import WhatsAppConversionFunnelV9 from '@/components/reviews/WhatsAppConversionFunnelV9';\nimport WhatsAppRecoverableOpportunitiesV10 from '@/components/reviews/WhatsAppRecoverableOpportunitiesV10';`
);

patch(
  'render recoverable opportunities',
  `      <WhatsAppConversionFunnelV9 onOpenSource={(sourceId) => { setStatus('all'); setSelectedId(sourceId); }} />`,
  `      <WhatsAppConversionFunnelV9 onOpenSource={(sourceId) => { setStatus('all'); setSelectedId(sourceId); }} />\n\n      <WhatsAppRecoverableOpportunitiesV10 onOpenSource={(sourceId) => { setStatus('all'); setSelectedId(sourceId); }} />`
);

fs.writeFileSync(file, src);
console.log('[whatsapp-recoverable-v10] recoverable opportunities wired successfully');
