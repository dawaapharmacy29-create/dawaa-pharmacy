// Canonical Sales Intelligence customer-request qualification -> operational action projection.
//
// This module never decides whether a request exists. It consumes the canonical qualification
// owner and only projects QUALIFIED requests into whatsapp_conversation_actions. The existing
// explicit approval + materialization RPC remains the only path to customer_requests truth.
import { parseWhatsAppExport } from '../../whatsappConversationParser';
import { stableOperationIdentity } from '../../whatsappFollowupIdentity';
import { deriveCanonicalCustomerRequestAssessment } from '../customerRequestQualificationEngine';
import type { SalesIntelligenceCaseAnalysis } from '../types';

export const CANONICAL_CUSTOMER_REQUEST_PROJECTION_VERSION =
  'si-canonical-customer-request-projection-v1';

export interface CanonicalCustomerRequestSourceMetadata {
  id: string;
  raw_text?: string | null;
  customer_name?: string | null;
  customer_code?: string | null;
  staff_id?: string | null;
}

export interface CanonicalCustomerRequestActionRow {
  source_id: string;
  action_key: string;
  action_type: 'customer_request';
  status: 'proposed';
  work_status: 'unassigned';
  auto_eligible: false;
  confidence: number;
  branch: string;
  customer_id: string;
  customer_code: string | null;
  customer_name: string;
  customer_phone: string | null;
  staff_id: string;
  staff_name: null;
  product_id: string;
  product_code: string;
  product_name: string;
  quantity: number | null;
  due_at: null;
  reason: string;
  evidence: string[];
  payload: Record<string, unknown>;
  followup_identity: string;
  created_by: string;
}

export interface CanonicalCustomerRequestProjectionSkip {
  caseId: string;
  requestKey: string;
  reason:
    | 'not_qualified'
    | 'missing_source'
    | 'missing_customer_name'
    | 'missing_branch'
    | 'missing_staff_identity'
    | 'missing_product_identity'
    | 'missing_product_code'
    | 'missing_timeline'
    | 'invalid_evidence_time';
}

export interface CanonicalCustomerRequestBuildResult {
  rows: CanonicalCustomerRequestActionRow[];
  skipped: CanonicalCustomerRequestProjectionSkip[];
}

export interface CanonicalCustomerRequestProjectionResult
  extends CanonicalCustomerRequestBuildResult {
  inserted: number;
  existing: number;
}

function text(value: unknown) {
  return String(value ?? '').trim();
}

function uuidOrNull(value: unknown) {
  const raw = text(value);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw)
    ? raw
    : null;
}

function confidencePercent(score: unknown) {
  const numeric = Number(score);
  if (!Number.isFinite(numeric)) return 0;
  const scaled = numeric <= 1 ? numeric * 100 : numeric;
  return Math.max(0, Math.min(100, Math.round(scaled)));
}

