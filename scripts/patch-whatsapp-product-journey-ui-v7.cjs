const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/components/reviews/WhatsAppOperationalPanelV6.tsx');
let src = fs.readFileSync(file, 'utf8');

function patch(label, from, to) {
  if (src.includes(to)) { console.log(`[whatsapp-product-journey-ui-v7] ${label}: already applied`); return; }
  if (!src.includes(from)) throw new Error(`[whatsapp-product-journey-ui-v7] ${label}: anchor not found`);
  src = src.replace(from, to);
  console.log(`[whatsapp-product-journey-ui-v7] ${label}: applied`);
}

patch(
  'journey model',
  `  const recommendations = Array.isArray(operational?.recommendations) ? operational.recommendations : [];\n  const currentCycle = cycles[0] || null;`,
  `  const recommendations = Array.isArray(operational?.recommendations) ? operational.recommendations : [];\n  const productJourney = operational?.productJourney || null;\n  const productJourneys = Array.isArray(productJourney?.journeys) ? productJourney.journeys : [];\n  const currentCycle = cycles[0] || null;`
);

const journeyPanel = `\n    {productJourney ? <div className="rounded-2xl border border-cyan-400/20 bg-cyan-500/5 p-4">\n      <div className="flex flex-wrap items-center justify-between gap-2">\n        <div><div className="font-black text-cyan-100">رحلة الصنف والفرصة البيعية V7</div><div className="mt-1 text-xs text-slate-400">من الطلب والتوفر والبديل والترشيح لحد قبول العميل وإغلاق الأوردر ومطابقة الفاتورة.</div></div>\n        <div className="flex flex-wrap gap-2 text-xs">\n          <Badge tone={Number(productJourney.saleLeakageCount||0)>0?'amber':'green'}>فرص غير محسومة {Number(productJourney.saleLeakageCount||0)}</Badge>\n          <Badge>طلبات {Number(productJourney.requestedProducts||0)}</Badge>\n          <Badge>بدائل {Number(productJourney.alternativesOffered||0)}</Badge>\n          <Badge tone="green">قبول ترشيح {Number(productJourney.recommendationsAccepted||0)}</Badge>\n        </div>\n      </div>\n      <div className="mt-3 space-y-2">\n        {productJourneys.length ? productJourneys.map((j:any,i:number)=><div key={i} className="rounded-xl border border-slate-800 bg-slate-950/45 p-3">\n          <div className="flex flex-wrap items-center justify-between gap-2"><div className="font-black text-white">{j.productName || 'صنف غير محدد'}{j.productCode?<span className="mr-2 text-xs text-cyan-300">#{j.productCode}</span>:null}</div><Badge tone={j.closedInChat?'green':j.leakageReason?'amber':'slate'}>{j.currentStage}</Badge></div>\n          <div className="mt-2 flex flex-wrap gap-1.5">{Array.isArray(j.events)?j.events.map((e:any,k:number)=><span key={k} className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-[10px] text-slate-300">{e.stage} • {Math.round(Number(e.confidence||0))}%</span>):null}</div>\n          {j.leakageReason?<div className="mt-2 text-xs text-amber-200"><b>سبب توقف الفرصة:</b> {j.leakageReason}</div>:null}\n          <div className="mt-1 text-xs text-slate-400"><b className="text-slate-200">الخطوة التالية:</b> {j.nextAction}</div>\n        </div>) : <div className="text-sm text-slate-500">لم يتم استخراج رحلة صنف واضحة من هذه الجلسة.</div>}\n      </div>\n      <div className="mt-3 rounded-xl border border-cyan-400/15 bg-cyan-500/8 p-3 text-sm text-cyan-100"><b>أفضل إجراء تجاري:</b> {productJourney.nextBestCommercialAction}</div>\n      {productJourney.dominantLeakageReason?<div className="mt-2 text-xs text-amber-200">أكثر سبب واضح لفقد/تعطل الفرص: {productJourney.dominantLeakageReason}</div>:null}\n    </div> : null}\n`;

patch(
  'journey panel',
  `    <div className="rounded-2xl border border-violet-400/20 bg-violet-500/10 p-4"><div className="font-black text-violet-100">الخطوة التالية المقترحة</div>`,
  journeyPanel + `\n    <div className="rounded-2xl border border-violet-400/20 bg-violet-500/10 p-4"><div className="font-black text-violet-100">الخطوة التالية المقترحة</div>`
);

fs.writeFileSync(file, src);
console.log('[whatsapp-product-journey-ui-v7] product journey UI applied successfully');
