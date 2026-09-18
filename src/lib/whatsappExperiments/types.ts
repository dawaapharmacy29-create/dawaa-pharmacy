// أنواع مشتركة لصفحات تجارب مقارنة تقييم واتساب (Approach A / Approach B / Hybrid).
// هذا الملف عرض/تجميع فقط — مبيغيّرش في سلوك أي من الطريقتين نفسه.

export type ExperimentApproach = 'A' | 'B' | 'hybrid';

export interface ExperimentCommonCounts {
  filesRead: number;
  sessionsFound: number;
  created: number;
  skipped: number;
  duplicates: number;
  failed: number;
  pointsFailed: number;
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
  outcomeLabel: string | null;
  flags: string[];
  followupRequired: boolean | null;
  suggestedFollowupReason: string | null;
  invoiceMatchStatus: string | null;
  /** V4 unified-intelligence fields (medicalSafetyFlags/lostSales/executiveSummary) that
   * WhatsAppReviewQueueV4.tsx is designed to show, but the real ingest pipeline stores
   * "smart-summary-v1" shape instead — these stay empty here for the same reason they're
   * empty on the real queue page today. Kept visible so the gap isn't hidden. */
  v4FieldsPopulated: boolean;
  error?: string;
}

export interface ApproachBResultDetail {
  status: 'saved' | 'skipped_no_staff' | 'skipped_existing' | 'failed';
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
  suspicions: string[];
  duplicatePrevented: boolean;
  error?: string;
}

export interface ExperimentFileLogEntry {
  fileName: string;
  at: string;
  durationMs: number;
  counts: ExperimentCommonCounts;
  approachA?: ApproachAResultDetail[];
  approachB?: ApproachBResultDetail[];
  errors: string[];
}
