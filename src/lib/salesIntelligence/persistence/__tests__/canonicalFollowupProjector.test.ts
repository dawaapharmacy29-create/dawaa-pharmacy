import { describe, expect, it } from 'vitest';
import type { SalesIntelligenceCaseAnalysis } from '../../types';
import {
  buildCanonicalFollowupActionRows,
  projectCanonicalFollowupsToActions,
} from '../canonicalFollowupProjector';

const SOURCE_A = '11111111-1111-4111-8111-111111111111';
const SOURCE_B = '22222222-2222-4222-8222-222222222222';
const CUSTOMER_ID = '33333333-3333-4333-8333-333333333333';
const STAFF_ID = '44444444-4444-4444-8444-444444444444';

function analysis(options: {
  sourceId?: string;
  caseId?: string;
  followUpKey?: string;
  status?: 'actionable' | 'blocked' | 'suppressed';
  blocker?: 'customer_identity_unresolved' | null;
  customerId?: string | null;
  branch?: string | null;
  assignedStaffId?: string | null;
  assignedStaffName?: string | null;
} = {}) {
  const sourceId = options.sourceId || SOURCE_A;
  const caseId = options.caseId || `${sourceId}:interaction:0`;
  return {
    caseId,
    conversationId: sourceId,
    conversationCase: {
      caseId,
      conversationId: sourceId,
      customerId: options.customerId === undefined ? CUSTOMER_ID : options.customerId,
      customerPhone: '01000000000',
      branchNameRaw: options.branch === undefined ? 'فرع شكري' : options.branch,
    },
    followUp: {
      caseId,
      decision: 'actionable',
      notNeededReason: null,
      opportunities: [
        {
          followUpKey: options.followUpKey || 'fu1|fixture|stock-check',
          caseId,
          customerId: options.customerId === undefined ? CUSTOMER_ID : options.customerId,
          status: options.status || 'actionable',
          reason: 'stock_check_pending',
          priority: 'high',
          productKey: 'panadol',
          productId: null,
          productRaw: 'Panadol',
          quantity: 2,
          demandKey: `${caseId}:demand:raw:panadol`,
          duePolicy: 'same_shift',
          requestedDelayDays: null,
          dueAt: '2026-10-17T20:00:00.000Z',
          assignedRole: 'branch_staff',
          assignedStaffId: options.assignedStaffId ?? null,
          assignedStaffName: options.assignedStaffName ?? null,
          goal: 'tell_customer_availability_result',
          nextBestAction: 'complete_stock_check_and_reply',
          blocker: options.blocker ?? null,
          suppressedBy: null,
          evidenceMessageIds: ['m-1'],
          confidence: {
            level: 'high',
            evidenceMessageIds: ['m-1'],
            evidenceTypes: ['explicit_text'],
          },
        },
      ],
    },
  } as unknown as SalesIntelligenceCaseAnalysis;
}

function fakeClient(initialRows: Record<string, unknown>[] = []) {
  const rows = initialRows.map((row) => ({ ...row }));
  return {
    rows,
    from(table: string) {
      if (table !== 'whatsapp_conversation_actions') throw new Error(`unexpected_table:${table}`);
      return {
        select() {
          return {
            async in(_column: string, values: string[]) {
              return {
                data: rows.filter((row) => values.includes(String(row.followup_identity || ''))),
                error: null,
              };
            },
            eq(_column: string, value: string) {
              return {
                async maybeSingle() {
                  return {
                    data: rows.find((row) => row.followup_identity === value) || null,
                    error: null,
                  };
                },
              };
            },
          };
        },
        async insert(row: Record<string, unknown>) {
          if (rows.some((existing) => existing.followup_identity === row.followup_identity)) {
            return { data: null, error: { code: '23505', message: 'duplicate' } };
          }
          rows.push({ id: `action-${rows.length + 1}`, ...row });
          return { data: null, error: null };
        },
      };
    },
  };
}

const sources = [
  { id: SOURCE_A, customer_name: 'عميل اختبار', customer_code: '17' },
  { id: SOURCE_B, customer_name: 'عميل اختبار 2', customer_code: '18' },
];

