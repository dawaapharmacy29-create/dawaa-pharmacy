// Runner لصفحة تجربة "Approach A" — بيشغّل مسار الاستيراد التلقائي الحقيقي بالظبط
// (ingestWhatsAppExportFile) لكن بعلم runApproachB=false عشان يضمن إن التقييم الآلي
// (Approach B) ما يتفعلش خالص. بعد التشغيل، بيقرأ صفوف whatsapp_review_sources اللي
// اتعملت/اتلاقت عشان يعرض تفاصيلها — قراءة فقط، مفيش أي تغيير في منطق A.
import { supabase } from '@/lib/supabase';
import { readWhatsAppExportFile } from '@/lib/whatsappExportFileReader';
import { parseWhatsAppExport, splitWhatsAppSessions } from '@/lib/whatsappConversationParser';
import { hashWhatsAppSession } from '@/lib/whatsappReviewPersistenceV4';
import { ingestWhatsAppExportFile, type IngestOneFileResult } from '@/lib/whatsappAutoIngestPipeline';
import type { ApproachAResultDetail, ExperimentFileLogEntry } from './types';

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

function toApproachADetail(row: SourceRow | undefined, hash: string, duplicate: boolean): ApproachAResultDetail {
  if (!row) {
    return {
      sourceId: null,
      sourceHash: hash,
      duplicate,
      analysisStatus: null,
      reviewStatus: null,
      priority: null,
      confidence: null,
      primaryTypeLabel: null,
      journey: [],
      outcomeLabel: null,
      flags: [],
      followupRequired: null,
      suggestedFollowupReason: null,
      invoiceMatchStatus: null,
      v4FieldsPopulated: false,
      error: 'تعذر إيجاد صف whatsapp_review_sources الناتج للعرض (تمت المعالجة لكن القراءة الاسترجاعية فشلت).',
    };
  }
  const summary = row.analysis_json || {};
  const hasV4Fields = Array.isArray(summary.medicalSafetyFlags) || Array.isArray(summary.lostSales);
  return {
    sourceId: row.id,
    sourceHash: hash,
    duplicate,
    analysisStatus: row.analysis_status,
    reviewStatus: row.review_status,
    priority: row.priority,
    confidence: row.analysis_confidence,
    primaryTypeLabel: summary.primaryTypeLabel || null,
    journey: Array.isArray(summary.journey) ? summary.journey : [],
    outcomeLabel: summary.outcomeLabel || null,
    flags: Array.isArray(summary.flags) ? summary.flags : [],
    followupRequired: row.followup_required,
    suggestedFollowupReason: row.suggested_followup_reason,
    invoiceMatchStatus: row.invoice_match_status,
    v4FieldsPopulated: hasV4Fields,
  };
}

export async function runApproachAExperiment(file: File): Promise<ExperimentFileLogEntry> {
  const startedAt = performance.now();
  const errors: string[] = [];
  let result: IngestOneFileResult;
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

  try {
    result = await ingestWhatsAppExportFile(file, { runApproachB: false });
  } catch (e) {
    const durationMs = performance.now() - startedAt;
    return {
      fileName: file.name,
      at: new Date().toLocaleTimeString('ar-EG'),
      durationMs,
      counts: {
        filesRead: 1,
        sessionsFound: hashes.length,
        created: 0,
        skipped: 0,
        duplicates: 0,
        failed: 1,
        pointsFailed: 0,
      },
      approachA: [],
      errors: [...errors, e instanceof Error ? e.message : 'فشل تشغيل Approach A'],
    };
  }

  let rows: SourceRow[] = [];
  if (hashes.length) {
    const { data, error } = await supabase
      .from('whatsapp_review_sources')
      .select(
        'id,source_hash,analysis_status,review_status,priority,analysis_confidence,followup_required,suggested_followup_reason,invoice_match_status,analysis_json'
      )
      .in('source_hash', hashes);
    if (error) errors.push(`تعذر قراءة نتائج whatsapp_review_sources للعرض: ${error.message}`);
    else rows = (data || []) as SourceRow[];
  }

  const byHash = new Map(rows.map((row) => [row.source_hash, row]));
  const approachA = hashes.map((hash) => toApproachADetail(byHash.get(hash), hash, preExistingHashes.has(hash)));

  const durationMs = performance.now() - startedAt;
  return {
    fileName: file.name,
    at: new Date().toLocaleTimeString('ar-EG'),
    durationMs,
    counts: {
      filesRead: 1,
      sessionsFound: result.sessionsFound,
      created: result.sessionsSaved,
      skipped: 0,
      duplicates: result.sessionsDuplicate,
      failed: result.errors.length,
      pointsFailed: 0,
    },
    approachA,
    errors: [...errors, ...result.errors],
  };
}
