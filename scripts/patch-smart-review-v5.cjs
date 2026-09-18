const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/Reviews.tsx');
let src = fs.readFileSync(file, 'utf8');

function patch(label, from, to) {
  if (src.includes(to)) {
    console.log(`[smart-review-v5] ${label}: already applied`);
    return;
  }
  if (!src.includes(from)) throw new Error(`[smart-review-v5] ${label}: anchor not found`);
  src = src.replace(from, to);
  console.log(`[smart-review-v5] ${label}: applied`);
}

patch(
  'safe smart keyboard shortcuts',
  `  const { data: staff } = useSupabaseQuery<StaffOpt>({`,
  `  useEffect(() => {\n    if (!smartReviewEnabled) return;\n    const onKeyDown = (event: KeyboardEvent) => {\n      const target = event.target as HTMLElement | null;\n      const tag = target?.tagName?.toLowerCase();\n      const editingText =\n        tag === 'input' || tag === 'textarea' || tag === 'select' || Boolean(target?.isContentEditable);\n      if (editingText || event.ctrlKey || event.metaKey || event.altKey) return;\n\n      if (event.key === '1') {\n        event.preventDefault();\n        if (!form.staffId) { toast.error('اختاري الدكتور أولًا'); return; }\n        setForm((f) => ({ ...f, convertedToSale: 'no', invoiceNo: '' }));\n        setSmartResponseBand('within_5');\n        setReviewState(() => {\n          const next = defaultReviewState();\n          next.customer_name.applies = false;\n          next.first_response_speed.applies = true;\n          next.first_response_speed.choice = 'within_5';\n          next.followup_after_wait.applies = false;\n          next.consultation_quality.applies = false;\n          next.dosage_explanation.applies = false;\n          next.unavailable_items.applies = false;\n          next.sales_closing.applies = false;\n          next.cross_sell_upsell.applies = false;\n          next.angry_customer.applies = false;\n          next.order_confirmation.applies = false;\n          next.order_delay_handling.applies = false;\n          next.customer_request_registration.applies = false;\n          next.exceptional_followup_recognition.applies = false;\n          next.purchase_history_usage.applies = false;\n          return next;\n        });\n        setSevereErrors(defaultSevereErrors());\n        setSmartScenarios([]);\n        setSmartTemplateApplied(true);\n        setShowDetailedCriteria(false);\n        setSmartAutoSaveRequested(true);\n      } else if (event.key === '2') {\n        event.preventDefault();\n        setShowDetailedCriteria(true);\n      } else if (event.key === '3') {\n        event.preventDefault();\n        setShowSmartExtras((value) => !value);\n      }\n    };\n    window.addEventListener('keydown', onKeyDown);\n    return () => window.removeEventListener('keydown', onKeyDown);\n  }, [form.staffId, smartReviewEnabled]);\n\n  const { data: staff } = useSupabaseQuery<StaffOpt>({`
);

patch(
  'smart shortcut hints and classic fallback',
  `                  <button\n                    type="button"\n                    onClick={() => setShowSmartExtras((value) => !value)}\n                    className="btn-secondary min-h-11"\n                  >\n                    {showSmartExtras ? 'إخفاء البيانات الإضافية' : 'العميل / التوقيت / بيانات إضافية'}\n                  </button>`,
  `                  <button\n                    type="button"\n                    onClick={() => setShowSmartExtras((value) => !value)}\n                    className="btn-secondary min-h-11"\n                  >\n                    {showSmartExtras ? 'إخفاء البيانات الإضافية' : 'العميل / التوقيت / بيانات إضافية'}\n                  </button>\n                  <button\n                    type="button"\n                    onClick={() => navigate('/reviews?mode=new&classic=1', { replace: true })}\n                    className="btn-secondary min-h-11"\n                  >\n                    النموذج الكلاسيكي\n                  </button>`
);

patch(
  'shortcut helper text',
  `                  <p className="mt-1 text-sm text-slate-300">\n                    لو المحادثة سليمة اختاري السيناريوهات الموجودة فقط ثم طبقي النموذج. الحالات الاستثنائية فقط افتحي لها التقييم التفصيلي.\n                  </p>`,
  `                  <p className="mt-1 text-sm text-slate-300">\n                    الطبيعي يمشي بالمسار السريع، والاستثناء فقط يفتح التفاصيل. اختصارات آمنة خارج حقول الكتابة: 1 = سليمة ≤5د بدون بيع وحفظ التالي، 2 = فتح التفصيلي، 3 = البيانات الإضافية.\n                  </p>`
);

fs.writeFileSync(file, src);
console.log('[smart-review-v5] safe keyboard shortcuts and classic fallback patched successfully');
