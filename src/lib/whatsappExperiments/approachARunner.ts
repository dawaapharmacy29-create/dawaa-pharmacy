// Runner لصفحة تجربة "Approach A".
// الوضع الافتراضي Dry Run: parsing + smart-summary الحقيقي فقط، بدون أي كتابة DB.
// Live Run: يشغّل ingest الحقيقي مع runApproachB=false لعزل A عن B.
import { supabase } from '@/lib/supabase';
import { readWhatsAppExportFile } from '@/lib/whatsappExportFileReader';
import { parseWhatsAppExport, splitWhatsAppSessions } from '@/lib/whatsappConversationParser';
import { hashWhatsAppSession } from '@/lib/whatsappReviewPersistenceV4';
import { buildSmartConversationReviewSummary } from '@/lib/whatsappSmartReviewSummary';
import { ingestWhatsAppExportFile, type IngestOneFileResult } from '@/lib/whatsappAutoIngestPipeline';
import { analyzeSmartConversationIntelligence, type SmartConversationIntelligenceResult } from './smartConversationIntelligence';
import type {
  ApproachAResultDetail,
  ExperimentFileLogEntry,
  ExperimentRunMode,
} from './types';

async function safeAnalyzeSmart(session: Parameters<typeof analyzeSmartConversationIntelligence>[0]) {
  try {
    return await analyzeSmartConversationIntelligence(session);
  } catch {
    return null;
  }
}

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

async function runApproachADry(file: File): Promise<ExperimentFileLogEntry> {
  const startedAt = performance.now();
  const errors: string[] = [];
  const details: ApproachAResultDetail[] = [];
  const smartIntelligence: SmartConversationIntelligenceResult[] = [];
  let sessionsFound = 0;

  try {
    const source = await readWhatsAppExportFile(file);
    const messages = parseWhatsAppExport(source.text);
    if (!messages.length) errors.push('لم يتم التعرف على رسائل WhatsApp داخل الملف.');
    const sessions = splitWhatsAppSessions(messages, 120);
    sessionsFound = sessions.length;

    for (const session of sessions) {
      const hash = await hashWhatsAppSession(session);
      const summary = buildSmartConversationReviewSummary(session);
      const smart = await safeAnalyzeSmart(session);
      if (smart) smartIntelligence.push(smart);
      details.push({
        sourceId: null,
        sourceHash: hash,
        duplicate: false,
        analysisStatus: 'preview',
        reviewStatus: 'preview',
        priority: summary.outcome === 'sale_intent' ? 'important' : 'normal',
        confidence: summary.confidence,
        primaryTypeLabel: summary.primaryTypeLabel || null,
        journey: Array.isArray(summary.journey) ? summary.journey : [],
        outcomeLabel: summary.outcomeLabel || null,
        flags: Array.isArray(summary.flags) ? summary.flags : [],
        followupRequired: summary.flags.length > 0,
        suggestedFollowupReason: summary.flags.join('، ') || null,
        invoiceMatchStatus: 'skipped_dry_run',
        v4FieldsPopulated: false,
      });
    }
  } catch (e) {
    errors.push(e instanceof Error ? e.message : 'خطأ غير معروف أثناء Dry Run لـ Approach A');
  }

  return {
    fileName: file.name,
    at: new Date().toLocaleTimeString('ar-EG'),
    runMode: 'dry-run',
    durationMs: performance.now() - startedAt,
    counts: {
      filesRead: 1,
      sessionsFound,
      previewed: details.length,
      created: 0,
      skipped: 0,
      duplicates: 0,
      failed: errors.length,
      pointsFailed: 0,
    },
    approachA: details,
    smartIntelligence,
    errors,
  };
}

async function runApproachALive(file: File): Promise<ExperimentFileLogEntry> {
  const startedAt = performance.now();
  const errors: string[] = [];
  let result: IngestOneFileResult;
  let hashes: string[] = [];
  let preExistingHashes = new Set<string>();
  const smartIntelligence: SmartConversationIntelligenceResult[] = [];

  try {
    const source = await readWhatsAppExportFile(file);
    const messages = parseWhatsAppExport(source.text);
    const sessions = splitWhatsAppSessions(messages, 120);
    hashes = await Promise.all(sessions.map((session) => hashWhatsAppSession(session)));
    for (const session of sessions) {
      const smart = await safeAnalyzeSmart(session);
      if (smart) smartIntelligence.push(smart);
    }
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
    return {
      fileName: file.name,
      at: new Date().toLocaleTimeString('ar-EG'),
      runMode: 'live',
      durationMs: performance.now() - startedAt,
      counts: {
        filesRead: 1,
        sessionsFound: hashes.length,
        previewed: 0,
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

  return {
    fileName: file.name,
    at: new Date().toLocaleTimeString('ar-EG'),
    runMode: 'live',
    durationMs: performance.now() - startedAt,
    counts: {
      filesRead: 1,
      sessionsFound: result.sessionsFound,
      previewed: 0,
      created: result.sessionsSaved,
      skipped: 0,
      duplicates: result.sessionsDuplicate,
      failed: result.errors.length,
      pointsFailed: 0,
    },
    approachA,
    smartIntelligence,
    errors: [...errors, ...result.errors],
  };
}

export async function runApproachAExperiment(
  file: File,
  mode: ExperimentRunMode = 'dry-run'
): Promise<ExperimentFileLogEntry> {
  return mode === 'live' ? runApproachALive(file) : runApproachADry(file);
}
