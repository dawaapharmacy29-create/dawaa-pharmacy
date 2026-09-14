const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/Reviews.tsx');
let src = fs.readFileSync(file, 'utf8');

function replaceOnce(label, from, to) {
  if (!src.includes(from)) {
    if (src.includes(to)) {
      console.log(`[reviews-history-v2] ${label}: already applied`);
      return;
    }
    throw new Error(`[reviews-history-v2] ${label}: anchor not found`);
  }
  src = src.replace(from, to);
  console.log(`[reviews-history-v2] ${label}: applied`);
}

replaceOnce(
  'detail select',
  `const REVIEW_HISTORY_SELECT =\n  'id,created_at,updated_at,reviewer_id,reviewer_name,reviewer_role,staff_id,doctor_id,staff_name,staff_role,doctor_name,branch,customer_id,customer_name,customer_code,customer_phone,invoice_number,evaluation_kind,conversation_type,evaluation_reason,conversation_date,total_score,final_score,level,point_impact,doctor_points_impact,main_positive_reason,main_negative_reason,reviewer_notes,training_recommendation,month_cycle,manager_review_score,manager_review_notes,manager_reviewed_by,manager_reviewed_at';`,
  `const REVIEW_HISTORY_SELECT =\n  'id,created_at,updated_at,reviewer_id,reviewer_name,reviewer_role,staff_id,doctor_id,staff_name,staff_role,doctor_name,branch,customer_id,customer_name,customer_code,customer_phone,invoice_number,evaluation_kind,conversation_type,evaluation_reason,conversation_date,total_score,final_score,level,point_impact,doctor_points_impact,main_positive_reason,main_negative_reason,reviewer_notes,training_recommendation,month_cycle,manager_review_score,manager_review_notes,manager_reviewed_by,manager_reviewed_at';\nconst REVIEW_DETAIL_SELECT = \`${'${REVIEW_HISTORY_SELECT}'},raw_scores,review_items,repeat_count,repeat_multiplier\`;`
);

replaceOnce(
  'history filter state',
  `  // فلاتر سجل التقييمات: دكتور / عميل / تاريخ من - إلى\n  const [historyFilterStaffId, setHistoryFilterStaffId] = useState('');\n  const [historyFilterCustomer, setHistoryFilterCustomer] = useState('');\n  const [historyFilterDateFrom, setHistoryFilterDateFrom] = useState('');\n  const [historyFilterDateTo, setHistoryFilterDateTo] = useState('');\n  const historyFilterCustomerDebounced = useDebounce(historyFilterCustomer, 350);`,
  `  // فلاتر سجل التقييمات: الدكتور / المراجع / الفرع / الدرجة / العميل / التاريخ\n  const [historyFilterStaffId, setHistoryFilterStaffId] = useState('');\n  const [historyFilterReviewer, setHistoryFilterReviewer] = useState('');\n  const [historyFilterBranch, setHistoryFilterBranch] = useState('');\n  const [historyFilterScore, setHistoryFilterScore] = useState('');\n  const [historyFilterCustomer, setHistoryFilterCustomer] = useState('');\n  const [historyFilterDateFrom, setHistoryFilterDateFrom] = useState('');\n  const [historyFilterDateTo, setHistoryFilterDateTo] = useState('');\n  const historyFilterCustomerDebounced = useDebounce(historyFilterCustomer, 350);\n  const historyFilterReviewerDebounced = useDebounce(historyFilterReviewer, 250);\n  const [detailLoading, setDetailLoading] = useState(false);\n  const reviewDetailCacheRef = useRef(new Map<string, ConversationReviewHistoryRow>());`
);

