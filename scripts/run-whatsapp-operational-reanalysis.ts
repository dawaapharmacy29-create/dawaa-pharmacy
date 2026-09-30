import { writeFileSync } from 'node:fs';
import { supabase } from '../src/lib/supabase';
import { parseWhatsAppExport, splitWhatsAppSessions } from '../src/lib/whatsappConversationParser';
import { buildUnifiedConversationIntelligence } from '../src/lib/whatsappUnifiedIntelligenceV4';
import {
  buildWhatsAppOperationalIntelligenceV6,
  enrichWhatsAppOperationalProductsV6,
  type WhatsAppMultiSessionOperationalV1,
} from '../src/lib/whatsappOperationalIntelligenceV6';
import { enrichWhatsAppOperationalJourneysV7 } from '../src/lib/whatsappProductJourneyV7';
import { resolveWhatsAppParticipantRolesV15 } from '../src/lib/whatsappParticipantRoleResolverV15';
import { resolveConversationBranchHint } from '../src/lib/whatsappConversationBranchHint';
import { buildWhatsAppCaseContextsV27 } from '../src/lib/whatsappCaseContextV27';
import {
  resolveReanalysisMode,
  selectReanalysisTargets,
} from '../src/lib/whatsappOperationalReanalysisGuard';

type SourceRow = {
  id: string;
  raw_text: string | null;
  branch: string | null;
  source_filename: string | null;
  review_status: string | null;
  conversation_started_at: string | null;
  conversation_ended_at: string | null;
  analysis_json: Record<string, unknown> | null;
};

const args = new Set(process.argv.slice(2));
// Fails closed before any read when apply is requested without explicit manual confirmation.
const apply = resolveReanalysisMode({ argv: process.argv.slice(2), env: process.env }) === 'apply';
const json = args.has('--json');
const sourceIdArg = process.argv.find((arg) => arg.startsWith('--source-id='));
const sourceId = sourceIdArg ? sourceIdArg.slice('--source-id='.length).trim() : null;
const outputFileArg = process.argv.find((arg) => arg.startsWith('--output-file='));
const outputFile = outputFileArg ? outputFileArg.slice('--output-file='.length).trim() : null;

