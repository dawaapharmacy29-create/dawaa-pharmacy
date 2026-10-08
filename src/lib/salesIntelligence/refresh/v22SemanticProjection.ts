// Canonical semantic projection: Sales Intelligence -> Customer Case V22 (compatibility view).
//
// Before Sales Intelligence, V22 is only the case ENVELOPE (grouping, ownership, Canonical Source
// Gate). Its regex-derived semantic columns are preliminary. After the canonical analysis is
// persisted, this follower projects the canonical meaning onto those columns so legacy V22 screens
// stop showing a second, contradictory brain. It never parses text and adds no regex: it maps the
// persisted CaseIntelligenceView (incl. the canonical Operational Disposition).
//
// Contract
// * Projected (automatic) columns only: V22_PROJECTED_COLUMNS.
// * Never touched: confirmed_outcome, outcome_reviewed_*, confirmed_lost_reason, responsibility_*,
//   verified_* and case_json.canonicalSaleProof (owned by the V44/V46 proof writer), any human or
//   reviewer field. A proven sale keeps proposed_outcome/outcome_confidence (proof writer owns
//   them); a human-confirmed outcome outranks the automatic case_state/proposed_outcome.
// * The preliminary envelope values are kept once in case_json.canonicalSemanticProjection.preliminary
//   so (a) audit can compare them and (b) analysis inputs that read the envelope (payment
//   continuation assembly) never read SI's own output back — no SI -> V22 -> SI feedback loop.
// * Many SI cases -> one V22 is aggregated deterministically (never "last analysis wins"):
//   one case -> direct; several agreeing -> aggregate; conflicting -> coarse `open` + needs review.
// * Idempotent: an unchanged projection writes nothing.
import type { CaseIntelligenceView, CaseOperationalDisposition, NextBestAction } from '../types';

export const V22_SEMANTIC_PROJECTION_VERSION = 'v22-semantic-projection-v1';

export const V22_PROJECTED_COLUMNS = [
  'order_intent',
  'commercial_opportunity',
  'case_type',
  'case_state',
  'proposed_outcome',
  'outcome_confidence',
  'next_action',
  'summary',
  'needs_human_review',
] as const;
type ProjectedColumn = (typeof V22_PROJECTED_COLUMNS)[number];
type ProjectedValues = Partial<Record<ProjectedColumn, unknown>>;

export interface SiCaseProjectionFact {
  salesCaseId: string;
  analysisId: string;
  pipelineVersion: string;
  view: CaseIntelligenceView;
}

export interface V22ProjectionRow {
  id: string;
  case_json: Record<string, any> | null;
  confirmed_outcome: string | null;
  updated_at: string | null;
  [column: string]: unknown;
}

export interface V22ProjectionDecision {
  v22CaseId: string;
  status: 'projected' | 'unchanged' | 'skipped';
  reason: string | null;
  patch: Record<string, unknown> | null;
}

const NEXT_ACTION_LABEL: Record<NextBestAction, string> = {
  respond_to_customer_request: 'الرد على طلب العميل المفتوح.',
  complete_stock_check_and_reply: 'إكمال مراجعة التوفر والرد على العميل.',
  complete_promised_check: 'تنفيذ ما وعد به الموظف والرجوع للعميل.',
  contact_customer_when_product_available: 'التواصل مع العميل عند توفر الصنف.',
  confirm_alternative_decision: 'متابعة قرار العميل في البديل المقترح.',
  check_customer_decision: 'متابعة قرار العميل.',
  follow_up_with_value_or_allowed_offer: 'متابعة اعتراض السعر بقيمة أو عرض مسموح.',
  request_missing_prescription_details: 'طلب بيانات/صورة الروشتة الناقصة.',
  resolve_delivery_status: 'حل مشكلة التوصيل وتأكيدها مع العميل.',
  contact_customer_at_requested_time: 'التواصل مع العميل في الوقت الذي طلبه.',
  send_single_recovery_followup: 'رسالة متابعة واحدة لاستعادة العميل.',
};

const STATE_LABEL: Record<CaseOperationalDisposition['state'], string> = {
  action_required_pharmacy: 'مطلوب إجراء من الصيدلية',
  awaiting_customer: 'في انتظار العميل',
  awaiting_stock: 'في انتظار توفر الصنف',
  awaiting_delivery: 'في انتظار التوصيل',
  awaiting_invoice: 'في انتظار الفاتورة',
  closed: 'مغلقة',
  open_unknown: 'مفتوحة',
};

