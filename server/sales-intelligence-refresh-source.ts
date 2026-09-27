import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
const ALLOWED_ROLES = new Set(['general_manager', 'admin', 'executive_manager', 'branches_manager']);

function json(res: any, status: number, body: unknown) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

export default async function handler(req: any, res: any) {
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

  const tokenHash = createHash('sha256').update(token).digest('hex');
  const { data: loginSession, error: sessionLookupError } = await service
    .from('staff_login_sessions')
    .select('id,staff_account_id,expires_at,revoked_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (sessionLookupError) return json(res, 500, { error: 'staff_session_lookup_failed' });
  if (!loginSession || loginSession.revoked_at || new Date(loginSession.expires_at).getTime() <= Date.now()) {
    return json(res, 401, { error: 'invalid_or_expired_staff_session' });
  }

  const { data: staff, error: staffError } = await service
    .from('staff_accounts')
    .select('id,role,active,is_active,status,can_login')
    .eq('id', loginSession.staff_account_id)
    .maybeSingle();

  if (staffError) return json(res, 500, { error: 'staff_lookup_failed' });
  const active = Boolean(staff?.active) && Boolean(staff?.is_active) && staff?.status === 'active' && staff?.can_login !== false;
  if (!staff || !active || !ALLOWED_ROLES.has(String(staff.role || ''))) {
    return json(res, 403, { error: 'not_authorized_for_sales_intelligence_refresh' });
  }

  void service
    .from('staff_login_sessions')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', loginSession.id);

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
    'id','raw_text','source_filename','conversation_started_at','conversation_ended_at',
    'message_count','created_at','customer_id','customer_phone','customer_name','customer_code',
    'branch','matched_invoice_id','matched_invoice_number','invoice_match_status','reviewer_confirmed','reviewer_id'
  ].join(',');

  const { data: sourceData, error: sourceError } = await service
    .from('whatsapp_review_sources')
    .select(select)
    .eq('id', sourceId)
    .maybeSingle();

  if (sourceError) return json(res, 500, { error: 'source_lookup_failed', detail: sourceError.message });
  const source = sourceData as unknown as Record<string, unknown> | null;
  if (!source || typeof source.raw_text !== 'string' || !source.raw_text.trim()) {
    return json(res, 404, { error: 'source_not_found_or_empty' });
  }

  try {
    const [{ runBatchPersistence }, { reviewSourceRowToBatchConversation }] = await Promise.all([
      import('../src/lib/salesIntelligence/persistence/batchPersistenceService'),
      import('../src/lib/salesIntelligence/persistence/reviewSourceBatchAdapter'),
    ]);
    const conversation = reviewSourceRowToBatchConversation(source as any);
    const result = await runBatchPersistence(service, {
      conversations: [conversation],
      dryRun: false,
    });

    const outcomes = result.caseOutcomes || [];
    const failures = outcomes.filter((row) => !row.success);
    if (failures.length) {
      return json(res, 500, {
        error: 'canonical_refresh_partial_failure',
        sourceId,
        failures: failures.map((row) => ({ caseId: row.caseId, error: row.error })),
      });
    }

    return json(res, 200, {
      ok: true,
      sourceId,
      derivedCases: result.caseAnalyses.map((row) => ({
        caseId: row.caseId,
        status: row.status,
        customerId: row.conversationCase.customerId,
        customerPhone: row.conversationCase.customerPhone,
        selectedInvoiceNumber: row.attribution.selectedInvoiceNumber,
        attributionLevel: row.attribution.attributionLevel,
        saleProofState: row.salesOutcome?.saleProofState ?? null,
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
