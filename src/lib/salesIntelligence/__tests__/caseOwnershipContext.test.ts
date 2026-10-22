import { describe, expect, it } from 'vitest';
import { recommendCaseBranch, type CaseOwnershipContext } from '../caseOwnershipContext';
import { buildSalesIntelligenceRuntimeContext, pipelineBaseInputFor, prepareSalesIntelligenceConversations } from '../runtimeContext';
import { deriveCasesOnly, runSalesIntelligencePipeline, segmentationInputFromPipelineInput } from '../salesIntelligencePipeline';
import { buildPharmacyProductIndex } from '../pharmacyProducts/pharmacyProductResolverV2';
import type { StaffDirectoryIdentity } from '../../readModels/staffDirectoryReadModel';
import { parseWhatsAppExport } from '../../whatsappConversationParser';
import { computeSemanticSourceHash } from '../persistence/hashing';

const staff = (id: string, name: string, extra: Partial<StaffDirectoryIdentity> = {}): StaffDirectoryIdentity => ({
  id, name, branch: 'فرع شكري', role: 'صيدلاني', username: null, status: 'active', active: true, source: 'staff', ...extra,
});
const directory = [
  staff('service', 'موظفة المتابعة', { branch: 'المخزن', role: 'assistant', type: 'فريق دواء ألفا' }),
  staff('service', 'هبه', { branch: 'المخزن', role: 'assistant', type: 'فريق دواء ألفا', source: 'alias' }),
  staff('doctor', 'د محمد شبل'), staff('doctor', 'شبل', { source: 'alias' }),
];
const context = () => buildSalesIntelligenceRuntimeContext({ staffDirectory: directory, productIndex: buildPharmacyProductIndex([]) });
const raw = (intro = 'مع حضرتك د شبل', introFirst = false) => [
  '[10/20/26, 10:00:00 AM] You: مع حضرتك هبه من خدمة عملاء صيدليات دواء، حابين نطمن على الوالد',
  '[10/20/26, 10:01:00 AM] عميل تجريبي 90001: الحمدلله الوالد اتحسن شكرا على متابعتكم',
  ...(introFirst ? [`[10/20/26, 10:02:00 AM] You: ${intro}`] : []),
  '[10/20/26, 10:03:00 AM] عميل تجريبي 90001: عايز علبة كولونا',
  ...(!introFirst ? [`[10/20/26, 10:04:00 AM] You: ${intro}`] : []),
  '[10/20/26, 10:05:00 AM] You: عنيا حاضر',
].join('\n');

async function analyze(text = raw(), branch = 'المخزن', rows = directory) {
  const runtime = buildSalesIntelligenceRuntimeContext({ staffDirectory: rows, productIndex: buildPharmacyProductIndex([]) });
  const result = { data: [], error: null };
  const client: any = { from: () => {
    const target = { then: (resolve: any) => Promise.resolve(result).then(resolve) };
    const proxy: any = new Proxy(target, { get: (t, k) => k in t ? t[k] : () => proxy });
    return proxy;
  } };
  const [prepared] = await prepareSalesIntelligenceConversations(client, [{
    conversationId: 'synthetic-mixed-file', rawWhatsAppExportText: text,
    customerCodeHint: '90001', customerNameHint: 'عميل تجريبي', branchNameRawHint: branch,
  }], runtime);
  const base = pipelineBaseInputFor(prepared, runtime);
  return { base, result: runSalesIntelligencePipeline({ ...base, resolveInvoiceCandidates: () => [] }) };
}