const ANALYSIS_LOGIC_VERSION = 'whatsapp-analysis-v5-directional-burst';

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack || null,
    };
  }
  if (error && typeof error === 'object') {
    const value = error as Record<string, unknown>;
    return {
      name: String(value.name || 'Error'),
      message: String(value.message || value.error_description || value.details || 'Unknown object rejection'),
      code: value.code == null ? null : String(value.code),
      details: value.details == null ? null : String(value.details),
      hint: value.hint == null ? null : String(value.hint),
    };
  }
  return {
    name: 'Error',
    message: String(error),
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function inferRelationshipToPrevious(
  previous: ReturnType<typeof splitWhatsAppSessions>[number] | null,
  current: ReturnType<typeof splitWhatsAppSessions>[number]
) {
  if (!previous) {
    return {
      relationshipToPrevious: 'independent' as const,
      continuationOfSessionIndex: null,
      relationshipReason: null,
    };
  }

  const currentMeaningful = current.messages.filter((message) =>
    message.direction !== 'system' && message.text.trim().length > 0
  );
  const previousMeaningful = previous.messages.filter((message) =>
    message.direction !== 'system' && message.text.trim().length > 0
  );
  const lastPrevious = previousMeaningful[previousMeaningful.length - 1];
  const firstCurrent = currentMeaningful[0];
  const gapHours = (current.startedAt.getTime() - previous.endedAt.getTime()) / 3_600_000;

  const shortOutboundTail =
    currentMeaningful.length <= 2 &&
    currentMeaningful.length > 0 &&
    currentMeaningful.every((message) => message.direction === 'outbound');

  const previousEndedInbound = lastPrevious?.direction === 'inbound';
  const anaphoricReply = Boolean(firstCurrent && /(?:واحد\s+منهم|اي\s+واحد\s+منهم|أي\s+واحد\s+منهم|الاتنين|الإتنين|منهم|ده|دي|عادي)/i.test(firstCurrent.text));
  const noFreshOpening = Boolean(firstCurrent && !/(اهلا|أهلا|السلام عليكم|صباح الخير|مساء الخير|مع حضرتك)/i.test(firstCurrent.text));
  const previousPromisedFollowup = previousMeaningful.some((message) =>
    message.direction === 'outbound' &&
    /(?:بكرا|غدا|غدًا)[^\n]{0,100}(?:هبعت|ابعت|هصور|الصور)|(?:اول ما|أول ما)[^\n]{0,100}(?:يفتح|يشتغل)[^\n]{0,100}(?:هبعت|ابعت)/i.test(message.text)
  );
  const currentResumesPromise = currentMeaningful.slice(0, 12).some((message) =>
    /(?:المخزن|المكتب)[^\n]{0,100}(?:يفتح|يشتغل)|(?:اول ما|أول ما)[^\n]{0,100}(?:يفتح|يشتغل)[^\n]{0,100}(?:هبعت|ابعت)|\[Forwarded\]\s*<image omitted>/i.test(message.text)
  );
  const previousAvailabilityFollowup = previousMeaningful.some((message) =>
    message.direction === 'outbound' &&
    /(?:هنتواصل|هتواصل|هبلغ)[^\n]{0,120}(?:اول ما|أول ما)[^\n]{0,120}(?:نوفر|يوصل|يجهز)|(?:اول ما|أول ما)[^\n]{0,120}(?:نوفر|يوصل|يجهز)[^\n]{0,120}(?:هنتواصل|هتواصل|هبلغ)/i.test(message.text)
  );
  const currentFulfillmentUpdate = currentMeaningful.slice(0, 12).some((message) =>
    message.direction === 'outbound' &&
    /(?:جاري الارسال|جاري الإرسال|موجوده|موجودة|متوفره|متوفرة|نوفرها|جاهزه|جاهزة)/i.test(message.text)
  );
  const previousScheduledTomorrow = previousMeaningful.some((message) =>
    message.direction === 'inbound' && /(?:بكره|بكرة|غدا|غدًا)/i.test(message.text)
  );
  const currentOrderReadyPickup = currentMeaningful.slice(0, 12).some((message) =>
    message.direction === 'inbound' &&
    /(?:الاوردر|الأوردر)[^\n]{0,60}(?:جاهز|استلم|استلمه)|(?:جاهز|جاهزة)[^\n]{0,60}(?:استلم|الاوردر|الأوردر)/i.test(message.text)
  );

  if (
    previousAvailabilityFollowup &&
    currentFulfillmentUpdate &&
    gapHours > 2 &&
    gapHours <= 12
  ) {
    return {
      relationshipToPrevious: 'continuation' as const,
      continuationOfSessionIndex: 1,
      relationshipReason: 'availability_followup_resumed_with_fulfillment_update',
    };
  }

  if (
    previousScheduledTomorrow &&
    currentOrderReadyPickup &&
    gapHours > 2 &&
    gapHours <= 24
  ) {
    return {
      relationshipToPrevious: 'continuation' as const,
      continuationOfSessionIndex: 1,
      relationshipReason: 'scheduled_next_day_order_followup',
    };
  }

  if (
    previousPromisedFollowup &&
    currentResumesPromise &&
    gapHours > 2 &&
    gapHours <= 18
  ) {
    return {
      relationshipToPrevious: 'continuation' as const,
      continuationOfSessionIndex: 1,
      relationshipReason: 'promised_followup_resumed_next_session',
    };
  }

  if (
    shortOutboundTail &&
    previousEndedInbound &&
    anaphoricReply &&
    noFreshOpening &&
    gapHours > 2 &&
    gapHours <= 12
  ) {
    return {
      relationshipToPrevious: 'continuation' as const,
      continuationOfSessionIndex: 1,
      relationshipReason: 'outbound_only_anaphoric_reply_after_previous_inbound_question',
    };
  }

  return {
    relationshipToPrevious: 'independent' as const,
    continuationOfSessionIndex: null,
    relationshipReason: null,
  };
}

async function loadSources(): Promise<SourceRow[]> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let query = supabase
      .from('whatsapp_review_sources')
      .select(
        'id,raw_text,branch,source_filename,review_status,conversation_started_at,conversation_ended_at,analysis_json'
      )
      .order('conversation_started_at', { ascending: true })
      .limit(1000);

    if (sourceId) query = query.eq('id', sourceId);
    const { data, error } = await query;
    if (!error) return (data || []) as SourceRow[];

    lastError = error;
    if (attempt < 3) await sleep(500 * attempt);
  }

  const details = serializeError(lastError);
  throw new Error(`loadSources_failed: ${JSON.stringify(details)}`);
}

