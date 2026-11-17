import {
  classifyConversationReview,
  conversationReviewScore100,
  OFFICIAL_REVIEW_COLUMNS,
} from '@/lib/evaluations/officialConversationReview';

export interface CaseEvaluationSummary {
  reviewId: string;
  staffName: string;
  automaticScore: number | null;
  officialScore: number | null;
  official: boolean;
  corrected: boolean;
  evidenceCoverage: number | null;
  reliability: number | null;
  clinicalReviewRequired: boolean;
}

const COLUMNS = [...new Set([
  ...OFFICIAL_REVIEW_COLUMNS, 'id', 'staff_name', 'staff_id',
  'whatsapp_review_source_id', 'sales_intelligence_case_id',
  'evidence_coverage_percent', 'automatic_reliability_percent',
  'manual_clinical_review_required',
])].join(',');

/** Saved scores only. Never rerun the analyzer or average different doctors/cases here. */
export async function loadCaseEvaluationSummaries(
  client: any,
  sourceId: string,
  caseId: string,
): Promise<CaseEvaluationSummary[]> {
  const { data, error } = await client.from('conversation_sales_reviews_canonical_v2')
    .select(COLUMNS)
    .eq('whatsapp_review_source_id', sourceId)
    .eq('sales_intelligence_case_id', caseId)
    .eq('is_current', true)
    .order('id', { ascending: true })
    .limit(21);
  if (error) throw new Error('تعذر تحميل التقييم المحفوظ. حاول مرة أخرى.');
  if (!Array.isArray(data) || data.length > 20) throw new Error('تعذر التحقق من سجلات تقييم هذه الحالة.');
  const seen = new Set<string>();
  return data.flatMap((row) => {
    if (row.whatsapp_review_source_id !== sourceId || row.sales_intelligence_case_id !== caseId) {
      throw new Error('سجل التقييم لا يخص الحالة المحددة.');
    }
    const state = classifyConversationReview(row);
    if (state === 'superseded' || state === 'rejected_or_reversed') return [];
    const staffId = String(row.staff_id ?? '');
    if (!staffId || seen.has(staffId)) throw new Error('هوية مشارك أو نسخة تقييمه تحتاج مراجعة.');
    seen.add(staffId);
    const automatic = row.evaluation_kind === 'automatic';
    const score = conversationReviewScore100(row);
    return [{
      reviewId: String(row.id),
      staffName: String(row.staff_name || 'مشارك غير مسمى'),
      automaticScore: automatic ? score : null,
      officialScore: state === 'official' ? score : null,
      official: state === 'official',
      corrected: row.evaluation_kind === 'manager_correction',
      evidenceCoverage: automatic ? conversationReviewScore100({ final_score: row.evidence_coverage_percent }) : null,
      reliability: automatic ? conversationReviewScore100({ final_score: row.automatic_reliability_percent }) : null,
      clinicalReviewRequired: row.manual_clinical_review_required === true,
    }];
  });
}
