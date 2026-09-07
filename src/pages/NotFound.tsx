import { useNavigate } from 'react-router-dom';
import { LOGO_URL } from '@/lib/constants';

export default function NotFound() {
  const navigate = useNavigate();
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