async function buildMultiSessionOperational(row: SourceRow, sessions: ReturnType<typeof splitWhatsAppSessions>): Promise<WhatsAppMultiSessionOperationalV1> {
  const built = [];
  for (let index = 0; index < sessions.length; index += 1) {
    const session = sessions[index];
    const base = buildUnifiedConversationIntelligence(session);
    const initial = buildWhatsAppOperationalIntelligenceV6(session, base);
    const productResolved = await enrichWhatsAppOperationalProductsV6(initial);
    const operational = enrichWhatsAppOperationalJourneysV7(session, productResolved);

    const relationship = inferRelationshipToPrevious(index > 0 ? sessions[index - 1] : null, session);
    const storedOperational = JSON.parse(JSON.stringify(operational));
    if (relationship.relationshipToPrevious === 'continuation') {
      storedOperational.officialScoringEligible = false;
    }
    built.push({
      sessionIndex: index + 1,
      startedAt: session.startedAt.toISOString(),
      endedAt: session.endedAt.toISOString(),
      messageCount: session.messages.length,
      ...relationship,
      continuationOfSessionIndex:
        relationship.relationshipToPrevious === 'continuation' ? index : null,
      operational: storedOperational,
    });
  }

  return {
    version: 'whatsapp-multi-session-operational-v1',
    sessionCount: built.length,
    sessions: built,
  };
}

