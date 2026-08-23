import { Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import DoctorDashboardStable from '@/pages/DoctorDashboardStable';
import DoctorReviewDetails from '@/components/doctor/DoctorReviewDetails';
import DoctorTodayFocus from '@/components/doctor/DoctorTodayFocus';
import DoctorIncentiveSummaryCard from '@/components/doctor/DoctorIncentiveSummaryCard';
import DoctorDetailedActivityCard from '@/components/doctor/DoctorDetailedActivityCard';
import { canAccessFullConversationReviewWorkspace } from '@/lib/reviewWorkspaceAccess';
import '@/styles/dashboard-theme-scopes.css';

export default function DoctorDashboardEnhanced() {
  const { user, checkPermission } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab');

  if (tab === 'reviews' && canAccessFullConversationReviewWorkspace(user, checkPermission)) {
    return <Navigate to="/reviews" replace />;
  }

  return <div className="doctor-dashboard-theme space-y-5" dir="rtl">
    {(!tab || tab === 'overview') ? <>
      <DoctorIncentiveSummaryCard staffId={String(user?.staffId || '')} onNavigate={() => setParams({ tab: 'payroll' })} />
      <DoctorDetailedActivityCard staffId={String(user?.staffId || '')} doctorName={String(user?.name || '')} />
      <DoctorTodayFocus
        staffId={String(user?.staffId || '')}
        userId={String(user?.id || '')}
        doctorName={String(user?.name || '')}
        onNavigate={(next) => setParams({ tab: next })}
      />
    </> : null}
    <DoctorDashboardStable hideReviews={tab === 'reviews'} />
    {tab === 'reviews' ? <DoctorReviewDetails /> : null}
  </div>;
}