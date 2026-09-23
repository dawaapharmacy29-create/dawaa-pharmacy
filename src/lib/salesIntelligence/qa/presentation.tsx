// Sales Intelligence QA Review UI — small presentational helpers built on top of labels.ts.
// Kept separate from labels.ts (pure string maps) because these return JSX badges.
import type { ReactNode } from 'react';
import {
  ambiguityStatusLabels,
  attributionLevelBadgeTone,
  caseTypeLabels,
  confidenceLevelLabels,
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
