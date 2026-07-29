const fs = require('node:fs');

const file = 'src/pages/Reviews.tsx';
let source = fs.readFileSync(file, 'utf8');

function replaceOnce(before, after, label) {
  if (source.includes(after)) return;
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one match, found ${count}`);
  source = source.replace(before, after);
}

replaceOnce(
  "  const [reviewHistory, setReviewHistory] = useState<ConversationReviewHistoryRow[]>([]);\n",
  "  const [reviewHistory, setReviewHistory] = useState<ConversationReviewHistoryRow[]>([]);\n  const [crossBranchTransferMode, setCrossBranchTransferMode] = useState(false);\n",
  'transfer mode state'
);

replaceOnce(
  "  const staffOptions = useMemo(() => {\n    const choices = mergeStaffChoices(staff);\n    if (canViewAllBranches(user)) return choices;\n",
  "  const isDoniaReviewer = normalizeArabicName(user?.name || user?.username || '') === 'دنيا';\n  const staffOptions = useMemo(() => {\n    const choices = mergeStaffChoices(staff);\n    if (isDoniaReviewer) {\n      if (crossBranchTransferMode) return choices;\n      return choices.filter((row) => normalizeBranchName(row.branch || '') === 'فرع شكري');\n    }\n    if (canViewAllBranches(user)) return choices;\n",
  'Donia branch scope'
);

replaceOnce(
  "  }, [staff, user]);\n  const reviewers = useMemo(() => {\n",
  "  }, [crossBranchTransferMode, isDoniaReviewer, staff, user]);\n\n  useEffect(() => {\n    if (!isDoniaReviewer || crossBranchTransferMode || !form.staffId) return;\n    const selected = staffOptions.find((row) => row.id === form.staffId);\n    if (!selected) setForm((current) => ({ ...current, staffId: '' }));\n  }, [crossBranchTransferMode, form.staffId, isDoniaReviewer, staffOptions]);\n\n  const reviewers = useMemo(() => {\n",
  'reset invalid selected doctor'
);

replaceOnce(
  "    setRepeatInfo(null);\n    setDraftSavedAt(null);\n",
  "    setRepeatInfo(null);\n    setCrossBranchTransferMode(false);\n    setDraftSavedAt(null);\n",
  'reset transfer mode on new review'
);

replaceOnce(
  "      <section className=\"stat-card space-y-4\">\n        <div className=\"section-title text-sm\">بيانات المحادثة</div>\n",
  "      <section className=\"stat-card space-y-4\">\n        <div className=\"section-title text-sm\">بيانات المحادثة</div>\n        {isDoniaReviewer && (\n          <label className=\"flex cursor-pointer items-start gap-3 rounded-2xl border border-amber-400/30 bg-amber-500/10 p-3 text-sm text-amber-100\">\n            <input\n              type=\"checkbox\"\n              checked={crossBranchTransferMode}\n              onChange={(event) => setCrossBranchTransferMode(event.target.checked)}\n              className=\"mt-1 h-4 w-4\"\n            />\n            <span>\n              <b className=\"block text-amber-200\">حالة تحويل بين الفروع</b>\n              الوضع الطبيعي يعرض دكاترة فرع شكري فقط. فعّلي هذا الاختيار مؤقتًا عند تقييم محادثة محوّلة من أو إلى فرع الشامي.\n            </span>\n          </label>\n        )}\n",
  'transfer mode UI'
);

fs.writeFileSync(file, source);
console.log('Applied Donia Shokry review scope and cross-branch transfer exception');
