const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/WhatsAppConversationAnalyzer.tsx');
let src = fs.readFileSync(file, 'utf8');

function patch(label, from, to) {
  if (src.includes(to)) { console.log(`[whatsapp-case-v22] ${label}: already applied`); return; }
  if (!src.includes(from)) throw new Error(`[whatsapp-case-v22] ${label}: anchor not found`);
  src = src.replace(from, to);
  console.log(`[whatsapp-case-v22] ${label}: applied`);
}

patch(
  'case engine import',
  `import { buildWhatsAppCustomerJourneyIntelligenceV15 } from '@/lib/whatsappCustomerJourneyIntelligenceV15';`,
  `import { buildWhatsAppCustomerJourneyIntelligenceV15 } from '@/lib/whatsappCustomerJourneyIntelligenceV15';\nimport { buildWhatsAppCustomerCaseEngineV22 } from '@/lib/whatsappCustomerCaseEngineV22';`
);

patch(
  'case engine memo',
  `  const customerJourney = useMemo(\n    () => buildWhatsAppCustomerJourneyIntelligenceV15(sessions),\n    [sessions]\n  );`,
  `  const customerJourney = useMemo(\n    () => buildWhatsAppCustomerJourneyIntelligenceV15(sessions),\n    [sessions]\n  );\n  const customerCases = useMemo(\n    () => buildWhatsAppCustomerCaseEngineV22(sessions),\n    [sessions]\n  );`
);

if (!src.includes('whatsapp-customer-case-v22-panel')) {
  const anchor = `          <div className="grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">`;
  if (!src.includes(anchor)) throw new Error('[whatsapp-case-v22] analyzer workspace anchor not found');
  const panel = `          {/* whatsapp-customer-case-v22-panel */}\n          <section className="dawaa-card dawaa-card--raised p-4">\n            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">\n              <div>\n                <div className="text-xs font-black text-cyan-200">Customer Case Engine V22</div>\n                <div className="mt-1 text-xl font-black text-white">من {customerCases.sessionCount} جلسة → {customerCases.caseCount} حالة تشغيلية</div>\n                <div className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">\n                  السجل الطويل لا يُعامل كقصة واحدة بلا نهاية. كل طلب/شكوى/ترشيح يتجمع مع متابعته في Case مستقلة، ثم يبدأ Case جديد عند رجوع العميل بطلب جديد أو بعد انقطاع زمني واضح.\n                </div>\n              </div>\n              <div className="grid min-w-[260px] grid-cols-3 gap-2 text-center">\n                <div className="rounded-xl border border-slate-800 bg-slate-950/35 p-2"><div className="text-[10px] text-slate-500">مفتوحة</div><div className="mt-1 font-black text-white">{customerCases.openCaseCount}</div></div>\n                <div className="rounded-xl border border-rose-400/20 bg-rose-500/5 p-2"><div className="text-[10px] text-slate-500">Recovery</div><div className="mt-1 font-black text-rose-200">{customerCases.recoveryCaseCount}</div></div>\n                <div className="rounded-xl border border-violet-400/20 bg-violet-500/5 p-2"><div className="text-[10px] text-slate-500">تغطية الميديا</div><div className="mt-1 font-black text-violet-200">{customerCases.mediaCoveragePercent}%</div></div>\n              </div>\n            </div>\n\n            <div className={\`mt-4 rounded-xl border px-3 py-2 text-xs leading-6 \${customerCases.mediaMissing ? 'border-amber-400/25 bg-amber-500/5 text-amber-100' : 'border-emerald-400/20 bg-emerald-500/5 text-emerald-100'}\`}>\n              {customerCases.analysisCoverageLabel}\n              {customerCases.mediaReferenced ? <span className="mr-2 text-slate-400">• مذكور {customerCases.mediaReferenced} • متاح {customerCases.mediaAvailable} • مفقود {customerCases.mediaMissing}</span> : null}\n            </div>\n\n            <div className="mt-4 grid gap-2 xl:grid-cols-2">\n              {customerCases.cases.slice().reverse().slice(0, 12).map((caseItem, index) => (\n                <button\n                  key={caseItem.id}\n                  type="button"\n                  onClick={() => caseItem.sessionIds[0] && setSelectedId(caseItem.sessionIds[0])}\n                  className="rounded-2xl border border-slate-800 bg-slate-950/30 p-3 text-right transition hover:border-cyan-400/35"\n                >\n                  <div className="flex flex-wrap items-start justify-between gap-2">\n                    <div>\n                      <div className="font-black text-white">{customerCases.caseCount - index}. {caseItem.summary}</div>\n                      <div className="mt-1 text-[11px] text-slate-500">{new Date(caseItem.startedAt).toLocaleString('ar-EG')} → {new Date(caseItem.lastEventAt).toLocaleString('ar-EG')}</div>\n                    </div>\n                    <span className={\`rounded-lg px-2 py-1 text-[10px] font-black \${caseItem.needsHumanReview ? 'bg-amber-500/10 text-amber-200' : 'bg-emerald-500/10 text-emerald-200'}\`}>\n                      {caseItem.needsHumanReview ? 'مراجعة بشرية' : 'سياق مكتمل'}\n                    </span>\n                  </div>\n                  <div className="mt-2 flex flex-wrap gap-2 text-[11px]">\n                    <span className="text-cyan-300">{caseItem.sessionIds.length} جلسة</span>\n                    {caseItem.staffNames.length ? <span className="text-emerald-300">• {caseItem.staffNames.join('، ')}</span> : null}\n                    {caseItem.recoveryAttempts ? <span className="text-violet-300">• {caseItem.recoveryAttempts} متابعة/Recovery</span> : null}\n                    {caseItem.mediaMissing ? <span className="text-amber-300">• {caseItem.mediaMissing} ميديا مفقودة</span> : null}\n                  </div>\n                  {caseItem.nextAction ? <div className="mt-2 rounded-xl bg-slate-900/60 px-2.5 py-2 text-xs leading-5 text-slate-300">التالي: {caseItem.nextAction}</div> : null}\n                </button>\n              ))}\n            </div>\n            {customerCases.cases.length > 12 ? <div className="mt-3 text-center text-xs text-slate-500">يتم عرض أحدث 12 Case هنا؛ باقي الحالات محفوظة في التحليل.</div> : null}\n          </section>\n\n`;
  src = src.replace(anchor, panel + anchor);
  console.log('[whatsapp-case-v22] case engine panel: applied');
}

fs.writeFileSync(file, src);
console.log('[whatsapp-case-v22] customer cases, media coverage and bounded episodes wired successfully');