describe('case-local service/pharmacy ownership', () => {
  it('classifies the Alpha team by canonical metadata, independently of home branch or name', () => {
    for (const branch of ['المخزن', 'فرع الشامي', 'فرع شكري']) {
      const runtime = buildSalesIntelligenceRuntimeContext({
        staffDirectory: [staff('new-service', 'اسم آخر', { role: 'assistant', type: 'فريق دواء ألفا', branch })],
        productIndex: buildPharmacyProductIndex([]),
      });
      expect(runtime.staffProfilesById?.['new-service'].function).toBe('customer_service');
    }
    expect(context().staffProfilesById?.doctor.function).toBe('pharmacist');
  });

  it('splits an explicit order minutes after welfare feedback and scopes both owners independently', async () => {
    const { result } = await analyze();
    expect(result.caseAnalyses).toHaveLength(2);
    const [service, order] = result.caseAnalyses;
    expect(service.conversationCase.ownership?.department).toBe('customer_service');
    expect(service.conversationCase.ownership?.owners.map((o) => o.staffId)).toEqual(['service']);
    expect(order.conversationCase.ownership?.department).toBe('pharmacy');
    expect(order.conversationCase.ownership?.owners.map((o) => o.staffId)).toEqual(['doctor']);
    expect(service.caseIntelligence.staff.participants.every((p) => p.staffId !== 'doctor')).toBe(true);
    expect(order.caseIntelligence.staff.participants.every((p) => p.staffId !== 'service')).toBe(true);
    const messageIds = result.caseAnalyses.flatMap((a) => a.caseIntelligence.interaction.messageIds);
    expect(new Set(messageIds).size).toBe(messageIds.length);
    expect(messageIds).toHaveLength(parseWhatsAppExport(raw()).length);
    expect(order.caseIntelligence.interaction.segmentationReason).toBe('customer_service_new_need');
  });

  it('keeps a trailing doctor introduction with the new order when it precedes the request', async () => {
    const { result } = await analyze(raw('مع حضرتك د شبل', true));
    expect(result.caseAnalyses).toHaveLength(2);
    expect(result.caseAnalyses[0].conversationCase.ownership?.owners.map((o) => o.staffId)).toEqual(['service']);
    expect(result.caseAnalyses[1].conversationCase.ownership?.owners.map((o) => o.staffId)).toEqual(['doctor']);
    expect(result.caseAnalyses[1].caseIntelligence.interaction.messages[0].text).toContain('د شبل');
  });

  it('separates an explicit new consultation without requiring a medicine sale', async () => {
    const { result } = await analyze(raw().replace('عايز علبة كولونا', 'ممكن استشارة طبية'));
    expect(result.caseAnalyses).toHaveLength(2);
    expect(result.caseAnalyses[1].caseIntelligence.interaction.segmentationReason).toBe('customer_service_new_need');
  });

  it('keeps a delayed welfare answer and its staff response with the service outreach', async () => {
    const text = [
      '[10/20/26, 10:00:00 AM] You: مع حضرتك هبه من خدمة عملاء صيدليات دواء، حابين نطمن على الوالد',
      '[10/20/26, 1:00:00 PM] عميل تجريبي 90001: الحمدلله الوالد اتحسن كتير وخدمة التمريض ممتازة شكرا على متابعتكم',
      '[10/20/26, 1:01:00 PM] You: الحمدلله، نتمنى له تمام الشفاء',
    ].join('\n');
    const { result } = await analyze(text);
    expect(result.caseAnalyses).toHaveLength(1);
    expect(result.caseAnalyses[0].conversationCase.ownership?.department).toBe('customer_service');
    expect(result.caseAnalyses[0].caseIntelligence.interaction.messageIds).toHaveLength(3);
  });

  it('does not split a welfare answer or a physician handoff alone into another sale', async () => {
    const text = raw().replace('عايز علبة كولونا', 'الوالد اتحسن الحمدلله');
    const { result } = await analyze(text);
    expect(result.caseAnalyses).toHaveLength(1);
    expect(result.caseAnalyses[0].conversationCase.ownership?.department).toBe('mixed');
    expect(result.caseAnalyses[0].salesOutcome.isSaleCountable).toBe(false);
  });

  it('retains warehouse provenance without using it as an operational branch', async () => {
    const { result } = await analyze();
    for (const a of result.caseAnalyses) {
      expect(a.conversationCase.branchNameRaw).toBeNull();
      expect(a.conversationCase.ownership?.sourceBranchNameRaw).toBe('المخزن');
      expect(a.attribution.isOfficialForStaffEvaluation).toBe(false);
      expect(a.salesOutcome.isSaleCountable).toBe(false);
    }
    expect(result.caseAnalyses[0].conversationCase.ownership?.suggestedStaffBranch).toBeNull();
    expect(result.caseAnalyses[1].conversationCase.ownership?.suggestedStaffBranch).toBe('فرع شكري');
  });

  it('never uses a customer-service employee home branch as the case transaction branch', async () => {
    const { result } = await analyze(raw(), 'فرع الشامي');
    expect(result.caseAnalyses[0].conversationCase.branchNameRaw).toBeNull();
    expect(result.caseAnalyses[0].conversationCase.ownership?.department).toBe('customer_service');
  });

  it('uses canonical service-team membership even with a doctor honorific and no department wording', async () => {
    const text = '[10/20/26, 10:00:00 AM] You: مع حضرتك د هبه\n[10/20/26, 10:01:00 AM] عميل تجريبي 90001: الحمدلله';
    const { result } = await analyze(text, 'فرع الشامي');
    expect(result.caseAnalyses[0].conversationCase.ownership?.department).toBe('customer_service');
    expect(result.caseAnalyses[0].conversationCase.branchNameRaw).toBeNull();
  });

  it('accepts case-local explicit branch evidence while retaining conflicts for review', async () => {
    const text = raw('مع حضرتك د شبل من فرع شكري');
    const accepted = await analyze(text);
    expect(accepted.result.caseAnalyses[1].conversationCase.branchNameRaw).toBe('فرع شكري');
    expect(accepted.result.caseAnalyses[1].conversationCase.ownership?.branchBasis).toBe('explicit_introduction');
    const conflicting = await analyze(text, 'فرع الشامي');
    expect(conflicting.result.caseAnalyses[1].conversationCase.branchNameRaw).toBeNull();
    expect(conflicting.result.caseAnalyses[1].conversationCase.ownership?.blockers).toContain('case_branch_evidence_conflict');
  });

  it('does not invent an unresolved doctor or use another case owner as fallback', async () => {
    const { result } = await analyze(raw(), 'المخزن', directory.filter((p) => !(p.id === 'doctor' && p.source === 'alias')));
    expect(result.caseAnalyses[1].conversationCase.ownership?.owners).toEqual([]);
    expect(result.caseAnalyses[1].conversationCase.ownership?.blockers).toContain('introduced_staff_unresolved');
  });

  it('does not promote an explicit branch from an unresolved doctor introduction', async () => {
    const { result } = await analyze(raw('مع حضرتك د شبل من فرع شكري'), 'كل الفروع', directory.filter((p) => !(p.id === 'doctor' && p.source === 'alias')));
    const order = result.caseAnalyses[1];
    expect(order.conversationCase.branchNameRaw).toBeNull();
    expect(order.conversationCase.ownership?.blockers).toContain('explicit_branch_staff_unresolved');
    expect(order.salesOutcome.isSaleCountable).toBe(false);
  });

  it('cannot turn conflicting case branch evidence into unknown-branch sale proof', async () => {
    const { base } = await analyze(raw('مع حضرتك د شبل من فرع شكري'), 'فرع الشامي');
    const result = runSalesIntelligencePipeline({
      ...base, customerIdHint: 'customer-1', customerIdentityStatus: 'resolved', trustedInvoiceId: 'invoice-1',
      resolveInvoiceCandidates: () => [{ id: 'invoice-1', invoice_number: 'test-1', customer_id: 'customer-1',
        branch: 'فرع شكري', staff_id: 'doctor', invoice_datetime: '2026-10-20T07:04:30Z' }],
    });
    const order = result.caseAnalyses.find((a) => a.conversationCase.ownership?.department === 'pharmacy')!;
    expect(order.attribution.isOfficialForStaffEvaluation).toBe(false);
    expect(order.salesOutcome.saleProofState).not.toBe('proven');
  });

  it('uses identical case ownership and identities in candidate pre-pass and real pipeline', async () => {
    const { base, result } = await analyze();
    const prepass = deriveCasesOnly(segmentationInputFromPipelineInput(base));
    expect(prepass.cases).toEqual(result.caseAnalyses.map((a) => a.conversationCase));
  });

  it('invalidates persisted analysis when case ownership changes, without hashing unrelated staff', async () => {
    const { result } = await analyze();
    const ownership = result.caseAnalyses[1].conversationCase.ownership!;
    const input = { rawWhatsAppExportText: raw(), branchIdentityMappingVersion: 'test', caseOwnership: ownership };
    const original = await computeSemanticSourceHash(input);
    expect(await computeSemanticSourceHash(input)).toBe(original);
    expect(await computeSemanticSourceHash({ ...input, caseOwnership: { ...ownership, owners: [] } })).not.toBe(original);
  });
});

