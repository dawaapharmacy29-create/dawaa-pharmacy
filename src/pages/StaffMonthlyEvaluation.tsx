import { useAuth } from '@/hooks/useAuth';
import { normalizeRole } from '@/lib/core/permissionSystem';
import CustomerServiceDoctorEvaluation from '@/pages/CustomerServiceDoctorEvaluation';
import StaffMonthlyEvaluationGeneral from '@/pages/StaffMonthlyEvaluationGeneral';

// هبه حماده/هاجر/نور (فريق دواء) واخدين دور مقيّم خدمة العملاء اللي كان شاغله
// customer_service_manager قبل كده — نفس المعرفات المستخدمة في
// assistant_operational_eligible_staff.
const TEAM_DAWAA_CS_EVALUATOR_IDS = new Set([
  '82b9c2a1-6139-4b07-9937-ef80a6e926d8', // نور
  'e3640642-5c60-4815-8001-1bb93193668f', // هاجر
  'dea91886-1ae8-4766-a166-9952866a5024', // هبة حماده
]);

export default function StaffMonthlyEvaluation() {
  const { user } = useAuth();
  const staffId = user?.staffId || user?.id || '';
  const isTeamDawaaEvaluator = TEAM_DAWAA_CS_EVALUATOR_IDS.has(staffId);
  return normalizeRole(user?.role) === 'customer_service_manager' || isTeamDawaaEvaluator
    ? <CustomerServiceDoctorEvaluation />
    : <StaffMonthlyEvaluationGeneral />;
}