replaceOnce(
  'detail loader',
  `  const openReviewDetails = useCallback((row: ConversationReviewHistoryRow) => {\n    setSelectedReview(row);\n    setSelectedReviewId(row.id || null);\n  }, []);`,
  `  const fetchReviewDetails = useCallback(async (row: ConversationReviewHistoryRow) => {\n    if (!row.id) return row;\n    const cached = reviewDetailCacheRef.current.get(row.id);\n    if (cached) return { ...row, ...cached };\n    setDetailLoading(true);\n    try {\n      const { data, error } = await supabase\n        .from('conversation_sales_reviews')\n        .select(REVIEW_DETAIL_SELECT)\n        .eq('id', row.id)\n        .maybeSingle();\n      if (error) throw error;\n      if (!data) throw new Error('لم يتم العثور على التقييم');\n      const merged = { ...row, ...(data as ConversationReviewHistoryRow) };\n      reviewDetailCacheRef.current.set(row.id, merged);\n      return merged;\n    } finally {\n      setDetailLoading(false);\n    }\n  }, []);\n\n  const openReviewDetails = useCallback((row: ConversationReviewHistoryRow) => {\n    setSelectedReview(row);\n    setSelectedReviewId(row.id || null);\n    if (!row.id || row.raw_scores != null || row.review_items != null) return;\n    void fetchReviewDetails(row)\n      .then((fullRow) => setSelectedReview((current) => current?.id === row.id ? fullRow : current))\n      .catch((error) => toast.error(\`تعذر تحميل تفاصيل التقييم كاملة: \${(error as Error).message}\`));\n  }, [fetchReviewDetails]);`
);

replaceOnce(
  'deep link targeted select',
  `.from('conversation_sales_reviews')\n      .select('*')\n      .eq('id', reviewId)`,
  `.from('conversation_sales_reviews')\n      .select(REVIEW_DETAIL_SELECT)\n      .eq('id', reviewId)`
);

replaceOnce(
  'filters active',
  `  const historyFiltersActive = Boolean(\n    historyFilterStaffId || historyFilterCustomerDebounced.trim() || historyFilterDateFrom || historyFilterDateTo\n  );`,
  `  const historyFiltersActive = Boolean(\n    historyFilterStaffId || historyFilterReviewerDebounced.trim() || historyFilterBranch || historyFilterScore ||\n    historyFilterCustomerDebounced.trim() || historyFilterDateFrom || historyFilterDateTo\n  );`
);

replaceOnce(
  'server filters',
  `        const customerTerm = historyFilterCustomerDebounced.trim();\n        if (customerTerm) {\n          const escaped = customerTerm.replace(/[%,]/g, '');\n          q = q.or(\n            \`customer_name.ilike.%\${escaped}%,customer_phone.ilike.%\${escaped}%,customer_code.ilike.%\${escaped}%\`\n          );\n        }\n        if (historyFilterDateFrom) {`,
  `        const reviewerTerm = historyFilterReviewerDebounced.trim();\n        if (reviewerTerm) {\n          q = q.ilike('reviewer_name', \`%\${reviewerTerm.replace(/[%,]/g, '')}%\`);\n        }\n        if (historyFilterBranch) q = q.eq('branch', historyFilterBranch);\n        if (historyFilterScore === '100') q = q.eq('final_score', 100);\n        if (historyFilterScore === '90_99') q = q.gte('final_score', 90).lt('final_score', 100);\n        if (historyFilterScore === '70_89') q = q.gte('final_score', 70).lt('final_score', 90);\n        if (historyFilterScore === 'below70') q = q.lt('final_score', 70);\n\n        const customerTerm = historyFilterCustomerDebounced.trim();\n        if (customerTerm) {\n          const escaped = customerTerm.replace(/[%,]/g, '');\n          q = q.or(\n            \`customer_name.ilike.%\${escaped}%,customer_phone.ilike.%\${escaped}%,customer_code.ilike.%\${escaped}%\`\n          );\n        }\n        if (historyFilterDateFrom) {`
);

replaceOnce(
  'filter dependencies',
  `    historyFilterStaffId,\n    historyFilterCustomerDebounced,\n    historyFilterDateFrom,\n    historyFilterDateTo,`,
  `    historyFilterStaffId,\n    historyFilterReviewerDebounced,\n    historyFilterBranch,\n    historyFilterScore,\n    historyFilterCustomerDebounced,\n    historyFilterDateFrom,\n    historyFilterDateTo,`
);