/** Canonical values one SI case implies for the V22 vocabulary (no text parsing). */
export function projectSingleCase(fact: SiCaseProjectionFact): ProjectedValues & { _state: CaseOperationalDisposition['state']; _nba: NextBestAction | null } {
  const view = fact.view;
  const disposition = view.operationalDisposition!;
  const outcome = view.sale.outcome;
  const requested = view.need.products.some((p) => p.roles.includes('requested'));
  const orderIntent =
    requested || outcome === 'order_confirmed_unproven' || outcome === 'customer_confirmed_unproven' || outcome === 'sale_proven';
  const commercial =
    view.lostOpportunity.state !== 'no_commercial_opportunity' && outcome !== 'information_only';

  let caseState: string;
  switch (disposition.state) {
    case 'action_required_pharmacy':
    case 'awaiting_stock':
      caseState = 'awaiting_pharmacy';
      break;
    case 'awaiting_customer':
      caseState = 'awaiting_customer';
      break;
    case 'awaiting_delivery':
    case 'awaiting_invoice':
      caseState = view.sale.customerConfirmed || outcome === 'order_confirmed_unproven' || outcome === 'sale_proven' ? 'confirmed_order' : 'awaiting_pharmacy';
      break;
    case 'closed':
      caseState = 'closed';
      break;
    default:
      caseState = 'open';
  }

  // proposed_outcome only where the V22 vocabulary has a semantically valid value.
  let proposedOutcome: string | undefined;
  if (disposition.state === 'action_required_pharmacy' || disposition.state === 'awaiting_stock') proposedOutcome = 'awaiting_pharmacy';
  else if (disposition.state === 'awaiting_customer') proposedOutcome = 'awaiting_customer';
  else if (disposition.state === 'awaiting_delivery') proposedOutcome = 'followup_needed';
  else if (disposition.state === 'awaiting_invoice' || disposition.commercialState === 'closed_order_unproven') proposedOutcome = 'order_confirmed_waiting_invoice';
  else if (disposition.state === 'open_unknown') proposedOutcome = 'open';

  const need = view.need.primaryNeed ? `الاحتياج: ${view.need.primaryNeed}` : null;
  const values: ProjectedValues & { _state: CaseOperationalDisposition['state']; _nba: NextBestAction | null } = {
    order_intent: orderIntent,
    commercial_opportunity: commercial,
    case_state: caseState,
    outcome_confidence: Math.round((disposition.confidence.score || 0) * 100),
    next_action: disposition.nextBestAction ? NEXT_ACTION_LABEL[disposition.nextBestAction] : null,
    summary: [need, `الحالة التشغيلية: ${STATE_LABEL[disposition.state]}`].filter(Boolean).join(' · '),
    _state: disposition.state,
    _nba: disposition.nextBestAction,
  };
  // case_type only where the mapping is semantically valid (a canonical product/order need).
  if (orderIntent) values.case_type = 'order';
  if (proposedOutcome) values.proposed_outcome = proposedOutcome;
  return values;
}

