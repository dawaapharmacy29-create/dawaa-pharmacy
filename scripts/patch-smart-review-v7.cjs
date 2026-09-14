const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/Reviews.tsx');
let src = fs.readFileSync(file, 'utf8');

function patch(label, from, to) {
  if (src.includes(to)) {
    console.log(`[smart-review-v7] ${label}: already applied`);
    return;
  }
  if (!src.includes(from)) throw new Error(`[smart-review-v7] ${label}: anchor not found`);
  src = src.replace(from, to);
  console.log(`[smart-review-v7] ${label}: applied`);
}

patch(
  'session state',
  `  const [keepSmartDoctor, setKeepSmartDoctor] = useState(false);\n  const [smartTemplateApplied, setSmartTemplateApplied] = useState(false);`,
  `  const [keepSmartDoctor, setKeepSmartDoctor] = useState(() => {\n    try { return window.sessionStorage.getItem('dawaa:smart-review:keep-doctor') === '1'; } catch { return false; }\n  });\n  const [smartSessionCount, setSmartSessionCount] = useState(() => {\n    try { return Number(window.sessionStorage.getItem('dawaa:smart-review:count') || 0) || 0; } catch { return 0; }\n  });\n  const [smartTemplateApplied, setSmartTemplateApplied] = useState(false);`
);

patch(
  'restore pinned doctor for session',
  `  const selectedStaff = staffOptions.find((s) => s.id === form.staffId) || null;`,
  `  useEffect(() => {\n    if (!smartReviewEnabled || form.staffId) return;\n    try {\n      const pinned = window.sessionStorage.getItem('dawaa:smart-review:doctor');\n      if (pinned && keepSmartDoctor && staffOptions.some((row) => row.id === pinned)) {\n        setForm((current) => ({ ...current, staffId: pinned }));\n      }\n    } catch {}\n  }, [form.staffId, keepSmartDoctor, smartReviewEnabled, staffOptions]);\n\n  useEffect(() => {\n    if (!smartReviewEnabled) return;\n    try {\n      window.sessionStorage.setItem('dawaa:smart-review:keep-doctor', keepSmartDoctor ? '1' : '0');\n      if (keepSmartDoctor && form.staffId) window.sessionStorage.setItem('dawaa:smart-review:doctor', form.staffId);\n      if (!keepSmartDoctor) window.sessionStorage.removeItem('dawaa:smart-review:doctor');\n    } catch {}\n  }, [form.staffId, keepSmartDoctor, smartReviewEnabled]);\n\n  const selectedStaff = staffOptions.find((s) => s.id === form.staffId) || null;`
);

patch(
  'count successful smart reviews',
  `      const ok = await save();\n      if (ok) startNewReview();`,
  `      const ok = await save();\n      if (ok) {\n        setSmartSessionCount((current) => {\n          const next = current + 1;\n          try { window.sessionStorage.setItem('dawaa:smart-review:count', String(next)); } catch {}\n          return next;\n        });\n        startNewReview();\n      }`
);

patch(
  'session status strip',
  `              <div className="grid gap-2 sm:grid-cols-2">\n                <button`,
  `              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-cyan-300/20 bg-cyan-500/5 px-3 py-2 text-xs">\n                <div className="font-black text-cyan-100">جلسة المراجعة: تم إنجاز {smartSessionCount} محادثة</div>\n                <button\n                  type="button"\n                  onClick={() => {\n                    setSmartSessionCount(0);\n                    setKeepSmartDoctor(false);\n                    try {\n                      window.sessionStorage.removeItem('dawaa:smart-review:count');\n                      window.sessionStorage.removeItem('dawaa:smart-review:doctor');\n                      window.sessionStorage.removeItem('dawaa:smart-review:keep-doctor');\n                    } catch {}\n                  }}\n                  className="rounded-lg border border-slate-600 px-2.5 py-1 font-bold text-slate-300 hover:bg-slate-800"\n                >\n                  إنهاء الجلسة\n                </button>\n              </div>\n\n              <div className="grid gap-2 sm:grid-cols-2">\n                <button`
);

fs.writeFileSync(file, src);
console.log('[smart-review-v7] persistent review session mode patched successfully');
