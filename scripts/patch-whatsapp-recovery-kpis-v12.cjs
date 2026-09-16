const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/WhatsAppReviewQueueV4.tsx');
let src = fs.readFileSync(file, 'utf8');

function patch(label, from, to) {
  if (src.includes(to)) { console.log(`[whatsapp-recovery-kpis-v12] ${label}: already applied`); return; }
  if (!src.includes(from)) throw new Error(`[whatsapp-recovery-kpis-v12] ${label}: anchor not found`);
  src = src.replace(from, to);
  console.log(`[whatsapp-recovery-kpis-v12] ${label}: applied`);
}

patch(
  'import recovery KPI dashboard',
  `import WhatsAppRecoveryWorkQueueV11 from '@/components/reviews/WhatsAppRecoveryWorkQueueV11';`,
  `import WhatsAppRecoveryWorkQueueV11 from '@/components/reviews/WhatsAppRecoveryWorkQueueV11';\nimport WhatsAppRecoveryCycleKpisV12 from '@/components/reviews/WhatsAppRecoveryCycleKpisV12';`
);

patch(
  'render recovery KPI dashboard',
  `      <WhatsAppRecoveryWorkQueueV11 onOpenSource={(sourceId) => { setStatus('all'); setSelectedId(sourceId); }} />`,
  `      <WhatsAppRecoveryWorkQueueV11 onOpenSource={(sourceId) => { setStatus('all'); setSelectedId(sourceId); }} />\n\n      <WhatsAppRecoveryCycleKpisV12 />`
);

fs.writeFileSync(file, src);
console.log('[whatsapp-recovery-kpis-v12] recovery KPI dashboard wired successfully');
require('./patch-whatsapp-queue-workspace-tabs-v13.cjs');
