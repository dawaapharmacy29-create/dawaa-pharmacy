// STEP 7A — the ONE production runtime-context owner for the canonical Sales Intelligence brain.
//
// Every real caller of runSalesIntelligencePipeline (the server batch persistence behind the
// canonical refresh, and the read-only QA live re-derivation) builds its per-conversation inputs
// HERE, so staff identity, customer identity, the product catalog and the segmentation inputs are
// identical everywhere:
//   - customer identity: Canonical Customer Identity Resolver; only `resolved` feeds customerIdHint;
//   - staff identity:    canonical staff directory -> buildStaffIdentityMap -> per-sender map;
//                        unique active names only, never first-staff-wins, never the customer;
//   - product catalog:   fetchPharmacyProductIndex (canonical catalog), no second resolver;
//   - case ids:          pipelineBaseInputFor() feeds BOTH the deriveCasesOnly pre-pass (via
//                        segmentationInputFromPipelineInput) and the real run.
import {
  isValidEgyptianCustomerMobile,
  normalizeDawaaCustomerCode,
  normalizeEgyptianCustomerPhone,
} from '../customers/customerIdentity';
import {
  resolveCanonicalCustomerIdentities,
  type CanonicalCustomerIdentityStatus,
} from '../customers/canonicalCustomerIdentityResolver';
import {
  loadStaffDirectoryFrom,
  type StaffDirectoryIdentity,
} from '../readModels/staffDirectoryReadModel';
import {
  buildStaffIdentityMap,
  normalizeDoctorName,
  staffDirectoryRowsFromIdentities,
  type StaffIdentityMap,
} from '../staff/staffIdentityResolver';
import { parseWhatsAppExport } from '../whatsappConversationParser';
import { fetchPharmacyProductIndex } from './pharmacyProductCatalogRepository';
import type { PharmacyProductIndex } from './pharmacyProducts/pharmacyProductResolverV2';
import type { SalesIntelligencePipelineInput } from './salesIntelligencePipeline';
import type { BatchConversationInput } from './persistence/batchPersistenceService';

export interface SalesIntelligenceRuntimeContext {
  /** Canonical staff identity map (id:/username:/name: keys; name keys only for unique active names). */
  staffIdentityMap: StaffIdentityMap;
  /**
   * Normalized names of EVERY active directory entry, including ambiguous (duplicated) ones. Never
   * used to attribute — only to know that a sender "looks like staff" and therefore cannot be the
   * proof that a customer remains in the conversation.
   */
  staffLikeNames: Set<string>;
  productIndex: PharmacyProductIndex;
}

/** A conversation whose customer + staff identity have been resolved by this owner. */
export interface PreparedSalesIntelligenceConversation extends BatchConversationInput {
  customerIdentityStatus: CanonicalCustomerIdentityStatus;
  staffIdBySender: Record<string, string>;
}

export type SalesIntelligencePipelineBaseInput = Omit<
  SalesIntelligencePipelineInput,
  'resolveInvoiceCandidates' | 'itemEvidenceProvider' | 'competingSelections'
>;

/** Pure: builds the runtime context from already-loaded canonical sources. */
export function buildSalesIntelligenceRuntimeContext(input: {
  staffDirectory: StaffDirectoryIdentity[];
  productIndex: PharmacyProductIndex;
}): SalesIntelligenceRuntimeContext {
  const rows = staffDirectoryRowsFromIdentities(input.staffDirectory);
  const staffIdentityMap = buildStaffIdentityMap(rows);
  const activeIds = new Set([...staffIdentityMap.values()].map((entry) => entry.staffId));
  const staffLikeNames = new Set(
    rows
      .filter((row) => activeIds.has(String(row.staff_id || row.id || '')))
      .map((row) => normalizeDoctorName(row.name || row.staff_name || ''))
      .filter(Boolean)
  );
  return { staffIdentityMap, staffLikeNames, productIndex: input.productIndex };
}

/**
 * Loads the runtime context once per batch through the caller's client. A staff-directory or
 * catalog failure throws (infrastructure failure) — analysis never silently runs with an empty
 * directory, which would persist "unresolved" staff that is really an outage.
 */
export async function loadSalesIntelligenceRuntimeContext(
  client: any
): Promise<SalesIntelligenceRuntimeContext> {
  const [staffDirectory, productIndex] = await Promise.all([
    loadStaffDirectoryFrom(client),
    fetchPharmacyProductIndex(client),
  ]);
  return buildSalesIntelligenceRuntimeContext({ staffDirectory, productIndex });
}

/**
 * Pure: maps each message sender of THIS conversation to a canonical staff.id when — and only
 * when — the sender's normalized name is a unique active staff name in the canonical directory.
 * Safety rules (unresolved is always better than a guess):
 *  - a sender equal to the customer name hint is never staff;
 *  - inbound senders are mapped only if at least one inbound sender has NO directory name match
 *    at all (unique or ambiguous) — that sender is the customer. A conversation whose every
 *    inbound sender "looks like" staff stays unmapped;
 *  - "You"/device-owner senders carry no name and therefore stay unmapped;
 *  - no filename, no first-staff-wins, no introduced-name guessing here.
 */
