import { getCycleForDate } from '@/lib/pharmacy-cycle';
import type { WhatsAppConversationSession } from './whatsappConversationParser';
import { buildUnifiedConversationIntelligence, type UnifiedConversationIntelligence } from './whatsappUnifiedIntelligenceV4';
import { extractConversationSignals } from './whatsappConversationSignals';

export interface WhatsAppPerformanceItem {
  session: WhatsAppConversationSession;
  branch?: string | null;
  staffName?: string | null;
  intelligence?: UnifiedConversationIntelligence;
}

export interface WhatsAppPerformanceProfile {
  key: string;
  label: string;
  dimension: 'branch' | 'doctor';
  conversations: number;
  eligibleSalesChats: number;
  suggestedSoldChats: number;
  conversionSuggestionRate: number | null;
  avgServiceScore: number | null;
  avgCommercialScore: number | null;
  avgFirstResponseSeconds: number | null;
  lostSalesRate: number | null;
  followupRequiredRate: number | null;
  unansweredMessages: number;
  humanReviewChats: number;
  urgentChats: number;
  complaints: number;
  sampleQuality: 'insufficient' | 'limited' | 'usable' | 'strong';
  sampleQualityLabel: string;
  topStrengths: Array<{ label: string; count: number }>;
  topWeaknesses: Array<{ label: string; count: number }>;
}

const normalize = (value?: string | null) => String(value || '').trim() || 'غير محدد';
const round1 = (value: number) => Math.round(value * 10) / 10;
const average = (values: number[]) => values.length ? round1(values.reduce((a, b) => a + b, 0) / values.length) : null;

function quality(eligible: number): Pick<WhatsAppPerformanceProfile, 'sampleQuality' | 'sampleQualityLabel'> {
  if (eligible < 3) return { sampleQuality: 'insufficient', sampleQualityLabel: 'عينة غير كافية للحكم' };
  if (eligible < 8) return { sampleQuality: 'limited', sampleQualityLabel: 'عينة محدودة — تُقرأ بحذر' };
  if (eligible < 20) return { sampleQuality: 'usable', sampleQualityLabel: 'عينة قابلة للاستخدام' };
  return { sampleQuality: 'strong', sampleQualityLabel: 'عينة قوية' };
}

function frequency(values: string[], limit = 4) {
  const map = new Map<string, number>();
  values.filter(Boolean).forEach((value) => map.set(value, (map.get(value) || 0) + 1));
  return [...map.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'ar')).slice(0, limit);
}

function hydrate(item: WhatsAppPerformanceItem) {
  return { ...item, intelligence: item.intelligence || buildUnifiedConversationIntelligence(item.session) };
}

function profile(items: WhatsAppPerformanceItem[], dimension: 'branch' | 'doctor', key: string, label: string): WhatsAppPerformanceProfile {
  const hydrated = items.map(hydrate);
  const eligible = hydrated.filter((x) => x.intelligence.commercialEligible);
  const sold = eligible.filter((x) => x.intelligence.chatSuggestedSold);
  const signals = hydrated.map((x) => extractConversationSignals(x.session));
  const response = signals.map((x) => x.firstResponseSeconds).filter((x): x is number => x != null);
  const lostSales = eligible.filter((x) => x.intelligence.lostSales.some((s) => s.severity === 'medium' || s.severity === 'high')).length;
  const complaints = hydrated.filter((x) => x.intelligence.outcome === 'complaint_resolved' || x.intelligence.outcome === 'complaint_unresolved').length;
  return {
    key,
    label,
    dimension,
    conversations: hydrated.length,
    eligibleSalesChats: eligible.length,
    suggestedSoldChats: sold.length,
    conversionSuggestionRate: eligible.length ? round1((sold.length / eligible.length) * 100) : null,
    avgServiceScore: average(hydrated.map((x) => x.intelligence.serviceScore)),
    avgCommercialScore: average(hydrated.map((x) => x.intelligence.commercialScore)),
    avgFirstResponseSeconds: average(response),
    lostSalesRate: eligible.length ? round1((lostSales / eligible.length) * 100) : null,
    followupRequiredRate: hydrated.length ? round1((hydrated.filter((x) => x.intelligence.followupRequired).length / hydrated.length) * 100) : null,
    unansweredMessages: signals.reduce((sum, x) => sum + x.unansweredInboundCount, 0),
    humanReviewChats: hydrated.filter((x) => x.intelligence.requiresHumanApproval).length,
    urgentChats: hydrated.filter((x) => x.intelligence.priority === 'urgent').length,
    complaints,
    ...quality(eligible.length),
    topStrengths: frequency(hydrated.flatMap((x) => x.intelligence.strengths)),
    topWeaknesses: frequency(hydrated.flatMap((x) => x.intelligence.weaknesses)),
  };
}

