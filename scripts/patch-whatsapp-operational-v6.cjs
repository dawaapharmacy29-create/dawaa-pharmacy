const fs = require('fs');
const path = require('path');

const analyzerFile = path.join(process.cwd(), 'src/pages/WhatsAppConversationAnalyzer.tsx');
let analyzer = fs.readFileSync(analyzerFile, 'utf8');

function patch(src, label, from, to) {
  if (src.includes(to)) { console.log(`[whatsapp-operational-v6] ${label}: already applied`); return src; }
  if (!src.includes(from)) throw new Error(`[whatsapp-operational-v6] ${label}: anchor not found`);
  console.log(`[whatsapp-operational-v6] ${label}: applied`);
  return src.replace(from, to);
}

analyzer = patch(
  analyzer,
  'operational imports',
  `import { resolveWhatsAppCustomerIdentity } from '@/lib/whatsappCustomerResolverV4';`,
  `import { resolveWhatsAppCustomerIdentity } from '@/lib/whatsappCustomerResolverV4';\nimport { buildWhatsAppOperationalIntelligenceV6, enrichWhatsAppOperationalProductsV6, syncWhatsAppOperationalActionsV6 } from '@/lib/whatsappOperationalIntelligenceV6';\nimport { resolveWhatsAppStaffV6 } from '@/lib/whatsappStaffResolverV6';`
);

analyzer = patch(
  analyzer,
  'enrich analysis customer staff and persist V6',
  `          const intelligence = buildUnifiedConversationIntelligence(item.session);\n          const visibleCustomer = item.customerName || item.session.customerName || null;\n          const resolvedCustomer = await resolveWhatsAppCustomerIdentity(visibleCustomer, importBranch);\n          const persisted = await persistAnalyzedWhatsAppSession(item.session, intelligence, {\n            sourceFileName: options?.sourceName || sourceFileName || fileName || null,\n            innerFileName: options?.innerName || null,\n            branch: importBranch,\n            customerId: resolvedCustomer.customer?.id || null,\n            customerCode: resolvedCustomer.customer?.code || null,\n            customerName: resolvedCustomer.customer?.name || visibleCustomer,\n            customerPhone: resolvedCustomer.customer?.phone || null,\n            staffName: item.session.outboundStaffNames[0] || null,\n            createdBy: String(user?.name || user?.username || user?.id || ''),\n          });`,
  `          const baseIntelligence = buildUnifiedConversationIntelligence(item.session);\n          const operational = await enrichWhatsAppOperationalProductsV6(buildWhatsAppOperationalIntelligenceV6(item.session, baseIntelligence));\n          const intelligence = { ...baseIntelligence, operational };\n          const visibleCustomer = item.customerName || item.session.customerName || null;\n          const resolvedCustomer = await resolveWhatsAppCustomerIdentity(visibleCustomer, importBranch);\n          const resolvedStaff = await resolveWhatsAppStaffV6(item.session.outboundStaffNames, importBranch);\n          const persisted = await persistAnalyzedWhatsAppSession(item.session, intelligence, {\n            sourceFileName: options?.sourceName || sourceFileName || fileName || null,\n            innerFileName: options?.innerName || null,\n            branch: importBranch,\n            customerId: resolvedCustomer.customer?.id || null,\n            customerCode: resolvedCustomer.customer?.code || null,\n            customerName: resolvedCustomer.customer?.name || visibleCustomer,\n            customerPhone: resolvedCustomer.customer?.phone || null,\n            staffId: resolvedStaff.staff?.id || null,\n            staffName: resolvedStaff.staff?.name || item.session.outboundStaffNames[0] || null,\n            createdBy: String(user?.name || user?.username || user?.id || ''),\n          });\n          try {\n            await syncWhatsAppOperationalActionsV6(operational, {\n              sourceId: persisted.id,\n              branch: importBranch,\n              customerId: resolvedCustomer.customer?.id || null,\n              customerCode: resolvedCustomer.customer?.code || null,\n              customerName: resolvedCustomer.customer?.name || visibleCustomer,\n              customerPhone: resolvedCustomer.customer?.phone || null,\n              staffId: resolvedStaff.staff?.id || null,\n              staffName: resolvedStaff.staff?.name || item.session.outboundStaffNames[0] || null,\n              createdBy: String(user?.name || user?.username || user?.id || ''),\n            });\n          } catch (actionError) {\n            console.warn('[whatsapp-operational-v6] action sync failed; review source preserved', persisted.id, actionError);\n          }`
);

fs.writeFileSync(analyzerFile, analyzer);
console.log('[whatsapp-operational-v6] analyzer ingestion wired successfully');
