const fs = require('fs');

function patchFile(path, transform) {
  if (!fs.existsSync(path)) throw new Error(`Missing file: ${path}`);
  const before = fs.readFileSync(path, 'utf8');
  const after = transform(before);
  if (after !== before) fs.writeFileSync(path, after);
}

patchFile('src/components/customerService/UnifiedCustomerServiceWorkspace.tsx', (source) => {
  if (!source.includes('function isExceptionalRequest')) {
    const anchor = "function sourceLabel(source: QueueSource) {";
    const helper = `function isExceptionalRequest(row?: FollowupRow | null) {\n  const text = \`${'${row?.request_type || \'\'} ${row?.notes || \'\'} ${row?.followup_reason || \'\'} ${rowValue(row, \'source\')}'}\`;\n  return /exceptional_followup|متابعة استثنائية|استثنائي/i.test(text);\n}\n\nfunction requestTypeLabel(item: QueueItem) {\n  return isExceptionalRequest(item.row) ? 'متابعة استثنائية' : item.source === 'doctor_request' ? 'طلب متابعة من دكتور' : sourceLabel(item.source);\n}\n\n`;
    if (!source.includes(anchor)) throw new Error('Workspace sourceLabel anchor missing');
    source = source.replace(anchor, helper + anchor);
  }

  if (!source.includes('const exceptionalRequestQueue = useMemo')) {
    const anchor = `  const upcomingQueue = useMemo(`;
    const block = `  const exceptionalRequestQueue = useMemo(\n    () => doctorRequestQueue.filter((item) => isExceptionalRequest(item.row)),\n    [doctorRequestQueue]\n  );\n  const doctorFollowupQueue = useMemo(\n    () => doctorRequestQueue.filter((item) => !isExceptionalRequest(item.row)),\n    [doctorRequestQueue]\n  );\n  const requestsByDoctor = useMemo(() => {\n    const grouped = new Map<string, { name: string; total: number; open: number; exceptional: number; completed: number }>();\n    allFollowups\n      .filter((row) => sourceFromRow(row) === 'doctor_request')\n      .forEach((row) => {\n        const name = row.requested_by_name || row.created_by_name || row.assigned_doctor || 'غير محدد';\n        const current = grouped.get(name) || { name, total: 0, open: 0, exceptional: 0, completed: 0 };\n        current.total += 1;\n        if (isCompleted(row)) current.completed += 1; else current.open += 1;\n        if (isExceptionalRequest(row)) current.exceptional += 1;\n        grouped.set(name, current);\n      });\n    return [...grouped.values()].sort((a, b) => b.total - a.total);\n  }, [allFollowups]);\n\n`;
    if (!source.includes(anchor)) throw new Error('Workspace upcomingQueue anchor missing');
    source = source.replace(anchor, block + anchor);
  }

  if (!source.includes('ملخص طلبات المتابعة حسب الدكتور')) {
    const anchor = `      <section className="flex flex-wrap gap-2 rounded-2xl border border-white/10 bg-[#10243d] p-2">`;
    const panel = `      {tab === 'doctor-requests' && (\n        <section className="rounded-2xl border border-cyan-400/20 bg-[#10243d] p-4">\n          <div className="flex flex-wrap items-center justify-between gap-3">\n            <div>\n              <h3 className="font-black text-white">ملخص طلبات المتابعة حسب الدكتور</h3>\n              <p className="mt-1 text-xs font-bold text-slate-400">كل طلب يظهر باسم صاحبه، مع فصل الطلبات العادية عن المتابعات الاستثنائية.</p>\n            </div>\n            <div className="flex flex-wrap gap-2 text-xs font-black">\n              <span className="rounded-xl bg-sky-500/15 px-3 py-2 text-sky-100">طلبات دكاترة: {doctorFollowupQueue.length}</span>\n              <span className="rounded-xl bg-amber-500/15 px-3 py-2 text-amber-100">استثنائية: {exceptionalRequestQueue.length}</span>\n            </div>\n          </div>\n          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">\n            {requestsByDoctor.map((row) => (\n              <button\n                key={row.name}\n                type="button"\n                onClick={() => { setRequesterFilter(row.name); setSourceFilter('doctor_request'); setStatusFilter('all'); }}\n                className="rounded-2xl border border-white/10 bg-slate-950/30 p-3 text-right hover:border-cyan-300/35"\n              >\n                <div className="font-black text-white">{row.name}</div>\n                <div className="mt-2 text-xs font-bold text-slate-300">الإجمالي: {row.total} · مفتوح: {row.open} · مكتمل: {row.completed}</div>\n                <div className="mt-1 text-xs font-black text-amber-200">استثنائية: {row.exceptional}</div>\n              </button>\n            ))}\n            {!requestsByDoctor.length && <div className="text-sm font-bold text-slate-400">لا توجد طلبات مسجلة في النطاق الحالي.</div>}\n          </div>\n        </section>\n      )}\n\n`;
    if (!source.includes(anchor)) throw new Error('Workspace tab section anchor missing');
    source = source.replace(anchor, panel + anchor);
  }

  source = source.replace('{queueLabel(item)}</Badge>', '{requestTypeLabel(item)}</Badge>');
  if (!source.includes('مقدم الطلب: {item.requestedBy}')) {
    source = source.replace(
      `<div className="mt-1 line-clamp-2 text-xs font-bold text-slate-300">`,
      `<div className="mt-1 text-[11px] font-black text-violet-200">مقدم الطلب: {item.requestedBy || 'غير محدد'}</div>\n                    <div className="mt-1 line-clamp-2 text-xs font-bold text-slate-300">`
    );
  }
  return source;
});

