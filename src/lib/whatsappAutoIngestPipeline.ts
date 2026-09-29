import { supabase } from '@/lib/supabase';
import { readWhatsAppExportFile } from '@/lib/whatsappExportFileReader';
import {
  parseWhatsAppExport,
  serializeWhatsAppSessionRawText,
  type WhatsAppConversationSession,
} from '@/lib/whatsappConversationParser';
import { buildSmartConversationReviewSummary } from '@/lib/whatsappSmartReviewSummary';
import {
  detectFollowupSignals,
  type DetectedFollowupSignal,
} from '@/lib/whatsappFollowupSignalDetector';
import {
  attachInvoiceVerificationToQueue,
  hashWhatsAppSession,
} from '@/lib/whatsappReviewPersistenceV4';
import { buildUnifiedConversationIntelligence, verifySessionAgainstInvoices } from '@/lib/whatsappUnifiedIntelligenceV4';
import {
  buildWhatsAppOperationalIntelligenceV6,
  enrichWhatsAppOperationalProductsV6,
  syncWhatsAppOperationalActionsV6,
} from '@/lib/whatsappOperationalIntelligenceV6';
import { enrichWhatsAppOperationalJourneysV7 } from '@/lib/whatsappProductJourneyV7';
import { syncWhatsAppEvidenceLedgerV17 } from '@/lib/whatsappEvidenceLedgerV17';
import { persistAutomaticWhatsAppReview } from '@/lib/whatsappAutomaticReviewPersistence';
import { getCycleForDate } from '@/lib/pharmacy-cycle';
import { resolveWhatsAppParticipantRolesV15, type WhatsAppParticipantRoleModelV15 } from '@/lib/whatsappParticipantRoleResolverV15';
import { resolveConversationBranchHint, type BranchHintResult } from '@/lib/whatsappConversationBranchHint';
import {
  attachWhatsAppMediaToMessagesV21,
  revokeWhatsAppMediaObjectUrlsV21,
  syncWhatsAppMediaForSourceV21,
} from '@/lib/whatsappMediaV21';
import {
  extractCustomerIdentityEvidence,
  resolveCanonicalCustomerIdentities,
  type CanonicalCustomerIdentity,
  type CanonicalCustomerIdentityStatus,
} from '@/lib/customers/canonicalCustomerIdentityResolver';
import { segmentWhatsAppExportCanonical } from '@/lib/whatsappCanonicalSegmentation';
import { syncCanonicalCaseGraphForFile, type WatcherCaseGraphSyncResult } from '@/lib/whatsappWatcherCaseGraphSync';
import type { JourneySessionSourceV15 } from '@/lib/whatsappCustomerJourneyPersistenceV15';
import {
  buildFollowupIdentity,
  episodeStartedAt,
  followupCustomerAnchor,
} from '@/lib/whatsappFollowupIdentity';
import {
  requestCanonicalSalesIntelligenceRefresh,
  type SalesIntelligenceStageStatus,
} from '@/lib/salesIntelligence/refresh/refreshClient';

type CustomerIdentity = {
  customerId: string | null;
  customerCode: string | null;
  customerName: string | null;
  customerPhone: string | null;
  branch: string | null;
  matchedBy: 'phone' | 'code' | 'id' | 'none';
  resolutionStatus: CanonicalCustomerIdentityStatus;
  resolutionReason: string;
  canonical: CanonicalCustomerIdentity;
};

export interface IngestOneFileResult {
  fileName: string;
  sessionsFound: number;
  sessionsSaved: number;
  sessionsDuplicate: number;
  customersMatched: number;
  followupsCreated: number;
  followupsDuplicate: number;
  invoicesVerified: number;
  invoicesProbable: number;
  invoicesNotFound: number;
  invoiceChecksSkipped: number;
  autoReviewsCreated: number;
  autoReviewsSkipped: number;
  autoReviewsPointsFailed: number;
  /** Canonical chain status: case units persisted, Journey V15 + Customer Case V22, Sales Intelligence. */
  caseGraph: WatcherCaseGraphSyncResult | null;
  salesIntelligence: Record<string, SalesIntelligenceStageStatus>;
  errors: string[];
}

