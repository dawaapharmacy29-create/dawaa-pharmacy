// Canonical Sales Intelligence customer-request qualification -> operational action projection.
//
// This module never decides whether a request exists. It consumes the canonical qualification
// owner and projects QUALIFIED requests into whatsapp_conversation_actions, plus requests whose
// only open blockers are catalog/customer identity (or a quantity conflict): those are real
// requests the doctor should have recorded, persisted as identity-pending proposals so request
// capture can be measured. The approval RPC still refuses any proposal without customer and
// product identity, and the refresh fills the identity in place once it resolves.
// The existing explicit approval + materialization RPC remains the only path to customer_requests truth.
import { isOperatingBranch } from '../../branch';
import { parseWhatsAppExport } from '../../whatsappConversationParser';
import { stableOperationIdentity } from '../../whatsappFollowupIdentity';
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
  customer_id: string | null;
  customer_code: string | null;
  customer_name: string;
  customer_phone: string | null;
  staff_id: string;
  staff_name: null;
  product_id: string | null;
  product_code: string | null;
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
    | 'missing_canonical_assessment'
    | 'missing_source'
    | 'missing_customer_name'
    | 'missing_branch'
    | 'non_transaction_branch'
    | 'missing_staff_identity'
    | 'staff_evidence_conflict'
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

/** Blockers that only mean "identity not linked yet": the request itself is real. */
const IDENTITY_PENDING_BLOCKERS = new Set(['product_identity_unresolved', 'customer_identity_unresolved', 'quantity_conflict']);

function isIdentityPending(request: { status: string; blockers?: readonly string[] }) {
  return request.status === 'review_required'
    && Boolean(request.blockers?.length)
    && request.blockers!.every((blocker) => IDENTITY_PENDING_BLOCKERS.has(blocker));
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
    const assessment = analysis.customerRequestAssessment;
    if (!assessment || assessment.caseId !== analysis.caseId) {
      skipped.push({ caseId: analysis.caseId, requestKey: '', reason: 'missing_canonical_assessment' });
      continue;
    }
    const sourceId = text(analysis.conversationId);
    const source = sourceById.get(sourceId);

    for (const request of assessment.requests) {
      if (request.status !== 'qualified' && !isIdentityPending(request)) {
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
      if (!isOperatingBranch(branch)) {
        skipped.push({ caseId: analysis.caseId, requestKey: request.requestKey, reason: 'non_transaction_branch' });
        continue;
      }
      if (!staffId) {
        skipped.push({ caseId: analysis.caseId, requestKey: request.requestKey, reason: 'missing_staff_identity' });
        continue;
      }
      // The source staff id alone is not proof when the conversation's own resolved staff evidence
      // (explicit self-introductions) names someone else: that ownership needs human review.
      const evidenceStaffIds = (analysis.caseIntelligence?.staff?.participants ?? [])
        .map((participant) => uuidOrNull(participant.staffId))
        .filter((id): id is string => Boolean(id));
      if (evidenceStaffIds.some((id) => id !== staffId)) {
        skipped.push({ caseId: analysis.caseId, requestKey: request.requestKey, reason: 'staff_evidence_conflict' });
        continue;
      }
      // A real request without linked identity is still persisted (identity-pending): approval
      // refuses it until customer and product resolve; capture measurement needs it now.
      const identityBlockers = [
        ...(customerId ? [] : ['customer_identity_unresolved']),
        ...(productId ? [] : ['product_identity_unresolved']),
        ...(productCode ? [] : ['product_code_missing']),
        ...(request.blockers || []).filter((blocker) => blocker === 'quantity_conflict'),
      ];
      if (!productName) {
        skipped.push({ caseId: analysis.caseId, requestKey: request.requestKey, reason: 'missing_product_identity' });
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
        product_code: productCode || null,
        product_name: productName,
        quantity: request.quantity == null ? null : Number(request.quantity),
        due_at: null,
        reason: identityBlockers.length
          ? 'صنف مطلوب من العميل وثبت عدم توفره؛ يحتاج ربط الصنف أو العميل قبل اعتماد تسجيل الطلب.'
          : 'صنف مطلوب من العميل وثبت عدم توفره ويحتاج اعتماد تسجيل الطلب.',
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
          // When the customer asked, from the conversation timeline (request capture matching).
          requestedAt: evidenceAt.toISOString(),
          qualification: request.status,
          identityBlockers,
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
    .select('id,followup_identity,status,target_table,target_id,customer_id,product_id,product_code,payload')
    .in('followup_identity', identities);
  if (existingError) throw existingError;

  const existingByIdentity = new Map<string, Record<string, unknown>>(
    (existingRows || [])
      .filter((row: { followup_identity?: string | null }) => text(row.followup_identity))
      .map((row: Record<string, unknown>) => [text(row.followup_identity), row])
  );
  const existing = new Set(existingByIdentity.keys());
  let inserted = 0;

  for (const row of built.rows) {
    const current = existingByIdentity.get(row.followup_identity);
    if (current) {
      // An identity-pending proposal is completed in place once the identity resolves; a
      // proposal that is already approved, created or dismissed is never touched.
      const pending = text(current.status) === 'proposed'
        && (!text(current.customer_id) || !text(current.product_id) || !text(current.product_code));
      const resolvesMore = (!text(current.customer_id) && row.customer_id)
        || (!text(current.product_id) && row.product_id)
        || (!text(current.product_code) && row.product_code);
      if (pending && resolvesMore) {
        const { error: fillError } = await supabaseClient
          .from('whatsapp_conversation_actions')
          .update({
            customer_id: row.customer_id,
            product_id: row.product_id,
            product_code: row.product_code,
            product_name: row.product_name,
            reason: row.reason,
            payload: { ...((current.payload as Record<string, unknown>) || {}), ...row.payload },
          })
          .eq('id', text(current.id))
          .eq('status', 'proposed');
        if (fillError) throw fillError;
      }
      continue;
    }
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

