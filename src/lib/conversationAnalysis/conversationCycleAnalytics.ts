import { getCycleForDate, type PharmacyCycle } from '@/lib/pharmacy-cycle';
import { buildConversionAnalytics, classifyConversionEligibility, type ConversionAnalytics, type ConversionConversationItem } from './conversionAnalytics';

export type CycleConversationItem = ConversionConversationItem & {
  conversationAt?: string | null;
};

export type CycleMetricSnapshot = {
  cycleStart: string;
  cycleEnd: string;
  cycleLabel: string;
  conversations: number;
  conversion: ConversionAnalytics;
  lostSalesConversations: number;
  lostSalesRate: number | null;
  promisedFollowups: number;
  completedFollowups: number;
  missedFollowups: number;
  followupRecoveryRate: number | null;
  unansweredCustomerMessages: number;
  humanReviewConversations: number;
};

export type CycleComparisonRow = {
  key: string;
  label: string;
  currentEligible: number;
  currentConverted: number;
  currentRate: number | null;
  previousEligible: number;
  previousConverted: number;
  previousRate: number | null;
  changePp: number | null;
};

export type ConversationCycleAnalytics = {
  current: CycleMetricSnapshot;
  previous: CycleMetricSnapshot;
  conversionChangePp: number | null;
  lostSalesRateChangePp: number | null;
  followupRecoveryChangePp: number | null;
  byBranch: CycleComparisonRow[];
  byDoctor: CycleComparisonRow[];
};

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function dateOnly(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function previousCycleOf(cycle: PharmacyCycle) {
  const d = new Date(cycle.start);
  d.setDate(d.getDate() - 1);
  return getCycleForDate(d);
}

function firstMessageDate(item: CycleConversationItem) {
  if (item.conversationAt) {
    const explicit = new Date(item.conversationAt);
    if (!Number.isNaN(explicit.getTime())) return explicit;
  }
  const firstTimed = item.intelligence.base.messages.find((m) => m.timestamp)?.timestamp;
  if (!firstTimed) return null;
  const parsed = new Date(firstTimed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function inCycle(item: CycleConversationItem, cycle: PharmacyCycle) {
  const date = firstMessageDate(item);
  return Boolean(date && date >= cycle.start && date <= cycle.end);
}

function pp(current: number | null, previous: number | null) {
  if (current == null || previous == null) return null;
  return round1(current - previous);
}

function snapshot(items: CycleConversationItem[], cycle: PharmacyCycle): CycleMetricSnapshot {
  const conversion = buildConversionAnalytics(items);
  const eligible = items.filter((item) => classifyConversionEligibility(item).counted);
  const lostSalesConversations = eligible.filter((item) =>
    item.intelligence.journey.lostSales.some((x) => x.severity === 'medium' || x.severity === 'high')
  ).length;
  const promisedFollowups = items.reduce((sum, item) => sum + item.intelligence.base.metrics.promisedFollowups, 0);
  const missedFollowups = items.reduce((sum, item) => sum + item.intelligence.base.metrics.missedPromisedFollowups, 0);
  const completedFollowups = Math.max(0, promisedFollowups - missedFollowups);

  return {
    cycleStart: dateOnly(cycle.start),
    cycleEnd: dateOnly(cycle.end),
    cycleLabel: cycle.label,
    conversations: items.length,
    conversion,
    lostSalesConversations,
    lostSalesRate: eligible.length ? round1((lostSalesConversations / eligible.length) * 100) : null,
    promisedFollowups,
    completedFollowups,
    missedFollowups,
    followupRecoveryRate: promisedFollowups ? round1((completedFollowups / promisedFollowups) * 100) : null,
    unansweredCustomerMessages: items.reduce((sum, item) => sum + item.intelligence.base.metrics.unansweredCustomerMessages, 0),
    humanReviewConversations: items.filter((item) => item.intelligence.requiresHumanApproval).length,
  };
}

function compareRows(
  current: Array<{ key: string; label: string; eligible: number; converted: number; conversionRate: number | null }>,
  previous: Array<{ key: string; label: string; eligible: number; converted: number; conversionRate: number | null }>
): CycleComparisonRow[] {
  const keys = new Set([...current.map((x) => x.key), ...previous.map((x) => x.key)]);
  return [...keys].map((key) => {
    const c = current.find((x) => x.key === key);
    const p = previous.find((x) => x.key === key);
    return {
      key,
      label: c?.label || p?.label || key,
      currentEligible: c?.eligible || 0,
      currentConverted: c?.converted || 0,
      currentRate: c?.conversionRate ?? null,
      previousEligible: p?.eligible || 0,
      previousConverted: p?.converted || 0,
      previousRate: p?.conversionRate ?? null,
      changePp: pp(c?.conversionRate ?? null, p?.conversionRate ?? null),
    };
  }).sort((a, b) => (b.currentRate ?? -1) - (a.currentRate ?? -1) || b.currentEligible - a.currentEligible);
}

export function buildConversationCycleAnalytics(items: CycleConversationItem[], anchor: Date = new Date()): ConversationCycleAnalytics {
  const currentCycle = getCycleForDate(anchor);
  const previousCycle = previousCycleOf(currentCycle);
  const currentItems = items.filter((item) => inCycle(item, currentCycle));
  const previousItems = items.filter((item) => inCycle(item, previousCycle));
  const current = snapshot(currentItems, currentCycle);
  const previous = snapshot(previousItems, previousCycle);

  return {
    current,
    previous,
    conversionChangePp: pp(current.conversion.conversionRate, previous.conversion.conversionRate),
    lostSalesRateChangePp: pp(current.lostSalesRate, previous.lostSalesRate),
    followupRecoveryChangePp: pp(current.followupRecoveryRate, previous.followupRecoveryRate),
    byBranch: compareRows(current.conversion.byBranch, previous.conversion.byBranch),
    byDoctor: compareRows(current.conversion.byDoctor, previous.conversion.byDoctor),
  };
}
