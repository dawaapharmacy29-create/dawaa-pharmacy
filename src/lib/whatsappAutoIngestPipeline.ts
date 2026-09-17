import { supabase } from '@/lib/supabase';
import { readWhatsAppExportFile } from '@/lib/whatsappExportFileReader';
import { parseWhatsAppExport, splitWhatsAppSessions, type WhatsAppConversationSession } from '@/lib/whatsappConversationParser';
import { buildSmartConversationReviewSummary } from '@/lib/whatsappSmartReviewSummary';
import { detectFollowupSignals } from '@/lib/whatsappFollowupSignalDetector';
import { hashWhatsAppSession } from '@/lib/whatsappReviewPersistenceV4';

export interface IngestOneFileResult {
  fileName: string;
  sessionsFound: number;
  sessionsSaved: number;
  sessionsDuplicate: number;
  followupsCreated: number;
  errors: string[];
}

async function resolveBranchForStaff(staffName: string | null): Promise<string | null> {
  if (!staffName) return null;
  const cleaned = staffName.replace(/من صيدليات دواء.*$/i, '').replace(/[🥼✨💚🌷😊🙏]/g, '').trim();
  if (!cleaned) return null;
  const { data } = await supabase.from('staff').select('branch').ilike('name', `%${cleaned}%`).eq('active', true).limit(1).maybeSingle();
  return data?.branch || null;
}

async function saveSessionReview(session: WhatsAppConversationSession, sourceFileName: string, innerFileName: string | null) {
  const sourceHash = await hashWhatsAppSession(session);
  const { data: existing, error: existingError } = await supabase
    .from('whatsapp_review_sources')
    .select('id')
    .eq('source_hash', sourceHash)
    .maybeSingle();
  if (existingError && existingError.code !== 'PGRST116') throw existingError;
  if (existing?.id) return { duplicate: true as const };

  const summary = buildSmartConversationReviewSummary(session);
  const staffName = session.outboundStaffNames[0] || null;
  const branch = await resolveBranchForStaff(staffName);

  const { error } = await supabase.from('whatsapp_review_sources').insert({
    source_hash: sourceHash,
    source_type: 'whatsapp_export_auto',
    source_filename: sourceFileName,
    inner_filename: innerFileName,
    branch,
    customer_name: session.customerName,
    staff_name: staffName,
    conversation_started_at: session.startedAt.toISOString(),
    conversation_ended_at: session.endedAt.toISOString(),
    message_count: session.messages.length,
    parser_version: 'whatsapp-auto-ingest-v1',
    analysis_version: 'smart-summary-v1',
    analysis_status: 'analyzed',
    review_status: summary.confidence < 60 ? 'needs_context' : 'ready_quick',
    priority: summary.outcome === 'sale_intent' ? 'important' : 'normal',
    analysis_confidence: summary.confidence,
    commercial_eligible: summary.outcome === 'sale_intent',
    followup_required: summary.flags.length > 0,
    suggested_followup_reason: summary.flags.join('، ') || null,
    analysis_json: JSON.parse(JSON.stringify(summary)),
  });
  if (error && error.code !== '23505') throw error;
  return { duplicate: false as const, summary, branch };
}

async function saveFollowupSignals(session: WhatsAppConversationSession, sourceFileName: string, branch: string | null) {
  const signals = detectFollowupSignals(session);
  if (!signals.length) return 0;
  const rows = signals.map((s) => ({
    source_file_name: sourceFileName,
    conversation_session_id: session.id,
    branch,
    doctor_name: session.outboundStaffNames[0] || null,
    customer_name: session.customerName || 'غير معروف',
    signal_type: s.signalType,
    signal_type_label: s.signalTypeLabel,
    evidence_quote: s.evidenceQuote,
    evidence_timestamp: s.evidenceTimestamp.toISOString(),
    requested_product_name: s.requestedProductName || null,
    alternative_offered: s.alternativeOffered ?? null,
    alternative_product_name: s.alternativeProductName || null,
    ai_confidence: s.confidence,
    status: 'جديد',
  }));
  const { error } = await supabase.from('whatsapp_auto_followup_requests').insert(rows);
  if (error) throw error;
  return rows.length;
}

export async function ingestWhatsAppExportFile(file: File): Promise<IngestOneFileResult> {
  const result: IngestOneFileResult = { fileName: file.name, sessionsFound: 0, sessionsSaved: 0, sessionsDuplicate: 0, followupsCreated: 0, errors: [] };
  const source = await readWhatsAppExportFile(file);
  const messages = parseWhatsAppExport(source.text);
  if (!messages.length) {
    result.errors.push('لم يتم التعرف على رسائل WhatsApp داخل الملف.');
    return result;
  }
  const sessions = splitWhatsAppSessions(messages, 120);
  result.sessionsFound = sessions.length;

  for (const session of sessions) {
    try {
      const saved = await saveSessionReview(session, source.sourceFileName, source.innerFileName || null);
      if (saved.duplicate) result.sessionsDuplicate += 1;
      else result.sessionsSaved += 1;
      const resolvedBranch = saved.duplicate ? null : saved.branch;
      const created = await saveFollowupSignals(session, source.sourceFileName, resolvedBranch);
      result.followupsCreated += created;
    } catch (e) {
      result.errors.push(e instanceof Error ? e.message : 'خطأ غير معروف أثناء معالجة جلسة محادثة');
    }
  }
  return result;
}
