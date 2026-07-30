const fs = require('fs');

function update(path, transform) {
  if (!fs.existsSync(path)) throw new Error(`Missing file: ${path}`);
  const before = fs.readFileSync(path, 'utf8');
  const after = transform(before);
  if (after !== before) fs.writeFileSync(path, after);
  return after !== before;
}

const reviewsChanged = update('src/pages/Reviews.tsx', (input) => {
  let source = input;
  source = source.replace(/\.limit\(120\)/g, '.limit(3000)');
  source = source.replace(/reviewHistory\.slice\(0, 30\)/g, 'reviewHistory');
  source = source.replace('className="w-full max-w-full space-y-5 overflow-hidden"', 'className="w-full max-w-full space-y-5 overflow-visible"');

  if (!source.includes("const newOnlyMode = new URLSearchParams(window.location.search).get('mode') === 'new';")) {
    source = source.replace(
      '  const { user } = useAuth();',
      "  const { user } = useAuth();\n  const newOnlyMode = new URLSearchParams(window.location.search).get('mode') === 'new';"
    );
  }

  source = source.replace(
    '<section className="stat-card border border-teal-500/20 bg-teal-500/5 space-y-4">',
    '<section className={`${newOnlyMode ? \'hidden\' : \'\'} stat-card border border-teal-500/20 bg-teal-500/5 space-y-4`}> '
  );

  const oldHeaderActions = `          <div className="flex flex-wrap gap-2">\n            <button\n              type="button"\n              onClick={loadReviewHistory}\n              disabled={historyLoading}\n              className="btn-secondary flex items-center gap-2"\n            >\n              <RefreshCw size={16} className={historyLoading ? 'animate-spin' : ''} />\n              تحديث السجل\n            </button>\n            <button\n              type="button"\n              onClick={startNewReview}\n              className="btn-primary flex items-center gap-2"\n            >\n              <Star size={16} />\n              تقييم جديد\n            </button>\n          </div>`;

  const newHeaderActions = `          <div className="flex flex-wrap gap-2">\n            {newOnlyMode ? (\n              <button\n                type="button"\n                onClick={() => window.location.assign('/reviews')}\n                className="btn-secondary flex items-center gap-2"\n              >\n                <ListChecks size={16} />\n                الرجوع لسجل التقييمات\n              </button>\n            ) : (\n              <>\n                <button\n                  type="button"\n                  onClick={loadReviewHistory}\n                  disabled={historyLoading}\n                  className="btn-secondary flex items-center gap-2"\n                >\n                  <RefreshCw size={16} className={historyLoading ? 'animate-spin' : ''} />\n                  تحديث السجل\n                </button>\n                <button\n                  type="button"\n                  onClick={() => window.location.assign('/reviews?mode=new')}\n                  className="btn-primary flex items-center gap-2"\n                >\n                  <Star size={16} />\n                  إضافة تقييم جديد\n                </button>\n              </>\n            )}\n          </div>`;

  if (source.includes(oldHeaderActions)) source = source.replace(oldHeaderActions, newHeaderActions);

  const oldActions = `  return (\n    <details className="relative" onClick={(event) => event.stopPropagation()}>\n      <summary className="list-none rounded-xl border border-slate-600 bg-slate-900 px-3 py-2 text-center text-xs font-black text-cyan-100 hover:bg-slate-800 [&::-webkit-details-marker]:hidden">\n        الإجراءات\n      </summary>\n      <div className="absolute left-0 z-40 mt-2 w-44 overflow-hidden rounded-xl border border-slate-700 bg-slate-950 shadow-2xl">\n        <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-right text-xs font-bold text-slate-100 hover:bg-slate-800" onClick={() => onDetails(row)}>\n          <Eye size={14} /> عرض التفاصيل\n        </button>\n        {canManage ? (\n          <>\n            <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-right text-xs font-bold text-slate-100 hover:bg-slate-800" onClick={() => onEdit(row)}>\n              <Pencil size={14} /> تعديل التقييم\n            </button>\n            <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-right text-xs font-bold text-slate-100 hover:bg-slate-800" onClick={() => onManagerReview(row)}>\n              <UserCheck size={14} /> تقييم المراجع\n            </button>\n          </>\n        ) : null}\n      </div>\n    </details>\n  );`;

  const newActions = `  return (\n    <div className="flex min-w-[132px] flex-col gap-1.5" onClick={(event) => event.stopPropagation()}>\n      <button type="button" className="inline-flex w-full items-center justify-center gap-1 rounded-lg border border-cyan-400/25 bg-cyan-500/10 px-2 py-1.5 text-[11px] font-black text-cyan-100 hover:bg-cyan-500/20" onClick={() => onDetails(row)}>\n        <Eye size={13} /> التفاصيل\n      </button>\n      {canManage ? (\n        <div className="grid grid-cols-2 gap-1">\n          <button type="button" title="تعديل التقييم" className="inline-flex items-center justify-center gap-1 rounded-lg border border-violet-400/25 bg-violet-500/10 px-1.5 py-1.5 text-[10px] font-black text-violet-100 hover:bg-violet-500/20" onClick={() => onEdit(row)}>\n            <Pencil size={12} /> تعديل\n          </button>\n          <button type="button" title="تقييم المراجع" className="inline-flex items-center justify-center gap-1 rounded-lg border border-amber-400/25 bg-amber-500/10 px-1.5 py-1.5 text-[10px] font-black text-amber-100 hover:bg-amber-500/20" onClick={() => onManagerReview(row)}>\n            <UserCheck size={12} /> المراجع\n          </button>\n        </div>\n      ) : null}\n    </div>\n  );`;

  if (source.includes(oldActions)) source = source.replace(oldActions, newActions);
  if (!source.includes('.limit(3000)')) throw new Error('[reviews-register] history limit was not upgraded');
  if (source.includes('reviewHistory.slice(0, 30)')) throw new Error('[reviews-register] visible history still limited to 30');
  if (!source.includes('> التفاصيل')) throw new Error('[reviews-register] inline actions were not installed');
  if (!source.includes('newOnlyMode')) throw new Error('[reviews-new-mode] focused mode was not installed');
  if (!source.includes('الرجوع لسجل التقييمات')) throw new Error('[reviews-new-mode] back action was not installed');
  return source;
});

