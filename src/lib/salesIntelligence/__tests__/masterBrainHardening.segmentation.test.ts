// WhatsApp Master Brain hardening — case identity/segmentation regressions (synthetic data only).
//
// Production staff records of the customer-service team carry role 'assistant' with type
// 'فريق دواء ألفا' and a warehouse/other home branch. They must resolve as customer service, and
// no case may take its branch from any employee's home branch.
import { describe, expect, it } from 'vitest';
import { buildSalesIntelligenceRuntimeContext } from '@/lib/salesIntelligence/runtimeContext';
import { buildPharmacyProductIndex } from '@/lib/salesIntelligence/pharmacyProducts/pharmacyProductResolverV2';
import { deriveCaseOwnershipContext } from '@/lib/salesIntelligence/caseOwnershipContext';
import { canonicalCaseBranchFromRecommendation } from '@/lib/salesIntelligence/canonicalCaseBranch';
import { runSalesIntelligencePipeline } from '@/lib/salesIntelligence/salesIntelligencePipeline';
import type { StaffDirectoryIdentity } from '@/lib/readModels/staffDirectoryReadModel';

const TEAM = 'فريق دواء ألفا';

function staff(id: string, name: string, role: string, branch: string, type: string | null = null): StaffDirectoryIdentity {
  return { id, name, role, type, branch, username: null, status: 'active', active: true, source: 'staff' };
}

const DIRECTORY = [
  staff('cs-1', 'خدمة أ', 'assistant', 'فرع الشامي', TEAM),
  staff('cs-2', 'خدمة ب', TEAM, 'المخزن', TEAM),
  staff('cs-3', 'خدمة ج', 'assistant', 'المخزن', TEAM),
  staff('doc-1', 'د صيدلي', 'صيدلاني', 'فرع الشامي'),
];

function message(id: string, sender: string, text: string, role: 'staff' | 'customer' = 'staff') {
  return { id, sender, text, role, at: '2026-09-27T15:00:00.000Z', meaningful: true } as any;
}

describe('segmentation: customer-service team identity', () => {
  const context = buildSalesIntelligenceRuntimeContext({ staffDirectory: DIRECTORY, productIndex: buildPharmacyProductIndex([]) });

  it('resolves every team member as customer service, whatever the legacy staff role says', () => {
    for (const id of ['cs-1', 'cs-2', 'cs-3']) {
      expect(context.staffProfilesById[id]?.function, id).toBe('customer_service');
    }
    expect(context.staffProfilesById['doc-1']?.function).toBe('pharmacist');
  });

  it('a service case never inherits a branch — not the source label, not the employee home branch', () => {
    const ownership = deriveCaseOwnershipContext({
      messages: [message('m1', 'Customer', 'عايز اعرف الطلب فين', 'customer'), message('m2', 'خدمة ب', 'هتابع مع حضرتك حالا')],
      sourceBranch: 'فرع شكري',
      staffIdBySender: { 'خدمة ب': 'cs-2' },
      staffProfilesById: context.staffProfilesById,
    });
    expect(ownership.department).toBe('customer_service');
    expect(ownership.operationalBranch).toBeNull();
    expect(ownership.suggestedStaffBranch).toBeNull();
    const branch = canonicalCaseBranchFromRecommendation({ recommendation: null, ownership, provenInvoiceId: null });
    expect(branch.branch).toBeNull();
    expect(branch.basis).toBe('customer_service');
  });

  it('a pharmacist case takes the operating branch from conversation evidence, not the home branch', () => {
    const ownership = deriveCaseOwnershipContext({
      messages: [message('m1', 'Customer', 'عايز علبة لبن', 'customer'), message('m2', 'د صيدلي', 'موجود يا فندم')],
      sourceBranch: 'فرع شكري',
      staffIdBySender: { 'د صيدلي': 'doc-1' },
      staffProfilesById: context.staffProfilesById,
    });
    expect(ownership.department).toBe('pharmacy');
    expect(ownership.operationalBranch).toBe('فرع شكري');
    expect(ownership.branchBasis).toBe('source');
    // The home branch differs: it is reported for review, never used to move the case.
    expect(ownership.blockers).toContain('staff_home_branch_differs_from_operation');
  });
});

describe('segmentation: a thank-you message is not a sale', () => {
  it('a bare thanks conversation is information only, never countable', () => {
    const raw = `[9/27/26, 6:00:00 PM] Customer: شكرا يا دكتور
[9/27/26, 6:01:00 PM] You: العفو تحت أمر حضرتك`;
    const result = runSalesIntelligencePipeline({ conversationId: 'thanks-only', rawWhatsAppExportText: raw, resolveInvoiceCandidates: () => [] });
    expect(result.caseAnalyses.length).toBeGreaterThan(0);
    for (const analysis of result.caseAnalyses) {
      expect(analysis.salesOutcome.outcome).not.toBe('sale_proven');
      expect(analysis.salesOutcome.isSaleCountable).toBe(false);
      expect(analysis.salesOutcome.isRevenueCountable).toBe(false);
      expect(analysis.salesOutcome.isOrderConfirmed).toBe(false);
    }
  });

  it('a delivery thank-you with a same-customer invoice nearby still does not prove a sale by itself', () => {
    const raw = `[9/27/26, 6:00:00 PM] Customer: الطلب وصل الحمد لله شكرا
[9/27/26, 6:01:00 PM] You: بالهنا والشفا`;
    const result = runSalesIntelligencePipeline({
      conversationId: 'thanks-after-delivery',
      rawWhatsAppExportText: raw,
      customerIdHint: 'cust-T',
      customerCodeHint: '9100',
      customerNameHint: 'عميل شكر',
      branchNameRawHint: 'فرع شكري',
      resolveInvoiceCandidates: () => [{
        id: 'inv-T', invoice_number: '20001', customer_id: 'cust-T', customer_code: '9100',
        customer_name: 'عميل شكر', branch: 'فرع شكري', invoice_datetime: '2026-09-27T15:05:00.000Z', net_amount: 120,
      }],
    });
    expect(result.caseAnalyses.length).toBeGreaterThan(0);
    for (const analysis of result.caseAnalyses) {
      expect(analysis.salesOutcome.isSaleCountable).toBe(false);
      expect(analysis.salesOutcome.isOrderConfirmed).toBe(false);
      expect(analysis.attribution.selectedCandidate?.directInvoiceLink ?? false).toBe(false);
    }
  });
});
