const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/WhatsAppConversationAnalyzer.tsx');
let src = fs.readFileSync(file, 'utf8');

function replaceOnce(label, from, to) {
  if (src.includes(to)) {
    console.log(`[whatsapp-analysis-scope] ${label}: already applied`);
    return;
  }
  if (!src.includes(from)) throw new Error(`[whatsapp-analysis-scope] ${label}: anchor not found`);
  src = src.replace(from, to);
  console.log(`[whatsapp-analysis-scope] ${label}: applied`);
}

const importLine = `import { applyWhatsAppAnalysisScope, collectDetectedDoctors, toLocalDateTimeInput } from '@/lib/whatsappAnalysisScope';`;
if (!src.includes(importLine)) {
  const anchor = `import { readWhatsAppExportFile } from '@/lib/whatsappExportFileReader';`;
  if (!src.includes(anchor)) throw new Error('[whatsapp-analysis-scope] import anchor not found');
  src = src.replace(anchor, `${anchor}\n${importLine}`);
  console.log('[whatsapp-analysis-scope] scope import: applied');
}

replaceOnce(
  'scope state',
  `  const [loading, setLoading] = useState(false);`,
  `  const [loading, setLoading] = useState(false);\n  const [scopeDoctor, setScopeDoctor] = useState('');\n  const [scopeFrom, setScopeFrom] = useState('');\n  const [scopeTo, setScopeTo] = useState('');\n  const [scopeEnabled, setScopeEnabled] = useState(false);`
);

replaceOnce(
  'scope model before smart sessions',
  `  const smartModel = useMemo(\n    () => buildSmartSessions(sessions, sourceFileName || fileName),\n    [sessions, sourceFileName, fileName]\n  );`,
  `  const detectedDoctors = useMemo(() => collectDetectedDoctors(sessions), [sessions]);\n  const scopePreview = useMemo(() => applyWhatsAppAnalysisScope(sessions, {\n    doctor: scopeDoctor || null,\n    from: scopeFrom ? new Date(scopeFrom) : null,\n    to: scopeTo ? new Date(scopeTo) : null,\n  }), [sessions, scopeDoctor, scopeFrom, scopeTo]);\n  const effectiveSessions = scopeEnabled ? scopePreview.sessions : sessions;\n  const smartModel = useMemo(\n    () => buildSmartSessions(effectiveSessions, sourceFileName || fileName),\n    [effectiveSessions, sourceFileName, fileName]\n  );`
);

replaceOnce(
  'reset and default scope on upload',
  `      setSessions(parsedSessions);\n      setSelectedId(built.preferredSessionId || '');`,
  `      setSessions(parsedSessions);\n      setSelectedId(built.preferredSessionId || '');\n      setScopeDoctor('');\n      setScopeEnabled(false);\n      setScopeFrom(toLocalDateTimeInput(messages[0]?.timestamp));\n      setScopeTo(toLocalDateTimeInput(messages[messages.length - 1]?.timestamp));`
);

const scopeUi = `      {sessions.length ? (\n        <section className="dawaa-card dawaa-card--raised p-4">\n          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">\n            <div>\n              <div className="font-black text-white">نطاق التحليل</div>\n              <div className="mt-1 text-xs leading-6 text-slate-400">حدد الدكتور والفترة المطلوبة. التقييم والتحليل يستخدمان الرسائل داخل النطاق فقط، ولا يتم احتساب الرسائل خارجه.</div>\n            </div>\n            {scopeEnabled ? <span className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-xs font-black text-emerald-200">النطاق مفعل</span> : null}\n          </div>\n          <div className="grid gap-3 lg:grid-cols-3">\n            <label className="text-xs text-slate-300">\n              الدكتور\n              <select value={scopeDoctor} onChange={(event) => setScopeDoctor(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white">\n                <option value="">كل الدكاترة</option>\n                {detectedDoctors.map((name) => <option key={name} value={name}>{name}</option>)}\n              </select>\n            </label>\n            <label className="text-xs text-slate-300">\n              من\n              <input type="datetime-local" value={scopeFrom} onChange={(event) => setScopeFrom(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white" />\n            </label>\n            <label className="text-xs text-slate-300">\n              إلى\n              <input type="datetime-local" value={scopeTo} onChange={(event) => setScopeTo(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white" />\n            </label>\n          </div>\n          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-700 bg-slate-950/45 p-3 text-xs text-slate-300">\n            <div>سيتم تحليل <b className="text-cyan-200">{scopePreview.scopedMessageCount}</b> رسالة من أصل <b className="text-white">{scopePreview.originalMessageCount}</b> داخل <b className="text-emerald-200">{scopePreview.matchedSessionCount}</b> جلسة.</div>\n            <div className="flex gap-2">\n              <button type="button" onClick={() => {\n                if (scopeFrom && scopeTo && new Date(scopeFrom).getTime() > new Date(scopeTo).getTime()) { toast.error('وقت البداية لازم يكون قبل وقت النهاية'); return; }\n                if (!scopePreview.sessions.length) { toast.error('لا توجد رسائل مطابقة للدكتور والفترة المحددين'); return; }\n                setScopeEnabled(true);\n                setSelectedId('');\n                toast.success('تم تطبيق نطاق التحليل المحدد');\n              }} className="rounded-lg bg-cyan-500/15 px-3 py-2 font-black text-cyan-100">تحليل النطاق المحدد</button>\n              <button type="button" onClick={() => { setScopeEnabled(false); setScopeDoctor(''); setScopeFrom(toLocalDateTimeInput(sessions[0]?.startedAt)); setScopeTo(toLocalDateTimeInput(sessions[sessions.length - 1]?.endedAt)); setSelectedId(''); }} className="rounded-lg border border-slate-700 px-3 py-2 font-black text-slate-300">إلغاء الفلتر</button>\n            </div>\n          </div>\n          {scopeDoctor && !detectedDoctors.includes(scopeDoctor) ? <div className="mt-2 text-xs text-amber-200">اسم الدكتور غير موجود ضمن الأسماء المكتشفة في الملف؛ لن يتم التخمين.</div> : null}\n        </section>\n      ) : null}\n\n`;

if (!src.includes('>نطاق التحليل</div>')) {
  const anchor = `      {!selected ? (`;
  if (!src.includes(anchor)) throw new Error('[whatsapp-analysis-scope] scope UI anchor not found');
  src = src.replace(anchor, `${scopeUi}${anchor}`);
  console.log('[whatsapp-analysis-scope] scope UI: applied');
} else {
  console.log('[whatsapp-analysis-scope] scope UI: already applied');
}

fs.writeFileSync(file, src);
console.log('[whatsapp-analysis-scope] doctor + exact from/to scope wired into analyzer');