/** Maps the Canonical Customer Identity (shared resolver) to this pipeline's persistence shape. */
function toIngestCustomerIdentity(identity: CanonicalCustomerIdentity): CustomerIdentity {
  const resolved = identity.status === 'resolved';
  return {
    customerId: resolved ? identity.customerId : null,
    customerCode: identity.customerCode,
    customerName: identity.customerName,
    customerPhone: identity.normalizedPhone,
    branch: identity.branch,
    matchedBy: !resolved
      ? 'none'
      : identity.resolvedBy === 'customer_code'
        ? 'code'
        : identity.resolvedBy === 'contact_phone' || identity.resolvedBy === 'mentioned_phone'
          ? 'phone'
          : 'id',
    resolutionStatus: identity.status,
    resolutionReason: identity.reason,
    canonical: identity,
  };
}

async function saveSessionReview(
  session: WhatsAppConversationSession,
  sourceFileName: string,
  innerFileName: string | null,
  identity: CustomerIdentity,
  conversationBranch: string | null,
  branchHint: BranchHintResult
) {
  const sourceHash = await hashWhatsAppSession(session);
  const { data: existing, error: existingError } = await supabase
    .from('whatsapp_review_sources')
    .select('id')
    .eq('source_hash', sourceHash)
    .maybeSingle();
  if (existingError && existingError.code !== 'PGRST116') throw existingError;
  if (existing?.id) return { sourceId: String(existing.id), duplicate: true as const };

  const summary = buildSmartConversationReviewSummary(session);
  const staffName =
    session.outboundStaffNames.length === 1 ? session.outboundStaffNames[0] : null;

  const { data, error } = await supabase
    .from('whatsapp_review_sources')
    .insert({
      source_hash: sourceHash,
      source_type: 'whatsapp_export_auto',
      source_filename: sourceFileName,
      inner_filename: innerFileName,
      branch: conversationBranch,
      customer_id: identity.customerId,
      customer_code: identity.customerCode,
      customer_name: identity.customerName || session.customerName,
      customer_phone: identity.customerPhone,
      staff_name: staffName,
      conversation_started_at: session.startedAt.toISOString(),
      conversation_ended_at: session.endedAt.toISOString(),
      message_count: session.messages.length,
      parser_version: 'whatsapp-auto-ingest-v3',
      analysis_version: 'smart-summary-v1',
      analysis_status: 'analyzed',
      review_status:
        identity.resolutionStatus !== 'resolved' || summary.confidence < 60
          ? 'needs_context'
          : 'ready_quick',
      priority: summary.outcome === 'sale_intent' ? 'important' : 'normal',
      analysis_confidence: summary.confidence,
      commercial_eligible: summary.outcome === 'sale_intent',
      followup_required: summary.flags.length > 0,
      suggested_followup_reason: summary.flags.join('، ') || null,
      raw_text: serializeWhatsAppSessionRawText(session),
      analysis_json: {
        ...JSON.parse(JSON.stringify(summary)),
        customerIdentity: {
          matchedBy: identity.matchedBy,
          resolutionStatus: identity.resolutionStatus,
          resolutionReason: identity.resolutionReason,
          customerId: identity.customerId,
          customerCode: identity.customerCode,
          customerPhone: identity.customerPhone,
          customerRegisteredBranch: identity.branch,
          conversationBranch,
        },
        canonicalCustomerIdentity: identity.canonical,
        branchResolution: branchHint,
      },
    })
    .select('id')
    .single();
  if (error) {
    if (error.code === '23505') {
      const { data: duplicate, error: duplicateError } = await supabase
        .from('whatsapp_review_sources')
        .select('id')
        .eq('source_hash', sourceHash)
        .single();
      if (duplicateError) throw duplicateError;
      return { sourceId: String(duplicate.id), duplicate: true as const };
    }
    throw error;
  }
  return { sourceId: String(data.id), duplicate: false as const, summary };
}

async function verifySessionSale(
  session: WhatsAppConversationSession,
  sourceId: string,
  identity: CustomerIdentity,
  conversationBranch: string | null
) {
  const verification = await verifySessionAgainstInvoices(session, {
    customerId: identity.customerId,
    customerCode: identity.customerCode,
    customerPhone: identity.customerPhone,
    customerName: identity.customerName,
    branch: conversationBranch,
  });
  await attachInvoiceVerificationToQueue(sourceId, verification);
  return verification.status;
}