const hubChanged = update('src/components/reviews/ReviewsInsightsHub.tsx', (input) => {
  let source = input;
  source = source.replace(
`function doctorIdentity(row: ReviewRow) {\n  const raw = String(row.staff_name || row.doctor_name || 'غير محدد');\n  const id = String(row.staff_id || row.doctor_id || '');\n  const normalized = normalizeName(raw);\n  return { key: id ? \`id:\${id}\` : \`name:\${normalized || 'unknown'}\`, name: raw };\n}`,
`function doctorIdentity(row: ReviewRow) {\n  const raw = String(row.staff_name || row.doctor_name || 'غير محدد').trim();\n  const id = String(row.staff_id || row.doctor_id || '').trim();\n  const normalized = normalizeName(raw);\n  return { key: normalized ? \`name:\${normalized}\` : id ? \`id:\${id}\` : 'unknown', name: raw || 'غير محدد' };\n}`
  );

  source = source.replace(/>تقييم جديد<\/div><div className="mt-1 text-xs font-bold text-slate-300">فتح نموذج تقييم محادثة أو عملية بيع/g, '>إضافة تقييم جديد</div><div className="mt-1 text-xs font-bold text-slate-300">فتح نموذج التقييم أسفل لوحة التقارير');
  source = source.replace('const doctors = useMemo(() => [ALL, ...Array.from(new Set(reviews.map((row) => doctorIdentity(row).name).filter((name) => name !== \'غير محدد\')))], [reviews]);', "const doctors = useMemo(() => [ALL, ...Array.from(new Map(reviews.map((row) => { const identity = doctorIdentity(row); return [identity.key, identity.name] as const; })).values()).filter((name) => name !== 'غير محدد')], [reviews]);");
  source = source.replace('if (doctor !== ALL && doctorIdentity(row).name !== doctor) return false;', 'if (doctor !== ALL && normalizeName(doctorIdentity(row).name) !== normalizeName(doctor)) return false;');

  if (!source.includes("const [scoreFilter, setScoreFilter]")) {
    source = source.replace(
      "  const [doctor, setDoctor] = useState(ALL);",
      "  const [doctor, setDoctor] = useState(ALL);\n  const [scoreFilter, setScoreFilter] = useState(ALL);\n  const [pointsFilter, setPointsFilter] = useState(ALL);"
    );
  }

  source = source.replace(
`    if (doctor !== ALL && normalizeName(doctorIdentity(row).name) !== normalizeName(doctor)) return false;\n    return true;\n  }), [branch, doctor, month, reviews]);`,
`    if (doctor !== ALL && normalizeName(doctorIdentity(row).name) !== normalizeName(doctor)) return false;\n    const score = scoreOf(row);\n    if (scoreFilter === '95-100' && score < 95) return false;\n    if (scoreFilter === '85-94' && (score < 85 || score >= 95)) return false;\n    if (scoreFilter === '70-84' && (score < 70 || score >= 85)) return false;\n    if (scoreFilter === 'under-70' && score >= 70) return false;\n    const impact = impactOf(row);\n    if (pointsFilter === 'positive' && impact <= 0) return false;\n    if (pointsFilter === 'zero' && impact !== 0) return false;\n    if (pointsFilter === 'negative' && impact >= 0) return false;\n    if (pointsFilter === 'plus-5' && impact < 5) return false;\n    if (pointsFilter === 'minus-5' && impact > -5) return false;\n    return true;\n  }), [branch, doctor, month, pointsFilter, reviews, scoreFilter]);`
  );

  source = source.replace(
`        <div className="mt-3 grid gap-3 md:grid-cols-3">\n          <input type="month" className="input-dark" value={month} onChange={(event) => setMonth(event.target.value)} />\n          <select className="input-dark" value={branch} onChange={(event) => setBranch(event.target.value)}>{branches.map((item) => <option key={item}>{item}</option>)}</select>\n          <select className="input-dark" value={doctor} onChange={(event) => setDoctor(event.target.value)}>{doctors.map((item) => <option key={item}>{item}</option>)}</select>\n        </div>`,
`        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-5">\n          <input type="month" className="input-dark" value={month} onChange={(event) => setMonth(event.target.value)} />\n          <select className="input-dark" value={branch} onChange={(event) => setBranch(event.target.value)}>{branches.map((item) => <option key={item}>{item}</option>)}</select>\n          <select className="input-dark" value={doctor} onChange={(event) => setDoctor(event.target.value)}>{doctors.map((item) => <option key={item}>{item}</option>)}</select>\n          <select className="input-dark" value={scoreFilter} onChange={(event) => setScoreFilter(event.target.value)}>\n            <option value={ALL}>كل التقييمات</option><option value="95-100">ممتاز 95–100</option><option value="85-94">جيد جدًا 85–94</option><option value="70-84">جيد 70–84</option><option value="under-70">أقل من 70</option>\n          </select>\n          <select className="input-dark" value={pointsFilter} onChange={(event) => setPointsFilter(event.target.value)}>\n            <option value={ALL}>كل تأثيرات النقاط</option><option value="positive">حافز موجب</option><option value="plus-5">حافز 5+ فأكثر</option><option value="zero">بدون تأثير</option><option value="negative">خصم</option><option value="minus-5">خصم 5- فأكثر</option>\n          </select>\n        </div>\n        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-bold text-slate-300">\n          <span>النتائج المطابقة: <b className="text-white">{filtered.length}</b> من <b className="text-white">{reviews.length}</b> تقييم</span>\n          <button type="button" className="text-cyan-300 hover:text-cyan-200" onClick={() => { setBranch(ALL); setDoctor(ALL); setScoreFilter(ALL); setPointsFilter(ALL); }}>مسح الفلاتر</button>\n        </div>`
  );

  const oldTriggerPattern = /  const triggerNewReview = \(\) => \{[\s\S]*?\n  \};/;
  const newTrigger = `  const triggerNewReview = () => {\n    window.location.assign('/reviews?mode=new');\n  };`;
  source = source.replace(oldTriggerPattern, newTrigger);

  source = source.replace(
    "onClick={() => scrollToHeading('سجل تقييم المحادثات')}",
    "onClick={() => { if (new URLSearchParams(window.location.search).get('mode') === 'new') window.location.assign('/reviews'); else scrollToHeading('سجل تقييم المحادثات'); }}"
  );

  if (!source.includes('const [scoreFilter, setScoreFilter]')) throw new Error('[reviews-filters] score filter state missing');
  if (!source.includes('كل تأثيرات النقاط')) throw new Error('[reviews-filters] points filter UI missing');
  if (!source.includes('النتائج المطابقة')) throw new Error('[reviews-filters] filtered result count missing');
  return source;
});

console.log(`Reviews completeness applied. reviewsChanged=${reviewsChanged} hubChanged=${hubChanged}`);
