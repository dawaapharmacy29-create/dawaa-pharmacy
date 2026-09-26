import { writeFileSync } from 'node:fs';
import { supabase } from '../src/lib/supabase';
import { parseWhatsAppExport, splitWhatsAppSessions } from '../src/lib/whatsappConversationParser';
import { buildUnifiedConversationIntelligence } from '../src/lib/whatsappUnifiedIntelligenceV4';
import {
  buildWhatsAppOperationalIntelligenceV6,
  enrichWhatsAppOperationalProductsV6,
} from '../src/lib/whatsappOperationalIntelligenceV6';
import { enrichWhatsAppOperationalJourneysV7 } from '../src/lib/whatsappProductJourneyV7';
import { resolveWhatsAppParticipantRolesV15 } from '../src/lib/whatsappParticipantRoleResolverV15';
import { resolveConversationBranchHint } from '../src/lib/whatsappConversationBranchHint';

type SourceRow = {
  id: string;
  raw_text: string | null;
  branch: string | null;
  conversation_started_at: string | null;
  analysis_json: Record<string, unknown> | null;
};

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const json = args.has('--json');
const sourceIdArg = process.argv.find((arg) => arg.startsWith('--source-id='));
const sourceId = sourceIdArg ? sourceIdArg.slice('--source-id='.length).trim() : null;
const outputFileArg = process.argv.find((arg) => arg.startsWith('--output-file='));
const outputFile = outputFileArg ? outputFileArg.slice('--output-file='.length).trim() : null;

const ANALYSIS_LOGIC_VERSION = 'whatsapp-analysis-v5-directional-burst';

async function loadSources(): Promise<SourceRow[]> {
  let query = supabase
    .from('whatsapp_review_sources')
    .select('id,raw_text,branch,conversation_started_at,analysis_json')
    .order('conversation_started_at', { ascending: true })
    .limit(1000);

  if (sourceId) query = query.eq('id', sourceId);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as SourceRow[];
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
    return {
      status: 'skipped_multi_session_legacy' as const,
      detail: `legacy_source_contains_${sessions.length}_sessions`,
      sessionCount: sessions.length,
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
  const rows = await loadSources();
  const results: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    try {
      results.push({ sourceId: row.id, ...(await rebuild(row)) });
    } catch (error) {
      results.push({
        sourceId: row.id,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const count = (status: string) => results.filter((row) => row.status === status).length;
  const summary = {
    mode: apply ? 'apply' : 'dry_run',
    logicVersion: ANALYSIS_LOGIC_VERSION,
    totalRows: rows.length,
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

void main();