/** Deterministic multi-case aggregation for one V22 envelope. */
export function aggregateV22Projection(facts: SiCaseProjectionFact[]):
  | { status: 'ok'; values: ProjectedValues; reasonCodes: string[]; evidenceMessageIds: string[]; confidence: number; mode: 'direct' | 'aggregate' | 'mixed' }
  | { status: 'skipped'; reason: string } {
  if (!facts.length) return { status: 'skipped', reason: 'no_active_sales_intelligence_case' };
  if (facts.some((fact) => !fact.view?.operationalDisposition)) {
    return { status: 'skipped', reason: 'incomplete_canonical_analyses' };
  }
  const sorted = facts.slice().sort((a, b) => a.salesCaseId.localeCompare(b.salesCaseId));
  const projected = sorted.map(projectSingleCase);
  const evidenceMessageIds = [...new Set(sorted.flatMap((f) => f.view.operationalDisposition!.evidenceMessageIds))];
  const reasonCodes = [...new Set(sorted.flatMap((f) => f.view.operationalDisposition!.reasonCodes))];
  const confidence = Math.min(...sorted.map((f) => f.view.operationalDisposition!.confidence.score || 0));

  if (projected.length === 1) {
    const { _state, _nba, ...values } = projected[0];
    return { status: 'ok', values: { ...values, needs_human_review: false }, reasonCodes, evidenceMessageIds, confidence, mode: 'direct' };
  }

  const states = new Set(projected.map((p) => p._state));
  const openStates = [...states].filter((s) => s !== 'closed');
  const orderIntent = projected.some((p) => p.order_intent === true);
  const commercial = projected.some((p) => p.commercial_opportunity === true);
  const base: ProjectedValues = {
    order_intent: orderIntent,
    commercial_opportunity: commercial,
    ...(orderIntent ? { case_type: 'order' } : {}),
    outcome_confidence: Math.round(confidence * 100),
  };

  if (openStates.length <= 1) {
    // Agreeing cases: every open case wants the same thing (closed siblings do not conflict).
    const leader = projected.find((p) => p._state === (openStates[0] ?? 'closed'))!;
    const { _state, _nba, ...values } = leader;
    return {
      status: 'ok',
      values: { ...values, ...base, needs_human_review: false },
      reasonCodes: [...reasonCodes, 'v22_projection.aggregate_agreeing_cases'],
      evidenceMessageIds,
      confidence,
      mode: 'aggregate',
    };
  }

  // Conflicting actionable states: never guess one of them.
  const actions = [...new Set(projected.map((p) => p.next_action).filter(Boolean))];
  return {
    status: 'ok',
    values: {
      ...base,
      case_state: 'open',
      proposed_outcome: 'followup_needed',
      next_action: actions.join(' / ') || null,
      summary: `حالات متعددة بحالات تشغيلية مختلفة: ${openStates.map((s) => STATE_LABEL[s]).join('، ')}`,
      needs_human_review: true,
    },
    reasonCodes: [...reasonCodes, 'v22_projection.mixed_operational_states'],
    evidenceMessageIds,
    confidence,
    mode: 'mixed',
  };
}

function same(a: unknown, b: unknown) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** Pure: decides the V22 patch (or no-op) for one envelope row and its active SI facts. */
export function decideV22Projection(row: V22ProjectionRow, facts: SiCaseProjectionFact[], nowIso: string): V22ProjectionDecision {
  const aggregate = aggregateV22Projection(facts);
  if (aggregate.status === 'skipped') {
    return { v22CaseId: row.id, status: 'skipped', reason: aggregate.reason, patch: null };
  }
  const caseJson = row.case_json && typeof row.case_json === 'object' ? row.case_json : {};
  const previous = caseJson.canonicalSemanticProjection || null;
  const preliminary =
    previous?.preliminary ??
    Object.fromEntries(V22_PROJECTED_COLUMNS.map((column) => [column, row[column] ?? null]));

  const guards: string[] = [];
  const values: ProjectedValues = { ...aggregate.values };
  if (String(caseJson.canonicalSaleProof?.state || '') === 'proven') {
    delete values.proposed_outcome;
    delete values.outcome_confidence;
    guards.push('v22_projection.sale_proof_owned_by_proof_writer');
  }
  if (row.confirmed_outcome) {
    delete values.proposed_outcome;
    delete values.case_state;
    guards.push('v22_projection.human_confirmed_outcome_outranks');
  }

  const columnPatch: Record<string, unknown> = {};
  for (const [column, value] of Object.entries(values)) {
    if (!same(row[column], value)) columnPatch[column] = value;
  }

  const sorted = facts.slice().sort((a, b) => a.salesCaseId.localeCompare(b.salesCaseId));
  const projectionCore = {
    source: 'sales_intelligence',
    version: V22_SEMANTIC_PROJECTION_VERSION,
    mode: aggregate.mode,
    salesCaseIds: sorted.map((f) => f.salesCaseId),
    analysisIds: sorted.map((f) => f.analysisId),
    pipelineVersions: [...new Set(sorted.map((f) => f.pipelineVersion))],
    reasonCodes: [...aggregate.reasonCodes, ...guards],
    evidenceMessageIds: aggregate.evidenceMessageIds,
    confidence: aggregate.confidence,
    projectedValues: values,
    preliminary,
  };
  const previousCore = previous ? { ...previous } : null;
  if (previousCore) delete previousCore.projectedAt;

  if (!Object.keys(columnPatch).length && same(previousCore, projectionCore)) {
    return { v22CaseId: row.id, status: 'unchanged', reason: null, patch: null };
  }
  return {
    v22CaseId: row.id,
    status: 'projected',
    reason: null,
    patch: {
      ...columnPatch,
      case_json: { ...caseJson, canonicalSemanticProjection: { ...projectionCore, projectedAt: nowIso } },
    },
  };
}

/**
 * The envelope (preliminary) values of a V22 row: what analysis inputs may read. Once a canonical
 * projection exists, the columns hold SI's meaning, so the preliminary snapshot is returned instead.
 */
