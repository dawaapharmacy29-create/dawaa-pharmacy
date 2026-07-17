import { Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import DoctorDashboardStable from '@/pages/DoctorDashboardStable';
import DoctorReviewDetails from '@/components/doctor/DoctorReviewDetails';
import DoctorTodayFocus from '@/components/doctor/DoctorTodayFocus';
import { canAccessFullConversationReviewWorkspace } from '@/lib/reviewWorkspaceAccess';

export default function DoctorDashboardEnhanced() {
  const { user, checkPermission } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab');

  if (tab === 'reviews' && canAccessFullConversationReviewWorkspace(user, checkPermission)) {
    return <Navigate to="/reviews" replace />;
  }

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
