// Runner لصفحة تجربة "Approach B" وحدها.
// Dry Run افتراضي: parser + محرك التقييم الرسمي نفسه، بدون أي DB write/RPC/notification.
// Live Run: يستخدم أقل linking source ممكن ثم persistence الحقيقي.
import { supabase } from '@/lib/supabase';
import { readWhatsAppExportFile } from '@/lib/whatsappExportFileReader';
import { parseWhatsAppExport, splitWhatsAppSessions, type WhatsAppConversationSession } from '@/lib/whatsappConversationParser';
import { hashWhatsAppSession } from '@/lib/whatsappReviewPersistenceV4';
import { persistAutomaticWhatsAppReview } from '@/lib/whatsappAutomaticReviewPersistence';
import { evaluateAutomaticWhatsAppReview } from '@/lib/whatsappAutomaticReviewScoring';
import { getCycleForDate } from '@/lib/pharmacy-cycle';
import { AUTOMATIC_REVIEW_REVIEWER_LABEL } from '@/lib/conversationReviews';
import type { ApproachBResultDetail, ExperimentFileLogEntry, ExperimentRunMode } from './types';

const MINIMAL_LINK_PARSER_VERSION = 'approach-b-standalone-experiment-v1';

async function ensureMinimalLinkingSource(session: WhatsAppConversationSession, sourceFileName: string) {
  const sourceHash = await hashWhatsAppSession(session);
  const { data: existing, error: existingError } = await supabase
    .from('whatsapp_review_sources')
    .select('id')
    .eq('source_hash', sourceHash)
    .maybeSingle();
  if (existingError && existingError.code !== 'PGRST116') throw existingError;
  if (existing?.id) return { sourceId: String(existing.id), preExisting: true };

  const { data, error } = await supabase
    .from('whatsapp_review_sources')
    .insert({
      source_hash: sourceHash,
      source_type: 'whatsapp_export_experiment_b',
      source_filename: sourceFileName,
      staff_name: session.outboundStaffNames[0] || null,
      customer_name: session.customerName,
      conversation_started_at: session.startedAt.toISOString(),
      conversation_ended_at: session.endedAt.toISOString(),
      message_count: session.messages.length,
      parser_version: MINIMAL_LINK_PARSER_VERSION,
      analysis_version: 'none',
      analysis_status: 'skipped',
      review_status: 'archived',
      priority: 'normal',
    })
    .select('id')
    .single();
  if (error) {
    if (error.code === '23505') {
      const { data: dupe, error: dupeError } = await supabase
        .from('whatsapp_review_sources')
        .select('id')
        .eq('source_hash', sourceHash)
        .single();
      if (dupeError) throw dupeError;
      return { sourceId: String(dupe.id), preExisting: true };
    }
    throw error;
  }
  return { sourceId: String(data.id), preExisting: false };
}

function toApproachBDetail(
  outcome: Awaited<ReturnType<typeof persistAutomaticWhatsAppReview>>
): ApproachBResultDetail {
  return {
    status: outcome.status,
    reviewId: outcome.reviewId,
    finalScore: outcome.finalScore,
    doctorPointsImpact: outcome.pointsImpact,
    impactStatus: outcome.pointsImpact !== 0 ? 'pending' : 'approved',
    pointsRecorded: outcome.pointsRecorded,
    pointsError: outcome.pointsError,
    hasSevereError: false,
    evaluationKind: 'automatic',
    reviewerDisplay: AUTOMATIC_REVIEW_REVIEWER_LABEL,
    suspicions: outcome.suspicions,
    duplicatePrevented: outcome.status === 'skipped_existing',
    error: outcome.error || undefined,
  };
}

