const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/WhatsAppReviewQueueV4.tsx');
let src = fs.readFileSync(file, 'utf8');

function patch(label, from, to) {
  if (src.includes(to)) {
    console.log(`[whatsapp-queue-invoice-v4] ${label}: already applied`);
    return;
  }
  if (!src.includes(from)) throw new Error(`[whatsapp-queue-invoice-v4] ${label}: anchor not found`);
  src = src.replace(from, to);
  console.log(`[whatsapp-queue-invoice-v4] ${label}: applied`);
}

patch(
  'invoice verification imports',
  `import { useAuth } from '@/hooks/useAuth';`,
  `import { useAuth } from '@/hooks/useAuth';\nimport { parseWhatsAppExport, splitWhatsAppSessions } from '@/lib/whatsappConversationParser';\nimport { verifySessionAgainstInvoices } from '@/lib/whatsappUnifiedIntelligenceV4';\nimport { attachInvoiceVerificationToQueue } from '@/lib/whatsappReviewPersistenceV4';`
);

patch(
  'invoice verification state',
  `  const [priority, setPriority] = useState('all');`,
  `  const [priority, setPriority] = useState('all');\n  const [invoiceVerifying, setInvoiceVerifying] = useState(false);`
);

const logic = `\n  const verifySelectedInvoice = async () => {\n    if (!selected) return;\n    if (!selected.raw_text) {\n      toast.error('النص الأصلي للجلسة غير متاح، لا يمكن مطابقة الفاتورة');\n      return;\n    }\n    if (!(selected.customer_code || selected.customer_phone || selected.customer_name)) {\n      toast.error('محتاجين هوية عميل (كود أو هاتف أو اسم) قبل مطابقة الفاتورة');\n      return;\n    }\n    setInvoiceVerifying(true);\n    try {\n      const messages = parseWhatsAppExport(selected.raw_text);\n      const sessions = splitWhatsAppSessions(messages, 120);\n      const session = sessions[0];\n      if (!session) throw new Error('تعذر إعادة بناء الجلسة من النص الأصلي');\n      const verification = await verifySessionAgainstInvoices(session, {\n        customerCode: selected.customer_code,\n        customerPhone: selected.customer_phone,\n        customerName: selected.customer_name,\n        branch: selected.branch,\n      });\n      await attachInvoiceVerificationToQueue(\n        selected.id,\n        verification,\n        String(user?.id || user?.staffId || ''),\n        String(user?.name || user?.username || '')\n      );\n      await load();\n      const labels = { verified: 'تم تأكيد الفاتورة', probable: 'تم العثور على فاتورة مرجحة وتحتاج مراجعة', not_found: 'لم توجد فاتورة مرتبطة بقوة كافية', needs_review: 'المطابقة تحتاج مراجعة بشرية', not_applicable: 'الجلسة ليست فرصة بيع مؤهلة' };\n      const message = labels[verification.status] || verification.reason;\n      verification.status === 'verified' ? toast.success(message) : toast.info(message);\n    } catch (error) {\n      toast.error(error instanceof Error ? error.message : 'تعذر مطابقة الفاتورة');\n    } finally {\n      setInvoiceVerifying(false);\n    }\n  };\n`;

patch(
  'invoice verification logic',
  `\n  return (\n    <div dir="rtl" className="space-y-5">`,
  logic + `\n  return (\n    <div dir="rtl" className="space-y-5">`
);

const action = `\n              <div className="mt-4 flex flex-wrap items-center gap-2">\n                <button\n                  type="button"\n                  disabled={invoiceVerifying || selected.invoice_match_status === 'verified'}\n                  onClick={() => void verifySelectedInvoice()}\n                  className="rounded-xl border border-cyan-400/30 bg-cyan-500/10 px-4 py-2.5 text-sm font-black text-cyan-100 transition hover:bg-cyan-500/15 disabled:cursor-not-allowed disabled:opacity-45"\n                >\n                  {invoiceVerifying ? 'جاري مطابقة الفاتورة...' : selected.invoice_match_status === 'verified' ? 'الفاتورة مؤكدة ✓' : 'مطابقة الفاتورة الآن'}\n                </button>\n                {selected.invoice_match_confidence != null ? <span className="text-xs text-slate-400">ثقة المطابقة: <b className="text-cyan-200">{Math.round(Number(selected.invoice_match_confidence) * 100)}%</b></span> : null}\n                {selected.matched_invoice_number ? <span className="text-xs text-slate-400">رقم الفاتورة: <b className="text-white">{selected.matched_invoice_number}</b></span> : null}\n              </div>\n`;

patch(
  'invoice action under metrics',
  `            </section>\n\n            <section className="dawaa-card dawaa-card--soft p-4"><div className="font-black text-white">ملخص القرار</div>`,
  action + `            </section>\n\n            <section className="dawaa-card dawaa-card--soft p-4"><div className="font-black text-white">ملخص القرار</div>`
);

fs.writeFileSync(file, src);
console.log('[whatsapp-queue-invoice-v4] invoice verification action applied successfully');