replaceOnce(
  'remove duplicate detail hydration',
  `  useEffect(() => {\n    const id = selectedReviewId;\n    if (!id || !selectedReview || selectedReview.id !== id) return;\n    if (selectedReview.raw_scores != null || selectedReview.review_items != null) return;\n\n    let cancelled = false;\n    supabase\n      .from('conversation_sales_reviews')\n      .select('*')\n      .eq('id', id)\n      .maybeSingle()\n      .then(({ data, error }) => {\n        if (cancelled || error || !data) return;\n        setSelectedReview(data as ConversationReviewHistoryRow);\n      })\n      .catch(() => {\n        // The lightweight row still keeps the history usable if detail hydration fails.\n      });\n\n    return () => {\n      cancelled = true;\n    };\n  }, [selectedReviewId, selectedReview]);\n\n`,
  ``
);

replaceOnce(
  'edit targeted details',
  `  const openEdit = async (row: ConversationReviewHistoryRow) => {\n    let fullRow = row;\n    if (row.id && row.raw_scores == null && row.review_items == null) {\n      const { data, error } = await supabase\n        .from('conversation_sales_reviews')\n        .select('*')\n        .eq('id', row.id)\n        .maybeSingle();\n      if (!error && data) fullRow = data as ConversationReviewHistoryRow;\n    }`,
  `  const openEdit = async (row: ConversationReviewHistoryRow) => {\n    let fullRow = row;\n    if (row.id && row.raw_scores == null && row.review_items == null) {\n      try {\n        fullRow = await fetchReviewDetails(row);\n      } catch (error) {\n        toast.error(\`تعذر تحميل بنود التقييم للتعديل: \${(error as Error).message}\`);\n        return;\n      }\n    }`
);

replaceOnce(
  'history summary',
  `  const historyLoadSeq = useRef(0);`,
  `  const historySummary = useMemo(() => {\n    const count = reviewHistory.length;\n    const total = reviewHistory.reduce((sum, row) => sum + scoreOf(row), 0);\n    return {\n      count,\n      average: count ? Math.round(total / count) : 0,\n      perfect: reviewHistory.filter((row) => scoreOf(row) === 100).length,\n      below90: reviewHistory.filter((row) => scoreOf(row) < 90).length,\n      below70: reviewHistory.filter((row) => scoreOf(row) < 70).length,\n      reviewers: new Set(reviewHistory.map((row) => row.reviewer_name).filter(Boolean)).size,\n    };\n  }, [reviewHistory]);\n\n  const historyLoadSeq = useRef(0);`
);

replaceOnce(
  'filter ui',
  `        <div className="grid gap-3 rounded-xl border border-slate-700 bg-[#0b1728] p-3 sm:grid-cols-2 lg:grid-cols-4">`,
  `        <div className="grid gap-3 rounded-xl border border-slate-700 bg-[#0b1728] p-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">`
);

replaceOnce(
  'filter ui additions',
  `          <label className="flex flex-col gap-1 text-xs text-slate-300">\n            العميل (اسم / كود / تليفون)`,
  `          <label className="flex flex-col gap-1 text-xs text-slate-300">\n            المراجع / مسئول خدمة العملاء\n            <input\n              type="text"\n              value={historyFilterReviewer}\n              onChange={(e) => setHistoryFilterReviewer(e.target.value)}\n              placeholder="اسم من قام بالتقييم"\n              className="input-field"\n            />\n          </label>\n          <label className="flex flex-col gap-1 text-xs text-slate-300">\n            الفرع\n            <select value={historyFilterBranch} onChange={(e) => setHistoryFilterBranch(e.target.value)} className="input-field">\n              <option value="">كل الفروع</option>\n              {Array.from(new Set(mergeStaffChoices(staff).map((row) => normalizeBranchName(row.branch)).filter(Boolean))).map((branchName) => (\n                <option key={branchName} value={branchName}>{branchName}</option>\n              ))}\n            </select>\n          </label>\n          <label className="flex flex-col gap-1 text-xs text-slate-300">\n            الدرجة\n            <select value={historyFilterScore} onChange={(e) => setHistoryFilterScore(e.target.value)} className="input-field">\n              <option value="">كل الدرجات</option>\n              <option value="100">100 / 100</option>\n              <option value="90_99">90 - 99</option>\n              <option value="70_89">70 - 89</option>\n              <option value="below70">أقل من 70</option>\n            </select>\n          </label>\n          <label className="flex flex-col gap-1 text-xs text-slate-300">\n            العميل (اسم / كود / تليفون)`
);

