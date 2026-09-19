import { getCycleForDate, type PharmacyCycle } from '@/lib/pharmacy-cycle';
import type { SmartConversationIntelligenceResult } from './smartConversationIntelligence';

export interface UnifiedAnalyticsRow {
  key: string;
  label: string;
  conversations: number;
  commercialChats: number;
  verifiedSales: number;
  probableSales: number;
  chatSaleSignals: number;
  verifiedConversionRate: number | null;
  burstCount: number;
  repliedBursts: number;
  burstReplyRate: number | null;
}

export interface UnifiedCycleSnapshot {
  cycleStart: string;
  cycleEnd: string;
  label: string;
  conversations: number;
  commercialChats: number;
  verifiedSales: number;
  verifiedConversionRate: number | null;
}

export interface UnifiedExperimentAnalytics {
  totalConversations: number;
  commercialChats: number;
  verifiedSales: number;
  probableSales: number;
  chatSaleSignals: number;
  noVerifiedInvoice: number;
  verifiedConversionRate: number | null;
  currentCycle: UnifiedCycleSnapshot;
  previousCycle: UnifiedCycleSnapshot;
  verifiedConversionChangePp: number | null;
  byBranch: UnifiedAnalyticsRow[];
  byStaff: UnifiedAnalyticsRow[];
}

const round1 = (value: number) => Math.round(value * 10) / 10;
const norm = (value?: string | null) => String(value || '').trim() || 'غير محدد';

function isCommercial(result: SmartConversationIntelligenceResult) {
  return (
    result.journey.saleState !== 'no_verified_invoice' ||
    result.journey.journeyType === 'direct_customer_request' ||
    result.journey.journeyType === 'checkin_then_order' ||
    result.journey.journeyType === 'checkin_then_verified_sale'
  );
}

function summarize(results: SmartConversationIntelligenceResult[]) {
  const commercialChats = results.filter(isCommercial).length;
  const verifiedSales = results.filter((r) => r.journey.saleState === 'invoice_verified_sale').length;
  const probableSales = results.filter((r) => r.journey.saleState === 'probable_sale').length;
  const chatSaleSignals = results.filter((r) => r.journey.saleState === 'chat_sale_signal').length;
  const noVerifiedInvoice = results.filter((r) => r.journey.saleState === 'no_verified_invoice').length;
  return {
    conversations: results.length,
    commercialChats,
    verifiedSales,
    probableSales,
    chatSaleSignals,
    noVerifiedInvoice,
    verifiedConversionRate: commercialChats ? round1((verifiedSales / commercialChats) * 100) : null,
  };
}

function previousCycleOf(cycle: PharmacyCycle) {
  const d = new Date(cycle.start);
  d.setDate(d.getDate() - 1);
  return getCycleForDate(d);
}

function inCycle(result: SmartConversationIntelligenceResult, cycle: PharmacyCycle) {
  const date = new Date(result.sessionStartedAt);
  return !Number.isNaN(date.getTime()) && date >= cycle.start && date <= cycle.end;
}

function cycleSnapshot(results: SmartConversationIntelligenceResult[], cycle: PharmacyCycle): UnifiedCycleSnapshot {
  const scoped = results.filter((r) => inCycle(r, cycle));
  const s = summarize(scoped);
  return {
    cycleStart: cycle.start.toISOString().slice(0, 10),
    cycleEnd: cycle.end.toISOString().slice(0, 10),
    label: cycle.label,
    conversations: s.conversations,
    commercialChats: s.commercialChats,
    verifiedSales: s.verifiedSales,
    verifiedConversionRate: s.verifiedConversionRate,
  };
}

function groupRows(
  results: SmartConversationIntelligenceResult[],
  selector: (result: SmartConversationIntelligenceResult) => string
): UnifiedAnalyticsRow[] {
  const groups = new Map<string, SmartConversationIntelligenceResult[]>();
  for (const result of results) {
    const key = selector(result);
    groups.set(key, [...(groups.get(key) || []), result]);
  }
  return [...groups.entries()]
    .map(([label, rows]) => {
      const s = summarize(rows);
      const effort = rows.flatMap((r) => r.staffEffort);
      const burstCount = effort.reduce((sum, item) => sum + item.burstCount, 0);
      const repliedBursts = effort.reduce((sum, item) => sum + item.repliedBursts, 0);
      return {
        key: label,
        label,
        conversations: s.conversations,
        commercialChats: s.commercialChats,
        verifiedSales: s.verifiedSales,
        probableSales: s.probableSales,
        chatSaleSignals: s.chatSaleSignals,
        verifiedConversionRate: s.verifiedConversionRate,
        burstCount,
        repliedBursts,
        burstReplyRate: burstCount ? round1((repliedBursts / burstCount) * 100) : null,
      };
    })
    .sort((a, b) => b.conversations - a.conversations || a.label.localeCompare(b.label));
}

function staffRows(results: SmartConversationIntelligenceResult[]): UnifiedAnalyticsRow[] {
  const names = new Set(results.flatMap((r) => r.staffEffort.map((s) => s.staffName)).filter(Boolean));
  return [...names].map((name) => {
    const rows = results.filter((r) => r.staffEffort.some((s) => s.staffName === name));
    const s = summarize(rows);
    const effort = rows.flatMap((r) => r.staffEffort.filter((x) => x.staffName === name));
    const burstCount = effort.reduce((sum, item) => sum + item.burstCount, 0);
    const repliedBursts = effort.reduce((sum, item) => sum + item.repliedBursts, 0);
    return {
      key: name,
      label: name,
      conversations: rows.length,
      commercialChats: s.commercialChats,
      verifiedSales: s.verifiedSales,
      probableSales: s.probableSales,
      chatSaleSignals: s.chatSaleSignals,
      verifiedConversionRate: s.verifiedConversionRate,
      burstCount,
      repliedBursts,
      burstReplyRate: burstCount ? round1((repliedBursts / burstCount) * 100) : null,
    };
  }).sort((a, b) => b.conversations - a.conversations || a.label.localeCompare(b.label));
}

export function buildUnifiedExperimentAnalytics(
  results: SmartConversationIntelligenceResult[],
  anchor: Date = new Date()
): UnifiedExperimentAnalytics {
  const total = summarize(results);
  const current = getCycleForDate(anchor);
  const previous = previousCycleOf(current);
  const currentCycle = cycleSnapshot(results, current);
  const previousCycle = cycleSnapshot(results, previous);
  return {
    totalConversations: total.conversations,
    commercialChats: total.commercialChats,
    verifiedSales: total.verifiedSales,
    probableSales: total.probableSales,
    chatSaleSignals: total.chatSaleSignals,
    noVerifiedInvoice: total.noVerifiedInvoice,
    verifiedConversionRate: total.verifiedConversionRate,
    currentCycle,
    previousCycle,
    verifiedConversionChangePp:
      currentCycle.verifiedConversionRate == null || previousCycle.verifiedConversionRate == null
        ? null
        : round1(currentCycle.verifiedConversionRate - previousCycle.verifiedConversionRate),
    byBranch: groupRows(results, (r) => norm(r.customer.customer?.branch || r.branchHint)),
    byStaff: staffRows(results),
  };
}
