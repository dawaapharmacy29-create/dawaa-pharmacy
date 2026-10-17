import { describe, expect, it } from 'vitest';
import { buildCanonicalComplaintActionRows } from '../canonicalComplaintProjector';

const SOURCE_ID = '11111111-1111-4111-8111-111111111111';
const CUSTOMER_ID = '33333333-3333-4333-8333-333333333333';
const RAW = [
  '[10/17/26, 10:00:00 AM] Customer: انا زعلان من مشكلة التوصيل',
  '[10/17/26, 10:01:00 AM] You: حقك علينا هتابع بنفسي',
].join('\n');

function analysis(
  caseId = 'case-1',
  messages: Array<{ id: string; role: 'customer' | 'staff'; at: string; text: string }> = [
    { id: 'm1', role: 'customer', at: '2026-10-17T07:00:00.000Z', text: 'انا زعلان من مشكلة التوصيل' },
    { id: 'm2', role: 'staff', at: '2026-10-17T07:01:00.000Z', text: 'حقك علينا هتابع بنفسي' },
  ]
) {
  return {
    caseId,
    conversationId: SOURCE_ID,
    conversationCase: {
      customerId: CUSTOMER_ID,
      customerPhone: '01000000000',
      branchNameRaw: 'شكري',
    },
    caseIntelligence: {
      interaction: {
        messages: messages.map((message) => ({
          ...message,
          sender: message.role === 'customer' ? 'Customer' : 'You',
          meaningful: true,
        })),
      },
    },
  } as any;
}

function source() {
  return {
    id: SOURCE_ID,
    raw_text: RAW,
    customer_name: 'عميل اختبار',
    customer_code: '17',
  };
}

describe('canonical complaint projector', () => {
  it('projects recovery-attempted complaint as customer-service work, not resolution', () => {
    const result = buildCanonicalComplaintActionRows([analysis()], [source()]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      action_type: 'complaint_followup',
      status: 'ready',
      auto_eligible: false,
      customer_id: CUSTOMER_ID,
      branch: 'شكري',
    });
    expect(result.rows[0].payload).toMatchObject({
      canonicalComplaintState: 'recovery_attempted',
      ownerRole: 'customer_service',
      reviewRequired: true,
    });
    expect(result.rows[0].followup_identity).toMatch(/^fu1\|chat:/);
  });

  it('does not create complaint work once explicit closure is proven', () => {
    const result = buildCanonicalComplaintActionRows(
      [
        analysis('case-1', [
          { id: 'm1', role: 'customer', at: '2026-10-17T07:00:00.000Z', text: 'انا زعلان من المشكلة دي' },
          { id: 'm2', role: 'staff', at: '2026-10-17T07:01:00.000Z', text: 'حقك علينا هتابع بنفسي' },
          { id: 'm3', role: 'customer', at: '2026-10-17T07:05:00.000Z', text: 'المشكلة اتحلت شكرا' },
        ]),
      ],
      [source()]
    );
    expect(result.rows).toEqual([]);
    expect(result.skipped[0]).toMatchObject({ reason: 'not_actionable' });
  });

  it('keeps complaint operation identity stable across case re-segmentation', () => {
    const first = buildCanonicalComplaintActionRows([analysis('case-1')], [source()]);
    const second = buildCanonicalComplaintActionRows([analysis('case-99')], [source()]);
    expect(first.rows[0].followup_identity).toBe(second.rows[0].followup_identity);
  });

  it('projects a no-response complaint as unresolved work', () => {
    const result = buildCanonicalComplaintActionRows(
      [
        analysis('case-1', [
          { id: 'm1', role: 'customer', at: '2026-10-17T07:00:00.000Z', text: 'انا زعلان من المشكلة دي' },
        ]),
      ],
      [source()]
    );
    expect(result.rows[0].payload).toMatchObject({ canonicalComplaintState: 'unresolved' });
  });
});
