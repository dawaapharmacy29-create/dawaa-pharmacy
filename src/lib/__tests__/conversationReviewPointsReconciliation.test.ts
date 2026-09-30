import { describe, expect, it } from 'vitest';
import { buildConversationReviewPointsReconciliationPlan } from '@/lib/pointsPersistence';

describe('conversation review points reconciliation plan', () => {
  it('cancels every live source-linked movement using the original event identity and creates one final automatic replacement', () => {
    const plan = buildConversationReviewPointsReconciliationPlan(
      [
        {
          staff_id: 'staff-old',
          source: 'whatsapp_automatic_review',
          status: 'pending',
          points_delta: -10,
          month_cycle: '2026-09',
          branch: 'فرع الشامي',
        },
      ],
      true,
      -5
    );

    expect(plan).toEqual({
      cancellations: [
        {
          staffId: 'staff-old',
          source: 'whatsapp_automatic_review',
          monthCycle: '2026-09',
          branch: 'فرع الشامي',
          signedImpact: -10,
        },
      ],
      replacementSource: 'whatsapp_automatic_review',
      replacementSignedImpact: -5,
    });
  });

  it('keeps a zero final impact as zero so manager edits can cancel the old movement without creating a replacement', () => {
    const plan = buildConversationReviewPointsReconciliationPlan(
      [
        {
          staff_id: 'staff-1',
          source: 'conversation_evaluation',
          status: 'active',
          points_delta: 10,
          month_cycle: '2026-09',
          branch: 'فرع شكري',
        },
      ],
      false,
      0
    );

    expect(plan.cancellations).toHaveLength(1);
    expect(plan.replacementSource).toBe('conversation_evaluation');
    expect(plan.replacementSignedImpact).toBe(0);
  });

  it('drops malformed historical rows instead of inventing an event identity', () => {
    const plan = buildConversationReviewPointsReconciliationPlan(
      [
        { staff_id: '', source: 'conversation_evaluation', month_cycle: '2026-09', points_delta: -5 },
        { staff_id: 'staff-1', source: '', month_cycle: '2026-09', points_delta: -5 },
        { staff_id: 'staff-1', source: 'conversation_evaluation', month_cycle: '', points_delta: -5 },
      ],
      false,
      8
    );

    expect(plan.cancellations).toHaveLength(0);
    expect(plan.replacementSignedImpact).toBe(8);
  });
});
