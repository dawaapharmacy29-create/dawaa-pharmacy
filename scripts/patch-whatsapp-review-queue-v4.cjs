const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/WhatsAppConversationAnalyzer.tsx');
let src = fs.readFileSync(file, 'utf8');

function patch(label, from, to) {
  if (src.includes(to)) {
    console.log(`[whatsapp-queue-v4] ${label}: already applied`);
    return;
  }
  if (!src.includes(from)) throw new Error(`[whatsapp-queue-v4] ${label}: anchor not found`);
  src = src.replace(from, to);
  console.log(`[whatsapp-queue-v4] ${label}: applied`);
}

patch(
  'queue imports',
  `import { buildUnifiedConversationIntelligence, summarizePortfolio } from '@/lib/whatsappUnifiedIntelligenceV4';`,
  `import { buildUnifiedConversationIntelligence, summarizePortfolio } from '@/lib/whatsappUnifiedIntelligenceV4';\nimport { persistAnalyzedWhatsAppSession } from '@/lib/whatsappReviewPersistenceV4';\nimport { useAuth } from '@/hooks/useAuth';`
);

patch(
  'auth and queue state',
  `export default function WhatsAppConversationAnalyzer() {\n  const [fileName, setFileName] = useState('');`,
  `export default function WhatsAppConversationAnalyzer() {\n  const { user } = useAuth();\n  const [fileName, setFileName] = useState('');`
);

patch(
  'queue state fields',
  `  const [lastLocalImportAt, setLastLocalImportAt] = useState<Date | null>(null);\n  const localScanLock = useRef(false);`,
  `  const [lastLocalImportAt, setLastLocalImportAt] = useState<Date | null>(null);\n  const localScanLock = useRef(false);\n  const [importBranch, setImportBranch] = useState(() => localStorage.getItem('dawaa.whatsappReview.branch') || '');\n  const [queueSaving, setQueueSaving] = useState(false);\n  const [queueResult, setQueueResult] = useState<{ inserted: number; duplicates: number; excluded: number; failed: number } | null>(null);`
);

const logic = `\n  const saveCurrentExportToQueue = async () => {\n    if (!sessions.length) return;\n    if (!importBranch) {\n      toast.error('اختار الفرع قبل حفظ الجلسات في قائمة المراجعة');\n      return;\n    }\n    setQueueSaving(true);\n    const result = { inserted: 0, duplicates: 0, excluded: 0, failed: 0 };\n    try {\n      localStorage.setItem('dawaa.whatsappReview.branch', importBranch);\n      for (const item of smartSessions) {\n        // Outbound-only pharmacy follow-ups are useful operationally but are not scored as customer conversations.\n        if (item.kind === 'pharmacy_followup') {\n          result.excluded += 1;\n          continue;\n        }\n        try {\n          const intelligence = buildUnifiedConversationIntelligence(item.session);\n          const persisted = await persistAnalyzedWhatsAppSession(item.session, intelligence, {\n            sourceFileName: sourceFileName || fileName || null,\n            branch: importBranch,\n            customerName: item.customerName || item.session.customerName || null,\n            staffName: item.session.outboundStaffNames[0] || null,\n            createdBy: String(user?.name || user?.username || user?.id || ''),\n          });\n          if (persisted.duplicate) result.duplicates += 1;\n          else result.inserted += 1;\n        } catch (error) {\n          console.error('[whatsapp-review-v4] queue persist failed', item.session.id, error);\n          result.failed += 1;\n        }\n      }\n      setQueueResult(result);\n      if (result.failed) {\n        toast.warning(\`تم حفظ \${result.inserted} جلسة، \${result.duplicates} مكررة، وتعذر حفظ \${result.failed}\`);\n      } else {\n        toast.success(\`تم تجهيز قائمة المراجعة: \${result.inserted} جديدة، \${result.duplicates} مكررة\`);\n      }\n    } finally {\n      setQueueSaving(false);\n    }\n  };\n`;

patch(
  'queue save logic',
  `\n  return (\n    <div dir="rtl" className="space-y-5">`,
  logic + `\n  return (\n    <div dir="rtl" className="space-y-5">`
);

const queuePanel = `\n        {sessions.length ? (\n          <div className="mt-4 rounded-2xl border border-violet-400/25 bg-violet-500/5 p-4">\n            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">\n              <div>\n                <div className="font-black text-violet-100">إرسال الجلسات إلى قائمة المراجعة V4</div>\n                <div className="mt-1 text-xs leading-6 text-slate-400">الحفظ يمنع التكرار بالبصمة. جلسات المتابعة الصادرة فقط تُستبعد من التقييم الرسمي، ولا يتم إنشاء نقاط أو خصومات تلقائيًا.</div>\n              </div>\n              <div className="flex flex-wrap items-center gap-2">\n                <select\n                  value={importBranch}\n                  onChange={(event) => { setImportBranch(event.target.value); setQueueResult(null); }}\n                  className="min-w-[170px] rounded-xl border border-slate-600 bg-slate-950 px-3 py-2.5 text-sm font-black text-white"\n                >\n                  <option value="">اختار الفرع</option>\n                  <option value="فرع الشامي">فرع الشامي</option>\n                  <option value="فرع شكري">فرع شكري</option>\n                </select>\n                <button\n                  type="button"\n                  disabled={queueSaving || !importBranch}\n                  onClick={() => void saveCurrentExportToQueue()}\n                  className="rounded-xl border border-violet-400/35 bg-violet-500/15 px-4 py-2.5 text-sm font-black text-violet-100 transition hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-40"\n                >\n                  {queueSaving ? 'جاري تجهيز القائمة...' : 'حفظ الجلسات في Queue'}\n                </button>\n              </div>\n            </div>\n            {queueResult ? (\n              <div className="mt-3 grid gap-2 sm:grid-cols-4">\n                <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/8 p-2 text-center text-xs text-emerald-100"><b className="text-lg">{queueResult.inserted}</b><br/>جديدة</div>\n                <div className="rounded-xl border border-cyan-400/20 bg-cyan-500/8 p-2 text-center text-xs text-cyan-100"><b className="text-lg">{queueResult.duplicates}</b><br/>مكررة تم منعها</div>\n                <div className="rounded-xl border border-slate-600 bg-slate-900/60 p-2 text-center text-xs text-slate-300"><b className="text-lg">{queueResult.excluded}</b><br/>متابعات صادرة مستبعدة</div>\n                <div className="rounded-xl border border-rose-400/20 bg-rose-500/8 p-2 text-center text-xs text-rose-100"><b className="text-lg">{queueResult.failed}</b><br/>فشل</div>\n              </div>\n            ) : null}\n          </div>\n        ) : null}\n`;

patch(
  'queue controls below file status',
  `        {fileName ? (\n          <div className="mt-4 flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950/50 px-3 py-2 text-xs text-slate-300">\n            <FileArchive size={15} />{fileName}\n          </div>\n        ) : null}\n      </section>`,
  `        {fileName ? (\n          <div className="mt-4 flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950/50 px-3 py-2 text-xs text-slate-300">\n            <FileArchive size={15} />{fileName}\n          </div>\n        ) : null}` + queuePanel + `      </section>`
);

fs.writeFileSync(file, src);
console.log('[whatsapp-queue-v4] batch queue persistence UI applied successfully');
