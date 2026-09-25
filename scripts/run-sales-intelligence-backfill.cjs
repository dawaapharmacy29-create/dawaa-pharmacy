#!/usr/bin/env node
'use strict';

/**
 * Sales Intelligence maintenance backfill runner.
 *
 * SAFETY CONTRACT
 * - Defaults to DRY RUN. No writes without --apply.
 * - Requires SUPABASE_SERVICE_ROLE_KEY only because the canonical engine writer RPCs are
 *   intentionally service-role-only. This script never weakens those grants.
 * - Default scope is ONLY conversations already represented in sales_intelligence_cases.
 *   Use --all-sources explicitly to broaden the scope.
 * - Uses the exact production batch pipeline + review-source adapter; no duplicate scoring logic.
 */

const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');
const { createClient } = require('@supabase/supabase-js');

const root = path.resolve(__dirname, '..');
const apply = process.argv.includes('--apply');
const allSources = process.argv.includes('--all-sources');
const knownBranchOnly = process.argv.includes('--known-branch-only');
const itemReadyOnly = process.argv.includes('--item-ready-only');
const groundTruth = process.argv.includes('--ground-truth');
const jsonOutput = process.argv.includes('--json');

const GROUND_TRUTH = {
  sourceId: 'f09471e8-64f4-45d1-859c-17ba97b19259',
  caseId: 'f09471e8-64f4-45d1-859c-17ba97b19259:interaction:0:session:0',
  expectedInvoiceNumber: '72368',
};

if (allSources && itemReadyOnly) {
  console.error('--all-sources and --item-ready-only are mutually exclusive.');
  process.exit(2);
}
if (knownBranchOnly && !allSources) {
  console.error('--known-branch-only is only valid together with --all-sources.');
  process.exit(2);
}
if (groundTruth && apply) {
  console.error('--ground-truth is a read-only regression gate and cannot be combined with --apply.');
  process.exit(2);
}
if (groundTruth && (allSources || itemReadyOnly || knownBranchOnly)) {
  console.error('--ground-truth uses its own fixed source scope and cannot be combined with other scope flags.');
  process.exit(2);
}

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  console.error('Missing SUPABASE_URL (or VITE_SUPABASE_URL).');
  process.exit(2);
}
if (!serviceRoleKey) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY. This runner never uses an anon key for writes.');
  process.exit(2);
}

globalThis.__VITE_IMPORT_META_ENV__ = {
  DEV: false,
  PROD: true,
  MODE: 'maintenance',
  VITE_SUPABASE_URL: supabaseUrl,
  VITE_SUPABASE_ANON_KEY: '',
};

const originalLoad = Module._load;
const originalResolve = Module._resolveFilename;

Module._resolveFilename = function patchedResolve(request, parent, isMain, options) {
  if (request.startsWith('@/')) {
    const target = path.join(root, 'src', request.slice(2));
    for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
      const candidate = target + ext;
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
    if (fs.existsSync(target) && fs.statSync(target).isFile()) return target;
  }
  return originalResolve.call(this, request, parent, isMain, options);
};

for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = function compileTypeScript(module, filename) {
    const source = fs
      .readFileSync(filename, 'utf8')
      .replaceAll('import.meta.env', 'globalThis.__VITE_IMPORT_META_ENV__');
    const output = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
      },
      fileName: filename,
    }).outputText;
    module._compile(output, filename);
  };
}

const { runBatchPersistence } = require(path.join(root, 'src/lib/salesIntelligence/persistence/batchPersistenceService.ts'));
const { reviewSourceRowToBatchConversation } = require(path.join(root, 'src/lib/salesIntelligence/persistence/reviewSourceBatchAdapter.ts'));
const { selectCanonicalReviewSourceIds } = require(path.join(root, 'src/lib/salesIntelligence/sourceSnapshotLineage.ts'));

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function chunks(values, size) {
  const out = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

async function fetchCurrentConversationIds() {
  const ids = new Set();
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('sales_intelligence_cases')
      .select('conversation_id')
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data || [];
    for (const row of rows) if (row.conversation_id) ids.add(String(row.conversation_id));
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return [...ids];
}

async function fetchItemEvidenceReadinessSnapshot() {
  const attributions = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('sales_intelligence_current_attributions')
      .select('case_id,selected_invoice_id,is_official_for_staff_evaluation')
      .range(from, from + pageSize - 1);
    if (error) throw error;
    attributions.push(...(data || []));
    if ((data || []).length < pageSize) break;
    from += pageSize;
  }

  const selectedInvoiceIds = Array.from(
    new Set(attributions.map((row) => row.selected_invoice_id).filter(Boolean).map(String))
  );
  const invoiceIdsWithItems = new Set();
  for (const group of chunks(selectedInvoiceIds, 100)) {
    const { data, error } = await supabase
      .from('sales_invoice_items_v21')
      .select('invoice_id')
      .in('invoice_id', group);
    if (error) throw error;
    for (const row of data || []) if (row.invoice_id) invoiceIdsWithItems.add(String(row.invoice_id));
  }

  const itemReadyCaseIds = Array.from(
    new Set(
      attributions
        .filter((row) => row.selected_invoice_id && invoiceIdsWithItems.has(String(row.selected_invoice_id)))
        .map((row) => String(row.case_id))
    )
  );

  const conversationIds = new Set();
  for (const group of chunks(itemReadyCaseIds, 100)) {
    const { data, error } = await supabase
      .from('sales_intelligence_cases')
      .select('case_id,conversation_id')
      .in('case_id', group);
    if (error) throw error;
    for (const row of data || []) if (row.conversation_id) conversationIds.add(String(row.conversation_id));
  }

  return {
    currentAttributions: attributions.length,
    selectedInvoices: selectedInvoiceIds.length,
    selectedInvoicesWithItems: invoiceIdsWithItems.size,
    itemReadyCases: itemReadyCaseIds.length,
    itemReadyConversations: conversationIds.size,
    officialStaffAttributions: attributions.filter((row) => row.is_official_for_staff_evaluation).length,
    conversationIds: [...conversationIds],
  };
}

