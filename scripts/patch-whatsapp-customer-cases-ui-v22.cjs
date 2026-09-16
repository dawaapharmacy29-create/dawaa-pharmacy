const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/WhatsAppReviewQueueV4.tsx');
let src = fs.readFileSync(file, 'utf8');

function patch(label, from, to) {
  if (src.includes(to)) { console.log(`[whatsapp-cases-ui-v22] ${label}: already applied`); return; }
  if (!src.includes(from)) throw new Error(`[whatsapp-cases-ui-v22] ${label}: anchor not found`);
  src = src.replace(from, to);
  console.log(`[whatsapp-cases-ui-v22] ${label}: applied`);
}

patch(
  'import cases board',
  `import WhatsAppCustomerStory360V16 from '@/components/reviews/WhatsAppCustomerStory360V16';`,
  `import WhatsAppCustomerStory360V16 from '@/components/reviews/WhatsAppCustomerStory360V16';\nimport WhatsAppCustomerCasesV22 from '@/components/reviews/WhatsAppCustomerCasesV22';`
);

patch(
  'render cases board after story',
  `          <WhatsAppCustomerStory360V16 onOpenSource={openQueueSource} />`,
  `          <WhatsAppCustomerStory360V16 onOpenSource={openQueueSource} />\n          <WhatsAppCustomerCasesV22 onOpenSource={openQueueSource} />`
);

fs.writeFileSync(file, src);
console.log('[whatsapp-cases-ui-v22] operational customer cases board wired successfully');
