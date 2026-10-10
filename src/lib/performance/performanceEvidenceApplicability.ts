import type { CanonicalStaffRole } from '@/lib/staff/staffRoleCapabilities';
import type { TaskEvidenceSourceType } from '@/lib/tasks/taskEvidence';

const ROLE_TASK_SOURCES: Partial<Record<CanonicalStaffRole, readonly TaskEvidenceSourceType[]>> = {
  doctor: ['shift_note','customer_followup','customer_request'],
  assistant: ['task','shift_note','shelf_task','customer_request'],
  inventory_assistant: ['task','shift_note','shelf_task'],
  cleaning: ['cleaning_task','shift_note'],
  delivery: ['task','shift_note','customer_request'],
  customer_service: ['customer_followup','customer_request','shift_note'],
  customer_service_manager: ['manager_checklist','customer_followup','shift_note'],
  shift_supervisor: ['manager_checklist','shift_note','task'],
  branch_manager: ['manager_checklist','shift_note','task'],
  branches_manager: ['manager_checklist','shift_note','task'],
  purchasing: ['task','customer_request','shift_note'],
  executive: ['manager_checklist','task','shift_note'],
  admin: ['manager_checklist','task','shift_note'],
};

export function taskEvidenceSourcesForRole(role: CanonicalStaffRole): TaskEvidenceSourceType[] {
  return [...(ROLE_TASK_SOURCES[role] || [])];
}

export function roleTaskEvidenceApplicabilityConfigured(role: CanonicalStaffRole): boolean {
  return taskEvidenceSourcesForRole(role).length > 0;
}