export function v22EnvelopeValue(row: { case_json?: any; [column: string]: unknown }, column: ProjectedColumn): unknown {
  const preliminary = row.case_json?.canonicalSemanticProjection?.preliminary;
  return preliminary && Object.prototype.hasOwnProperty.call(preliminary, column) ? preliminary[column] : row[column];
}

const V22_CHUNK = 40;

/**
 * I/O follower: loads every ACTIVE SI case of each touched V22 envelope (not only the ones in this
 * batch), aggregates, and writes with optimistic concurrency on updated_at. Never throws; returns a
 * per-envelope report so a projection failure is visible without rolling back canonical truth.
 */
export async function projectCanonicalSemanticsToV22(
  service: any,
  v22CaseIds: string[],
  nowIso: string = new Date().toISOString()
): Promise<Array<V22ProjectionDecision & { error?: string }>> {
  const ids = [...new Set(v22CaseIds.filter(Boolean))];
  const out: Array<V22ProjectionDecision & { error?: string }> = [];
  for (let index = 0; index < ids.length; index += V22_CHUNK) {
    const chunk = ids.slice(index, index + V22_CHUNK);
    try {
      const { data: cases, error: caseError } = await service
        .from('sales_intelligence_cases')
        .select('case_id,source_case_id_v22')
        .in('source_case_id_v22', chunk)
        .eq('is_active', true)
        .limit(500);
      if (caseError) throw caseError;
      const salesCaseIds = (cases || []).map((row: any) => String(row.case_id));
      const factsByV22 = new Map<string, SiCaseProjectionFact[]>();
      if (salesCaseIds.length) {
        const { data: analyses, error: analysisError } = await service
          .from('sales_intelligence_case_analyses')
          .select('analysis_id,case_id,pipeline_version,case_intelligence:evidence_snapshot->caseIntelligence')
          .in('case_id', salesCaseIds)
          .eq('is_current', true)
          .limit(500);
        if (analysisError) throw analysisError;
        const v22ByCase = new Map<string, string>((cases || []).map((row: any) => [String(row.case_id), String(row.source_case_id_v22)]));
        for (const row of analyses || []) {
          const v22Id = v22ByCase.get(String(row.case_id));
          if (!v22Id) continue;
          const list = factsByV22.get(v22Id) || [];
          list.push({
            salesCaseId: String(row.case_id),
            analysisId: String(row.analysis_id),
            pipelineVersion: String(row.pipeline_version || ''),
            view: row.case_intelligence as CaseIntelligenceView,
          });
          factsByV22.set(v22Id, list);
        }
      }

      for (const v22Id of chunk) {
        out.push(await projectOne(service, v22Id, factsByV22.get(v22Id) || [], nowIso));
      }
    } catch (error) {
      for (const v22Id of chunk) {
        out.push({ v22CaseId: v22Id, status: 'skipped', reason: 'projection_lookup_failed', patch: null, error: errorText(error) });
      }
    }
  }
  return out;
}

const ROW_COLUMNS = ['id', 'case_json', 'confirmed_outcome', 'updated_at', ...V22_PROJECTED_COLUMNS].join(',');

async function projectOne(service: any, v22Id: string, facts: SiCaseProjectionFact[], nowIso: string) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data: row, error } = await service.from('whatsapp_customer_cases_v22').select(ROW_COLUMNS).eq('id', v22Id).maybeSingle();
    if (error) return { v22CaseId: v22Id, status: 'skipped' as const, reason: 'v22_lookup_failed', patch: null, error: errorText(error) };
    if (!row) return { v22CaseId: v22Id, status: 'skipped' as const, reason: 'v22_case_not_found', patch: null };
    const decision = decideV22Projection(row as V22ProjectionRow, facts, nowIso);
    if (decision.status !== 'projected') return decision;
    const { data: updated, error: updateError } = await service
      .from('whatsapp_customer_cases_v22')
      .update({ ...decision.patch, updated_at: nowIso })
      .eq('id', v22Id)
      .eq('updated_at', row.updated_at)
      .select('id');
    if (updateError) return { ...decision, status: 'skipped' as const, reason: 'v22_update_failed', error: errorText(updateError) };
    if ((updated || []).length) return decision;
    // A concurrent writer (proof writer / envelope sync) changed the row: re-read and re-decide once.
  }
  return { v22CaseId: v22Id, status: 'skipped' as const, reason: 'concurrent_update_retry_exhausted', patch: null };
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String((error as any).message);
  return String(error);
}
