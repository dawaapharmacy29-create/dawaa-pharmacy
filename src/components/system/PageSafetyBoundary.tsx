import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { logRuntimeError } from '@/lib/appRecovery';

type PageSafetyBoundaryProps = {
  pageName: string;
  children: ReactNode;
};

type PageSafetyBoundaryState = {
  hasError: boolean;
  message: string;
};

function shortErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message || error.name;
  return String(error || 'unknown error');
}

export default class PageSafetyBoundary extends Component<
  PageSafetyBoundaryProps,
  PageSafetyBoundaryState
> {
  state: PageSafetyBoundaryState = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, message: shortErrorMessage(error) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logRuntimeError(`page failed: ${this.props.pageName}`, error);
    console.error('[Dawaa page safety] render failed', this.props.pageName, error, info);
  }

  retry = () => {
    this.setState({ hasError: false, message: '' });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const message = this.state.message.slice(0, 220) || 'unknown error';

    return (
      <main className="min-h-[60vh] bg-slate-950 p-5 text-slate-100" dir="rtl">
        <section className="mx-auto max-w-xl rounded-2xl border border-red-400/30 bg-slate-900 p-6 text-center shadow-2xl">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-red-500/15 text-2xl text-red-100">
            !
          </div>
          <h1 className="text-2xl font-black text-white">تعذر تحميل هذه الصفحة</h1>
          <p className="mt-2 text-sm font-bold text-teal-200">{this.props.pageName}</p>
          <p className="mt-4 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-left text-xs leading-6 text-slate-300">
            {message}
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={this.retry}
              className="rounded-xl bg-teal-600 px-4 py-3 text-sm font-black text-white hover:bg-teal-500"
            >
              إعادة المحاولة
            </button>
            <Link
              to="/diagnostics"
              className="rounded-xl border border-slate-700 px-4 py-3 text-sm font-black text-slate-100 hover:bg-slate-800"
            >
              فتح التشخيص
            </Link>
            <Link
              to="/executive-2027"
              className="rounded-xl border border-slate-700 px-4 py-3 text-sm font-black text-slate-100 hover:bg-slate-800"
            >
              العودة للداشبورد
            </Link>
            <Link
              to="/login"
              className="rounded-xl border border-slate-700 px-4 py-3 text-sm font-black text-slate-100 hover:bg-slate-800"
            >
              تسجيل الدخول
            </Link>
          </div>
        </section>
      </main>
    );
  }
}
