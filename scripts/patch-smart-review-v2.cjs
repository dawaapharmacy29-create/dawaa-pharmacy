const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/Reviews.tsx');
let src = fs.readFileSync(file, 'utf8');

function patch(label, from, to) {
  if (src.includes(to)) {
    console.log(`[smart-review-v2] ${label}: already applied`);
    return;
  }
  if (!src.includes(from)) throw new Error(`[smart-review-v2] ${label}: anchor not found`);
  src = src.replace(from, to);
  console.log(`[smart-review-v2] ${label}: applied`);
}

patch(
  'fast lane state',
  `  const [showDetailedCriteria, setShowDetailedCriteria] = useState(false);\n  const [smartTemplateApplied, setSmartTemplateApplied] = useState(false);\n  const [smartScenarios, setSmartScenarios] = useState<string[]>([]);\n  const [saving, setSaving] = useState(false);`,
  `  const [showDetailedCriteria, setShowDetailedCriteria] = useState(false);\n  const [showSmartExtras, setShowSmartExtras] = useState(false);\n  const [smartTemplateApplied, setSmartTemplateApplied] = useState(false);\n  const [smartScenarios, setSmartScenarios] = useState<string[]>([]);\n  const [smartResponseBand, setSmartResponseBand] = useState<'within_5' | 'five_to_10' | 'over_10' | ''>('');\n  const [smartAutoSaveRequested, setSmartAutoSaveRequested] = useState(false);\n  const smartStartedAtRef = useRef(Date.now());\n  const [saving, setSaving] = useState(false);`
);

patch(
  'response band in healthy template',
  `    next.customer_name.applies = false;\n    next.followup_after_wait.applies = scenarios.includes('followup');`,
  `    next.customer_name.applies = false;\n    next.first_response_speed.applies = true;\n    next.first_response_speed.choice =\n      smartResponseBand === 'five_to_10'\n        ? 'five_to_10'\n        : smartResponseBand === 'over_10'\n          ? 'ten_to_20'\n          : 'within_5';\n    next.followup_after_wait.applies = scenarios.includes('followup');`
);

patch(
  'healthy template response dependency',
  `  }, [form.convertedToSale]);`,
  `  }, [form.convertedToSale, smartResponseBand]);`
);

patch(
  'quick save request helper',
  `  const toggleSmartScenario = useCallback((key: string) => {\n    const next = smartScenarios.includes(key)\n      ? smartScenarios.filter((item) => item !== key)\n      : [...smartScenarios, key];\n    setSmartScenarios(next);\n    if (smartTemplateApplied) setReviewState(buildSmartHealthyState(next));\n  }, [buildSmartHealthyState, smartScenarios, smartTemplateApplied]);`,
  `  const toggleSmartScenario = useCallback((key: string) => {\n    const next = smartScenarios.includes(key)\n      ? smartScenarios.filter((item) => item !== key)\n      : [...smartScenarios, key];\n    setSmartScenarios(next);\n    if (smartTemplateApplied) setReviewState(buildSmartHealthyState(next));\n  }, [buildSmartHealthyState, smartScenarios, smartTemplateApplied]);\n\n  const requestSmartQuickSave = useCallback(() => {\n    if (!form.staffId) {\n      toast.error('اختاري الدكتور أو الموظف أولًا');\n      return;\n    }\n    if (!form.convertedToSale) {\n      toast.error('حددي بسرعة: المحادثة اتحولت لبيع ولا لأ');\n      return;\n    }\n    if (form.convertedToSale === 'yes' && !form.invoiceNo.trim()) {\n      toast.error('اكتبي رقم الفاتورة قبل الاعتماد السريع');\n      return;\n    }\n    if (!smartResponseBand) {\n      toast.error('حددي سرعة أول رد قبل الاعتماد السريع');\n      return;\n    }\n    setReviewState(buildSmartHealthyState(smartScenarios));\n    setSevereErrors(defaultSevereErrors());\n    setSmartTemplateApplied(true);\n    setShowDetailedCriteria(false);\n    setSmartAutoSaveRequested(true);\n  }, [buildSmartHealthyState, form.convertedToSale, form.invoiceNo, form.staffId, smartResponseBand, smartScenarios]);`
);

