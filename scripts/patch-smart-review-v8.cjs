const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/Reviews.tsx');
let src = fs.readFileSync(file, 'utf8');

function patch(label, from, to) {
  if (src.includes(to)) {
    console.log(`[smart-review-v8] ${label}: already applied`);
    return;
  }
  if (!src.includes(from)) throw new Error(`[smart-review-v8] ${label}: anchor not found`);
  src = src.replace(from, to);
  console.log(`[smart-review-v8] ${label}: applied`);
}

patch(
  'expand fast lane to five columns',
  `              <div className="grid gap-3 rounded-2xl border border-emerald-400/20 bg-slate-950/45 p-3 lg:grid-cols-4">`,
  `              <div className="grid gap-3 rounded-2xl border border-emerald-400/20 bg-slate-950/45 p-3 md:grid-cols-2 xl:grid-cols-5">`
);

patch(
  'customer name in primary fast lane',
  `                  </select>\n                </label>\n                <div className="space-y-1 text-xs font-black text-slate-300">\n                  <span>2) اتحولت لبيع؟</span>`,
  `                  </select>\n                </label>\n                <label className="space-y-1 text-xs font-black text-slate-300">\n                  <span className="flex items-center justify-between gap-2">\n                    <span>2) اسم العميل</span>\n                    <span className="text-[10px] font-bold text-slate-500">اختياري</span>\n                  </span>\n                  <input\n                    className="input-dark w-full"\n                    value={form.customerName}\n                    onChange={(e) => setForm((current) => ({ ...current, customerName: e.target.value }))}\n                    placeholder="اسم العميل"\n                    autoComplete="off"\n                  />\n                </label>\n                <div className="space-y-1 text-xs font-black text-slate-300">\n                  <span>3) اتحولت لبيع؟</span>`
);

patch(
  'renumber response speed',
  `                  <span>3) سرعة أول رد</span>`,
  `                  <span>4) سرعة أول رد</span>`
);

patch(
  'renumber invoice',
  `                  <span>4) رقم الفاتورة {form.convertedToSale === 'yes' ? '(مطلوب)' : '(لو موجود)'}</span>`,
  `                  <span>5) رقم الفاتورة {form.convertedToSale === 'yes' ? '(مطلوب)' : '(لو موجود)'}</span>`
);

patch(
  'fast lane helper mentions visible customer',
  `                    للمحادثة السليمة: راجعي الشات ثم خدي قرار واحد فقط. 1 = سليمة ≤5د بدون بيع وحفظ التالي. لو بيع: اختاري بيع، اكتبي الفاتورة، واعتمدي. أي ملاحظة فقط هي اللي تفتح التفاصيل. 2 = التفصيلي، 3 = البيانات الإضافية.`,
  `                    للمحادثة السليمة: اختاري الدكتور، واكتبي اسم العميل لو متاح، ثم خدي قرار واحد. 1 = سليمة ≤5د بدون بيع وحفظ التالي. لو بيع: اختاري بيع، اكتبي الفاتورة، واعتمدي. أي ملاحظة فقط هي اللي تفتح التفاصيل. 2 = التفصيلي، 3 = البيانات الإضافية.`
);

fs.writeFileSync(file, src);
console.log('[smart-review-v8] customer-first fast lane patched successfully');
