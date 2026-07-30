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
  if (!source.includes('newOnlyMode')) throw new Error('[reviews-new-mode] isolated mode was not installed');
  if (!source.includes('الرجوع لسجل التقييمات')) throw new Error('[reviews-new-mode] back action was not installed');
  return source;
});

const hubChanged = update('src/components/reviews/ReviewsInsightsHub.tsx', (input) => {
  let source = input;
  source = source.replace(
`function doctorIdentity(row: ReviewRow) {\n  const raw = String(row.staff_name || row.doctor_name || 'غير محدد');\n  const id = String(row.staff_id || row.doctor_id || '');\n  const normalized = normalizeName(raw);\n  return { key: id ? \`id:\${id}\` : \`name:\${normalized || 'unknown'}\`, name: raw };\n}`,
`function doctorIdentity(row: ReviewRow) {\n  const raw = String(row.staff_name || row.doctor_name || 'غير محدد').trim();\n  const id = String(row.staff_id || row.doctor_id || '').trim();\n  const normalized = normalizeName(raw);\n  // الاسم المنظف هو المفتاح الأساسي حتى تندمج السجلات القديمة التي لا تحتوي staff_id\n  // مع السجلات الجديدة لنفس الدكتور. نستخدم المعرّف فقط عندما لا يوجد اسم صالح.\n  return { key: normalized ? \`name:\${normalized}\` : id ? \`id:\${id}\` : 'unknown', name: raw || 'غير محدد' };\n}`
  );
  source = source.replace(/>تقييم جديد<\/div><div className="mt-1 text-xs font-bold text-slate-300">فتح نموذج تقييم محادثة أو عملية بيع/g, '>إضافة تقييم جديد</div><div className="mt-1 text-xs font-bold text-slate-300">فتح مساحة مستقلة لتسجيل تقييم محادثة أو عملية بيع');
  source = source.replace('const doctors = useMemo(() => [ALL, ...Array.from(new Set(reviews.map((row) => doctorIdentity(row).name).filter((name) => name !== \'غير محدد\')))], [reviews]);', "const doctors = useMemo(() => [ALL, ...Array.from(new Map(reviews.map((row) => { const identity = doctorIdentity(row); return [identity.key, identity.name] as const; })).values()).filter((name) => name !== 'غير محدد')], [reviews]);");
  source = source.replace('if (doctor !== ALL && doctorIdentity(row).name !== doctor) return false;', 'if (doctor !== ALL && normalizeName(doctorIdentity(row).name) !== normalizeName(doctor)) return false;');

  const oldTriggerPattern = /  const triggerNewReview = \(\) => \{[\s\S]*?\n  \};/;
  const newTrigger = `  const triggerNewReview = () => {\n    window.location.assign('/reviews?mode=new');\n  };`;
  source = source.replace(oldTriggerPattern, newTrigger);

  if (!source.includes('الاسم المنظف هو المفتاح الأساسي')) throw new Error('[reviews-hub] canonical doctor identity was not installed');
  if (!source.includes("window.location.assign('/reviews?mode=new')")) throw new Error('[reviews-hub] isolated new review action was not connected');
  return source;
});

console.log(`Reviews completeness applied. reviewsChanged=${reviewsChanged} hubChanged=${hubChanged}`);