import type { ReactNode } from 'react';

/**
 * Shared visual primitives for dashboard pages, extracted verbatim from
 * ExecutiveDashboard2027 (the cleanest existing implementation — built
 * entirely on the canonical dawaa-* semantic classes and
 * var(--dawaa-*) tokens, zero hardcoded colors).
 *
 * Goal: stop every large dashboard page from redefining its own local
 * Panel/SectionTitle/KpiCard/MiniBox (found duplicated across
 * ExecutiveDashboard2027, Analytics, AttendanceReport,
 * CustomerDataReview, and others as of this writing). New dashboard
 * work should import from here instead of adding another local copy.
 */

export function Panel({
  children,
  className = '',
  id,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={`dawaa-card dawaa-card--raised rounded-3xl ${className}`}>
      {children}
    </section>
  );
}

export function SectionTitle({
  icon,
  title,
  subtitle,
}: {
  icon?: ReactNode;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <div>
        <h2 className="dawaa-title text-xl">{title}</h2>
        {subtitle ? <p className="dawaa-caption mt-1 text-xs font-bold">{subtitle}</p> : null}
      </div>
      {icon ? <div className="dawaa-icon-tile p-3">{icon}</div> : null}
    </div>
  );
}

const KPI_TONE_CLASS = {
  cyan: 'dawaa-badge--info',
  green: 'dawaa-badge--success',
  amber: 'dawaa-badge--warning',
  blue: 'dawaa-badge--info',
  purple: 'dawaa-badge--info',
  red: 'dawaa-badge--danger',
} as const;

export type DashboardTone = keyof typeof KPI_TONE_CLASS;

export function KpiCard({
  title,
  value,
  subtitle,
  icon,
  tone = 'cyan',
  onClick,
  actionLabel,
  onAction,
  showAction = false,
  loading = false,
  stale = false,
}: {
  title: string;
  value: string;
  subtitle: string;
  icon: ReactNode;
  tone?: DashboardTone;
  onClick?: () => void;
  actionLabel?: string;
  onAction?: () => void;
  showAction?: boolean;
  /** أول تحميل لسه شغال ومفيش رقم اتعرض قبل كده — نعرض skeleton بدل نص "..." */
  loading?: boolean;
  /** الرقم المعروض قديم (آخر تحميل ناجح) بسبب فشل مؤقت في محاولة تحديث لاحقة */
  stale?: boolean;
}) {
  const toneClass = KPI_TONE_CLASS[tone];

  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(event) => {
        if (!onClick) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      }}
      className={`dawaa-card dawaa-card--interactive relative overflow-hidden p-5 ${onClick ? 'cursor-pointer focus:outline-none focus:ring-2 focus:ring-[var(--dawaa-theme-focus)]' : ''}`}
    >
      <div className="absolute -left-8 -top-8 h-24 w-24 rounded-full bg-[var(--dawaa-theme-soft)] blur-2xl" />
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-black text-[var(--dawaa-theme-text)]">
            {title}
            {stale ? (
              <span
                title="آخر بيانات ناجحة — جاري محاولة التحديث"
                className="h-1.5 w-1.5 rounded-full bg-[var(--dawaa-status-warning-bg)]"
              />
            ) : null}
          </p>
          {loading ? (
            <div className="mt-3 h-8 w-28 animate-pulse rounded-lg bg-[var(--dawaa-theme-soft)]" />
          ) : (
            <p className="mt-3 text-3xl font-black tracking-tight text-[var(--dawaa-theme-heading)]">{value}</p>
          )}
          <p className="mt-2 text-xs font-bold text-[var(--dawaa-theme-muted)]">{subtitle}</p>
        </div>
        <div className={`dawaa-icon-tile p-3 ${toneClass}`}>{icon}</div>
      </div>
      {showAction && onAction ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onAction();
          }}
          className="mt-3 rounded-xl border border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-surface)] px-3 py-2 text-xs font-black text-[var(--dawaa-theme-primary-strong)] hover:bg-[var(--dawaa-theme-accent-soft)]"
        >
          {actionLabel || 'إعادة تحميل القسم'}
        </button>
      ) : null}
    </div>
  );
}

const MINIBOX_TONE_CLASS = {
  cyan: 'border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-accent-soft)] text-[var(--dawaa-theme-primary-strong)]',
  green: 'border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)] text-[var(--dawaa-status-success-text)]',
  amber: 'border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] text-[var(--dawaa-status-warning-text)]',
  red: 'border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] text-[var(--dawaa-status-danger-text)]',
  blue: 'border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] text-[var(--dawaa-status-info-text)]',
} as const;

export function MiniBox({
  label,
  value,
  tone = 'cyan',
}: {
  label: string;
  value: string;
  tone?: keyof typeof MINIBOX_TONE_CLASS;
}) {
  const classes = MINIBOX_TONE_CLASS[tone];
  return (
    <div className={`rounded-2xl border p-4 ${classes}`}>
      <p className="text-xs font-black text-[var(--dawaa-theme-text)]">{label}</p>
      <p className="mt-2 text-2xl font-black text-[var(--dawaa-theme-heading)]">{value}</p>
    </div>
  );
}

export function EmptyState({
  label,
  error,
  onRetry,
}: {
  label: string;
  error?: boolean;
  onRetry?: () => void;
}) {
  // لو القسم فاضل بسبب فشل تحميل حقيقي (مش لأنه فعلاً مفيش بيانات)، لازم نوضح
  // ده للمستخدم بدل رسالة "لا توجد بيانات" المضللة، ونديله زرار يعيد تحميل نفس القسم.
  if (error) {
    return (
      <div className="flex h-full min-h-56 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)]/[0.04] p-4 text-center">
        <span className="text-sm font-black text-[var(--dawaa-status-danger-text)]">تعذر تحميل البيانات</span>
        <span className="text-xs font-bold text-[var(--dawaa-status-danger-text)]/70">قد يكون الاتصال بطيء، جرّب إعادة المحاولة.</span>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="mt-1 rounded-xl border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-theme-surface)] px-3 py-2 text-xs font-black text-[var(--dawaa-status-danger-text)] hover:bg-[var(--dawaa-status-danger-bg)]"
          >
            إعادة المحاولة
          </button>
        ) : null}
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-56 items-center justify-center rounded-2xl border border-dashed border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-surface)] text-sm font-black text-[var(--dawaa-theme-muted)]">
      {label}
    </div>
  );
}
