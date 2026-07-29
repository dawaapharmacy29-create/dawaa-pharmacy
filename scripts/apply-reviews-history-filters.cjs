const fs = require('node:fs');

const file = 'src/pages/Reviews.tsx';
let source = fs.readFileSync(file, 'utf8');

function replaceOnce(before, after, label) {
  if (source.includes(after)) return;
  const count = source.split(before).length - 1;
  if (count !== 1) {
    throw new Error(`${label}: expected exactly one match, found ${count}`);
  }
  source = source.replace(before, after);
}

replaceOnce(
  "  const [reviewHistory, setReviewHistory] = useState<ConversationReviewHistoryRow[]>([]);\n",
  "  const [reviewHistory, setReviewHistory] = useState<ConversationReviewHistoryRow[]>([]);\n  const [historyBranch, setHistoryBranch] = useState('');\n  const [historyDoctor, setHistoryDoctor] = useState('');\n  const [historyDateFrom, setHistoryDateFrom] = useState('');\n  const [historyDateTo, setHistoryDateTo] = useState('');\n",
  'history filter state'
);

replaceOnce(
  "  const historyStats = useMemo(() => {\n",
  "  const historyBranchOptions = useMemo(\n    () =>\n      Array.from(\n        new Set(reviewHistory.map((row) => String(row.branch || '').trim()).filter(Boolean))\n      ).sort((a, b) => a.localeCompare(b, 'ar')),\n    [reviewHistory]\n  );\n\n  const historyDoctorOptions = useMemo(() => {\n    const names = reviewHistory\n      .filter((row) => !historyBranch || String(row.branch || '') === historyBranch)\n      .map((row) => String(row.staff_name || row.doctor_name || '').trim())\n      .filter(Boolean);\n    return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b, 'ar'));\n  }, [historyBranch, reviewHistory]);\n\n  useEffect(() => {\n    if (historyDoctor && !historyDoctorOptions.includes(historyDoctor)) {\n      setHistoryDoctor('');\n    }\n  }, [historyDoctor, historyDoctorOptions]);\n\n  const filteredReviewHistory = useMemo(() => {\n    const fromTime = historyDateFrom ? new Date(`${historyDateFrom}T00:00:00`).getTime() : null;\n    const toTime = historyDateTo ? new Date(`${historyDateTo}T23:59:59.999`).getTime() : null;\n\n    return reviewHistory.filter((row) => {\n      if (historyBranch && String(row.branch || '') !== historyBranch) return false;\n\n      const doctorName = String(row.staff_name || row.doctor_name || '');\n      if (historyDoctor && doctorName !== historyDoctor) return false;\n\n      const rowDate = new Date(row.conversation_date || row.created_at || '').getTime();\n      if ((fromTime !== null || toTime !== null) && !Number.isFinite(rowDate)) return false;\n      if (fromTime !== null && rowDate < fromTime) return false;\n      if (toTime !== null && rowDate > toTime) return false;\n      return true;\n    });\n  }, [historyBranch, historyDateFrom, historyDateTo, historyDoctor, reviewHistory]);\n\n  const clearHistoryFilters = () => {\n    setHistoryBranch('');\n    setHistoryDoctor('');\n    setHistoryDateFrom('');\n    setHistoryDateTo('');\n  };\n\n  const historyStats = useMemo(() => {\n",
  'derived history filters'
);

replaceOnce(
  "    for (const row of reviewHistory) {\n",
  "    for (const row of filteredReviewHistory) {\n",
  'history stats source'
);

replaceOnce(
  "  }, [reviewHistory]);\n\n  const loadReviewHistory = useCallback(async () => {\n",
  "  }, [filteredReviewHistory]);\n\n  const loadReviewHistory = useCallback(async () => {\n",
  'history stats dependency'
);

