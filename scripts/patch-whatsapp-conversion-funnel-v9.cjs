const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/WhatsAppReviewQueueV4.tsx');
let src = fs.readFileSync(file, 'utf8');

function patch(label, from, to) {
  if (src.includes(to)) { console.log(`[whatsapp-conversion-funnel-v9] ${label}: already applied`); return; }
  if (!src.includes(from)) throw new Error(`[whatsapp-conversion-funnel-v9] ${label}: anchor not found`);
  src = src.replace(from, to);
  console.log(`[whatsapp-conversion-funnel-v9] ${label}: applied`);
}

patch(
  'import conversion funnel',
  `import WhatsAppDoctorCycleIntelligenceV8 from '@/components/reviews/WhatsAppDoctorCycleIntelligenceV8';`,
  `import WhatsAppDoctorCycleIntelligenceV8 from '@/components/reviews/WhatsAppDoctorCycleIntelligenceV8';\nimport WhatsAppConversionFunnelV9 from '@/components/reviews/WhatsAppConversionFunnelV9';`
);

patch(
  'render conversion funnel',
  `      <WhatsAppDoctorCycleIntelligenceV8 onOpenSource={(sourceId) => { setStatus('all'); setSelectedId(sourceId); }} />`,
  `      <WhatsAppDoctorCycleIntelligenceV8 onOpenSource={(sourceId) => { setStatus('all'); setSelectedId(sourceId); }} />\n\n      <WhatsAppConversionFunnelV9 onOpenSource={(sourceId) => { setStatus('all'); setSelectedId(sourceId); }} />`
);

fs.writeFileSync(file, src);
console.log('[whatsapp-conversion-funnel-v9] funnel wired successfully');
