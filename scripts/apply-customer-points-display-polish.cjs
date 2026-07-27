const fs = require('node:fs');
const path = require('node:path');

const target = path.join(process.cwd(), 'src/pages/CustomerPointsLedger.tsx');
let source = fs.readFileSync(target, 'utf8');
let changed = false;

const replaceOnce = (before, after, label) => {
  if (source.includes(after)) return;
  if (!source.includes(before)) {
    console.warn(`[customer-points-display] skipped ${label}: anchor not found`);
    return;
  }
  source = source.replace(before, after);
  changed = true;
};

// Use unambiguous English thousands separators while preserving the requested EGP label.
if (!source.includes('const formatLoyaltyMoney =')) {
  const anchor = "const formatDate = (value?: string | null) => value ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('ar-EG') : 'لم يتم';";
  const helper = `${anchor}\nconst formatLoyaltyMoney = (value?: number | string | null) => {\n  const amount = Number(value || 0);\n  return `${new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number.isFinite(amount) ? amount : 0)} ج.م`;\n};`;
  replaceOnce(anchor, helper, 'money formatter');
}

if (source.includes("import { formatCurrency } from '@/lib/utils';")) {
  source = source.replace("import { formatCurrency } from '@/lib/utils';\n", '');
  changed = true;
}

if (/\bformatCurrency\(/.test(source)) {
  source = source.replace(/\bformatCurrency\(/g, 'formatLoyaltyMoney(');
  changed = true;
}

replaceOnce(
  '<label className="text-xs font-black text-slate-300">من<input type="date" className="input-dark mt-1 w-full" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)}/></label>\n        <label className="text-xs font-black text-slate-300">إلى<input type="date" className="input-dark mt-1 w-full" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)}/></label>',
  '<label className="text-xs font-black text-slate-300">بداية الدورة<input type="date" className="input-dark mt-1 w-full" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)}/></label>\n        <label className="text-xs font-black text-slate-300">نهاية الدورة<input type="date" className="input-dark mt-1 w-full" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)}/><span className="mt-1 block text-[11px] text-cyan-200">مدة الدورة: {periodStart && periodEnd ? periodDays(periodStart, periodEnd) : 0} يوم</span></label>',
  'period labels',
);

replaceOnce(
  '<div className="rounded-xl bg-white/5 p-3 text-sm text-white"><div>المبيعات: <b>{formatLoyaltyMoney(calculatedTotal)}</b></div><div>النسبة: <b>{(rate*100).toFixed(0)}%</b></div><div className="text-emerald-200">قيمة النقاط: <b>{formatLoyaltyMoney(calculatedPoints)}</b></div></div>',
  '<div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white"><div>إجمالي مشتريات الدورة: <b className="text-lg">{formatLoyaltyMoney(calculatedTotal)}</b></div><div>عدد الفواتير: <b>{preview?.invoice_count || 0}</b></div><div>النسبة: <b>{(rate*100).toFixed(0)}%</b></div><div className="text-emerald-200">رصيد النقاط المستحق: <b className="text-lg">{formatLoyaltyMoney(calculatedPoints)}</b></div></div>',
  'cycle summary card',
);

if (changed) {
  fs.writeFileSync(target, source, 'utf8');
  console.log('Customer points display polish applied.');
} else {
  console.log('Customer points display polish already applied; no changes needed.');
}
