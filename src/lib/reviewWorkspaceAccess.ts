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

export interface ReviewActionAccess {
  canView: boolean;
  canAdd: boolean;
  canEdit: boolean;
  canApprove: boolean;
  canDelete: boolean;
}

/**
 * Sensitive review actions are decided only by the canonical effective
 * permission contract. Role names may shape scope/workspace UX, but they must
 * never be the sole authorization decision for a write/approval action.
 */
export function reviewActionAccess(checkPermission?: PermissionChecker): ReviewActionAccess {
  return {
    canView: Boolean(checkPermission?.('view_reviews')),
    canAdd: Boolean(checkPermission?.('add_reviews')),
    canEdit: Boolean(checkPermission?.('edit_reviews')),
    canApprove: Boolean(checkPermission?.('approve_reviews')),
    canDelete: Boolean(checkPermission?.('delete_reviews')),
  };
}

/**
 * Workspace shape/scope helper only.
 *
 * This function must not be used as authorization for create/edit/approve/delete
 * handlers. Those actions use `reviewActionAccess()` so explicit account/override
 * restrictions and the database permission ceiling stay aligned.
 */
export function canAccessFullConversationReviewWorkspace(
  user: ReviewAccessUser,
  checkPermission?: PermissionChecker
): boolean {
  const role = normalizeRole(user?.role);
  if (FULL_REVIEW_ROLES.has(role)) return true;

  // Legacy operational accounts can still receive the full workspace shape when
  // their effective permissions make that appropriate. This affects presentation
  // and scope only; it does not authorize sensitive actions.
  const actions = reviewActionAccess(checkPermission);
  return actions.canView && actions.canEdit && actions.canApprove;
}
