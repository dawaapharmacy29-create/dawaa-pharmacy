const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/WhatsAppReviewQueueV4.tsx');
let src = fs.readFileSync(file, 'utf8');

function patch(label, from, to) {
  if (src.includes(to)) { console.log(`[whatsapp-action-center-v6] ${label}: already applied`); return; }
  if (!src.includes(from)) throw new Error(`[whatsapp-action-center-v6] ${label}: anchor not found`);
  src = src.replace(from, to);
  console.log(`[whatsapp-action-center-v6] ${label}: applied`);
}

patch(
  'import action center',
  `import { useAuth } from '@/hooks/useAuth';`,
  `import { useAuth } from '@/hooks/useAuth';\nimport WhatsAppCustomerActionCenterV6 from '@/components/reviews/WhatsAppCustomerActionCenterV6';`
);

patch(
  'render action center',
  `      </section>\n\n      <section className="dawaa-card dawaa-card--soft p-4">`,
  `      </section>\n\n      <WhatsAppCustomerActionCenterV6 onOpenSource={(sourceId) => { setStatus('all'); setSelectedId(sourceId); }} />\n\n      <section className="dawaa-card dawaa-card--soft p-4">`
);

fs.writeFileSync(file, src);
console.log('[whatsapp-action-center-v6] customer service action center wired successfully');
