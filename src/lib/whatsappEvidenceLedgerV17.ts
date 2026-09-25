import { supabase } from '@/lib/supabase';
import type { WhatsAppConversationSession } from './whatsappConversationParser';
import type { WhatsAppOperationalIntelligenceV6 } from './whatsappOperationalIntelligenceV6';
import { selectVerifiedProductInvoiceV23 } from './salesIntelligence/productInvoiceVerificationV23';
import { fetchInvoiceItemEvidenceProvider } from './salesIntelligence/invoiceItemEvidenceRepository';

export interface WhatsAppEvidenceLedgerContextV17 {
  sourceId: string;
  contextOnly?: boolean;
  operational: WhatsAppOperationalIntelligenceV6 & { productJourney?: any };
  analysisVersion?: string | null;
  participantRoles?: any;
}

type FactType =
  | 'greeting' | 'response_delay' | 'customer_request' | 'request_registered' | 'quantity_confirmed' | 'address_confirmed'
  | 'stock_unavailable' | 'availability_confirmed' | 'alternative_offered' | 'recommendation' | 'recommendation_accepted'
  | 'recommendation_rejected' | 'order_confirmed' | 'order_failed' | 'delivery_delay' | 'complaint' | 'apology'
  | 'service_followup' | 'customer_replied' | 'customer_silent' | 'verified_sale' | 'media_missing_context'
  | 'conversation_closed' | 'needs_followup';

const DELAY_RX = /(متاخر|متأخر|تأخير|تاخير|لسه مجاش|ماوصلش|موصلش|محدش رد)/i;
const COMPLAINT_RX = /(شكوى|شكوي|مشكله|مشكلة|اتضايقت|زعلت|وحش|سيء|غلط)/i;
const APOLOGY_RX = /(بنعتذر|نعتذر|متاسف|متأسف|اسفين|آسفين|حقك علينا)/i;
const GREETING_RX = /(السلام عليكم|مساء الخير|صباح الخير|اهلا|أهلا|ازيك|إزي حضرتك)/i;
const ADDRESS_RX = /(العنوان|شارع|عماره|عمارة|برج|الدور|شقه|شقة|منطقه|منطقة)/i;
const MEDIA_RX = /(image omitted|video omitted|audio omitted|sticker omitted|document omitted|<attached:|\.jpg|\.jpeg|\.png|\.webp|\.opus|\.ogg|\.mp4|\.pdf)/i;

function roleForStaff(participantRoles: any, staffName: string | null) {
  const rows = Array.isArray(participantRoles?.participants) ? participantRoles.participants : Array.isArray(participantRoles) ? participantRoles : [];
  if (!staffName) return null;
  const normalized = staffName.trim().toLowerCase();
  const match = rows.find((row: any) => String(row?.name || row?.sender || '').trim().toLowerCase() === normalized);
  return match?.role || match?.resolvedRole || null;
}

function lastOutboundIndex(session: WhatsAppConversationSession) {
  for (let i = session.messages.length - 1; i >= 0; i -= 1) if (session.messages[i].direction === 'outbound') return i;
  return -1;
}

function customerSilentAfterLastOutbound(session: WhatsAppConversationSession) {
  const idx = lastOutboundIndex(session);
  if (idx < 0) return false;
  return !session.messages.slice(idx + 1).some((m) => m.direction === 'inbound');
}

function messageEvidence(session: WhatsAppConversationSession, rx: RegExp) {
  const rows = session.messages.filter((m) => rx.test(m.text || ''));
  return { messageIds: rows.map((m) => m.id).slice(0, 12), quote: rows[0]?.text?.slice(0, 220) || '' };
}

function stageToFact(stage: string): FactType | null {
  const map: Record<string, FactType> = {
    requested: 'customer_request',
    availability_confirmed: 'availability_confirmed',
    unavailable: 'stock_unavailable',
    alternative_offered: 'alternative_offered',
    recommended: 'recommendation',
    accepted: 'recommendation_accepted',
    rejected: 'recommendation_rejected',
    order_confirmed: 'order_confirmed',
  };
  return map[stage] || null;
}

function mapOpportunityStage(stage: string) {
  const map: Record<string, string> = {
    mentioned: 'detected', requested: 'requested', availability_confirmed: 'available', unavailable: 'unavailable',
    alternative_offered: 'alternative_offered', recommended: 'recommended', accepted: 'accepted', rejected: 'rejected',
    order_confirmed: 'order_confirmed', awaiting_invoice: 'awaiting_invoice', needs_followup: 'needs_followup', unresolved: 'detected',
  };
  return map[stage] || 'detected';
}