async function fetchReviewSources(itemReadiness = null) {
  const select = [
    'id',
    'raw_text',
    'source_filename',
    'conversation_started_at',
    'conversation_ended_at',
    'message_count',
    'created_at',
    'customer_id',
    'customer_phone',
    'customer_name',
    'customer_code',
    'branch',
    'matched_invoice_id',
    'matched_invoice_number',
    'invoice_match_status',
    'reviewer_confirmed',
    'reviewer_id',
  ].join(',');

  if (allSources || groundTruth) {
    const rows = [];
    let from = 0;
    const pageSize = 500;
    while (true) {
      const { data, error } = await supabase
        .from('whatsapp_review_sources')
        .select(select)
        .range(from, from + pageSize - 1);
      if (error) throw error;
      rows.push(...(data || []));
      if ((data || []).length < pageSize) break;
      from += pageSize;
    }
    return rows;
  }

  const ids = itemReadyOnly
    ? (itemReadiness ?? await fetchItemEvidenceReadinessSnapshot()).conversationIds
    : await fetchCurrentConversationIds();
  const rows = [];
  for (const group of chunks(ids, 100)) {
    const { data, error } = await supabase
      .from('whatsapp_review_sources')
      .select(select)
      .in('id', group);
    if (error) throw error;
    rows.push(...(data || []));
  }
  return rows;
}

function summarize(result, sourceCount, readinessBefore, readinessAfter = null) {
  const plan = result.plan;
  const outcomes = result.caseOutcomes || [];
  const scope = groundTruth
    ? 'truth-v2-ground-truth'
    : allSources
      ? (knownBranchOnly ? 'all-canonical-review-sources-with-known-branch' : 'all-review-sources')
      : itemReadyOnly
        ? 'existing-cases-whose-selected-invoice-now-has-item-evidence'
        : 'existing-sales-intelligence-conversations';
  return {
    mode: result.dryRun ? 'dry-run' : 'apply',
    scope,
    itemEvidenceRefresh: {
      before: readinessBefore,
      after: readinessAfter,
      officialStaffAttributionDelta:
        readinessAfter == null
          ? null
          : readinessAfter.officialStaffAttributions - readinessBefore.officialStaffAttributions,
    },
    sourceConversations: sourceCount,
    derivedCases: result.caseAnalyses.length,
    customerGroups: result.performance.customerGroups,
    candidateInvoiceFetches: result.performance.candidateInvoiceFetches,
    candidateInvoicesEvaluated: result.performance.candidateInvoicesEvaluated,
    invoiceResolution: {
      exclusiveInvoicesResolved: result.performance.exclusiveInvoicesResolved,
      invoiceClaimsDenied: result.performance.invoiceClaimsDenied,
      unresolvedInvoiceCompetitions: result.performance.unresolvedInvoiceCompetitions,
      iterations: result.performance.invoiceResolutionIterations,
    },
    plan: {
      casesToInsert: plan.casesToInsert.length,
      casesToUpdateCanonicalIdentity: plan.casesToUpdateCanonicalIdentity.length,
      casesUnchanged: plan.casesUnchanged.length,
      analysesToInsert: plan.analysesToInsert.length,
      analysesToSupersede: plan.analysesToSupersede.length,
      analysesNoOp: plan.analysesNoOp.length,
      attributionsToInsert: plan.attributionsToInsert.length,
      attributionsNoOp: plan.attributionsNoOp.length,
      matchesToInsert: plan.matchesToInsert.length,
      matchesNoOp: plan.matchesNoOp.length,
      policyEvaluationsToInsert: plan.policyEvaluationsToInsert.length,
      policyEvaluationsNoOp: plan.policyEvaluationsNoOp.length,
      conflicts: plan.conflicts.length,
      warnings: plan.warnings.length,
      conflictDetails: plan.conflicts.map(({ caseId, kind, detail }) => ({ caseId, kind, detail })),
      warningDetails: plan.warnings.map(({ caseId, kind, detail }) => ({ caseId, kind, detail })),
    },
    apply: result.dryRun
      ? null
      : {
          attempted: outcomes.length,
          succeeded: outcomes.filter((x) => x.success).length,
          failed: outcomes.filter((x) => !x.success).length,
          failures: outcomes.filter((x) => !x.success).map((x) => ({ caseId: x.caseId, error: x.error })),
        },
  };
}

