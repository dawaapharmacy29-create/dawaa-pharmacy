const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/Reviews.tsx');
let src = fs.readFileSync(file, 'utf8');

function patch(label, from, to) {
  if (src.includes(to)) {
    console.log(`[smart-review-v1] ${label}: already applied`);
    return;
  }
  if (!src.includes(from)) throw new Error(`[smart-review-v1] ${label}: anchor not found`);
  src = src.replace(from, to);
  console.log(`[smart-review-v1] ${label}: applied`);
}

patch(
  'smart mode state',
  `  const newOnlyMode = searchParams.get('mode') === 'new';\n  const historyOnlyMode = searchParams.get('section') === 'history';\n  const [saving, setSaving] = useState(false);`,
  `  const newOnlyMode = searchParams.get('mode') === 'new';\n  const historyOnlyMode = searchParams.get('section') === 'history';\n  const smartReviewEnabled = newOnlyMode && searchParams.get('classic') !== '1';\n  const [showDetailedCriteria, setShowDetailedCriteria] = useState(false);\n  const [smartTemplateApplied, setSmartTemplateApplied] = useState(false);\n  const [smartScenarios, setSmartScenarios] = useState<string[]>([]);\n  const [saving, setSaving] = useState(false);`
);

patch(
  'smart template helpers',
  `  const { data: staff } = useSupabaseQuery<StaffOpt>({`,
  `  const buildSmartHealthyState = useCallback((scenarios: string[]) => {\n    const next = defaultReviewState();\n\n    // البنود الأساسية الستة: السرعة، البداية/التعريف، الأسلوب، الفهم، البيع عند وجوده، الختام.\n    // كل البنود النادرة تظل غير مطبقة إلا لو المراجع اختار سيناريو واضح.\n    next.customer_name.applies = false;\n    next.followup_after_wait.applies = scenarios.includes('followup');\n    next.consultation_quality.applies = scenarios.includes('consultation');\n    next.dosage_explanation.applies = scenarios.includes('consultation');\n    next.unavailable_items.applies = scenarios.includes('unavailable');\n    next.sales_closing.applies = form.convertedToSale === 'yes';\n    next.cross_sell_upsell.applies = scenarios.includes('cross_sell');\n    next.angry_customer.applies = scenarios.includes('complaint');\n    next.order_confirmation.applies = form.convertedToSale === 'yes' || scenarios.includes('delivery');\n    next.order_delay_handling.applies = scenarios.includes('delay');\n    next.customer_request_registration.applies = scenarios.includes('unavailable_request');\n    next.exceptional_followup_recognition.applies = false;\n    next.purchase_history_usage.applies = false;\n    return next;\n  }, [form.convertedToSale]);\n\n  const applySmartHealthyTemplate = useCallback((scenarios = smartScenarios) => {\n    setReviewState(buildSmartHealthyState(scenarios));\n    setSevereErrors(defaultSevereErrors());\n    setSmartTemplateApplied(true);\n    setShowDetailedCriteria(false);\n    toast.success('تم تجهيز نموذج المحادثة السليمة — راجعي الملخص ثم احفظي');\n  }, [buildSmartHealthyState, smartScenarios]);\n\n  const toggleSmartScenario = useCallback((key: string) => {\n    const next = smartScenarios.includes(key)\n      ? smartScenarios.filter((item) => item !== key)\n      : [...smartScenarios, key];\n    setSmartScenarios(next);\n    if (smartTemplateApplied) setReviewState(buildSmartHealthyState(next));\n  }, [buildSmartHealthyState, smartScenarios, smartTemplateApplied]);\n\n  const { data: staff } = useSupabaseQuery<StaffOpt>({`
);

patch(
  'smart metadata in raw scores',
  `        raw_scores: {\n          criteria: selectedChoices,`,
  `        raw_scores: {\n          smart_review: smartReviewEnabled\n            ? {\n                mode: showDetailedCriteria ? 'smart_detailed' : 'smart_quick',\n                template: smartTemplateApplied ? 'healthy_standard_v1' : null,\n                scenarios: smartScenarios,\n                template_version: 'v1',\n              }\n            : null,\n          criteria: selectedChoices,`
);

patch(
  'reset smart state on next review',
  `    setRepeatInfo(null);\n    setDraftSavedAt(null);\n    setHumanDecision(null);\n    setFocusedEvidenceIds([]);\n    smartPrefillBaselineRef.current = {};\n    window.localStorage.removeItem(REVIEW_DRAFT_KEY);`,
  `    setRepeatInfo(null);\n    setDraftSavedAt(null);\n    setHumanDecision(null);\n    setFocusedEvidenceIds([]);\n    smartPrefillBaselineRef.current = {};\n    setSmartTemplateApplied(false);\n    setSmartScenarios([]);\n    setShowDetailedCriteria(false);\n    window.localStorage.removeItem(REVIEW_DRAFT_KEY);`
);