function normalizeKey(value: unknown) {
  return String(value ?? '').trim().toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 100) || 'unknown';
}

export function productEventWindowV23(session: WhatsAppConversationSession, product: any, fallbackStart: string | null, fallbackEnd: string | null) {
  const ids = new Set<string>();
  for (const event of Array.isArray(product?.events) ? product.events : []) {
    for (const id of Array.isArray(event?.messageIds) ? event.messageIds : []) ids.add(String(id));
  }
  const timestamps = session.messages
    .filter((message) => ids.has(String(message.id)))
    .map((message) => message.timestamp?.toISOString?.())
    .filter(Boolean) as string[];
  timestamps.sort();
  return {
    openedAt: timestamps[0] || fallbackStart || new Date().toISOString(),
    lastStageAt: timestamps[timestamps.length - 1] || fallbackEnd || fallbackStart || new Date().toISOString(),
  };
}

export async function resolveProductInvoiceVerificationV23(source: any, product: any, openedAt: string, lastStageAt: string) {
  if (!product?.productId && !product?.productCode && !product?.productName) return null;

  const startMs = new Date(openedAt).getTime();
  const endMs = new Date(lastStageAt).getTime();
  const queryStart = new Date((Number.isFinite(startMs) ? startMs : Date.now()) - 10 * 60 * 1000).toISOString();
  const queryEnd = new Date((Number.isFinite(endMs) ? endMs : Date.now()) + 36 * 60 * 60 * 1000).toISOString();

  let invoiceQuery = supabase
    .from('sales_invoices')
    .select('id,invoice_number,invoice_datetime,close_datetime,net_total,total_amount,net_amount,amount,branch,customer_id,customer_code')
    .gte('invoice_datetime', queryStart)
    .lte('invoice_datetime', queryEnd)
    .limit(100);

  if (source.customer_code) invoiceQuery = invoiceQuery.eq('customer_code', source.customer_code);
  else if (source.customer_id) invoiceQuery = invoiceQuery.eq('customer_id', source.customer_id);
  else return null;

  if (source.branch) invoiceQuery = invoiceQuery.eq('branch', source.branch);

  const { data: invoices, error: invoiceError } = await invoiceQuery;
  if (invoiceError) throw invoiceError;
  if (!invoices?.length) return null;

  const itemEvidenceProvider = await fetchInvoiceItemEvidenceProvider(supabase, invoices as any[]);
  const effectiveItems = (invoices as any[]).flatMap((invoice) => {
    const invoiceId = String(invoice.id || '').trim();
    if (!invoiceId) return [];
    const rows = itemEvidenceProvider.getItemsForInvoice(invoiceId, null);
    if (rows === 'unavailable') return [];
    return rows.map((item) => ({
      invoice_id: invoiceId,
      invoice_number: invoice.invoice_number || null,
      product_id: item.productId || null,
      product_code: item.productCode || null,
      product_name: item.productNameRaw || null,
      quantity: item.quantity,
      line_total: item.netLineAmount ?? item.lineTotal ?? null,
    }));
  });

  return selectVerifiedProductInvoiceV23({
    product: {
      productId: product.productId || null,
      productCode: product.productCode || null,
      productName: product.productName || null,
    },
    openedAt,
    lastStageAt,
    invoices: invoices as any[],
    items: effectiveItems,
  });
}

export interface ProductOpportunityTruthPlanV23 {
  productId: string | null;
  productCode: string | null;
  productName: string | null;
  openedAt: string;
  lastStageAt: string;
  currentStage: string;
  status: string;
  saleVerifiedScope: 'product_invoice_item' | 'none';
  matchedInvoiceId: string | null;
  matchedInvoiceNumber: string | null;
  matchedInvoiceValue: number | null;
  leakageCode: string | null;
  leakageReason: string | null;
  nextAction: string | null;
  verification: null | {
    evidence: string;
    finalPaid: boolean;
    timeDistanceMinutes: number | null;
  };
}

