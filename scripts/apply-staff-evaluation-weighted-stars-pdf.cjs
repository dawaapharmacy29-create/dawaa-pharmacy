const fs = require('node:fs');
const path = require('node:path');

const pagePath = path.join(process.cwd(), 'src/pages/StaffMonthlyEvaluation.tsx');
let source = fs.readFileSync(pagePath, 'utf8');
let changed = false;

function replaceOnce(before, after, label) {
  if (source.includes(after)) return;
  if (!source.includes(before)) throw new Error(`[staff-evaluation-weighted] anchor not found: ${label}`);
  source = source.replace(before, after);
  changed = true;
  console.log(`[staff-evaluation-weighted] applied ${label}`);
}

replaceOnce(
  "{ key: 'sales', title: 'الأداء البيعي وتحقيق الهدف', description: 'المبيعات، متوسط الفاتورة، جودة البيع، وربط العملاء', weight: 20, score: 0, notes: '' },",
  "{ key: 'sales', title: 'الأداء البيعي وتحقيق الهدف', description: 'تحقيق الهدف، إجمالي المبيعات، متوسط الفاتورة، جودة البيع، البيع الإضافي، وربط العملاء', weight: 25, score: 0, notes: '' },",
  'sales weight 25'
);

replaceOnce(
  "{ key: 'teamwork', title: 'التعاون والقيادة', description: 'التعاون مع الفريق، تحمل المسؤولية، ودعم الشيفت', weight: 10, score: 0, notes: '' },",
  "{ key: 'teamwork', title: 'التعاون والقيادة', description: 'التعاون مع الفريق، تحمل المسؤولية، دعم الشيفت، والمبادرة في حل المشكلات', weight: 5, score: 0, notes: '' },",
  'teamwork weight 5'
);

const helperAnchor = "function scoreColor(score: number) { if (score >= 90) return 'text-emerald-300'; if (score >= 75) return 'text-cyan-300'; if (score >= 60) return 'text-amber-300'; return 'text-rose-300'; }";
const helperBlock = `${helperAnchor}\nfunction sectionPoints(item: Section) { return Math.round(((item.score / 5) * item.weight) * 10) / 10; }\nfunction starMeaning(score: number) { return ['', 'ضعيف جدًا', 'يحتاج تحسين', 'مقبول', 'جيد جدًا', 'ممتاز'][score] || 'لم يتم التقييم'; }`;
replaceOnce(helperAnchor, helperBlock, 'weighted score helpers');

const oldSection = `<section className="space-y-3">{sections.map((item)=><article key={item.key} className="rounded-3xl border border-white/10 bg-slate-900/70 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-black">{item.title} <span className="text-xs text-cyan-300">({item.weight}%)</span></h3><p className="mt-1 text-xs text-slate-400">{item.description}</p></div><div className="flex gap-1">{[1,2,3,4,5].map((score)=><button disabled={!managerMode} key={score} onClick={()=>updateSection(item.key,{score})} className="p-1"><Star className={score<=item.score?'fill-amber-400 text-amber-400':'text-slate-600'} size={25}/></button>)}</div></div><textarea disabled={!managerMode} value={item.notes} onChange={(e)=>updateSection(item.key,{notes:e.target.value})} placeholder="ملاحظات مدير الفرع على هذا المحور" className="input-dark mt-3 min-h-20 w-full"/></article>)}</section>`;
const newSection = `<section className="space-y-3">{sections.map((item)=>{ const earned = sectionPoints(item); return <article key={item.key} className="rounded-3xl border border-white/10 bg-slate-900/70 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-black">{item.title} <span className="text-xs text-cyan-300">الوزن: {item.weight} نقطة</span></h3><p className="mt-1 text-xs text-slate-400">{item.description}</p></div><div className="min-w-[230px]"><div className="flex justify-end gap-1">{[1,2,3,4,5].map((score)=><button type="button" aria-label={\`اختيار \${score} نجوم\`} disabled={!managerMode} key={score} onClick={()=>updateSection(item.key,{score})} className="rounded-lg p-1 transition hover:bg-amber-400/10 disabled:cursor-default"><Star className={score<=item.score?'fill-amber-400 text-amber-400':'text-slate-600'} size={27}/></button>)}</div><div className="mt-2 rounded-xl border border-cyan-300/20 bg-cyan-400/10 px-3 py-2 text-center text-sm font-black text-cyan-100">{item.score ? \`\${item.score} نجوم — \${starMeaning(item.score)} — \${earned} من \${item.weight}\` : \`لم يتم التقييم — 0 من \${item.weight}\`}</div></div></div><div className="mt-3 grid gap-2 sm:grid-cols-3"><div className="rounded-xl bg-white/[0.04] p-3 text-center"><div className="text-[11px] text-slate-400">عدد النجوم</div><div className="mt-1 font-black">{item.score}/5</div></div><div className="rounded-xl bg-white/[0.04] p-3 text-center"><div className="text-[11px] text-slate-400">الوزن</div><div className="mt-1 font-black">{item.weight} نقطة</div></div><div className="rounded-xl bg-emerald-400/10 p-3 text-center"><div className="text-[11px] text-emerald-200">الدرجة المكتسبة</div><div className="mt-1 font-black text-emerald-200">{earned} من {item.weight}</div></div></div><textarea disabled={!managerMode} value={item.notes} onChange={(e)=>updateSection(item.key,{notes:e.target.value})} placeholder="ملاحظات مدير الفرع على هذا المحور — اذكر مثالًا أو نتيجة فعلية" className="input-dark mt-3 min-h-20 w-full"/></article>})}</section>`;
replaceOnce(oldSection, newSection, 'weighted star cards');

