import { getCycleForDate } from '@/lib/pharmacy-cycle';
import { buildConversionAnalytics, classifyConversionEligibility } from './conversionAnalytics';
import type { CycleConversationItem } from './conversationCycleAnalytics';

export type PerformanceProfile = {
  key: string;
  label: string;
  dimension: 'branch' | 'doctor';
  conversations: number;
  eligibleSalesChats: number;
  convertedChats: number;
  conversionRate: number | null;
  avgServiceScore: number | null;
  avgCommercialScore: number | null;
  avgFirstResponseSeconds: number | null;
  lostSalesRate: number | null;
  followupRecoveryRate: number | null;
  unansweredMessages: number;
  humanReviewChats: number;
  sampleQuality: 'insufficient' | 'limited' | 'usable' | 'strong';
  sampleQualityLabel: string;
  strongestCriteria: Array<{ label: string; score: number; samples: number }>;
  weakestCriteria: Array<{ label: string; score: number; samples: number }>;
};

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function average(values: number[]) {
  return values.length ? round1(values.reduce((a, b) => a + b, 0) / values.length) : null;
}

function normalize(value?: string | null) {
  return String(value || '').trim() || 'غير محدد';
}

function sampleQuality(eligible: number): Pick<PerformanceProfile, 'sampleQuality' | 'sampleQualityLabel'> {
  if (eligible < 3) return { sampleQuality: 'insufficient', sampleQualityLabel: 'عينة غير كافية للحكم' };
  if (eligible < 8) return { sampleQuality: 'limited', sampleQualityLabel: 'عينة محدودة — تُقرأ بحذر' };
  if (eligible < 20) return { sampleQuality: 'usable', sampleQualityLabel: 'عينة قابلة للاستخدام' };
  return { sampleQuality: 'strong', sampleQualityLabel: 'عينة قوية' };
}

function conversationDate(item: CycleConversationItem) {
  const raw = item.conversationAt || item.intelligence.base.messages.find((m) => m.timestamp)?.timestamp;
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function serviceScore(item: CycleConversationItem) {
  const keys = new Set(['first_response_speed', 'greeting', 'doctor_name', 'tone', 'closing_message', 'angry_customer']);
  const rows = item.intelligence.base.criteria.filter((c) => keys.has(c.key) && c.applies && c.score != null && c.maxScore > 0);
  if (!rows.length) return null;
  return round1(rows.reduce((sum, c) => sum + ((c.score || 0) / c.maxScore) * 100, 0) / rows.length);
}

function criterionRanking(items: CycleConversationItem[]) {
  const map = new Map<string, { label: string; scores: number[] }>();
  for (const item of items) {
    for (const criterion of item.intelligence.base.criteria) {
      if (!criterion.applies || criterion.score == null || !criterion.maxScore) continue;
      const current = map.get(criterion.key) || { label: criterion.label, scores: [] };
      current.scores.push((criterion.score / criterion.maxScore) * 100);
      map.set(criterion.key, current);
    }
  }
  return [...map.entries()].map(([key, row]) => ({
    key,
    label: row.label,
    score: average(row.scores) || 0,
    samples: row.scores.length,
  }));
}

function profile(items: CycleConversationItem[], dimension: 'branch' | 'doctor', key: string, label: string): PerformanceProfile {
  const conversion = buildConversionAnalytics(items);
  const overallConversion = conversion.conversionRate;
  const eligible = items.filter((item) => classifyConversionEligibility(item).counted);
  const serviceScores = items.map(serviceScore).filter((x): x is number => x != null);
  const commercialScores = items.map((x) => x.intelligence.commercialScore).filter((x) => Number.isFinite(x));
  const responseSeconds = items.map((x) => x.intelligence.base.metrics.firstResponseSeconds).filter((x): x is number => x != null);
  const lostSales = eligible.filter((item) => item.intelligence.journey.lostSales.some((x) => x.severity === 'medium' || x.severity === 'high')).length;
  const promised = items.reduce((sum, item) => sum + item.intelligence.base.metrics.promisedFollowups, 0);
  const missed = items.reduce((sum, item) => sum + item.intelligence.base.metrics.missedPromisedFollowups, 0);
  const criteria = criterionRanking(items);
  const quality = sampleQuality(eligible.length);

  return {
    key,
    label,
    dimension,
    conversations: items.length,
    eligibleSalesChats: eligible.length,
    convertedChats: conversion.convertedConversations,
    conversionRate: overallConversion,
    avgServiceScore: average(serviceScores),
    avgCommercialScore: average(commercialScores),
    avgFirstResponseSeconds: average(responseSeconds),
    lostSalesRate: eligible.length ? round1((lostSales / eligible.length) * 100) : null,
    followupRecoveryRate: promised ? round1(((promised - missed) / promised) * 100) : null,
    unansweredMessages: items.reduce((sum, item) => sum + item.intelligence.base.metrics.unansweredCustomerMessages, 0),
    humanReviewChats: items.filter((item) => item.intelligence.requiresHumanApproval).length,
    ...quality,
    strongestCriteria: [...criteria].sort((a, b) => b.score - a.score).slice(0, 3),
    weakestCriteria: [...criteria].sort((a, b) => a.score - b.score).slice(0, 3),
  };
}

function group(items: CycleConversationItem[], dimension: 'branch' | 'doctor') {
  const map = new Map<string, CycleConversationItem[]>();
  for (const item of items) {
    const label = normalize(dimension === 'branch' ? item.branch : item.staffName);
    map.set(label, [...(map.get(label) || []), item]);
  }
  return [...map.entries()].map(([label, rows]) => profile(rows, dimension, label, label));
}

export function buildCurrentCyclePerformanceProfiles(items: CycleConversationItem[], anchor: Date = new Date()) {
  const cycle = getCycleForDate(anchor);
  const current = items.filter((item) => {
    const date = conversationDate(item);
    return Boolean(date && date >= cycle.start && date <= cycle.end);
  });

  return {
    cycle,
    branches: group(current, 'branch').sort((a, b) => (b.conversionRate ?? -1) - (a.conversionRate ?? -1) || b.eligibleSalesChats - a.eligibleSalesChats),
    doctors: group(current, 'doctor').sort((a, b) => (b.conversionRate ?? -1) - (a.conversionRate ?? -1) || b.eligibleSalesChats - a.eligibleSalesChats),
  };
}