replaceOnce(
  'clear filters',
  `                setHistoryFilterStaffId('');\n                setHistoryFilterCustomer('');\n                setHistoryFilterDateFrom('');\n                setHistoryFilterDateTo('');`,
  `                setHistoryFilterStaffId('');\n                setHistoryFilterReviewer('');\n                setHistoryFilterBranch('');\n                setHistoryFilterScore('');\n                setHistoryFilterCustomer('');\n                setHistoryFilterDateFrom('');\n                setHistoryFilterDateTo('');`
);

replaceOnce(
  'summary cards',
  `        <div className="grid md:grid-cols-4 gap-3">\n          <Metric label="عدد التقييمات المسجلة" value={\`${'${reviewHistory.length}'}\`} tone="teal" />\n          <Metric\n            label="متوسط آخر تقييمات"\n            value={\`${'${reviewHistory.length ? Math.round(reviewHistory.reduce((sum, row) => sum + scoreOf(row), 0) / reviewHistory.length) : 0}'}/100\`}\n            tone="blue"\n          />\n          <Metric\n            label="تقييمات أقل من 70"\n            value={\`${'${reviewHistory.filter((row) => scoreOf(row) < 70).length}'}\`}\n            tone="red"\n          />\n          <Metric label="فروع تم تقييمها" value={\`${'${historyStats.length}'}\`} tone="slate" />\n        </div>`,
  `        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">\n          <Metric label="إجمالي التقييمات" value={historySummary.count} tone="teal" />\n          <Metric label="متوسط التقييم" value={\`${'${historySummary.average}'}/100\`} tone="blue" />\n          <Metric label="100 / 100" value={historySummary.perfect} tone="teal" />\n          <Metric label="أقل من 90" value={historySummary.below90} tone="amber" />\n          <Metric label="أقل من 70" value={historySummary.below70} tone="red" />\n          <Metric label="عدد المقيمين" value={historySummary.reviewers} tone="slate" />\n        </div>`
);

replaceOnce(
  'modal loading prop',
  `          row={selectedReview}\n          onClose={closeSelectedReview}`,
  `          row={selectedReview}\n          loading={detailLoading}\n          onClose={closeSelectedReview}`
);

replaceOnce(
  'modal loading signature',
  `function ReviewDetailsModal({\n  row,\n  onClose,`,
  `function ReviewDetailsModal({\n  row,\n  loading,\n  onClose,`
);
replaceOnce(
  'modal loading type',
  `  row: ConversationReviewHistoryRow;\n  onClose: () => void;`,
  `  row: ConversationReviewHistoryRow;\n  loading: boolean;\n  onClose: () => void;`
);
replaceOnce(
  'modal loading content',
  `      <ReviewItemsTable items={items} />`,
  `      {loading ? (\n        <div className="rounded-xl border border-cyan-400/25 bg-cyan-500/10 p-4 text-center text-sm font-black text-cyan-100">\n          جاري تحميل كل بنود التقييم...\n        </div>\n      ) : (\n        <ReviewItemsTable items={items} />\n      )}`
);

fs.writeFileSync(file, src);
console.log('[reviews-history-v2] Reviews.tsx patched successfully');