patch(
  'insert smart review cockpit',
  `          <section id="review-criteria-section" className="space-y-3">\n            {REVIEW_CRITERIA.map((criterion) => {`,
  `          {smartReviewEnabled ? (\n            <section className="stat-card space-y-4 border border-emerald-400/30 bg-emerald-500/5">\n              <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">\n                <div>\n                  <div className="text-lg font-black text-emerald-200">المراجعة الذكية السريعة</div>\n                  <p className="mt-1 text-sm text-slate-300">\n                    لو المحادثة سليمة اختاري السيناريوهات الموجودة فقط ثم طبقي النموذج. الحالات الاستثنائية فقط افتحي لها التقييم التفصيلي.\n                  </p>\n                </div>\n                <div className="flex flex-wrap gap-2">\n                  <button\n                    type="button"\n                    onClick={() => applySmartHealthyTemplate()}\n                    className="btn-primary min-h-11 px-5 text-base font-black"\n                  >\n                    ✓ المحادثة سليمة — جهّز التقييم\n                  </button>\n                  <button\n                    type="button"\n                    onClick={() => setShowDetailedCriteria((value) => !value)}\n                    className="btn-secondary min-h-11"\n                  >\n                    {showDetailedCriteria ? 'إخفاء التفاصيل' : 'فيها ملاحظة / فتح التفصيلي'}\n                  </button>\n                </div>\n              </div>\n\n              <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-3">\n                <div className="mb-2 text-xs font-black text-slate-300">اختاري فقط لو الحالة موجودة في المحادثة:</div>\n                <div className="flex flex-wrap gap-2">\n                  {[\n                    ['consultation', 'استشارة/جرعة'],\n                    ['unavailable', 'صنف ناقص/بديل'],\n                    ['unavailable_request', 'وعد بتوفير/تسجيل طلب'],\n                    ['delivery', 'أوردر/دليفري'],\n                    ['delay', 'تأخير أوردر'],\n                    ['followup', 'وعد بالرجوع'],\n                    ['complaint', 'شكوى/عميل غاضب'],\n                    ['cross_sell', 'فرصة بيع إضافية'],\n                  ].map(([key, label]) => {\n                    const active = smartScenarios.includes(key);\n                    return (\n                      <button\n                        key={key}\n                        type="button"\n                        onClick={() => toggleSmartScenario(key)}\n                        className={\`rounded-xl border px-3 py-2 text-sm font-black transition \${\n                          active\n                            ? 'border-cyan-300/60 bg-cyan-500/20 text-cyan-100'\n                            : 'border-slate-600 bg-slate-900/60 text-slate-300 hover:border-slate-400'\n                        }\`}\n                      >\n                        {active ? '✓ ' : ''}{label}\n                      </button>\n                    );\n                  })}\n                </div>\n              </div>\n\n              {smartTemplateApplied ? (\n                <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center rounded-2xl border border-emerald-400/25 bg-emerald-500/10 p-4">\n                  <div>\n                    <div className="font-black text-emerald-100">جاهز للحفظ السريع</div>\n                    <div className="mt-1 text-sm text-slate-200">\n                      النتيجة الحالية <span className="font-black">{result.finalScore}/100</span> · البنود المطبقة <span className="font-black">{result.totalApplicableItems}</span> · {smartScenarios.length ? \`سيناريوهات خاصة: \${smartScenarios.length}\` : 'محادثة اعتيادية'}\n                    </div>\n                  </div>\n                  <button\n                    type="button"\n                    disabled={saving}\n                    onClick={async () => {\n                      const ok = await save();\n                      if (ok) startNewReview();\n                    }}\n                    className="btn-primary min-h-12 px-6 text-base font-black"\n                  >\n                    {saving ? 'جاري الحفظ...' : 'حفظ وفتح التقييم التالي'}\n                  </button>\n                </div>\n              ) : null}\n            </section>\n          ) : null}\n\n          <section id="review-criteria-section" className={\`\${smartReviewEnabled && !showDetailedCriteria ? 'hidden' : ''} space-y-3\`}>\n            {REVIEW_CRITERIA.map((criterion) => {`
);

patch(
  'hide severe block in quick mode',
  `          <section className="stat-card border border-red-500/20 space-y-3">`,
  `          <section className={\`\${smartReviewEnabled && !showDetailedCriteria ? 'hidden' : ''} stat-card border border-red-500/20 space-y-3\`}>`
);

fs.writeFileSync(file, src);
console.log('[smart-review-v1] experimental smart review cockpit patched successfully');
