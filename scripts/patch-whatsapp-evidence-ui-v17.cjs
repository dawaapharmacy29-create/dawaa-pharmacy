const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/WhatsAppReviewQueueV4.tsx');
let src = fs.readFileSync(file, 'utf8');

function patch(label, from, to) {
  if (src.includes(to)) { console.log(`[whatsapp-evidence-ui-v17] ${label}: already applied`); return; }
  if (!src.includes(from)) throw new Error(`[whatsapp-evidence-ui-v17] ${label}: anchor not found`);
  src = src.replace(from, to);
  console.log(`[whatsapp-evidence-ui-v17] ${label}: applied`);
}

patch(
  'imports',
  `import WhatsAppCustomerStory360V16 from '@/components/reviews/WhatsAppCustomerStory360V16';`,
  `import WhatsAppCustomerStory360V16 from '@/components/reviews/WhatsAppCustomerStory360V16';\nimport WhatsAppEvidenceCoverageV17 from '@/components/reviews/WhatsAppEvidenceCoverageV17';\nimport WhatsAppCycleEvidenceDashboardV17 from '@/components/reviews/WhatsAppCycleEvidenceDashboardV17';`
);

patch(
  'doctor evidence cycle dashboard',
  `      <WhatsAppDoctorCycleIntelligenceV8 onOpenSource={(sourceId) => { setStatus('all'); setSelectedId(sourceId); }} />`,
  `      <WhatsAppDoctorCycleIntelligenceV8 onOpenSource={(sourceId) => { setStatus('all'); setSelectedId(sourceId); }} />\n      <WhatsAppCycleEvidenceDashboardV17 mode="doctors" />`
);

patch(
  'customer and service evidence dashboards',
  `          <WhatsAppCustomerStory360V16 onOpenSource={openQueueSource} />\n          <WhatsAppCustomerActionCenterV6 onOpenSource={openQueueSource} />`,
  `          <WhatsAppCustomerStory360V16 onOpenSource={openQueueSource} />\n          <WhatsAppCycleEvidenceDashboardV17 mode="customers" />\n          <WhatsAppCycleEvidenceDashboardV17 mode="service" />\n          <WhatsAppCustomerActionCenterV6 onOpenSource={openQueueSource} />`
);

const transcript = `            <section className="dawaa-card dawaa-card--soft p-4"><div className="flex items-center gap-2 font-black text-white"><FileText size={17}/>المحادثة الأصلية المنظمة</div>`;
if (!src.includes('<WhatsAppEvidenceCoverageV17 sourceId={selected.id} />')) {
  if (!src.includes(transcript)) throw new Error('[whatsapp-evidence-ui-v17] transcript anchor not found');
  src = src.replace(transcript, `            <WhatsAppEvidenceCoverageV17 sourceId={selected.id} />\n\n${transcript}`);
  console.log('[whatsapp-evidence-ui-v17] evidence matrix before transcript: applied');
} else {
  console.log('[whatsapp-evidence-ui-v17] evidence matrix before transcript: already applied');
}

fs.writeFileSync(file, src);
console.log('[whatsapp-evidence-ui-v17] evidence dashboards wired successfully');
