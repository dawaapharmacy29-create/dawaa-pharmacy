import {
  FINAL_FOLLOWUP_RESULTS,
  OPEN_FOLLOWUP_RESULTS,
  buildCustomerIdentity,
  isFinalFollowupResult,
  isOpenFollowupResult,
  isValidEgyptianMobile,
  normalizeCustomerName,
  normalizeEgyptianPhone,
  resolveRequestedBy,
} from '@/lib/customerFollowupCore';
import { getFollowupDataIssues as getCanonicalDataIssues } from '@/lib/customerFollowupDataQuality';

export {
  FINAL_FOLLOWUP_RESULTS,
  OPEN_FOLLOWUP_RESULTS,
  buildCustomerIdentity,
  isValidEgyptianMobile,
  normalizeEgyptianPhone,
  resolveRequestedBy,
};

export const normalizeCustomerIdentityName = normalizeCustomerName;

export function isFinalFollowupStatus(value?: string | null) {
  return isFinalFollowupResult(value);
}

export function isOpenFollowupStatus(value?: string | null) {
  return isOpenFollowupResult(value);
}

export function getFollowupDataIssues(input: {
  customerId?: string | null;
  customerCode?: string | null;
  customerName?: string | null;
  phone?: string | null;
  branch?: string | null;
  requestedBy?: string | null;
  reason?: string | null;
  status?: string | null;
  result?: string | null;
  nextFollowupDate?: string | null;
  completedAt?: string | null;
}) {
  const completed = Boolean(input.completedAt) || isFinalFollowupResult(input.status);
  const issues = getCanonicalDataIssues({
    customerId: input.customerId,
    customerCode: input.customerCode,
    phone: input.phone,
    name: input.customerName,
    branch: input.branch,
    requestedBy: input.requestedBy,
    reason: input.reason,
    result: input.result || input.status,
    nextFollowupDate: input.nextFollowupDate,
    customerLinked: Boolean(input.customerId || input.customerCode),
    completed,
  });

  if (completed && !String(input.result || '').trim()) {
    issues.push('متابعة مكتملة بدون نتيجة رسمية');
  }
  return [...new Set(issues)];
}
