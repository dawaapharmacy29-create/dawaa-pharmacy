const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/Reviews.tsx');
let src = fs.readFileSync(file, 'utf8');

function patch(label, from, to) {
  if (src.includes(to)) {
    console.log(`[smart-review-v10] ${label}: already applied`);
    return;
  }
  if (!src.includes(from)) throw new Error(`[smart-review-v10] ${label}: anchor not found`);
  src = src.replace(from, to);
  console.log(`[smart-review-v10] ${label}: applied`);
}

patch(
  'case level state',
  `  const [smartTemplateApplied, setSmartTemplateApplied] = useState(false);`,
  `  const [smartCaseLevel, setSmartCaseLevel] = useState<'clean' | 'note' | 'critical' | ''>('');\n  const [smartTemplateApplied, setSmartTemplateApplied] = useState(false);`
);

patch(
  'reset case level',
  `    setSmartManualCustomer(false);\n    setRepeatInfo(null);`,
  `    setSmartManualCustomer(false);\n    setSmartCaseLevel('');\n    setRepeatInfo(null);`
);

patch(
  'three-level decision cockpit',
  `                    للمحادثة السليمة: اختاري الدكتور وابحثي عن العميل بالاسم أو الكود أو الموبايل. لو جديد استخدمي الإدخال اليدوي. بعدها خدي قرار واحد: 1 = سليمة ≤5د بدون بيع وحفظ التالي. لو بيع: اختاري بيع، اكتبي الفاتورة، واعتمدي. أي ملاحظة فقط هي اللي تفتح التفاصيل.\n                  </p>`,
  `                    اختاري حالة المحادثة أولًا. السليمة تفضل على المسار السريع، والملاحظة البسيطة تفتح الاستثناءات فقط، والمشكلة المهمة تفتح التقييم الكامل.\n                  </p>\n\n                  <div className="mt-3 grid gap-2 md:grid-cols-3">\n                    <button\n                      type="button"\n                      onClick={() => {\n                        setSmartCaseLevel('clean');\n                        setShowDetailedCriteria(false);\n                        setShowSmartExtras(false);\n                        setSmartScenarios([]);\n                      }}\n                      className={'rounded-xl border px-3 py-3 text-sm font-black transition ' + (smartCaseLevel === 'clean' ? 'border-emerald-300 bg-emerald-500/15 text-emerald-100 ring-2 ring-emerald-400/30' : 'border-slate-700 bg-slate-900/60 text-slate-200 hover:border-emerald-400/40')}\n                    >\n                      ✅ سليمة تمامًا\n                      <div className="mt-1 text-[10px] font-bold opacity-70">المسار الأسرع — بدون فتح بنود إضافية</div>\n                    </button>\n                    <button\n                      type="button"\n                      onClick={() => {\n                        setSmartCaseLevel('note');\n                        setShowDetailedCriteria(false);\n                      }}\n                      className={'rounded-xl border px-3 py-3 text-sm font-black transition ' + (smartCaseLevel === 'note' ? 'border-amber-300 bg-amber-500/15 text-amber-100 ring-2 ring-amber-400/30' : 'border-slate-700 bg-slate-900/60 text-slate-200 hover:border-amber-400/40')}\n                    >\n                      🟡 ملاحظة بسيطة\n                      <div className="mt-1 text-[10px] font-bold opacity-70">اختاري الاستثناء فقط بدل فتح 19 بند</div>\n                    </button>\n                    <button\n                      type="button"\n                      onClick={() => {\n                        setSmartCaseLevel('critical');\n                        setShowDetailedCriteria(true);\n                        setShowSmartExtras(true);\n                      }}\n                      className={'rounded-xl border px-3 py-3 text-sm font-black transition ' + (smartCaseLevel === 'critical' ? 'border-rose-300 bg-rose-500/15 text-rose-100 ring-2 ring-rose-400/30' : 'border-slate-700 bg-slate-900/60 text-slate-200 hover:border-rose-400/40')}\n                    >\n                      🔴 مشكلة مهمة\n                      <div className="mt-1 text-[10px] font-bold opacity-70">يفتح التقييم الكامل للحالات الحساسة</div>\n                    </button>\n                  </div>\n\n                  <div className="mt-2 text-[11px] font-bold text-slate-400">\n                    {smartCaseLevel === 'clean' ? 'كملي الدكتور + العميل + البيع + سرعة الرد ثم اعتمدي.' : smartCaseLevel === 'note' ? 'اختاري نوع الملاحظة من الاستثناءات الموجودة أسفل النموذج.' : smartCaseLevel === 'critical' ? 'تم فتح التقييم الكامل تلقائيًا.' : 'اختاري واحدة من الحالات الثلاث لبدء التقييم.'}\n                  </div>`
);

patch(
  'store case level in smart metadata',
  `            template_version: 'v3',`,
  `            template_version: 'v3',\n            case_level: smartCaseLevel || 'unspecified',`
);

fs.writeFileSync(file, src);
console.log('[smart-review-v10] three-level decision flow patched successfully');
