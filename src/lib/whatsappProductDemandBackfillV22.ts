import { supabase } from '@/lib/supabase';
import { parseWhatsAppExport, splitWhatsAppSessions, type WhatsAppConversationSession } from '@/lib/whatsappConversationParser';
import { buildUnifiedConversationIntelligence } from '@/lib/whatsappUnifiedIntelligenceV4';
import {
  buildWhatsAppOperationalIntelligenceV6,
  enrichWhatsAppOperationalProductsV6,
  syncWhatsAppOperationalActionsV6,
} from '@/lib/whatsappOperationalIntelligenceV6';
import { enrichWhatsAppOperationalJourneysV7 } from '@/lib/whatsappProductJourneyV7';
import { syncWhatsAppEvidenceLedgerV17 } from '@/lib/whatsappEvidenceLedgerV17';

export interface ProductDemandBackfillOptionsV22 {
  limit?: number;
  dryRun?: boolean;
  sourceIds?: string[];
  force?: boolean;
}

export interface ProductDemandBackfillSourceResultV22 {
  sourceId: string;
  status: 'ready' | 'written' | 'skipped' | 'failed';
  reason: string | null;
  canonicalProducts: number;
  unresolvedProducts: number;
  productCodes: string[];
}

export interface ProductDemandBackfillResultV22 {
  version: 'product-demand-backfill-v22';
  dryRun: boolean;
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
  analysis_json: Record<string, any> | null;
};

function chooseBestSession(
  sessions: WhatsAppConversationSession[],
  startedAt: string | null,
  endedAt: string | null
) {
  if (!sessions.length) return null;
  if (sessions.length === 1) return sessions[0];

  const start = startedAt ? new Date(startedAt).getTime() : NaN;
  const end = endedAt ? new Date(endedAt).getTime() : NaN;

  const scored = sessions.map((session) => {
    const s = session.startedAt.getTime();
    const e = session.endedAt.getTime();
    const overlap = Number.isFinite(start) && Number.isFinite(end)
      ? Math.max(0, Math.min(e, end) - Math.max(s, start))
      : 0;
    const startDistance = Number.isFinite(start) ? Math.abs(s - start) : 0;
    return { session, overlap, startDistance };
  }).sort((a, b) => {
    if (b.overlap !== a.overlap) return b.overlap - a.overlap;
    return a.startDistance - b.startDistance;
  });

  return scored[0]?.session ?? null;
}

async function loadSources(options: ProductDemandBackfillOptionsV22): Promise<SourceRow[]> {
  const limit = Math.max(1, Math.min(100, options.limit ?? 20));
  // Pull a wider candidate window, then skip rows already backfilled. This avoids repeatedly
  // rewriting the same 20 conversations while keeping the query compatible with old JSON rows.
  let query = supabase
    .from('whatsapp_review_sources')
    .select('id,raw_text,conversation_started_at,conversation_ended_at,branch,customer_id,customer_code,customer_name,customer_phone,staff_id,staff_name,created_by,analysis_json')
    .not('raw_text', 'is', null)
    .order('conversation_started_at', { ascending: false })
    .limit(Math.min(300, limit * 5));

  if (options.sourceIds?.length) query = query.in('id', options.sourceIds);
  const { data, error } = await query;
  if (error) throw error;
  const rows = (data || []) as SourceRow[];
  const filtered = options.force || options.sourceIds?.length
    ? rows
    : rows.filter((row) => row.analysis_json?.productDemandVersion !== 'product-demand-v22');
  return filtered.slice(0, limit);
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

export async function runProductDemandBackfillV22(
  options: ProductDemandBackfillOptionsV22 = {}
): Promise<ProductDemandBackfillResultV22> {
  const dryRun = options.dryRun !== false;
  const sources = await loadSources(options);
  const rows: ProductDemandBackfillSourceResultV22[] = [];

  for (const source of sources) {
    try {
      const raw = String(source.raw_text || '').trim();
      if (!raw) {
        rows.push({ sourceId: source.id, status: 'skipped', reason: 'النص الأصلي للمحادثة غير متاح.', canonicalProducts: 0, unresolvedProducts: 0, productCodes: [] });
        continue;
      }

      const parsed = parseWhatsAppExport(raw, {
        trustedConversationStartedAt: source.conversation_started_at || undefined,
      });
      const session = chooseBestSession(
        splitWhatsAppSessions(parsed, 120),
        source.conversation_started_at,
        source.conversation_ended_at
      );
      if (!session) {
        rows.push({ sourceId: source.id, status: 'skipped', reason: 'تعذر تكوين جلسة محادثة صالحة للتحليل.', canonicalProducts: 0, unresolvedProducts: 0, productCodes: [] });
        continue;
      }

      const base = buildUnifiedConversationIntelligence(session);
      const operational0 = buildWhatsAppOperationalIntelligenceV6(session, base);
      const operational1 = await enrichWhatsAppOperationalProductsV6(operational0);
      const operational = enrichWhatsAppOperationalJourneysV7(session, operational1);

      const canonical = operational.products.filter((product) => Boolean(product.productId && product.productCode));
      const unresolved = operational.products.filter((product) => !product.productId);
      const productCodes = Array.from(new Set(canonical.map((product) => String(product.productCode)).filter(Boolean)));

      if (!dryRun) {
        const nextAnalysis = {
          ...(source.analysis_json || {}),
          operational: JSON.parse(JSON.stringify(operational)),
          productDemandVersion: 'product-demand-v22',
          productDemandBackfilledAt: new Date().toISOString(),
        };

        // Persist downstream artifacts first. The source is marked V22 only after BOTH writes
        // succeed, so a partial failure can never masquerade as a completed backfill.
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
          analysisVersion: 'product-demand-v22',
          participantRoles: nextAnalysis.participantRoles,
        });

        const { error: updateError } = await supabase
          .from('whatsapp_review_sources')
          .update({ analysis_json: nextAnalysis, updated_at: new Date().toISOString() })
          .eq('id', source.id);
        if (updateError) throw updateError;
      }

      rows.push({
        sourceId: source.id,
        status: dryRun ? 'ready' : 'written',
        reason: null,
        canonicalProducts: canonical.length,
        unresolvedProducts: unresolved.length,
        productCodes,
      });
    } catch (error) {
      rows.push({
        sourceId: source.id,
        status: 'failed',
        reason: backfillErrorMessage(error),
        canonicalProducts: 0,
        unresolvedProducts: 0,
        productCodes: [],
      });
    }
  }

  return {
    version: 'product-demand-backfill-v22',
    dryRun,
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
