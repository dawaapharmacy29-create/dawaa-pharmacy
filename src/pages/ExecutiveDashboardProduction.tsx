import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import ExecutiveDashboardSafe from '@/pages/ExecutiveDashboardSafe';

const ExecutiveDashboard2027 = lazy(() => import('@/pages/ExecutiveDashboard2027'));

type BoundaryState = {
  hasError: boolean;
  message: string;
};

class ExecutiveDashboardBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return {
      hasError: true,
      message: error?.message || 'تعذر تحميل لوحة القيادة المتقدمة',
    };
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error('[ExecutiveDashboardProduction] advanced dashboard failed', error, info);
  }

  render() {
    if (this.state.hasError) return <ExecutiveDashboardSafe />;
    return this.props.children;
  }
}

function DashboardLoadingFallback() {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const id = window.setTimeout(() => setSlow(true), 8000);
    return () => window.clearTimeout(id);
  }, []);

  if (slow) return <ExecutiveDashboardSafe />;

  return (
    <div dir="rtl" className="min-h-[60vh] bg-[#06131f] p-6 text-slate-100">
      <div className="mx-auto max-w-6xl rounded-2xl border border-cyan-300/15 bg-slate-900/80 p-6">
        <div className="h-7 w-56 animate-pulse rounded-xl bg-slate-700/70" />
        <div className="mt-6 grid gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-28 animate-pulse rounded-2xl bg-slate-800/80" />
          ))}
        </div>
        <p className="mt-5 text-sm font-bold text-slate-300">جاري تحميل لوحة القيادة 2027...</p>
      </div>
    </div>
  );
}

export default function ExecutiveDashboardProduction() {
  return (
    <ExecutiveDashboardBoundary>
      <Suspense fallback={<DashboardLoadingFallback />}>
        <ExecutiveDashboard2027 />
      </Suspense>
    </ExecutiveDashboardBoundary>
  );
}
