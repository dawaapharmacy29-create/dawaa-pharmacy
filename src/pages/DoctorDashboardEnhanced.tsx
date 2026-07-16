import { Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import DoctorDashboardStable from '@/pages/DoctorDashboardStable';
import DoctorReviewDetails from '@/components/doctor/DoctorReviewDetails';
import { canAccessFullConversationReviewWorkspace } from '@/lib/reviewWorkspaceAccess';

export default function DoctorDashboardEnhanced() {
  const { user, checkPermission } = useAuth();
  const [params] = useSearchParams();
  const tab = params.get('tab');

  if (tab === 'reviews' && canAccessFullConversationReviewWorkspace(user, checkPermission)) {
    return <Navigate to="/reviews" replace />;
  }

  return <>
    <DoctorDashboardStable />
    {tab === 'reviews' ? <DoctorReviewDetails /> : null}
  </>;
}
