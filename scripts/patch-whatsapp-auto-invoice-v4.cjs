const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/WhatsAppConversationAnalyzer.tsx');
let src = fs.readFileSync(file, 'utf8');

function patch(label, from, to) {
  if (src.includes(to)) {
    console.log(`[whatsapp-auto-invoice-v4] ${label}: already applied`);
    return;
  }
  if (!src.includes(from)) throw new Error(`[whatsapp-auto-invoice-v4] ${label}: anchor not found`);
  src = src.replace(from, to);
  console.log(`[whatsapp-auto-invoice-v4] ${label}: applied`);
}

patch(
  'invoice verifier import',
  `import { buildUnifiedConversationIntelligence, summarizePortfolio } from '@/lib/whatsappUnifiedIntelligenceV4';`,
  `import { buildUnifiedConversationIntelligence, summarizePortfolio, verifySessionAgainstInvoices } from '@/lib/whatsappUnifiedIntelligenceV4';`
);

patch(
  'invoice persistence import',
  `import { persistAnalyzedWhatsAppSession } from '@/lib/whatsappReviewPersistenceV4';`,
  `import { persistAnalyzedWhatsAppSession, attachInvoiceVerificationToQueue } from '@/lib/whatsappReviewPersistenceV4';`
);

patch(
  'auto invoice verification after queue persist',
  `          });\n          if (persisted.duplicate) result.duplicates += 1;`,
  `          });\n          if (!persisted.duplicate && intelligence.commercialEligible && resolvedCustomer.customer) {\n            try {\n              const verification = await verifySessionAgainstInvoices(item.session, {\n                customerId: resolvedCustomer.customer.id || null,\n                customerCode: resolvedCustomer.customer.code || null,\n                customerPhone: resolvedCustomer.customer.phone || null,\n                customerName: resolvedCustomer.customer.name || visibleCustomer,\n                branch: importBranch,\n              });\n              await attachInvoiceVerificationToQueue(\n                persisted.id,\n                verification,\n                String(user?.id || user?.staffId || ''),\n                String(user?.name || user?.username || '')\n              );\n            } catch (invoiceError) {\n              console.warn('[whatsapp-review-v4] automatic invoice verification failed; queue item preserved for retry', persisted.id, invoiceError);\n            }\n          }\n          if (persisted.duplicate) result.duplicates += 1;`
);

patch(
  'automatic invoice copy',
  `الحفظ أصبح تلقائيًا بعد كل Export. البصمة تمنع التكرار، وجلسات المتابعة الصادرة فقط تُستبعد من التقييم الرسمي، ولا يتم إنشاء نقاط أو خصومات قبل الاعتماد البشري.`,
  `الحفظ ومطابقة الفاتورة أصبحا تلقائيين بعد كل Export. البصمة تمنع التكرار، وجلسات المتابعة الصادرة فقط تُستبعد من التقييم الرسمي، ولا يتم إنشاء نقاط أو خصومات قبل الاعتماد البشري.`
);

fs.writeFileSync(file, src);
console.log('[whatsapp-auto-invoice-v4] automatic invoice verification applied successfully');
