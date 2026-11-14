import type { ReactNode } from 'react';
import { Fingerprint } from 'lucide-react';
import type { ReadHandover, SHIFT_TYPES, ShiftResponsible } from '@/lib/shiftHandoverCoverage';
import type { HandoverExpense } from '@/lib/shiftHandoverLedger';

// Shared pieces of «تسليم الشيفتات». Rows are DawaaWael handovers (Base44 ShiftDelivery) synced
// into shift_handovers every 15 minutes.

export type ShiftRow = {
  id: string;
  branch: string;
  shift_type: string;
  shift_date: string;
  submitted_by: string | null;
  submitted_by_staff_id?: string | null;
  total_sales: number;
  total_expenses: number;
  net_amount: number;
  expenses: HandoverExpense[];
  cash_sales: number | null;
  visa_sales: number | null;
  insta_sales: number | null;
  vodafone_sales: number | null;
  other_sales: number | null;
  cash_handover: number | null;
  cash_variance: number | null;
  notes: string | null;
  is_archived: boolean | null;
  recorded_at: string | null;
  calculation_date?: string | null;
  synced_at: string | null;
};

export type LiveRow = ReadHandover<ShiftRow> & {
  /** Another live handover holds the same branch, day and shift. */
  duplicate: boolean;
  /** …with the same sales: the same closing typed twice, counted twice in every total. */
  sameAmounts: boolean;
};

export const SHIFT_TONE: Record<string, string> = {
  ليلي: 'dawaa-badge--info',
  صباحي: 'dawaa-badge--warning',
  مسائي: 'dawaa-badge--success',
};

export const money = (value: number) => Math.round(value || 0).toLocaleString('ar-EG') + ' ج';

export const shortBranch = (branch: string) => branch.replace('فرع ', '');

export const dayLabel = (value: string) =>
  new Date(`${value}T12:00:00`).toLocaleDateString('ar-EG', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

export const shortDay = (value: string) =>
  new Date(`${value}T12:00:00`).toLocaleDateString('ar-EG', {
    weekday: 'short',
    day: 'numeric',
    month: 'numeric',
  });

export const timeLabel = (value: string | null) =>
  value
    ? new Date(value).toLocaleString('ar-EG', {
        day: 'numeric',
        month: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'Africa/Cairo',
      })
    : '-';

export const clockLabel = (value: string | null) =>
  value
    ? new Date(value).toLocaleTimeString('ar-EG', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'Africa/Cairo',
      })
    : '-';

export const pctLabel = (value: number) => `${Math.round(value).toLocaleString('ar-EG')}٪`;

/** Segmented control: one tap instead of opening a dropdown. */
export function Pills<T extends string>({
  label,
  options,
  value,
  onChange,
  render = (o) => String(o).replace('فرع ', ''),
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: NoInfer<T>) => void;
  render?: (option: NoInfer<T>) => string;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1">
      <span className="dawaa-caption ml-1 text-xs font-bold">{label}</span>
      <div
        className="flex flex-wrap gap-1 rounded-xl p-1"
        style={{ background: 'var(--dawaa-theme-surface-raised)' }}
      >
        {options.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={value === option}
            className={`dawaa-tab px-3 py-1 text-xs ${value === option ? 'is-active' : ''}`}
            onClick={() => onChange(option)}
          >
            {render(option)}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: ReactNode;
  tone?: 'success' | 'info' | 'warning' | 'danger';
}) {
  return (
    <div className="rounded-xl p-2.5" style={{ background: 'var(--dawaa-theme-surface-raised)' }}>
      <p className="dawaa-caption text-[11px] font-bold">{label}</p>
      <p
        className="text-sm font-black"
        style={{ color: tone ? `var(--dawaa-status-${tone}-text)` : 'var(--dawaa-theme-heading)' }}
      >
        {value}
      </p>
      {sub ? <div className="dawaa-caption text-[11px] font-bold">{sub}</div> : null}
    </div>
  );
}