function group(items: WhatsAppPerformanceItem[], dimension: 'branch' | 'doctor') {
  const grouped = new Map<string, WhatsAppPerformanceItem[]>();
  for (const item of items) {
    const doctorLabel =
      item.staffName ||
      (item.session.outboundStaffNames.length === 1 ? item.session.outboundStaffNames[0] : null) ||
      'غير محسوم';
    const label = normalize(dimension === 'branch' ? item.branch : doctorLabel);
    grouped.set(label, [...(grouped.get(label) || []), item]);
  }
  return [...grouped.entries()].map(([label, rows]) => profile(rows, dimension, label, label));
}

export function buildCurrentCycleWhatsAppPerformance(items: WhatsAppPerformanceItem[], anchor = new Date()) {
  const cycle = getCycleForDate(anchor);
  const current = items.filter((item) => item.session.startedAt >= cycle.start && item.session.startedAt <= cycle.end);
  return {
    cycle,
    branches: group(current, 'branch').sort((a, b) => (b.conversionSuggestionRate ?? -1) - (a.conversionSuggestionRate ?? -1) || b.eligibleSalesChats - a.eligibleSalesChats),
    doctors: group(current, 'doctor').sort((a, b) => (b.conversionSuggestionRate ?? -1) - (a.conversionSuggestionRate ?? -1) || b.eligibleSalesChats - a.eligibleSalesChats),
  };
}

export function compareWhatsAppCycles(items: WhatsAppPerformanceItem[], anchor = new Date()) {
  const currentCycle = getCycleForDate(anchor);
  const previousAnchor = new Date(currentCycle.start.getTime() - 24 * 60 * 60 * 1000);
  const previousCycle = getCycleForDate(previousAnchor);
  const byCycle = (start: Date, end: Date) => items.filter((item) => item.session.startedAt >= start && item.session.startedAt <= end);
  const current = byCycle(currentCycle.start, currentCycle.end);
  const previous = byCycle(previousCycle.start, previousCycle.end);
  const summarise = (rows: WhatsAppPerformanceItem[]) => profile(rows, 'branch', 'all', 'كل الفروع');
  const currentSummary = summarise(current);
  const previousSummary = summarise(previous);
  return {
    currentCycle,
    previousCycle,
    current: currentSummary,
    previous: previousSummary,
    deltas: {
      conversionSuggestionRate: currentSummary.conversionSuggestionRate != null && previousSummary.conversionSuggestionRate != null ? round1(currentSummary.conversionSuggestionRate - previousSummary.conversionSuggestionRate) : null,
      avgServiceScore: currentSummary.avgServiceScore != null && previousSummary.avgServiceScore != null ? round1(currentSummary.avgServiceScore - previousSummary.avgServiceScore) : null,
      avgCommercialScore: currentSummary.avgCommercialScore != null && previousSummary.avgCommercialScore != null ? round1(currentSummary.avgCommercialScore - previousSummary.avgCommercialScore) : null,
      lostSalesRate: currentSummary.lostSalesRate != null && previousSummary.lostSalesRate != null ? round1(currentSummary.lostSalesRate - previousSummary.lostSalesRate) : null,
    },
  };
}
