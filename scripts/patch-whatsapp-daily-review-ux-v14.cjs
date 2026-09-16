const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/WhatsAppReviewQueueV4.tsx');
let src = fs.readFileSync(file, 'utf8');

function patch(label, from, to) {
  if (src.includes(to)) {
    console.log(`[whatsapp-daily-ux-v14] ${label}: already applied`);
    return;
  }
  if (!src.includes(from)) throw new Error(`[whatsapp-daily-ux-v14] ${label}: anchor not found`);
  src = src.replace(from, to);
  console.log(`[whatsapp-daily-ux-v14] ${label}: applied`);
}

patch(
  'navigation icons',
  `import { AlertTriangle, CheckCircle2, Clock3, FileText, Filter, RefreshCw, Search, ShieldAlert, ShoppingCart, UserRound } from 'lucide-react';`,
  `import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Clock3, FileText, Filter, RefreshCw, Search, ShieldAlert, ShoppingCart, UserRound } from 'lucide-react';`
);

patch(
  'selected position helpers',
  `  const selected = filtered.find((row) => row.id === selectedId) || filtered[0] || null;`,
  `  const selected = filtered.find((row) => row.id === selectedId) || filtered[0] || null;\n  const selectedIndex = selected ? filtered.findIndex((row) => row.id === selected.id) : -1;\n  const canGoPrevious = selectedIndex > 0;\n  const canGoNext = selectedIndex >= 0 && selectedIndex < filtered.length - 1;\n  const openQueueSource = (sourceId: string) => { setActiveWorkspace('daily'); setStatus('all'); setSelectedId(sourceId); };\n  const goPrevious = () => { if (canGoPrevious) setSelectedId(filtered[selectedIndex - 1].id); };\n  const goNext = () => { if (canGoNext) setSelectedId(filtered[selectedIndex + 1].id); };`
);

src = src.replaceAll(`onOpenSource={(sourceId) => { setStatus('all'); setSelectedId(sourceId); }}`, `onOpenSource={openQueueSource}`);

patch(
  'daily filters only',
  `      <section className="dawaa-card dawaa-card--soft p-4">\n        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">`,
  `      <section className={\`${'${'}activeWorkspace === 'daily' ? 'block' : 'hidden'${'}'} dawaa-card dawaa-card--soft p-4\`}>\n        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">`
);

patch(
  'daily review grid only',
  `      <div className="grid gap-5 xl:grid-cols-[390px_minmax(0,1fr)]">`,
  `      <div className={\`${'${'}activeWorkspace === 'daily' ? 'grid' : 'hidden'${'}'} gap-5 xl:grid-cols-[390px_minmax(0,1fr)]\`}>`
);

patch(
  'sticky session list',
  `        <aside className="dawaa-card dawaa-card--soft max-h-[950px] space-y-2 overflow-y-auto p-3">`,
  `        <aside className="dawaa-card dawaa-card--soft max-h-[calc(100vh-140px)] space-y-2 overflow-y-auto p-3 xl:sticky xl:top-4 xl:self-start">`
);

patch(
  'compact metric cards',
  `    <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3 text-center">\n      <div className="text-[11px] text-slate-400">{label}</div>\n      <div className={\`mt-1 text-xl font-black ${'${'}tone${'}'}\`}>{value}</div>`,
  `    <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-center">\n      <div className="text-[10px] text-slate-400">{label}</div>\n      <div className={\`mt-0.5 text-lg font-black ${'${'}tone${'}'}\`}>{value}</div>`
);

patch(
  'daily previous next toolbar',
  `        <main className="space-y-4">\n          {!selected ? <section className="dawaa-card dawaa-card--soft p-10 text-center text-slate-500">اختار جلسة من القائمة.</section> : <>`,
  `        <main className="space-y-3">\n          {!selected ? <section className="dawaa-card dawaa-card--soft p-10 text-center text-slate-500">اختار جلسة من القائمة.</section> : <>\n            <section className="dawaa-card dawaa-card--soft flex flex-wrap items-center justify-between gap-2 px-3 py-2">\n              <div className="text-xs font-bold text-slate-300">جلسة {selectedIndex + 1} من {filtered.length}</div>\n              <div className="flex items-center gap-2">\n                <button type="button" onClick={goPrevious} disabled={!canGoPrevious} className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-35"><ChevronRight size={14}/> السابق</button>\n                <button type="button" onClick={goNext} disabled={!canGoNext} className="flex items-center gap-1 rounded-lg border border-violet-400/30 bg-violet-500/10 px-3 py-1.5 text-xs font-black text-violet-100 disabled:cursor-not-allowed disabled:opacity-35">التالي <ChevronLeft size={14}/></button>\n              </div>\n            </section>`
);

patch(
  'compact selected header',
  `            <section className="dawaa-card dawaa-card--raised p-5">`,
  `            <section className="dawaa-card dawaa-card--raised p-4">`
);

patch(
  'preliminary metric labels and commercial n-a',
  `<div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5"><Metric label="ثقة التحليل" value={\`${'${'}Math.round(Number(selected.analysis_confidence || 0))${'}'}%\`} tone="text-cyan-300"/><Metric label="الخدمة" value={\`${'${'}Math.round(Number(selected.service_score || 0))${'}'}%\`} tone="text-sky-300"/><Metric label="البيع" value={\`${'${'}Math.round(Number(selected.commercial_score || 0))${'}'}%\`} tone="text-violet-300"/><Metric label="الفاتورة" value={invoiceLabel[selected.invoice_match_status || 'pending'] || '—'} tone={selected.invoice_match_status === 'verified' ? 'text-emerald-300' : 'text-amber-300'}/><Metric label="قيمة الفاتورة" value={selected.matched_invoice_value ? \`${'${'}Number(selected.matched_invoice_value).toFixed(2)${'}'} ج\` : '—'} tone="text-emerald-300"/></div>`,
  `<div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5"><Metric label="ثقة مبدئية" value={\`${'${'}Math.round(Number(selected.analysis_confidence || 0))${'}'}%\`} tone="text-cyan-300"/><Metric label="الخدمة المبدئية" value={\`${'${'}Math.round(Number(selected.service_score || 0))${'}'}%\`} tone="text-sky-300"/><Metric label="البيع المبدئي" value={selected.commercial_eligible === false ? 'غير منطبق' : \`${'${'}Math.round(Number(selected.commercial_score || 0))${'}'}%\`} tone="text-violet-300"/><Metric label="الفاتورة" value={invoiceLabel[selected.invoice_match_status || 'pending'] || '—'} tone={selected.invoice_match_status === 'verified' ? 'text-emerald-300' : 'text-amber-300'}/><Metric label="قيمة الفاتورة" value={selected.matched_invoice_value ? \`${'${'}Number(selected.matched_invoice_value).toFixed(2)${'}'} ج\` : '—'} tone="text-emerald-300"/></div>\n              <div className="mt-2 text-[10px] leading-5 text-slate-500">الأرقام التحليلية مبدئية للمساعدة في المراجعة وليست تقييمًا رسميًا أو نقاطًا معتمدة. البيع لا يُعد مؤكدًا إلا بعد ربط فاتورة حقيقية.</div>`
);

fs.writeFileSync(file, src);
console.log('[whatsapp-daily-ux-v14] streamlined daily review UX applied successfully');
require('./patch-whatsapp-customer-journey-analyzer-v15.cjs');
