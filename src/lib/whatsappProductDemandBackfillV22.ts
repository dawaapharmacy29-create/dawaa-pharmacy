import { supabase } from '@/lib/supabase';
import { selectCanonicalReviewSourceIds } from '@/lib/salesIntelligence/sourceSnapshotLineage';
import { parseWhatsAppExport, splitWhatsAppSessions, type WhatsAppConversationSession } from '@/lib/whatsappConversationParser';
import { buildUnifiedConversationIntelligence } from '@/lib/whatsappUnifiedIntelligenceV4';
import {
  buildWhatsAppOperationalIntelligenceV6,
  enrichWhatsAppOperationalProductsV6,
  syncWhatsAppOperationalActionsV6,
} from '@/lib/whatsappOperationalIntelligenceV6';
import { enrichWhatsAppOperationalJourneysV7 } from '@/lib/whatsappProductJourneyV7';
import { planProductOpportunityTruthV23, syncWhatsAppEvidenceLedgerV17 } from '@/lib/whatsappEvidenceLedgerV17';
import {
  collectPriorCanonicalProductCodesV22,
  findDroppedPriorCanonicalCodesV22,
} from '@/lib/whatsappProductDemandBackfillQualityGateV22';

export interface ProductDemandBackfillOptionsV22 {
  limit?: number;
  dryRun?: boolean;
  sourceIds?: string[];
  force?: boolean;
  dryRunConcurrency?: number;
  onProgress?: (processed: number, total: number) => void;
}

export interface ProductTruthChangeV23 {
  productId: string | null;
  productCode: string | null;
  productName: string | null;
  beforeStage: string | null;
  beforeInvoiceNumber: string | null;
  beforeLeakageCode: string | null;
  afterStage: string;
  afterInvoiceNumber: string | null;
  afterInvoiceValue: number | null;
  afterLeakageCode: string | null;
  saleVerifiedScope: string;
  productEvidence: string | null;
  timeDistanceMinutes: number | null;
}

export interface ProductDemandBackfillSourceResultV22 {
  sourceId: string;
  status: 'ready' | 'written' | 'skipped' | 'failed';
  reason: string | null;
  canonicalProducts: number;
  unresolvedProducts: number;
  productCodes: string[];
  canonicalProductNames: string[];
  unresolvedExamples: string[];
  priorCanonicalProductCodes: string[];
  droppedPriorCanonicalCodes: string[];
  productTruthChanges?: ProductTruthChangeV23[];
}

export interface ProductDemandBackfillResultV22 {
  version: 'product-demand-backfill-v22.1';
  dryRun: boolean;
  eligibleSources: number;
  truncated: boolean;
  scanned: number;
  ready: number;
  written: number;
  skipped: number;
  failed: number;
  canonicalProducts: number;
  unresolvedProducts: number;
  rows: ProductDemandBackfillSourceResultV22[];
}

type SourceRow = {
  id: string;
  source_filename: string | null;
  raw_text: string | null;
  conversation_started_at: string | null;
  conversation_ended_at: string | null;
  branch: string | null;
  customer_id: string | null;
  customer_code: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  staff_id: string | null;
  staff_name: string | null;
  created_by: string | null;
  message_count: number | null;
  created_at: string | null;
  analysis_json: Record<string, any> | null;
};

function buildProductDemandSession(
  sessions: WhatsAppConversationSession[],
  startedAt: string | null,
  endedAt: string | null
) {
  if (!sessions.length) return null;
  if (sessions.length === 1) return sessions[0];

  const start = startedAt ? new Date(startedAt).getTime() : NaN;
  const end = endedAt ? new Date(endedAt).getTime() : NaN;
  const relevant = sessions.filter((session) => {
    if (!Number.isFinite(start) || !Number.isFinite(end)) return true;
    return session.endedAt.getTime() >= start && session.startedAt.getTime() <= end;
  });
  const selected = relevant.length ? relevant : sessions;
  const messages = selected.flatMap((session) => session.messages)
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  if (!messages.length) return null;

  const participants = Array.from(new Set(selected.flatMap((session) => session.participants)));
  const outboundStaffNames = Array.from(new Set(selected.flatMap((session) => session.outboundStaffNames)));
  return {
    id: selected.map((session) => session.id).join('+'),
    startedAt: messages[0].timestamp,
    endedAt: messages[messages.length - 1].timestamp,
    messages,
    participants,
    outboundStaffNames,
    customerName: selected.find((session) => session.customerName)?.customerName ?? null,
    mediaCount: selected.reduce((sum, session) => sum + Number(session.mediaCount || 0), 0),
    missingMediaCount: selected.reduce((sum, session) => sum + Number(session.missingMediaCount || 0), 0),
    replyCount: selected.reduce((sum, session) => sum + Number(session.replyCount || 0), 0),
    forwardedCount: selected.reduce((sum, session) => sum + Number(session.forwardedCount || 0), 0),
  } satisfies WhatsAppConversationSession;
}

