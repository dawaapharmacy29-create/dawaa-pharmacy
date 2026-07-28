const fs = require('node:fs');
const path = require('node:path');

const filePath = path.join(process.cwd(), 'src/pages/StaffMonthlyEvaluation.tsx');
let source = fs.readFileSync(filePath, 'utf8');

const helperAnchor = "function scoreColor(score: number) { if (score >= 90) return 'text-emerald-300'; if (score >= 75) return 'text-cyan-300'; if (score >= 60) return 'text-amber-300'; return 'text-rose-300'; }";
const helper = `${helperAnchor}\nfunction sectionPoints(section: Section) { return Math.round(((section.score / 5) * section.weight) * 10) / 10; }\nfunction starMeaning(score: number) { return ['', 'ضعيف جدًا', 'يحتاج تحسين', 'جيد', 'جيد جدًا', 'ممتاز'][score] || 'لم يتم التقييم'; }`;
if (!source.includes('function sectionPoints(section: Section)')) {
  if (!source.includes(helperAnchor)) throw new Error('[staff-evaluation-stars] helper anchor not found');
  source = source.replace(helperAnchor, helper);
}

const oldSection = `<section className="space-y-3">{sections.map((item)=><article key={item.key} className="rounded-3xl border border-white/10 bg-slate-900/70 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-black">{item.title} <span className="text-xs text-cyan-300">({item.weight}%)</span></h3><p className="mt-1 text-xs text-slate-400">{item.description}</p></div><div className="flex gap-1">{[1,2,3,4,5].map((score)=><button disabled={!managerMode} key={score} onClick={()=>updateSection(item.key,{score})} className="p-1"><Star className={score<=item.score?'fill-amber-400 text-amber-400':'text-slate-600'} size={25}/></button>)}</div></div><textarea disabled={!managerMode} value={item.notes} onChange={(e)=>updateSection(item.key,{notes:e.target.value})} placeholder="ملاحظات مدير الفرع على هذا المحور" className="input-dark mt-3 min-h-20 w-full"/></article>)}</section>`;
const newSection = `<section className="space-y-3">{sections.map((item)=>{ const earned = sectionPoints(item); return <article key={item.key} className="rounded-3xl border border-white/10 bg-slate-900/70 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-black">{item.title} <span className="text-xs text-cyan-300">الوزن: {item.weight} نقطة</span></h3><p className="mt-1 text-xs text-slate-400">{item.description}</p></div><div className="min-w-56 text-left"><div className="flex justify-end gap-1">{[1,2,3,4,5].map((score)=><button disabled={!managerMode} key={score} onClick={()=>updateSection(item.key,{score})} className="p-1" title={\`\${score} نجوم = \${Math.round(((score/5)*item.weight)*10)/10} من \${item.weight}\`}><Star className={score<=item.score?'fill-amber-400 text-amber-400':'text-slate-600'} size={27}/></button>)}</div><div className="mt-2 rounded-xl border border-cyan-300/20 bg-cyan-400/10 px-3 py-2 text-center text-sm font-black text-cyan-100">{item.score ? \`\${item.score}/5 — \${starMeaning(item.score)} — \${earned} من \${item.weight}\` : \`لم يتم التقييم — 0 من \${item.weight}\`}</div></div></div><textarea disabled={!managerMode} value={item.notes} onChange={(e)=>updateSection(item.key,{notes:e.target.value})} placeholder="ملاحظات مدير الفرع على هذا المحور" className="input-dark mt-3 min-h-20 w-full"/></article>})}</section>`;
if (!source.includes('starMeaning(item.score)')) {
  if (!source.includes(oldSection)) throw new Error('[staff-evaluation-stars] section renderer anchor not found');
  source = source.replace(oldSection, newSection);
}

const oldHead = `<th className="border p-2">التقييم</th>`;
const newHead = `<th className="border p-2">النجوم</th><th className="border p-2">الدرجة المحققة</th>`;
if (!source.includes('الدرجة المحققة')) {
  if (!source.includes(oldHead)) throw new Error('[staff-evaluation-stars] PDF header anchor not found');
  source = source.replace(oldHead, newHead);
}

const oldPdfRow = `<td className="border p-2">{x.score}/5</td><td className="border p-2">{x.notes || '-'}</td>`;
const newPdfRow = `<td className="border p-2">{x.score}/5 — {starMeaning(x.score)}</td><td className="border p-2 font-black">{sectionPoints(x)} من {x.weight}</td><td className="border p-2">{x.notes || '-'}</td>`;
if (!source.includes('{sectionPoints(x)} من {x.weight}')) {
  if (!source.includes(oldPdfRow)) throw new Error('[staff-evaluation-stars] PDF row anchor not found');
  source = source.replace(oldPdfRow, newPdfRow);
}

if (!source.includes('sectionPoints(item)') || !source.includes('الدرجة المحققة') || !source.includes('{sectionPoints(x)} من {x.weight}')) {
  throw new Error('[staff-evaluation-stars] verification failed');
}

fs.writeFileSync(filePath, source, 'utf8');
console.log('Staff evaluation weighted star scores and PDF details applied.');
