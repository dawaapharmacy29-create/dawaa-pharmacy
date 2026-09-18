const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/WhatsAppConversationAnalyzer.tsx');
let src = fs.readFileSync(file, 'utf8');

function patch(label, from, to) {
  if (src.includes(to)) {
    console.log(`[whatsapp-local-inbox-batch-v4] ${label}: already applied`);
    return;
  }
  if (!src.includes(from)) throw new Error(`[whatsapp-local-inbox-batch-v4] ${label}: anchor not found`);
  src = src.replace(from, to);
  console.log(`[whatsapp-local-inbox-batch-v4] ${label}: applied`);
}

patch(
  'batch inbox imports',
  `  getNewestUnprocessedWhatsAppExport,\n  markLocalWhatsAppFileProcessed,`,
  `  getUnprocessedWhatsAppExports,\n  markLocalWhatsAppFileFailed,\n  markLocalWhatsAppFileProcessed,`
);

patch(
  'scan only after branch configured',
  `      setLocalInboxConnected(true);\n      const candidate = await getNewestUnprocessedWhatsAppExport(handle);\n      if (!candidate) {\n        if (!silent) toast.info('لا يوجد Export جديد غير مُعالج في الفولدر');\n        return;\n      }\n      const imported = await handleFile(candidate.file);\n      if (imported) {\n        markLocalWhatsAppFileProcessed(candidate.key);\n        setLastLocalImportAt(new Date());\n        if (!silent) toast.success(\`تم التقاط \${candidate.name} تلقائيًا من الفولدر\`);\n      }`,
  `      setLocalInboxConnected(true);\n      if (!importBranch) {\n        if (!silent) toast.info('حدد فرع هذا الجهاز مرة واحدة قبل بدء الالتقاط التلقائي');\n        return;\n      }\n      const candidates = await getUnprocessedWhatsAppExports(handle, 5);\n      if (!candidates.length) {\n        if (!silent) toast.info('لا يوجد Export جديد غير مُعالج في الفولدر');\n        return;\n      }\n      let importedCount = 0;\n      let failedCount = 0;\n      for (const candidate of candidates) {\n        try {\n          const imported = await handleFile(candidate.file);\n          if (imported) {\n            markLocalWhatsAppFileProcessed(candidate.key);\n            importedCount += 1;\n            setLastLocalImportAt(new Date());\n          } else {\n            markLocalWhatsAppFileFailed(candidate.key, 'لم يكتمل التحليل أو الحفظ في Queue');\n            failedCount += 1;\n          }\n        } catch (candidateError) {\n          markLocalWhatsAppFileFailed(candidate.key, candidateError instanceof Error ? candidateError.message : 'تعذر معالجة الملف');\n          failedCount += 1;\n        }\n      }\n      if (!silent) {\n        if (failedCount) toast.warning(\`تم التقاط \${importedCount} ملف، و\${failedCount} ملف يحتاج إعادة محاولة تلقائية\`);\n        else toast.success(\`تم التقاط ومعالجة \${importedCount} Export تلقائيًا\`);\n      }`
);

patch(
  'keep monitoring in background tab',
  `    const run = () => { if (!document.hidden) void scanLocalInbox(true); };\n    run();\n    const timer = window.setInterval(run, 5000);\n    const onVisibility = () => { if (!document.hidden) run(); };\n    document.addEventListener('visibilitychange', onVisibility);\n    return () => {\n      window.clearInterval(timer);\n      document.removeEventListener('visibilitychange', onVisibility);\n    };`,
  `    const run = () => { void scanLocalInbox(true); };\n    run();\n    const timer = window.setInterval(run, 5000);\n    const onVisibility = () => { if (!document.hidden) run(); };\n    document.addEventListener('visibilitychange', onVisibility);\n    return () => {\n      window.clearInterval(timer);\n      document.removeEventListener('visibilitychange', onVisibility);\n    };`
);

patch(
  'batch monitoring status copy',
  `{localAutoWatch ? 'المراقبة التلقائية مفعلة' : 'المراقبة التلقائية متوقفة'}`,
  `{localAutoWatch ? 'مراقبة تلقائية كل 5 ثوانٍ • حتى 5 ملفات في الدورة' : 'المراقبة التلقائية متوقفة'}`
);

fs.writeFileSync(file, src);
console.log('[whatsapp-local-inbox-batch-v4] resilient batch folder monitoring applied successfully');
