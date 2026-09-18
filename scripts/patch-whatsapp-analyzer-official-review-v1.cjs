const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/WhatsAppConversationAnalyzer.tsx');
let src = fs.readFileSync(file, 'utf8');

function patch(label, from, to) {
  if (src.includes(to)) {
    console.log(`[whatsapp-review-v1] ${label}: already applied`);
    return;
  }
  if (!src.includes(from)) throw new Error(`[whatsapp-review-v1] ${label}: anchor not found`);
  src = src.replace(from, to);
  console.log(`[whatsapp-review-v1] ${label}: applied`);
}

patch(
  'import official review scorer',
  `import { readWhatsAppExportFile } from '@/lib/whatsappExportFileReader';`,
  `import { readWhatsAppExportFile } from '@/lib/whatsappExportFileReader';\nimport { buildOfficialReviewSuggestion } from '@/lib/whatsappReviewScoring';`
);

patch(
  'session card provisional review score',
  `  const { session } = item;\n  const signals = extractConversationSignals(session);`,
  `  const { session } = item;\n  const signals = extractConversationSignals(session);\n  const review = buildOfficialReviewSuggestion(session, item.customerName);`
);

patch(
  'session card score badge',
  `        <span className="rounded-lg bg-slate-800 px-2 py-1 text-xs font-black text-slate-200">\n          {session.messages.length} رسالة\n        </span>`,
  `        <div className="flex shrink-0 items-center gap-1.5">\n          {review.provisionalScore != null ? (\n            <span className={\`rounded-lg border px-2 py-1 text-xs font-black \${review.provisionalScore >= 90 ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200' : review.provisionalScore >= 80 ? 'border-amber-400/30 bg-amber-500/10 text-amber-200' : 'border-rose-400/30 bg-rose-500/10 text-rose-200'}\`}>\n              {review.provisionalScore}/100*\n            </span>\n          ) : null}\n          <span className="rounded-lg bg-slate-800 px-2 py-1 text-xs font-black text-slate-200">\n            {session.messages.length} رسالة\n          </span>\n        </div>`
);

patch(
  'selected official review memo',
  `  const evidence = useMemo(() => (selected ? buildSessionEvidence(selected) : []), [selected]);\n  const overview = useMemo(`,
  `  const evidence = useMemo(() => (selected ? buildSessionEvidence(selected) : []), [selected]);\n  const reviewSuggestion = useMemo(\n    () => (selected ? buildOfficialReviewSuggestion(selected, selectedItem?.customerName || smartModel.identity.customerName) : null),\n    [selected, selectedItem?.customerName, smartModel.identity.customerName]\n  );\n  const overview = useMemo(`
);

