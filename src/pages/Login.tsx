import { useState } from 'react';
import { Eye, EyeOff, Lock, User } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { FULL_LOGO_URL } from '@/lib/constants';
import { logRuntimeError } from '@/lib/appRecovery';

export default function Login() {
  const showDemoCredentials = import.meta.env.VITE_SHOW_DEMO_CREDENTIALS === 'true';
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      const ok = await login(username.trim(), password);
      if (ok) {
        navigate('/executive-2027', { replace: true });
        return;
      }
      setError('اسم المستخدم أو كلمة المرور غير صحيحة.');
    } catch (submitError) {
      logRuntimeError('login submit failed', submitError);
      setError('تعذر تسجيل الدخول الآن. جرّب مرة أخرى أو افتح التشخيص.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main
      className="login-page relative flex min-h-screen items-center justify-center overflow-hidden bg-navy-900 p-4"
      dir="rtl"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,#123042_0%,#0F1923_42%,#091018_100%)]" />

      <section className="relative w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="login-logo-card mx-auto mb-5">
            <img src={FULL_LOGO_URL} alt="صيدليات دواء" className="h-full w-full object-contain" />
          </div>
          <h1 className="text-2xl font-bold text-white">صيدليات دواء</h1>
          <p className="mt-1 text-sm text-slate-400">نظام تشغيل الصيدلية الذكي</p>
        </div>

        <div className="rounded-2xl border border-[#2d4063] bg-[#1B2B4B] p-8 shadow-2xl shadow-black/40">
          <h2 className="mb-6 text-center text-lg font-bold text-white">تسجيل الدخول</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-300">اسم المستخدم</label>
              <div className="relative">
                <User className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="أدخل اسم المستخدم"
                  className="input-dark pr-10"
                  required
                  autoComplete="username"
                />
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-300">كلمة المرور</label>
              <div className="relative">
                <Lock className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="أدخل كلمة المرور"
                  className="input-dark pr-10 pl-10"
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPass((value) => !value)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                  aria-label={showPass ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                >
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-center text-sm text-red-300">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn-primary mt-2 flex w-full items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {loading ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-navy-900/30 border-t-navy-900" />
                  جاري التحقق...
                </>
              ) : (
                'دخول'
              )}
            </button>
          </form>

          <div className="mt-4 text-center">
            <a href="/diagnostics" className="text-xs font-bold text-teal-200 hover:text-teal-100">
              فتح التشخيص
            </a>
          </div>

          {showDemoCredentials && (
            <div className="mt-6 rounded-xl border border-white/5 bg-white/5 p-4">
              <p className="text-center text-xs font-medium text-slate-400">
                بيانات الدخول التجريبية لا تظهر في نسخة التشغيل. راجع مسؤول النظام.
              </p>
            </div>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-slate-500">
          © 2026 صيدليات دواء - جميع الحقوق محفوظة
        </p>
      </section>
    </main>
  );
}