/** «▲ ١٢٪ عن الفترة اللي قبلها»; nothing when there is no earlier period to compare with. */
export function Delta({ value, inverse = false }: { value: number | null; inverse?: boolean }) {
  if (value == null || !Number.isFinite(value)) return null;
  const up = value >= 0;
  const good = inverse ? !up : up;
  return (
    <span
      className="text-[11px] font-black"
      style={{
        color:
          Math.abs(value) < 1
            ? 'var(--dawaa-theme-muted)'
            : good
              ? 'var(--dawaa-status-success-text)'
              : 'var(--dawaa-status-danger-text)',
      }}
    >
      {up ? '▲' : '▼'} {pctLabel(Math.abs(value))}
    </span>
  );
}

/** A KPI tile with its change from the period before. */
export function Kpi({
  label,
  value,
  hint,
  delta,
  inverse,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  delta?: number | null;
  inverse?: boolean;
  tone?: 'success' | 'info' | 'warning' | 'danger';
}) {
  return (
    <div
      className="rounded-2xl border p-3"
      style={{
        borderColor: tone ? `var(--dawaa-status-${tone}-border)` : 'var(--dawaa-theme-border)',
        background: tone ? `var(--dawaa-status-${tone}-bg)` : 'var(--dawaa-theme-surface)',
      }}
    >
      <p className="text-xs font-black" style={{ color: 'var(--dawaa-theme-text)' }}>
        {label}
      </p>
      <p className="mt-1 text-xl font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>
        {value}
      </p>
      <div className="mt-0.5 flex flex-wrap items-center gap-2">
        {delta !== undefined ? <Delta value={delta} inverse={inverse} /> : null}
        {hint ? <span className="dawaa-caption text-[11px] font-bold">{hint}</span> : null}
      </div>
    </div>
  );
}

/** A horizontal share bar. */
export function Bar({
  value,
  max,
  tone = 'info',
}: {
  value: number;
  max: number;
  tone?: 'success' | 'info' | 'warning' | 'danger';
}) {
  const width = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div
      className="h-2 flex-1 rounded-full"
      style={{ background: 'var(--dawaa-theme-surface-raised)' }}
    >
      <div
        className="h-2 rounded-full"
        style={{ width: `${width}%`, background: `var(--dawaa-status-${tone}-text)` }}
      />
    </div>
  );
}

export const BRANCH_TONE: Record<string, 'info' | 'success'> = {
  'فرع شكري': 'info',
  'فرع الشامي': 'success',
};

/** "23س 24د" → "٢٣س ٢٤د". */
export const arDigits = (text: string) => text.replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);

/** Who was on duty at a shift's handover; null when the punches are not loaded or the day is too old. */
export type ResponsibleOf = (
  branch: string,
  day: string,
  shift: (typeof SHIFT_TYPES)[number],
  row?: LiveRow
) => ShiftResponsible | null;

/**
 * «موجود وقت التسليم: د أ · ٩:١٦ ص» — the doctor answerable for the handover, from the fingerprints.
 * `missing` turns it into who forgot it.
 */
export function ResponsibleLine({
  responsible,
  missing = false,
  compact = false,
}: {
  responsible: ShiftResponsible | null;
  missing?: boolean;
  compact?: boolean;
}) {
  if (!responsible) return null;
  const nobody = !responsible.people.length;
  const tone = missing ? 'danger' : nobody ? 'warning' : 'info';
  const label = missing ? 'كان موجود ونسي التسليم' : 'موجود وقت التسليم';
  return (
    <div
      className={`flex items-start gap-1.5 rounded-lg font-bold ${compact ? 'p-1.5 text-[11px]' : 'p-2 text-xs'}`}
      style={{
        background: `var(--dawaa-status-${tone}-bg)`,
        color: `var(--dawaa-status-${tone}-text)`,
      }}
      title={`البصمات ساعة ${clockLabel(responsible.at.toISOString())}`}
    >
      <Fingerprint size={compact ? 12 : 14} className="mt-0.5 shrink-0" />
      <span className="min-w-0">
        <span className="opacity-80">{label}: </span>
        <span className="font-black">
          {nobody
            ? 'مفيش دكتور بصم في الفرع'
            : responsible.people
                .map((p) => (p.kind === 'assistant' ? `${p.name} (مساعد)` : p.name))
                .join('، ')}
        </span>
      </span>
    </div>
  );
}
