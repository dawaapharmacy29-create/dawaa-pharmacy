import type { WhatsAppChatAnalysis } from './whatsappChatAnalyzer';

export type ConversationPortfolioItem = {
  id: string;
  label: string;
  staffName?: string | null;
  customerName?: string | null;
  analysis: WhatsAppChatAnalysis;
};

export type ConversationPortfolioSummary = {
  conversations: number;
  avgServiceScore: number | null;
  avgCommercialScore: number | null;
  avgFirstResponseSeconds: number | null;
  medianFirstResponseSeconds: number | null;
  unansweredMessages: number;
  missedFollowups: number;
  conversationsNeedingHumanReview: number;
  topStrengths: Array<{ label: string; count: number }>;
  topRisks: Array<{ label: string; count: number }>;
  weakestCriteria: Array<{ key: string; label: string; average: number; samples: number }>;
  strongestCriteria: Array<{ key: string; label: string; average: number; samples: number }>;
  trend: Array<{ label: string; score: number | null; commercial: number | null }>;
};

function avg(values: number[]) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function median(values: number[]) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function normScore(analysis: WhatsAppChatAnalysis) {
  const rows = analysis.criteria.filter((c) => c.applies && c.score != null && c.maxScore > 0);
  if (!rows.length) return null;
  return Math.round((rows.reduce((sum, c) => sum + ((c.score || 0) / c.maxScore) * 100, 0) / rows.length) * 10) / 10;
}

function commercialScore(analysis: WhatsAppChatAnalysis) {
  const keys = new Set(['sales_closing', 'cross_sell_upsell', 'understanding', 'unavailable_items', 'order_confirmation']);
  const rows = analysis.criteria.filter((c) => keys.has(c.key) && c.applies && c.score != null && c.maxScore > 0);
  if (!rows.length) return null;
  return Math.round((rows.reduce((sum, c) => sum + ((c.score || 0) / c.maxScore) * 100, 0) / rows.length) * 10) / 10;
}

function frequency(values: string[]) {
  const map = new Map<string, number>();
  values.filter(Boolean).forEach((v) => map.set(v, (map.get(v) || 0) + 1));
  return [...map.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function buildConversationPortfolioSummary(items: ConversationPortfolioItem[]): ConversationPortfolioSummary {
  const service = items.map((x) => normScore(x.analysis)).filter((x): x is number => x != null);
  const commercial = items.map((x) => commercialScore(x.analysis)).filter((x): x is number => x != null);
  const firstResponses = items.map((x) => x.analysis.metrics.firstResponseSeconds).filter((x): x is number => x != null);

  const criterionMap = new Map<string, { label: string; values: number[] }>();
  items.forEach((item) => item.analysis.criteria.forEach((c) => {
    if (!c.applies || c.score == null || !c.maxScore) return;
    const pct = (c.score / c.maxScore) * 100;
    const current = criterionMap.get(c.key) || { label: c.label, values: [] };
    current.values.push(pct);
    criterionMap.set(c.key, current);
  }));
  const criterionRows = [...criterionMap.entries()].map(([key, row]) => ({ key, label: row.label, average: Math.round((avg(row.values) || 0) * 10) / 10, samples: row.values.length }));

  return {
    conversations: items.length,
    avgServiceScore: avg(service) == null ? null : Math.round((avg(service) as number) * 10) / 10,
    avgCommercialScore: avg(commercial) == null ? null : Math.round((avg(commercial) as number) * 10) / 10,
    avgFirstResponseSeconds: avg(firstResponses) == null ? null : Math.round(avg(firstResponses) as number),
    medianFirstResponseSeconds: median(firstResponses),
    unansweredMessages: items.reduce((s, x) => s + x.analysis.metrics.unansweredCustomerMessages, 0),
    missedFollowups: items.reduce((s, x) => s + x.analysis.metrics.missedPromisedFollowups, 0),
    conversationsNeedingHumanReview: items.filter((x) => x.analysis.manualReviewReasons.length > 0).length,
    topStrengths: frequency(items.flatMap((x) => x.analysis.positives)).slice(0, 8),
    topRisks: frequency(items.flatMap((x) => x.analysis.risks)).slice(0, 8),
    weakestCriteria: [...criterionRows].sort((a, b) => a.average - b.average).slice(0, 6),
    strongestCriteria: [...criterionRows].sort((a, b) => b.average - a.average).slice(0, 6),
    trend: items.map((x) => ({ label: x.label, score: normScore(x.analysis), commercial: commercialScore(x.analysis) })),
  };
}
