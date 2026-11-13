import { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Pencil } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import {
  closerPresence,
  closerPresenceText,
  handoverWindow,
  presenceIn,
  presenceLabel,
  shiftGapLabel,
  shiftGapTone,
  type PunchInterval,
  type ShiftHandoverCorrection,
} from '@/lib/shiftHandoverCoverage';
import { EXPENSE_SOURCE_LABEL, num, shiftMoney } from '@/lib/shiftHandoverLedger';
import {
  SHIFT_TONE,
  arDigits,
  clockLabel,
  money,
  shortDay,
  timeLabel,
  type LiveRow,
  type ShiftRow,
} from './shared';

// The fields top management can note a correction for (correct_shift_handover_v1). The correction is
// kept here as a review note; DawaaWael's own numbers, and every total on this page, stay as they are.
const EDIT_FIELDS = [
  ['submitted_by', 'اللي قفل', 'text'],
  ['total_sales', 'إجمالي المبيعات', 'number'],
  ['cash_sales', 'كاش', 'number'],
  ['visa_sales', 'فيزا', 'number'],
  ['insta_sales', 'إنستا', 'number'],
  ['vodafone_sales', 'فودافون', 'number'],
  ['other_sales', 'تحويلات أخرى', 'number'],
  ['total_expenses', 'المصروفات', 'number'],
  ['cash_handover', 'الكاش المسلّم', 'number'],
  ['notes', 'ملاحظات', 'text'],
] as const;
type EditKey = (typeof EDIT_FIELDS)[number][0];
export const EDIT_LABEL: Record<string, string> = {
  ...Object.fromEntries(EDIT_FIELDS.map(([key, label]) => [key, label])),
  net_amount: 'صافي التشغيل',
  cash_variance: 'فرق الكاش',
};
const CORRECT_ERRORS: Record<string, string> = {
  not_authorized: 'المراجعة للمدير العام والتنفيذي بس',
  reason_required: 'اكتب سبب الملاحظة',
  no_changes: 'مفيش حاجة اتغيرت',
  invalid_amount: 'المبالغ لازم تبقى أرقام',
};

function ReviewNote({
  row,
  onDone,
  onCancel,
}: {
  row: ShiftRow;
  onDone: () => void;
  onCancel: () => void;
}) {
  const initial = Object.fromEntries(
    EDIT_FIELDS.map(([key]) => [key, row[key] == null ? '' : String(row[key])])
  ) as Record<EditKey, string>;
  const [values, setValues] = useState(initial);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    const changes: Record<string, string | number | null> = {};
    for (const [key, , kind] of EDIT_FIELDS) {
      if (values[key] === initial[key]) continue;
      const raw = values[key].trim();
      if (kind === 'number') {
        const value = raw === '' ? null : Number(raw);
        if (value !== null && !Number.isFinite(value))
          return setError(`${EDIT_LABEL[key]}: لازم رقم`);
        changes[key] = value;
      } else changes[key] = raw || null;
    }
    setBusy(true);
    setError('');
    const { error: rpcError } = await supabase.rpc('correct_shift_handover_v1', {
      p_handover_id: row.id,
      p_changes: changes,
      p_reason: reason,
    });
    setBusy(false);
    if (rpcError) {
      const code = Object.keys(CORRECT_ERRORS).find((k) => rpcError.message?.includes(k));
      return setError(code ? CORRECT_ERRORS[code] : 'تعذّر الحفظ');
    }
    onDone();
  };

  return (
    <div
      className="mt-3 space-y-2 rounded-xl border p-3"
      style={{ borderColor: 'var(--dawaa-status-warning-border)' }}
    >
      <p className="text-xs font-black" style={{ color: 'var(--dawaa-status-warning-text)' }}>
        دي ملاحظة مراجعة بتتسجل في الإدارة بس. أرقام دواء وائل وإجماليات الصفحة مش بتتغير — التصحيح
        الفعلي بيتعمل من دواء وائل نفسه.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {EDIT_FIELDS.map(([key, label, kind]) => (
          <label key={key} className="text-xs font-bold">
            {label}
            <input
              className="dawaa-input mt-1 w-full"
              inputMode={kind === 'number' ? 'decimal' : undefined}
              value={values[key]}
              onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
            />
          </label>
        ))}
      </div>
      <input
        className="dawaa-input w-full"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="السبب (لازم)"
      />
      {error ? (
        <p className="text-xs font-bold" style={{ color: 'var(--dawaa-status-danger-text)' }}>
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || !reason.trim()}
          onClick={() => void save()}
          className="dawaa-badge dawaa-badge--success rounded-xl px-3 py-1 text-xs font-black disabled:opacity-50"
        >
          حفظ الملاحظة
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="dawaa-caption text-xs font-black underline"
        >
          إلغاء
        </button>
      </div>
    </div>
  );
}

