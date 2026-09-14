const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/WhatsAppConversationAnalyzer.tsx');
let src = fs.readFileSync(file, 'utf8');

function patch(label, from, to) {
  if (src.includes(to)) {
    console.log(`[whatsapp-review-v2] ${label}: already applied`);
    return;
  }
  if (!src.includes(from)) throw new Error(`[whatsapp-review-v2] ${label}: anchor not found`);
  src = src.replace(from, to);
  console.log(`[whatsapp-review-v2] ${label}: applied`);
}

patch(
  'import decision support',
  `import { buildOfficialReviewSuggestion } from '@/lib/whatsappReviewScoring';`,
  `import { buildOfficialReviewSuggestion } from '@/lib/whatsappReviewScoring';\nimport { buildReviewDecisionSupport } from '@/lib/whatsappReviewDecisionSupport';`
);

patch(
  'session card decision support',
  `  const review = buildOfficialReviewSuggestion(session, item.customerName);`,
  `  const review = buildOfficialReviewSuggestion(session, item.customerName);\n  const decision = buildReviewDecisionSupport(session, item.customerName);`
);

patch(
  'session card readiness badge',
  `      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">`,
  `      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">\n        <span className={decision.readiness === 'quick_human_review' ? 'text-emerald-300' : decision.readiness === 'detailed_human_review' ? 'text-amber-300' : 'text-rose-300'}>\n          • {decision.readinessLabel}\n        </span>`
);

patch(
  'selected decision support memo',
  `  const reviewSuggestion = useMemo(\n    () => (selected ? buildOfficialReviewSuggestion(selected, selectedItem?.customerName || smartModel.identity.customerName) : null),\n    [selected, selectedItem?.customerName, smartModel.identity.customerName]\n  );\n  const overview = useMemo(`,
  `  const reviewSuggestion = useMemo(\n    () => (selected ? buildOfficialReviewSuggestion(selected, selectedItem?.customerName || smartModel.identity.customerName) : null),\n    [selected, selectedItem?.customerName, smartModel.identity.customerName]\n  );\n  const decisionSupport = useMemo(\n    () => (selected ? buildReviewDecisionSupport(selected, selectedItem?.customerName || smartModel.identity.customerName) : null),\n    [selected, selectedItem?.customerName, smartModel.identity.customerName]\n  );\n  const overview = useMemo(`
);