patch(
  'smart audit metadata',
  `          smart_review: smartReviewEnabled\n            ? {\n                mode: showDetailedCriteria ? 'smart_detailed' : 'smart_quick',\n                template: smartTemplateApplied ? 'healthy_standard_v1' : null,\n                scenarios: smartScenarios,\n                template_version: 'v1',\n              }`,
  `          smart_review: smartReviewEnabled\n            ? {\n                mode: showDetailedCriteria ? 'smart_detailed' : 'smart_quick',\n                template: smartTemplateApplied ? 'healthy_standard_v2' : null,\n                scenarios: smartScenarios,\n                response_band: smartResponseBand || null,\n                template_version: 'v2',\n                review_duration_seconds: Math.max(0, Math.round((Date.now() - smartStartedAtRef.current) / 1000)),\n                audit_candidate: Boolean(\n                  !showDetailedCriteria &&\n                    selectedStaff?.id &&\n                    Array.from(String(selectedStaff.id + conversationDate + (form.invoiceNo || ''))).reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 10 === 0\n                ),\n              }`
);

patch(
  'reset v2 smart state',
  `    setSmartTemplateApplied(false);\n    setSmartScenarios([]);\n    setShowDetailedCriteria(false);\n    window.localStorage.removeItem(REVIEW_DRAFT_KEY);`,
  `    setSmartTemplateApplied(false);\n    setSmartScenarios([]);\n    setSmartResponseBand('');\n    setSmartAutoSaveRequested(false);\n    setShowSmartExtras(false);\n    setShowDetailedCriteria(false);\n    smartStartedAtRef.current = Date.now();\n    window.localStorage.removeItem(REVIEW_DRAFT_KEY);`
);

patch(
  'auto save after smart state settles',
  `  const openEdit = async (row: ConversationReviewHistoryRow) => {`,
  `  useEffect(() => {\n    if (!smartAutoSaveRequested || !smartTemplateApplied || saving) return;\n    setSmartAutoSaveRequested(false);\n    void (async () => {\n      const ok = await save();\n      if (ok) startNewReview();\n    })();\n    // save/startNewReview intentionally execute after the prepared state has rendered.\n    // eslint-disable-next-line react-hooks/exhaustive-deps\n  }, [smartAutoSaveRequested, smartTemplateApplied, saving, reviewState]);\n\n  const openEdit = async (row: ConversationReviewHistoryRow) => {`
);

patch(
  'hide legacy conversation section in smart mode',
  `          <section className="stat-card space-y-4">\n            <div className="section-title text-sm">بيانات المحادثة</div>`,
  `          <section className={\`\${smartReviewEnabled ? 'hidden' : ''} stat-card space-y-4\`}>\n            <div className="section-title text-sm">بيانات المحادثة</div>`
);

patch(
  'hide legacy customer section in smart mode',
  `          <section className="stat-card space-y-3">\n            <div className="section-title text-sm">العميل</div>`,
  `          <section className={\`\${smartReviewEnabled && !showSmartExtras ? 'hidden' : ''} stat-card space-y-3\`}>\n            <div className="section-title text-sm">العميل</div>`
);

patch(
  'hide legacy timing section in smart mode',
  `          <section className="stat-card space-y-3">\n            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">\n              <div className="section-title text-sm">توقيت الرد والمتابعة</div>`,
  `          <section className={\`\${smartReviewEnabled && !showSmartExtras ? 'hidden' : ''} stat-card space-y-3\`}>\n            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">\n              <div className="section-title text-sm">توقيت الرد والمتابعة</div>`
);

