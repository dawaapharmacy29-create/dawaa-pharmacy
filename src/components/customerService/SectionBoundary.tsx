import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
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

export function SectionEmptyState({ title, description, icon: Icon }: { title: string; description?: string; icon?: typeof AlertTriangle }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center" dir="rtl">
      {Icon ? <Icon className="mx-auto mb-3 text-slate-500" size={26} /> : null}
      <div className="font-black text-slate-300">{title}</div>
      {description ? <div className="mt-1 text-xs font-bold text-slate-500">{description}</div> : null}
    </div>
  );
}
