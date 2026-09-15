const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/WhatsAppConversationAnalyzer.tsx');
let src = fs.readFileSync(file, 'utf8');

function patch(label, from, to) {
  if (src.includes(to)) {
    console.log(`[whatsapp-local-inbox-v1] ${label}: already applied`);
    return;
  }
  if (!src.includes(from)) throw new Error(`[whatsapp-local-inbox-v1] ${label}: anchor not found`);
  src = src.replace(from, to);
  console.log(`[whatsapp-local-inbox-v1] ${label}: applied`);
}

patch(
  'react hooks',
  `import { useMemo, useState } from 'react';`,
  `import { useEffect, useMemo, useRef, useState } from 'react';`
);

patch(
  'folder icons',
  `  FileArchive,\n  Gauge,`,
  `  FileArchive,\n  FolderOpen,\n  Gauge,\n  RefreshCw,`
);

patch(
  'local inbox import',
  `import { readWhatsAppExportFile } from '@/lib/whatsappExportFileReader';`,
  `import { readWhatsAppExportFile } from '@/lib/whatsappExportFileReader';\nimport {\n  connectLocalWhatsAppFolder,\n  getNewestUnprocessedWhatsAppExport,\n  markLocalWhatsAppFileProcessed,\n  queryLocalWhatsAppFolderPermission,\n  restoreLocalWhatsAppFolder,\n  supportsLocalWhatsAppInbox,\n} from '@/lib/localWhatsAppInbox';`
);

patch(
  'local inbox state',
  `  const [loading, setLoading] = useState(false);`,
  `  const [loading, setLoading] = useState(false);\n  const [localFolderName, setLocalFolderName] = useState('');\n  const [localInboxConnected, setLocalInboxConnected] = useState(false);\n  const [localAutoWatch, setLocalAutoWatch] = useState(true);\n  const [localScanning, setLocalScanning] = useState(false);\n  const [lastLocalImportAt, setLastLocalImportAt] = useState<Date | null>(null);\n  const localScanLock = useRef(false);`
);

patch(
  'handle file return status',
  `  const handleFile = async (file?: File | null) => {\n    if (!file) return;`,
  `  const handleFile = async (file?: File | null): Promise<boolean> => {\n    if (!file) return false;`
);

patch(
  'handle file success return',
  `      toast.success(\`تم تحليل \${messages.length} رسالة وتقسيمها إلى \${parsedSessions.length} جلسة\`);\n    } catch (error) {`,
  `      toast.success(\`تم تحليل \${messages.length} رسالة وتقسيمها إلى \${parsedSessions.length} جلسة\`);\n      return true;\n    } catch (error) {`
);

patch(
  'handle file error return',
  `      toast.error(error instanceof Error ? error.message : 'تعذر قراءة ملف المحادثة');\n    } finally {`,
  `      toast.error(error instanceof Error ? error.message : 'تعذر قراءة ملف المحادثة');\n      return false;\n    } finally {`
);

const localInboxLogic = `\n  const scanLocalInbox = async (silent = false) => {\n    if (localScanLock.current) return;\n    localScanLock.current = true;\n    setLocalScanning(true);\n    try {\n      const handle = await restoreLocalWhatsAppFolder();\n      if (!handle) {\n        setLocalInboxConnected(false);\n        if (!silent) toast.error('اختار فولدر محادثات واتساب أولاً');\n        return;\n      }\n      setLocalFolderName(String(handle.name || 'WhatsApp Exports'));\n      const permission = await queryLocalWhatsAppFolderPermission(handle, false);\n      if (permission !== 'granted') {\n        setLocalInboxConnected(false);\n        if (!silent) toast.error('الفولدر محفوظ، لكن محتاج إعادة السماح بالقراءة من المتصفح');\n        return;\n      }\n      setLocalInboxConnected(true);\n      const candidate = await getNewestUnprocessedWhatsAppExport(handle);\n      if (!candidate) {\n        if (!silent) toast.info('لا يوجد Export جديد غير مُعالج في الفولدر');\n        return;\n      }\n      const imported = await handleFile(candidate.file);\n      if (imported) {\n        markLocalWhatsAppFileProcessed(candidate.key);\n        setLastLocalImportAt(new Date());\n        if (!silent) toast.success(\`تم التقاط \${candidate.name} تلقائيًا من الفولدر\`);\n      }\n    } catch (error) {\n      if (!silent) toast.error(error instanceof Error ? error.message : 'تعذر فحص فولدر المحادثات');\n    } finally {\n      setLocalScanning(false);\n      localScanLock.current = false;\n    }\n  };\n\n  const connectLocalInbox = async () => {\n    try {\n      const handle = await connectLocalWhatsAppFolder();\n      setLocalFolderName(String(handle.name || 'WhatsApp Exports'));\n      setLocalInboxConnected(true);\n      setLocalAutoWatch(true);\n      toast.success('تم ربط فولدر محادثات واتساب بهذا الجهاز');\n      void scanLocalInbox(true);\n    } catch (error) {\n      const message = error instanceof Error ? error.message : 'تعذر ربط الفولدر';\n      if (!/abort/i.test(message)) toast.error(message);\n    }\n  };\n\n  useEffect(() => {\n    if (!supportsLocalWhatsAppInbox()) return;\n    void (async () => {\n      try {\n        const handle = await restoreLocalWhatsAppFolder();\n        if (!handle) return;\n        setLocalFolderName(String(handle.name || 'WhatsApp Exports'));\n        const permission = await queryLocalWhatsAppFolderPermission(handle, false);\n        setLocalInboxConnected(permission === 'granted');\n      } catch {\n        setLocalInboxConnected(false);\n      }\n    })();\n  }, []);\n\n  useEffect(() => {\n    if (!localInboxConnected || !localAutoWatch) return;\n    const run = () => { if (!document.hidden) void scanLocalInbox(true); };\n    run();\n    const timer = window.setInterval(run, 5000);\n    const onVisibility = () => { if (!document.hidden) run(); };\n    document.addEventListener('visibilitychange', onVisibility);\n    return () => {\n      window.clearInterval(timer);\n      document.removeEventListener('visibilitychange', onVisibility);\n    };\n    // scanLocalInbox intentionally excluded: polling is guarded by localScanLock.\n    // eslint-disable-next-line react-hooks/exhaustive-deps\n  }, [localInboxConnected, localAutoWatch]);\n`;

