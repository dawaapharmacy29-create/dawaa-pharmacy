const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/WhatsAppConversationAnalyzer.tsx');
let src = fs.readFileSync(file, 'utf8');

function patch(label, from, to) {
  if (src.includes(to)) { console.log(`[whatsapp-customer-resolver-v4] ${label}: already applied`); return; }
  if (!src.includes(from)) throw new Error(`[whatsapp-customer-resolver-v4] ${label}: anchor not found`);
  src = src.replace(from, to);
  console.log(`[whatsapp-customer-resolver-v4] ${label}: applied`);
}

patch(
  'resolver import',
  `import { persistAnalyzedWhatsAppSession } from '@/lib/whatsappReviewPersistenceV4';`,
  `import { persistAnalyzedWhatsAppSession } from '@/lib/whatsappReviewPersistenceV4';\nimport { resolveWhatsAppCustomerIdentity } from '@/lib/whatsappCustomerResolverV4';`
);

patch(
  'resolve identity before persist',
  `          const intelligence = buildUnifiedConversationIntelligence(item.session);\n          const persisted = await persistAnalyzedWhatsAppSession(item.session, intelligence, {\n            sourceFileName: sourceFileName || fileName || null,\n            branch: importBranch,\n            customerName: item.customerName || item.session.customerName || null,\n            staffName: item.session.outboundStaffNames[0] || null,\n            createdBy: String(user?.name || user?.username || user?.id || ''),\n          });`,
  `          const intelligence = buildUnifiedConversationIntelligence(item.session);\n          const visibleCustomer = item.customerName || item.session.customerName || null;\n          const resolvedCustomer = await resolveWhatsAppCustomerIdentity(visibleCustomer, importBranch);\n          const persisted = await persistAnalyzedWhatsAppSession(item.session, intelligence, {\n            sourceFileName: sourceFileName || fileName || null,\n            branch: importBranch,\n            customerId: resolvedCustomer.customer?.id || null,\n            customerCode: resolvedCustomer.customer?.code || null,\n            customerName: resolvedCustomer.customer?.name || visibleCustomer,\n            customerPhone: resolvedCustomer.customer?.phone || null,\n            staffName: item.session.outboundStaffNames[0] || null,\n            createdBy: String(user?.name || user?.username || user?.id || ''),\n          });`
);

fs.writeFileSync(file, src);
console.log('[whatsapp-customer-resolver-v4] conservative customer resolver applied successfully');