const oldPdfTable = `<table className="mt-5 w-full border-collapse text-sm"><thead><tr><th className="border p-2">المحور</th><th className="border p-2">الوزن</th><th className="border p-2">التقييم</th><th className="border p-2">الملاحظات</th></tr></thead><tbody>{sections.map((x)=><tr key={x.key}><td className="border p-2">{x.title}</td><td className="border p-2">{x.weight}%</td><td className="border p-2">{x.score}/5</td><td className="border p-2">{x.notes || '-'}</td></tr>)}</tbody></table>`;
const newPdfTable = `<table className="mt-5 w-full border-collapse text-sm"><thead><tr><th className="border p-2">المحور</th><th className="border p-2">تفاصيل التقييم</th><th className="border p-2">الوزن</th><th className="border p-2">النجوم</th><th className="border p-2">الدرجة</th><th className="border p-2">ملاحظات مدير الفرع</th></tr></thead><tbody>{sections.map((x)=><tr key={x.key}><td className="border p-2 font-bold">{x.title}</td><td className="border p-2 text-xs">{x.description}</td><td className="border p-2 text-center">{x.weight}</td><td className="border p-2 text-center">{x.score}/5<br/><span className="text-xs">{starMeaning(x.score)}</span></td><td className="border p-2 text-center font-bold">{sectionPoints(x)} من {x.weight}</td><td className="border p-2">{x.notes || '-'}</td></tr>)}</tbody><tfoot><tr><td colSpan={4} className="border p-2 text-left font-black">الإجمالي النهائي</td><td className="border p-2 text-center text-lg font-black">{overallScore} من 100</td><td className="border p-2">{grade}</td></tr></tfoot></table>`;
replaceOnce(oldPdfTable, newPdfTable, 'detailed PDF table');

const oldDownload = `async function downloadPdf() {\n    if (!printRef.current || !selected) return;\n    const canvas = await html2canvas(printRef.current, { scale: 2, backgroundColor: '#ffffff', useCORS: true });`;
const newDownload = `async function downloadPdf() {\n    if (!printRef.current || !selected) return;\n    if (sections.some((item) => item.score === 0)) { toast.error('أكمل تقييم كل البنود قبل إصدار PDF'); return; }\n    toast.loading('جارٍ تجهيز ملف PDF...', { id: 'staff-evaluation-pdf' });\n    const canvas = await html2canvas(printRef.current, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });`;
replaceOnce(oldDownload, newDownload, 'PDF validation and progress');

const oldSave = `pdf.save(\`تقييم-\${selected.name}-\${month}.pdf\`);\n  }`;
const newSave = `pdf.save(\`تقييم-\${selected.name.replace(/[^\\p{L}\\p{N}_-]+/gu, '-')}-\${month}.pdf\`);\n    toast.success('تم تجهيز ملف PDF للتحميل', { id: 'staff-evaluation-pdf' });\n  }`;
replaceOnce(oldSave, newSave, 'safe PDF filename and success');

if (changed) fs.writeFileSync(pagePath, source, 'utf8');

const verified = [
  "weight: 25",
  'sectionPoints(item)',
  'الدرجة المكتسبة',
  'الإجمالي النهائي',
  "أكمل تقييم كل البنود قبل إصدار PDF",
].every((marker) => source.includes(marker));
if (!verified) throw new Error('[staff-evaluation-weighted] verification failed');
console.log(`Staff monthly evaluation weighted stars and detailed PDF verified. changed=${changed}`);