export async function saveFollowupSignals(
  session: WhatsAppConversationSession,
  sourceFileName: string,
  identity: CustomerIdentity,
  conversationBranch: string | null
) {
  const signals = detectFollowupSignals(session);
  if (!signals.length) return { created: 0, duplicate: 0 };

  // Stable Follow-up Identity: same customer + episode + signal + reason -> same follow-up,
  // regardless of session/source instance, segmentation or ingestion path.
  const customerAnchor = followupCustomerAnchor(identity.canonical, sourceFileName);
  const identityOf = (signal: DetectedFollowupSignal) =>
    buildFollowupIdentity({
      customerAnchor,
      episodeStartedAt: episodeStartedAt(session.messages, new Date(signal.evidenceTimestamp)),
      followupType: `signal:${signal.signalType}`,
      reasonKey: signal.requestedProductName || null,
    });
  const identities = signals.map(identityOf);

  const { data: existing, error: existingError } = await supabase
    .from('whatsapp_auto_followup_requests')
    .select('followup_identity')
    .in('followup_identity', Array.from(new Set(identities)));
  if (existingError) throw existingError;

  const existingKeys = new Set((existing || []).map((row) => String(row.followup_identity || '')));
  const freshSignals: Array<{ signal: DetectedFollowupSignal; followupIdentity: string }> = [];
  let duplicate = 0;
  signals.forEach((signal, index) => {
    const key = identities[index];
    if (existingKeys.has(key)) {
      duplicate += 1;
      return;
    }
    existingKeys.add(key);
    freshSignals.push({ signal, followupIdentity: key });
  });

  if (!freshSignals.length) return { created: 0, duplicate };

  const rows = freshSignals.map(({ signal, followupIdentity }) => ({
    followup_identity: followupIdentity,
    source_file_name: sourceFileName,
    conversation_session_id: session.id,
    branch: conversationBranch,
    doctor_name:
      session.outboundStaffNames.length === 1 ? session.outboundStaffNames[0] : null,
    customer_name: identity.customerName || session.customerName || 'غير معروف',
    customer_phone: identity.customerPhone,
    // Canonical Customer Identity decided; the DB trigger no longer guesses (V47).
    customer_id: identity.resolutionStatus === 'resolved' ? identity.customerId : null,
    customer_code: identity.resolutionStatus === 'resolved' ? identity.customerCode : null,
    customer_identity_status: identity.resolutionStatus,
    signal_type: signal.signalType,
    signal_type_label: signal.signalTypeLabel,
    evidence_quote: signal.evidenceQuote,
    evidence_timestamp: signal.evidenceTimestamp.toISOString(),
    requested_product_name: signal.requestedProductName || null,
    alternative_offered: signal.alternativeOffered ?? null,
    alternative_product_name: signal.alternativeProductName || null,
    ai_confidence: signal.confidence,
    status: 'جديد',
  }));

  const { error } = await supabase.from('whatsapp_auto_followup_requests').insert(rows);
  if (error) {
    if (error.code === '23505') return { created: 0, duplicate: duplicate + rows.length };
    throw error;
  }
  return { created: rows.length, duplicate };
}

async function persistOperationalJourneyIntelligence(
  session: WhatsAppConversationSession,
  sourceId: string,
  identity: CustomerIdentity,
  conversationBranch: string | null,
  participantRoles: WhatsAppParticipantRoleModelV15,
  branchHint: BranchHintResult,
  sourceFileName: string
) {
  const base = buildUnifiedConversationIntelligence(session);
  const initial = buildWhatsAppOperationalIntelligenceV6(session, base);
  const productResolved = await enrichWhatsAppOperationalProductsV6(initial);
  const operational = enrichWhatsAppOperationalJourneysV7(session, productResolved);

  const { data: sourceRow, error: sourceReadError } = await supabase
    .from('whatsapp_review_sources')
    .select('analysis_json,analysis_version,staff_id,staff_name,created_by')
    .eq('id', sourceId)
    .single();
  if (sourceReadError) throw sourceReadError;

  const nextAnalysis = {
    ...(sourceRow?.analysis_json || {}),
    operational: JSON.parse(JSON.stringify(operational)),
    participantRoles: JSON.parse(JSON.stringify(participantRoles)),
    branchHint: JSON.parse(JSON.stringify(branchHint)),
    productDemandVersion: 'product-demand-v22.1',
  };
  const { error: sourceUpdateError } = await supabase
    .from('whatsapp_review_sources')
    .update({
      branch: conversationBranch,
      analysis_version: operational.version,
      analysis_status: operational.officialScoringEligible ? 'analyzed' : 'needs_review',
      priority: operational.followupPlan.priority,
      followup_required: operational.followupPlan.required,
      suggested_followup_reason: operational.followupPlan.reason,
      analysis_confidence: Math.max(operational.intentConfidence, operational.outcomeConfidence),
      chat_suggested_sold: operational.operationalOutcome === 'probable_sale',
      analysis_json: nextAnalysis,
      updated_at: new Date().toISOString(),
    })
    .eq('id', sourceId);
  if (sourceUpdateError) throw sourceUpdateError;

  await syncWhatsAppOperationalActionsV6(operational, {
    sourceId,
    branch: conversationBranch,
    customerId: identity.customerId,
    customerCode: identity.customerCode,
    customerName: identity.customerName,
    customerPhone: identity.customerPhone,
    staffId: sourceRow?.staff_id || null,
    staffName:
      sourceRow?.staff_name ||
      (session.outboundStaffNames.length === 1 ? session.outboundStaffNames[0] : null),
    createdBy: sourceRow?.created_by || null,
    followupIdentity: {
      customerAnchor: followupCustomerAnchor(identity.canonical, sourceFileName),
      session,
    },
  });

  await syncWhatsAppEvidenceLedgerV17(session, {
    sourceId,
    operational,
    analysisVersion: 'product-demand-v22.1',
    participantRoles,
  });

  return operational;
}

