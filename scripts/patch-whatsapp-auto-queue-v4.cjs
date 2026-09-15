const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/WhatsAppConversationAnalyzer.tsx');
let src = fs.readFileSync(file, 'utf8');

function patch(label, from, to) {
  if (src.includes(to)) {
    console.log(`[whatsapp-auto-queue-v4] ${label}: already applied`);
    return;
  }
  if (!src.includes(from)) throw new Error(`[whatsapp-auto-queue-v4] ${label}: anchor not found`);
  src = src.replace(from, to);
  console.log(`[whatsapp-auto-queue-v4] ${label}: applied`);
}

patch(
  'parameterize queue persistence',
  `  const saveCurrentExportToQueue = async () => {\n    if (!sessions.length) return;\n    if (!importBranch) {\n      toast.error('اختار الفرع قبل حفظ الجلسات في قائمة المراجعة');\n      return;\n    }`,
  `  const saveCurrentExportToQueue = async (options?: {\n    items?: typeof smartSessions;\n    sourceName?: string | null;\n    innerName?: string | null;\n    silent?: boolean;\n  }): Promise<boolean> => {\n    const queueItems = options?.items || smartSessions;\n    if (!queueItems.length) return false;\n    if (!importBranch) {\n      if (!options?.silent) toast.error('اختار الفرع مرة واحدة على هذا الجهاز قبل تشغيل الالتقاط التلقائي');\n      return false;\n    }`
);

patch(
  'persist supplied queue items',
  `      for (const item of smartSessions) {`,
  `      for (const item of queueItems) {`
);

patch(
  'persist supplied source metadata',
  `            sourceFileName: sourceFileName || fileName || null,\n            branch: importBranch,`,
  `            sourceFileName: options?.sourceName || sourceFileName || fileName || null,\n            innerFileName: options?.innerName || null,\n            branch: importBranch,`
);

patch(
  'silence background queue toasts and return status',
  `      setQueueResult(result);\n      if (result.failed) {\n        toast.warning(\`تم حفظ \${result.inserted} جلسة، \${result.duplicates} مكررة، وتعذر حفظ \${result.failed}\`);\n      } else {\n        toast.success(\`تم تجهيز قائمة المراجعة: \${result.inserted} جديدة، \${result.duplicates} مكررة\`);\n      }\n    } finally {\n      setQueueSaving(false);\n    }\n  };`,
  `      setQueueResult(result);\n      if (!options?.silent) {\n        if (result.failed) {\n          toast.warning(\`تم حفظ \${result.inserted} جلسة، \${result.duplicates} مكررة، وتعذر حفظ \${result.failed}\`);\n        } else {\n          toast.success(\`تم تجهيز قائمة المراجعة: \${result.inserted} جديدة، \${result.duplicates} مكررة\`);\n        }\n      }\n      return result.failed === 0;\n    } finally {\n      setQueueSaving(false);\n    }\n  };`
);

patch(
  'auto queue after parsing',
  `      setSelectedId(built.preferredSessionId || '');\n      toast.success(\`تم تحليل \${messages.length} رسالة وتقسيمها إلى \${parsedSessions.length} جلسة\`);\n      return true;`,
  `      setSelectedId(built.preferredSessionId || '');\n      const queued = await saveCurrentExportToQueue({\n        items: built.sessions,\n        sourceName: source.sourceFileName,\n        innerName: source.innerFileName || null,\n        silent: true,\n      });\n      if (!queued) {\n        if (!importBranch) toast.warning('تم تحليل الملف، لكن اختر فرع هذا الجهاز مرة واحدة ليبدأ الحفظ التلقائي في Queue');\n        else toast.warning('تم تحليل الملف لكن لم يكتمل حفظه في Queue؛ سيُعاد التقاطه تلقائيًا بدل اعتباره مكتملًا');\n        return false;\n      }\n      toast.success(\`تم تحليل \${messages.length} رسالة وتقسيمها إلى \${parsedSessions.length} جلسة وحفظها تلقائيًا في Queue\`);\n      return true;`
);

patch(
  'automatic mode copy',
  `الحفظ يمنع التكرار بالبصمة. جلسات المتابعة الصادرة فقط تُستبعد من التقييم الرسمي، ولا يتم إنشاء نقاط أو خصومات تلقائيًا.`,
  `الحفظ أصبح تلقائيًا بعد كل Export. البصمة تمنع التكرار، وجلسات المتابعة الصادرة فقط تُستبعد من التقييم الرسمي، ولا يتم إنشاء نقاط أو خصومات قبل الاعتماد البشري.`
);

patch(
  'manual button becomes retry action',
  `{queueSaving ? 'جاري تجهيز القائمة...' : 'حفظ الجلسات في Queue'}`,
  `{queueSaving ? 'جاري تجهيز القائمة...' : 'إعادة حفظ/فحص Queue'}`
);

fs.writeFileSync(file, src);
console.log('[whatsapp-auto-queue-v4] automatic export-to-queue flow applied successfully');
