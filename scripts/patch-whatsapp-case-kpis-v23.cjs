const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/WhatsAppReviewQueueV4.tsx');
let src = fs.readFileSync(file, 'utf8');

function patch(label, from, to) {
  if (src.includes(to)) { console.log(`[whatsapp-case-kpis-v23] ${label}: already applied`); return; }
  if (!src.includes(from)) throw new Error(`[whatsapp-case-kpis-v23] ${label}: anchor not found`);
  src = src.replace(from, to);
  console.log(`[whatsapp-case-kpis-v23] ${label}: applied`);
}

patch(
  'import case kpis',
  `import WhatsAppCustomerCasesV22 from '@/components/reviews/WhatsAppCustomerCasesV22';`,
  `import WhatsAppCustomerCasesV22 from '@/components/reviews/WhatsAppCustomerCasesV22';\nimport WhatsAppCaseKpisV23 from '@/components/reviews/WhatsAppCaseKpisV23';`
);

patch(
  'service case kpis after cases board',
  `          <WhatsAppCustomerCasesV22 onOpenSource={openQueueSource} />`,
  `          <WhatsAppCustomerCasesV22 onOpenSource={openQueueSource} />\n          <WhatsAppCaseKpisV23 mode="service" />`
);

if (!src.includes('<WhatsAppCaseKpisV23 mode="doctors" />')) {
  const opportunity = `      <WhatsAppOpportunityFunnelV20 />`;
  const conversion = `      <WhatsAppConversionFunnelV9 onOpenSource={openQueueSource} />`;
  if (src.includes(opportunity)) src = src.replace(opportunity, `${opportunity}\n      <WhatsAppCaseKpisV23 mode="doctors" />`);
  else if (src.includes(conversion)) src = src.replace(conversion, `${conversion}\n      <WhatsAppCaseKpisV23 mode="doctors" />`);
  else throw new Error('[whatsapp-case-kpis-v23] sales funnel anchor not found');
  console.log('[whatsapp-case-kpis-v23] doctor case kpis: applied');
} else console.log('[whatsapp-case-kpis-v23] doctor case kpis: already applied');

fs.writeFileSync(file, src);
console.log('[whatsapp-case-kpis-v23] case outcome KPIs wired successfully');