const decisionPanel = `              <section className="dawaa-card dawaa-card--raised p-4">\n                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">\n                  <div className="min-w-0">\n                    <div className="text-xs font-black text-cyan-200">قرار المراجعة الذكي</div>\n                    <div className="mt-1 text-xl font-black text-white">{decisionSupport?.readinessLabel || '—'}</div>\n                    <p className="mt-2 max-w-4xl text-sm leading-7 text-slate-300">{decisionSupport?.executiveSummary}</p>\n                  </div>\n                  {decisionSupport ? (\n                    <div className="grid min-w-[310px] grid-cols-3 gap-2">\n                      <div className="rounded-xl border border-slate-700 bg-slate-950/40 p-3 text-center"><div className="text-[10px] text-slate-400">ثقة القرار</div><div className="mt-1 text-xl font-black text-cyan-200">{decisionSupport.confidence}%</div></div>\n                      <div className="rounded-xl border border-slate-700 bg-slate-950/40 p-3 text-center"><div className="text-[10px] text-slate-400">محسوم</div><div className="mt-1 text-xl font-black text-emerald-200">{decisionSupport.resolvedCriteria}</div></div>\n                      <div className="rounded-xl border border-slate-700 bg-slate-950/40 p-3 text-center"><div className="text-[10px] text-slate-400">يحتاج مراجعة</div><div className="mt-1 text-xl font-black text-amber-200">{decisionSupport.unresolvedCriteria}</div></div>\n                    </div>\n                  ) : null}\n                </div>\n\n                {decisionSupport?.blockers.length ? (\n                  <div className="mt-4 rounded-2xl border border-amber-400/25 bg-amber-500/5 p-3">\n                    <div className="text-xs font-black text-amber-200">لماذا لا نعتمد آليًا؟</div>\n                    <div className="mt-2 flex flex-wrap gap-2">{decisionSupport.blockers.map((blocker) => <span key={blocker} className="rounded-full border border-amber-400/20 bg-slate-950/30 px-3 py-1 text-xs text-amber-100">{blocker}</span>)}</div>\n                  </div>\n                ) : null}\n\n                {decisionSupport?.doctorSegments.length ? (\n                  <div className="mt-4">\n                    <div className="text-sm font-black text-white">تقسيم المسؤولية حسب الدكتور</div>\n                    <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-3">\n                      {decisionSupport.doctorSegments.map((segment, index) => (\n                        <div key={segment.id} className="rounded-2xl border border-slate-700 bg-slate-950/35 p-3">\n                          <div className="flex items-center justify-between gap-2"><b className="text-emerald-200">{segment.doctorName ? \`د/ \${segment.doctorName}\` : 'غير منسوب لدكتور'}</b><span className="text-[10px] text-slate-500">جزء {index + 1}</span></div>\n                          <div className="mt-2 text-[11px] leading-5 text-slate-400">ثقة النسبة {segment.confidence}% • صادر {segment.outboundCount} • وارد {segment.inboundCount}</div>\n                          <div className="mt-1 text-[10px] text-slate-500">{segment.attribution === 'explicit' ? 'الاسم مذكور صراحة' : segment.attribution === 'inherited' ? 'منسوب من سياق الجلسة' : 'النسبة غير مؤكدة — لا خصم تلقائي'}</div>\n                        </div>\n                      ))}\n                    </div>\n                  </div>\n                ) : null}\n\n                {decisionSupport ? (\n                  <div className="mt-4 grid gap-3 xl:grid-cols-3">\n                    <div className="rounded-2xl border border-rose-400/20 bg-rose-500/5 p-3">\n                      <div className="font-black text-rose-200">مخاطر وملاحظات</div>\n                      <div className="mt-2 space-y-2">{decisionSupport.risks.length ? decisionSupport.risks.map((item) => <button key={item.id} type="button" onClick={() => jumpToMessage(item.messageIds[0])} className="block w-full rounded-xl bg-slate-950/35 p-2 text-right"><div className="text-xs font-black text-white">{item.title}</div><div className="mt-1 text-[11px] leading-5 text-slate-400">{item.detail}</div></button>) : <div className="text-xs text-slate-500">لا توجد مخاطر نصية واضحة.</div>}</div>\n                    </div>\n                    <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/5 p-3">\n                      <div className="font-black text-emerald-200">نقاط قوة</div>\n                      <div className="mt-2 space-y-2">{decisionSupport.positives.length ? decisionSupport.positives.map((item) => <button key={item.id} type="button" onClick={() => jumpToMessage(item.messageIds[0])} className="block w-full rounded-xl bg-slate-950/35 p-2 text-right"><div className="text-xs font-black text-white">{item.title}</div><div className="mt-1 text-[11px] leading-5 text-slate-400">{item.detail}</div></button>) : <div className="text-xs text-slate-500">تحتاج طبقة دلالية لاستخراج نقاط القوة كاملة.</div>}</div>\n                    </div>\n                    <div className="rounded-2xl border border-cyan-400/20 bg-cyan-500/5 p-3">\n                      <div className="font-black text-cyan-200">فرص بيع وتحسين</div>\n                      <div className="mt-2 space-y-2">{decisionSupport.opportunities.length ? decisionSupport.opportunities.map((item) => <button key={item.id} type="button" onClick={() => jumpToMessage(item.messageIds[0])} className="block w-full rounded-xl bg-slate-950/35 p-2 text-right"><div className="text-xs font-black text-white">{item.title}</div><div className="mt-1 text-[11px] leading-5 text-slate-400">{item.detail}</div></button>) : <div className="text-xs text-slate-500">لا توجد فرص مؤكدة من القواعد الحالية.</div>}</div>\n                    </div>\n                  </div>\n                ) : null}\n\n                <div className="mt-4 rounded-xl border border-slate-700 bg-slate-950/35 px-3 py-2 text-xs leading-6 text-slate-300">\n                  <b className="text-white">قاعدة الحماية:</b> تعدد الدكاترة أو الميديا أو البنود الطبية يمنع نسبة خصم آلي لشخص بعينه. النتيجة هنا دعم قرار فقط حتى يعتمدها المقيم.\n                </div>\n              </section>\n\n`;

patch(
  'insert decision support before official scoring',
  `              <section className="dawaa-card dawaa-card--raised p-4">\n                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">\n                  <div>\n                    <div className="flex items-center gap-2 text-lg font-black text-white"><Gauge size={19} />نتيجة الجلسة والتقييم الرسمي المقترح</div>`,
  decisionPanel + `              <section className="dawaa-card dawaa-card--raised p-4">\n                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">\n                  <div>\n                    <div className="flex items-center gap-2 text-lg font-black text-white"><Gauge size={19} />نتيجة الجلسة والتقييم الرسمي المقترح</div>`
);

fs.writeFileSync(file, src);
console.log('[whatsapp-review-v2] decision support UI applied successfully');
