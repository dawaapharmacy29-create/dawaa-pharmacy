const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/WhatsAppReviewQueueV4.tsx');
let src = fs.readFileSync(file, 'utf8');

function patch(label, from, to) {
  if (src.includes(to)) { console.log(`[whatsapp-customer-story-ui-v16] ${label}: already applied`); return; }
  if (!src.includes(from)) throw new Error(`[whatsapp-customer-story-ui-v16] ${label}: anchor not found`);
  src = src.replace(from, to);
  console.log(`[whatsapp-customer-story-ui-v16] ${label}: applied`);
}

patch(
  'import customer story 360',
  `import WhatsAppCustomerActionCenterV6 from '@/components/reviews/WhatsAppCustomerActionCenterV6';`,
  `import WhatsAppCustomerActionCenterV6 from '@/components/reviews/WhatsAppCustomerActionCenterV6';\nimport WhatsAppCustomerStory360V16 from '@/components/reviews/WhatsAppCustomerStory360V16';`
);

const currentCustomers = `      {/* whatsapp-workspace-v13:customers */}\n      {activeWorkspace === 'customers' ? (\n      <WhatsAppCustomerActionCenterV6 onOpenSource={openQueueSource} />\n      ) : null}`;
const legacyCustomers = `      {/* whatsapp-workspace-v13:customers */}\n      {activeWorkspace === 'customers' ? (\n      <WhatsAppCustomerActionCenterV6 onOpenSource={(sourceId) => { setStatus('all'); setSelectedId(sourceId); }} />\n      ) : null}`;
const replacement = `      {/* whatsapp-workspace-v13:customers */}\n      {activeWorkspace === 'customers' ? (\n        <div className="space-y-4">\n          <WhatsAppCustomerStory360V16 onOpenSource={openQueueSource} />\n          <WhatsAppCustomerActionCenterV6 onOpenSource={openQueueSource} />\n        </div>\n      ) : null}`;

if (!src.includes(replacement)) {
  if (src.includes(currentCustomers)) src = src.replace(currentCustomers, replacement);
  else if (src.includes(legacyCustomers)) src = src.replace(legacyCustomers, replacement);
  else throw new Error('[whatsapp-customer-story-ui-v16] customer workspace anchor not found');
  console.log('[whatsapp-customer-story-ui-v16] render customer story 360: applied');
} else {
  console.log('[whatsapp-customer-story-ui-v16] render customer story 360: already applied');
}

fs.writeFileSync(file, src);
console.log('[whatsapp-customer-story-ui-v16] customer story workspace wired successfully');
require('./patch-whatsapp-customer-story-identity-v16.cjs');
