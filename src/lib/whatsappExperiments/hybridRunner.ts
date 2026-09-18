// Runner لصفحة تجربة "Hybrid A+B" — بيشغّل بالظبط نفس مسار الإنتاج الحالي
// (ingestWhatsAppExportFile من غير أي تعديل في الخيارات)، يعني A ثم B تلقائيًا
// بالتتابع زي ما بيحصل فعليًا من صفحة "المراقبة التلقائية للفولدر" في الإنتاج.
// بعد التشغيل، بيقرأ نتائج الطريقتين (قراءة فقط) عشان يعرضهم في قسمين منفصلين.
import { supabase } from '@/lib/supabase';
import { readWhatsAppExportFile } from '@/lib/whatsappExportFileReader';
import { parseWhatsAppExport, splitWhatsAppSessions } from '@/lib/whatsappConversationParser';
import { hashWhatsAppSession } from '@/lib/whatsappReviewPersistenceV4';
import { ingestWhatsAppExportFile } from '@/lib/whatsappAutoIngestPipeline';
import { isAutomaticReview, reviewerDisplayName } from '@/lib/conversationReviews';
import type { ApproachAResultDetail, ApproachBResultDetail, ExperimentFileLogEntry } from './types';

interface SourceRow {
  id: string;
  source_hash: string;
  analysis_status: string | null;
  review_status: string | null;
  priority: string | null;
  analysis_confidence: number | null;
  followup_required: boolean | null;
  suggested_followup_reason: string | null;
  invoice_match_status: string | null;
  analysis_json: any;
}

interface ReviewRow {
  id: string;
  whatsapp_review_source_id: string | null;
  final_score: number | null;
  level: string | null;
  doctor_points_impact: number | null;
  impact_status: string | null;
  evaluation_kind: string | null;
  reviewer_name: string | null;
  has_critical_error: boolean | null;
  has_medical_error: boolean | null;
}

function toApproachADetail(row: SourceRow | undefined, hash: string, duplicate: boolean): ApproachAResultDetail {
  const summary = row?.analysis_json || {};
  return {
    sourceId: row?.id || null,
    sourceHash: hash,
    duplicate,
    analysisStatus: row?.analysis_status ?? null,
    reviewStatus: row?.review_status ?? null,
    priority: row?.priority ?? null,
    confidence: row?.analysis_confidence ?? null,
    primaryTypeLabel: summary.primaryTypeLabel || null,
    journey: Array.isArray(summary.journey) ? summary.journey : [],
    outcomeLabel: summary.outcomeLabel || null,
    flags: Array.isArray(summary.flags) ? summary.flags : [],
    followupRequired: row?.followup_required ?? null,
    suggestedFollowupReason: row?.suggested_followup_reason ?? null,
    invoiceMatchStatus: row?.invoice_match_status ?? null,
    v4FieldsPopulated: Array.isArray(summary.medicalSafetyFlags) || Array.isArray(summary.lostSales),
    error: row ? undefined : 'تعذر إيجاد صف whatsapp_review_sources الناتج للعرض.',
  };
}

function toApproachBDetail(row: ReviewRow | undefined): ApproachBResultDetail {
  if (!row) {
    return {
      status: 'failed',
      reviewId: null,
      finalScore: null,
      doctorPointsImpact: 0,
      impactStatus: null,
      pointsRecorded: false,
      pointsError: null,
      hasSevereError: false,
      evaluationKind: 'automatic',
      reviewerDisplay: reviewerDisplayName({ evaluation_kind: 'automatic' }),
      suspicions: [],
      duplicatePrevented: false,
      error: 'لم يتم إنشاء تقييم آلي مرتبط لهذه الجلسة (راجع أخطاء التشغيل).',
    };
  }
  return {
    status: 'saved',
    reviewId: row.id,
    finalScore: row.final_score,
    level: row.level,
    doctorPointsImpact: row.doctor_points_impact ?? 0,
    impactStatus: (row.impact_status as 'approved' | 'pending' | null) ?? null,
    pointsRecorded: row.impact_status === 'approved',
    pointsError: null,
    hasSevereError: Boolean(row.has_critical_error || row.has_medical_error),
    evaluationKind: 'automatic',
    reviewerDisplay: isAutomaticReview({ evaluation_kind: row.evaluation_kind }) ? reviewerDisplayName({ evaluation_kind: row.evaluation_kind }) : String(row.reviewer_name || '-'),
    suspicions: [],
    duplicatePrevented: false,
  };
}

export async function runHybridExperiment(file: File): Promise<ExperimentFileLogEntry> {
  const startedAt = performance.now();
  const errors: string[] = [];
  let hashes: string[] = [];
  let preExistingHashes = new Set<string>();

  try {
    const source = await readWhatsAppExportFile(file);
    const messages = parseWhatsAppExport(source.text);
    const sessions = splitWhatsAppSessions(messages, 120);
    hashes = await Promise.all(sessions.map((session) => hashWhatsAppSession(session)));
    if (hashes.length) {
      const { data } = await supabase.from('whatsapp_review_sources').select('source_hash').in('source_hash', hashes);
      preExistingHashes = new Set((data || []).map((row) => String(row.source_hash)));
    }
  } catch (e) {
    errors.push(e instanceof Error ? `تعذر تحضير الملف للعرض: ${e.message}` : 'خطأ غير معروف أثناء تحضير الملف');
  }

  const result = await ingestWhatsAppExportFile(file);

  let sourceRows: SourceRow[] = [];
  if (hashes.length) {
    const { data, error } = await supabase
      .from('whatsapp_review_sources')
      .select(
        'id,source_hash,analysis_status,review_status,priority,analysis_confidence,followup_required,suggested_followup_reason,invoice_match_status,analysis_json'
      )
      .in('source_hash', hashes);
    if (error) errors.push(`تعذر قراءة نتائج whatsapp_review_sources للعرض: ${error.message}`);
    else sourceRows = (data || []) as SourceRow[];
  }

  const sourceIds = sourceRows.map((row) => row.id);
  let reviewRows: ReviewRow[] = [];
  if (sourceIds.length) {
    const { data, error } = await supabase
      .from('conversation_sales_reviews')
      .select('id,whatsapp_review_source_id,final_score,level,doctor_points_impact,impact_status,evaluation_kind,reviewer_name,has_critical_error,has_medical_error')
      .in('whatsapp_review_source_id', sourceIds);
    if (error) errors.push(`تعذر قراءة نتائج conversation_sales_reviews للعرض: ${error.message}`);
    else reviewRows = (data || []) as ReviewRow[];
  }

  const sourceByHash = new Map(sourceRows.map((row) => [row.source_hash, row]));
  const reviewBySourceId = new Map(reviewRows.map((row) => [row.whatsapp_review_source_id, row]));

  const approachA = hashes.map((hash) => toApproachADetail(sourceByHash.get(hash), hash, preExistingHashes.has(hash)));
  const approachB = hashes.map((hash) => {
    const source = sourceByHash.get(hash);
    return toApproachBDetail(source ? reviewBySourceId.get(source.id) : undefined);
  });

  const durationMs = performance.now() - startedAt;
  return {
    fileName: file.name,
    at: new Date().toLocaleTimeString('ar-EG'),
    durationMs,
    counts: {
      filesRead: 1,
      sessionsFound: result.sessionsFound,
      created: result.sessionsSaved,
      skipped: result.autoReviewsSkipped,
      duplicates: result.sessionsDuplicate,
      failed: result.errors.length,
      pointsFailed: result.autoReviewsPointsFailed,
    },
    approachA,
    approachB,
    errors: [...errors, ...result.errors],
  };
}