describe('canonical follow-up operational projector', () => {
  it('projects only canonical actionable truth and keeps the stable followUpKey', () => {
    const result = buildCanonicalFollowupActionRows([analysis()], sources);
    expect(result.skipped).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      source_id: SOURCE_A,
      action_type: 'customer_followup',
      status: 'ready',
      auto_eligible: false,
      branch: 'فرع شكري',
      customer_id: CUSTOMER_ID,
      customer_name: 'عميل اختبار',
      followup_identity: 'fu1|fixture|stock-check',
      reason: 'فحص التوفر ما زال معلقًا ويحتاج رد للعميل',
      assigned_to_id: null,
      assigned_to_name: null,
    });
    expect(result.rows[0].payload).toMatchObject({
      canonicalProjectionVersion: 'si-canonical-followup-projection-v1',
      canonicalReason: 'stock_check_pending',
      priority: 'urgent',
      canonicalPriority: 'high',
      nextBestAction: 'complete_stock_check_and_reply',
    });
  });

  it('does not manufacture staff attribution and uses an assignment only with a canonical staff id', () => {
    const unresolved = buildCanonicalFollowupActionRows(
      [analysis({ assignedStaffName: 'د/ اسم فقط' })],
      sources
    ).rows[0];
    expect(unresolved.assigned_to_id).toBeNull();
    expect(unresolved.assigned_to_name).toBeNull();

    const resolved = buildCanonicalFollowupActionRows(
      [analysis({ assignedStaffId: STAFF_ID, assignedStaffName: 'د/ موظف مؤكد' })],
      sources
    ).rows[0];
    expect(resolved.assigned_to_id).toBe(STAFF_ID);
    expect(resolved.assigned_to_name).toBe('د/ موظف مؤكد');
  });

  it('does not project blocked or non-actionable opportunities and fails closed on missing operational metadata', () => {
    const blocked = buildCanonicalFollowupActionRows(
      [analysis({ blocker: 'customer_identity_unresolved' })],
      sources
    );
    expect(blocked.rows).toEqual([]);
    expect(blocked.skipped[0]?.reason).toBe('blocked');

    const suppressed = buildCanonicalFollowupActionRows(
      [analysis({ status: 'suppressed' })],
      sources
    );
    expect(suppressed.rows).toEqual([]);

    const noBranch = buildCanonicalFollowupActionRows([analysis({ branch: null })], sources);
    expect(noBranch.rows).toEqual([]);
    expect(noBranch.skipped[0]?.reason).toBe('missing_branch');
  });

  it('deduplicates identical retries and rejects a cross-source stable-identity collision', () => {
    const same = analysis();
    expect(buildCanonicalFollowupActionRows([same, same], sources).rows).toHaveLength(1);

    expect(() =>
      buildCanonicalFollowupActionRows(
        [same, analysis({ sourceId: SOURCE_B, followUpKey: 'fu1|fixture|stock-check' })],
        sources
      )
    ).toThrow('canonical_followup_identity_collision:fu1|fixture|stock-check');
  });

  it('preserves an existing materialized action instead of resetting workflow or target lineage', async () => {
    const original = {
      id: 'action-existing',
      followup_identity: 'fu1|fixture|stock-check',
      status: 'created',
      target_table: 'daily_followups',
      target_id: 'followup-existing',
      work_status: 'completed',
    };
    const client = fakeClient([original]);
    const result = await projectCanonicalFollowupsToActions(client, [analysis()], sources);

    expect(result.inserted).toBe(0);
    expect(result.existing).toBe(1);
    expect(client.rows).toEqual([original]);
  });

  it('inserts a new canonical action once without materializing daily_followups directly', async () => {
    const client = fakeClient();
    const result = await projectCanonicalFollowupsToActions(client, [analysis()], sources);

    expect(result.inserted).toBe(1);
    expect(result.existing).toBe(0);
    expect(client.rows).toHaveLength(1);
    expect(client.rows[0]).toMatchObject({
      followup_identity: 'fu1|fixture|stock-check',
      status: 'ready',
      target_table: undefined,
      target_id: undefined,
    });
  });
});
