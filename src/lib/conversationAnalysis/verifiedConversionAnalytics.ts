import { classifyConversionEligibility, type ConversionConversationItem } from './conversionAnalytics';
import type { InvoiceConversionVerification } from './conversationInvoiceVerification';

export type VerifiedAnalyticsItem = ConversionConversationItem & { verification?: InvoiceConversionVerification | null };

export type VerifiedBreakdownRow = {
  key: string;
  label: string;
  eligible: number;
  checkedResolved: number;
  verified: number;
  unresolved: number;
  verificationCoverage: number | null;
  verifiedRateAmongResolved: number | null;
  verifiedLowerBound: number | null;
  verifiedRevenue: number;
  revenuePerVerifiedChat: number | null;
};

export type VerifiedConversionAnalytics = {
  overall: VerifiedBreakdownRow;
  byBranch: VerifiedBreakdownRow[];
  byDoctor: VerifiedBreakdownRow[];
};

const round1 = (v: number) => Math.round(v * 10) / 10;
const normalized = (v?: string | null) => String(v || '').trim() || 'غير محدد';

function summarize(items: VerifiedAnalyticsItem[], key: string, label: string): VerifiedBreakdownRow {
  const eligibleItems = items.filter((x) => classifyConversionEligibility(x).counted);
  const verified = eligibleItems.filter((x) => x.verification?.status === 'verified_converted');
  const notVerified = eligibleItems.filter((x) => x.verification?.status === 'not_verified');
  const checkedResolved = verified.length + notVerified.length;
  const unresolved = eligibleItems.filter((x) => ['probable_converted', 'needs_review'].includes(String(x.verification?.status || ''))).length;
  const revenue = verified.reduce((s, x) => s + Number(x.verification?.revenue || 0), 0);
  return {
    key,
    label,
    eligible: eligibleItems.length,
    checkedResolved,
    verified: verified.length,
    unresolved,
    verificationCoverage: eligibleItems.length ? round1((checkedResolved / eligibleItems.length) * 100) : null,
    verifiedRateAmongResolved: checkedResolved ? round1((verified.length / checkedResolved) * 100) : null,
    verifiedLowerBound: eligibleItems.length ? round1((verified.length / eligibleItems.length) * 100) : null,
    verifiedRevenue: Math.round(revenue * 100) / 100,
    revenuePerVerifiedChat: verified.length ? Math.round((revenue / verified.length) * 100) / 100 : null,
  };
}

function grouped(items: VerifiedAnalyticsItem[], selector: (x: VerifiedAnalyticsItem) => string) {
  const map = new Map<string, VerifiedAnalyticsItem[]>();
  for (const item of items) {
    const key = selector(item);
    map.set(key, [...(map.get(key) || []), item]);
  }
  return [...map.entries()];
}

export function buildVerifiedConversionAnalytics(items: VerifiedAnalyticsItem[]): VerifiedConversionAnalytics {
  const byBranch = grouped(items, (x) => normalized(x.branch)).map(([label, rows]) => summarize(rows, label, label));
  const byDoctor = grouped(items, (x) => normalized(x.staffName)).map(([label, rows]) => summarize(rows, label, label));
  const sorter = (a: VerifiedBreakdownRow, b: VerifiedBreakdownRow) => (b.verifiedRateAmongResolved ?? -1) - (a.verifiedRateAmongResolved ?? -1) || b.checkedResolved - a.checkedResolved;
  return { overall: summarize(items, 'all', 'الإجمالي'), byBranch: byBranch.sort(sorter), byDoctor: byDoctor.sort(sorter) };
}
