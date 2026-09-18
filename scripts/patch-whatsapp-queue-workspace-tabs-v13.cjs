const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/WhatsAppReviewQueueV4.tsx');
let src = fs.readFileSync(file, 'utf8');

function patch(label, from, to) {
  if (src.includes(to)) {
    console.log(`[whatsapp-workspace-v13] ${label}: already applied`);
    return;
  }
  if (!src.includes(from)) throw new Error(`[whatsapp-workspace-v13] ${label}: anchor not found`);
  src = src.replace(from, to);
  console.log(`[whatsapp-workspace-v13] ${label}: applied`);
}

function wrapPanel(label, marker, exact, tab) {
  if (src.includes(marker)) {
    console.log(`[whatsapp-workspace-v13] ${label}: already wrapped`);
    return;
  }
  if (!src.includes(exact)) throw new Error(`[whatsapp-workspace-v13] ${label}: panel anchor not found`);
  src = src.replace(exact, `      {/* ${marker} */}\n      {activeWorkspace === '${tab}' ? (\n${exact}\n      ) : null}`);
  console.log(`[whatsapp-workspace-v13] ${label}: wrapped`);
}

patch(
  'workspace state',
  `  const [priority, setPriority] = useState('all');`,
  `  const [priority, setPriority] = useState('all');\n  const [activeWorkspace, setActiveWorkspace] = useState<'daily' | 'customers' | 'doctors' | 'sales' | 'recovery'>('daily');`
);

const actionCenter = `      <WhatsAppCustomerActionCenterV6 onOpenSource={(sourceId) => { setStatus('all'); setSelectedId(sourceId); }} />`;
const tabs = `      {/* whatsapp-workspace-v13-tabs */}\n      <section className="dawaa-card dawaa-card--soft p-2">\n        <div className="flex gap-2 overflow-x-auto pb-1">\n          {[\n            ['daily', 'المراجعة اليومية', 'الجلسات والتقييم'],\n            ['customers', 'العملاء والمتابعة', 'مين محتاج تواصل'],\n            ['doctors', 'أداء الدكاترة', 'السايكل والتحويل'],\n            ['sales', 'المبيعات والـ Funnel', 'التسريب والفرص'],\n            ['recovery', 'فرص الاسترجاع', 'المهام والنتائج'],\n          ].map(([key, label, helper]) => (\n            <button\n              key={key}\n              type="button"\n              onClick={() => setActiveWorkspace(key as typeof activeWorkspace)}\n              className={\`min-w-[150px] rounded-xl border px-4 py-2.5 text-right transition \${activeWorkspace === key ? 'border-violet-400/60 bg-violet-500/15 text-white' : 'border-slate-800 bg-slate-950/35 text-slate-300 hover:border-slate-600'}\`}\n            >\n              <div className="text-sm font-black">{label}</div>\n              <div className="mt-0.5 text-[10px] text-slate-400">{helper}</div>\n            </button>\n          ))}\n        </div>\n        {activeWorkspace === 'daily' ? (\n          <div className="mt-2 rounded-xl border border-emerald-400/15 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-100">\n            وضع العمل اليومي: التحليلات الثقيلة مخفية عشان توصل للمحادثات والتقييم بسرعة.\n          </div>\n        ) : null}\n      </section>\n\n      {/* whatsapp-workspace-v13:customers */}\n      {activeWorkspace === 'customers' ? (\n${actionCenter}\n      ) : null}`;

if (!src.includes('whatsapp-workspace-v13-tabs')) {
  if (!src.includes(actionCenter)) throw new Error('[whatsapp-workspace-v13] tabs: action center anchor not found');
  src = src.replace(actionCenter, tabs);
  console.log('[whatsapp-workspace-v13] workspace tabs and customer panel: applied');
} else {
  console.log('[whatsapp-workspace-v13] workspace tabs: already applied');
}

wrapPanel(
  'doctor cycle',
  'whatsapp-workspace-v13:doctor-cycle',
  `      <WhatsAppDoctorCycleIntelligenceV8 onOpenSource={(sourceId) => { setStatus('all'); setSelectedId(sourceId); }} />`,
  'doctors'
);

wrapPanel(
  'sales leakage',
  'whatsapp-workspace-v13:sales-leakage',
  `      <WhatsAppSalesLeakageV8 onOpenSource={(sourceId) => { setStatus('all'); setSelectedId(sourceId); }} />`,
  'sales'
);

wrapPanel(
  'conversion funnel',
  'whatsapp-workspace-v13:conversion-funnel',
  `      <WhatsAppConversionFunnelV9 onOpenSource={(sourceId) => { setStatus('all'); setSelectedId(sourceId); }} />`,
  'sales'
);

wrapPanel(
  'funnel comparison',
  'whatsapp-workspace-v13:funnel-comparison',
  `      <WhatsAppFunnelComparisonV9 />`,
  'sales'
);

wrapPanel(
  'leakage reasons',
  'whatsapp-workspace-v13:leakage-reasons',
  `      <WhatsAppLeakageReasonsV10 onOpenSource={(sourceId) => { setStatus('all'); setSelectedId(sourceId); }} />`,
  'sales'
);

wrapPanel(
  'recoverable opportunities',
  'whatsapp-workspace-v13:recoverable',
  `      <WhatsAppRecoverableOpportunitiesV10 onOpenSource={(sourceId) => { setStatus('all'); setSelectedId(sourceId); }} />`,
  'recovery'
);

wrapPanel(
  'recovery work queue',
  'whatsapp-workspace-v13:recovery-work',
  `      <WhatsAppRecoveryWorkQueueV11 onOpenSource={(sourceId) => { setStatus('all'); setSelectedId(sourceId); }} />`,
  'recovery'
);

wrapPanel(
  'recovery kpis',
  'whatsapp-workspace-v13:recovery-kpis',
  `      <WhatsAppRecoveryCycleKpisV12 />`,
  'recovery'
);

fs.writeFileSync(file, src);
console.log('[whatsapp-workspace-v13] simplified tabbed workspace applied successfully');
require('./patch-whatsapp-daily-review-ux-v14.cjs');
