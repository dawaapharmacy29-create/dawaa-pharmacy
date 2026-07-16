import DoctorDashboardStable from '@/pages/DoctorDashboardStable';
import DoctorReviewDetails from '@/components/doctor/DoctorReviewDetails';

export default function DoctorDashboardEnhanced() {
  const tab = new URLSearchParams(window.location.search).get('tab');
  return <>
    <DoctorDashboardStable />
    {tab === 'reviews' ? <DoctorReviewDetails /> : null}
  </>;
}
