// أنواع مشتركة لصفحات تجارب مقارنة تقييم واتساب (Approach A / Approach B / Hybrid).

export type ExperimentApproach = 'A' | 'B' | 'hybrid';
export type ExperimentRunMode = 'dry-run' | 'live';

export interface ExperimentCommonCounts {
  filesRead: number;
  sessionsFound: number;
  previewed: number;
  created: number;
  skipped: number;
  duplicates: number;
  failed: number;
  pointsFailed: number;
}

export interface ExperimentMessageSnapshot {
  id: string;
  timestamp: string;
  rawTimestamp: string;
  sender: string;
  direction: 'inbound' | 'outbound' | 'system';
  kind: string;
  text: string;
}

export interface ExperimentSessionSnapshot {
  sessionId: string;
  customerName: string | null;
  doctors: string[];
  participants: string[];
  startedAt: string;
  endedAt: string;
  messageCount: number;
  mediaCount: number;
  missingMediaCount: number;
  messages: ExperimentMessageSnapshot[];
}

export interface ApproachAResultDetail {
  sourceId: string | null;
  sourceHash: string;
  duplicate: boolean;
  analysisStatus: string | null;
  reviewStatus: string | null;
  priority: string | null;
  confidence: number | null;
  primaryTypeLabel: string | null;
  journey: string[];
  finalIntent?: string | null;
  outcomeLabel: string | null;
  flags: string[];
  followupRequired: boolean | null;
  suggestedFollowupReason: string | null;
  invoiceMatchStatus: string | null;
  firstResponseSeconds?: number | null;
  longestWaitSeconds?: number | null;
  unansweredInboundCount?: number | null;
  lastOwner?: string | null;
  lastMeaningfulMessage?: string | null;
  v4FieldsPopulated: boolean;
  error?: string;
}

export interface ApproachBCriterionDetail {
  key: string;
  label: string;
  maxPoints: number;
  status: 'assessed' | 'not_applicable' | 'review_required';
  selectedLabel: string;
  pointsEarned: number | null;
  confidence: number;
  reason: string;
  source: 'signal' | 'default_fallback';
  evidenceMessageIds: string[];
}

export interface ApproachBResultDetail {
  status: 'preview' | 'saved' | 'skipped_no_staff' | 'skipped_existing' | 'failed';
  reviewId: string | null;
  finalScore: number | null;
  level?: string | null;
  doctorPointsImpact: number;
  impactStatus: 'approved' | 'pending' | null;
  pointsRecorded: boolean;
  pointsError: string | null;
  hasSevereError: boolean;
  evaluationKind: 'automatic';
  reviewerDisplay: string;
  signalResolvedCount?: number;
  defaultFallbackCount?: number;
  coveragePercent?: number | null;
  reviewRequiredCount?: number | null;
  notApplicableCount?: number | null;
  criteria?: ApproachBCriterionDetail[];
  suspicions: string[];
  duplicatePrevented: boolean;
  error?: string;
}

export interface ExperimentFileLogEntry {
  fileName: string;
  at: string;
  runMode: ExperimentRunMode;
  durationMs: number;
  counts: ExperimentCommonCounts;
  sessions?: ExperimentSessionSnapshot[];
  approachA?: ApproachAResultDetail[];
  approachB?: ApproachBResultDetail[];
  errors: string[];
}
