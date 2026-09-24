// Sales Intelligence QA Review UI — small presentational helpers built on top of labels.ts.
// Kept separate from labels.ts (pure string maps) because these return JSX badges.
import type { ReactNode } from 'react';
import {
  ambiguityStatusLabels,
  attributionLevelBadgeTone,
  caseTypeLabels,
  confidenceLevelLabels,
  contradictionCategoryLabels,
  failureReasonLabels,
  fieldMatchStatusLabels,
  historicalClosureBadgeTone,
  historicalClosureLabels,
  integrityScopeLabels,
  itemResolutionStatusLabels,
  labelOr,
  protocolApplicabilityLabels,
  protocolPolicyComplianceLabels,
  reviewReasonLabels,
  saleProofSourceLabels,
  saleProofStateLabels,
  ruleIdLabels,
  pipelineWarningLabels,
  productMatchLabelLabels,
} from './labels';

export function branchLabelFor(branch: string | null): string {
  return branch || 'غير محدد';
}

export function caseTypeLabelFor(value: string): string {
  return labelOr(caseTypeLabels, value);
}

export function historicalClosureLabelFor(value: string): string {
  return labelOr(historicalClosureLabels, value);
}

export function protocolApplicabilityLabelFor(value: string): string {
  return labelOr(protocolApplicabilityLabels, value);
}

export function attributionLevelLabelFor(value: string): string {
  return labelOr(confidenceLevelLabels, value);
}

export function fieldMatchLabelFor(value: string): string {
  return labelOr(fieldMatchStatusLabels, value);
}

export function protocolPolicyComplianceLabelFor(value: string): string {
  return labelOr(protocolPolicyComplianceLabels, value);
}

export function itemResolutionStatusLabelFor(value: string): string {
  return labelOr(itemResolutionStatusLabels, value);
}

export function ambiguityStatusLabelFor(value: string): string {
  return labelOr(ambiguityStatusLabels, value);
}

export function failureReasonLabelFor(value: string): string {
  return labelOr(failureReasonLabels, value);
}

export function fieldMatchBadge(value: string): ReactNode {
  const tone = value === 'exact' ? 'success' : value === 'near_match' || value === 'partial' ? 'warning' : value === 'mismatch' ? 'danger' : 'info';
  return <span className={badgeToneClass[tone]}>{fieldMatchLabelFor(value)}</span>;
}

export function reviewReasonLabelFor(value: string): string {
  return labelOr(reviewReasonLabels, value);
}

export function reviewReasonsSummary(reasons: string[]): string {
  if (!reasons.length) return 'لا توجد أسباب مسجّلة';
  return reasons.map(reviewReasonLabelFor).join(' • ');
}

const badgeToneClass: Record<'success' | 'warning' | 'danger' | 'info', string> = {
  success: 'dawaa-badge dawaa-badge--success',
  warning: 'dawaa-badge dawaa-badge--warning',
  danger: 'dawaa-badge dawaa-badge--danger',
  info: 'dawaa-badge dawaa-badge--info',
};

export function integrityScopeBadge(value: string): ReactNode {
  const tone = value === 'header_and_items' ? 'success' : value === 'header_only' ? 'info' : 'warning';
  return <span className={badgeToneClass[tone]}>{labelOr(integrityScopeLabels, value)}</span>;
}

export function historicalClosureBadge(value: string): ReactNode {
  return <span className={badgeToneClass[historicalClosureBadgeTone(value)]}>{historicalClosureLabelFor(value)}</span>;
}

export function attributionLevelBadge(value: string): ReactNode {
  return <span className={badgeToneClass[attributionLevelBadgeTone(value)]}>{attributionLevelLabelFor(value)}</span>;
}

// ---------------------------------------------------------------------------
// Final Pilot Readiness — I.C.2 canonical SaleProofState presentation.
// ---------------------------------------------------------------------------

export function saleProofStateLabelFor(value: string): string {
  return labelOr(saleProofStateLabels, value);
}

export function saleProofStateBadgeTone(value: string): 'success' | 'warning' | 'danger' | 'info' {
  if (value === 'proven') return 'success';
  if (value === 'strongly_supported') return 'info';
  if (value === 'weakly_supported') return 'warning';
  if (value === 'contradicted') return 'danger';
  return 'warning'; // unknown
}

export function saleProofStateBadge(value: string): ReactNode {
  return <span className={badgeToneClass[saleProofStateBadgeTone(value)]}>{saleProofStateLabelFor(value)}</span>;
}

export function contradictionCategoryLabelFor(value: string): string {
  return labelOr(contradictionCategoryLabels, value);
}

export function saleProofSourceLabelFor(value: string): string {
  return labelOr(saleProofSourceLabels, value);
}

/**
 * "لو state = contradicted اعرض السبب بشكل واضح، مش مجرد label" — turns the SaleProofAssessment's
 * own `contradictions` category list into a readable Arabic sentence list. Never invents a reason
 * beyond what deriveSaleProofState() itself already returned.
 */
export function contradictionReasonsList(contradictions: string[]): string[] {
  if (!contradictions.length) return ['تناقض غير مصنَّف — راجع سجل القواعد (ruleIds).'];
  return contradictions.map(contradictionCategoryLabelFor);
}

/**
 * "لو state = unknown وضح ليه: no candidate / insufficient evidence / no invoice in case window /
 * ambiguity" — derived purely from already-computed, already-persisted attribution facts (candidate
 * count, attribution level, raw attribution.contradictions) — never a new business decision.
 */
export function unknownProofReason(input: {
  candidateCount: number;
  attributionLevel: string;
  rawContradictions?: string[] | null;
}): string {
  if ((input.rawContradictions ?? []).includes('ambiguous_multiple_candidates')) {
    return 'يوجد أكثر من فاتورة مرشحة بدرجة تقارب واحدة دون ترجيح آلي آمن (التباس).';
  }
  if (input.candidateCount === 0) {
    return 'لا توجد أي فاتورة مرشحة ضمن نافذة الوقت الخاصة بهذه الحالة (لا يوجد مرشح إطلاقًا).';
  }
  if (input.attributionLevel === 'unknown') {
    return 'توجد فاتورة/فواتير مرشحة، لكن الأدلة (الهوية/الوقت/المبلغ) غير كافية لاعتماد أي منها.';
  }
  return 'أدلة غير كافية لتحديد حالة إثبات واضحة لهذه الحالة.';
}


export function ruleIdLabelFor(value: string): string {
  return ruleIdLabels[value] ?? 'قاعدة تحليل داخلية غير مسماة بالعربية';
}

export function pipelineWarningLabelFor(value: string): string {
  return pipelineWarningLabels[value] ?? 'تنبيه فني داخلي يحتاج مراجعة';
}

export function productMatchLabelFor(value: string): string {
  return productMatchLabelLabels[value] ?? 'مطابقة كتالوج';
}
