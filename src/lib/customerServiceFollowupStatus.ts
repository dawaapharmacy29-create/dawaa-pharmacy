import {
  isArchivedFollowup,
  isCancelledFollowup,
  isCompletedFollowup,
  isFinalFollowupResult,
  isOpenFollowupResult,
} from '@/lib/customerFollowupCore';

export type FollowupLike = Record<string, unknown> | null | undefined;

export function readFollowupResult(row: FollowupLike) {
  if (!row) return '';
  return String(
    row.followup_result ||
      row.contact_result ||
      row.followup_status ||
      row.contact_status ||
      row.status ||
      ''
  ).trim();
}

export function isOpenFollowup(row: FollowupLike) {
  if (!row) return false;
  if (isCancelledFollowup(row) || isArchivedFollowup(row) || isCompletedFollowup(row)) return false;
  if (row.completed_at || row.closed_at) return false;
  const result = readFollowupResult(row);
  return !isFinalFollowupResult(result) && (isOpenFollowupResult(result) || !result);
}

export function isCompletedHistoryFollowup(row: FollowupLike) {
  return Boolean(row) && isCompletedFollowup(row) && !isCancelledFollowup(row) && !isArchivedFollowup(row);
}

export function isCancelledHistoryFollowup(row: FollowupLike) {
  return isCancelledFollowup(row);
}

export function isArchivedHistoryFollowup(row: FollowupLike) {
  return isArchivedFollowup(row);
}

export function completedToday(row: FollowupLike, dateKey: string) {
  if (!isCompletedHistoryFollowup(row)) return false;
  const completedAt = String(row?.completed_at || row?.closed_at || '');
  return completedAt.slice(0, 10) === dateKey;
}
