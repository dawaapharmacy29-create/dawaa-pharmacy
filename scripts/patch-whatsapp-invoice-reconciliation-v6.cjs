const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/lib/invoiceImporter.ts');
let src = fs.readFileSync(file, 'utf8');
const from = `  await persistInvoiceImportBatch(summary, 'imported');\n  return summary;`;
const to = `  // WhatsApp Operational V6: أي ملف فواتير جديد يعيد فحص المحادثات التجارية المعلقة\n  // لأن الفاتورة قد تُرفع بعد المحادثة بساعات أو في اليوم التالي. التطابق هنا محافظ:\n  // لا يُحسب البيع مؤكدًا إلا عند وجود مرشح وحيد لنفس العميل/الفرع أو رقم فاتورة مذكور صراحة.\n  if (summary.fileMinDate && summary.fileMaxDate) {\n    try {\n      const { data: whatsappReconcile, error: whatsappReconcileError } = await supabase.rpc(\n        'dawaa_reconcile_whatsapp_sales_after_invoice_import_v1',\n        { p_start_date: summary.fileMinDate, p_end_date: summary.fileMaxDate, p_branch: branch || null }\n      );\n      if (whatsappReconcileError) {\n        summary.schemaWarnings?.push(\`تم حفظ الفواتير، وتعذر تحديث تطابق محادثات واتساب تلقائيًا: \${whatsappReconcileError.message}\`);\n      } else {\n        const result = (whatsappReconcile || {}) as Record<string, unknown>;\n        const verified = Number(result.verified || 0);\n        const probable = Number(result.probable || 0);\n        if (verified || probable) {\n          summary.schemaWarnings?.push(\`WhatsApp Review: تم تأكيد \${verified} عملية بيع من الفواتير الجديدة، و\${probable} حالة بقيت مرجحة للمراجعة.\`);\n        }\n      }\n    } catch (error) {\n      summary.schemaWarnings?.push(\`تم حفظ الفواتير، وتعذر تشغيل مطابقة واتساب اللاحقة: \${error instanceof Error ? error.message : String(error)}\`);\n    }\n  }\n\n  await persistInvoiceImportBatch(summary, 'imported');\n  return summary;`;
if (src.includes(to)) console.log('[whatsapp-invoice-reconciliation-v6] already applied');
else {
  if (!src.includes(from)) throw new Error('[whatsapp-invoice-reconciliation-v6] import completion anchor not found');
  src = src.replace(from, to);
  fs.writeFileSync(file, src);
  console.log('[whatsapp-invoice-reconciliation-v6] post-import WhatsApp reconciliation applied');
}