async function loadSources(options: ProductDemandBackfillOptionsV22): Promise<{ rows: SourceRow[]; eligibleSources: number; truncated: boolean }> {
  const limit = Math.max(1, Math.min(500, options.limit ?? 20));
  const rows: SourceRow[] = [];
  const pageSize = 500;
  let from = 0;

  // Product Demand must use the SAME canonical source lineage as Sales Intelligence.
  // Fetch the complete source set first; otherwise an older partial snapshot can look canonical
  // simply because its fuller replacement fell outside a small "latest N" query window.
  while (true) {
    const { data, error } = await supabase
      .from('whatsapp_review_sources')
      .select('id,source_filename,raw_text,conversation_started_at,conversation_ended_at,branch,customer_id,customer_code,customer_name,customer_phone,staff_id,staff_name,created_by,message_count,created_at,analysis_json')
      .order('conversation_started_at', { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...((data || []) as SourceRow[]));
    if ((data || []).length < pageSize) break;
    from += pageSize;
  }

  const canonicalIds = selectCanonicalReviewSourceIds(rows);
  let canonicalRows = rows.filter(
    (row) => canonicalIds.has(row.id) && typeof row.raw_text === 'string' && row.raw_text.trim().length > 0
  );

  if (options.sourceIds?.length) {
    const requested = new Set(options.sourceIds);
    canonicalRows = canonicalRows.filter((row) => requested.has(row.id));
  }

  const filtered = options.force || options.sourceIds?.length
    ? canonicalRows
    : canonicalRows.filter((row) => row.analysis_json?.productDemandTruthVersion !== 'product-invoice-truth-v23.1');

  return {
    rows: filtered.slice(0, limit),
    eligibleSources: filtered.length,
    truncated: filtered.length > limit,
  };
}

function backfillErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const row = error as Record<string, unknown>;
    const message = [row.message, row.details, row.hint, row.code].filter(Boolean).map(String).join(' | ');
    if (message) return message;
    try { return JSON.stringify(row); } catch { return 'خطأ غير معروف أثناء إعادة التحليل.'; }
  }
  return String(error || 'خطأ غير معروف أثناء إعادة التحليل.');
}