patchFile('src/components/doctor/DoctorRequestedFollowups.tsx', (source) => {
  if (!source.includes('تم إنشاء هذه الطلبات باسم حسابك')) {
    source = source.replace(
      `<p className="mt-1 text-sm text-slate-400">تعرض فقط المتابعات التي أنشأتها بحسابك، ونتائج خدمة العملاء المسجلة عليها.</p>`,
      `<p className="mt-1 text-sm text-slate-400">تعرض فقط المتابعات التي أنشأتها بحسابك، ونتائج خدمة العملاء المسجلة عليها.</p>\n            <p className="mt-1 text-xs font-black text-teal-200">تم إنشاء هذه الطلبات باسم حسابك: {user?.name || 'الحساب الحالي'}، ولن تظهر لدكتور آخر.</p>`
    );
  }
  if (!source.includes('تاريخ إنشاء الطلب:')) {
    source = source.replace(
      `<div className="mt-1 text-xs text-slate-400">المسؤول: {row.responsible_name || row.assigned_to || row.assigned_doctor || 'لم يتم التعيين'} · المحاولات: {contactAttempts(extended)}</div>`,
      `<div className="mt-1 text-xs text-slate-400">المسؤول: {row.responsible_name || row.assigned_to || row.assigned_doctor || 'لم يتم التعيين'} · المحاولات: {contactAttempts(extended)}</div>\n                    <div className="mt-1 text-xs font-bold text-slate-500">تاريخ إنشاء الطلب: {formatDate(row.created_at)} · آخر تحديث: {formatDate(row.updated_at || row.created_at)}</div>`
    );
  }
  return source;
});

