const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/WhatsAppConversationAnalyzer.tsx');
let src = fs.readFileSync(file, 'utf8');

function patch(label, from, to) {
  if (src.includes(to)) {
    console.log(`[whatsapp-unified-v4] ${label}: already applied`);
    return;
  }
  if (!src.includes(from)) throw new Error(`[whatsapp-unified-v4] ${label}: anchor not found`);
  src = src.replace(from, to);
  console.log(`[whatsapp-unified-v4] ${label}: applied`);
}

patch(
  'unified intelligence import',
  `import { buildWhatsAppReviewFrameworkV3 } from '@/lib/whatsappReviewFrameworkV3';`,
  `import { buildWhatsAppReviewFrameworkV3 } from '@/lib/whatsappReviewFrameworkV3';\nimport { buildUnifiedConversationIntelligence, summarizePortfolio } from '@/lib/whatsappUnifiedIntelligenceV4';`
);

patch(
  'session card unified model',
  `  const framework = buildWhatsAppReviewFrameworkV3(session, item.customerName);`,
  `  const framework = buildWhatsAppReviewFrameworkV3(session, item.customerName);\n  const unified = buildUnifiedConversationIntelligence(session);`
);

patch(
  'session card priority',
  `        <span className="text-cyan-200">• {framework.dominantTrackLabel}</span>`,
  `        <span className="text-cyan-200">• {framework.dominantTrackLabel}</span>\n        <span className={unified.priority === 'urgent' ? 'text-rose-300' : unified.priority === 'important' ? 'text-amber-300' : 'text-emerald-300'}>\n          • {unified.priority === 'urgent' ? 'أولوية عاجلة' : unified.priority === 'important' ? 'أولوية مهمة' : 'أولوية عادية'}\n        </span>\n        {unified.followupRequired ? <span className="text-violet-300">• متابعة مطلوبة</span> : null}`
);

patch(
  'selected unified memos',
  `  const frameworkModel = useMemo(\n    () => (selected ? buildWhatsAppReviewFrameworkV3(selected, selectedItem?.customerName || smartModel.identity.customerName) : null),\n    [selected, selectedItem?.customerName, smartModel.identity.customerName]\n  );\n  const overview = useMemo(`,
  `  const frameworkModel = useMemo(\n    () => (selected ? buildWhatsAppReviewFrameworkV3(selected, selectedItem?.customerName || smartModel.identity.customerName) : null),\n    [selected, selectedItem?.customerName, smartModel.identity.customerName]\n  );\n  const unifiedModel = useMemo(() => (selected ? buildUnifiedConversationIntelligence(selected) : null), [selected]);\n  const portfolio = useMemo(() => summarizePortfolio(sessions), [sessions]);\n  const overview = useMemo(`
);

