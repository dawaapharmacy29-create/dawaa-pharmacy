const fs = require('node:fs');

const file = 'src/pages/Reviews.tsx';
let source = fs.readFileSync(file, 'utf8');

function replaceRequired(pattern, replacement, label) {
  const before = source;
  source = source.replace(pattern, replacement);
  if (source === before) throw new Error(`${label}: target not found`);
}

// This script runs after the existing ranking patch and upgrades its generated code.
if (!source.includes('function canonicalReviewDoctorIdentity')) {
  replaceRequired(
    /function topRepeatedText\([\s\S]*?\n}\n\nfunction formatDateTime/,
    `function topRepeatedText(values: Array<string | null | undefined>, fallback: string) {
  const counts = new Map<string, number>();
  values
    .flatMap((value) => String(value || '').split(/[،,.\\n؛]/))
    .map((value) => value.trim())
    .filter((value) => value.length >= 4)
    .forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([value]) => value).join(' · ') || fallback;
}

function normalizedReviewDoctorName(value?: string | null) {
  return String(value || '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\\u0621-\\u064A0-9a-zA-Z ]/g, ' ')
    .replace(/\\b(دكتور|د|dr|doctor)\\b/gi, ' ')
    .replace(/\\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function canonicalReviewDoctorIdentity(row: ConversationReviewHistoryRow) {
  const rawName = row.staff_name || row.doctor_name || '';
  const normalized = normalizedReviewDoctorName(rawName);
  const isIslamFarouk = normalized.includes('اسلام فاروق') || normalized === 'اسلام' || normalized === 'اسلام ف';
  if (isIslamFarouk) {
    return { key: 'doctor:islam-farouk', name: 'د/ إسلام فاروق' };
  }
  const stableId = row.staff_id || row.doctor_id;
  return {
    key: stableId ? \`doctor-id:\${stableId}\` : \`doctor-name:\${normalized || 'unknown'}\`,
    name: rawName || 'غير محدد',
  };
}

function doctorActionPlan(rows: ConversationReviewHistoryRow[], average: number) {
  const needs = topRepeatedText(
    rows.map((row) => row.main_negative_reason || row.training_recommendation),
    average >= 90 ? 'الحفاظ على مستوى الجودة مع زيادة تنوع المحادثات المراجعة' : 'زيادة عدد المحادثات المراجعة لتحديد الأولويات بدقة'
  );
  const lowCount = rows.filter((row) => scoreOf(row) < 70).length;
  const excellentCount = rows.filter((row) => scoreOf(row) >= 95).length;
  const steps: string[] = [];
  if (lowCount > 0) steps.push(\`مراجعة \${lowCount} محادثة منخفضة وتحديد الخطأ المتكرر خلال أسبوع\`);
  if (/رد|سرع|انتظار|متابعه/i.test(needs)) steps.push('الالتزام بأول رد خلال 5 دقائق وتسجيل أي وعد بالمتابعة بموعد واضح');
  if (/ترحيب|اسم العميل|رساله/i.test(needs)) steps.push('استخدام رسالة ترحيب باسم العميل وإغلاق المحادثة برسالة تأكيد كاملة');
  if (/بيع|اضافي|احتياج|صنف/i.test(needs)) steps.push('تطبيق سؤالين لاكتشاف الاحتياج واقتراح بديل أو منتج مكمل مناسب');
  if (/تسجيل|توثيق|فاتور/i.test(needs)) steps.push('تسجيل رقم الفاتورة وملخص الطلب قبل إغلاق المحادثة');
  if (average >= 95 && excellentCount >= 3) steps.push('اختيار محادثة متميزة أسبوعيًا كنموذج تدريبي للفريق');
  if (!steps.length) steps.push('مراجعة 5 محادثات أسبوعيًا مع مسئول خدمة العملاء وقياس التحسن في البند الأضعف');
  return steps.slice(0, 4).join(' • ');
}

function safeExcelSheetName(value: string, used: Set<string>) {
  const base = value.replace(/[\\\\/?*:[\\]]/g, ' ').trim().slice(0, 27) || 'دكتور';
  let name = base;
  let counter = 2;
  while (used.has(name)) name = \`\${base.slice(0, 24)} \${counter++}\`;
  used.add(name);
  return name;
}

function formatDateTime`,
    'insert identity and recommendations helpers'
  );
}

source = source.replace(
  `type DoctorReviewRankingRow = {\n  staffId: string;\n  name: string;\n  branch: string;\n  reviews: number;\n  average: number;\n  weightedScore: number;\n  lowReviews: number;\n  positivePoints: number;\n  negativePoints: number;\n  strengths: string;\n  developmentNeeds: string;\n};`,
  `type DoctorReviewRankingRow = {\n  staffId: string;\n  identityKey: string;\n  name: string;\n  branch: string;\n  reviews: number;\n  average: number;\n  weightedScore: number;\n  lowReviews: number;\n  excellentReviews: number;\n  positivePoints: number;\n  negativePoints: number;\n  strengths: string;\n  developmentNeeds: string;\n  actionPlan: string;\n};`
);

