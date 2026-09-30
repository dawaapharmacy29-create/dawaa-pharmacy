import { describe, expect, it } from 'vitest';
import {
  buildSalesIntelligenceRuntimeContext,
  pipelineBaseInputFor,
  prepareSalesIntelligenceConversations,
  resolveStaffIdBySender,
} from '@/lib/salesIntelligence/runtimeContext';
import {
  deriveCasesOnly,
  runSalesIntelligencePipeline,
  segmentationInputFromPipelineInput,
} from '@/lib/salesIntelligence/salesIntelligencePipeline';
import {
  loadStaffDirectoryFrom,
  type StaffDirectoryIdentity,
} from '@/lib/readModels/staffDirectoryReadModel';
import { buildPharmacyProductIndex } from '@/lib/salesIntelligence/pharmacyProducts/pharmacyProductResolverV2';
import { runBatchPersistence } from '@/lib/salesIntelligence/persistence/batchPersistenceService';
import { computeSemanticSourceHash } from '@/lib/salesIntelligence/persistence/hashing';
import {
  BRANCH_IDENTITY_MAPPING_VERSION,
  ENGINE_VERSIONS,
  PIPELINE_VERSION,
} from '@/lib/salesIntelligence/persistence/versions';

// STEP 7A — production wiring. Every real pipeline caller builds its inputs through the ONE
// runtime-context owner (runtimeContext.ts): canonical staff directory -> per-sender staff ids,
// canonical customer identity + status, canonical catalog, and ONE base input shared by the
// segmentation pre-pass and the real run.

const staff = (
  id: string,
  name: string,
  extra: Partial<StaffDirectoryIdentity> = {}
): StaffDirectoryIdentity => ({
  id,
  name,
  branch: null,
  role: 'صيدلاني',
  username: null,
  status: 'active',
  active: true,
  source: 'staff',
  ...extra,
});

const DIRECTORY = [
  staff('staff-sara', 'د. سارة'),
  staff('staff-ahmed-1', 'أحمد'),
  staff('staff-ahmed-2', 'أحمد'),
  staff('staff-old', 'منى', { active: false }),
  staff('staff-mona-customer', 'منى علي'),
];

const context = buildSalesIntelligenceRuntimeContext({
  staffDirectory: DIRECTORY,
  productIndex: buildPharmacyProductIndex([]),
});

const GROUP = `[9/15/26, 9:00:00 AM] منى علي: عايز 1 علبة كونجستال
[9/15/26, 9:01:00 AM] د. سارة: كونجستال مش متوفر حاليًا
[9/15/26, 9:02:00 AM] أحمد: فيه بديل كومتركس
[9/15/26, 9:03:00 AM] منى علي: تمام هاته`;