export function buildCanonicalCustomerRequestActionRows(
  analyses: readonly SalesIntelligenceCaseAnalysis[],
  sources: readonly CanonicalCustomerRequestSourceMetadata[]
): CanonicalCustomerRequestBuildResult {
  const sourceById = new Map(sources.map((source) => [text(source.id), source]));
  const byIdentity = new Map<string, CanonicalCustomerRequestActionRow>();
  const skipped: CanonicalCustomerRequestProjectionSkip[] = [];

  for (const analysis of analyses) {
    const assessment = deriveCanonicalCustomerRequestAssessment({
      caseId: analysis.caseId,
      customerNeed: analysis.customerNeed,
      unavailableDemand: analysis.unavailableDemand,
      salesOutcome: analysis.salesOutcome,
      lostOpportunity: analysis.lostOpportunity,
    });
    const sourceId = text(analysis.conversationId);
    const source = sourceById.get(sourceId);

    for (const request of assessment.requests) {
      if (request.status !== 'qualified') {
        skipped.push({ caseId: analysis.caseId, requestKey: request.requestKey, reason: 'not_qualified' });
        continue;
      }
      if (!source) {
        skipped.push({ caseId: analysis.caseId, requestKey: request.requestKey, reason: 'missing_source' });
        continue;
      }

      const customerName = text(source.customer_name);
      const branch = text(analysis.conversationCase.branchNameRaw);
      const staffId = uuidOrNull(source.staff_id);
      const customerId = uuidOrNull(request.customerId);
      const productId = uuidOrNull(request.productId);
      const product = analysis.customerNeed.products.find((row) => row.key === request.productKey) ?? null;
      const productCode = text(product?.productCode);
      const productName = text(product?.canonicalName || request.productRaw);
      const demand = analysis.unavailableDemand.find((row) => row.demandKey === request.demandKey) ?? null;

      if (!customerName) {
        skipped.push({ caseId: analysis.caseId, requestKey: request.requestKey, reason: 'missing_customer_name' });
        continue;
      }
      if (!branch) {
        skipped.push({ caseId: analysis.caseId, requestKey: request.requestKey, reason: 'missing_branch' });
        continue;
      }
      if (!staffId) {
        skipped.push({ caseId: analysis.caseId, requestKey: request.requestKey, reason: 'missing_staff_identity' });
        continue;
      }
      if (!customerId || !productId) {
        skipped.push({ caseId: analysis.caseId, requestKey: request.requestKey, reason: 'missing_product_identity' });
        continue;
      }
      if (!productCode) {
        skipped.push({ caseId: analysis.caseId, requestKey: request.requestKey, reason: 'missing_product_code' });
        continue;
      }

      const timeline = parseWhatsAppExport(text(source.raw_text));
      if (!timeline.length) {
        skipped.push({ caseId: analysis.caseId, requestKey: request.requestKey, reason: 'missing_timeline' });
        continue;
      }
      const evidenceAt = demand?.requestedAt ? new Date(demand.requestedAt) : null;
      if (!evidenceAt || !Number.isFinite(evidenceAt.getTime())) {
        skipped.push({ caseId: analysis.caseId, requestKey: request.requestKey, reason: 'invalid_evidence_time' });
        continue;
      }

      const operation = stableOperationIdentity({
        timeline: timeline.map((message) => ({
          timestamp: message.timestamp,
          direction: message.direction,
          sender: message.sender,
          text: message.text,
          kind: message.kind,
          mediaPlaceholder: message.mediaPlaceholder,
        })),
        evidenceAt,
        operationType: 'customer_request',
        reasonKey: productName,
      });

      const row: CanonicalCustomerRequestActionRow = {
        source_id: sourceId,
        action_key: `canonical-request:${operation.identity}`,
        action_type: 'customer_request',
        status: 'proposed',
        work_status: 'unassigned',
        auto_eligible: false,
        confidence: confidencePercent(request.confidence.score),
        branch,
        customer_id: customerId,
        customer_code: text(source.customer_code) || null,
        customer_name: customerName,
        customer_phone: text(analysis.conversationCase.customerPhone) || null,
        staff_id: staffId,
        staff_name: null,
        product_id: productId,
        product_code: productCode,
        product_name: productName,
        quantity: request.quantity == null ? null : Number(request.quantity),
        due_at: null,
        reason: 'صنف مطلوب من العميل وثبت عدم توفره ويحتاج اعتماد تسجيل الطلب.',
        evidence: [...request.evidenceMessageIds],
        payload: {
          canonicalProjectionVersion: CANONICAL_CUSTOMER_REQUEST_PROJECTION_VERSION,
          caseId: analysis.caseId,
          requestKey: request.requestKey,
          demandKey: request.demandKey,
          canonicalReason: request.reason,
          priority: request.priority,
          evidenceMessageIds: [...request.evidenceMessageIds],
          confidenceLevel: request.confidence.level,
          approvalRequired: true,
        },
        followup_identity: operation.identity,
        created_by: CANONICAL_CUSTOMER_REQUEST_PROJECTION_VERSION,
      };

      const existing = byIdentity.get(operation.identity);
      if (existing) {
        if (existing.source_id !== row.source_id) {
          throw new Error(`canonical_customer_request_identity_collision:${operation.identity}`);
        }
        continue;
      }
      byIdentity.set(operation.identity, row);
    }
  }

  return { rows: [...byIdentity.values()], skipped };
}

export async function projectCanonicalCustomerRequestsToActions(
  supabaseClient: any,
  analyses: readonly SalesIntelligenceCaseAnalysis[],
  sources: readonly CanonicalCustomerRequestSourceMetadata[]
): Promise<CanonicalCustomerRequestProjectionResult> {
  const built = buildCanonicalCustomerRequestActionRows(analyses, sources);
  if (!built.rows.length) return { ...built, inserted: 0, existing: 0 };

  const identities = built.rows.map((row) => row.followup_identity);
  const { data: existingRows, error: existingError } = await supabaseClient
    .from('whatsapp_conversation_actions')
    .select('id,followup_identity,status,target_table,target_id')
    .in('followup_identity', identities);
  if (existingError) throw existingError;

  const existing = new Set(
    (existingRows || [])
      .map((row: { followup_identity?: string | null }) => text(row.followup_identity))
      .filter(Boolean)
  );
  let inserted = 0;

  for (const row of built.rows) {
    if (existing.has(row.followup_identity)) continue;
    const { error } = await supabaseClient.from('whatsapp_conversation_actions').insert(row);
    if (!error) {
      inserted += 1;
      existing.add(row.followup_identity);
      continue;
    }
    if (String(error.code || '') !== '23505') throw error;

    const { data: raced, error: raceReadError } = await supabaseClient
      .from('whatsapp_conversation_actions')
      .select('id,followup_identity')
      .eq('followup_identity', row.followup_identity)
      .maybeSingle();
    if (raceReadError) throw raceReadError;
    if (!raced) throw error;
    existing.add(row.followup_identity);
  }

  return {
    ...built,
    inserted,
    existing: built.rows.length - inserted,
  };
}
