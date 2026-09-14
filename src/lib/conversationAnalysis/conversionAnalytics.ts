import type { FullConversationIntelligence } from './customerConversationIntelligence';

export type ConversionConversationItem = {
  id: string;
  label: string;
  branch?: string | null;
  staffName?: string | null;
  customerName?: string | null;
  intelligence: FullConversationIntelligence;
};

export type ConversionBreakdownRow = {
  key: string;
  label: string;
  conversations: number;
  eligible: number;
  converted: number;
  notConverted: number;
  excludedNonSales: number;
  excludedLowConfidence: number;
  conversionRate: number | null;
  coverageRate: number | null;
  avgConfidence: number | null;
};

export type ConversionAnalytics = {
  totalConversations: number;
  eligibleConversations: number;
  convertedConversations: number;
  notConvertedConversations: number;
  excludedNonSales: number;
  excludedLowConfidence: number;
  conversionRate: number | null;
  coverageRate: number | null;
  byBranch: ConversionBreakdownRow[];
  byDoctor: ConversionBreakdownRow[];
};

const MIN_CONVERSION_CONFIDENCE = 0.65;

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function normalized(value?: string | null) {
  return String(value || '').trim() || 'غير محدد';
}

export function classifyConversionEligibility(item: ConversionConversationItem) {
  const { intelligence } = item;
  const intents = new Set(intelligence.journey.customerIntent || []);
  const stages = new Set(intelligence.journey.stages.map((x) => x.stage));
  const hasCommercialIntent =
    intents.has('معرفة السعر') ||
    intents.has('معرفة التوفر') ||
    intents.has('طلب توصيل') ||
    intelligence.base.metrics.detectedOrders > 0 ||
    intelligence.base.metrics.detectedProductQuestions > 0 ||
    stages.has('availability_price') ||
    stages.has('order_confirmation') ||
    stages.has('delivery');

  const confidence = Number(intelligence.journey.conversionConfidence || 0);
  const lowConfidence = confidence < MIN_CONVERSION_CONFIDENCE;
  const converted = intelligence.journey.outcome === 'sold';

  return {
    salesEligible: hasCommercialIntent,
    counted: hasCommercialIntent && !lowConfidence,
    converted: hasCommercialIntent && !lowConfidence && converted,
    lowConfidence,
    confidence,
  };
}

function summarizeGroup(items: ConversionConversationItem[], key: string, label: string): ConversionBreakdownRow {
  const classified = items.map(classifyConversionEligibility);
  const eligible = classified.filter((x) => x.counted).length;
  const converted = classified.filter((x) => x.converted).length;
  const excludedNonSales = classified.filter((x) => !x.salesEligible).length;
  const excludedLowConfidence = classified.filter((x) => x.salesEligible && x.lowConfidence).length;
  const confidences = classified.filter((x) => x.counted).map((x) => x.confidence);
  return {
    key,
    label,
    conversations: items.length,
    eligible,
    converted,
    notConverted: Math.max(0, eligible - converted),
    excludedNonSales,
    excludedLowConfidence,
    conversionRate: eligible ? round1((converted / eligible) * 100) : null,
    coverageRate: items.length ? round1((eligible / items.length) * 100) : null,
    avgConfidence: confidences.length ? round1((confidences.reduce((a, b) => a + b, 0) / confidences.length) * 100) : null,
  };
}

function groupBy(items: ConversionConversationItem[], selector: (item: ConversionConversationItem) => string) {
  const map = new Map<string, ConversionConversationItem[]>();
  for (const item of items) {
    const key = selector(item);
    map.set(key, [...(map.get(key) || []), item]);
  }
  return map;
}

export function buildConversionAnalytics(items: ConversionConversationItem[]): ConversionAnalytics {
  const overall = summarizeGroup(items, 'all', 'الإجمالي');
  const byBranch = [...groupBy(items, (item) => normalized(item.branch)).entries()]
    .map(([label, rows]) => summarizeGroup(rows, label, label))
    .sort((a, b) => (b.conversionRate ?? -1) - (a.conversionRate ?? -1) || b.eligible - a.eligible);
  const byDoctor = [...groupBy(items, (item) => normalized(item.staffName)).entries()]
    .map(([label, rows]) => summarizeGroup(rows, label, label))
    .sort((a, b) => (b.conversionRate ?? -1) - (a.conversionRate ?? -1) || b.eligible - a.eligible);

  return {
    totalConversations: overall.conversations,
    eligibleConversations: overall.eligible,
    convertedConversations: overall.converted,
    notConvertedConversations: overall.notConverted,
    excludedNonSales: overall.excludedNonSales,
    excludedLowConfidence: overall.excludedLowConfidence,
    conversionRate: overall.conversionRate,
    coverageRate: overall.coverageRate,
    byBranch,
    byDoctor,
  };
}

export const CONVERSION_RULES = {
  minimumConfidence: MIN_CONVERSION_CONFIDENCE,
  denominator: 'المحادثات ذات نية شراء واضحة فقط وبعد استبعاد الحالات منخفضة الثقة',
  numerator: 'المحادثات التي ظهر فيها تأكيد بيع/طلب واضح',
  exclusions: ['الشكاوى والخدمة العامة بدون نية شراء', 'المحادثات غير الواضحة منخفضة الثقة'],
} as const;
