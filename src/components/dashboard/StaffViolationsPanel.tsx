import { useCallback, useEffect, useState } from 'react';
import { Loader2, ShieldAlert } from 'lucide-react';
import { VIOLATION_LABELS, VIOLATION_POINTS, type ViolationCategory } from '@/lib/evaluationLab/complianceFactor';
import {
  listBranchStaffForViolations, listStaffViolations, recordStaffViolation, violationErrorMessage, withdrawStaffViolation,
  type BranchStaffOption, type StaffViolationRow,
} from '@/lib/staffViolations';

const CATEGORIES = Object.keys(VIOLATION_LABELS) as ViolationCategory[];
const cairoToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());

/** «مخالفات الالتزام» inside «قائمة اليوم»: record one for an employee and see today's. */
export function StaffViolationsPanel({ branch }: { branch: string | null }) {
  const [open, setOpen] = useState(false);
  const [staff, setStaff] = useState<BranchStaffOption[]>([]);
  const [today, setToday] = useState<StaffViolationRow[]>([]);
  const [staffId, setStaffId] = useState('');
  const [category, setCategory] = useState<ViolationCategory>('uniform');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const day = cairoToday();
      setToday(await listStaffViolations(day, day, branch));
      setError(null);
    } catch (err) {
      setError(violationErrorMessage(err));
    }
  }, [branch]);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    if (!open || staff.length) return;
    listBranchStaffForViolations(branch).then(setStaff).catch((err) => setError(violationErrorMessage(err)));
  }, [open, branch, staff.length]);
  useEffect(() => { setStaff([]); setStaffId(''); }, [branch]);

  const save = async () => {
    setBusy(true);
    try {
      await recordStaffViolation(staffId, category, note);
      setNote('');
      setStaffId('');
      setOpen(false);
      await reload();
    } catch (err) {
      setError(violationErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async (row: StaffViolationRow) => {
    const reason = window.prompt(`سبب إلغاء مخالفة ${row.staff_name}؟`);
    if (!reason?.trim()) return;
    try {
      await withdrawStaffViolation(row.id, reason);
      await reload();
    } catch (err) {
      setError(violationErrorMessage(err));
    }
  };

  const active = today.filter((row) => !row.withdrawn);

  return (
    <div className="dawaa-theme-border mt-5 rounded-2xl border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4" />
          <span className="text-sm font-black">مخالفات الالتزام</span>
          <span className="dawaa-caption text-xs font-bold">
            {error ? '' : active.length ? `${active.length} النهارده · ` : 'مفيش النهارده · '}الزي والمظهر نقطة، بي كونكت والتعليمات نقطتين
          </span>
        </div>
        {!open ? (
          <button type="button" onClick={() => setOpen(true)} className="dawaa-badge dawaa-badge--warning rounded-xl px-3 py-1 text-xs font-black">سجّل مخالفة</button>
        ) : null}
      </div>

      {open ? (
        <div className="mt-3 grid gap-2 md:grid-cols-[1fr_1fr_2fr_auto]">
          <select value={staffId} onChange={(event) => setStaffId(event.target.value)}
            className="dawaa-theme-surface dawaa-theme-border rounded-xl border px-3 py-2 text-xs font-bold">
            <option value="">اختار الموظف</option>
            {staff.map((person) => <option key={person.staff_account_id} value={person.staff_account_id}>{person.name}</option>)}
          </select>
          <select value={category} onChange={(event) => setCategory(event.target.value as ViolationCategory)}
            className="dawaa-theme-surface dawaa-theme-border rounded-xl border px-3 py-2 text-xs font-bold">
            {CATEGORIES.map((key) => <option key={key} value={key}>{VIOLATION_LABELS[key]} ({VIOLATION_POINTS[key]})</option>)}
          </select>
          <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="حصل إيه بالظبط؟"
            className="dawaa-theme-surface dawaa-theme-border rounded-xl border px-3 py-2 text-xs font-bold" />
          <div className="flex items-center gap-2">
            <button type="button" disabled={busy || !staffId || !note.trim()} onClick={() => void save()}
              className="dawaa-badge dawaa-badge--info rounded-xl px-3 py-2 text-xs font-black disabled:opacity-50">حفظ</button>
            <button type="button" onClick={() => setOpen(false)} className="dawaa-caption text-xs font-black">إلغاء</button>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          </div>
        </div>
      ) : null}

      {today.length ? (
        <ul className="mt-2 grid gap-1 text-xs font-bold">
          {today.map((row) => (
            <li key={row.id} className={`flex flex-wrap items-center gap-2 ${row.withdrawn ? 'line-through opacity-60' : ''}`}>
              <span>{row.staff_name} · {VIOLATION_LABELS[row.category]} ({row.points}) · {row.note}</span>
              {row.recorded_by_name ? <span className="dawaa-caption">— {row.recorded_by_name}</span> : null}
              {!row.withdrawn ? (
                <button type="button" onClick={() => void withdraw(row)} className="dawaa-caption underline">إلغاء</button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <p className="mt-1 text-xs font-bold text-[var(--dawaa-status-danger-text)]">{error}</p> : null}
    </div>
  );
}
