import { useState } from 'react';
import { ChevronDown, ChevronUp, Clock } from 'lucide-react';
import type { HourlyShift } from '@/lib/evaluationLab/hourlyTarget';

// v7.1: how the doctor's targets were read from his real shifts, shift by shift (owner 2026-11-17). Every hour
// he worked carries its own part of the branch target, so a changed schedule changes the target that day only.

const egp = (n: number) => Math.round(n).toLocaleString('ar-EG');
const SOURCE: Record<HourlyShift['source'], { label: string; tone: string }> = {
  punch: { label: 'بصمة', tone: 'dawaa-status-success-text' },
  schedule: { label: 'من الجدول (مفيش بصمة، وفواتيرك جوه المعاد)', tone: 'dawaa-status-warning-text' },
  invoices: { label: 'ساعات فواتيرك بس (مفيش بصمة)', tone: 'dawaa-status-danger-text' },
};

/** Shift kind by its start hour (Cairo). */
function kindOf(from: string) {
  const h = Number(from.slice(0, 2));
  return h >= 6 && h < 14 ? 'صباحي' : h >= 14 && h < 22 ? 'مسائي' : 'ليلي';
}
const dayLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('ar-EG', { weekday: 'short', day: 'numeric', month: 'numeric' });
const branchLabel = (b: string) => b.replace(/^فرع\s*/, '');

export function ShiftTargetBreakdown({ shifts, owner = false }: { shifts: HourlyShift[]; owner?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!shifts.length) return null;
  const kinds = new Map<string, { days: Set<string>; hours: number; target: number; own: number; customers: number }>();
  for (const s of shifts) {
    const k = kindOf(s.from);
    const row = kinds.get(k) || { days: new Set<string>(), hours: 0, target: 0, own: 0, customers: 0 };
    row.days.add(s.date);
    row.hours += s.hours;
    row.target += s.target;
    row.own += s.own;
    row.customers += s.expectedInvoices;
    kinds.set(k, row);
  }
  const total = shifts.reduce((acc, s) => ({ hours: acc.hours + s.hours, target: acc.target + s.target, own: acc.own + s.own }), { hours: 0, target: 0, own: 0 });
  const unpunched = shifts.filter((s) => s.source !== 'punch');
  const who = owner ? 'ساعاته' : 'ساعاتك';

  return (
    <div className="mt-3 rounded-xl border border-[var(--dawaa-theme-border)] p-3 text-xs font-bold">
      <div className="flex items-center gap-2 font-black text-[var(--dawaa-theme-heading)]"><Clock size={14} /> التارجت اتحسب من {who} الحقيقية</div>
      <p className="dawaa-theme-muted mt-1 leading-5">
        كل ساعة في الشهر ليها نصيب من تارجت الفرع حسب بيع نفس اليوم ونفس الساعة الشهر اللي فات، والتارجت = مجموع الساعات اللي {owner ? 'اشتغلها' : 'اشتغلتها'} فعلاً من البصمة.
        الساعة المسائية تارجتها أعلى لأن الفرع بيبيع فيها أكتر، ولو {owner ? 'معاده' : 'معادك'} اتغير يوم، اليوم ده بيتحسب بمعاده الجديد. ولو اتنين في نفس الساعة، تارجتها بيتقسم عليهم.
      </p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[420px] text-center">
          <thead className="dawaa-theme-muted"><tr><th className="p-1 text-right">الشيفت</th><th className="p-1">أيام</th><th className="p-1">ساعات</th><th className="p-1">تارجت الساعة</th><th className="p-1">التارجت</th><th className="p-1">بعت</th><th className="p-1">٪</th></tr></thead>
          <tbody>
            {[...kinds].map(([k, r]) => (
              <tr key={k} className="border-t border-[var(--dawaa-theme-divider)]">
                <td className="p-1 text-right">{k}</td><td className="p-1">{r.days.size}</td><td className="p-1">{r.hours}</td>
                <td className="p-1">{egp(r.target / Math.max(1, r.hours))} ج</td><td className="p-1">{egp(r.target)} ج</td><td className="p-1">{egp(r.own)} ج</td>
                <td className="p-1">{r.target > 0 ? `${Math.round((r.own / r.target) * 100)}٪` : '—'}</td>
              </tr>
            ))}
            <tr className="border-t border-[var(--dawaa-theme-border)] font-black">
              <td className="p-1 text-right">الإجمالي</td><td className="p-1">{new Set(shifts.map((s) => s.date)).size}</td><td className="p-1">{total.hours}</td>
              <td className="p-1">{egp(total.target / Math.max(1, total.hours))} ج</td><td className="p-1">{egp(total.target)} ج</td><td className="p-1">{egp(total.own)} ج</td>
              <td className="p-1">{total.target > 0 ? `${Math.round((total.own / total.target) * 100)}٪` : '—'}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {unpunched.length ? (
        <p className="dawaa-status-warning-text mt-2 leading-5">
          {unpunched.length} شيفت من غير بصمة: {owner ? 'اتحسبله' : 'اتحسبلك'} منه بس الساعات اللي ثبتت بفواتير أو بالجدول. البصمة في المعاد بتضمن إن كل ساعاتك تتحسب.
        </p>
      ) : null}
      <button type="button" onClick={() => setOpen((v) => !v)} className="dawaa-theme-muted mt-2 flex items-center gap-1 font-black">
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />} يوم بيوم
      </button>
      {open ? (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[480px] text-center">
            <thead className="dawaa-theme-muted"><tr><th className="p-1 text-right">اليوم</th><th className="p-1">من – لحد</th><th className="p-1">الفرع</th><th className="p-1">ساعات</th><th className="p-1">التارجت</th><th className="p-1">بعت</th><th className="p-1">فواتير</th><th className="p-1 text-right">المصدر</th></tr></thead>
            <tbody>
              {shifts.map((s) => (
                <tr key={`${s.date}-${s.source}-${s.branch}-${s.from}`} className="border-t border-[var(--dawaa-theme-divider)]">
                  <td className="p-1 text-right">{dayLabel(s.date)}</td><td className="p-1" dir="ltr">{s.from} – {s.to}</td><td className="p-1">{branchLabel(s.branch)}</td>
                  <td className="p-1">{s.hours}</td><td className="p-1">{egp(s.target)}</td><td className="p-1">{egp(s.own)}</td><td className="p-1">{s.ownInvoices}</td>
                  <td className={`p-1 text-right ${SOURCE[s.source].tone}`}>{SOURCE[s.source].label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
