import { Component, useState, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw, X } from 'lucide-react';
import { logRuntimeError } from '@/lib/appRecovery';

type SectionErrorBoundaryProps = {
  label: string;
  children: ReactNode;
};

type SectionErrorBoundaryState = {
  hasError: boolean;
  message: string;
  resetKey: number;
};

function shortErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message || error.name;
  return String(error || 'خطأ غير معروف');
}

// باوندري خاص بكل قسم على حدة، بحيث لو قسم واحد فشل في الرندر ماينفعش
// يسقط باقي أقسام الصفحة (اللي بتتحمّل من الـ PageSafetyBoundary العام على مستوى الراوت).
export default class SectionErrorBoundary extends Component<SectionErrorBoundaryProps, SectionErrorBoundaryState> {
  state: SectionErrorBoundaryState = { hasError: false, message: '', resetKey: 0 };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, message: shortErrorMessage(error) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logRuntimeError(`section failed: ${this.props.label}`, error);
    console.error('[Dawaa section boundary] render failed', this.props.label, error, info);
  }

  retry = () => {
    this.setState((state) => ({ hasError: false, message: '', resetKey: state.resetKey + 1 }));
  };

  render() {
    if (this.state.hasError) {
      return (
        <section className="mx-4 rounded-3xl border border-red-400/25 bg-[#1a1020] p-6 text-center shadow-xl" dir="rtl">
          <AlertTriangle className="mx-auto text-red-300" size={28} />
          <h3 className="mt-3 text-lg font-black text-white">تعذر تحميل «{this.props.label}»</h3>
          <p className="mt-2 text-xs font-bold text-red-200/80">باقي أقسام الصفحة شغالة بشكل طبيعي.</p>
          <p className="mx-auto mt-3 max-w-xl rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-left text-[11px] leading-6 text-slate-300">
            {this.state.message.slice(0, 220)}
          </p>
          <button
            type="button"
            onClick={this.retry}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-cyan-600 px-4 py-2 text-sm font-black text-white hover:bg-cyan-500"
          >
            <RefreshCw size={15} /> إعادة المحاولة
          </button>
        </section>
      );
    }
    // resetKey كـ key بيجبر إعادة تركيب الأبناء بالكامل عند الضغط على "إعادة المحاولة"،
    // عشان أي useEffect بيجيب بيانات يتنفذ تاني بدل ما يفضل واقف على نفس الخطأ.
    return <div key={this.state.resetKey}>{this.props.children}</div>;
  }
}

export function SectionSkeleton({ label, rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div className="mx-4 rounded-3xl border border-white/10 bg-[#0d2238] p-4 shadow-xl" dir="rtl" role="status" aria-live="polite">
      {label ? <div className="mb-3 text-xs font-black text-cyan-300">جارٍ تحميل {label}...</div> : null}
      <div className="animate-pulse space-y-3">
        <div className="h-6 w-2/3 rounded-lg bg-white/[0.06]" />
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-16 rounded-2xl bg-white/[0.05]" />
          ))}
        </div>
        {Array.from({ length: rows }).map((_, index) => (
          <div key={index} className="h-20 rounded-2xl bg-white/[0.04]" />
        ))}
      </div>
      <span className="sr-only">جارٍ التحميل</span>
    </div>
  );
}

// درج تفاصيل موحد (RTL: يفتح من الشمال بصريًا) يستخدمه أكتر من قسم بدل ما كل قسم
// يعمل الـmodal بتاعه لوحده — عشان تجربة استخدام واحدة متسقة، بدون إعادة تحميل الصفحة.
export function Drawer({ open, onClose, title, subtitle, children, width = 'max-w-2xl' }: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  width?: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[130] flex justify-end bg-black/70" dir="rtl" onClick={onClose}>
      <aside
        className={`h-full w-full ${width} overflow-y-auto bg-[#091b2d] p-5 shadow-2xl`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-xl font-black text-white">{title}</h3>
            {subtitle ? <p className="mt-1 truncate text-sm font-bold text-slate-400">{subtitle}</p> : null}
          </div>
          <button type="button" className="btn-secondary shrink-0" onClick={onClose} aria-label="إغلاق">
            <X size={17} />
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </aside>
    </div>
  );
}

export function DrawerFieldGrid({ fields }: { fields: Array<[string, ReactNode]> }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {fields.map(([label, value]) => (
        <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.035] p-3">
          <div className="text-[11px] font-black text-slate-500">{label}</div>
          <div className="mt-1 break-words text-sm font-bold text-white">{value}</div>
        </div>
      ))}
    </div>
  );
}

export function ShowMoreList<T>({ items, pageSize = 25, render, emptyLabel }: {
  items: T[];
  pageSize?: number;
  render: (item: T, index: number) => ReactNode;
  emptyLabel?: ReactNode;
}) {
  // بدل عرض كل الصفوف مرة واحدة على الصفحة (اللي بيطول الصفحة جدًا)، بنعرض أول صفحة
  // ونزود العدد بالضغط، مع الحفاظ على كل البيانات محملة أصلًا في الذاكرة (بدون query تاني).
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const visible = items.slice(0, visibleCount);
  return (
    <>
      {visible.map((item, index) => render(item, index))}
      {!items.length && emptyLabel ? emptyLabel : null}
      {items.length > visibleCount ? (
        <button
          type="button"
          onClick={() => setVisibleCount((count: number) => count + pageSize)}
          className="btn-secondary mt-2 w-full text-xs"
        >
          عرض {Math.min(pageSize, items.length - visibleCount)} أخرى (من إجمالي {items.length.toLocaleString('ar-EG')})
        </button>
      ) : null}
    </>
  );
}

export function SectionEmptyState({ title, description, icon: Icon }: { title: string; description?: string; icon?: typeof AlertTriangle }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center" dir="rtl">
      {Icon ? <Icon className="mx-auto mb-3 text-slate-500" size={26} /> : null}
      <div className="font-black text-slate-300">{title}</div>
      {description ? <div className="mt-1 text-xs font-bold text-slate-500">{description}</div> : null}
    </div>
  );
}
