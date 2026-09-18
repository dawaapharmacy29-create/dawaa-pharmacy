const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/Reviews.tsx');
let src = fs.readFileSync(file, 'utf8');

function patch(label, from, to) {
  if (src.includes(to)) {
    console.log(`[smart-review-v11] ${label}: already applied`);
    return;
  }
  if (!src.includes(from)) throw new Error(`[smart-review-v11] ${label}: anchor not found`);
  src = src.replace(from, to);
  console.log(`[smart-review-v11] ${label}: applied`);
}

patch(
  'wider 12-column fast lane',
  `              <div className="grid gap-3 rounded-2xl border border-emerald-400/20 bg-slate-950/45 p-3 md:grid-cols-2 xl:grid-cols-5">`,
  `              <div className="grid gap-4 rounded-2xl border border-emerald-400/20 bg-slate-950/45 p-4 md:grid-cols-2 xl:grid-cols-12">`
);

patch(
  'doctor gets more width',
  `                <label className="space-y-1 text-xs font-black text-slate-300">\n                  <span className="flex items-center justify-between gap-2">\n                    <span>1) الدكتور / الموظف</span>`,
  `                <label className="space-y-1 text-xs font-black text-slate-300 xl:col-span-3">\n                  <span className="flex items-center justify-between gap-2">\n                    <span>1) الدكتور / الموظف</span>`
);

patch(
  'customer gets prominent width and required label',
  `                <div className="space-y-1 text-xs font-black text-slate-300">\n                  <span className="flex items-center justify-between gap-2">\n                    <span>2) العميل</span>`,
  `                <div className="space-y-1 rounded-xl border border-cyan-400/20 bg-cyan-500/5 p-2 text-xs font-black text-slate-300 xl:col-span-3">\n                  <span className="flex items-center justify-between gap-2">\n                    <span>2) العميل <b className="text-rose-300">*</b></span>`
);

patch(
  'sale width',
  `                <div className="space-y-1 text-xs font-black text-slate-300">\n                  <span>3) اتحولت لبيع؟</span>`,
  `                <div className="space-y-1 text-xs font-black text-slate-300 xl:col-span-2">\n                  <span>3) اتحولت لبيع؟</span>`
);

patch(
  'response width',
  `                <div className="space-y-1 text-xs font-black text-slate-300">\n                  <span>4) سرعة أول رد</span>`,
  `                <div className="space-y-1 text-xs font-black text-slate-300 xl:col-span-2">\n                  <span>4) سرعة أول رد</span>`
);

patch(
  'invoice width',
  `                <label className="space-y-1 text-xs font-black text-slate-300">\n                  <span>5) رقم الفاتورة {form.convertedToSale === 'yes' ? '(مطلوب)' : '(لو موجود)'}</span>`,
  `                <label className="space-y-1 text-xs font-black text-slate-300 xl:col-span-2">\n                  <span>5) رقم الفاتورة {form.convertedToSale === 'yes' ? '(مطلوب)' : '(لو موجود)'}</span>`
);

patch(
  'selected customer shows richer details',
  `                          <span className="truncate text-emerald-100">{form.customerName}{form.customerCode ? ' · ' + form.customerCode : ''}</span>`,
  `                          <span className="min-w-0 text-emerald-100">\n                            <span className="block truncate text-xs font-black">{form.customerName}</span>\n                            <span className="block truncate text-[10px] font-bold text-emerald-200/80">\n                              {[form.customerCode, form.customerPhone, form.customerType].filter(Boolean).join(' · ') || 'عميل محدد'}\n                            </span>\n                          </span>`
);

patch(
  'customer name required in save guard',
  `    if (form.convertedToSale === '') {\n      toast.error('حدد هل المحادثة دي اتحولت لعملية بيع ولا لأ');\n      return false;\n    }`,
  `    if (!form.customerName.trim()) {\n      toast.error('اسم العميل إجباري — اختار العميل من قاعدة العملاء أو سجله يدويًا');\n      return false;\n    }\n    if (form.convertedToSale === '') {\n      toast.error('حدد هل المحادثة دي اتحولت لعملية بيع ولا لأ');\n      return false;\n    }`
);

fs.writeFileSync(file, src);
console.log('[smart-review-v11] wider fast lane + required customer applied successfully');