describe('case branch after invoice attribution', () => {
  it('uses the linked, proven invoice branch as the transaction branch despite correlated seller/home-branch evidence', () => {
    const result = recommendCaseBranch({
      ownership: ownership(),
      invoiceBranch: 'فرع شكري',
      invoiceCandidateStrong: false,
      invoiceAttributionProven: true,
      attributionUsedCaseBranch: false,
      invoiceSellerIsCaseStaff: true,
    });

    expect(result).toEqual({
      branch: 'فرع شكري',
      strength: 'decided',
      reasons: ['فرع فاتورة مرتبطة ومثبتة لهذه الحالة؛ يحدد فرع العملية دون تعديل فرع المصدر'],
    });
  });

  it('does not promote a merely strong invoice candidate to a decided branch', () => {
    const result = recommendCaseBranch({
      ownership: ownership(),
      invoiceBranch: 'فرع شكري',
      invoiceCandidateStrong: true,
      invoiceAttributionProven: false,
      attributionUsedCaseBranch: false,
      invoiceSellerIsCaseStaff: true,
    });

    expect(result.branch).toBe('فرع شكري');
    expect(result.strength).toBe('supporting_only');
  });

  it('keeps an explicit case-branch conflict unresolved when a proven invoice names another branch', () => {
    const result = recommendCaseBranch({
      ownership: ownership({ operationalBranch: 'فرع الشامي', branchBasis: 'explicit_introduction' }),
      invoiceBranch: 'فرع شكري',
      invoiceCandidateStrong: false,
      invoiceAttributionProven: true,
      attributionUsedCaseBranch: false,
    });

    expect(result.branch).toBeNull();
    expect(result.strength).toBe('conflict');
    expect(result.reasons.join(' ')).toContain('يخالف فرع الحالة الصريح');
  });

  it('never assigns a sales branch to a customer-service case, even with a proven invoice input', () => {
    const result = recommendCaseBranch({
      ownership: ownership({ department: 'customer_service' }),
      invoiceBranch: 'فرع شكري',
      invoiceCandidateStrong: false,
      invoiceAttributionProven: true,
      attributionUsedCaseBranch: false,
    });

    expect(result.branch).toBeNull();
    expect(result.strength).toBe('none');
  });
});

