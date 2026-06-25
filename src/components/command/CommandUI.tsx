import { isValidElement, type ElementType, type ReactNode } from 'react';

export function CommandHeader({
  title,
  description,
  subtitle,
  badge,
}: {
  title: string;
  description?: string;
  subtitle?: string;
  badge?: string;
}) {
  const text = description ?? subtitle ?? '';
  return (
    <section className="dawaa-hero" dir="rtl">
      <div>
        {badge && <span className="dawaa-brand-chip">{badge}</span>}
        <h1 className="mt-3 text-2xl font-black text-slate-950 dark:text-white">{title}</h1>
        <p className="mt-1 text-sm font-semibold text-slate-600 dark:text-slate-300">
          {text}
        </p>
      </div>
    </section>
  );
}

export function MetricCard({
  icon,
  label,
  value,
  hint,
  tone = 'teal',
}: {
  icon: ElementType | ReactNode;
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: 'teal' | 'red' | 'amber' | 'green' | 'sky' | 'emerald' | 'rose';
}) {
  const tones = {
    teal: 'bg-teal-500/10 text-teal-500',
    red: 'bg-red-500/10 text-red-500',
    amber: 'bg-amber-500/10 text-amber-500',
    green: 'bg-emerald-500/10 text-emerald-500',
    sky: 'bg-sky-500/10 text-sky-500',
    emerald: 'bg-emerald-500/10 text-emerald-500',
    rose: 'bg-rose-500/10 text-rose-500',
  };
  const isRenderableComponent =
    typeof icon === 'function' ||
    (typeof icon === 'object' && icon !== null && !isValidElement(icon));
  const IconComponent = icon as ElementType;
  const iconNode = isRenderableComponent ? <IconComponent className="h-6 w-6" /> : icon;
  return (
    <article className="dawaa-card">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-bold text-slate-500">{label}</div>
          <div className="mt-2 text-2xl font-black text-slate-950 dark:text-white">{value}</div>
          {hint && <div className="mt-1 text-xs font-semibold text-slate-500">{hint}</div>}
        </div>
        <div className={`rounded-2xl p-3 ${tones[tone]}`}>
          {iconNode}
        </div>
      </div>
    </article>
  );
}

export function SectionState({
  state,
  message,
  loading,
  error,
  empty,
  children,
}: {
  state?: 'loading' | 'error' | 'empty';
  message?: string | null;
  loading?: boolean;
  error?: string | null;
  empty?: boolean;
  children?: ReactNode;
}) {
  const isLoading = loading || state === 'loading';
  const errorMessage = error || (state === 'error' ? message : null);
  const isEmpty = empty || state === 'empty';

  if (isLoading)
    return (
      <div className="dawaa-panel animate-pulse text-center text-sm font-bold text-slate-500">
        جاري تحميل البيانات...
      </div>
    );
  if (errorMessage)
    return (
      <div className="dawaa-panel border-red-500/20 text-center text-sm font-bold text-red-500">
        {errorMessage}
      </div>
    );
  if (isEmpty)
    return (
      <div className="dawaa-panel text-center text-sm font-bold text-slate-500">
        لا توجد بيانات كافية لهذا القسم حاليًا
      </div>
    );
  return <>{children}</>;
}
