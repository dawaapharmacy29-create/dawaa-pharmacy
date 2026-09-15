const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/WhatsAppReviewQueueV4.tsx');
let src = fs.readFileSync(file, 'utf8');

function patch(label, from, to) {
  if (src.includes(to)) { console.log(`[whatsapp-sales-leakage-v8] ${label}: already applied`); return; }
  if (!src.includes(from)) throw new Error(`[whatsapp-sales-leakage-v8] ${label}: anchor not found`);
  src = src.replace(from, to);
  console.log(`[whatsapp-sales-leakage-v8] ${label}: applied`);
}

patch(
  'import sales leakage dashboard',
  `import WhatsAppDoctorCycleIntelligenceV8 from '@/components/reviews/WhatsAppDoctorCycleIntelligenceV8';`,
  `import WhatsAppDoctorCycleIntelligenceV8 from '@/components/reviews/WhatsAppDoctorCycleIntelligenceV8';\nimport WhatsAppSalesLeakageV8 from '@/components/reviews/WhatsAppSalesLeakageV8';`
);

patch(
  'render sales leakage dashboard',
  `      <WhatsAppDoctorCycleIntelligenceV8 />`,
  `      <WhatsAppDoctorCycleIntelligenceV8 />\n\n      <WhatsAppSalesLeakageV8 onOpenSource={(sourceId) => { setStatus('all'); setSelectedId(sourceId); }} />`
);

fs.writeFileSync(file, src);
console.log('[whatsapp-sales-leakage-v8] sales leakage dashboard wired successfully');
