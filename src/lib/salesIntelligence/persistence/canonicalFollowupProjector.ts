// Canonical Sales Intelligence follow-up -> operational action projection.
//
// This module DOES NOT decide whether a follow-up exists. The sole semantic owner remains
// followUpOpportunityEngine.ts. It only projects already-final canonical actionable opportunities
// into whatsapp_conversation_actions so the existing authorized materializer can create/link the
// operational daily_followups record. No message parsing, legacy detector fallback, staff guessing,
// direct daily_followups write, or automatic materialization is allowed here.
import type { FollowUpReason, SalesIntelligenceCaseAnalysis } from '../types';

export const CANONICAL_FOLLOWUP_PROJECTION_VERSION = 'si-canonical-followup-projection-v1';

export interface CanonicalFollowupSourceMetadata {
  id: string;
  customer_name?: string | null;
  customer_code?: string | null;
}

export interface CanonicalFollowupActionRow {
  source_id: string;
  action_key: string;
  action_type: 'customer_followup';
  status: 'ready';
  work_status: 'unassigned';
  auto_eligible: false;
  branch: string;
  customer_id: string | null;
  customer_code: string | null;
  customer_name: string;
  customer_phone: string | null;
  product_id: string | null;
  product_name: string | null;
  quantity: number | null;
  due_at: string | null;
  reason: string;
  evidence: string[];
  payload: Record<string, unknown>;
  followup_identity: string;
  assigned_to_id: string | null;
  assigned_to_name: string | null;
  created_by: string;
}

export interface CanonicalFollowupProjectionSkip {
  caseId: string;
  followUpKey: string;
  reason: 'missing_source' | 'missing_customer_name' | 'missing_branch' | 'blocked';
}

export interface CanonicalFollowupBuildResult {
  rows: CanonicalFollowupActionRow[];
  skipped: CanonicalFollowupProjectionSkip[];
}

