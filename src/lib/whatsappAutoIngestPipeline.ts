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
import {
  persistAutomaticWhatsAppReview,
  type AutomaticReviewSourceContext,
} from '@/lib/whatsappAutomaticReviewPersistence';
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
import {
  deriveWhatsAppFileProcessingState,
  runCanonicalWhatsAppFilePipeline,
  type WatcherCaseGraphSyncResult,
  type WhatsAppFileProcessingState,
} from '@/lib/whatsappWatcherCaseGraphSync';
import type { JourneySessionSourceV15 } from '@/lib/whatsappCustomerJourneyPersistenceV15';
import {
  episodeStartedAt,
  normalizeFollowupKeyPart,
  stableOperationIdentity,
} from '@/lib/whatsappFollowupIdentity';
import type { SalesIntelligenceStageStatus } from '@/lib/salesIntelligence/refresh/refreshClient';

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
  /** Automatic reviews not written because the source is not canonically owned (fail closed). */
  autoReviewsSkippedNonCanonical: number;
  autoReviewsPointsFailed: number;
  /** Canonical chain status: case units persisted, Journey V15 + Customer Case V22, Sales Intelligence. */
  caseGraph: WatcherCaseGraphSyncResult | null;
  salesIntelligence: Record<string, SalesIntelligenceStageStatus>;
  /** Explicit stage ledger; the file is recorded as processed only when outcome === 'complete'. */
  processing: WhatsAppFileProcessingState | null;
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
      // Resolved: every customer column from the resolved customer. Unresolved: id stays null and the
      // contact label is kept only as a hint.
      customer_id: identity.customerId,
      customer_code: identity.customerCode,
      customer_name: identity.customerId ? identity.customerName : identity.customerName || session.customerName,
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

  // Stable Operation Identity: same customer/conversation + episode + signal + reason -> same
  // follow-up, regardless of session/source instance, segmentation, order or ingestion path.
  const stableOf = (signal: DetectedFollowupSignal) =>
    stableOperationIdentity({
      customer: identity.canonical,
      timeline: session.messages,
      evidenceAt: new Date(signal.evidenceTimestamp),
      operationType: `signal:${signal.signalType}`,
      reasonKey: signal.requestedProductName || null,
      legacyCaseAnchor: session.id,
    });
  const stable = signals.map(stableOf);
  const identities = stable.map((row) => row.identity);

  const exactLookup = supabase
    .from('whatsapp_auto_followup_requests')
    .select('followup_identity')
    .in('followup_identity', Array.from(new Set(stable.flatMap((row) => [row.identity, ...row.aliases]))));
  const legacyLookup =
    identity.resolutionStatus === 'resolved' && identity.customerId
      ? supabase
          .from('whatsapp_auto_followup_requests')
          .select('id,customer_id,signal_type,requested_product_name,evidence_timestamp,followup_identity')
          .eq('customer_id', identity.customerId)
          .is('followup_identity', null)
          .in('signal_type', Array.from(new Set(signals.map((signal) => signal.signalType))))
          .limit(100)
      : Promise.resolve({ data: [], error: null });

  const [
    { data: existing, error: existingError },
    { data: legacyRows, error: legacyError },
  ] = await Promise.all([exactLookup, legacyLookup]);
  if (existingError) throw existingError;
  if (legacyError) throw legacyError;

  const existingKeys = new Set((existing || []).map((row) => String(row.followup_identity || '')));
  const freshSignals: Array<{ signal: DetectedFollowupSignal; followupIdentity: string }> = [];
  let duplicate = 0;
  let legacyAdopted = 0;
  let legacyAmbiguous = 0;

  for (let index = 0; index < signals.length; index += 1) {
    const signal = signals[index];
    const key = identities[index];
    if ([key, ...stable[index].aliases].some((candidate) => existingKeys.has(candidate))) {
      duplicate += 1;
      continue;
    }

    const signalAt = new Date(signal.evidenceTimestamp);
    const episodeStart = episodeStartedAt(session.messages, signalAt).getTime();
    const reasonKey = normalizeFollowupKeyPart(signal.requestedProductName || '');
    const deterministicLegacy = (legacyRows || []).filter((row: any) => {
      if (String(row.signal_type || '') !== signal.signalType) return false;
      if (normalizeFollowupKeyPart(row.requested_product_name || '') !== reasonKey) return false;
      if (!row.evidence_timestamp) return false;
      const legacyAt = new Date(String(row.evidence_timestamp));
      if (Number.isNaN(legacyAt.getTime())) return false;
      if (
        legacyAt.getTime() < session.startedAt.getTime() ||
        legacyAt.getTime() > session.endedAt.getTime()
      )
        return false;
      return episodeStartedAt(session.messages, legacyAt).getTime() === episodeStart;
    });

    if (deterministicLegacy.length === 1) {
      const legacyId = String(deterministicLegacy[0].id || '');
      const { data: adopted, error: adoptError } = await supabase
        .from('whatsapp_auto_followup_requests')
        .update({ followup_identity: key })
        .eq('id', legacyId)
        .is('followup_identity', null)
        .select('id');
      if (adoptError) {
        if (adoptError.code === '23505') {
          duplicate += 1;
          existingKeys.add(key);
          continue;
        }
        throw adoptError;
      }
      if ((adopted || []).length) {
        legacyAdopted += 1;
        duplicate += 1;
        existingKeys.add(key);
        continue;
      }
    } else if (deterministicLegacy.length > 1) {
      // Fail closed: more than one historical NULL row is not a deterministic adoption.
      legacyAmbiguous += 1;
      continue;
    }

    existingKeys.add(key);
    freshSignals.push({ signal, followupIdentity: key });
  }

  if (!freshSignals.length)
    return { created: 0, duplicate, legacyAdopted, legacyAmbiguous };

  const rows = freshSignals.map(({ signal, followupIdentity }) => ({
    followup_identity: followupIdentity,
    source_file_name: sourceFileName,
    conversation_session_id: session.id,
    branch: conversationBranch,
    doctor_name:
      session.outboundStaffNames.length === 1 ? session.outboundStaffNames[0] : null,
    customer_name:
      (identity.resolutionStatus === 'resolved' ? identity.customerName : identity.customerName || session.customerName) ||
      'غير معروف',
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
  return { created: rows.length, duplicate, legacyAdopted, legacyAmbiguous };
}

async function persistOperationalJourneyIntelligence(
  session: WhatsAppConversationSession,
  sourceId: string,
  identity: CustomerIdentity,
  conversationBranch: string | null,
  participantRoles: WhatsAppParticipantRoleModelV15,
  branchHint: BranchHintResult,
  canonicalCaseStartedAt: string
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
      customer: identity.canonical,
      session,
      caseStartedAt: canonicalCaseStartedAt,
      legacyCaseAnchor: session.id,
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

/**
 * Canonical Review Gate for automatic ingest: runs after the Customer Case V22 sync. The writer
 * checks every source against the canonical operational owner, so a failed or partial V22 sync,
 * a source without exactly one V22 case, or a superseded/archived source never gets an official
 * automatic review (or review points).
 */
export async function persistCanonicalAutomaticReviews(
  pending: AutomaticReviewSourceContext[],
  result: Pick<
    IngestOneFileResult,
    | 'caseGraph'
    | 'autoReviewsCreated'
    | 'autoReviewsSkipped'
    | 'autoReviewsSkippedNonCanonical'
    | 'autoReviewsPointsFailed'
    | 'errors'
  >
) {
  if (!pending.length) return;
  if (result.caseGraph?.customerCase.status === 'failed') {
    result.autoReviewsSkippedNonCanonical += pending.length;
    return;
  }
  for (const review of pending) {
    try {
      const autoReview = await persistAutomaticWhatsAppReview(review);
      if (autoReview.status === 'saved') {
        result.autoReviewsCreated += 1;
        if (autoReview.pointsError) {
          result.autoReviewsPointsFailed += 1;
          result.errors.push(
            `تقييم آلي رقم ${autoReview.reviewId}: تم حفظ التقييم لكن ربط النقاط فشل: ${autoReview.pointsError}`
          );
        }
      } else if (autoReview.status === 'skipped_non_canonical_source') {
        result.autoReviewsSkippedNonCanonical += 1;
      } else if (autoReview.status === 'failed') {
        result.errors.push(`تعذر إنشاء تقييم آلي لجلسة ${review.sourceId}: ${autoReview.error}`);
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
    autoReviewsSkippedNonCanonical: 0,
    autoReviewsPointsFailed: 0,
    caseGraph: null,
    salesIntelligence: {},
    processing: null,
    errors: [],
  };

  const source = await readWhatsAppExportFile(file);
  const parsedMessages = parseWhatsAppExport(source.text);
  const mediaAttachment = attachWhatsAppMediaToMessagesV21(parsedMessages, source.mediaFiles || []);
  const messages = mediaAttachment.messages;
  if (!messages.length) {
    result.errors.push('لم يتم التعرف على رسائل WhatsApp داخل الملف.');
    result.processing = deriveWhatsAppFileProcessingState({
      parsed: false,
      expectedSourceCount: 0,
      savedSourceCount: 0,
      sourceErrors: [],
      identityErrors: [],
      caseGraph: null,
      salesIntelligence: null,
    });
    return result;
  }

  // Canonical Segmentation Contract: the same case units (and therefore the same source hashes and
  // ids) as the Smart Watcher. Raw 120-minute sessions are never persisted as sources on their own.
  const segmentation = segmentWhatsAppExportCanonical(messages, source.sourceFileName);
  const caseContexts = segmentation.caseContexts;
  result.sessionsFound = caseContexts.contexts.length;
  const sessionSources: JourneySessionSourceV15[] = [];
  const sourceErrors: string[] = [];
  const sideWarnings: string[] = [];
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
          context.caseItem.startedAt
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
      const message = e instanceof Error ? e.message : 'خطأ غير معروف أثناء معالجة جلسة محادثة';
      result.errors.push(message);
      // A case unit whose durable source was never written is a critical failure; anything after
      // the source write (invoice/operational/follow-up side writes) is a side warning.
      if (!sessionSources.some((row) => row.sessionId === session.id)) sourceErrors.push(message);
      else sideWarnings.push(message);
    }
  }

  // Canonical chain through the SAME orchestrator as the Smart Folder:
  // Case Graph (Journey side projection + V22) -> exactly one Sales Intelligence refresh.
  const pipeline = await runCanonicalWhatsAppFilePipeline({
    sourceFileName: source.sourceFileName,
    caseContexts,
    sessionSources,
    branch: firstBranch,
    createdBy: options.createdBy ?? null,
    accessToken: options.accessToken ?? null,
  });
  result.caseGraph = pipeline.caseGraph;
  result.salesIntelligence = pipeline.salesIntelligence.bySource;
  if (result.caseGraph.journey.status === 'failed') {
    result.errors.push(`Journey sync failed — ${result.caseGraph.journey.error}`);
  }
  if (!['saved', 'skipped'].includes(result.caseGraph.customerCase.status)) {
    result.errors.push(
      `Customer Case V22 ${result.caseGraph.customerCase.status} (${result.caseGraph.customerCase.saved}/${result.caseGraph.customerCase.expected}) — ${result.caseGraph.customerCase.errors.join(' | ')}`
    );
  }

  // Automatic conversation analysis is a Case-level follower inside the canonical Sales
  // Intelligence refresh (after SI persistence + canonical proof reconciliation). It never
  // writes doctor/incentive points: AI evaluates, a human approves.
  if (pipeline.salesIntelligence.reason === 'staff_session_unavailable') {
    result.errors.push('Sales Intelligence: جلسة الإدارة غير متاحة — لم يتم تحديث التحليل الرسمي لهذه المصادر');
  }
  for (const evaluation of pipeline.salesIntelligence.conversationEvaluations) {
    if (evaluation.status === 'saved') {
      result.autoReviewsCreated += 1;
    } else if (evaluation.status === 'skipped_existing') {
      result.autoReviewsSkipped += 1;
    } else if (
      evaluation.status === 'skipped_non_current_case' ||
      evaluation.status === 'skipped_source_mismatch'
    ) {
      result.autoReviewsSkippedNonCanonical += 1;
    } else if (evaluation.status.startsWith('skipped_')) {
      result.autoReviewsSkipped += 1;
    } else if (evaluation.status === 'failed') {
      result.errors.push(
        `تحليل المحادثة [${evaluation.caseId || evaluation.sourceId}]: ${evaluation.error || 'فشل حفظ التقييم الآلي'}`
      );
    }
  }
  result.autoReviewsPointsFailed = 0;
  for (const failure of pipeline.salesIntelligence.errors) {
    result.errors.push(`Sales Intelligence [${failure}]`);
  }

  result.processing = deriveWhatsAppFileProcessingState({
    parsed: true,
    expectedSourceCount: caseContexts.contexts.length,
    savedSourceCount: sessionSources.length,
    sourceErrors,
    identityErrors: [],
    caseGraph: pipeline.caseGraph,
    salesIntelligence: pipeline.salesIntelligence,
    sideWarnings,
  });

  revokeWhatsAppMediaObjectUrlsV21(messages);
  return result;
}