async function rebuild(row: SourceRow) {
  const rawText = String(row.raw_text || '').trim();
  if (!rawText) return { status: 'skipped_missing_raw' as const };

  const messages = parseWhatsAppExport(rawText, {
    trustedConversationStartedAt: row.conversation_started_at,
  });
  // Re-analysis must not merge multiple real conversations into one operational model.
  // Legacy whatsapp-review-v4 rows can contain 2+ sessions inside one persisted source.
  // Keep those rows untouched for a dedicated legacy multi-session repair phase.
  const sessions = splitWhatsAppSessions(messages, 120);
  if (sessions.length !== 1) {
    const multiSessionOperational = await buildMultiSessionOperational(row, sessions);
    const caseContexts = buildWhatsAppCaseContextsV27(sessions);
    return {
      status: 'skipped_multi_session_legacy' as const,
      detail: `legacy_source_contains_${sessions.length}_sessions`,
      sessionCount: sessions.length,
      caseDryRun: {
        caseCount: caseContexts.caseEngine.caseCount,
        cases: caseContexts.contexts.map((context) => ({
          caseId: context.caseItem.id,
          startedAt: context.caseItem.startedAt,
          endedAt: context.caseItem.lastEventAt,
          state: context.caseItem.state,
          orderIntent: context.caseItem.orderIntent,
          orderConfirmed: context.caseItem.orderConfirmed,
          sessionCount: context.caseItem.sessionIds.length,
          staffNames: context.caseItem.staffNames,
          summary: context.caseItem.summary,
        })),
      },
      multiSessionOperational,
    };
  }

  if (row.analysis_json?.conversationAnalysisLogicVersion === ANALYSIS_LOGIC_VERSION) {
    return { status: 'skipped_already_current' as const };
  }

  const session = sessions[0];
  const base = buildUnifiedConversationIntelligence(session);
  const initial = buildWhatsAppOperationalIntelligenceV6(session, base);
  // Keep this identical to the normal Auto Ingest path: product enrichment first, then journey.
  const productResolved = await enrichWhatsAppOperationalProductsV6(initial);
  const operational = enrichWhatsAppOperationalJourneysV7(session, productResolved);
  const participantRoles = await resolveWhatsAppParticipantRolesV15(session);
  const branchHint = await resolveConversationBranchHint(
    session,
    participantRoles,
    row.branch
  );

  const previous = row.analysis_json || {};
  const nextAnalysis = {
    ...previous,
    operational: JSON.parse(JSON.stringify(operational)),
    participantRoles: JSON.parse(JSON.stringify(participantRoles)),
    branchHint: JSON.parse(JSON.stringify(branchHint)),
    conversationAnalysisLogicVersion: ANALYSIS_LOGIC_VERSION,
  };

  if (!apply) {
    return {
      status: 'planned' as const,
      primaryIntent: operational.primaryIntent,
      operationalOutcome: operational.operationalOutcome,
      products: operational.products.length,
      requests: operational.customerRequests.length,
      recommendations: operational.recommendations.length,
      patch: {
        operational: nextAnalysis.operational,
        participantRoles: nextAnalysis.participantRoles,
        branchHint: nextAnalysis.branchHint,
        conversationAnalysisLogicVersion: ANALYSIS_LOGIC_VERSION,
      },
    };
  }

  const { error } = await supabase
    .from('whatsapp_review_sources')
    .update({
      analysis_json: nextAnalysis,
      updated_at: new Date().toISOString(),
    })
    .eq('id', row.id);
  if (error) throw error;

  return {
    status: 'updated' as const,
    primaryIntent: operational.primaryIntent,
    operationalOutcome: operational.operationalOutcome,
    products: operational.products.length,
    requests: operational.customerRequests.length,
    recommendations: operational.recommendations.length,
  };
}

async function main() {
  const loaded = await loadSources();
  // Only canonical analytical sources are rewritten; a resolver failure aborts the run.
  const { targets: rows, excluded } = await selectReanalysisTargets(supabase, loaded);
  const results: Array<Record<string, unknown>> = excluded.map((row) => ({
    sourceId: row.sourceId,
    status: 'skipped_non_canonical_source',
    reason: row.reason,
  }));
  for (const row of rows) {
    try {
      results.push({ sourceId: row.id, ...(await rebuild(row)) });
    } catch (error) {
      results.push({
        sourceId: row.id,
        status: 'failed',
        error: serializeError(error),
      });
    }
  }

  const count = (status: string) => results.filter((row) => row.status === status).length;
  const summary = {
    mode: apply ? 'apply' : 'dry_run',
    logicVersion: ANALYSIS_LOGIC_VERSION,
    totalRows: loaded.length,
    canonicalRows: rows.length,
    skippedNonCanonical: excluded.length,
    planned: count('planned'),
    updated: count('updated'),
    skippedMissingRaw: count('skipped_missing_raw'),
    skippedMultiSessionLegacy: count('skipped_multi_session_legacy'),
    skippedAlreadyCurrent: count('skipped_already_current'),
    failed: count('failed'),
  };

  const payload = { summary, results };
  if (outputFile) writeFileSync(outputFile, JSON.stringify(payload, null, 2) + '\n', 'utf8');

  if (json) {
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  } else {
    console.log(summary);
    for (const row of results.filter((item) => item.status === 'failed' || String(item.status).startsWith('skipped_'))) {
      console.log(row);
    }
  }

  if (summary.failed > 0) process.exitCode = 1;
}

void main().catch((error) => {
  const fatal = {
    stage: 'fatal',
    error: serializeError(error),
  };
  console.error(JSON.stringify(fatal, null, 2));
  process.exitCode = 1;
});
