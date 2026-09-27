import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
const ALLOWED_ROLES = new Set(['general_manager', 'admin', 'executive_manager', 'branches_manager']);

function json(res: any, status: number, body: unknown) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

async function reconcileSoldCustomerRequestActions(
  service: any,
  sourceId: string,
  caseAnalyses: any[]
) {
  const { data: actions, error: actionsError } = await service
    .from('whatsapp_conversation_actions')
    .select('id,action_key,action_type,status,work_status,product_id,product_code,product_name,quantity,payload,confidence')
    .eq('source_id', sourceId)
    .eq('action_type', 'customer_request')
    .in('status', ['proposed', 'ready', 'created']);

  if (actionsError) throw actionsError;
  if (!actions?.length) return { reconciledActions: 0 };

  let reconciledActions = 0;
  const reconciledIds = new Set<string>();

  for (const analysis of caseAnalyses) {
    const attribution = analysis?.attribution;
    const match = analysis?.basketInvoiceMatch;
    const invoiceId = String(attribution?.selectedInvoiceId || '').trim();
    const invoiceNumber = String(attribution?.selectedInvoiceNumber || '').trim();
    const attributionLevel = String(attribution?.attributionLevel || '');
    const contradictions = Array.isArray(attribution?.contradictions) ? attribution.contradictions : [];

    if (!invoiceId || !invoiceNumber) continue;
    if (!['proven', 'strongly_inferred'].includes(attributionLevel)) continue;
    if (contradictions.length > 0) continue;
    if (match?.itemMatch !== 'exact' || match?.itemEvidenceReady !== true) continue;

    const { data: invoiceItems, error: invoiceItemsError } = await service
      .from('sales_invoice_items_v21')
      .select('invoice_id,invoice_number,product_id,product_code,product_name,quantity,line_total')
      .eq('invoice_id', invoiceId);

    if (invoiceItemsError) throw invoiceItemsError;
    if (!invoiceItems?.length) continue;

    const invoiceValue = invoiceItems.reduce(
      (sum: number, row: any) => sum + (Number(row.line_total) || 0),
      0
    );

    for (const action of actions) {
      if (reconciledIds.has(String(action.id))) continue;
      if (!action.product_id) continue;

      const matchingLines = invoiceItems.filter(
        (row: any) => String(row.product_id || '') === String(action.product_id)
      );
      if (!matchingLines.length) continue;

      const soldQuantity = matchingLines.reduce(
        (sum: number, row: any) => sum + (Number(row.quantity) || 0),
        0
      );
      const primaryLine = matchingLines[0];
      const requestPrefix = String(action.action_key || '').match(/^(request:\d+:)/)?.[1] || null;
      const relatedActions = actions.filter((candidate: any) => {
        if (reconciledIds.has(String(candidate.id))) return false;
        if (String(candidate.id) === String(action.id)) return true;
        if (!requestPrefix) return false;
        return (
          String(candidate.action_key || '').startsWith(requestPrefix) &&
          !candidate.product_id
        );
      });

      for (const related of relatedActions) {
        const nowIso = new Date().toISOString();
        const payload =
          related.payload && typeof related.payload === 'object' && !Array.isArray(related.payload)
            ? related.payload
            : {};

        const canonicalSale = {
          case_id: analysis.caseId,
          invoice_id: invoiceId,
          invoice_number: invoiceNumber,
          product_id: String(primaryLine.product_id || action.product_id || ''),
          product_code: String(primaryLine.product_code || action.product_code || ''),
          product_name: String(primaryLine.product_name || action.product_name || ''),
          sold_quantity: soldQuantity,
          invoice_value: invoiceValue,
          attribution_level: attributionLevel,
          item_match: match.itemMatch,
          verified_at: nowIso,
        };

        const { error: updateError } = await service
          .from('whatsapp_conversation_actions')
          .update({
            status: 'dismissed',
            work_status: 'completed',
            outcome: 'sold',
            outcome_note: 'تم إغلاق طلب العميل تلقائيًا بعد إثبات البيع وربطه بفاتورة فعلية.',
            completed_at: nowIso,
            target_table: 'sales_invoices',
            target_id: invoiceId,
            reason: 'تم إثبات بيع الطلب وربطه بفاتورة فعلية؛ لا يحتاج متابعة كطلب غير مغلق.',
            payload: { ...payload, canonical_sale: canonicalSale },
            updated_at: nowIso,
          })
          .eq('id', related.id);

        if (updateError) throw updateError;
        reconciledIds.add(String(related.id));
        reconciledActions += 1;
      }
    }
  }

  return { reconciledActions };
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { error: 'method_not_allowed' });
  }

  const supabaseUrl =
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    'https://jkjqeqkshllustwlzzbf.supabase.co';
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
  const sourceFileName = String(body.sourceFileName || '').trim();
  const sourceOffset = Math.max(0, Number(body.sourceOffset) || 0);
  const requestedSourceLimit = Math.max(1, Math.min(10, Number(body.sourceLimit) || 10));
  const validSourceId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sourceId);

  if (!validSourceId && !sourceFileName) {
    return json(res, 400, { error: 'source_id_or_file_name_required' });
  }
  if (sourceFileName.length > 240) {
    return json(res, 400, { error: 'source_file_name_too_long' });
  }

  const select = [
    'id','raw_text','source_filename','conversation_started_at','conversation_ended_at',
    'message_count','created_at','customer_id','customer_phone','customer_name','customer_code',
    'branch','matched_invoice_id','matched_invoice_number','invoice_match_status','reviewer_confirmed','reviewer_id'
  ].join(',');

  let sourceRows: Record<string, unknown>[] = [];
  let totalSourceCount: number | null = null;
  if (sourceFileName) {
    const { count, error: countError } = await service
      .from('whatsapp_review_sources')
      .select('id', { count: 'exact', head: true })
      .eq('source_filename', sourceFileName);
    if (countError) return json(res, 500, { error: 'source_count_failed', detail: countError.message });
    totalSourceCount = Number(count || 0);

    const { data, error } = await service
      .from('whatsapp_review_sources')
      .select(select)
      .eq('source_filename', sourceFileName)
      .order('conversation_started_at', { ascending: true, nullsFirst: true })
      .order('id', { ascending: true })
      .range(sourceOffset, sourceOffset + requestedSourceLimit - 1);
    if (error) return json(res, 500, { error: 'source_lookup_failed', detail: error.message });
    sourceRows = (data || []) as unknown as Record<string, unknown>[];
  } else {
    const { data, error } = await service
      .from('whatsapp_review_sources')
      .select(select)
      .eq('id', sourceId)
      .maybeSingle();
    if (error) return json(res, 500, { error: 'source_lookup_failed', detail: error.message });
    sourceRows = data ? [data as unknown as Record<string, unknown>] : [];
  }

  const sources = sourceRows.filter(
    (row) => typeof row.raw_text === 'string' && String(row.raw_text).trim().length > 0
  );
  if (!sources.length) {
    return json(res, 404, { error: 'source_not_found_or_empty' });
  }

  try {
    const [{ runBatchPersistence }, { reviewSourceRowToBatchConversation }] = await Promise.all([
      import('../src/lib/salesIntelligence/persistence/batchPersistenceService'),
      import('../src/lib/salesIntelligence/persistence/reviewSourceBatchAdapter'),
    ]);
    const conversations = sources.map((source) => reviewSourceRowToBatchConversation(source as any));
    const result = await runBatchPersistence(service, {
      conversations,
      dryRun: false,
    });

    const outcomes = result.caseOutcomes || [];
    const failures = outcomes.filter((row) => !row.success);
    if (failures.length) {
      return json(res, 500, {
        error: 'canonical_refresh_partial_failure',
        sourceId: validSourceId ? sourceId : null,
        sourceFileName: sourceFileName || null,
        sourceCount: sources.length,
        failures: failures.map((row) => ({ caseId: row.caseId, error: row.error })),
      });
    }

    let reconciledActions = 0;
    for (const source of sources) {
      const id = String(source.id || '');
      if (!id) continue;
      const sourceAnalyses = result.caseAnalyses.filter((row) => row.conversationId === id);
      const reconciliation = await reconcileSoldCustomerRequestActions(
        service,
        id,
        sourceAnalyses as any[]
      );
      reconciledActions += reconciliation.reconciledActions;
    }

    return json(res, 200, {
      ok: true,
      sourceId: validSourceId ? sourceId : null,
      sourceFileName: sourceFileName || null,
      sourceCount: sources.length,
      totalSourceCount,
      sourceOffset: sourceFileName ? sourceOffset : null,
      sourceLimit: sourceFileName ? requestedSourceLimit : null,
      nextOffset: sourceFileName ? sourceOffset + sourceRows.length : null,
      hasMore: sourceFileName ? sourceOffset + sourceRows.length < Number(totalSourceCount || 0) : false,
      actionReconciliation: { reconciledActions },
      derivedCases: result.caseAnalyses.map((row) => ({
        conversationId: row.conversationId,
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
    console.error('[sales-intelligence-refresh-source] canonical refresh failed', {
      sourceId: validSourceId ? sourceId : null,
      sourceFileName: sourceFileName || null,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
    });
    return json(res, 500, {
      error: 'canonical_refresh_failed',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
