const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/Reviews.tsx');
let src = fs.readFileSync(file, 'utf8');

function patch(label, from, to) {
  if (src.includes(to)) {
    console.log(`[smart-review-v3] ${label}: already applied`);
    return;
  }
  if (!src.includes(from)) throw new Error(`[smart-review-v3] ${label}: anchor not found`);
  src = src.replace(from, to);
  console.log(`[smart-review-v3] ${label}: applied`);
}

patch(
  'batch mode state',
  `  const [showSmartExtras, setShowSmartExtras] = useState(false);\n  const [smartTemplateApplied, setSmartTemplateApplied] = useState(false);`,
  `  const [showSmartExtras, setShowSmartExtras] = useState(false);\n  const [keepSmartDoctor, setKeepSmartDoctor] = useState(false);\n  const [smartTemplateApplied, setSmartTemplateApplied] = useState(false);`
);

patch(
  'preserve doctor in batch mode',
  `  const startNewReview = () => {\n    setForm({ ...emptyReviewForm, reviewerId: user?.id || '', conversationDate: isoInputNow() });`,
  `  const startNewReview = () => {\n    const preservedStaffId = keepSmartDoctor ? form.staffId : '';\n    setForm({ ...emptyReviewForm, reviewerId: user?.id || '', staffId: preservedStaffId, conversationDate: isoInputNow() });`
);

patch(
  'add batch checkbox',
  `                <label className="space-y-1 text-xs font-black text-slate-300">\n                  <span>1) الدكتور / الموظف</span>\n                  <select`,
  `                <label className="space-y-1 text-xs font-black text-slate-300">\n                  <span className="flex items-center justify-between gap-2">\n                    <span>1) الدكتور / الموظف</span>\n                    <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-200">\n                      <input type="checkbox" checked={keepSmartDoctor} onChange={(e) => setKeepSmartDoctor(e.target.checked)} />\n                      ثبّت للتالي\n                    </span>\n                  </span>\n                  <select`
);

patch(
  'ultra fast presets',
  `              <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-3">\n                <div className="mb-2 text-xs font-black text-slate-300">4) هل في حالة خاصة؟ اختاري الموجود فقط — وسيبِي الباقي:</div>`,
  `              <div className="grid gap-2 sm:grid-cols-2">\n                <button\n                  type="button"\n                  disabled={saving || smartAutoSaveRequested || !form.staffId}\n                  onClick={() => {\n                    setForm((f) => ({ ...f, convertedToSale: 'no', invoiceNo: '' }));\n                    setSmartResponseBand('within_5');\n                    setReviewState(() => {\n                      const next = defaultReviewState();\n                      next.customer_name.applies = false;\n                      next.first_response_speed.applies = true;\n                      next.first_response_speed.choice = 'within_5';\n                      next.followup_after_wait.applies = false;\n                      next.consultation_quality.applies = false;\n                      next.dosage_explanation.applies = false;\n                      next.unavailable_items.applies = false;\n                      next.sales_closing.applies = false;\n                      next.cross_sell_upsell.applies = false;\n                      next.angry_customer.applies = false;\n                      next.order_confirmation.applies = false;\n                      next.order_delay_handling.applies = false;\n                      next.customer_request_registration.applies = false;\n                      next.exceptional_followup_recognition.applies = false;\n                      next.purchase_history_usage.applies = false;\n                      return next;\n                    });\n                    setSevereErrors(defaultSevereErrors());\n                    setSmartScenarios([]);\n                    setSmartTemplateApplied(true);\n                    setShowDetailedCriteria(false);\n                    setSmartAutoSaveRequested(true);\n                  }}\n                  className="min-h-14 rounded-2xl border border-emerald-300/50 bg-emerald-500/20 px-4 text-base font-black text-emerald-100 transition hover:bg-emerald-500/30 disabled:opacity-50"\n                >\n                  ⚡ سليمة ≤5د — بدون بيع — حفظ التالي\n                </button>\n                <button\n                  type="button"\n                  disabled={!form.staffId}\n                  onClick={() => {\n                    setForm((f) => ({ ...f, convertedToSale: 'yes' }));\n                    setSmartResponseBand('within_5');\n                  }}\n                  className="min-h-14 rounded-2xl border border-cyan-300/40 bg-cyan-500/10 px-4 text-base font-black text-cyan-100 transition hover:bg-cyan-500/20 disabled:opacity-50"\n                >\n                  ⚡ سليمة ≤5د — بيع — أدخل الفاتورة ثم اعتمد\n                </button>\n              </div>\n\n              <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-3">\n                <div className="mb-2 text-xs font-black text-slate-300">هل في حالة خاصة؟ اختاري الموجود فقط — وسيبِي الباقي:</div>`
);

fs.writeFileSync(file, src);
console.log('[smart-review-v3] batch mode and ultra-fast presets patched successfully');
