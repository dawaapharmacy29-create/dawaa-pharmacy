import { afterEach, describe, expect, it } from 'vitest';
import { followupLifecycleHarness } from './canonicalFollowupLifecycleHarness';
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

const ANALYSIS_ID = '66666666-6666-4666-8666-666666666666';
const NEXT_ANALYSIS_ID = '77777777-7777-4777-8777-777777777777';
const publication = [{sourceId:SOURCE_A,analysisIds:{[`${SOURCE_A}:interaction:0`]:ANALYSIS_ID}}];
const clients: Awaited<ReturnType<typeof followupLifecycleHarness>>[] = [];
afterEach(async () => { await Promise.all(clients.splice(0).map((client) => client.close())); });
async function fakeClient(initialRows: Record<string, unknown>[] = [], initialAnalysis = analysis()) {
  const client = await followupLifecycleHarness(initialRows);
  clients.push(client);
  await client.publish([initialAnalysis], sources, ANALYSIS_ID);
  return client;
}

const sources = [
  { id: SOURCE_A, customer_name: 'عميل اختبار', customer_code: '17' },
  { id: SOURCE_B, customer_name: 'عميل اختبار 2', customer_code: '18' },
];

describe('canonical follow-up operational projector', () => {
  it('withdraws an unmaterialized proposal when the canonical obligation disappears', async () => {
    const original = buildCanonicalFollowupActionRows([analysis()], sources).rows[0];
    const client = await fakeClient([{ id: 'action-old', ...original }]);
    const closed = analysis();
    closed.followUp = { ...closed.followUp, decision: 'not_needed', opportunities: [], notNeededReason: 'sale_proven' };
    await client.publish([closed], sources, NEXT_ANALYSIS_ID);
    await projectCanonicalFollowupsToActions(client, [closed], sources, [{sourceId:SOURCE_A,analysisIds:{[closed.caseId]:NEXT_ANALYSIS_ID}}]);
    expect(client.rows[0].status).toBe('dismissed');
  });

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
      ...buildCanonicalFollowupActionRows([analysis()], sources).rows[0],
      followup_identity: 'fu1|fixture|stock-check',
      status: 'created',
      target_table: 'daily_followups',
      target_id: 'followup-existing',
      work_status: 'completed',
    };
    const client = await fakeClient([original]);
    const before = structuredClone(client.rows[0]);
    const result = await projectCanonicalFollowupsToActions(client, [analysis()], sources, publication);

    expect(result.inserted).toBe(0);
    expect(result.existing).toBe(1);
    expect(client.rows[0]).toEqual(before);
  });

  it('inserts a new canonical action once without materializing daily_followups directly', async () => {
    const client = await fakeClient();
    const result = await projectCanonicalFollowupsToActions(client, [analysis()], sources, publication);

    expect(result.inserted).toBe(1);
    expect(result.existing).toBe(0);
    expect(client.rows).toHaveLength(1);
    expect(client.rows[0]).toMatchObject({
      followup_identity: 'fu1|fixture|stock-check',
      status: 'ready',
    });
    expect(client.rows[0].target_table).toBeNull();
    expect(client.rows[0].target_id).toBeNull();
  });
  it('rejects a guessed branch without moving the stored source or action', async () => {
    const original = analysis({ branch: 'فرع الشامي' });
    const client = await fakeClient([], original);
    await projectCanonicalFollowupsToActions(client, [original], sources, publication);
    const actionId = client.rows[0].id;
    await expect(projectCanonicalFollowupsToActions(client, [analysis({branch:'فرع شكري'})], sources, publication))
      .rejects.toThrow('canonical_followup_projection_mismatch');
    expect(client.rows[0]).toMatchObject({id:actionId,branch:'فرع الشامي',auto_eligible:false});
  });

  it('publishes one stable action when two canonical refreshes race', async () => {
    const client = await fakeClient();
    const results = await Promise.all([
      projectCanonicalFollowupsToActions(client, [analysis()], sources, publication),
      projectCanonicalFollowupsToActions(client, [analysis()], sources, publication),
    ]);
    expect(client.rows).toHaveLength(1);
    expect(results.reduce((sum, result) => sum + result.inserted, 0)).toBe(1);
    expect(results.reduce((sum, result) => sum + result.existing, 0)).toBe(1);
  });

  it('updates a corrected customer and deadline on the same unexecuted identity, without retry churn', async () => {
    const client = await fakeClient();
    await projectCanonicalFollowupsToActions(client, [analysis()], sources, publication);
    const id = client.rows[0].id;
    const corrected = analysis({customerId:'55555555-5555-4555-8555-555555555555'});
    corrected.followUp.opportunities[0].dueAt='2026-10-18T11:00:00.000Z';
    corrected.followUp.opportunities[0].evidenceMessageIds=['m-1','m-correction'];
    const correctedSources = sources.map((row) => ({...row,customer_name:'العميل المصحح',customer_code:'99'}));
    await client.publish([corrected],correctedSources,NEXT_ANALYSIS_ID);
    const next = [{sourceId:SOURCE_A,analysisIds:{[corrected.caseId]:NEXT_ANALYSIS_ID}}];
    const first = await projectCanonicalFollowupsToActions(client,[corrected],correctedSources,next);
    expect(first).toMatchObject({inserted:0,updated:1,withdrawn:0});
    expect(client.rows[0]).toMatchObject({id,customer_id:'55555555-5555-4555-8555-555555555555',
      customer_name:'العميل المصحح',customer_code:'99',branch:'فرع شكري',evidence:['m-1','m-correction']});
    expect(new Date(client.rows[0].due_at).toISOString()).toBe('2026-10-18T11:00:00.000Z');
    const before = structuredClone(client.rows[0]);
    expect(await projectCanonicalFollowupsToActions(client,[corrected],correctedSources,next))
      .toMatchObject({inserted:0,updated:0,withdrawn:0});
    expect(client.rows).toEqual([before]);
  });

  it.each(['assigned','in_progress','completed','cancelled'])('preserves %s workflow when the obligation disappears', async (workStatus) => {
    const row = buildCanonicalFollowupActionRows([analysis()],sources).rows[0];
    const client = await fakeClient([{...row,work_status:workStatus,assigned_at:'2026-10-17T10:00:00Z'}]);
    const before = structuredClone(client.rows[0]);
    const closed = analysis(); closed.followUp.opportunities=[];
    await client.publish([closed],sources,NEXT_ANALYSIS_ID);
    await projectCanonicalFollowupsToActions(client,[closed],sources,
      [{sourceId:SOURCE_A,analysisIds:{[closed.caseId]:NEXT_ANALYSIS_ID}}]);
    expect(client.rows).toEqual([before]);
  });

  it('rejects an older refresh after a new publication, before changing any action', async () => {
    const client = await fakeClient();
    await projectCanonicalFollowupsToActions(client,[analysis()],sources,publication);
    const before = structuredClone(client.rows);
    const closed=analysis(); closed.followUp.opportunities=[];
    await client.publish([closed],sources,NEXT_ANALYSIS_ID);
    await expect(projectCanonicalFollowupsToActions(client,[analysis()],sources,publication))
      .rejects.toThrow('canonical_followup_stale_publication');
    expect(client.rows).toEqual(before);
  });

  it('withdraws a retired case only from an explicitly published empty source set', async () => {
    const client = await fakeClient();
    await projectCanonicalFollowupsToActions(client,[analysis()],sources,publication);
    await expect(projectCanonicalFollowupsToActions(client,[],sources,[{sourceId:SOURCE_A,analysisIds:{}}]))
      .rejects.toThrow('canonical_followup_stale_publication');
    await client.db.exec('update sales_intelligence_cases set is_active=false,published_analysis_id=null');
    const result = await projectCanonicalFollowupsToActions(client,[],sources,[{sourceId:SOURCE_A,analysisIds:{}}]);
    expect(result.withdrawn).toBe(1);
    expect(client.rows[0].status).toBe('dismissed');
  });

  it('keeps human dismissal and reactivates only a canonical withdrawal under the same identity', async () => {
    const client = await fakeClient();
    await projectCanonicalFollowupsToActions(client,[analysis()],sources,publication);
    const id=client.rows[0].id;
    const closed=analysis(); closed.followUp.opportunities=[];
    await client.publish([closed],sources,NEXT_ANALYSIS_ID);
    await projectCanonicalFollowupsToActions(client,[closed],sources,
      [{sourceId:SOURCE_A,analysisIds:{[closed.caseId]:NEXT_ANALYSIS_ID}}]);
    await client.publish([analysis()],sources,ANALYSIS_ID);
    await projectCanonicalFollowupsToActions(client,[analysis()],sources,publication);
    expect(client.rows).toHaveLength(1);
    expect(client.rows[0]).toMatchObject({id,status:'ready',payload:{canonicalLifecycle:'active'}});
    await client.db.exec("update whatsapp_conversation_actions set status='dismissed'");
    await projectCanonicalFollowupsToActions(client,[analysis()],sources,publication);
    expect(client.rows[0].status).toBe('dismissed');
  });

  it('fails closed on missing canonical evidence, pointer drift, archived source, and transport failure', async () => {
    const client=await fakeClient();
    await client.db.exec("update sales_intelligence_case_analyses set evidence_snapshot='{}'");
    await expect(projectCanonicalFollowupsToActions(client,[analysis()],sources,publication))
      .rejects.toThrow('canonical_followup_evidence_incomplete');
    await client.publish([analysis()],sources,ANALYSIS_ID);
    await client.db.exec('update sales_intelligence_case_analyses set is_current=false');
    await expect(projectCanonicalFollowupsToActions(client,[analysis()],sources,publication))
      .rejects.toThrow('canonical_followup_current_analysis_mismatch');
    await client.db.exec('update whatsapp_review_sources set canonical=false');
    await expect(projectCanonicalFollowupsToActions(client,[analysis()],sources,publication))
      .rejects.toThrow('canonical_followup_source_not_canonical');
    await expect(projectCanonicalFollowupsToActions({rpc:async()=>({data:null,error:new Error('unavailable')})},
      [analysis()],sources,publication)).rejects.toThrow('unavailable');
    expect(client.rows).toEqual([]);
  });

  it('requires the complete canonical opportunity set and rolls back malformed projections', async () => {
    const client=await fakeClient();
    const closed=analysis();closed.followUp.opportunities=[];
    await expect(projectCanonicalFollowupsToActions(client,[closed],sources,publication))
      .rejects.toThrow('canonical_followup_incomplete_projection');
    expect(client.rows).toEqual([]);
    await expect(projectCanonicalFollowupsToActions(client,[analysis()],sources,[]))
      .rejects.toThrow('canonical_followup_publication_incomplete');
  });

  it('rechecks live canonical provenance at the authorized materializer and preserves permission checks', async () => {
    const client=await fakeClient();
    await projectCanonicalFollowupsToActions(client,[analysis()],sources,publication);
    const id=String(client.rows[0].id);
    await expect(client.materialize(id)).rejects.toThrow('not_authorized');
    await client.authorize();
    await client.db.exec("set test.permission='false'");
    await expect(client.materialize(id)).rejects.toThrow('whatsapp_action_execute_permission_denied');
    await client.db.exec("set test.permission='true';set test.source_access='false'");
    await expect(client.materialize(id)).rejects.toThrow('whatsapp_action_access_denied');
    await client.authorize();
    const closed=analysis();closed.followUp.opportunities=[];
    await client.publish([closed],sources,NEXT_ANALYSIS_ID);
    await expect(client.materialize(id)).rejects.toThrow('canonical_followup_requires_current_projection');
    await client.reload();
    expect(client.rows[0].target_id).toBeNull();
    await client.publish([analysis()],sources,ANALYSIS_ID);
    await client.materialize(id);
    await client.reload();
    expect(client.rows[0]).toMatchObject({status:'created',target_table:'daily_followups',target_id:'isolated-target'});
  });

  it('denies browser calls to internal reconciliation and keeps customer request approval and branch gates', async () => {
    const client=await fakeClient();
    await client.db.exec('set role anon');
    await expect(client.db.query('select dawaa_reconcile_canonical_followup_actions_v1($1,$2,$3)',[SOURCE_A,'{}','[]']))
      .rejects.toThrow('permission denied');
    await client.db.exec('reset role');
    await projectCanonicalFollowupsToActions(client,[analysis()],sources,publication);
    const id=String(client.rows[0].id);
    await client.db.exec("update whatsapp_conversation_actions set action_type='customer_request'");
    await client.authorize();
    await client.db.exec("set test.branch_access='false'");
    await expect(client.materialize(id)).rejects.toThrow('customer_request_materialization_permission_denied');
    await client.db.exec("set test.branch_access='true'");
    await expect(client.materialize(id)).rejects.toThrow('customer_request_requires_explicit_approval');
  });

  it('does not rewrite a materialized target when customer evidence changes or the obligation closes', async () => {
    const client=await fakeClient();
    await projectCanonicalFollowupsToActions(client,[analysis()],sources,publication);
    await client.authorize();
    await client.materialize(String(client.rows[0].id));
    await client.reload();
    const before=structuredClone(client.rows);
    const closed=analysis({customerId:'55555555-5555-4555-8555-555555555555'});
    closed.followUp.opportunities=[];
    await client.publish([closed],sources,NEXT_ANALYSIS_ID);
    await projectCanonicalFollowupsToActions(client,[closed],sources,
      [{sourceId:SOURCE_A,analysisIds:{[closed.caseId]:NEXT_ANALYSIS_ID}}]);
    expect(client.rows).toEqual(before);
  });

  it('rejects source customer corrections before a fresh canonical projection can be executed', async () => {
    const client=await fakeClient();
    await projectCanonicalFollowupsToActions(client,[analysis()],sources,publication);
    await client.authorize();
    await client.db.exec("update whatsapp_review_sources set customer_id='55555555-5555-4555-8555-555555555555'");
    await expect(client.materialize(String(client.rows[0].id)))
      .rejects.toThrow('canonical_followup_requires_current_projection');
    await expect(projectCanonicalFollowupsToActions(client,[analysis()],sources,publication))
      .rejects.toThrow('canonical_followup_projection_mismatch');
  });

  it('rolls back the whole source on stable identity collision and never touches a legacy proposal', async () => {
    const current=analysis();
    current.followUp.opportunities.push({...current.followUp.opportunities[0],followUpKey:'fu1|fixture|second'});
    const row=buildCanonicalFollowupActionRows([current],sources).rows[1];
    const client=await fakeClient([{...row,created_by:'legacy-writer'}],current);
    const before=structuredClone(client.rows);
    await expect(projectCanonicalFollowupsToActions(client,[current],sources,publication))
      .rejects.toThrow('canonical_followup_identity_collision');
    await client.reload();
    expect(client.rows).toEqual(before);
  });

});