replaceRequired(
  /  const monthlyReviewRows = useMemo\([\s\S]*?\n  const loadReviewHistory = useCallback\(async \(\) => \{/,
  `  const monthlyReviewRows = useMemo(
    () => reviewHistory.filter((row) => reviewMonthKey(row) === reportMonth),
    [reportMonth, reviewHistory]
  );

  const doctorReviewRanking = useMemo<DoctorReviewRankingRow[]>(() => {
    const grouped = new Map<string, ConversationReviewHistoryRow[]>();
    monthlyReviewRows.forEach((row) => {
      const identity = canonicalReviewDoctorIdentity(row);
      grouped.set(identity.key, [...(grouped.get(identity.key) || []), row]);
    });
    return [...grouped.entries()].map(([identityKey, rows]) => {
      const identity = canonicalReviewDoctorIdentity(rows[0]);
      const reviews = rows.length;
      const average = reviews ? rows.reduce((sum, row) => sum + scoreOf(row), 0) / reviews : 0;
      const bayesianAverage = (average * reviews + 80 * 3) / (reviews + 3);
      const volumeScore = Math.min(reviews / 12, 1) * 100;
      const weightedScore = bayesianAverage * 0.82 + volumeScore * 0.18;
      const developmentNeeds = topRepeatedText(
        rows.map((row) => row.main_negative_reason || row.training_recommendation),
        average >= 90 ? 'لا توجد ملاحظات سلبية متكررة' : 'زيادة عينة التقييمات لتحديد بند التطوير الأساسي'
      );
      return {
        staffId: rows.find((row) => row.staff_id || row.doctor_id)?.staff_id || rows.find((row) => row.staff_id || row.doctor_id)?.doctor_id || '',
        identityKey,
        name: identity.name,
        branch: topRepeatedText(rows.map((row) => row.branch), rows[0].branch || 'غير محدد').split(' · ')[0],
        reviews,
        average: Math.round(average * 10) / 10,
        weightedScore: Math.round(weightedScore * 10) / 10,
        lowReviews: rows.filter((row) => scoreOf(row) < 70).length,
        excellentReviews: rows.filter((row) => scoreOf(row) >= 95).length,
        positivePoints: rows.reduce((sum, row) => sum + Math.max(0, impactOf(row)), 0),
        negativePoints: rows.reduce((sum, row) => sum + Math.max(0, -impactOf(row)), 0),
        strengths: topRepeatedText(rows.map((row) => row.main_positive_reason), 'لم تُسجل نقاط قوة وصفية كافية بعد'),
        developmentNeeds,
        actionPlan: doctorActionPlan(rows, average),
      };
    }).sort((a, b) => b.weightedScore - a.weightedScore || b.reviews - a.reviews);
  }, [monthlyReviewRows]);

  const branchReviewSummary = useMemo(() => {
    const grouped = new Map<string, DoctorReviewRankingRow[]>();
    doctorReviewRanking.forEach((row) => grouped.set(row.branch, [...(grouped.get(row.branch) || []), row]));
    return [...grouped.entries()].map(([branch, rows]) => ({
      branch,
      doctors: rows.length,
      reviews: rows.reduce((sum, row) => sum + row.reviews, 0),
      average: rows.length ? Math.round((rows.reduce((sum, row) => sum + row.average * row.reviews, 0) / Math.max(1, rows.reduce((sum, row) => sum + row.reviews, 0))) * 10) / 10 : 0,
      developmentNeeds: topRepeatedText(rows.map((row) => row.developmentNeeds), 'لا توجد ملاحظات متكررة'),
    }));
  }, [doctorReviewRanking]);

  function doctorRowsForReport(doctor: DoctorReviewRankingRow) {
    return monthlyReviewRows.filter((row) => canonicalReviewDoctorIdentity(row).key === doctor.identityKey);
  }

  function exportDoctorConversationReport(doctor: DoctorReviewRankingRow) {
    const rows = doctorRowsForReport(doctor);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{
      'الدكتور': doctor.name,
      'الفرع': doctor.branch,
      'الشهر': reportMonth,
      'عدد المحادثات': doctor.reviews,
      'متوسط التقييم': doctor.average,
      'النتيجة الذكية': doctor.weightedScore,
      'محادثات ممتازة 95+': doctor.excellentReviews,
      'محادثات أقل من 70': doctor.lowReviews,
      'نقاط إيجابية': doctor.positivePoints,
      'خصومات': doctor.negativePoints,
      'أهم نقاط القوة': doctor.strengths,
      'أولوية التطوير': doctor.developmentNeeds,
      'خطة العمل المقترحة': doctor.actionPlan,
    }]), 'ملخص الدكتور');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows.map((row, index) => ({
      '#': index + 1,
      'التاريخ': row.conversation_date || row.created_at,
      'المراجع': row.reviewer_name,
      'العميل': row.customer_name,
      'كود العميل': row.customer_code,
      'الهاتف': row.customer_phone,
      'نوع المحادثة': row.evaluation_kind || row.conversation_type,
      'سبب التقييم': row.evaluation_reason,
      'رقم الفاتورة': row.invoice_number,
      'التقييم': scoreOf(row),
      'تأثير النقاط': impactOf(row),
      'نقطة القوة': row.main_positive_reason,
      'نقطة التطوير': row.main_negative_reason,
      'توصية التدريب': row.training_recommendation,
      'ملاحظات المراجع': row.reviewer_notes,
      'تقييم المدير': row.manager_review_score,
      'ملاحظات المدير': row.manager_review_notes,
    }))), 'تفاصيل المحادثات');
    XLSX.writeFile(workbook, \`تقرير-\${doctor.name.replace(/[^\\u0621-\\u064A0-9a-zA-Z]+/g, '-')}-\${reportMonth}.xlsx\`);
    toast.success(\`تم إصدار التقرير التفصيلي لـ \${doctor.name}\`);
  }

  function exportMonthlyConversationReport() {
    if (!monthlyReviewRows.length) { toast.error('لا توجد تقييمات في الشهر المحدد للتصدير'); return; }
    const workbook = XLSX.utils.book_new();
    const usedSheets = new Set<string>();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(doctorReviewRanking.map((row, index) => ({
      'الترتيب': index + 1, 'الدكتور': row.name, 'الفرع': row.branch, 'عدد المحادثات': row.reviews, 'متوسط التقييم': row.average, 'النتيجة الذكية': row.weightedScore, 'ممتاز 95+': row.excellentReviews, 'أقل من 70': row.lowReviews, 'نقاط إيجابية': row.positivePoints, 'خصومات': row.negativePoints, 'نقاط القوة': row.strengths, 'أولوية التطوير': row.developmentNeeds, 'خطة العمل': row.actionPlan,
    }))), 'ترتيب الدكاترة');
    usedSheets.add('ترتيب الدكاترة');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(branchReviewSummary.map((row) => ({
      'الفرع': row.branch, 'عدد الدكاترة': row.doctors, 'عدد المحادثات': row.reviews, 'متوسط الفرع': row.average, 'أهم نقاط التطوير': row.developmentNeeds,
    }))), 'ملخص الفروع');
    usedSheets.add('ملخص الفروع');
    doctorReviewRanking.forEach((doctor) => {
      const rows = doctorRowsForReport(doctor);
      const sheetName = safeExcelSheetName(doctor.name, usedSheets);
      const summaryRows = [
        { 'البند': 'الدكتور', 'القيمة': doctor.name },
        { 'البند': 'الفرع', 'القيمة': doctor.branch },
        { 'البند': 'عدد المحادثات', 'القيمة': doctor.reviews },
        { 'البند': 'متوسط التقييم', 'القيمة': doctor.average },
        { 'البند': 'نقاط القوة', 'القيمة': doctor.strengths },
        { 'البند': 'أولوية التطوير', 'القيمة': doctor.developmentNeeds },
        { 'البند': 'خطة العمل', 'القيمة': doctor.actionPlan },
        {},
        ...rows.map((row) => ({
          'البند': row.conversation_date || row.created_at,
          'القيمة': \`\${scoreOf(row)}/100 | \${row.customer_name || 'عميل غير محدد'} | \${row.main_negative_reason || row.training_recommendation || 'بدون ملاحظة تطوير'}\`,
        })),
      ];
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summaryRows), sheetName);
    });
    XLSX.writeFile(workbook, \`تقرير-تقييم-المحادثات-التفصيلي-\${reportMonth}.xlsx\`);
    toast.success('تم تصدير التقرير التفصيلي لكل الدكاترة');
  }

  const loadReviewHistory = useCallback(async () => {`,
  'upgrade ranking grouping and reports'
);

replaceRequired(
  /      const \{ data, error \} = await supabase\n        \.from\('conversation_sales_reviews'\)\n        \.select\('\*'\)\n        \.order\('created_at', \{ ascending: false \}\)\n        \.limit\(120\);\n      if \(error\) throw error;\n      const rows = \(\(data \|\| \[\]\) as ConversationReviewHistoryRow\[\]\)\.filter/,
  `      const pageSize = 300;
      const maxRows = 3000;
      const collected: ConversationReviewHistoryRow[] = [];
      for (let from = 0; from < maxRows; from += pageSize) {
        const { data, error } = await supabase
          .from('conversation_sales_reviews')
          .select('id,created_at,updated_at,reviewer_id,reviewer_name,reviewer_role,staff_id,doctor_id,staff_name,staff_role,doctor_name,branch,customer_id,customer_name,customer_code,customer_phone,invoice_number,evaluation_kind,conversation_type,evaluation_reason,conversation_date,total_score,final_score,level,point_impact,doctor_points_impact,main_positive_reason,main_negative_reason,reviewer_notes,training_recommendation,month_cycle,manager_review_score,manager_review_notes,manager_reviewed_by,manager_reviewed_at')
          .order('created_at', { ascending: false })
          .range(from, from + pageSize - 1);
        if (error) throw error;
        const page = (data || []) as ConversationReviewHistoryRow[];
        collected.push(...page);
        if (page.length < pageSize) break;
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      }
      const rows = collected.filter`,
  'replace heavy limited history query'
);

replaceRequired(
  /      <section className="stat-card space-y-4 border border-cyan-500\/20 bg-cyan-500\/5">[\s\S]*?      <section className="stat-card border border-teal-500\/20 bg-teal-500\/5 space-y-4">/,
  `      <section className="stat-card space-y-4 border border-cyan-500/20 bg-cyan-500/5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-xl font-black text-white">ترتيب وتقارير الدكاترة في تقييم المحادثات</h2>
            <p className="mt-1 text-sm font-bold text-slate-300">تجميع موحّد للأسماء والحسابات، توصيات قابلة للتنفيذ، وتقرير تفصيلي مستقل لكل دكتور.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <input className="input-dark" type="month" value={reportMonth} onChange={(event) => setReportMonth(event.target.value)} />
            <button type="button" className="btn-primary" onClick={exportMonthlyConversationReport}>تصدير التقرير التفصيلي Excel</button>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {doctorReviewRanking.map((row, index) => (
            <div key={row.identityKey} className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
              <div className="flex items-start justify-between gap-2">
                <div><div className="text-xs font-black text-cyan-300">المركز {index + 1}</div><div className="mt-1 font-black text-white">{row.name}</div><div className="text-xs font-bold text-slate-400">{row.branch}</div></div>
                <div className="rounded-xl bg-teal-500/15 px-3 py-2 font-black text-teal-100">{row.weightedScore}</div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs font-bold">
                <div className="rounded-xl bg-white/[0.04] p-2"><div className="text-slate-400">المحادثات</div><div className="mt-1 text-white">{row.reviews}</div></div>
                <div className="rounded-xl bg-white/[0.04] p-2"><div className="text-slate-400">المتوسط</div><div className="mt-1 text-white">{row.average}</div></div>
                <div className="rounded-xl bg-white/[0.04] p-2"><div className="text-slate-400">ممتازة</div><div className="mt-1 text-emerald-200">{row.excellentReviews}</div></div>
              </div>
              <div className="mt-3 rounded-xl bg-emerald-500/10 p-3 text-xs font-black text-emerald-100"><span className="text-emerald-300">نقاط القوة:</span> {row.strengths}</div>
              <div className="mt-2 rounded-xl bg-amber-500/10 p-3 text-xs font-black text-amber-100"><span className="text-amber-300">أولوية التطوير:</span> {row.developmentNeeds}</div>
              <div className="mt-2 rounded-xl bg-cyan-500/10 p-3 text-xs font-bold leading-6 text-cyan-50"><span className="font-black text-cyan-300">خطة العمل:</span> {row.actionPlan}</div>
              <button type="button" onClick={() => exportDoctorConversationReport(row)} className="btn-secondary mt-3 w-full text-xs">إصدار تقرير تفصيلي للدكتور</button>
            </div>
          ))}
          {!doctorReviewRanking.length && <div className="text-sm font-bold text-slate-400">لا توجد تقييمات في الشهر المحدد.</div>}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {branchReviewSummary.map((row) => (
            <div key={row.branch} className="rounded-2xl border border-violet-400/20 bg-violet-500/10 p-4">
              <div className="font-black text-white">تقرير {row.branch}</div>
              <div className="mt-2 text-sm font-bold text-slate-300">{row.reviews} محادثة · {row.doctors} دكاترة · متوسط {row.average}/100</div>
              <div className="mt-2 text-xs font-black text-amber-100">محور العمل المقترح: {row.developmentNeeds}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="stat-card border border-teal-500/20 bg-teal-500/5 space-y-4">`,
  'upgrade ranking UI'
);

fs.writeFileSync(file, source);
console.log('Applied stable paginated review loading, canonical doctor identity, detailed doctor reports, and actionable recommendations.');