patch(
  'fast lane core controls',
  `              <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-3">\n                <div className="mb-2 text-xs font-black text-slate-300">اختاري فقط لو الحالة موجودة في المحادثة:</div>`,
  `              <div className="grid gap-3 rounded-2xl border border-emerald-400/20 bg-slate-950/45 p-3 lg:grid-cols-4">\n                <label className="space-y-1 text-xs font-black text-slate-300">\n                  <span>1) الدكتور / الموظف</span>\n                  <select\n                    className="input-dark w-full"\n                    value={form.staffId}\n                    onChange={(e) => setForm((current) => ({ ...current, staffId: e.target.value }))}\n                  >\n                    <option value="">اختاري الاسم</option>\n                    {staffOptions.map((row) => (\n                      <option key={row.id} value={row.id}>{row.name} - {row.branch}</option>\n                    ))}\n                  </select>\n                </label>\n                <div className="space-y-1 text-xs font-black text-slate-300">\n                  <span>2) اتحولت لبيع؟</span>\n                  <div className="grid grid-cols-2 gap-2">\n                    <button type="button" onClick={() => setForm((f) => ({ ...f, convertedToSale: 'yes' }))} className={\`rounded-xl border px-3 py-2 \${form.convertedToSale === 'yes' ? 'border-emerald-300 bg-emerald-500/20 text-emerald-100' : 'border-slate-600 text-slate-300'}\`}>نعم</button>\n                    <button type="button" onClick={() => setForm((f) => ({ ...f, convertedToSale: 'no', invoiceNo: '' }))} className={\`rounded-xl border px-3 py-2 \${form.convertedToSale === 'no' ? 'border-emerald-300 bg-emerald-500/20 text-emerald-100' : 'border-slate-600 text-slate-300'}\`}>لا</button>\n                  </div>\n                </div>\n                <div className="space-y-1 text-xs font-black text-slate-300">\n                  <span>3) سرعة أول رد</span>\n                  <div className="grid grid-cols-3 gap-1">\n                    {[['within_5', '≤5د'], ['five_to_10', '5-10د'], ['over_10', '>10د']].map(([key, label]) => (\n                      <button key={key} type="button" onClick={() => { setSmartResponseBand(key as typeof smartResponseBand); if (smartTemplateApplied) setReviewState(buildSmartHealthyState(smartScenarios)); }} className={\`rounded-lg border px-2 py-2 \${smartResponseBand === key ? 'border-cyan-300 bg-cyan-500/20 text-cyan-100' : 'border-slate-600 text-slate-300'}\`}>{label}</button>\n                    ))}\n                  </div>\n                </div>\n                <label className="space-y-1 text-xs font-black text-slate-300">\n                  <span>4) رقم الفاتورة {form.convertedToSale === 'yes' ? '(مطلوب)' : '(لو موجود)'}</span>\n                  <input className="input-dark w-full" value={form.invoiceNo} onChange={(e) => setForm((f) => ({ ...f, invoiceNo: e.target.value }))} placeholder="رقم الفاتورة" />\n                </label>\n              </div>\n\n              <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-3">\n                <div className="mb-2 text-xs font-black text-slate-300">4) هل في حالة خاصة؟ اختاري الموجود فقط — وسيبِي الباقي:</div>`
);

patch(
  'replace prepare button with one click save',
  `                    onClick={() => applySmartHealthyTemplate()}\n                    className="btn-primary min-h-11 px-5 text-base font-black"\n                  >\n                    ✓ المحادثة سليمة — جهّز التقييم`,
  `                    onClick={requestSmartQuickSave}\n                    disabled={saving || smartAutoSaveRequested}\n                    className="btn-primary min-h-11 px-5 text-base font-black"\n                  >\n                    {saving || smartAutoSaveRequested ? 'جاري الحفظ...' : '✓ سليمة — اعتماد وحفظ التالي'}`
);

patch(
  'extras button beside detailed',
  `                  <button\n                    type="button"\n                    onClick={() => setShowDetailedCriteria((value) => !value)}\n                    className="btn-secondary min-h-11"\n                  >\n                    {showDetailedCriteria ? 'إخفاء التفاصيل' : 'فيها ملاحظة / فتح التفصيلي'}\n                  </button>`,
  `                  <button\n                    type="button"\n                    onClick={() => setShowDetailedCriteria((value) => !value)}\n                    className="btn-secondary min-h-11"\n                  >\n                    {showDetailedCriteria ? 'إخفاء التفاصيل' : 'فيها ملاحظة / فتح التفصيلي'}\n                  </button>\n                  <button\n                    type="button"\n                    onClick={() => setShowSmartExtras((value) => !value)}\n                    className="btn-secondary min-h-11"\n                  >\n                    {showSmartExtras ? 'إخفاء البيانات الإضافية' : 'العميل / التوقيت / بيانات إضافية'}\n                  </button>`
);

fs.writeFileSync(file, src);
console.log('[smart-review-v2] guarded fast lane patched successfully');