const v4Panel = `              <section className="dawaa-card dawaa-card--raised p-4">\n                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">\n                  <div className="min-w-0">\n                    <div className="text-xs font-black text-violet-200">WhatsApp Review V4 — مركز القرار الموحد</div>\n                    <div className="mt-1 text-xl font-black text-white">{unifiedModel?.executiveSummary || '—'}</div>\n                    <div className="mt-3 flex flex-wrap gap-2 text-xs font-black">\n                      <span className={\`rounded-full border px-3 py-1 \${unifiedModel?.priority === 'urgent' ? 'border-rose-400/30 bg-rose-500/10 text-rose-200' : unifiedModel?.priority === 'important' ? 'border-amber-400/30 bg-amber-500/10 text-amber-200' : 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200'}\`}>\n                        {unifiedModel?.priority === 'urgent' ? 'عاجلة' : unifiedModel?.priority === 'important' ? 'مهمة' : 'عادية'}\n                      </span>\n                      <span className="rounded-full border border-cyan-400/25 bg-cyan-500/10 px-3 py-1 text-cyan-200">ثقة {unifiedModel?.confidence ?? 0}%</span>\n                      {unifiedModel?.followupRequired ? <span className="rounded-full border border-violet-400/25 bg-violet-500/10 px-3 py-1 text-violet-200">متابعة مطلوبة</span> : null}\n                      {unifiedModel?.requiresHumanApproval ? <span className="rounded-full border border-amber-400/25 bg-amber-500/10 px-3 py-1 text-amber-200">اعتماد بشري إلزامي</span> : <span className="rounded-full border border-emerald-400/25 bg-emerald-500/10 px-3 py-1 text-emerald-200">Quick Review</span>}\n                    </div>\n                  </div>\n                  <div className="grid min-w-[320px] grid-cols-2 gap-2">\n                    <div className="rounded-2xl border border-cyan-400/20 bg-cyan-500/8 p-3 text-center">\n                      <div className="text-[10px] font-black text-cyan-200">خدمة</div>\n                      <div className="mt-1 text-2xl font-black text-white">{unifiedModel?.serviceScore ?? 0}%</div>\n                    </div>\n                    <div className="rounded-2xl border border-violet-400/20 bg-violet-500/8 p-3 text-center">\n                      <div className="text-[10px] font-black text-violet-200">بيع</div>\n                      <div className="mt-1 text-2xl font-black text-white">{unifiedModel?.commercialScore ?? 0}%</div>\n                    </div>\n                  </div>\n                </div>\n\n                <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">\n                  {unifiedModel?.journeyStages.map((stage) => (\n                    <div key={stage.key} className={\`rounded-xl border px-3 py-2 \${stage.detected ? 'border-emerald-400/20 bg-emerald-500/8' : 'border-slate-800 bg-slate-950/25 opacity-65'}\`}>\n                      <div className={\`text-xs font-black \${stage.detected ? 'text-white' : 'text-slate-500'}\`}>{stage.label}</div>\n                      <div className="mt-1 text-[10px] leading-5 text-slate-400">{stage.reason}</div>\n                    </div>\n                  ))}\n                </div>\n\n                {unifiedModel?.lostSales.length ? (\n                  <div className="mt-4 rounded-2xl border border-rose-400/25 bg-rose-500/8 p-3">\n                    <div className="font-black text-rose-100">فرص بيع ضائعة/مهددة</div>\n                    <div className="mt-2 grid gap-2 md:grid-cols-2">\n                      {unifiedModel.lostSales.map((item, index) => <div key={index} className="text-xs leading-6 text-rose-100/90">• {item.summary}</div>)}\n                    </div>\n                  </div>\n                ) : null}\n\n                {unifiedModel?.medicalSafetyFlags.length ? (\n                  <div className="mt-3 rounded-2xl border border-amber-400/25 bg-amber-500/8 p-3">\n                    <div className="font-black text-amber-100">حواجز الأمان الطبي</div>\n                    <div className="mt-2 grid gap-2 md:grid-cols-2">\n                      {unifiedModel.medicalSafetyFlags.map((item) => <div key={item.code} className="text-xs leading-6 text-amber-100/90">• {item.summary}</div>)}\n                    </div>\n                  </div>\n                ) : null}\n\n                <div className="mt-4 grid gap-2 md:grid-cols-3 xl:grid-cols-6">\n                  <StatCard label="كل الجلسات" value={portfolio.sessions} />\n                  <StatCard label="عاجلة" value={portfolio.urgent} tone="text-rose-300" />\n                  <StatCard label="تحتاج متابعة" value={portfolio.needsFollowup} tone="text-violet-300" />\n                  <StatCard label="فرص بيع" value={portfolio.salesEligible} tone="text-cyan-300" />\n                  <StatCard label="بيع مقترح" value={portfolio.suggestedSold} tone="text-emerald-300" />\n                  <StatCard label="Conversion مبدئي" value={portfolio.conversionSuggestionRate == null ? '—' : String(portfolio.conversionSuggestionRate) + '%'} />\n                </div>\n              </section>\n\n`;

patch(
  'insert V4 panel before V3 framework',
  `              <section className="dawaa-card dawaa-card--raised p-4">\n                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">\n                  <div className="min-w-0">\n                    <div className="text-xs font-black text-emerald-200">هيكل التقييم الذكي V3 — مبني على السجل التاريخي الكامل</div>`,
  v4Panel + `              <section className="dawaa-card dawaa-card--raised p-4">\n                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">\n                  <div className="min-w-0">\n                    <div className="text-xs font-black text-emerald-200">هيكل التقييم الذكي V3 — مبني على السجل التاريخي الكامل</div>`
);

fs.writeFileSync(file, src);
console.log('[whatsapp-unified-v4] unified V4 intelligence UI applied successfully');
