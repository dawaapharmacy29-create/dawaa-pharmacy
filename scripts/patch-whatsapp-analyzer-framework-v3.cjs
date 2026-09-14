const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/WhatsAppConversationAnalyzer.tsx');
let src = fs.readFileSync(file, 'utf8');

function patch(label, from, to) {
  if (src.includes(to)) {
    console.log(`[whatsapp-framework-v3] ${label}: already applied`);
    return;
  }
  if (!src.includes(from)) throw new Error(`[whatsapp-framework-v3] ${label}: anchor not found`);
  src = src.replace(from, to);
  console.log(`[whatsapp-framework-v3] ${label}: applied`);
}

patch(
  'import framework v3',
  `import { buildReviewDecisionSupport } from '@/lib/whatsappReviewDecisionSupport';`,
  `import { buildReviewDecisionSupport } from '@/lib/whatsappReviewDecisionSupport';\nimport { buildWhatsAppReviewFrameworkV3 } from '@/lib/whatsappReviewFrameworkV3';`
);

patch(
  'session card framework model',
  `  const decision = buildReviewDecisionSupport(session, item.customerName);`,
  `  const decision = buildReviewDecisionSupport(session, item.customerName);\n  const framework = buildWhatsAppReviewFrameworkV3(session, item.customerName);`
);

patch(
  'session card dominant path',
  `        <span className={decision.readiness === 'quick_human_review' ? 'text-emerald-300' : decision.readiness === 'detailed_human_review' ? 'text-amber-300' : 'text-rose-300'}>\n          • {decision.readinessLabel}\n        </span>`,
  `        <span className={decision.readiness === 'quick_human_review' ? 'text-emerald-300' : decision.readiness === 'detailed_human_review' ? 'text-amber-300' : 'text-rose-300'}>\n          • {decision.readinessLabel}\n        </span>\n        <span className="text-cyan-200">• {framework.dominantTrackLabel}</span>`
);

patch(
  'selected framework memo',
  `  const decisionSupport = useMemo(\n    () => (selected ? buildReviewDecisionSupport(selected, selectedItem?.customerName || smartModel.identity.customerName) : null),\n    [selected, selectedItem?.customerName, smartModel.identity.customerName]\n  );\n  const overview = useMemo(`,
  `  const decisionSupport = useMemo(\n    () => (selected ? buildReviewDecisionSupport(selected, selectedItem?.customerName || smartModel.identity.customerName) : null),\n    [selected, selectedItem?.customerName, smartModel.identity.customerName]\n  );\n  const frameworkModel = useMemo(\n    () => (selected ? buildWhatsAppReviewFrameworkV3(selected, selectedItem?.customerName || smartModel.identity.customerName) : null),\n    [selected, selectedItem?.customerName, smartModel.identity.customerName]\n  );\n  const overview = useMemo(`
);

