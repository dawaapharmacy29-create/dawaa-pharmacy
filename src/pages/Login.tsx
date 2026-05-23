import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { FULL_LOGO_URL } from "@/lib/constants";
import { Eye, EyeOff, Lock, User } from "lucide-react";

export default function Login() {
  const showDemoCredentials = import.meta.env.VITE_SHOW_DEMO_CREDENTIALS === "true";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    await new Promise((r) => setTimeout(r, 600));
    const ok = await login(username.trim(), password);
    if (ok) {
      navigate("/");
    } else {
      setError("اسم المستخدم أو كلمة المرور غير صحيحة");
    }
    setLoading(false);
  };

  return (
    <div className="login-page min-h-screen bg-navy-900 flex items-center justify-center p-4" dir="rtl">
      {/* Background */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,#123042_0%,#0F1923_42%,#091018_100%)]" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="login-logo-card mx-auto mb-5">
            <img src={FULL_LOGO_URL} alt="دواء" className="w-full h-full object-contain" />
          </div>
          <h1 className="text-2xl font-bold text-white">صيدليات دواء</h1>
          <p className="text-slate-400 text-sm mt-1">كل اللي تحتاجه واكتر</p>
        </div>

        {/* Card */}
        <div className="bg-[#1B2B4B] border border-[#2d4063] rounded-2xl p-8 shadow-2xl shadow-black/40">
          <h2 className="text-white font-bold text-lg mb-6 text-center">تسجيل الدخول</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Username */}
            <div>
              <label className="block text-slate-300 text-sm font-medium mb-2">اسم المستخدم</label>
              <div className="relative">
                <User className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="أدخل اسم المستخدم"
                  className="input-dark pr-10"
                  required
                  autoComplete="username"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-slate-300 text-sm font-medium mb-2">كلمة المرور</label>
              <div className="relative">
                <Lock className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                <input
                  type={showPass ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="أدخل كلمة المرور"
                  className="input-dark pr-10 pl-10"
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                >
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-red-400 text-sm text-center">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full flex items-center justify-center gap-2 mt-2"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-navy-900/30 border-t-navy-900 rounded-full animate-spin" />
                  جارٍ التحقق...
                </>
              ) : (
                "دخول"
              )}
            </button>
          </form>

          {showDemoCredentials && (
            <div className="mt-6 p-4 bg-white/3 rounded-xl border border-white/5">
              <p className="text-slate-400 text-xs text-center mb-2 font-medium">بيانات تجريبية</p>
              <div className="grid grid-cols-2 gap-2 text-xs text-slate-400">
                <div><span className="text-slate-300">أدمن:</span> admin / admin123</div>
                <div><span className="text-slate-300">مدير فرع:</span> yasmine.farouk / pass123</div>
              </div>
            </div>
          )}
        </div>

        <p className="text-center text-slate-500 text-xs mt-6">
          © 2026 صيدليات دواء — جميع الحقوق محفوظة
        </p>
      </div>
    </div>
  );
}