patch(
  'local inbox logic',
  `\n  return (\n    <div dir="rtl" className="space-y-5">`,
  localInboxLogic + `\n  return (\n    <div dir="rtl" className="space-y-5">`
);

const localInboxUi = `\n          <div className="flex flex-wrap items-center justify-end gap-2">\n            {supportsLocalWhatsAppInbox() ? (\n              <>\n                <button\n                  type="button"\n                  onClick={() => void connectLocalInbox()}\n                  className={\`flex items-center justify-center gap-2 rounded-xl border px-4 py-3 font-black transition \${localInboxConnected ? 'border-emerald-400/35 bg-emerald-500/10 text-emerald-100' : 'border-violet-400/35 bg-violet-500/10 text-violet-100 hover:bg-violet-500/15'}\`}\n                >\n                  <FolderOpen size={18} /> {localInboxConnected ? \`الفولدر مربوط: \${localFolderName}\` : localFolderName ? 'إعادة السماح للفولدر' : 'ربط فولدر المحادثات'}\n                </button>\n                <button\n                  type="button"\n                  disabled={!localInboxConnected || localScanning || loading}\n                  onClick={() => void scanLocalInbox(false)}\n                  className="flex items-center justify-center gap-2 rounded-xl border border-slate-600 bg-slate-900/70 px-4 py-3 font-black text-slate-100 disabled:cursor-not-allowed disabled:opacity-40"\n                >\n                  <RefreshCw size={17} className={localScanning ? 'animate-spin' : ''} /> فحص الآن\n                </button>\n                <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-700 bg-slate-950/50 px-3 py-2 text-xs font-black text-slate-200">\n                  <input\n                    type="checkbox"\n                    checked={localAutoWatch}\n                    disabled={!localInboxConnected}\n                    onChange={(event) => setLocalAutoWatch(event.target.checked)}\n                  />\n                  التقاط تلقائي كل 5 ثوانٍ\n                </label>\n              </>\n            ) : null}\n`;

patch(
  'local inbox ui before upload',
  `          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-cyan-400/35 bg-cyan-500/10 px-5 py-3 font-black text-cyan-100 hover:bg-cyan-500/15">`,
  localInboxUi + `            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-cyan-400/35 bg-cyan-500/10 px-5 py-3 font-black text-cyan-100 hover:bg-cyan-500/15">`
);

patch(
  'close local inbox actions wrapper',
  `            />\n          </label>\n        </div>`,
  `            />\n            </label>\n          </div>\n        </div>`
);

patch(
  'local inbox status',
  `        {fileName ? (\n          <div className="mt-4 flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950/50 px-3 py-2 text-xs text-slate-300">`,
  `        {localFolderName ? (\n          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-violet-400/20 bg-violet-500/5 px-3 py-2 text-xs text-slate-300">\n            <span className={localInboxConnected ? 'font-black text-emerald-200' : 'font-black text-amber-200'}>{localInboxConnected ? 'Local Inbox متصل' : 'Local Inbox يحتاج سماح'}</span>\n            <span>• {localFolderName}</span>\n            <span>• {localAutoWatch ? 'المراقبة التلقائية مفعلة' : 'المراقبة التلقائية متوقفة'}</span>\n            {lastLocalImportAt ? <span>• آخر التقاط {formatDate(lastLocalImportAt)}</span> : null}\n          </div>\n        ) : null}\n        {fileName ? (\n          <div className="mt-4 flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950/50 px-3 py-2 text-xs text-slate-300">`
);

fs.writeFileSync(file, src);
console.log('[whatsapp-local-inbox-v1] local folder ingestion applied successfully');