async function processProductDemandSourceV22(
  source: SourceRow,
  dryRun: boolean
): Promise<ProductDemandBackfillSourceResultV22> {
  try {
    const raw = String(source.raw_text || '').trim();
    if (!raw) {
      return { sourceId: source.id, status: 'skipped', reason: 'النص الأصلي للمحادثة غير متاح.', canonicalProducts: 0, unresolvedProducts: 0, productCodes: [], canonicalProductNames: [], unresolvedExamples: [], priorCanonicalProductCodes: [], droppedPriorCanonicalCodes: [] };
    }

    const parsed = parseWhatsAppExport(raw, {
      trustedConversationStartedAt: source.conversation_started_at || undefined,
    });
    const session = buildProductDemandSession(
      splitWhatsAppSessions(parsed, 120),
      source.conversation_started_at,
      source.conversation_ended_at
    );
    if (!session) {
      return { sourceId: source.id, status: 'skipped', reason: 'تعذر تكوين جلسة محادثة صالحة للتحليل.', canonicalProducts: 0, unresolvedProducts: 0, productCodes: [], canonicalProductNames: [], unresolvedExamples: [], priorCanonicalProductCodes: [], droppedPriorCanonicalCodes: [] };
    }

    const base = buildUnifiedConversationIntelligence(session);
    const operational0 = buildWhatsAppOperationalIntelligenceV6(session, base);
    const operational1 = await enrichWhatsAppOperationalProductsV6(operational0, session);
    const operational = enrichWhatsAppOperationalJourneysV7(session, operational1);

    const canonical = operational.products.filter((product) => Boolean(product.productId && product.productCode));
    const unresolved = operational.products.filter((product) => !product.productId);
    const productCodes = Array.from(new Set(canonical.map((product) => String(product.productCode)).filter(Boolean)));
    const { data: priorRows, error: priorError } = await supabase
      .from('whatsapp_sales_opportunities_v17')
      .select('product_code,product_id,product_name,current_stage,matched_invoice_number,evidence_json,analysis_version')
      .eq('root_source_id', source.id)
      .in('analysis_version', ['product-demand-v22', 'product-demand-v22.1'])
      .not('product_id', 'is', null);
    if (priorError) throw priorError;

    const priorCanonicalProductCodes = collectPriorCanonicalProductCodesV22(priorRows || []);
    const droppedPriorCanonicalCodes = findDroppedPriorCanonicalCodesV22(
      priorCanonicalProductCodes,
      productCodes
    );

    if (droppedPriorCanonicalCodes.length) {
      return {
        sourceId: source.id,
        status: 'failed',
        reason: 'تم إيقاف الحالة لأن التحليل الجديد أسقط صنفًا كان مرتبطًا سابقًا بالكتالوج: ' + droppedPriorCanonicalCodes.join('، '),
        canonicalProducts: canonical.length,
        unresolvedProducts: unresolved.length,
        productCodes,
        canonicalProductNames: Array.from(new Set(canonical.map((product) => String(product.canonicalName || product.rawName)).filter(Boolean))).slice(0, 12),
        unresolvedExamples: Array.from(new Set(unresolved.map((product) => String(product.rawName || '').trim()).filter(Boolean))).slice(0, 12),
        priorCanonicalProductCodes,
        droppedPriorCanonicalCodes,
      };
    }


    const priorByProduct = new Map<string, any>();
    for (const row of priorRows || []) {
      const key = String((row as any).product_id || (row as any).product_code || '').trim();
      if (key) priorByProduct.set(key, row);
    }

    const productTruthChanges: ProductTruthChangeV23[] = [];
    const canonicalJourneys = (operational.productJourney?.journeys || []).filter(
      (journey: any) => Boolean(journey.productId && journey.productCode)
    );
    for (const journey of canonicalJourneys) {
      const truth = await planProductOpportunityTruthV23(session, source, journey);
      const prior = priorByProduct.get(String(journey.productId || journey.productCode || '').trim()) || null;
      productTruthChanges.push({
        productId: truth.productId,
        productCode: truth.productCode,
        productName: truth.productName,
        beforeStage: prior?.current_stage || null,
        beforeInvoiceNumber: prior?.matched_invoice_number || null,
        beforeLeakageCode: prior?.evidence_json?.leakageCode || null,
        afterStage: truth.currentStage,
        afterInvoiceNumber: truth.matchedInvoiceNumber,
        afterInvoiceValue: truth.matchedInvoiceValue,
        afterLeakageCode: truth.leakageCode,
        saleVerifiedScope: truth.saleVerifiedScope,
        productEvidence: truth.verification?.evidence || null,
        timeDistanceMinutes: truth.verification?.timeDistanceMinutes ?? null,
      });
    }

    if (!dryRun) {
      const nextAnalysis = {
        ...(source.analysis_json || {}),
        operational: JSON.parse(JSON.stringify(operational)),
        productDemandVersion: 'product-demand-v22.1',
        productDemandTruthVersion: 'product-invoice-truth-v23.1',
        productDemandBackfilledAt: new Date().toISOString(),
      };

      await syncWhatsAppOperationalActionsV6(operational, {
        sourceId: source.id,
        branch: source.branch,
        customerId: source.customer_id,
        customerCode: source.customer_code,
        customerName: source.customer_name,
        customerPhone: source.customer_phone,
        staffId: source.staff_id,
        staffName: source.staff_name,
        createdBy: source.created_by,
      });

      await syncWhatsAppEvidenceLedgerV17(session, {
        sourceId: source.id,
        operational,
        analysisVersion: 'product-demand-v22.1',
        participantRoles: source.analysis_json?.participantRoles,
      });

      const canonicalProductIds = Array.from(new Set(
        (operational.productJourney?.journeys || [])
          .map((journey: any) => journey.productId)
          .filter(Boolean)
          .map(String)
      ));
      let staleQuery = supabase
        .from('whatsapp_sales_opportunities_v17')
        .delete()
        .eq('root_source_id', source.id)
        .eq('analysis_version', 'product-demand-v22.1');
      if (canonicalProductIds.length) staleQuery = staleQuery.not('product_id', 'in', '(' + canonicalProductIds.join(',') + ')');
      const { error: staleError } = await staleQuery;
      if (staleError) throw staleError;

      const { error: updateError } = await supabase
        .from('whatsapp_review_sources')
        .update({ analysis_json: nextAnalysis, updated_at: new Date().toISOString() })
        .eq('id', source.id);
      if (updateError) throw updateError;
    }

    return {
      sourceId: source.id,
      status: dryRun ? 'ready' : 'written',
      reason: null,
      canonicalProducts: canonical.length,
      unresolvedProducts: unresolved.length,
      productCodes,
      canonicalProductNames: Array.from(new Set(canonical.map((product) => String(product.canonicalName || product.rawName)).filter(Boolean))).slice(0, 12),
      unresolvedExamples: Array.from(new Set(unresolved.map((product) => String(product.rawName || '').trim()).filter(Boolean))).slice(0, 12),
      priorCanonicalProductCodes,
      droppedPriorCanonicalCodes,
      productTruthChanges,
    };
  } catch (error) {
    return {
      sourceId: source.id,
      status: 'failed',
      reason: backfillErrorMessage(error),
      canonicalProducts: 0,
      unresolvedProducts: 0,
      productCodes: [],
      canonicalProductNames: [],
      unresolvedExamples: [],
      priorCanonicalProductCodes: [],
      droppedPriorCanonicalCodes: [],
    };
  }
}

