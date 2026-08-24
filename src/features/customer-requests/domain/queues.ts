import type { CustomerRequest } from '@/lib/api/customerRequests';
import { customerRequestIsClosedStatus } from './status';
import { customerRequestIsOverdue, customerRequestIsUrgent } from './request';

export type CustomerRequestQueueKey =
  | 'needs_action'
  | 'urgent'
  | 'overdue'
  | 'ready_to_contact'
  | 'followup_due'
  | 'unassigned'
  | 'completed';

export function customerRequestBelongsToQueue(request: CustomerRequest, queue: CustomerRequestQueueKey, now = Date.now()) {
  const status = String(request.status || 'new');
  const closed = customerRequestIsClosedStatus(status);

  switch (queue) {
    case 'needs_action':
      return !closed && ['new', 'purchasing_review', 'searching_suppliers', 'needs_customer_confirmation', 'customer_confirmed', 'sourcing', 'available', 'arrived', 'customer_contacted'].includes(status);
    case 'urgent':
      return !closed && customerRequestIsUrgent(request);
    case 'overdue':
      return !closed && customerRequestIsOverdue(request);
    case 'ready_to_contact':
      return !closed && ['available', 'arrived'].includes(status);
    case 'followup_due': {
      if (closed || !request.due_date) return false;
      const due = new Date(request.due_date).getTime();
      return Number.isFinite(due) && due <= now;
    }
    case 'unassigned':
      return !closed && !(request.purchasing_assignee || request.source_assigned_employee)?.trim();
    case 'completed':
      return closed;
  }
}

export const CUSTOMER_REQUEST_QUEUE_LABELS: Record<CustomerRequestQueueKey, string> = {
  needs_action: 'يحتاج إجراء',
  urgent: 'عاجل',
  overdue: 'متأخر',
  ready_to_contact: 'جاهز للتواصل',
  followup_due: 'متابعة مستحقة',
  unassigned: 'بدون مسئول',
  completed: 'مكتمل',
};