describe('resolveStaffIdBySender — canonical directory, unique names only', () => {
  it('maps a unique active staff name, leaves a duplicated name and the customer unresolved', () => {
    const map = resolveStaffIdBySender(
      { rawWhatsAppExportText: GROUP, customerNameHint: 'منى علي' },
      context
    );
    expect(map).toEqual({ 'د. سارة': 'staff-sara' });
  });

  it('never maps the customer, even when the customer name equals a staff name', () => {
    const map = resolveStaffIdBySender(
      { rawWhatsAppExportText: GROUP, customerNameHint: null },
      context
    );
    // Every inbound sender "looks like" staff ("أحمد" ambiguously) and no customer hint says who
    // the customer is — nobody is attributed rather than guessing the customer is staff.
    expect(map).toEqual({});
  });

  it('a single-inbound-sender export never turns its only customer into staff', () => {
    const raw = `[9/15/26, 9:00:00 AM] د. سارة: عايز 1 علبة كونجستال
[9/15/26, 9:01:00 AM] You: مش موجود حاليًا`;
    expect(resolveStaffIdBySender({ rawWhatsAppExportText: raw }, context)).toEqual({});
  });

  it('"You", inactive staff and an empty directory stay unmapped (no first-staff-wins)', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز 1 علبة كونجستال
[9/15/26, 9:01:00 AM] منى: مش موجود حاليًا
[9/15/26, 9:02:00 AM] You: تحت أمرك`;
    expect(resolveStaffIdBySender({ rawWhatsAppExportText: raw }, context)).toEqual({});
    const empty = buildSalesIntelligenceRuntimeContext({
      staffDirectory: [],
      productIndex: buildPharmacyProductIndex([]),
    });
    expect(resolveStaffIdBySender({ rawWhatsAppExportText: GROUP }, empty)).toEqual({});
  });
});

function clientReturning(tables: Record<string, any[]> = {}, singles: Record<string, any> = {}) {
  const builder = (table: string): any => {
    const result = { data: tables[table] ?? [], error: null };
    const target: any = {
      then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
      maybeSingle: async () => ({ data: singles[table] ?? null, error: null }),
      single: async () => ({ data: singles[table] ?? null, error: null }),
    };
    const proxy: any = new Proxy(target, { get: (t, key) => (key in t ? t[key] : () => proxy) });
    return proxy;
  };
  return { from: (table: string) => builder(table), rpc: async () => ({ data: [], error: null }) };
}

describe('prepare + base input — identity, staff and catalog travel together', () => {
  it('unresolved customer identity keeps customerIdHint null and carries its status', async () => {
    const [prepared] = await prepareSalesIntelligenceConversations(
      clientReturning(),
      [
        {
          conversationId: 'c1',
          rawWhatsAppExportText: GROUP,
          customerIdHint: 'guessed',
          customerNameHint: 'منى علي',
        },
      ],
      context
    );
    expect(prepared.customerIdentityStatus).not.toBe('resolved');
    expect(prepared.customerIdHint).toBeNull();
    expect(prepared.staffIdBySender).toEqual({ 'د. سارة': 'staff-sara' });

    const base = pipelineBaseInputFor(prepared, context);
    expect(base.customerIdentityStatus).toBe(prepared.customerIdentityStatus);
    expect(base.staffIdBySender).toEqual({ 'د. سارة': 'staff-sara' });
    expect(base.productIndex).toBe(context.productIndex);
    expect(segmentationInputFromPipelineInput(base).knownStaffSenders).toEqual(['د. سارة']);
  });

  it('pre-pass and real run derive identical case ids from the same base input', async () => {
    const raw = `${GROUP}
[9/15/26, 9:10:00 AM] منى علي: بالمناسبة عايز كمان فيتامين د
[9/15/26, 9:11:00 AM] د. سارة: موجود يا فندم`;
    const [prepared] = await prepareSalesIntelligenceConversations(
      clientReturning(),
      [{ conversationId: 'c2', rawWhatsAppExportText: raw, customerNameHint: 'منى علي' }],
      context
    );
    const base = pipelineBaseInputFor(prepared, context);
    const prePass = deriveCasesOnly(segmentationInputFromPipelineInput(base)).cases.map(
      (c) => c.caseId
    );
    const run = runSalesIntelligencePipeline({ ...base, resolveInvoiceCandidates: () => [] });
    expect(prePass.length).toBeGreaterThan(0);
    expect(run.caseAnalyses.map((a) => a.caseId)).toEqual(prePass);

    // The staff fact is attributed to its own resolved sender; the ambiguous "أحمد" stays null.
    const need = run.caseAnalyses[0].customerNeed;
    const congestal = need.products.find((p) => p.productNameRaw.includes('كونجستال'))!;
    expect(congestal.availabilityEvidence[0].staffId).toBe('staff-sara');
    expect(congestal.alternatives[0]?.offeredByStaffId ?? null).toBeNull();
  });
});

describe('staff directory read model — server-safe, never a silent empty directory', () => {
  it('throws when neither staff nor staff accounts can be read', async () => {
    const failing = {
      from: () => {
        const b: any = new Proxy(
          {},
          {
            get: (_t, key) =>
              key === 'then'
                ? (resolve: any) => resolve({ data: null, error: { message: 'down' } })
                : () => b,
          }
        );
        return b;
      },
      rpc: async () => ({ data: null, error: { message: 'down' } }),
    };
    await expect(loadStaffDirectoryFrom(failing)).rejects.toThrow();
  });
});

describe('batch planning — a pipeline-version bump is never a no-op (mirrors the write RPC)', () => {
  const RAW = `[9/15/26, 9:00:00 AM] Customer: عايز 1 علبة بانادول
[9/15/26, 9:01:00 AM] You: موجود يا فندم`;

  async function planWith(pipelineVersion: string) {
    const semanticSourceHash = await computeSemanticSourceHash({
      rawWhatsAppExportText: RAW,
      trustedConversationStartedAt: null,
      branchIdentityMappingVersion: BRANCH_IDENTITY_MAPPING_VERSION,
    });
    const client = clientReturning(
      {},
      {
        sales_intelligence_case_analyses: {
          analysis_id: 'a1',
          analysis_version: 3,
          semantic_source_hash: semanticSourceHash,
          pipeline_version: pipelineVersion,
          engine_version_case_segmentation: ENGINE_VERSIONS.caseSegmentation,
          engine_version_historical_closure: ENGINE_VERSIONS.historicalClosure,
          engine_version_commercial_confirmation: ENGINE_VERSIONS.commercialConfirmation,
          engine_version_protocol_applicability: ENGINE_VERSIONS.protocolApplicability,
        },
      }
    );
    const result = await runBatchPersistence(client, {
      dryRun: true,
      conversations: [{ conversationId: 'c3', rawWhatsAppExportText: RAW }],
    });
    return result.plan;
  }

  it('same hash + same versions -> no-op; older pipeline_version -> new analysis', async () => {
    const current = await planWith(PIPELINE_VERSION);
    expect(current.analysesNoOp.length).toBeGreaterThan(0);
    expect(current.analysesToInsert).toHaveLength(0);

    const stale = await planWith('sales-intelligence-v0');
    expect(stale.analysesNoOp).toHaveLength(0);
    expect(stale.analysesToInsert.length).toBeGreaterThan(0);
    expect(stale.analysesToInsert[0].nextAnalysisVersion).toBe(4);
  });
});