async function mapProductDemandDryRunWithConcurrency(
  sources: SourceRow[],
  concurrency: number,
  onProgress?: (processed: number, total: number) => void
): Promise<ProductDemandBackfillSourceResultV22[]> {
  if (!sources.length) return [];
  const results = new Array<ProductDemandBackfillSourceResultV22>(sources.length);
  let cursor = 0;
  let processed = 0;
  const workerCount = Math.max(1, Math.min(concurrency, sources.length));

  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= sources.length) return;
      results[index] = await processProductDemandSourceV22(sources[index], true);
      processed += 1;
      onProgress?.(processed, sources.length);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

export async function runProductDemandBackfillV22(
  options: ProductDemandBackfillOptionsV22 = {}
): Promise<ProductDemandBackfillResultV22> {
  const dryRun = options.dryRun !== false;
  const loaded = await loadSources(options);
  const sources = loaded.rows;
  let rows: ProductDemandBackfillSourceResultV22[] = [];

  if (dryRun) {
    const concurrency = Math.max(1, Math.min(8, options.dryRunConcurrency ?? 4));
    rows = await mapProductDemandDryRunWithConcurrency(sources, concurrency, options.onProgress);
  } else {
    for (const source of sources) {
      rows.push(await processProductDemandSourceV22(source, false));
      options.onProgress?.(rows.length, sources.length);
    }
  }

  return {
    version: 'product-demand-backfill-v22.1',
    dryRun,
    eligibleSources: loaded.eligibleSources,
    truncated: loaded.truncated,
    scanned: rows.length,
    ready: rows.filter((row) => row.status === 'ready').length,
    written: rows.filter((row) => row.status === 'written').length,
    skipped: rows.filter((row) => row.status === 'skipped').length,
    failed: rows.filter((row) => row.status === 'failed').length,
    canonicalProducts: rows.reduce((sum, row) => sum + row.canonicalProducts, 0),
    unresolvedProducts: rows.reduce((sum, row) => sum + row.unresolvedProducts, 0),
    rows,
  };
}
