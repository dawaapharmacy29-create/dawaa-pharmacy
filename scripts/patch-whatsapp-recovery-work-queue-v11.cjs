const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/WhatsAppReviewQueueV4.tsx');
let src = fs.readFileSync(file, 'utf8');

function patch(label, from, to) {
  if (src.includes(to)) { console.log(`[whatsapp-recovery-work-v11] ${label}: already applied`); return; }
  if (!src.includes(from)) throw new Error(`[whatsapp-recovery-work-v11] ${label}: anchor not found`);
  src = src.replace(from, to);
  console.log(`[whatsapp-recovery-work-v11] ${label}: applied`);
}

patch(
  'import recovery work queue',
  `import WhatsAppRecoverableOpportunitiesV10 from '@/components/reviews/WhatsAppRecoverableOpportunitiesV10';`,
  `import WhatsAppRecoverableOpportunitiesV10 from '@/components/reviews/WhatsAppRecoverableOpportunitiesV10';\nimport WhatsAppRecoveryWorkQueueV11 from '@/components/reviews/WhatsAppRecoveryWorkQueueV11';`
);

patch(
  'render recovery work queue',
  `      <WhatsAppRecoverableOpportunitiesV10 onOpenSource={(sourceId) => { setStatus('all'); setSelectedId(sourceId); }} />`,
  `      <WhatsAppRecoverableOpportunitiesV10 onOpenSource={(sourceId) => { setStatus('all'); setSelectedId(sourceId); }} />\n\n      <WhatsAppRecoveryWorkQueueV11 onOpenSource={(sourceId) => { setStatus('all'); setSelectedId(sourceId); }} />`
);

fs.writeFileSync(file, src);
console.log('[whatsapp-recovery-work-v11] recovery work queue wired successfully');