export async function planProductOpportunityTruthV23(
  session: WhatsAppConversationSession,
  source: any,
  product: any
): Promise<ProductOpportunityTruthPlanV23> {
  const window = productEventWindowV23(
    session,
    product,
    source.conversation_started_at || null,
    source.conversation_ended_at || null
  );
  const productInvoice = await resolveProductInvoiceVerificationV23(
    source,
    product,
    window.openedAt,
    window.lastStageAt
  );
  const currentStage = productInvoice ? 'verified_sale' : mapOpportunityStage(product.currentStage);
  return {
    productId: product.productId || null,
    productCode: product.productCode || null,
    productName: product.productName || null,
    openedAt: window.openedAt,
    lastStageAt: window.lastStageAt,
    currentStage,
    status: productInvoice ? 'won' : currentStage === 'rejected' ? 'lost' : 'open',
    saleVerifiedScope: productInvoice ? 'product_invoice_item' : 'none',
    matchedInvoiceId: productInvoice?.invoiceId || null,
    matchedInvoiceNumber: productInvoice?.invoiceNumber || null,
    matchedInvoiceValue: productInvoice?.invoiceValue ?? null,
    leakageCode: productInvoice ? null : product.leakageCode || null,
    leakageReason: productInvoice ? null : product.leakageReason || null,
    nextAction: productInvoice ? null : product.nextAction || null,
    verification: productInvoice
      ? {
          evidence: productInvoice.productEvidence,
          finalPaid: productInvoice.finalPaid,
          timeDistanceMinutes: productInvoice.timeDistanceMinutes,
        }
      : null,
  };
}

