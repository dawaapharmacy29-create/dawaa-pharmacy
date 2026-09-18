const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/WhatsAppConversationAnalyzer.tsx');
let src = fs.readFileSync(file, 'utf8');

function patch(label, from, to) {
  if (src.includes(to)) { console.log(`[whatsapp-media-ui-v4] ${label}: already applied`); return; }
  if (!src.includes(from)) throw new Error(`[whatsapp-media-ui-v4] ${label}: anchor not found`);
  src = src.replace(from, to);
  console.log(`[whatsapp-media-ui-v4] ${label}: applied`);
}

patch(
  'context quality badges',
  `<span className="rounded-full border border-cyan-400/25 bg-cyan-500/10 px-3 py-1 text-cyan-200">ثقة {unifiedModel?.confidence ?? 0}%</span>`,
  `<span className="rounded-full border border-cyan-400/25 bg-cyan-500/10 px-3 py-1 text-cyan-200">ثقة {unifiedModel?.confidence ?? 0}%</span>\n                      <span className="rounded-full border border-sky-400/25 bg-sky-500/10 px-3 py-1 text-sky-200">جودة السياق {unifiedModel?.contextQuality ?? 100}%</span>\n                      {unifiedModel?.mediaEvidence?.total ? <span className="rounded-full border border-fuchsia-400/25 bg-fuchsia-500/10 px-3 py-1 text-fuchsia-200">وسائط {unifiedModel.mediaEvidence.total} • المتاح {unifiedModel.mediaEvidence.coveragePercent}%</span> : null}`
);

const panel = `\n                {unifiedModel?.mediaEvidence ? (\n                  <div className="mt-3 rounded-2xl border border-sky-400/20 bg-sky-500/5 p-3">\n                    <div className="flex flex-wrap items-center justify-between gap-2">\n                      <div className="font-black text-sky-100">تغطية السياق والوسائط</div>\n                      <div className="text-xs font-black text-sky-200">Replies {unifiedModel.mediaEvidence.replies} • Forwarded {unifiedModel.mediaEvidence.forwarded}</div>\n                    </div>\n                    <div className="mt-2 grid gap-2 grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 text-xs">\n                      <div className="rounded-xl border border-white/10 bg-white/5 p-2">صور: <b>{unifiedModel.mediaEvidence.images}</b></div>\n                      <div className="rounded-xl border border-white/10 bg-white/5 p-2">فويس: <b>{unifiedModel.mediaEvidence.voices}</b></div>\n                      <div className="rounded-xl border border-white/10 bg-white/5 p-2">فيديو: <b>{unifiedModel.mediaEvidence.videos}</b></div>\n                      <div className="rounded-xl border border-white/10 bg-white/5 p-2">مستندات: <b>{unifiedModel.mediaEvidence.documents}</b></div>\n                      <div className="rounded-xl border border-white/10 bg-white/5 p-2">مفقود: <b className={unifiedModel.mediaEvidence.missingContent ? 'text-amber-300' : 'text-emerald-300'}>{unifiedModel.mediaEvidence.missingContent}</b></div>\n                      <div className="rounded-xl border border-white/10 bg-white/5 p-2">Coverage: <b>{unifiedModel.mediaEvidence.coveragePercent}%</b></div>\n                    </div>\n                    {unifiedModel.mediaEvidence.limitation ? <div className="mt-2 text-xs leading-6 text-amber-200">⚠️ {unifiedModel.mediaEvidence.limitation}</div> : <div className="mt-2 text-xs text-emerald-200">كل الوسائط المشار إليها متاحة للسياق الحالي.</div>}\n                  </div>\n                ) : null}\n`;

patch(
  'media coverage panel',
  `                {unifiedModel?.lostSales.length ? (`,
  panel + `                {unifiedModel?.lostSales.length ? (`
);

fs.writeFileSync(file, src);
console.log('[whatsapp-media-ui-v4] media and context quality UI applied successfully');
