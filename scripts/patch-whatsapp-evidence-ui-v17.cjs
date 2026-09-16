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
  `import WhatsAppCustomerStory360V16 from '@/components/reviews/WhatsAppCustomerStory360V16';\nimport WhatsAppEvidenceCoverageV17 from '@/components/reviews/WhatsAppEvidenceCoverageV17';\nimport WhatsAppCycleEvidenceDashboardV17 from '@/components/reviews/WhatsAppCycleEvidenceDashboardV17';\nimport WhatsAppOrderLifecycleV19 from '@/components/reviews/WhatsAppOrderLifecycleV19';\nimport WhatsAppEvidenceFactReviewV19 from '@/components/reviews/WhatsAppEvidenceFactReviewV19';`
);

if (!src.includes('<WhatsAppCycleEvidenceDashboardV17 mode="doctors" />')) {
  const doctorCurrent = `      <WhatsAppDoctorCycleIntelligenceV8 onOpenSource={openQueueSource} />`;
  const doctorLegacy = `      <WhatsAppDoctorCycleIntelligenceV8 onOpenSource={(sourceId) => { setStatus('all'); setSelectedId(sourceId); }} />`;
  if (src.includes(doctorCurrent)) src = src.replace(doctorCurrent, `${doctorCurrent}\n      <WhatsAppCycleEvidenceDashboardV17 mode="doctors" />`);
  else if (src.includes(doctorLegacy)) src = src.replace(doctorLegacy, `${doctorLegacy}\n      <WhatsAppCycleEvidenceDashboardV17 mode="doctors" />`);
  else throw new Error('[whatsapp-evidence-ui-v17] doctor dashboard anchor not found');
  console.log('[whatsapp-evidence-ui-v17] doctor evidence cycle dashboard: applied');
} else console.log('[whatsapp-evidence-ui-v17] doctor evidence cycle dashboard: already applied');

if (!src.includes('<WhatsAppCycleEvidenceDashboardV17 mode="customers" />')) {
  const currentCustomers = `          <WhatsAppCustomerStory360V16 onOpenSource={openQueueSource} />\n          <WhatsAppCustomerActionCenterV6 onOpenSource={openQueueSource} />`;
  const legacyCustomers = `          <WhatsAppCustomerStory360V16 onOpenSource={openQueueSource} />\n          <WhatsAppCustomerActionCenterV6 onOpenSource={(sourceId) => { setStatus('all'); setSelectedId(sourceId); }} />`;
  const currentReplacement = `          <WhatsAppCustomerStory360V16 onOpenSource={openQueueSource} />\n          <WhatsAppCycleEvidenceDashboardV17 mode="customers" />\n          <WhatsAppCycleEvidenceDashboardV17 mode="service" />\n          <WhatsAppCustomerActionCenterV6 onOpenSource={openQueueSource} />`;
  if (src.includes(currentCustomers)) src = src.replace(currentCustomers, currentReplacement);
  else if (src.includes(legacyCustomers)) src = src.replace(legacyCustomers, currentReplacement);
  else throw new Error('[whatsapp-evidence-ui-v17] customer dashboard anchor not found');
  console.log('[whatsapp-evidence-ui-v17] customer and service evidence dashboards: applied');
} else console.log('[whatsapp-evidence-ui-v17] customer and service evidence dashboards: already applied');

const transcript = `            <section className="dawaa-card dawaa-card--soft p-4"><div className="flex items-center gap-2 font-black text-white"><FileText size={17}/>المحادثة الأصلية المنظمة</div>`;
if (!src.includes('<WhatsAppEvidenceCoverageV17 sourceId={selected.id} />')) {
  if (!src.includes(transcript)) throw new Error('[whatsapp-evidence-ui-v17] transcript anchor not found for coverage');
  src = src.replace(transcript, `            <WhatsAppEvidenceCoverageV17 sourceId={selected.id} />\n\n${transcript}`);
  console.log('[whatsapp-evidence-ui-v17] evidence matrix before transcript: applied');
}
if (!src.includes('<WhatsAppOrderLifecycleV19 sourceId={selected.id} />')) {
  const coverage = `            <WhatsAppEvidenceCoverageV17 sourceId={selected.id} />`;
  if (!src.includes(coverage)) throw new Error('[whatsapp-evidence-ui-v17] coverage anchor not found for lifecycle');
  src = src.replace(coverage, `${coverage}\n            <WhatsAppOrderLifecycleV19 sourceId={selected.id} />\n            <WhatsAppEvidenceFactReviewV19 sourceId={selected.id} />`);
  console.log('[whatsapp-evidence-ui-v17] lifecycle and human fact review: applied');
} else console.log('[whatsapp-evidence-ui-v17] lifecycle and human fact review: already applied');

fs.writeFileSync(file, src);
console.log('[whatsapp-evidence-ui-v17] evidence, cycle, lifecycle and review UI wired successfully');