export interface CanonicalFollowupProjectionResult extends CanonicalFollowupBuildResult {
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

function materializerPriority(priority: 'high' | 'medium' | 'low') {
  if (priority === 'high') return 'urgent';
  if (priority === 'medium') return 'important';
  return 'normal';
}

function operationalReason(reason: FollowUpReason) {
  const reasons: Record<FollowUpReason, string> = {
    stock_unavailable: 'الصنف غير متوفر ويحتاج متابعة عند التوفر',
    stock_check_pending: 'فحص التوفر ما زال معلقًا ويحتاج رد للعميل',
    customer_asked_to_wait: 'العميل طلب الانتظار ويحتاج متابعة',
    customer_considering: 'العميل ما زال يدرس الاختيار ويحتاج متابعة',
    price_objection: 'اعتراض السعر ما زال مفتوحًا ويحتاج متابعة مناسبة',
    alternative_open: 'البديل معروض وقرار العميل ما زال مفتوحًا',
    prescription_incomplete: 'تفاصيل الروشتة غير مكتملة وتحتاج استكمالًا',
    staff_promised_check: 'تم وعد العميل بالمراجعة ويجب استكمال الرد',
    callback_requested: 'العميل طلب معاودة التواصل في موعد محدد',
    delivery_unresolved: 'حالة التوصيل غير محسومة وتحتاج متابعة',
    customer_no_response: 'العميل لم يرد بعد ويحتاج محاولة متابعة واحدة',
    staff_no_response: 'طلب العميل ما زال بدون رد ويحتاج استكمالًا',
  };
  return reasons[reason];
}

export function buildCanonicalFollowupActionRows(
  analyses: readonly SalesIntelligenceCaseAnalysis[],
  sources: readonly CanonicalFollowupSourceMetadata[]
): CanonicalFollowupBuildResult {
  const sourceById = new Map(sources.map((source) => [text(source.id), source]));
  const byIdentity = new Map<string, CanonicalFollowupActionRow>();
  const skipped: CanonicalFollowupProjectionSkip[] = [];

  for (const analysis of analyses) {
    const sourceId = text(analysis.conversationId);
    const source = sourceById.get(sourceId);
    for (const opportunity of analysis.followUp.opportunities) {
      if (opportunity.status !== 'actionable') continue;
      if (opportunity.blocker) {
        skipped.push({
          caseId: analysis.caseId,
          followUpKey: opportunity.followUpKey,
          reason: 'blocked',
        });
        continue;
      }
      if (!source) {
        skipped.push({
          caseId: analysis.caseId,
          followUpKey: opportunity.followUpKey,
          reason: 'missing_source',
        });
        continue;
      }

      const customerName = text(source.customer_name);
      const branch = text(analysis.conversationCase.branchNameRaw);
      if (!customerName) {
        skipped.push({
          caseId: analysis.caseId,
          followUpKey: opportunity.followUpKey,
          reason: 'missing_customer_name',
        });
        continue;
      }
      if (!branch) {
        skipped.push({
          caseId: analysis.caseId,
          followUpKey: opportunity.followUpKey,
          reason: 'missing_branch',
        });
        continue;
      }

      const explicitAssignedStaffId = uuidOrNull(opportunity.assignedStaffId);
      const row: CanonicalFollowupActionRow = {
        source_id: sourceId,
        action_key: `canonical-followup:${opportunity.followUpKey}`,
        action_type: 'customer_followup',
        status: 'ready',
        work_status: 'unassigned',
        auto_eligible: false,
        branch,
        customer_id: uuidOrNull(opportunity.customerId),
        customer_code: text(source.customer_code) || null,
        customer_name: customerName,
        customer_phone: text(analysis.conversationCase.customerPhone) || null,
        product_id: uuidOrNull(opportunity.productId),
        product_name: text(opportunity.productRaw) || null,
        quantity: opportunity.quantity == null ? null : Number(opportunity.quantity),
        due_at: text(opportunity.dueAt) || null,
        reason: operationalReason(opportunity.reason),
        evidence: [...opportunity.evidenceMessageIds],
        payload: {
          canonicalProjectionVersion: CANONICAL_FOLLOWUP_PROJECTION_VERSION,
          caseId: analysis.caseId,
          followUpKey: opportunity.followUpKey,
          canonicalReason: opportunity.reason,
          priority: materializerPriority(opportunity.priority),
          canonicalPriority: opportunity.priority,
          duePolicy: opportunity.duePolicy,
          requestedDelayDays: opportunity.requestedDelayDays,
          assignedRole: opportunity.assignedRole,
          goal: opportunity.goal,
          nextBestAction: opportunity.nextBestAction,
          demandKey: opportunity.demandKey,
          evidenceMessageIds: [...opportunity.evidenceMessageIds],
          confidenceLevel: opportunity.confidence.level,
        },
        followup_identity: opportunity.followUpKey,
        assigned_to_id: explicitAssignedStaffId,
        assigned_to_name: explicitAssignedStaffId ? text(opportunity.assignedStaffName) || null : null,
        created_by: CANONICAL_FOLLOWUP_PROJECTION_VERSION,
      };

      const existing = byIdentity.get(opportunity.followUpKey);
      if (existing) {
        if (existing.source_id !== row.source_id || existing.payload.caseId !== row.payload.caseId) {
          throw new Error(`canonical_followup_identity_collision:${opportunity.followUpKey}`);
        }
        continue;
      }
      byIdentity.set(opportunity.followUpKey, row);
    }
  }

  return { rows: [...byIdentity.values()], skipped };
}

export async function projectCanonicalFollowupsToActions(
  supabaseClient: any,
  analyses: readonly SalesIntelligenceCaseAnalysis[],
  sources: readonly CanonicalFollowupSourceMetadata[]
): Promise<CanonicalFollowupProjectionResult> {
  const built = buildCanonicalFollowupActionRows(analyses, sources);
  if (!built.rows.length) return { ...built, inserted: 0, existing: 0 };

  const identities = built.rows.map((row) => row.followup_identity);
  const { data: existingRows, error: existingError } = await supabaseClient
    .from('whatsapp_conversation_actions')
    .select('id,followup_identity,status,target_table,target_id')
    .in('followup_identity', identities);
  if (existingError) throw existingError;

  const existing = new Set(
    (existingRows || []).map((row: { followup_identity?: string | null }) => text(row.followup_identity)).filter(Boolean)
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

    // Concurrency-safe retry: a competing refresh may have inserted the same stable identity after
    // our preload. Only treat the unique violation as idempotent when that exact identity now exists.
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
