import { useAuth } from '@/hooks/useAuth';
import { normalizeRole } from '@/lib/core/permissionSystem';
import CustomerServiceDoctorEvaluation from '@/pages/CustomerServiceDoctorEvaluation';
import StaffMonthlyEvaluationGeneral from '@/pages/StaffMonthlyEvaluationGeneral';

export default function StaffMonthlyEvaluation() {
  const { user } = useAuth();
  return normalizeRole(user?.role) === 'customer_service_manager'
    ? <CustomerServiceDoctorEvaluation />
    : <StaffMonthlyEvaluationGeneral />;
}