const frameworkPanel = `              <section className="dawaa-card dawaa-card--raised p-4">\n                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">\n                  <div className="min-w-0">\n                    <div className="text-xs font-black text-emerald-200">هيكل التقييم الذكي V3 — مبني على السجل التاريخي الكامل</div>\n                    <div className="mt-1 text-xl font-black text-white">{frameworkModel?.headline || '—'}</div>\n                    <p className="mt-2 max-w-4xl text-sm leading-7 text-slate-300">{frameworkModel?.rationale}</p>\n                  </div>\n                  {frameworkModel ? (\n                    <div className="grid min-w-[300px] grid-cols-2 gap-2">\n                      <div className="rounded-2xl border border-cyan-400/25 bg-cyan-500/10 p-3 text-center">\n                        <div className="text-[10px] font-black text-cyan-200">ثقة تصنيف الحالة</div>\n                        <div className="mt-1 text-2xl font-black text-white">{frameworkModel.classificationConfidence}%</div>\n                      </div>\n                      <div className="rounded-2xl border border-emerald-400/25 bg-emerald-500/10 p-3 text-center">\n                        <div className="text-[10px] font-black text-emerald-200">المسارات المفتوحة</div>\n                        <div className="mt-1 text-2xl font-black text-white">{frameworkModel.activeTracks.length}/7</div>\n                      </div>\n                    </div>\n                  ) : null}\n                </div>\n\n                {frameworkModel ? (\n                  <>\n                    <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">\n                      {frameworkModel.tracks.map((track) => (\n                        <div key={track.key} className={\`rounded-2xl border p-3 \${track.active ? 'border-cyan-400/30 bg-cyan-500/8' : 'border-slate-800 bg-slate-950/25 opacity-60'}\`}>\n                          <div className="flex items-center justify-between gap-2">\n                            <div className={\`font-black \${track.active ? 'text-white' : 'text-slate-500'}\`}>{track.label}</div>\n                            <span className={\`rounded-full px-2 py-0.5 text-[10px] font-black \${track.active ? 'bg-emerald-500/15 text-emerald-200' : 'bg-slate-800 text-slate-500'}\`}>{track.active ? 'مفتوح' : 'غير منطبق'}</span>\n                          </div>\n                          <div className="mt-2 text-[11px] leading-5 text-slate-400">{track.reason}</div>\n                          <div className="mt-2 text-[10px] leading-5 text-slate-500">{track.historicalApplicabilityNote}</div>\n                        </div>\n                      ))}\n                    </div>\n\n                    <div className="mt-4 rounded-2xl border border-slate-700 bg-slate-950/35 p-3">\n                      <div className="flex flex-wrap items-center justify-between gap-2">\n                        <div>\n                          <div className="font-black text-white">البنود التي ستدخل المراجعة الآن</div>\n                          <div className="mt-1 text-xs text-slate-400">نُظهر البنود المرتبطة بالحالة فقط، بدل وضع الـ19 بند كلهم في حالة «مراجعة».</div>\n                        </div>\n                        <span className="rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-xs font-black text-cyan-200">{frameworkModel.visibleCriterionKeys.length} بند ظاهر • {frameworkModel.hiddenCriterionKeys.length} مخفي لعدم الانطباق</span>\n                      </div>\n                    </div>\n\n                    <div className="mt-3 grid gap-2 md:grid-cols-2">\n                      {frameworkModel.historicalGuardrails.map((rule) => (\n                        <div key={rule} className="rounded-xl border border-slate-800 bg-slate-950/25 px-3 py-2 text-[11px] leading-5 text-slate-400">• {rule}</div>\n                      ))}\n                    </div>\n                  </>\n                ) : null}\n              </section>\n\n`;

patch(
  'insert framework before decision support',
  `              <section className="dawaa-card dawaa-card--raised p-4">\n                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">\n                  <div className="min-w-0">\n                    <div className="text-xs font-black text-cyan-200">قرار المراجعة الذكي</div>`,
  frameworkPanel + `              <section className="dawaa-card dawaa-card--raised p-4">\n                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">\n                  <div className="min-w-0">\n                    <div className="text-xs font-black text-cyan-200">قرار المراجعة الذكي</div>`
);

patch(
  'show only criteria relevant to active paths',
  `                      {reviewSuggestion.items.map((item) => {`,
  `                      {reviewSuggestion.items.filter((item) => frameworkModel?.visibleCriterionKeys.includes(item.key) ?? true).map((item) => {`
);

patch(
  'clarify official panel active-path scoring',
  `                      الدرجة بعلامة * مبدئية فقط ومبنية على البنود التي أمكن إثباتها آليًا. البنود الدلالية أو التي تحتاج قاعدة البيانات تظل «تحتاج مراجعة» ولا تدخل الدرجة حتى الآن.`,
  `                      الدرجة بعلامة * مبدئية فقط. يظهر هنا الآن المسار الأساسي + المسارات التي ثبت انطباقها على الجلسة؛ البنود غير المنطبقة مخفية، والبنود الدلالية داخل المسار المفتوح تظل «تحتاج مراجعة» حتى يوجد دليل كافٍ.`
);

fs.writeFileSync(file, src);
console.log('[whatsapp-framework-v3] path based review UI applied successfully');