const officialPanel = `              <section className="dawaa-card dawaa-card--raised p-4">\n                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">\n                  <div>\n                    <div className="flex items-center gap-2 text-lg font-black text-white"><Gauge size={19} />نتيجة الجلسة والتقييم الرسمي المقترح</div>\n                    <p className="mt-1 max-w-3xl text-xs leading-6 text-slate-400">\n                      الدرجة بعلامة * مبدئية فقط ومبنية على البنود التي أمكن إثباتها آليًا. البنود الدلالية أو التي تحتاج قاعدة البيانات تظل «تحتاج مراجعة» ولا تدخل الدرجة حتى الآن.\n                    </p>\n                  </div>\n                  {reviewSuggestion ? (\n                    <div className="grid min-w-[280px] grid-cols-2 gap-2">\n                      <div className="rounded-2xl border border-cyan-400/25 bg-cyan-500/10 p-3 text-center">\n                        <div className="text-[10px] font-black text-cyan-200">الدرجة المبدئية</div>\n                        <div className="mt-1 text-3xl font-black text-white">{reviewSuggestion.provisionalScore ?? '—'}{reviewSuggestion.provisionalScore != null ? <span className="text-sm text-cyan-300">/100*</span> : null}</div>\n                        <div className="mt-1 text-[11px] text-cyan-100">{reviewSuggestion.scoreLabel}</div>\n                      </div>\n                      <div className="rounded-2xl border border-slate-700 bg-slate-950/45 p-3 text-center">\n                        <div className="text-[10px] font-black text-slate-400">تغطية التقييم الآلي</div>\n                        <div className="mt-1 text-3xl font-black text-emerald-200">{reviewSuggestion.coveragePercent}%</div>\n                        <div className="mt-1 text-[11px] text-slate-400">{reviewSuggestion.assessedCount} محسوم • {reviewSuggestion.reviewRequiredCount} مراجعة</div>\n                      </div>\n                    </div>\n                  ) : null}\n                </div>\n\n                {reviewSuggestion ? (\n                  <>\n                    <div className="mt-4 rounded-2xl border border-slate-700 bg-slate-950/40 p-3 text-sm leading-7 text-slate-200">\n                      <b className="text-white">ملخص الجلسة:</b> {reviewSuggestion.summary}\n                    </div>\n                    <div className="mt-4 grid gap-2 xl:grid-cols-2">\n                      {reviewSuggestion.items.map((item) => {\n                        const assessed = item.status === 'assessed';\n                        const review = item.status === 'review_required';\n                        return (\n                          <div key={item.key} className={\`rounded-2xl border p-3 \${assessed ? 'border-emerald-400/20 bg-emerald-500/5' : review ? 'border-amber-400/20 bg-amber-500/5' : 'border-slate-700 bg-slate-950/30'}\`}>\n                            <div className="flex items-start justify-between gap-3">\n                              <div className="min-w-0">\n                                <div className="font-black text-white">{item.label}</div>\n                                <div className={\`mt-1 text-xs font-bold \${assessed ? 'text-emerald-200' : review ? 'text-amber-200' : 'text-slate-500'}\`}>{item.selectedLabel}</div>\n                              </div>\n                              <div className="shrink-0 text-left">\n                                {assessed && item.pointsEarned != null ? (\n                                  <div className="text-sm font-black text-white">{item.pointsEarned}/{item.maxPoints}</div>\n                                ) : (\n                                  <div className="text-[10px] font-black text-slate-500">{review ? 'مراجعة' : 'N/A'}</div>\n                                )}\n                                <div className="mt-1 text-[10px] text-slate-500">ثقة {item.confidence}%</div>\n                              </div>\n                            </div>\n                            <div className="mt-2 text-[11px] leading-5 text-slate-400">{item.reason}</div>\n                            {item.evidenceMessageIds.length ? (\n                              <button type="button" onClick={() => jumpToMessage(item.evidenceMessageIds[0])} className="mt-2 text-[11px] font-black text-cyan-300 hover:text-cyan-200">عرض الدليل في المحادثة ←</button>\n                            ) : null}\n                          </div>\n                        );\n                      })}\n                    </div>\n                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400/20 bg-amber-500/5 px-3 py-2.5 text-xs text-amber-100">\n                      <span>{reviewSuggestion.disclaimer}</span>\n                      <span className="font-black">المحسوب: {reviewSuggestion.assessedPoints}/{reviewSuggestion.assessedMaxPoints} نقطة من البنود المحسومة</span>\n                    </div>\n                  </>\n                ) : null}\n              </section>\n\n`;

patch(
  'insert official review panel before evidence report',
  `              <section className="dawaa-card dawaa-card--raised p-4">\n                <div className="mb-3 flex items-center justify-between gap-3">\n                  <div>\n                    <div className="flex items-center gap-2 font-black text-white"><ShieldAlert size={17} />تقرير الأدلة</div>`,
  officialPanel + `              <section className="dawaa-card dawaa-card--raised p-4">\n                <div className="mb-3 flex items-center justify-between gap-3">\n                  <div>\n                    <div className="flex items-center gap-2 font-black text-white"><ShieldAlert size={17} />تقرير الأدلة</div>`
);

fs.writeFileSync(file, src);
console.log('[whatsapp-review-v1] official review scoring UI applied successfully');
