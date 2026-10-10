// HTTP transport for the canonical Sales Intelligence refresh.
// It authenticates the actor (staff session), parses the request and loads source rows.
// Every business rule lives in src/lib/salesIntelligence/refresh/canonicalRefreshService.ts.
// api/sales-intelligence-refresh-source.js is GENERATED from this file
// (scripts/build-sales-intelligence-refresh-api.cjs) and must never be edited by hand.
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import {
  CANONICAL_REFRESH_SOURCE_COLUMNS,
  runCanonicalSalesIntelligenceRefresh,
} from '../src/lib/salesIntelligence/refresh/canonicalRefreshService';
import { refreshCustomerStoryProjectionsForSources } from '../src/lib/salesIntelligence/refresh/storyProjectionRefresh';
import { evaluateDeployEnvironment } from '../src/lib/deployEnvironmentGuard';

const ALLOWED_ROLES = new Set([
  'general_manager',
  'admin',
  'executive_manager',
  'branches_manager',
]);

function json(res: any, status: number, body: unknown) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { error: 'method_not_allowed' });
  }

  // Fail closed: no default project. A preview must prove it uses the staging project only.
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  if (!supabaseUrl) return json(res, 503, { error: 'missing_supabase_url' });
  const deployEnvironment = evaluateDeployEnvironment(process.env);
  if (!deployEnvironment.ok) return json(res, 503, { error: 'deploy_environment_isolation_failed' });
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    return json(res, 503, { error: 'missing_service_role_key' });
  }

  const authHeader = String(req.headers.authorization || '');
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) return json(res, 401, { error: 'missing_user_token' });

  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const tokenHash = createHash('sha256').update(token).digest('hex');
  const { data: loginSession, error: sessionLookupError } = await service
    .from('staff_login_sessions')
    .select('id,staff_account_id,expires_at,revoked_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (sessionLookupError) return json(res, 500, { error: 'staff_session_lookup_failed' });
  if (
    !loginSession ||
    loginSession.revoked_at ||
    new Date(loginSession.expires_at).getTime() <= Date.now()
  ) {
    return json(res, 401, { error: 'invalid_or_expired_staff_session' });
  }

  const { data: staff, error: staffError } = await service
    .from('staff_accounts')
    .select('id,role,active,is_active,status,can_login')
    .eq('id', loginSession.staff_account_id)
    .maybeSingle();

  if (staffError) return json(res, 500, { error: 'staff_lookup_failed' });
  const active =
    Boolean(staff?.active) &&
    Boolean(staff?.is_active) &&
    staff?.status === 'active' &&
    staff?.can_login !== false;
  if (!staff || !active || !ALLOWED_ROLES.has(String(staff.role || ''))) {
    return json(res, 403, { error: 'not_authorized_for_sales_intelligence_refresh' });
  }

  const sessionRefreshAt = new Date();
  const sessionRefreshExpiry = new Date(sessionRefreshAt.getTime() + 12 * 60 * 60 * 1000);
  const { error: sessionRefreshError } = await service
    .from('staff_login_sessions')
    .update({
      last_used_at: sessionRefreshAt.toISOString(),
      expires_at: sessionRefreshExpiry.toISOString(),
    })
    .eq('id', loginSession.id);
  if (sessionRefreshError) {
    console.warn(
      '[sales-intelligence-refresh-source] staff session sliding refresh failed',
      sessionRefreshError.message
    );
  }

  let body = req.body || {};
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body || '{}');
    } catch {
      return json(res, 400, { error: 'invalid_json_body' });
    }
  }

  const sourceId = String(body.sourceId || '').trim();
  const sourceFileName = String(body.sourceFileName || '').trim();
  const sourceOffset = Math.max(0, Number(body.sourceOffset) || 0);
  const requestedSourceLimit = Math.max(1, Math.min(10, Number(body.sourceLimit) || 10));
  const validSourceId =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sourceId);

  if (!validSourceId && !sourceFileName) {
    return json(res, 400, { error: 'source_id_or_file_name_required' });
  }
  if (sourceFileName.length > 240) {
    return json(res, 400, { error: 'source_file_name_too_long' });
  }

  let sourceRows: Record<string, unknown>[] = [];
  let totalSourceCount: number | null = null;
  if (sourceFileName) {
    const { count, error: countError } = await service
      .from('whatsapp_review_sources')
      .select('id', { count: 'exact', head: true })
      .eq('source_filename', sourceFileName);
    if (countError)
      return json(res, 500, { error: 'source_count_failed', detail: countError.message });
    totalSourceCount = Number(count || 0);

    const { data, error } = await service
      .from('whatsapp_review_sources')
      .select(CANONICAL_REFRESH_SOURCE_COLUMNS)
      .eq('source_filename', sourceFileName)
      .order('conversation_started_at', { ascending: true, nullsFirst: true })
      .order('id', { ascending: true })
      .range(sourceOffset, sourceOffset + requestedSourceLimit - 1);
    if (error) return json(res, 500, { error: 'source_lookup_failed', detail: error.message });
    sourceRows = (data || []) as unknown as Record<string, unknown>[];
  } else {
    const { data, error } = await service
      .from('whatsapp_review_sources')
      .select(CANONICAL_REFRESH_SOURCE_COLUMNS)
      .eq('id', sourceId)
      .maybeSingle();
    if (error) return json(res, 500, { error: 'source_lookup_failed', detail: error.message });
    sourceRows = data ? [data as unknown as Record<string, unknown>] : [];
  }

  if (
    !sourceRows.some(
      (row) => typeof row.raw_text === 'string' && String(row.raw_text).trim().length > 0
    )
  ) {
    return json(res, 404, { error: 'source_not_found_or_empty' });
  }

  const page = {
    sourceId: validSourceId ? sourceId : null,
    sourceFileName: sourceFileName || null,
    totalSourceCount,
    sourceOffset: sourceFileName ? sourceOffset : null,
    sourceLimit: sourceFileName ? requestedSourceLimit : null,
    nextOffset: sourceFileName ? sourceOffset + sourceRows.length : null,
    hasMore: sourceFileName
      ? sourceOffset + sourceRows.length < Number(totalSourceCount || 0)
      : false,
  };

  let refresh;
  try {
    refresh = await runCanonicalSalesIntelligenceRefresh(service, {
      sources: sourceRows,
      dryRun: false,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
          ? error.message
          : String(error);
    console.error('[sales-intelligence-refresh-source] canonical refresh failed', {
      ...page,
      message,
      stack: error instanceof Error ? error.stack : null,
    });
    return json(res, 500, {
      error: message.startsWith('canonical_source_gate_')
        ? 'canonical_source_gate_lookup_failed'
        : 'canonical_refresh_failed',
      detail: message,
    });
  }

  // Side projection AFTER the canonical refresh: Story V16 aggregates for the admitted (V22-owned)
  // sources. Best-effort and reported separately — it never changes the canonical status below.
  const storyProjection = await refreshCustomerStoryProjectionsForSources(
    service,
    refresh.admittedSourceIds || []
  );
  if (storyProjection.errors.length) {
    console.warn('[sales-intelligence-refresh-source] story projection refresh incomplete', {
      ...page,
      errors: storyProjection.errors,
    });
  }
  const sideProjections = { story: storyProjection };

  // A single-source request that the Canonical Source Gate refused is an explicit 409.
  if (!sourceFileName && refresh.blockedSources.length) {
    return json(res, 409, { ...refresh.blockedSources[0], sourceId });
  }
  if (
    refresh.status === 'persistence_partial_failure' ||
    refresh.status === 'case_set_reconciliation_failure' ||
    refresh.status === 'proof_bridge_transport_failure'
  ) {
    const errorCode =
      refresh.status === 'persistence_partial_failure'
        ? 'canonical_refresh_partial_failure'
        : refresh.status === 'case_set_reconciliation_failure'
          ? 'case_set_reconciliation_failure'
          : 'canonical_reconciliation_failure';
    return json(res, 500, {
      error: errorCode,
      ...page,
      sourceCount: refresh.admittedSourceIds.length,
      blockedSources: refresh.blockedSources,
      failures: refresh.persistenceFailures,
      caseSetReconciliation: refresh.caseSetReconciliation,
      canonicalReconciliation: refresh.canonicalReconciliation,
      sideProjections,
    });
  }

  const batch = refresh.batch;
  return json(res, 200, {
    ok: true,
    ...page,
    sourceCount: refresh.admittedSourceIds.length,
    blockedSources: refresh.blockedSources,
    caseSetReconciliation: refresh.caseSetReconciliation,
    canonicalReconciliation: refresh.canonicalReconciliation,
    actionReconciliation: refresh.actionReconciliation,
    complaintEnrichment: refresh.complaintEnrichment,
    semanticProjection: refresh.semanticProjection,
    conversationEvaluations: refresh.conversationEvaluations,
    sideProjections,
    derivedCases: (batch?.caseAnalyses || []).map((row: any) => ({
      conversationId: row.conversationId,
      caseId: row.caseId,
      status: row.status,
      sourceCaseIdV22: row.conversationCase?.sourceCaseIdV22 ?? null,
      customerId: row.conversationCase.customerId,
      customerPhone: row.conversationCase.customerPhone,
      selectedInvoiceNumber: row.attribution.selectedInvoiceNumber,
      attributionLevel: row.attribution.attributionLevel,
      salesOutcome: row.salesOutcome?.outcome ?? null,
      saleProofState: row.salesOutcome?.saleProofState ?? null,
      // Canonical read-only summary for ingestion UIs (Smart Folder): Product/Need and the
      // canonical Operational Disposition, straight from this analysis — never re-derived client-side.
      primaryNeed: row.customerNeed?.primaryNeed ?? null,
      products: (row.customerNeed?.products || []).map((product: any) => ({
        name: product.productNameRaw ?? product.key ?? null,
        productId: product.productId ?? null,
        availability: product.availability ?? null,
      })),
      operationalDisposition: row.operationalDisposition
        ? {
            state: row.operationalDisposition.state,
            waitingOn: row.operationalDisposition.waitingOn,
            actionOwner: row.operationalDisposition.actionOwner,
            nextBestAction: row.operationalDisposition.nextBestAction,
            assignedStaffName: row.operationalDisposition.assignedStaffName,
            decisiveFollowUpReason: row.operationalDisposition.decisiveFollowUpReason,
          }
        : null,
      failureReasons: row.failureReasons,
    })),
    plan: batch
      ? {
          casesToInsert: batch.plan.casesToInsert.length,
          casesToUpdateCanonicalIdentity: batch.plan.casesToUpdateCanonicalIdentity.length,
          casesUnchanged: batch.plan.casesUnchanged.length,
          analysesToInsert: batch.plan.analysesToInsert.length,
          analysesToSupersede: batch.plan.analysesToSupersede.length,
          attributionsToInsert: batch.plan.attributionsToInsert.length,
          matchesToInsert: batch.plan.matchesToInsert.length,
          conflicts: batch.plan.conflicts,
          warnings: batch.plan.warnings,
        }
      : null,
  });
}