(async () => {
  console.log(`Sales Intelligence backfill: ${apply ? 'APPLY' : 'DRY RUN'}`);
  console.log(
    `Scope: ${
      groundTruth
        ? 'TRUTH V2 GROUND TRUTH — real source/case regression'
        : allSources
          ? (knownBranchOnly ? 'ALL whatsapp_review_sources WITH KNOWN BRANCH ONLY' : 'ALL whatsapp_review_sources')
          : itemReadyOnly
            ? 'existing cases whose currently selected invoice now has item evidence'
            : 'existing Sales Intelligence conversations only'
    }`
  );

  const readinessBefore = await fetchItemEvidenceReadinessSnapshot();
  if (itemReadyOnly) {
    console.log(
      `Item-ready scope: ${readinessBefore.itemReadyCases} cases / ${readinessBefore.itemReadyConversations} conversations; ` +
      `${readinessBefore.selectedInvoicesWithItems} selected invoices now have item evidence.`
    );
  }

  const rows = await fetchReviewSources(readinessBefore);
  const canonicalIds = selectCanonicalReviewSourceIds(rows);
  const allCanonicalRows = rows.filter((row) => canonicalIds.has(row.id));
  const canonicalRows = groundTruth
    ? allCanonicalRows.filter((row) => String(row.id) === GROUND_TRUTH.sourceId)
    : knownBranchOnly
      ? allCanonicalRows.filter((row) => typeof row.branch === 'string' && row.branch.trim().length > 0)
      : allCanonicalRows;
  const conversations = canonicalRows
    .filter((row) => typeof row.raw_text === 'string' && row.raw_text.trim().length > 0)
    .map(reviewSourceRowToBatchConversation);

  console.log(
    `Snapshot lineage: ${rows.length} source rows -> ${allCanonicalRows.length} canonical source rows` +
    (knownBranchOnly ? ` -> ${canonicalRows.length} canonical rows with known branch` : '')
  );

  if (!conversations.length) {
    console.log('No eligible conversations found.');
    return;
  }

  let groundTruthBefore = null;
  if (groundTruth) {
    const { data } = await supabase
      .from('sales_intelligence_current_attributions')
      .select('case_id,selected_invoice_number,attribution_level,is_official_for_staff_evaluation')
      .eq('case_id', GROUND_TRUTH.caseId)
      .maybeSingle();
    groundTruthBefore = data || null;
  }

  const result = await runBatchPersistence(supabase, {
    conversations,
    dryRun: !apply,
  });
  const readinessAfter = apply ? await fetchItemEvidenceReadinessSnapshot() : null;
  const summary = summarize(result, conversations.length, readinessBefore, readinessAfter);

  if (groundTruth) {
    const target = result.caseAnalyses.find((row) => row.caseId === GROUND_TRUTH.caseId) || null;
    const actualInvoiceNumber = target?.attribution?.selectedInvoiceNumber || null;
    summary.groundTruth = {
      sourceId: GROUND_TRUTH.sourceId,
      caseId: GROUND_TRUTH.caseId,
      before: groundTruthBefore,
      expectedInvoiceNumber: GROUND_TRUTH.expectedInvoiceNumber,
      proposedInvoiceNumber: actualInvoiceNumber,
      proposedAttributionLevel: target?.attribution?.attributionLevel || null,
      proposedHumanReviewReasons: target?.attribution?.humanReviewReasons || [],
      passed: actualInvoiceNumber === GROUND_TRUTH.expectedInvoiceNumber,
    };
    if (!summary.groundTruth.passed) {
      console.error(
        `GROUND TRUTH REGRESSION FAILED: case ${GROUND_TRUTH.caseId} proposed ${actualInvoiceNumber || 'null'}, expected ${GROUND_TRUTH.expectedInvoiceNumber}`
      );
      process.exitCode = 1;
    } else {
      console.log(
        `GROUND TRUTH REGRESSION PASSED: draft invoice 72367 is rejected; proposed final invoice ${GROUND_TRUTH.expectedInvoiceNumber}.`
      );
    }
  }

  if (jsonOutput) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log('\nSummary');
    console.log(JSON.stringify(summary, null, 2));
    if (!apply) {
      console.log('\nNo writes were performed. Re-run with --apply only after reviewing this plan.');
    }
  }

  if (apply && summary.apply && summary.apply.failed > 0) process.exitCode = 1;
})().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
