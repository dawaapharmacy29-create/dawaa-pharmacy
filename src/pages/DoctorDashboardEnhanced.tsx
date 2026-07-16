import { useSearchParams } from 'react-router-dom';
import DoctorDashboardStable from '@/pages/DoctorDashboardStable';
import DoctorReviewDetails from '@/components/doctor/DoctorReviewDetails';

export default function DoctorDashboardEnhanced() {
  const [params] = useSearchParams();
  const tab = params.get('tab');
  return <>
    <DoctorDashboardStable />
    {tab === 'reviews' ? <DoctorReviewDetails /> : null}
  </>;
}
