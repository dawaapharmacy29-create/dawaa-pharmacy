import { normalizeRole } from '@/lib/core/permissionSystem';

export type PermissionChecker = (permission: string) => boolean;

type ReviewAccessUser = {
  role?: string | null;
  name?: string | null;
  username?: string | null;
} | null | undefined;

const FULL_REVIEW_ROLES = new Set([
  'general_manager',
  'branches_manager',
  'branch_manager',
  'customer_service_manager',
]);

/**
 * الاستثناء الإداري الذكي لصفحة تقييم المحادثات فقط.
 * لا يغيّر صلاحيات أي صفحة أخرى، ولا يمنح الطبيب العادي رؤية تقييمات زملائه.
 */
export function canAccessFullConversationReviewWorkspace(
  user: ReviewAccessUser,
  checkPermission?: PermissionChecker
): boolean {
  const role = normalizeRole(user?.role);
  if (FULL_REVIEW_ROLES.has(role)) return true;

  // يدعم الحسابات القديمة التي تحمل دورًا تشغيليًا لكن مُنحت صلاحيات الإدارة يدويًا.
  return Boolean(
    checkPermission?.('view_reviews') &&
    checkPermission?.('edit_reviews') &&
    checkPermission?.('approve_reviews')
  );
}
