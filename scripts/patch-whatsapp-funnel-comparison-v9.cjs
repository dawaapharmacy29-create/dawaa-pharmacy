const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/WhatsAppReviewQueueV4.tsx');
let src = fs.readFileSync(file, 'utf8');

function patch(label, from, to) {
  if (src.includes(to)) { console.log(`[whatsapp-funnel-comparison-v9] ${label}: already applied`); return; }
  if (!src.includes(from)) throw new Error(`[whatsapp-funnel-comparison-v9] ${label}: anchor not found`);
  src = src.replace(from, to);
  console.log(`[whatsapp-funnel-comparison-v9] ${label}: applied`);
}

patch(
  'import funnel comparison',
  `import WhatsAppConversionFunnelV9 from '@/components/reviews/WhatsAppConversionFunnelV9';`,
  `import WhatsAppConversionFunnelV9 from '@/components/reviews/WhatsAppConversionFunnelV9';\nimport WhatsAppFunnelComparisonV9 from '@/components/reviews/WhatsAppFunnelComparisonV9';`
);

patch(
  'render funnel comparison',
  `      <WhatsAppConversionFunnelV9 onOpenSource={(sourceId) => { setStatus('all'); setSelectedId(sourceId); }} />`,
  `      <WhatsAppConversionFunnelV9 onOpenSource={(sourceId) => { setStatus('all'); setSelectedId(sourceId); }} />\n\n      <WhatsAppFunnelComparisonV9 />`
);

fs.writeFileSync(file, src);
console.log('[whatsapp-funnel-comparison-v9] comparison wired successfully');