replaceOnce(
  "        <div className=\"grid md:grid-cols-4 gap-3\">\n          <Metric label=\"عدد التقييمات المسجلة\" value={`${reviewHistory.length}`} tone=\"teal\" />\n          <Metric\n            label=\"متوسط آخر تقييمات\"\n            value={`${reviewHistory.length ? Math.round(reviewHistory.reduce((sum, row) => sum + scoreOf(row), 0) / reviewHistory.length) : 0}/100`}\n            tone=\"blue\"\n          />\n          <Metric\n            label=\"تقييمات أقل من 70\"\n            value={`${reviewHistory.filter((row) => scoreOf(row) < 70).length}`}\n            tone=\"red\"\n          />\n          <Metric label=\"فروع تم تقييمها\" value={`${historyStats.length}`} tone=\"slate\" />\n        </div>\n",
  "        <div className=\"rounded-2xl border border-[#2d4063] bg-[#102035] p-4 space-y-4\">\n          <div className=\"flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between\">\n            <div>\n              <h3 className=\"font-black text-white\">فلاتر سجل المحادثات</h3>\n              <p className=\"mt-1 text-xs text-slate-300\">افصل كل فرع، ثم اعرض كل محادثات دكتور محدد خلال فترة زمنية.</p>\n            </div>\n            <div className=\"flex items-center gap-2\">\n              <span className=\"badge-info text-xs\">{filteredReviewHistory.length} نتيجة</span>\n              <button type=\"button\" onClick={clearHistoryFilters} className=\"btn-secondary px-3 py-2 text-xs\">\n                مسح الفلاتر\n              </button>\n            </div>\n          </div>\n\n          <div className=\"grid gap-3 md:grid-cols-2 xl:grid-cols-4\">\n            <Field label=\"الفرع\">\n              <select className=\"input-dark\" value={historyBranch} onChange={(event) => setHistoryBranch(event.target.value)}>\n                <option value=\"\">كل الفروع</option>\n                {historyBranchOptions.map((branch) => (\n                  <option key={branch} value={branch}>{branch}</option>\n                ))}\n              </select>\n            </Field>\n            <Field label=\"اسم الدكتور\">\n              <select className=\"input-dark\" value={historyDoctor} onChange={(event) => setHistoryDoctor(event.target.value)}>\n                <option value=\"\">كل الدكاترة</option>\n                {historyDoctorOptions.map((doctor) => (\n                  <option key={doctor} value={doctor}>{doctor}</option>\n                ))}\n              </select>\n            </Field>\n            <Field label=\"من تاريخ\">\n              <input className=\"input-dark\" type=\"date\" value={historyDateFrom} onChange={(event) => setHistoryDateFrom(event.target.value)} />\n            </Field>\n            <Field label=\"إلى تاريخ\">\n              <input className=\"input-dark\" type=\"date\" min={historyDateFrom || undefined} value={historyDateTo} onChange={(event) => setHistoryDateTo(event.target.value)} />\n            </Field>\n          </div>\n        </div>\n\n        <div className=\"grid md:grid-cols-4 gap-3\">\n          <Metric label=\"عدد التقييمات المعروضة\" value={`${filteredReviewHistory.length}`} tone=\"teal\" />\n          <Metric\n            label=\"متوسط التقييمات المعروضة\"\n            value={`${filteredReviewHistory.length ? Math.round(filteredReviewHistory.reduce((sum, row) => sum + scoreOf(row), 0) / filteredReviewHistory.length) : 0}/100`}\n            tone=\"blue\"\n          />\n          <Metric\n            label=\"تقييمات أقل من 70\"\n            value={`${filteredReviewHistory.filter((row) => scoreOf(row) < 70).length}`}\n            tone=\"red\"\n          />\n          <Metric label=\"فروع ظاهرة\" value={`${historyStats.length}`} tone=\"slate\" />\n        </div>\n",
  'history filters UI and metrics'
);

source = source.replaceAll('reviewHistory.slice(0, 30).map', 'filteredReviewHistory.map');
source = source.replace(
  '!historyLoading && reviewHistory.length === 0',
  '!historyLoading && filteredReviewHistory.length === 0'
);
source = source.replace(
  'لا يوجد تقييمات محفوظة حتى الآن.',
  'لا توجد تقييمات مطابقة للفلاتر الحالية.'
);

fs.writeFileSync(file, source);
console.log('Applied branch, doctor, and date filters to Reviews.tsx');