export function resolveStaffIdBySender(
  conversation: Pick<
    BatchConversationInput,
    'rawWhatsAppExportText' | 'trustedConversationStartedAt' | 'customerNameHint'
  >,
  context: Pick<SalesIntelligenceRuntimeContext, 'staffIdentityMap' | 'staffLikeNames'>
): Record<string, string> {
  const { staffIdentityMap, staffLikeNames } = context;
  if (!staffIdentityMap.size || !conversation.rawWhatsAppExportText) return {};
  const messages = parseWhatsAppExport(conversation.rawWhatsAppExportText, {
    trustedConversationStartedAt: conversation.trustedConversationStartedAt ?? null,
  }).filter((message) => message.direction !== 'system' && message.kind !== 'system');

  const customerName = normalizeDoctorName(conversation.customerNameHint ?? '');
  const directionBySender = new Map<string, Set<string>>();
  for (const message of messages) {
    const sender = String(message.sender ?? '').trim();
    if (!sender) continue;
    const directions = directionBySender.get(sender) ?? new Set<string>();
    directions.add(message.direction);
    directionBySender.set(sender, directions);
  }

  const resolved = new Map<string, string>();
  for (const sender of directionBySender.keys()) {
    const normalized = normalizeDoctorName(sender);
    if (!normalized || (customerName && normalized === customerName)) continue;
    const entry = staffIdentityMap.get(`name:${normalized}`);
    if (entry?.staffId) resolved.set(sender, entry.staffId);
  }

  const inboundSenders = [...directionBySender.entries()]
    .filter(([, directions]) => directions.has('inbound'))
    .map(([sender]) => sender);
  const customerRemains = inboundSenders.some((sender) => {
    const normalized = normalizeDoctorName(sender);
    if (customerName && normalized === customerName) return true;
    return !resolved.has(sender) && !staffLikeNames.has(normalized);
  });

  const staffIdBySender: Record<string, string> = {};
  for (const [sender, staffId] of resolved) {
    const isInbound = directionBySender.get(sender)?.has('inbound') ?? false;
    if (isInbound && !customerRemains) continue;
    staffIdBySender[sender] = staffId;
  }
  return staffIdBySender;
}

/**
 * Resolves customer identity (one bounded candidate load for the whole batch) and staff identity
 * for every conversation. Only a `resolved` customer identity feeds customerIdHint; the status
 * always travels with the conversation.
 */
export async function prepareSalesIntelligenceConversations(
  client: any,
  conversations: BatchConversationInput[],
  context: SalesIntelligenceRuntimeContext
): Promise<PreparedSalesIntelligenceConversation[]> {
  const evidences = conversations.map((conversation) => {
    const phone = normalizeEgyptianCustomerPhone(conversation.customerPhoneHint ?? '');
    const code = normalizeDawaaCustomerCode(conversation.customerCodeHint);
    return {
      customerId: conversation.customerIdHint ?? null,
      customerCodes: code ? [code] : [],
      contactPhones: isValidEgyptianCustomerMobile(phone) ? [phone] : [],
      mentionedPhones: [],
      displayName: conversation.customerNameHint ?? null,
    };
  });
  const identities = await resolveCanonicalCustomerIdentities(client, evidences);
  return conversations.map((conversation, index) => {
    const identity = identities[index];
    const resolved = identity.status === 'resolved';
    return {
      ...conversation,
      customerIdHint: resolved ? identity.customerId : null,
      customerPhoneHint: resolved
        ? (identity.normalizedPhone ?? conversation.customerPhoneHint ?? null)
        : (conversation.customerPhoneHint ?? null),
      customerIdentityStatus: identity.status,
      staffIdBySender: resolveStaffIdBySender(conversation, context),
    };
  });
}

/**
 * The ONE per-conversation pipeline input (minus the per-run invoice resolvers). The batch pre-pass
 * derives its cases from segmentationInputFromPipelineInput(thisValue) and every real run spreads
 * this value, so case ids are structurally identical.
 */
export function pipelineBaseInputFor(
  conversation: PreparedSalesIntelligenceConversation,
  context: SalesIntelligenceRuntimeContext
): SalesIntelligencePipelineBaseInput {
  return {
    conversationId: conversation.conversationId,
    rawWhatsAppExportText: conversation.rawWhatsAppExportText,
    trustedConversationStartedAt: conversation.trustedConversationStartedAt ?? null,
    sourceCaseIdV22: conversation.sourceCaseIdV22 ?? null,
    customerIdHint: conversation.customerIdHint ?? null,
    customerPhoneHint: conversation.customerPhoneHint ?? null,
    customerNameHint: conversation.customerNameHint ?? null,
    customerCodeHint: conversation.customerCodeHint ?? null,
    customerIdentityStatus: conversation.customerIdentityStatus,
    branchIdHint: conversation.branchIdHint ?? null,
    branchNameRawHint: conversation.branchNameRawHint ?? null,
    knownStaffIds: conversation.knownStaffIds,
    staffIdBySender: conversation.staffIdBySender,
    legacyMatchedInvoiceId: conversation.legacyMatchedInvoiceId,
    legacyMatchedInvoiceNumber: conversation.legacyMatchedInvoiceNumber,
    trustedInvoiceId: conversation.trustedInvoiceId,
    trustedInvoiceNumber: conversation.trustedInvoiceNumber,
    invoiceCancelledOrReturned: conversation.invoiceCancelledOrReturned,
    invoiceStatusHint: conversation.invoiceStatusHint,
    sessionSplitGapMinutes: conversation.sessionSplitGapMinutes,
    protocolPolicyEffectiveAt: conversation.protocolPolicyEffectiveAt,
    productIndex: context.productIndex,
  };
}
