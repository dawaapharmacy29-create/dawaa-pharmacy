const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/Reviews.tsx');
let src = fs.readFileSync(file, 'utf8');

function patch(label, from, to) {
  if (src.includes(to)) {
    console.log(`[smart-review-v12] ${label}: already applied`);
    return;
  }
  if (!src.includes(from)) throw new Error(`[smart-review-v12] ${label}: anchor not found`);
  src = src.replace(from, to);
  console.log(`[smart-review-v12] ${label}: applied`);
}

patch(
  'make fast lane a roomy two-row panel',
  `              <div className="grid gap-4 rounded-2xl border border-emerald-400/20 bg-slate-950/45 p-4 md:grid-cols-2 xl:grid-cols-12">`,
  `              <div className="grid gap-5 rounded-2xl border border-emerald-400/25 bg-slate-950/55 p-5 md:grid-cols-2 xl:grid-cols-12 xl:gap-x-6 xl:gap-y-5">`
);

patch(
  'doctor half row',
  `                <label className="space-y-1 text-xs font-black text-slate-300 xl:col-span-3">`,
  `                <label className="space-y-2 rounded-xl border border-slate-700/70 bg-slate-900/45 p-3 text-xs font-black text-slate-300 xl:col-span-6">`
);

patch(
  'customer half row',
  `                <div className="space-y-1 rounded-xl border border-cyan-400/20 bg-cyan-500/5 p-2 text-xs font-black text-slate-300 xl:col-span-3">`,
  `                <div className="space-y-2 rounded-xl border border-cyan-400/30 bg-cyan-500/5 p-3 text-xs font-black text-slate-300 xl:col-span-6">`
);

patch(
  'sale full bottom third',
  `                <div className="space-y-1 text-xs font-black text-slate-300 xl:col-span-2">\n                  <span>3) اتحولت لبيع؟</span>`,
  `                <div className="space-y-2 rounded-xl border border-slate-700/60 bg-slate-900/35 p-3 text-xs font-black text-slate-300 xl:col-span-4">\n                  <span>3) اتحولت لبيع؟</span>`
);

patch(
  'response full bottom third',
  `                <div className="space-y-1 text-xs font-black text-slate-300 xl:col-span-2">\n                  <span>4) سرعة أول رد</span>`,
  `                <div className="space-y-2 rounded-xl border border-slate-700/60 bg-slate-900/35 p-3 text-xs font-black text-slate-300 xl:col-span-4">\n                  <span>4) سرعة أول رد</span>`
);

patch(
  'invoice full bottom third',
  `                <label className="space-y-1 text-xs font-black text-slate-300 xl:col-span-2">\n                  <span>5) رقم الفاتورة {form.convertedToSale === 'yes' ? '(مطلوب)' : '(لو موجود)'}</span>`,
  `                <label className="space-y-2 rounded-xl border border-slate-700/60 bg-slate-900/35 p-3 text-xs font-black text-slate-300 xl:col-span-4">\n                  <span>5) رقم الفاتورة {form.convertedToSale === 'yes' ? '(مطلوب)' : '(لو موجود)'}</span>`
);

patch(
  'customer search taller',
  `                        className="input-dark w-full pr-3 pl-16"`,
  `                        className="input-dark min-h-12 w-full pr-3 pl-16 text-sm"`
);

patch(
  'doctor select taller',
  `                    className="input-dark w-full"`,
  `                    className="input-dark min-h-12 w-full text-sm"`
);

fs.writeFileSync(file, src);
console.log('[smart-review-v12] two-row expanded identity strip patched successfully');
