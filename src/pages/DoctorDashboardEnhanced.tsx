import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import DoctorDashboardStable from '@/pages/DoctorDashboardStable';
import DoctorReviewDetails from '@/components/doctor/DoctorReviewDetails';
import DoctorTodayFocus from '@/components/doctor/DoctorTodayFocus';

export default function DoctorDashboardEnhanced() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab');

  return <div className="space-y-5" dir="rtl">
    {(!tab || tab === 'overview') ? <DoctorTodayFocus
      staffId={String(user?.staffId || '')}
      userId={String(user?.id || '')}
      doctorName={String(user?.name || '')}
      onNavigate={(next) => setParams({ tab: next })}
    /> : null}
    <DoctorDashboardStable />
    {tab === 'reviews' ? <DoctorReviewDetails /> : null}
  </div>;
}
