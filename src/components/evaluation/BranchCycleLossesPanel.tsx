import { useCallback, useEffect, useState } from 'react';
import { PackageX } from 'lucide-react';
import {
  LOSS_BRANCHES,
  listBranchCycleLosses,
  lossErrorMessage,
  parseAmount,
  recentCycleStarts,
  setBranchCycleLoss,
  type BranchCycleLoss,
  type LossBranchKey,
} from '@/lib/branchCycleLosses';

const cairoToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
const money = (n: number) => `${n.toLocaleString('ar-EG', { maximumFractionDigits: 2 })} ج`;
const cycleName = (start: string) => {
  const [y, m] = start.split('-').map(Number);
  const end = new Date(Date.UTC(y, m, 25));
  return `٢٦/${m.toLocaleString('ar-EG')} ← ٢٥/${(end.getUTCMonth() + 1).toLocaleString('ar-EG')}`;
};
const inputClass =
  'mt-1 w-full rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-input)] px-2 py-1.5 text-sm';

type Draft = { shortage: string; expired: string; note: string };

/** «عجز الأرصدة والإكسبير»: the cycle's total per branch, entered by hand by top management. */
export function BranchCycleLossesPanel() {
  const cycles = recentCycleStarts(cairoToday(), 4);
  const oldest = cycles[cycles.length - 1];
  const [cycle, setCycle] = useState(cycles[0]);
  const [rows, setRows] = useState<BranchCycleLoss[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [saving, setSaving] = useState<LossBranchKey | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await listBranchCycleLosses(oldest));
    } catch (error) {
      setMessage({ tone: 'error', text: lossErrorMessage(error) });
    }
  }, [oldest]);
  useEffect(() => {
    void load();
  }, [load]);

  const saved = (branch: LossBranchKey) =>
    rows.find((row) => row.cycle_start === cycle && row.branch_key === branch);
  const draftOf = (branch: LossBranchKey): Draft => {
    const own = drafts[`${cycle}|${branch}`];
    if (own) return own;
    const row = saved(branch);
    return {
      shortage: row ? String(row.stock_shortage) : '',
      expired: row ? String(row.expired_value) : '',
      note: row?.note ?? '',
    };
  };
  const edit = (branch: LossBranchKey, patch: Partial<Draft>) =>
    setDrafts((all) => ({ ...all, [`${cycle}|${branch}`]: { ...draftOf(branch), ...patch } }));

  const save = async (branch: LossBranchKey) => {
    const draft = draftOf(branch);
    const shortage = parseAmount(draft.shortage);
    const expired = parseAmount(draft.expired);
    if (shortage == null || expired == null) {
      setMessage({ tone: 'error', text: 'المبلغ لازم يكون رقم، زي 1250 أو 1250.50' });
      return;
    }
    setSaving(branch);
    try {
      await setBranchCycleLoss(cycle, branch, shortage, expired, draft.note);
      setDrafts((all) => {
        const next = { ...all };
        delete next[`${cycle}|${branch}`];
        return next;
      });
      await load();
      setMessage({ tone: 'ok', text: 'اتحفظ' });
    } catch (error) {
      setMessage({ tone: 'error', text: lossErrorMessage(error) });
    } finally {
      setSaving(null);
    }
  };

  return (
    <section className="dawaa-card dawaa-surface rounded-3xl border border-[var(--dawaa-theme-border)] p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-base font-black text-[var(--dawaa-theme-heading)]">
          <PackageX size={18} /> عجز الأرصدة والإكسبير
        </h2>
        <select
          value={cycle}
          onChange={(event) => setCycle(event.target.value)}
          className="rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-input)] px-3 py-2 text-sm font-bold"
          aria-label="دورة العجز"
        >
          {cycles.map((start, index) => (
            <option key={start} value={start}>
              {cycleName(start)}
              {index === 0 ? ' (الحالية)' : ''}
            </option>
          ))}
        </select>
      </div>
      <p className="dawaa-theme-muted mt-1 text-xs font-bold leading-6">
        القيمة الإجمالية للفرع في الدورة، بتتدخل يدوي بعد الجرد. دي اللي بتتخصم من محفظة الخصومات (الحافز
        الشهري + تارجت المبيعات + حافز اللستة)، ومش من المرتب الأساسي.
      </p>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {LOSS_BRANCHES.map(({ key, label }) => {
          const draft = draftOf(key);
          const row = saved(key);
          return (
            <div key={key} className="rounded-2xl border border-[var(--dawaa-theme-border)] p-3">
              <p className="text-sm font-black">{label}</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="text-xs font-bold">
                  عجز الأرصدة (ج)
                  <input
                    inputMode="decimal"
                    value={draft.shortage}
                    onChange={(event) => edit(key, { shortage: event.target.value })}
                    className={inputClass}
                  />
                </label>
                <label className="text-xs font-bold">
                  أصناف منتهية (ج)
                  <input
                    inputMode="decimal"
                    value={draft.expired}
                    onChange={(event) => edit(key, { expired: event.target.value })}
                    className={inputClass}
                  />
                </label>
              </div>
              <input
                value={draft.note}
                onChange={(event) => edit(key, { note: event.target.value })}
                placeholder="ملاحظة (اختياري): الجرد بتاريخ كام، أصناف إيه"
                className={`${inputClass} !text-xs`}
              />
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="dawaa-caption text-[11px] font-bold">
                  {row
                    ? `المتسجل: ${money(row.stock_shortage + row.expired_value)}${row.entered_by_name ? ` · ${row.entered_by_name}` : ''}`
                    : 'لسه ما اتدخلش'}
                </span>
                <button
                  type="button"
                  className="btn-primary !py-1.5 text-xs"
                  disabled={saving === key}
                  onClick={() => void save(key)}
                >
                  {saving === key ? 'بيتحفظ…' : 'حفظ'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {message ? (
        <p
          className={`mt-2 text-xs font-bold ${message.tone === 'ok' ? 'text-[var(--dawaa-status-success-text)]' : 'text-[var(--dawaa-status-danger-text)]'}`}
        >
          {message.text}
        </p>
      ) : null}
    </section>
  );
}
