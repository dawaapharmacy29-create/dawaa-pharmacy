import { supabase } from '@/lib/supabase';
import { readInvoiceRecordsByIdentityWindow } from '@/lib/readModels/invoiceRecordReadModel';
import type { CaseIntelligenceView } from './types';

export interface CustomerRequestSystemRow {
  id: string;
  customer_id: string | null;
  customer_code: string | null;
  customer_phone: string | null;
  branch: string | null;
  medicine_name: string | null;
  quantity: number | null;
  doctor_id: string | null;
  doctor_name: string | null;
  source_recorded_staff_id: string | null;
  created_by: string | null;
  created_by_name: string | null;
  requested_at: string | null;
  created_at: string | null;
  due_date: string | null;
  next_action_at: string | null;
  status: string | null;
}

export interface ExceptionalFollowupSystemRow {
  id: string;
  customer_id: string | null;
  customer_code: string | null;
  customer_phone: string | null;
  branch: string | null;
  request_type: string | null;
  followup_type: string | null;
  request_source: string | null;
  followup_reason: string | null;
  request_details: string | null;
  followup_summary: string | null;
  requested_by_staff_id: string | null;
  staff_id: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string | null;
}

export interface PurchaseHistoryInvoiceRow {
  id: string;
  invoice_number: string | null;
  customer_id: string | null;
  customer_code: string | null;
  customer_phone: string | null;
  invoice_datetime: string | null;
  branch_name: string | null;
  net_total: number | null;
}

export interface MatchedSystemRow<T> {
  row: T;
  identityMatched: boolean;
  staffMatched: boolean | null;
  minutesFromInteractionEnd: number | null;
}

export interface ConversationEvaluationSystemEvidenceSnapshot {
  version: 'conversation-evaluation-system-evidence-v1';
  caseId: string;
  customerRequests: MatchedSystemRow<CustomerRequestSystemRow>[];
  exceptionalFollowups: MatchedSystemRow<ExceptionalFollowupSystemRow>[];
  purchaseHistory: {
    invoices: PurchaseHistoryInvoiceRow[];
    priorInvoiceCount: number;
    lastPurchaseAt: string | null;
  };
}

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizePhone(value: unknown): string {
  return clean(value).replace(/\D/g, '');
}

function toMs(value: string | null | undefined): number | null {
  const ms = Date.parse(String(value ?? ''));
  return Number.isFinite(ms) ? ms : null;
}

function staffIds(view: CaseIntelligenceView): Set<string> {
  return new Set(
    view.staff.participants
      .map((participant) => clean(participant.staffId))
      .filter(Boolean)
  );
}

export function systemIdentityMatches(
  view: CaseIntelligenceView,
  row: { customer_id?: string | null; customer_code?: string | null; customer_phone?: string | null }
): boolean {
  const viewId = clean(view.customer.customerId);
  const rowId = clean(row.customer_id);
  if (viewId && rowId) return viewId === rowId;

  const viewCode = clean(view.customer.customerCode);
  const rowCode = clean(row.customer_code);
  if (viewCode && rowCode) return viewCode === rowCode;

  const viewPhone = normalizePhone(view.customer.customerPhone);
  const rowPhone = normalizePhone(row.customer_phone);
  return Boolean(viewPhone && rowPhone && viewPhone === rowPhone);
}

export function systemStaffMatches(
  view: CaseIntelligenceView,
  rowStaffIds: Array<string | null | undefined>
): boolean | null {
  const expected = staffIds(view);
  if (!expected.size) return null;
  const candidates = rowStaffIds.map(clean).filter(Boolean);
  if (!candidates.length) return null;
  return candidates.some((id) => expected.has(id));
}

export function minutesFromInteractionEnd(
  view: CaseIntelligenceView,
  timestamp: string | null | undefined
): number | null {
  const end = toMs(view.interaction.endedAt || view.interaction.startedAt);
  const at = toMs(timestamp);
  if (end == null || at == null) return null;
  return Math.round((at - end) / 60000);
}

export function buildConversationEvaluationSystemEvidenceSnapshot(
  view: CaseIntelligenceView,
  input: {
    customerRequests?: CustomerRequestSystemRow[];
    exceptionalFollowups?: ExceptionalFollowupSystemRow[];
    purchaseHistory?: PurchaseHistoryInvoiceRow[];
  }
): ConversationEvaluationSystemEvidenceSnapshot {
  const customerRequests = (input.customerRequests ?? [])
    .filter((row) => systemIdentityMatches(view, row))
    .map((row) => ({
      row,
      identityMatched: true,
      staffMatched: systemStaffMatches(view, [row.doctor_id, row.source_recorded_staff_id]),
      minutesFromInteractionEnd: minutesFromInteractionEnd(view, row.requested_at || row.created_at),
    }))
    .filter((match) => match.minutesFromInteractionEnd == null || (match.minutesFromInteractionEnd >= -15 && match.minutesFromInteractionEnd <= 120));

  const exceptionalFollowups = (input.exceptionalFollowups ?? [])
    .filter((row) => systemIdentityMatches(view, row))
    .filter((row) =>
      clean(row.request_type).toLowerCase() === 'exceptional_followup' ||
      clean(row.followup_type).toLowerCase().includes('exceptional') ||
      clean(row.request_source).toLowerCase().includes('exceptional')
    )
    .map((row) => ({
      row,
      identityMatched: true,
      staffMatched: systemStaffMatches(view, [row.requested_by_staff_id, row.staff_id]),
      minutesFromInteractionEnd: minutesFromInteractionEnd(view, row.created_at),
    }))
    .filter((match) => match.minutesFromInteractionEnd == null || (match.minutesFromInteractionEnd >= -15 && match.minutesFromInteractionEnd <= 120));

  const startMs = toMs(view.interaction.startedAt);
  const invoices = (input.purchaseHistory ?? [])
    .filter((row) => systemIdentityMatches(view, row))
    .filter((row) => {
      const invoiceMs = toMs(row.invoice_datetime);
      return startMs != null && invoiceMs != null && invoiceMs < startMs;
    })
    .sort((a, b) => (toMs(b.invoice_datetime) ?? 0) - (toMs(a.invoice_datetime) ?? 0));

  return {
    version: 'conversation-evaluation-system-evidence-v1',
    caseId: view.caseId,
    customerRequests,
    exceptionalFollowups,
    purchaseHistory: {
      invoices,
      priorInvoiceCount: invoices.length,
      lastPurchaseAt: invoices[0]?.invoice_datetime ?? null,
    },
  };
}