/** The flags a handover raises, in the order a reviewer should look at them. */
export function handoverFlags(row: LiveRow, closerNote: string | null) {
  const m = shiftMoney(row);
  const flags: { tone: 'danger' | 'warning' | 'info'; text: string }[] = [];
  if (row.duplicate)
    flags.push({
      tone: 'danger',
      text: row.sameAmounts
        ? 'متسجل مرتين بنفس المبيعات: غالبًا تكرار ومتحسب مرتين في الإجماليات — أرشف واحد من دواء وائل'
        : 'الشيفت ده متسجل أكتر من مرة بمبالغ مختلفة — راجع أنهي شيفت كل واحد',
    });
  if (m.cashVariance)
    flags.push({
      tone: 'danger',
      text:
        m.cashVariance < 0
          ? `الكاش المسلّم ناقص ${money(-m.cashVariance)}`
          : `الكاش المسلّم زيادة ${money(m.cashVariance)}`,
    });
  if (m.splitGap)
    flags.push({
      tone: 'danger',
      text: `تفصيل الدفع مش مساوي للمبيعات (فرق ${money(m.splitGap)})`,
    });
  if (closerNote) flags.push({ tone: 'warning', text: closerNote });
  if (row.entered_late_days)
    flags.push({
      tone: 'warning',
      text: `اتسجل بعد شيفته بـ ${row.entered_late_days.toLocaleString('ar-EG')} يوم`,
    });
  const tone = shiftGapTone(row.gap_minutes);
  if (tone === 'short')
    flags.push({
      tone: 'warning',
      text: `${arDigits(shiftGapLabel(row.gap_minutes ?? 0))} بس من التسليم اللي قبله`,
    });
  if (tone === 'long')
    flags.push({
      tone: 'warning',
      text: `${arDigits(shiftGapLabel(row.gap_minutes ?? 0))} من التسليم اللي قبله`,
    });
  if (row.reread)
    flags.push({
      tone: 'info',
      text: `متسجل في دواء وائل ${row.source_type} ${shortDay(row.source_date)} واتحسب هنا من وقت التقفيل`,
    });
  if (m.legacy) flags.push({ tone: 'info', text: 'تسليم قديم من غير تفصيل دفع' });
  return flags;
}

export function closerNoteOf(row: LiveRow, punches: PunchInterval[] | null, presenceFrom: string) {
  if (!punches || row.shift_date < presenceFrom) return null;
  return closerPresenceText(
    closerPresence(
      { name: row.submitted_by, staffId: row.submitted_by_staff_id },
      punches,
      row.branch,
      row.recorded_at
    )
  );
}