async function runApproachBDry(file: File): Promise<ExperimentFileLogEntry> {
  const startedAt = performance.now();
  const errors: string[] = [];
  const approachB: ApproachBResultDetail[] = [];
  let sessionsFound = 0;

  try {
    const source = await readWhatsAppExportFile(file);
    const messages = parseWhatsAppExport(source.text);
    if (!messages.length) errors.push('لم يتم التعرف على رسائل WhatsApp داخل الملف.');
    const sessions = splitWhatsAppSessions(messages, 120);
    sessionsFound = sessions.length;

    for (const session of sessions) {
      try {
        const { build, result } = evaluateAutomaticWhatsAppReview(session, session.customerName);
        approachB.push({
          status: 'preview',
          reviewId: null,
          finalScore: result.finalScore,
          level: result.level,
          doctorPointsImpact: result.doctorPointsImpact,
          impactStatus: result.doctorPointsImpact !== 0 ? 'pending' : 'approved',
          pointsRecorded: false,
          pointsError: null,
          hasSevereError: result.hasSevereError,
          evaluationKind: 'automatic',
          reviewerDisplay: AUTOMATIC_REVIEW_REVIEWER_LABEL,
          signalResolvedCount: build.signalResolvedCount,
          defaultFallbackCount: build.defaultFallbackCount,
          suspicions: build.suspicions.map((s) => `${s.key}: "${s.evidenceQuote}"`),
          duplicatePrevented: false,
        });
      } catch (e) {
        errors.push(e instanceof Error ? `جلسة ${session.id}: ${e.message}` : `جلسة ${session.id}: خطأ غير معروف`);
      }
    }
  } catch (e) {
    errors.push(e instanceof Error ? e.message : 'خطأ غير معروف أثناء Dry Run لـ Approach B');
  }

  return {
    fileName: file.name,
    at: new Date().toLocaleTimeString('ar-EG'),
    runMode: 'dry-run',
    durationMs: performance.now() - startedAt,
    counts: {
      filesRead: 1,
      sessionsFound,
      previewed: approachB.length,
      created: 0,
      skipped: 0,
      duplicates: 0,
      failed: errors.length,
      pointsFailed: 0,
    },
    approachB,
    errors,
  };
}

async function runApproachBLive(file: File): Promise<ExperimentFileLogEntry> {
  const startedAt = performance.now();
  const errors: string[] = [];
  const approachB: ApproachBResultDetail[] = [];
  let sessionsFound = 0;

  try {
    const source = await readWhatsAppExportFile(file);
    const messages = parseWhatsAppExport(source.text);
    if (!messages.length) errors.push('لم يتم التعرف على رسائل WhatsApp داخل الملف.');
    const sessions = splitWhatsAppSessions(messages, 120);
    sessionsFound = sessions.length;

    for (const session of sessions) {
      try {
        const { sourceId } = await ensureMinimalLinkingSource(session, source.sourceFileName);
        const outcome = await persistAutomaticWhatsAppReview({
          sourceId,
          session,
          branch: null,
          customerId: null,
          customerCode: null,
          customerName: session.customerName,
          customerPhone: null,
          staffName: session.outboundStaffNames[0] || null,
          reviewCycle: getCycleForDate(session.startedAt),
        });
        approachB.push(toApproachBDetail(outcome));
        if (outcome.error) errors.push(`جلسة ${session.id}: ${outcome.error}`);
      } catch (e) {
        errors.push(e instanceof Error ? `جلسة ${session.id}: ${e.message}` : `جلسة ${session.id}: خطأ غير معروف`);
      }
    }
  } catch (e) {
    errors.push(e instanceof Error ? e.message : 'خطأ غير معروف أثناء تشغيل تجربة Approach B');
  }

  return {
    fileName: file.name,
    at: new Date().toLocaleTimeString('ar-EG'),
    runMode: 'live',
    durationMs: performance.now() - startedAt,
    counts: {
      filesRead: 1,
      sessionsFound,
      previewed: 0,
      created: approachB.filter((r) => r.status === 'saved').length,
      skipped: approachB.filter((r) => r.status === 'skipped_no_staff').length,
      duplicates: approachB.filter((r) => r.duplicatePrevented).length,
      failed: approachB.filter((r) => r.status === 'failed').length,
      pointsFailed: approachB.filter((r) => Boolean(r.pointsError)).length,
    },
    approachB,
    errors,
  };
}

export async function runApproachBExperiment(
  file: File,
  mode: ExperimentRunMode = 'dry-run'
): Promise<ExperimentFileLogEntry> {
  return mode === 'live' ? runApproachBLive(file) : runApproachBDry(file);
}