function identityOrFilter(view: CaseIntelligenceView): string | null {
  const parts: string[] = [];
  if (view.customer.customerId) parts.push(`customer_id.eq.${view.customer.customerId}`);
  if (view.customer.customerCode) parts.push(`customer_code.eq.${view.customer.customerCode}`);
  if (view.customer.customerPhone) parts.push(`customer_phone.eq.${view.customer.customerPhone}`);
  return parts.length ? parts.join(',') : null;
}

/**
 * Read-only I/O boundary for conversation evaluation.
 * The canonical Sales Intelligence pipeline stays pure; evaluation can enrich itself from operational
 * truth without writing back into customer requests, followups, invoices, or the sales case.
 */
export async function loadConversationEvaluationSystemEvidenceWithClient(
  client: any,
  view: CaseIntelligenceView
): Promise<ConversationEvaluationSystemEvidenceSnapshot> {
  const identityFilter = identityOrFilter(view);
  if (!identityFilter) return buildConversationEvaluationSystemEvidenceSnapshot(view, {});

  const startMs = toMs(view.interaction.startedAt) ?? Date.now();
  const endMs = toMs(view.interaction.endedAt || view.interaction.startedAt) ?? startMs;
  const from = new Date(startMs - 15 * 60_000).toISOString();
  const to = new Date(endMs + 120 * 60_000).toISOString();

  const [requestResult, followupResult, historyResult] = await Promise.all([
    client
      .from('customer_requests')
      .select('id,customer_id,customer_code,customer_phone,branch,medicine_name,quantity,doctor_id,doctor_name,source_recorded_staff_id,created_by,created_by_name,requested_at,created_at,due_date,next_action_at,status')
      .or(identityFilter)
      .gte('created_at', from)
      .lte('created_at', to)
      .limit(100),
    client
      .from('daily_followups')
      .select('id,customer_id,customer_code,customer_phone,branch,request_type,followup_type,request_source,followup_reason,request_details,followup_summary,requested_by_staff_id,staff_id,created_by,created_by_name,created_at')
      .or(identityFilter)
      .gte('created_at', from)
      .lte('created_at', to)
      .limit(100),
    (async () => {
      const beforeInteraction = new Date(Math.max(0, startMs - 1)).toISOString();
      const identities = [
        { column: 'customer_id' as const, value: clean(view.customer.customerId) },
        { column: 'customer_code' as const, value: clean(view.customer.customerCode) },
        { column: 'customer_phone' as const, value: clean(view.customer.customerPhone) },
      ].filter((identity) => Boolean(identity.value));

      const batches = await Promise.all(
        identities.map((identity) =>
          readInvoiceRecordsByIdentityWindow({
            column: identity.column,
            value: identity.value,
            windowStartIso: '1970-01-01T00:00:00.000Z',
            windowEndIso: beforeInteraction,
            limit: 30,
            client,
          })
        )
      );

      const byId = new Map<string, PurchaseHistoryInvoiceRow>();
      for (const row of batches.flat()) {
        const id = clean(row.id);
        if (!id) continue;
        const rawTotal = row.net_total;
        const parsedTotal = rawTotal == null ? null : Number(rawTotal);
        byId.set(id, {
          id,
          invoice_number: clean(row.invoice_number) || null,
          customer_id: clean(row.customer_id) || null,
          customer_code: clean(row.customer_code) || null,
          customer_phone: clean(row.customer_phone) || null,
          invoice_datetime: clean(row.invoice_datetime) || null,
          branch_name: clean(row.branch_name) || null,
          net_total: parsedTotal != null && Number.isFinite(parsedTotal) ? parsedTotal : null,
        });
      }

      return [...byId.values()]
        .sort((a, b) => (toMs(b.invoice_datetime) ?? 0) - (toMs(a.invoice_datetime) ?? 0))
        .slice(0, 30);
    })(),
  ]);

  if (requestResult.error) throw new Error(`customer_requests: ${requestResult.error.message}`);
  if (followupResult.error) throw new Error(`daily_followups: ${followupResult.error.message}`);
    return buildConversationEvaluationSystemEvidenceSnapshot(view, {
    customerRequests: (requestResult.data ?? []) as CustomerRequestSystemRow[],
    exceptionalFollowups: (followupResult.data ?? []) as ExceptionalFollowupSystemRow[],
    purchaseHistory: historyResult,
  });
}

/**
 * Browser/default client wrapper. Server-side canonical refresh uses the injected-client variant
 * above so the exact same read-only evidence rules run under the already-authenticated service
 * client instead of rebuilding evidence through a second transport.
 */
export async function loadConversationEvaluationSystemEvidence(
  view: CaseIntelligenceView
): Promise<ConversationEvaluationSystemEvidenceSnapshot> {
  return loadConversationEvaluationSystemEvidenceWithClient(supabase, view);
}