export default function ShiftHandoverCard({
  row,
  fixes,
  punches,
  presenceFrom,
  canReview,
  onChanged,
}: {
  row: LiveRow;
  fixes: ShiftHandoverCorrection[];
  punches: PunchInterval[] | null;
  presenceFrom: string;
  canReview: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const m = shiftMoney(row);
  const known = Boolean(punches) && row.shift_date >= presenceFrom;
  const span = handoverWindow(row.recorded_at, row.previous_close);
  const people = known && span ? presenceIn(punches || [], row.branch, span) : null;
  const flags = handoverFlags(row, closerNoteOf(row, punches, presenceFrom));
  const serious = flags.some((f) => f.tone === 'danger');

  return (
    <article
      className="rounded-xl border p-3"
      style={{
        borderColor: serious ? 'var(--dawaa-status-danger-border)' : 'var(--dawaa-theme-border)',
        background: 'var(--dawaa-theme-surface)',
      }}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex flex-wrap items-center gap-2">
          <span className={`dawaa-badge ${SHIFT_TONE[row.shift_type] || 'dawaa-badge--neutral'}`}>
            {row.shift_type}
          </span>
          <span className="text-sm font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>
            {row.submitted_by || '-'}
          </span>
          {fixes.length ? (
            <span className="dawaa-badge dawaa-badge--warning">عليه ملاحظة مراجعة</span>
          ) : null}
        </span>
        <span className="dawaa-caption text-xs font-black" title={timeLabel(row.recorded_at)}>
          اتقفل {clockLabel(row.recorded_at)}
        </span>
      </header>

      {/* The two lines that explain every handover. */}
      <dl
        className="mt-2 space-y-1 rounded-lg p-2 text-xs font-bold"
        style={{ background: 'var(--dawaa-theme-surface-raised)' }}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-1">
          <dt className="dawaa-caption">المبيعات</dt>
          <dd>
            <b className="text-sm" style={{ color: 'var(--dawaa-theme-heading)' }}>
              {money(m.sales)}
            </b>{' '}
            = كاش {money(m.cash)} + تحويلات{' '}
            <span style={{ color: 'var(--dawaa-status-info-text)' }}>{money(m.transfers)}</span>
          </dd>
        </div>
        <div className="flex flex-wrap items-baseline justify-between gap-1">
          <dt className="dawaa-caption">للمحاسب نقدي</dt>
          <dd>
            كاش {money(m.cash)}
            {m.cashExpenses ? (
              <>
                {' '}
                − مصروفات{' '}
                <span style={{ color: 'var(--dawaa-status-warning-text)' }}>
                  {money(m.cashExpenses)}
                </span>
              </>
            ) : null}{' '}
            ={' '}
            <b className="text-sm" style={{ color: 'var(--dawaa-status-success-text)' }}>
              {money(m.toAccountant)}
            </b>
          </dd>
        </div>
        {m.cashVariance ? (
          <div
            className="flex flex-wrap items-baseline justify-between gap-1"
            style={{ color: 'var(--dawaa-status-danger-text)' }}
          >
            <dt>اتسلم فعلًا</dt>
            <dd>
              <b className="text-sm">{money(m.toAccountant + m.cashVariance)}</b>
            </dd>
          </div>
        ) : null}
      </dl>

      {flags.length ? (
        <ul className="mt-2 flex flex-wrap gap-1">
          {flags.map((f) => (
            <li
              key={f.text}
              className={`dawaa-badge dawaa-badge--${f.tone} inline-flex items-center gap-1 text-[11px]`}
            >
              {f.tone === 'danger' ? <AlertTriangle size={11} /> : null}
              {f.text}
            </li>
          ))}
        </ul>
      ) : null}
      {row.notes ? <p className="mt-2 text-xs font-bold">📝 {row.notes}</p> : null}

      <div className="mt-2 flex flex-wrap gap-3 print:hidden">
        <button
          type="button"
          className="dawaa-caption inline-flex items-center gap-1 text-xs font-black underline"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}{' '}
          {open ? 'إخفاء التفاصيل' : 'التفاصيل'}
        </button>
        {canReview && !editing ? (
          <button
            type="button"
            onClick={() => {
              setOpen(true);
              setEditing(true);
            }}
            className="dawaa-caption inline-flex items-center gap-1 text-xs font-black underline"
          >
            <Pencil size={12} /> ملاحظة مراجعة
          </button>
        ) : null}
      </div>

      {open ? (
        <div
          className="mt-2 space-y-2 border-t pt-2 text-xs font-bold"
          style={{ borderColor: 'var(--dawaa-theme-border)' }}
        >
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
            {[
              ['فيزا', m.visa],
              ['إنستا باي', m.insta],
              ['فودافون كاش', m.vodafone],
              ['تحويلات أخرى', m.other],
            ].map(([label, value]) => (
              <p key={label as string}>
                <span className="dawaa-caption">{label}</span> {money(value as number)}
              </p>
            ))}
          </div>
          {m.realExpenseLines.length ? (
            <div>
              <p className="dawaa-caption mb-1">المصروفات ({money(m.expenses)}):</p>
              {m.realExpenseLines.map((e, idx) => (
                <p key={idx}>
                  • {e.category || 'مصروف'}
                  {e.description ? ` — ${e.description}` : ''}: {money(num(e.amount))}
                  <span className="dawaa-caption">
                    {' '}
                    · {EXPENSE_SOURCE_LABEL[e.payment_source || 'cash'] ?? e.payment_source}
                  </span>
                </p>
              ))}
            </div>
          ) : m.expenses ? (
            <p>المصروفات {money(m.expenses)} (من غير بنود)</p>
          ) : (
            <p className="dawaa-caption">مفيش مصروفات</p>
          )}
          <p>
            <span className="dawaa-caption">صافي التشغيل (مبيعات − مصروفات):</span>{' '}
            {money(m.operatingNet)}
          </p>
          {people ? (
            <p>
              <span className="dawaa-caption">في الشيفت (بصمات):</span> {presenceLabel(people)}
            </p>
          ) : null}
          <p className="dawaa-caption">
            اتسجل {timeLabel(row.recorded_at)}
            {row.previous_close ? ` · التسليم اللي قبله ${clockLabel(row.previous_close)}` : ''}
          </p>
          {fixes.map((c) => (
            <p key={c.id} style={{ color: 'var(--dawaa-status-warning-text)' }}>
              ✏️ {c.corrected_by_name || '-'} · {timeLabel(c.created_at)} · {c.reason}:{' '}
              {Object.entries(c.changes)
                .map(
                  ([key, value]) =>
                    `${EDIT_LABEL[key] ?? key} ${c.previous[key] ?? '-'} ← ${value ?? '-'}`
                )
                .join('، ')}
            </p>
          ))}
        </div>
      ) : null}

      {editing ? (
        <ReviewNote
          row={row}
          onCancel={() => setEditing(false)}
          onDone={() => {
            setEditing(false);
            onChanged();
          }}
        />
      ) : null}
    </article>
  );
}
