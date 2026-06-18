export type UUID = string;
export type ISODateString = string;

export type CRMRequestStatus =
  | 'new'
  | 'open'
  | 'in_progress'
  | 'waiting_customer'
  | 'waiting_internal'
  | 'resolved'
  | 'closed'
  | 'cancelled';

export type CRMRequestPriority = 'low' | 'normal' | 'high' | 'urgent';

export type CRMRequestType =
  | 'follow_up'
  | 'complaint'
  | 'inquiry'
  | 'cashback'
  | 'delivery'
  | 'sales'
  | 'medical'
  | 'other';

export type CRMRequestSource =
  | 'manual'
  | 'phone'
  | 'whatsapp'
  | 'facebook'
  | 'branch'
  | 'delivery'
  | 'system';

export type CRMTimelineEventType =
  | 'created'
  | 'note'
  | 'status_changed'
  | 'assigned'
  | 'whatsapp'
  | 'call'
  | 'follow_up'
  | 'completed'
  | 'reopened'
  | 'system';

export type CRMMetadataValue = string | number | boolean | null | string[] | number[];
export type CRMMetadata = Record<string, CRMMetadataValue>;

export interface CRMRequest {
  id: UUID;
  company_id: UUID;
  customer_id: UUID | null;
  customer_code: string | null;
  customer_name: string;
  customer_phone: string | null;
  title: string;
  description: string | null;
  request_type: CRMRequestType;
  source: CRMRequestSource;
  status: CRMRequestStatus;
  priority: CRMRequestPriority;
  branch_id: UUID | null;
  branch_name: string | null;
  assigned_to: UUID | null;
  assigned_to_name: string | null;
  created_by: UUID | null;
  created_by_name: string | null;
  due_at: ISODateString | null;
  last_interaction_at: ISODateString | null;
  closed_at: ISODateString | null;
  closed_by: UUID | null;
  closed_by_name: string | null;
  metadata: CRMMetadata | null;
  created_at: ISODateString;
  updated_at: ISODateString;
}

export interface CRMTimeline {
  id: UUID;
  company_id: UUID;
  request_id: UUID;
  event_type: CRMTimelineEventType;
  note: string;
  old_status: CRMRequestStatus | null;
  new_status: CRMRequestStatus | null;
  created_by: UUID | null;
  created_by_name: string | null;
  metadata: CRMMetadata | null;
  created_at: ISODateString;
}

export interface CRMTimelineInsert {
  company_id: UUID;
  request_id: UUID;
  event_type: CRMTimelineEventType;
  note: string;
  old_status?: CRMRequestStatus | null;
  new_status?: CRMRequestStatus | null;
  created_by?: UUID | null;
  created_by_name?: string | null;
  metadata?: CRMMetadata | null;
}

export interface CRMUserContext {
  userId: UUID;
  companyId: UUID;
  displayName: string;
  branch: string;
  role: string;
}

export interface CRMFilters {
  search: string;
  status: CRMRequestStatus | 'all';
  priority: CRMRequestPriority | 'all';
  requestType: CRMRequestType | 'all';
}

export const CRM_REQUEST_STATUSES: readonly CRMRequestStatus[] = [
  'new',
  'open',
  'in_progress',
  'waiting_customer',
  'waiting_internal',
  'resolved',
  'closed',
  'cancelled',
] as const;

export const CRM_REQUEST_PRIORITIES: readonly CRMRequestPriority[] = [
  'low',
  'normal',
  'high',
  'urgent',
] as const;
export const CRM_REQUEST_TYPES: readonly CRMRequestType[] = [
  'follow_up',
  'complaint',
  'inquiry',
  'cashback',
  'delivery',
  'sales',
  'medical',
  'other',
] as const;

export function isCRMRequestStatus(value: unknown): value is CRMRequestStatus {
  return typeof value === 'string' && CRM_REQUEST_STATUSES.includes(value as CRMRequestStatus);
}
export function isCRMRequestPriority(value: unknown): value is CRMRequestPriority {
  return typeof value === 'string' && CRM_REQUEST_PRIORITIES.includes(value as CRMRequestPriority);
}
export function isCRMRequestType(value: unknown): value is CRMRequestType {
  return typeof value === 'string' && CRM_REQUEST_TYPES.includes(value as CRMRequestType);
}
