import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { LOGO_URL } from '@/lib/constants';
import { useAuth } from '@/hooks/useAuth';
import Layout from '@/components/layout/Layout';
import SystemIntegrations from '@/pages/SystemIntegrations';

export default function NotFound() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, loading, isAdmin, checkPermission } = useAuth();

  // Transitional route bridge until /system-integrations is moved into App.tsx as a first-class route.
  // Keep the same authentication/layout boundary and do not widen permissions.
  if (location.pathname === '/system-integrations') {
    if (loading) {
      return (
        <div className="min-h-screen dawaa-app-bg grid place-items-center" dir="rtl">
          <div className="dawaa-card dawaa-card--soft p-6 text-sm font-black">جاري التحقق من الصلاحيات...</div>
        </div>
      );
    }
    if (!user) return <Navigate to="/login" replace />;
    if (!isAdmin && !checkPermission('view_data_health')) {
      return (
        <Layout>
          <div className="dawaa-card dawaa-card--soft dawaa-body py-16 text-center" dir="rtl">
            ليس لديك صلاحية للوصول إلى مركز المزامنة والتكاملات.
          </div>
        </Layout>
      );
    }
    return (
      <Layout>
        <SystemIntegrations />
      </Layout>
    );
  }

  return (
    <div className="min-h-screen bg-navy-900 flex items-center justify-center p-4" dir="rtl">
      <div className="text-center">
        <img
          src={LOGO_URL}
          alt="دواء"
          className="w-20 h-20 mx-auto rounded-2xl object-contain mb-6 opacity-50"
        />
        <div className="text-teal-400 font-bold text-6xl mb-2">404</div>
        <div className="text-white font-bold text-xl mb-2">الصفحة غير موجودة</div>
        <div className="text-slate-400 text-sm mb-6">عذراً، الصفحة التي تبحث عنها غير موجودة</div>
        <button onClick={() => navigate('/')} className="btn-primary">
          العودة للرئيسية
        </button>
      </div>
    </div>
  );
}