patchFile('src/pages/Reviews.tsx', (source) => {
  if (!source.includes("import * as XLSX from 'xlsx';")) {
    source = source.replace("import { usePendingFormNavigationGuard } from '@/hooks/useUnsavedChangesGuard';", "import { usePendingFormNavigationGuard } from '@/hooks/useUnsavedChangesGuard';\nimport * as XLSX from 'xlsx';");
  }

  if (!source.includes('type DoctorReviewRankingRow')) {
    const anchor = 'interface ReviewDraftPayload {';
    const defs = `type DoctorReviewRankingRow = {\n  staffId: string;\n  name: string;\n  branch: string;\n  reviews: number;\n  average: number;\n  weightedScore: number;\n  lowReviews: number;\n  positivePoints: number;\n  negativePoints: number;\n  strengths: string;\n  developmentNeeds: string;\n};\n\n`;
    if (!source.includes(anchor)) throw new Error('Reviews type anchor missing');
    source = source.replace(anchor, defs + anchor);
  }

  if (!source.includes('function reviewMonthKey')) {
    const anchor = 'function formatDateTime(value?: string | null) {';
    const helpers = `function reviewMonthKey(row: ConversationReviewHistoryRow) {\n  return String(row.conversation_date || row.created_at || '').slice(0, 7);\n}\n\nfunction topRepeatedText(values: Array<string | null | undefined>, fallback: string) {\n  const counts = new Map<string, number>();\n  values\n    .flatMap((value) => String(value || '').split(/[،,.\\n؛]/))\n    .map((value) => value.trim())\n    .filter((value) => value.length >= 4)\n    .forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));\n  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([value]) => value).join(' · ') || fallback;\n}\n\n`;
    source = source.replace(anchor, helpers + anchor);
  }

  if (!source.includes('const [reportMonth, setReportMonth]')) {
    source = source.replace(
      `  const [managerReviewTarget, setManagerReviewTarget] =\n    useState<ConversationReviewHistoryRow | null>(null);`,
      `  const [managerReviewTarget, setManagerReviewTarget] =\n    useState<ConversationReviewHistoryRow | null>(null);\n  const [reportMonth, setReportMonth] = useState(() => new Date().toISOString().slice(0, 7));`
    );
  }

  if (!source.includes('const doctorReviewRanking = useMemo')) {
    const anchor = `  const loadReviewHistory = useCallback(async () => {`;
    const block = `  const monthlyReviewRows = useMemo(\n    () => reviewHistory.filter((row) => reviewMonthKey(row) === reportMonth),\n    [reportMonth, reviewHistory]\n  );\n\n  const doctorReviewRanking = useMemo<DoctorReviewRankingRow[]>(() => {\n    const grouped = new Map<string, ConversationReviewHistoryRow[]>();\n    monthlyReviewRows.forEach((row) => {\n      const id = row.staff_id || row.doctor_id || row.staff_name || row.doctor_name || 'unknown';\n      const branch = row.branch || 'غير محدد';\n      const key = \`${'${id}__${branch}'}\`;\n      grouped.set(key, [...(grouped.get(key) || []), row]);\n    });\n    return [...grouped.values()].map((rows) => {\n      const reviews = rows.length;\n      const average = reviews ? rows.reduce((sum, row) => sum + scoreOf(row), 0) / reviews : 0;\n      const bayesianAverage = (average * reviews + 80 * 3) / (reviews + 3);\n      const volumeScore = Math.min(reviews / 10, 1) * 100;\n      const weightedScore = bayesianAverage * 0.85 + volumeScore * 0.15;\n      return {\n        staffId: rows[0].staff_id || rows[0].doctor_id || '',\n        name: rows[0].staff_name || rows[0].doctor_name || 'غير محدد',\n        branch: rows[0].branch || 'غير محدد',\n        reviews,\n        average: Math.round(average * 10) / 10,\n        weightedScore: Math.round(weightedScore * 10) / 10,\n        lowReviews: rows.filter((row) => scoreOf(row) < 70).length,\n        positivePoints: rows.reduce((sum, row) => sum + Math.max(0, impactOf(row)), 0),\n        negativePoints: rows.reduce((sum, row) => sum + Math.max(0, -impactOf(row)), 0),\n        strengths: topRepeatedText(rows.map((row) => row.main_positive_reason), 'يحتاج مزيدًا من التقييمات لإظهار نقاط القوة'),\n        developmentNeeds: topRepeatedText(rows.map((row) => row.main_negative_reason || row.training_recommendation), 'لا توجد ملاحظات تطوير متكررة'),\n      };\n    }).sort((a, b) => b.weightedScore - a.weightedScore || b.reviews - a.reviews);\n  }, [monthlyReviewRows]);\n\n  const branchReviewSummary = useMemo(() => {\n    const grouped = new Map<string, DoctorReviewRankingRow[]>();\n    doctorReviewRanking.forEach((row) => grouped.set(row.branch, [...(grouped.get(row.branch) || []), row]));\n    return [...grouped.entries()].map(([branch, rows]) => ({\n      branch,\n      doctors: rows.length,\n      reviews: rows.reduce((sum, row) => sum + row.reviews, 0),\n      average: rows.length ? Math.round((rows.reduce((sum, row) => sum + row.average * row.reviews, 0) / Math.max(1, rows.reduce((sum, row) => sum + row.reviews, 0))) * 10) / 10 : 0,\n      developmentNeeds: topRepeatedText(rows.map((row) => row.developmentNeeds), 'لا توجد ملاحظات متكررة'),\n    }));\n  }, [doctorReviewRanking]);\n\n  function exportMonthlyConversationReport() {\n    if (!monthlyReviewRows.length) { toast.error('لا توجد تقييمات في الشهر المحدد للتصدير'); return; }\n    const workbook = XLSX.utils.book_new();\n    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(doctorReviewRanking.map((row, index) => ({\n      'الترتيب': index + 1, 'الدكتور': row.name, 'الفرع': row.branch, 'عدد المحادثات': row.reviews, 'متوسط التقييم': row.average, 'النتيجة الذكية': row.weightedScore, 'أقل من 70': row.lowReviews, 'نقاط إيجابية': row.positivePoints, 'خصومات': row.negativePoints, 'نقاط القوة': row.strengths, 'نقاط التطوير': row.developmentNeeds,\n    }))), 'ترتيب الدكاترة');\n    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(branchReviewSummary.map((row) => ({\n      'الفرع': row.branch, 'عدد الدكاترة': row.doctors, 'عدد المحادثات': row.reviews, 'متوسط الفرع': row.average, 'أهم نقاط التطوير': row.developmentNeeds,\n    }))), 'ملخص الفروع');\n    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(monthlyReviewRows.map((row) => ({\n      'التاريخ': row.conversation_date || row.created_at, 'الدكتور': row.staff_name || row.doctor_name, 'الفرع': row.branch, 'المراجع': row.reviewer_name, 'العميل': row.customer_name, 'نوع المحادثة': row.evaluation_kind || row.conversation_type, 'التقييم': scoreOf(row), 'تأثير النقاط': impactOf(row), 'نقطة قوة': row.main_positive_reason, 'نقطة تطوير': row.main_negative_reason, 'توصية تدريب': row.training_recommendation,\n    }))), 'تفاصيل التقييمات');\n    XLSX.writeFile(workbook, \`تقرير-تقييم-المحادثات-${'${reportMonth}'}.xlsx\`);\n    toast.success('تم تصدير التقرير الشهري لتقييم المحادثات');\n  }\n\n`;
    if (!source.includes(anchor)) throw new Error('Reviews load history anchor missing');
    source = source.replace(anchor, block + anchor);
  }

  if (!source.includes('ترتيب الدكاترة في تقييم المحادثات')) {
    const anchor = `      <section className="stat-card border border-teal-500/20 bg-teal-500/5 space-y-4">`;
    const section = `      <section className="stat-card space-y-4 border border-cyan-500/20 bg-cyan-500/5">\n        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">\n          <div>\n            <h2 className="text-xl font-black text-white">ترتيب الدكاترة في تقييم المحادثات</h2>\n            <p className="mt-1 text-sm font-bold text-slate-300">الترتيب الذكي يجمع بين متوسط التقييم وعدد المحادثات، مع تصحيح تلقائي للتقييمات القليلة.</p>\n          </div>\n          <div className="flex flex-wrap gap-2">\n            <input className="input-dark" type="month" value={reportMonth} onChange={(event) => setReportMonth(event.target.value)} />\n            <button type="button" className="btn-primary" onClick={exportMonthlyConversationReport}>تصدير التقرير الشهري Excel</button>\n          </div>\n        </div>\n        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">\n          {doctorReviewRanking.slice(0, 12).map((row, index) => (\n            <div key={\`${'${row.staffId || row.name}-${row.branch}'}\`} className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">\n              <div className="flex items-start justify-between gap-2"><div><div className="text-xs font-black text-cyan-300">المركز {index + 1}</div><div className="mt-1 font-black text-white">{row.name}</div><div className="text-xs font-bold text-slate-400">{row.branch}</div></div><div className="rounded-xl bg-teal-500/15 px-3 py-2 font-black text-teal-100">{row.weightedScore}</div></div>\n              <div className="mt-3 text-xs font-bold text-slate-300">المتوسط: {row.average}/100 · المحادثات: {row.reviews}</div>\n              <div className="mt-2 text-xs font-black text-emerald-200">قوة: {row.strengths}</div>\n              <div className="mt-1 text-xs font-black text-amber-200">تطوير: {row.developmentNeeds}</div>\n            </div>\n          ))}\n          {!doctorReviewRanking.length && <div className="text-sm font-bold text-slate-400">لا توجد تقييمات في الشهر المحدد.</div>}\n        </div>\n        <div className="grid gap-3 md:grid-cols-2">\n          {branchReviewSummary.map((row) => (\n            <div key={row.branch} className="rounded-2xl border border-violet-400/20 bg-violet-500/10 p-4">\n              <div className="font-black text-white">تقرير {row.branch}</div>\n              <div className="mt-2 text-sm font-bold text-slate-300">{row.reviews} محادثة · {row.doctors} دكاترة · متوسط {row.average}/100</div>\n              <div className="mt-2 text-xs font-black text-amber-100">محور العمل المقترح: {row.developmentNeeds}</div>\n            </div>\n          ))}\n        </div>\n      </section>\n\n`;
    if (!source.includes(anchor)) throw new Error('Reviews history section anchor missing');
    source = source.replace(anchor, section + anchor);
  }
  return source;
});

console.log('Followup ownership, doctor visibility, conversation ranking, and monthly report enhancements applied.');