export async function ingestWhatsAppExportFile(
  file: File,
  options: { accessToken?: string | null; createdBy?: string | null } = {}
): Promise<IngestOneFileResult> {
  const result: IngestOneFileResult = {
    fileName: file.name,
    sessionsFound: 0,
    sessionsSaved: 0,
    sessionsDuplicate: 0,
    customersMatched: 0,
    followupsCreated: 0,
    followupsDuplicate: 0,
    invoicesVerified: 0,
    invoicesProbable: 0,
    invoicesNotFound: 0,
    invoiceChecksSkipped: 0,
    autoReviewsCreated: 0,
    autoReviewsSkipped: 0,
    autoReviewsPointsFailed: 0,
    caseGraph: null,
    salesIntelligence: {},
    errors: [],
  };

  const source = await readWhatsAppExportFile(file);
  const parsedMessages = parseWhatsAppExport(source.text);
  const mediaAttachment = attachWhatsAppMediaToMessagesV21(parsedMessages, source.mediaFiles || []);
  const messages = mediaAttachment.messages;
  if (!messages.length) {
    result.errors.push('لم يتم التعرف على رسائل WhatsApp داخل الملف.');
    return result;
  }

  // Canonical Segmentation Contract: the same case units (and therefore the same source hashes and
  // ids) as the Smart Watcher. Raw 120-minute sessions are never persisted as sources on their own.
  const segmentation = segmentWhatsAppExportCanonical(messages, source.sourceFileName);
  const caseContexts = segmentation.caseContexts;
  result.sessionsFound = caseContexts.contexts.length;
  const sessionSources: JourneySessionSourceV15[] = [];
  let firstBranch: string | null = null;
  // Canonical Customer Identity: one bounded batch for every case unit (same resolver as the
  // Smart Watcher and Sales Intelligence). A lookup failure fails the file visibly.
  const identities = (
    await resolveCanonicalCustomerIdentities(
      supabase,
      caseContexts.contexts.map((context) => extractCustomerIdentityEvidence(context.mergedSession, source.sourceFileName))
    )
  ).map(toIngestCustomerIdentity);
  let contextIndex = -1;

  for (const context of caseContexts.contexts) {
    const session = context.mergedSession;
    contextIndex += 1;
    try {
      const identity = identities[contextIndex];
      if (identity.matchedBy !== 'none') result.customersMatched += 1;

      const participantRoles = await resolveWhatsAppParticipantRolesV15(session);
      const branchHint = await resolveConversationBranchHint(session, participantRoles, null);
      const conversationBranch = branchHint.value;

      const saved = await saveSessionReview(
        session,
        source.sourceFileName,
        source.innerFileName || null,
        identity,
        conversationBranch,
        branchHint
      );
      if (saved.duplicate) result.sessionsDuplicate += 1;
      else result.sessionsSaved += 1;
      sessionSources.push({ sessionId: session.id, sourceId: saved.sourceId, contextOnly: false });
      if (!firstBranch && conversationBranch) firstBranch = conversationBranch;

      if (source.mediaFiles?.length) {
        try {
          const mediaSync = await syncWhatsAppMediaForSourceV21(
            saved.sourceId,
            session,
            source.mediaFiles,
            null
          );
          if (mediaSync.failed > 0) {
            result.errors.push(
              `مرفقات واتساب: فشل حفظ ${mediaSync.failed} من ${mediaSync.linked} مرفق مرتبط في الجلسة ${saved.sourceId}.`
            );
          }
        } catch (mediaError) {
          result.errors.push(
            mediaError instanceof Error
              ? `مرفقات واتساب: ${mediaError.message}`
              : 'تعذر حفظ مرفقات WhatsApp لهذه الجلسة.'
          );
        }
      }

      if (!saved.duplicate) {
        try {
          const autoReview = await persistAutomaticWhatsAppReview({
            sourceId: saved.sourceId,
            session,
            branch: conversationBranch,
            customerId: identity.customerId,
            customerCode: identity.customerCode,
            customerName: identity.customerName,
            customerPhone: identity.customerPhone,
            staffName: session.outboundStaffNames[0] || null,
            reviewCycle: getCycleForDate(session.startedAt),
          });
          if (autoReview.status === 'saved') {
            result.autoReviewsCreated += 1;
            if (autoReview.pointsError) {
              result.autoReviewsPointsFailed += 1;
              result.errors.push(
                `تقييم آلي رقم ${autoReview.reviewId}: تم حفظ التقييم لكن ربط النقاط فشل: ${autoReview.pointsError}`
              );
            }
          } else if (autoReview.status === 'failed') {
            result.errors.push(`تعذر إنشاء تقييم آلي لجلسة ${saved.sourceId}: ${autoReview.error}`);
          } else {
            result.autoReviewsSkipped += 1;
          }
        } catch (autoReviewError) {
          result.errors.push(
            autoReviewError instanceof Error
              ? `تقييم آلي: ${autoReviewError.message}`
              : 'خطأ غير معروف أثناء التقييم الآلي للمحادثة'
          );
        }
      }

      const invoiceStatus = await verifySessionSale(session, saved.sourceId, identity, conversationBranch);
      if (invoiceStatus === 'verified') result.invoicesVerified += 1;
      else if (invoiceStatus === 'probable' || invoiceStatus === 'needs_review')
        result.invoicesProbable += 1;
      else if (invoiceStatus === 'not_found') result.invoicesNotFound += 1;
      else result.invoiceChecksSkipped += 1;

      try {
        await persistOperationalJourneyIntelligence(
          session,
          saved.sourceId,
          identity,
          conversationBranch,
          participantRoles,
          branchHint,
          source.sourceFileName
        );
      } catch (operationalError) {
        result.errors.push(
          operationalError instanceof Error
            ? `تحليل طلبات وأصناف واتساب: ${operationalError.message}`
            : 'تعذر تحديث تحليل طلبات وأصناف واتساب'
        );
      }

      const followups = await saveFollowupSignals(
        session,
        source.sourceFileName,
        identity,
        conversationBranch
      );
      result.followupsCreated += followups.created;
      result.followupsDuplicate += followups.duplicate;
    } catch (e) {
      result.errors.push(e instanceof Error ? e.message : 'خطأ غير معروف أثناء معالجة جلسة محادثة');
    }
  }

  // Customer Case V22 (+ Journey V15) through the same implementation as the Smart Watcher.
  result.caseGraph = await syncCanonicalCaseGraphForFile({
    sourceFileName: source.sourceFileName,
    caseContexts,
    sessionSources,
    branch: firstBranch,
    createdBy: options.createdBy ?? null,
  });
  if (result.caseGraph.journey.status === 'failed') {
    result.errors.push(`Journey sync failed — ${result.caseGraph.journey.error}`);
  }
  if (!['saved', 'skipped'].includes(result.caseGraph.customerCase.status)) {
    result.errors.push(
      `Customer Case V22 ${result.caseGraph.customerCase.status} (${result.caseGraph.customerCase.saved}/${result.caseGraph.customerCase.expected}) — ${result.caseGraph.customerCase.errors.join(' | ')}`
    );
  }

  // Sales Intelligence through the same transport and Canonical Source Gate as the Smart Watcher.
  const sourceIds = Array.from(new Set(sessionSources.map((row) => row.sourceId)));
  if (sourceIds.length) {
    if (!options.accessToken) {
      result.errors.push('Sales Intelligence: جلسة الإدارة غير متاحة — لم يتم تحديث التحليل الرسمي لهذه المصادر');
    } else {
      const refresh = await requestCanonicalSalesIntelligenceRefresh({ sourceIds, accessToken: options.accessToken });
      result.salesIntelligence = refresh.bySource;
      for (const failure of refresh.errors) result.errors.push(`Sales Intelligence [${failure.sourceId}]: ${failure.message}`);
    }
  }

  revokeWhatsAppMediaObjectUrlsV21(messages);
  return result;
}
