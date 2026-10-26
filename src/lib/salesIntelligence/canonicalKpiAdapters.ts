// Compatibility shapes for existing cards; every value is a projection of canonicalKpiReadModel.
import {
  loadCanonicalWhatsappKpis,
  summarizeCanonicalWhatsappKpis,
  canonicalStaffTruthRows,
  type CanonicalKpiCase,
  type CanonicalKpiScope,
} from './canonicalKpiReadModel';
import { ratioPercent, CONVERSION_ELIGIBLE_CASE_TYPES } from './canonicalConversionV1';

export async function loadCanonicalStaffRows(client: any, scope: CanonicalKpiScope) {
  try {
    return {
      data: canonicalStaffTruthRows(await loadCanonicalWhatsappKpis(client, scope)),
      error: null,
    };
  } catch (error) {
    return {
      data: [],
      error: error instanceof Error ? error : new Error(String((error as any)?.message ?? error)),
    };
  }
}

export function canonicalOpportunityProjection(facts: CanonicalKpiCase[]) {
  const demand = new Map<string, any>();
  const leakage = new Map<string, any>();
  const unresolved = new Map<string, any>();
  const detail: Array<{
    attributed_staff_id: string | null;
    attributed_staff_name: string | null;
    branch: string | null;
    cycle_start: string;
    current_stage: string;
    leakage_code: string | null;
  }> = [];
  for (const fact of facts) {
    for (const product of fact.view?.need?.products ?? []) {
      if (!product.productId) {
        const key = fact.branch ?? '';
        const r = unresolved.get(key) ?? {
          branch: fact.branch,
          unresolved_type: 'product_identity_unresolved',
          unresolved_mentions: 0,
          cases: new Set<string>(),
        };
        r.unresolved_mentions++;
        r.cases.add(fact.caseId);
        unresolved.set(key, r);
        continue;
      }
      const key = `${fact.branch}:${product.productId}`;
      const r = demand.get(key) ?? {
        branch: fact.branch,
        product_id: product.productId,
        product_code: product.productCode ?? '',
        product_name: product.canonicalName ?? product.productNameRaw,
        inquiry_opportunities: 0,
        customers: new Set<string>(),
        unavailable_count: 0,
        accepted_or_later_count: 0,
      };
      r.inquiry_opportunities++;
      if (fact.customerId) r.customers.add(fact.customerId);
      if (product.availability === 'unavailable') r.unavailable_count++;
      if (product.roles.includes('final_basket')) r.accepted_or_later_count++;
      demand.set(key, r);
    }
    if (fact.lost) {
      const reason = fact.view?.lostOpportunity.reason ?? 'unknown';
      const key = `${fact.branch}:${reason}`;
      const r = leakage.get(key) ?? {
        branch: fact.branch,
        leakage_code: reason,
        cases_count: 0,
        customers: new Set<string>(),
        products: new Set<string>(),
        staff_attributed_cases: 0,
      };
      r.cases_count++;
      if (fact.customerId) r.customers.add(fact.customerId);
      fact.view?.need?.products?.forEach((p) => {
        if (p.productId) r.products.add(p.productId);
      });
      // Loss responsibility is not inferred from closer/participants; no automatic staff debit.
      leakage.set(key, r);
    }
    detail.push({
      attributed_staff_id: fact.creditedStaffId,
      attributed_staff_name: fact.creditedStaffName,
      branch: fact.branch,
      cycle_start: fact.startedAt.slice(0, 10),
      current_stage: fact.saleCountable
        ? 'verified_sale'
        : (fact.view?.lostOpportunity.state ?? 'unknown'),
      leakage_code: null,
    });
  }
  return {
    demand: [...demand.values()].map((r) => ({
      ...r,
      unique_customers: r.customers.size,
      acceptance_rate: ratioPercent(r.accepted_or_later_count, r.inquiry_opportunities),
    })),
    leakage: [...leakage.values()].map((r) => ({
      ...r,
      unique_customers: r.customers.size,
      unique_products: r.products.size,
    })),
    unresolved: [...unresolved.values()].map((r) => ({
      ...r,
      conversations_affected: r.cases.size,
    })),
    detail,
  };
}

export async function loadCanonicalOpportunityRows(client: any, scope: CanonicalKpiScope) {
  return canonicalOpportunityProjection(await loadCanonicalWhatsappKpis(client, scope));
}

export function canonicalDoctorImpact(
  facts: CanonicalKpiCase[],
  staffId: string,
  start: string,
  endExclusive: string,
  cycleStart = start.slice(0, 10)
) {
  const relevant = facts.filter((f) => f.startedAt >= start && f.startedAt < endExclusive);
  if (!relevant.length) return null;
  // Population = cases this doctor handled; credit decides only the sale numerator.
  const summary = summarizeCanonicalWhatsappKpis(relevant, staffId);
  return {
    cycle_start: cycleStart,
    cycle_end: endExclusive,
    // Unknown while a commercial case has no resolved owner at all (it could be this doctor's), or
    // while a proven sale this doctor took part in still waits for closer attribution.
    commercial_conversations: relevant.some(
      (f) =>
        CONVERSION_ELIGIBLE_CASE_TYPES.has(f.caseType) &&
        !f.creditedStaffId &&
        (!f.participants.some((p) => p.staffId) ||
          (f.saleCountable && f.participants.some((p) => p.staffId === staffId)))
    )
      ? null
      : summary.conversion.eligibleCases,
    conversion_sale_count: summary.conversion.provenSales,
    verified_sale_conversations: relevant.some(
      (f) => f.saleCountable && !f.staffAttributionAvailable
    )
      ? null
      : summary.sales,
    verified_revenue: summary.revenue,
    conversations_needing_followup: relevant.some((f) =>
      (f.view?.followUp?.opportunities ?? []).some(
        (o) => o.status === 'actionable' && !o.assignedStaffId
      )
    )
      ? null
      : relevant.filter((f) =>
          (f.view?.followUp?.opportunities ?? []).some(
            (o) => o.status === 'actionable' && o.assignedStaffId === staffId
          )
        ).length,
    complaint_conversations: null,
    // Loss attribution is not persisted as the confirmed sale owner; never turn uncertainty into debit.
    sale_leakage_count: null,
    unavailable_product_count: null,
    accepted_product_count: null,
  };
}
