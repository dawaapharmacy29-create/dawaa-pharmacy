import type { ReactNode } from 'react';
import { CheckCircle2, ChevronDown, Circle, TriangleAlert } from 'lucide-react';

// Shared pieces of the two daily lists («قائمة اليوم» for the branch manager, «مراجعتي اليومية» for the
// general manager): a progress ring, the open / issue / done counters, a collapsible section header and the
// compact one-line row of a finished item. Colors come from the theme status tokens (light and dark).

export type DailyItemTone = 'issue' | 'open' | 'done';

export const TONE_ACCENT: Record<DailyItemTone, string> = {
  issue: 'border-s-4 border-s-[var(--dawaa-status-warning-text)]',
  open: 'border-s-4 border-s-[var(--dawaa-status-danger-text)]',
  done: 'border-s-4 border-s-[var(--dawaa-status-success-text)]',
};

export function ToneIcon({
  tone,
  className = 'h-5 w-5',
}: {
  tone: DailyItemTone;
  className?: string;
}) {
  if (tone === 'issue')
    return (
      <TriangleAlert
        aria-label="فيه مشكلة"
        className={`${className} shrink-0 text-[var(--dawaa-status-warning-text)]`}
      />
    );
  if (tone === 'done')
    return (
      <CheckCircle2
        aria-label="خلص"
        className={`${className} shrink-0 text-[var(--dawaa-status-success-text)]`}
      />
    );
  return (
    <Circle
      aria-label="لسه"
      className={`${className} shrink-0 text-[var(--dawaa-status-danger-text)]`}
    />
  );
}

/** A ring with the percent inside; green when everything is done. */
export function ProgressRing({
  done,
  total,
  size = 64,
}: {
  done: number;
  total: number;
  size?: number;
}) {
  const percent = Math.round((done / Math.max(total, 1)) * 100);
  const stroke = 6;
  const radius = (size - stroke) / 2;
  const length = 2 * Math.PI * radius;
  const complete = total > 0 && done >= total;
  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${done} من ${total} خلصوا`}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-[var(--dawaa-theme-border,rgba(148,163,184,0.35))]"
          stroke="currentColor"
          opacity={0.25}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={length}
          strokeDashoffset={length * (1 - percent / 100)}
          style={{
            stroke: complete ? 'var(--dawaa-status-success-text)' : 'var(--dawaa-status-info-text)',
            transition: 'stroke-dashoffset 300ms ease',
          }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="text-sm font-black">{percent}%</span>
        <span className="dawaa-caption mt-0.5 text-[10px] font-bold">
          {done}/{total}
        </span>
      </div>
    </div>
  );
}

/** «لسه N · مشكلة N · خلص N»: the three numbers that matter at a glance. */
export function StatusCounters({
  open,
  issues,
  done,
}: {
  open: number;
  issues: number;
  done: number;
}) {
  const chip = (
    tone: 'danger' | 'warning' | 'success',
    icon: ReactNode,
    text: string,
    n: number
  ) => (
    <span
      className={`dawaa-badge dawaa-badge--${tone} inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-black ${n ? '' : 'opacity-50'}`}
    >
      {icon}
      {n} {text}
    </span>
  );
  return (
    <div className="flex flex-wrap gap-2">
      {chip('danger', <Circle className="h-3.5 w-3.5" />, 'لسه', open)}
      {chip('warning', <TriangleAlert className="h-3.5 w-3.5" />, 'فيها مشكلة', issues)}
      {chip('success', <CheckCircle2 className="h-3.5 w-3.5" />, 'خلصت', done)}
    </div>
  );
}

/** A thin bar; green once full. */
export function MiniBar({ done, total }: { done: number; total: number }) {
  const percent = Math.round((done / Math.max(total, 1)) * 100);
  return (
    <div className="dawaa-theme-border h-1.5 w-full overflow-hidden rounded-full border">
      <div
        className="h-full rounded-full transition-all"
        style={{
          width: `${percent}%`,
          background:
            total > 0 && done >= total
              ? 'var(--dawaa-status-success-text)'
              : 'var(--dawaa-status-info-text)',
        }}
      />
    </div>
  );
}

/** The clickable head of a section: title, hint, «done/total» and its bar. */
export function SectionHeader({
  title,
  hint,
  done,
  total,
  issues = 0,
  open,
  onToggle,
}: {
  title: string;
  hint?: string;
  done: number;
  total: number;
  issues?: number;
  open: boolean;
  onToggle: () => void;
}) {
  const complete = total > 0 && done >= total && !issues;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="flex w-full items-center gap-3 text-start"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="dawaa-theme-heading text-sm font-black">{title}</h3>
          <span
            className={`dawaa-badge ${complete ? 'dawaa-badge--success' : issues ? 'dawaa-badge--warning' : 'dawaa-badge--info'} rounded-full px-2 py-0.5 text-[11px] font-black`}
          >
            {complete ? 'خلصت ✓' : `${done} من ${total}`}
          </span>
        </div>
        {hint ? <p className="dawaa-caption mt-0.5 text-[11px] font-bold">{hint}</p> : null}
        <div className="mt-2 max-w-[220px]">
          <MiniBar done={done} total={total} />
        </div>
      </div>
      <ChevronDown
        className={`dawaa-caption h-5 w-5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
      />
    </button>
  );
}

/** One line for a finished item: no buttons except «تراجع» when it was marked by hand. */
export function DoneRow({
  title,
  detail,
  onUndo,
  busy,
}: {
  title: string;
  detail?: string | null;
  onUndo?: () => void;
  busy?: boolean;
}) {
  return (
    <li className="flex items-center gap-2 py-1.5 text-xs">
      <ToneIcon tone="done" className="h-4 w-4" />
      <span className="min-w-0 flex-1 truncate font-bold">
        {title}
        {detail ? <span className="dawaa-caption font-bold"> · {detail}</span> : null}
      </span>
      {onUndo ? (
        <button
          type="button"
          disabled={busy}
          onClick={onUndo}
          className="dawaa-caption shrink-0 text-[11px] font-black underline disabled:opacity-50"
        >
          تراجع
        </button>
      ) : null}
    </li>
  );
}
