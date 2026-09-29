import fs from 'node:fs';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import ts from 'typescript';
import { createClient } from '@supabase/supabase-js';

const require = createRequire(import.meta.url);

const ALLOWED_ROLES = new Set(['general_manager', 'admin', 'executive_manager', 'branches_manager']);
const root = process.cwd();

let runtimeLoaded = false;
let runBatchPersistence;
let reviewSourceRowToBatchConversation;

function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function ensureSalesIntelligenceRuntime() {
  if (runtimeLoaded) return;

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
    require.extensions[ext] = function compileTypeScript(mod, filename) {
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
      mod._compile(output, filename);
    };
  }

  globalThis.__VITE_IMPORT_META_ENV__ = {
    DEV: false,
    PROD: true,
    MODE: 'maintenance',
    VITE_SUPABASE_URL: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '',
    VITE_SUPABASE_ANON_KEY: '',
  };

  ({ runBatchPersistence } = require(path.join(root, 'src/lib/salesIntelligence/persistence/batchPersistenceService.ts')));
  ({ reviewSourceRowToBatchConversation } = require(path.join(root, 'src/lib/salesIntelligence/persistence/reviewSourceBatchAdapter.ts')));
  runtimeLoaded = true;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { error: 'method_not_allowed' });
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return json(res, 503, { error: 'server_configuration_missing' });
  }

  const authHeader = String(req.headers.authorization || '');
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) return json(res, 401, { error: 'missing_user_token' });

  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await service.auth.getUser(token);
  const authUser = userData && userData.user;
  if (userError || !authUser) return json(res, 401, { error: 'invalid_user_token' });

  const { data: staff, error: staffError } = await service
    .from('staff_accounts')
    .select('id,role,active,is_active,status,can_login')
    .eq('auth_user_id', authUser.id)
    .maybeSingle();

  if (staffError) return json(res, 500, { error: 'staff_lookup_failed' });
  const active = Boolean(staff && staff.active) && Boolean(staff && staff.is_active) && staff.status === 'active' && staff.can_login !== false;
  if (!staff || !active || !ALLOWED_ROLES.has(String(staff.role || ''))) {
    return json(res, 403, { error: 'not_authorized_for_sales_intelligence_refresh' });
  }

  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body || '{}'); }
    catch { return json(res, 400, { error: 'invalid_json_body' }); }
  }

  const sourceId = String(body.sourceId || '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sourceId)) {
    return json(res, 400, { error: 'invalid_source_id' });
  }

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

  const { data: source, error: sourceError } = await service
    .from('whatsapp_review_sources')
    .select(select)
    .eq('id', sourceId)
    .maybeSingle();

  if (sourceError) return json(res, 500, { error: 'source_lookup_failed', detail: sourceError.message });
  if (!source || typeof source.raw_text !== 'string' || !source.raw_text.trim()) {
    return json(res, 404, { error: 'source_not_found_or_empty' });
  }

  try {
    ensureSalesIntelligenceRuntime();

    const [{ data: rootCases, error: rootCaseError }, { data: memberCases, error: memberCaseError }] = await Promise.all([
      service
        .from('whatsapp_customer_cases_v22')
        .select('id')
        .eq('root_source_id', sourceId)
        .limit(3),
      service
        .from('whatsapp_customer_cases_v22')
        .select('id')
        .contains('source_ids', [sourceId])
        .limit(3),
    ]);
    if (rootCaseError || memberCaseError) {
      return json(res, 500, {
        error: 'canonical_case_identity_lookup_failed',
        detail: rootCaseError?.message || memberCaseError?.message || 'unknown_case_lookup_error',
      });
    }
    const caseIds = Array.from(new Set([...(rootCases || []), ...(memberCases || [])].map((row) => String(row.id || '')).filter(Boolean)));
    const sourceCaseIdV22 = caseIds.length === 1 ? caseIds[0] : null;

    const conversation = reviewSourceRowToBatchConversation({
      ...source,
      source_case_id_v22: sourceCaseIdV22,
    });
    const result = await runBatchPersistence(service, {
      conversations: [conversation],
      dryRun: false,
    });

    const outcomes = result.caseOutcomes || [];
    const failures = outcomes.filter((row) => !row.success);

    // Reconcile ONLY fully-persisted cases whose in-memory canonical verdict is sale_proven.
    // The RPC re-reads the persisted analysis/attribution/match and is the authority for the V22 write;
    // this filter only avoids unnecessary RPC calls for non-sale cases.
    const successfulCaseIds = new Set(outcomes.filter((row) => row.success).map((row) => row.caseId));
    const provenCaseIds = result.caseAnalyses
      .filter((row) =>
        successfulCaseIds.has(row.caseId) &&
        row.salesOutcome?.outcome === 'sale_proven' &&
        row.salesOutcome?.saleProofState === 'proven'
      )
      .map((row) => row.caseId);

    const canonicalReconciliation = [];
    for (const salesCaseId of provenCaseIds) {
      const { data: reconcileData, error: reconcileError } = await service.rpc(
        'dawaa_reconcile_sales_intelligence_case_v22_v1',
        { p_sales_case_id: salesCaseId }
      );
      canonicalReconciliation.push({
        caseId: salesCaseId,
        ...(reconcileError
          ? { ok: false, status: 'rpc_error', error: reconcileError.message }
          : (reconcileData || { ok: false, status: 'empty_reconcile_result' })),
      });
    }

    const reconciliationTransportFailures = canonicalReconciliation.filter((row) => row.status === 'rpc_error');
    if (failures.length || reconciliationTransportFailures.length) {
      return json(res, 500, {
        error: failures.length ? 'canonical_refresh_partial_failure' : 'canonical_reconciliation_failure',
        sourceId,
        failures: failures.map((row) => ({ caseId: row.caseId, error: row.error })),
        canonicalReconciliation,
      });
    }

    return json(res, 200, {
      ok: true,
      sourceId,
      sourceCaseIdV22,
      caseIdentityStatus: caseIds.length === 1 ? 'linked' : caseIds.length === 0 ? 'missing' : 'ambiguous',
      caseIdentityCandidates: caseIds,
      canonicalReconciliation,
      derivedCases: result.caseAnalyses.map((row) => ({
        caseId: row.caseId,
        status: row.status,
        customerId: row.conversationCase.customerId,
        customerPhone: row.conversationCase.customerPhone,
        selectedInvoiceNumber: row.attribution.selectedInvoiceNumber,
        attributionLevel: row.attribution.attributionLevel,
        saleProofState: row.salesOutcome ? row.salesOutcome.saleProofState : null,
        failureReasons: row.failureReasons,
      })),
      plan: {
        casesToInsert: result.plan.casesToInsert.length,
        casesToUpdateCanonicalIdentity: result.plan.casesToUpdateCanonicalIdentity.length,
        casesUnchanged: result.plan.casesUnchanged.length,
        analysesToInsert: result.plan.analysesToInsert.length,
        analysesToSupersede: result.plan.analysesToSupersede.length,
        attributionsToInsert: result.plan.attributionsToInsert.length,
        matchesToInsert: result.plan.matchesToInsert.length,
        conflicts: result.plan.conflicts,
        warnings: result.plan.warnings,
      },
    });
  } catch (error) {
    return json(res, 500, {
      error: 'canonical_refresh_failed',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
