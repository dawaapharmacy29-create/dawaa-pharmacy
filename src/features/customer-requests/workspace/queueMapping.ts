import type { CustomerRequestQuickFilter } from '../data';
import type { CustomerRequestQueueKey } from '../domain/queues';

export const CUSTOMER_REQUEST_QUEUE_TO_FILTER: Record<CustomerRequestQueueKey, CustomerRequestQuickFilter> = {
  needs_action: 'attention',
  urgent: 'urgent',
  overdue: 'overdue',
  ready_to_contact: 'attention',
  followup_due: 'followup_due',
  unassigned: 'unassigned',
  completed: 'all',
};

export function customerRequestQueueToFilter(queue: CustomerRequestQueueKey) {
  return CUSTOMER_REQUEST_QUEUE_TO_FILTER[queue];
}
