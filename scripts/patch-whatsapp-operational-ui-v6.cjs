const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/WhatsAppReviewQueueV4.tsx');
let src = fs.readFileSync(file, 'utf8');
function patch(label, from, to) {
  if (src.includes(to)) { console.log(`[whatsapp-operational-ui-v6] ${label}: already applied`); return; }
  if (!src.includes(from)) throw new Error(`[whatsapp-operational-ui-v6] ${label}: anchor not found`);
  src = src.replace(from, to);
  console.log(`[whatsapp-operational-ui-v6] ${label}: applied`);
}
patch(
  'operational panel import',
  `import { useAuth } from '@/hooks/useAuth';`,
  `import { useAuth } from '@/hooks/useAuth';\nimport WhatsAppOperationalPanelV6 from '@/components/reviews/WhatsAppOperationalPanelV6';`
);
patch(
  'operational panel placement',
  `            {lostSales.length ? <section className="rounded-2xl border border-rose-400/25 bg-rose-500/8 p-4">`,
  `            <WhatsAppOperationalPanelV6 source={selected} />\n\n            {lostSales.length ? <section className="rounded-2xl border border-rose-400/25 bg-rose-500/8 p-4">`
);
fs.writeFileSync(file, src);
console.log('[whatsapp-operational-ui-v6] queue panel applied successfully');
