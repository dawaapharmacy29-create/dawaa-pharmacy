import { describe, expect, it } from 'vitest';
import { canAccessFullConversationReviewWorkspace, reviewActionAccess } from '../reviewWorkspaceAccess';

function checker(allowed: string[]) {
  return (permission: string) => allowed.includes(permission);
}

describe('review action permission contract', () => {
  it('maps sensitive actions only from canonical effective permissions', () => {
    expect(reviewActionAccess(checker(['view_reviews', 'add_reviews']))).toEqual({
      canView: true,
      canAdd: true,
      canEdit: false,
      canApprove: false,
      canDelete: false,
    });
  });

  it('preserves explicit false restrictions even for management workspace roles', () => {
    const actions = reviewActionAccess(checker(['view_reviews']));
    expect(actions.canEdit).toBe(false);
    expect(actions.canApprove).toBe(false);
    expect(actions.canDelete).toBe(false);

    // Workspace shape may still be role-specific, but it does not grant actions.
    expect(canAccessFullConversationReviewWorkspace({ role: 'branch_manager' }, checker(['view_reviews']))).toBe(true);
  });

  it('allows a legacy operational role to receive full workspace shape only from effective permissions', () => {
    expect(
      canAccessFullConversationReviewWorkspace(
        { role: 'customer_service' },
        checker(['view_reviews', 'edit_reviews', 'approve_reviews'])
      )
    ).toBe(true);

    expect(
      canAccessFullConversationReviewWorkspace(
        { role: 'customer_service' },
        checker(['view_reviews', 'edit_reviews'])
      )
    ).toBe(false);
  });
});