export async function syncWhatsAppEvidenceLedgerV17(session: WhatsAppConversationSession, context: WhatsAppEvidenceLedgerContextV17) {
  const { data: source, error: sourceError } = await supabase
    .from('whatsapp_review_sources')
    .select('id,branch,customer_id,customer_code,customer_name,customer_phone,staff_id,staff_name,conversation_started_at,conversation_ended_at,analysis_version,invoice_match_status,matched_invoice_id,matched_invoice_number,matched_invoice_value,invoice_match_confidence,analysis_json')
    .eq('id', context.sourceId)
    .single();
  if (sourceError) throw sourceError;

  const { data: journeyLink } = await supabase
    .from('whatsapp_customer_journey_sessions')
    .select('journey_id,whatsapp_customer_journeys!inner(story_id)')
    .eq('source_id', context.sourceId)
    .maybeSingle();
  const journeyId = (journeyLink as any)?.journey_id || null;
  const storyId = (journeyLink as any)?.whatsapp_customer_journeys?.story_id || null;
  const staffRole = roleForStaff(context.participantRoles || source.analysis_json?.participantRoles, source.staff_name || null);

  const base = {
    source_id: context.sourceId,
    journey_id: journeyId,
    story_id: storyId,
    branch: source.branch || null,
    customer_id: source.customer_id || null,
    customer_code: source.customer_code || null,
    customer_name: source.customer_name || null,
    customer_phone: source.customer_phone || null,
    staff_id: source.staff_id || null,
    staff_name: source.staff_name || null,
    staff_role: staffRole,
    analysis_version: context.analysisVersion || source.analysis_version || 'whatsapp-evidence-v17',
    review_state: 'proposed',
    official_eligible: false,
    updated_at: new Date().toISOString(),
  };

  const facts: any[] = [];
  const addFact = (factType: FactType, factKey: string, confidence: number, evidenceKind: string, evidence: any, extra: any = {}) => {
    facts.push({ ...base, fact_key: factKey, fact_type: factType, fact_at: extra.fact_at || source.conversation_started_at || new Date().toISOString(), confidence: Math.max(0, Math.min(100, Math.round(confidence))), evidence_kind: evidenceKind, evidence_json: evidence || {}, ...extra });
  };

  const allText = session.messages.map((m) => m.text || '').join('\n');
  const outboundText = session.messages.filter((m) => m.direction === 'outbound').map((m) => m.text || '').join('\n');
  if (GREETING_RX.test(outboundText)) addFact('greeting', 'service:greeting', 88, 'message', messageEvidence(session, GREETING_RX));
  if (DELAY_RX.test(allText)) addFact(context.operational.primaryIntent === 'delivery_issue' ? 'delivery_delay' : 'response_delay', 'service:delay', 82, 'message', messageEvidence(session, DELAY_RX));
  const complaintEvidenceIds = context.operational.evidence?.complaint?.messageIds || [];
  if (complaintEvidenceIds.length || context.operational.primaryIntent === 'complaint') {
    addFact(
      'complaint',
      'service:complaint',
      Math.max(82, context.operational.intentConfidence || 0),
      'message',
      {
        messageIds: complaintEvidenceIds,
        quote: context.operational.evidence?.complaint?.quote || '',
      }
    );
  }
  if (APOLOGY_RX.test(outboundText)) addFact('apology', 'service:apology', 91, 'message', messageEvidence(session, APOLOGY_RX));
  if (ADDRESS_RX.test(allText)) addFact('address_confirmed', 'order:address-mentioned', 68, 'message', messageEvidence(session, ADDRESS_RX));
  if (MEDIA_RX.test(allText)) addFact('media_missing_context', 'context:media-reference', 98, 'media', messageEvidence(session, MEDIA_RX));

  if (context.operational.primaryIntent === 'proactive_checkin' || context.contextOnly) {
    addFact('service_followup', 'service:followup', Math.max(75, context.operational.intentConfidence || 0), 'journey', { primaryIntent: context.operational.primaryIntent, contextOnly: Boolean(context.contextOnly) });
  }
  if (customerSilentAfterLastOutbound(session) && session.messages.some((m) => m.direction === 'outbound')) {
    addFact('customer_silent', 'customer:silent-after-outbound', 94, 'message', { lastOutboundMessageId: session.messages[lastOutboundIndex(session)]?.id || null });
  } else if (session.messages.some((m) => m.direction === 'inbound')) {
    addFact('customer_replied', 'customer:replied', 96, 'message', { inboundMessageIds: session.messages.filter((m) => m.direction === 'inbound').map((m) => m.id).slice(-5) });
  }

  for (const request of context.operational.customerRequests || []) {
    const key = `request:${normalizeKey(request.productName || request.evidenceMessageIds?.[0])}`;
    addFact('customer_request', key, request.confidence || 75, 'message', { messageIds: request.evidenceMessageIds || [], unresolved: request.unresolved, urgency: request.urgency }, { product_name: request.productName || null, quantity: request.quantity ?? null });
    if (request.quantity != null) addFact('quantity_confirmed', `${key}:quantity`, Math.min(95, (request.confidence || 75) + 5), 'message', { messageIds: request.evidenceMessageIds || [] }, { product_name: request.productName || null, quantity: request.quantity });
  }

  for (const rec of context.operational.recommendations || []) {
    const key = `recommendation:${normalizeKey(rec.productName || rec.evidenceMessageIds?.[0])}`;
    addFact('recommendation', key, rec.confidence || 75, 'message', { messageIds: rec.evidenceMessageIds || [], doctorName: rec.doctorName || null }, { product_name: rec.productName || null });
    if (rec.accepted === true) addFact('recommendation_accepted', `${key}:accepted`, Math.max(88, rec.confidence || 0), 'message', { messageIds: rec.evidenceMessageIds || [] }, { product_name: rec.productName || null });
    if (rec.accepted === false || rec.rejected) addFact('recommendation_rejected', `${key}:rejected`, Math.max(88, rec.confidence || 0), 'message', { messageIds: rec.evidenceMessageIds || [] }, { product_name: rec.productName || null });
  }

  const productJourney = context.operational.productJourney;
  const journeys = Array.isArray(productJourney?.journeys) ? productJourney.journeys : [];
  for (const product of journeys) {
    const pkey = normalizeKey(product.productCode || product.productName);
    for (const event of Array.isArray(product.events) ? product.events : []) {
      const factType = stageToFact(String(event.stage));
      if (!factType) continue;
      addFact(factType, `product:${pkey}:${event.stage}`, event.confidence || product.confidence || 70, 'journey', { messageIds: event.messageIds || [], note: event.note || null, stage: event.stage }, { product_id: product.productId || null, product_code: product.productCode || null, product_name: product.productName || null, quantity: product.quantity ?? null });
    }
    if (product.followupCandidate) addFact('needs_followup', `product:${pkey}:followup`, product.confidence || 75, 'journey', { nextAction: product.nextAction, leakageReason: product.leakageReason }, { product_id: product.productId || null, product_code: product.productCode || null, product_name: product.productName || null, quantity: product.quantity ?? null });
  }

  if (context.operational.followupPlan?.required) addFact('needs_followup', 'journey:needs-followup', 88, 'journey', context.operational.followupPlan);
  if (context.operational.operationalOutcome === 'unresolved_request') addFact('order_failed', 'journey:unresolved-request', Math.max(80, context.operational.outcomeConfidence || 0), 'journey', { outcome: context.operational.operationalOutcome });
  // invoice_match_status='verified' is an automated statistical matcher result, not invoice-specific trusted proof.\n  // Never emit verified_sale from this legacy source. Canonical Sale Proof is owned by Sales Intelligence.

  if (facts.length) {
    const { error } = await supabase.from('whatsapp_evidence_facts_v17').upsert(facts, { onConflict: 'source_id,fact_key', ignoreDuplicates: false });
    if (error) throw error;
  }

  const isCanonicalProductDemandRun = /^product-demand-v22(?:\.|$)/.test(String(context.analysisVersion || ''));
  const opportunityJourneys = isCanonicalProductDemandRun
    ? journeys.filter((p: any) => Boolean(p.productId && p.productCode))
    : journeys;
  const opportunityCandidates = opportunityJourneys.filter(
    (p: any) => p.saleIntent || (p.events || []).some((e: any) => ['requested','recommended','alternative_offered','accepted','order_confirmed'].includes(e.stage))
  );

  const opportunities: any[] = [];
  for (const product of opportunityCandidates) {
    const pkey = `product:${normalizeKey(product.productCode || product.productName)}`;
    const truth = isCanonicalProductDemandRun
      ? await planProductOpportunityTruthV23(session, source, product)
      : {
          productId: product.productId || null,
          productCode: product.productCode || null,
          productName: product.productName || null,
          openedAt: source.conversation_started_at || new Date().toISOString(),
          lastStageAt: source.conversation_ended_at || source.conversation_started_at || new Date().toISOString(),
          currentStage: mapOpportunityStage(product.currentStage),
          status: mapOpportunityStage(product.currentStage) === 'rejected' ? 'lost' : 'open',
          saleVerifiedScope: 'none',
          matchedInvoiceId: null,
          matchedInvoiceNumber: null,
          matchedInvoiceValue: null,
          leakageCode: product.leakageCode || null,
          leakageReason: product.leakageReason || null,
          nextAction: product.nextAction || null,
          verification: null,
        };

    opportunities.push({
      root_source_id: context.sourceId,
      story_id: storyId,
      journey_id: journeyId,
      opportunity_key: pkey,
      branch: source.branch || null,
      customer_id: source.customer_id || null,
      customer_code: source.customer_code || null,
      customer_name: source.customer_name || null,
      customer_phone: source.customer_phone || null,
      attributed_staff_id: source.staff_id || null,
      attributed_staff_name: source.staff_name || null,
      attributed_staff_role: staffRole,
      product_id: product.productId || null,
      product_code: product.productCode || null,
      product_name: product.productName || null,
      quantity: product.quantity ?? null,
      opened_at: truth.openedAt,
      last_stage_at: truth.lastStageAt,
      current_stage: truth.currentStage,
      status: truth.status,
      confidence: truth.saleVerifiedScope === 'product_invoice_item'
        ? Math.max(96, Math.max(0, Math.min(100, Math.round(Number(product.confidence || 0)))))
        : Math.max(0, Math.min(100, Math.round(Number(product.confidence || 0)))),
      sale_verified_scope: truth.saleVerifiedScope,
      matched_invoice_id: truth.matchedInvoiceId,
      matched_invoice_number: truth.matchedInvoiceNumber,
      matched_invoice_value: truth.matchedInvoiceValue,
      leakage_reason: truth.leakageReason,
      next_action: truth.nextAction,
      evidence_json: {
        events: product.events || [],
        leakageCode: truth.leakageCode,
        productInvoiceVerification: truth.verification,
        note: truth.saleVerifiedScope === 'product_invoice_item'
          ? 'بيع الصنف موثق من نفس العميل والفرع وبند الفاتورة نفسه؛ لا يعتمد على matched_invoice_id العام للمحادثة.'
          : 'لا توجد فاتورة تحتوي هذا الصنف داخل نافذة الطلب؛ matched_invoice_id العام للمحادثة لا يثبت بيع الصنف.'
      },
      analysis_version: context.analysisVersion || source.analysis_version || 'whatsapp-evidence-v17',
      updated_at: new Date().toISOString(),
    });
  }

  if (opportunities.length) {
    const { error } = await supabase.from('whatsapp_sales_opportunities_v17').upsert(opportunities, { onConflict: 'root_source_id,opportunity_key', ignoreDuplicates: false });
    if (error) throw error;
  }

  return { facts: facts.length, opportunities: opportunities.length };
}
