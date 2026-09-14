const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/Reviews.tsx');
let src = fs.readFileSync(file, 'utf8');

function patch(label, from, to) {
  if (src.includes(to)) {
    console.log(`[smart-review-v6] ${label}: already applied`);
    return;
  }
  if (!src.includes(from)) throw new Error(`[smart-review-v6] ${label}: anchor not found`);
  src = src.replace(from, to);
  console.log(`[smart-review-v6] ${label}: applied`);
}

patch(
  'skip draft writes in clean quick lane',
  `  useEffect(() => {\n    if (!draftRestored) return;\n    const timer = window.setTimeout(() => {`,
  `  useEffect(() => {\n    if (!draftRestored) return;\n    // The clean smart lane is intentionally ephemeral: every extra localStorage write adds\n    // serialization + main-thread work while the reviewer is trying to move conversation-to-conversation.\n    // Detailed/extras modes keep the draft protection because they involve more manual input.\n    if (smartReviewEnabled && !showDetailedCriteria && !showSmartExtras) return;\n    const timer = window.setTimeout(() => {`
);

patch(
  'draft dependencies include smart lane guards',
  `  }, [custSearch, draftRestored, form, reviewState, severeErrors]);`,
  `  }, [custSearch, draftRestored, form, reviewState, severeErrors, smartReviewEnabled, showDetailedCriteria, showSmartExtras]);`
);

patch(
  'scroll to cockpit after next review',
  `    window.localStorage.removeItem(REVIEW_DRAFT_KEY);\n  };`,
  `    window.localStorage.removeItem(REVIEW_DRAFT_KEY);\n    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'auto' }));\n  };`
);

patch(
  'two minute sla banner',
  `                  <div className="text-lg font-black text-emerald-200">المراجعة الذكية السريعة</div>`,
  `                  <div className="flex flex-wrap items-center gap-2">\n                    <div className="text-lg font-black text-emerald-200">المراجعة الذكية السريعة</div>\n                    <span className="rounded-full border border-emerald-300/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-black text-emerald-100">هدف التشغيل: أقل من دقيقتين للمحادثة السليمة</span>\n                  </div>`
);

patch(
  'clarify one decision workflow',
  `                    الطبيعي يمشي بالمسار السريع، والاستثناء فقط يفتح التفاصيل. اختصارات آمنة خارج حقول الكتابة: 1 = سليمة ≤5د بدون بيع وحفظ التالي، 2 = فتح التفصيلي، 3 = البيانات الإضافية.`,
  `                    للمحادثة السليمة: راجعي الشات ثم خدي قرار واحد فقط. 1 = سليمة ≤5د بدون بيع وحفظ التالي. لو بيع: اختاري بيع، اكتبي الفاتورة، واعتمدي. أي ملاحظة فقط هي اللي تفتح التفاصيل. 2 = التفصيلي، 3 = البيانات الإضافية.`
);

fs.writeFileSync(file, src);
console.log('[smart-review-v6] sub-two-minute review session optimizations patched successfully');
