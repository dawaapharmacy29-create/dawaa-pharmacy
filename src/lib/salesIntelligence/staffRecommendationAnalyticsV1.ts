import type { RecommendationConversionFactV1 } from './recommendationConversionV1';

export interface StaffRecommendationSummaryV1 {
  recommenderName: string;
  recommendationCount: number;
  acceptedRecommendationCount: number;
  rejectedRecommendationCount: number;
  officialRecommendationSaleCount: number;
  candidateInvoiceMatchCount: number;
  officialRecommendationRevenue: number;
  acceptanceRatePercent: number | null;
  officialConversionRatePercent: number | null;
  needsReviewCount: number;
}

export function summarizeStaffRecommendationsV1(
  facts: RecommendationConversionFactV1[]
): StaffRecommendationSummaryV1[] {
  const groups = new Map<string, {
    recommenderName: string;
    recommendationCount: number;
    acceptedRecommendationCount: number;
    rejectedRecommendationCount: number;
    officialRecommendationSaleCount: number;
    candidateInvoiceMatchCount: number;
    officialRecommendationRevenue: number;
    needsReviewCount: number;
  }>();

  for (const fact of facts) {
    if (!fact.recommenderName) continue;
    const key = fact.recommenderName.trim();
    if (!key) continue;
    const group = groups.get(key) ?? {
      recommenderName: key,
      recommendationCount: 0,
      acceptedRecommendationCount: 0,
      rejectedRecommendationCount: 0,
      officialRecommendationSaleCount: 0,
      candidateInvoiceMatchCount: 0,
      officialRecommendationRevenue: 0,
      needsReviewCount: 0,
    };

    group.recommendationCount += 1;
    if (fact.acceptedInChat) group.acceptedRecommendationCount += 1;
    if (fact.rejectedInChat) group.rejectedRecommendationCount += 1;
    if (fact.officialSaleFromRecommendation) {
      group.officialRecommendationSaleCount += 1;
      group.officialRecommendationRevenue += Number(fact.soldNetValue) || 0;
    }
    if (fact.conversionStatus === 'candidate_invoice_match') {
      group.candidateInvoiceMatchCount += 1;
    }
    if (fact.needsHumanReview) group.needsReviewCount += 1;

    groups.set(key, group);
  }

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      acceptanceRatePercent: group.recommendationCount
        ? Math.round((group.acceptedRecommendationCount / group.recommendationCount) * 100)
        : null,
      officialConversionRatePercent: group.recommendationCount
        ? Math.round((group.officialRecommendationSaleCount / group.recommendationCount) * 100)
        : null,
    }))
    .sort((a, b) =>
      b.officialRecommendationRevenue - a.officialRecommendationRevenue ||
      b.officialRecommendationSaleCount - a.officialRecommendationSaleCount ||
      a.recommenderName.localeCompare(b.recommenderName, 'ar')
    );
}
