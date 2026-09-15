const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/WhatsAppReviewQueueV4.tsx');
let src = fs.readFileSync(file, 'utf8');

function patch(label, from, to) {
  if (src.includes(to)) { console.log(`[whatsapp-doctor-cycle-v8] ${label}: already applied`); return; }
  if (!src.includes(from)) throw new Error(`[whatsapp-doctor-cycle-v8] ${label}: anchor not found`);
  src = src.replace(from, to);
  console.log(`[whatsapp-doctor-cycle-v8] ${label}: applied`);
}

patch(
  'import doctor cycle dashboard',
  `import WhatsAppCustomerActionCenterV6 from '@/components/reviews/WhatsAppCustomerActionCenterV6';`,
  `import WhatsAppCustomerActionCenterV6 from '@/components/reviews/WhatsAppCustomerActionCenterV6';\nimport WhatsAppDoctorCycleIntelligenceV8 from '@/components/reviews/WhatsAppDoctorCycleIntelligenceV8';`
);

patch(
  'render doctor cycle dashboard',
  `      <WhatsAppCustomerActionCenterV6 onOpenSource={(sourceId) => { setStatus('all'); setSelectedId(sourceId); }} />`,
  `      <WhatsAppCustomerActionCenterV6 onOpenSource={(sourceId) => { setStatus('all'); setSelectedId(sourceId); }} />\n\n      <WhatsAppDoctorCycleIntelligenceV8 />`
);

fs.writeFileSync(file, src);
console.log('[whatsapp-doctor-cycle-v8] doctor cycle dashboard wired successfully');
