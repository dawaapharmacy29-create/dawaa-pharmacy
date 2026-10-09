// Canonical Customer Identity Resolver — the single identity definition for every WhatsApp path
// (Smart Watcher, automatic ingest, Sales Intelligence, V22 case creation, maintenance backfill).
//
// Evidence hierarchy (a lower rung never overrides a higher one; disagreement is a contradiction):
//   1. exact customer_id
//   2. unique canonical customer code
//   3. normalized phone, only when it maps to exactly one customer
//   4. trusted historical identity link (customer_aliases duplicate -> canonical customer, or the
//      identity of a canonical V22-owned source supplied by the caller)
//   5. otherwise unresolved
// Display names never resolve an identity (two customers can share a name).
//
// Result status: resolved | unresolved | ambiguous | contradicted. Confidence is informational
// only; downstream decisions use `status`. The resolver never writes. Callers decide whether to
// continue: identity !== resolved -> no Sale Proof, no official attribution, no silent guess.
import type { WhatsAppConversationSession } from '@/lib/whatsappConversationParser';
import { extractCustomerHintFromExportFileName } from '@/lib/whatsappExportCustomerHint';
import {
  extractTrailingCustomerCodeFromDisplayName,
  isCustomerIdentityUuid,
  isValidEgyptianCustomerMobile,
  normalizeDawaaCustomerCode,
  normalizeEgyptianCustomerPhone,
} from './customerIdentity';

export type CanonicalCustomerIdentityStatus =
  | 'resolved'
  | 'unresolved'
  | 'ambiguous'
  | 'contradicted';

export interface CustomerIdentityEvidence {
  /** Exact customer_id already attached to the source (e.g. re-import of a canonical source). */
  customerId?: string | null;
  /** Codes found in the export filename and the customer's contact label. */
  customerCodes: string[];
  /** Phones of the customer's WhatsApp contact (sender label / chat title). */
  contactPhones: string[];
  /** Phones only mentioned inside message text. Used only when no contact phone exists. */
  mentionedPhones: string[];
  /** Identity of a canonical V22-owned source for the same conversation. Never a coarse snapshot. */
  trustedHistoricalCustomerId?: string | null;
  /** Informational only; never used to resolve. */
  displayName?: string | null;
}

export interface CustomerIdentityCandidate {
  id: string;
  customerCode: string | null;
  phones: string[];
  name: string | null;
  branch: string | null;
  isDuplicate: boolean;
}

export interface CustomerIdentityCandidates {
  byId: Map<string, CustomerIdentityCandidate>;
  /** alias (duplicate) customer id -> canonical customer id */
  aliasToCanonical: Map<string, string>;
}

type EvidenceKind =
  | 'customer_id'
  | 'customer_code'
  | 'contact_phone'
  | 'mentioned_phone'
  | 'historical_link';

export interface CustomerIdentityEvidenceResult {
  kind: EvidenceKind;
  value: string;
  customerIds: string[];
  result: 'match' | 'none' | 'ambiguous';
}

export interface CanonicalCustomerIdentity {
  status: CanonicalCustomerIdentityStatus;
  customerId: string | null;
  customerCode: string | null;
  /**
   * Resolved: the resolved customer's own phone (null when the record has none). Otherwise the contact
   * phone evidence (an unresolved hint); never a merely mentioned phone.
   */
  normalizedPhone: string | null;
  customerName: string | null;
  branch: string | null;
  resolvedBy: EvidenceKind | null;
  reason: string;
  confidence: number;
  evidence: CustomerIdentityEvidenceResult[];
  candidates: Array<{ id: string; customerCode: string | null; name: string | null }>;
}

const EVIDENCE_CONFIDENCE: Record<EvidenceKind, number> = {
  customer_id: 1,
  customer_code: 0.99,
  contact_phone: 0.97,
  mentioned_phone: 0.9,
  historical_link: 0.95,
};

function uniq(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean)));
}

function validPhones(values: unknown[]): string[] {
  return uniq(values.map((value) => normalizeEgyptianCustomerPhone(value))).filter((phone) =>
    isValidEgyptianCustomerMobile(phone)
  );
}

const PHONE_IN_TEXT_RX = /\d[\d\s-]{9,14}\d/g;

/** Pure: collects identity evidence from a canonical case unit and its export filename. */
export function extractCustomerIdentityEvidence(
  session: WhatsAppConversationSession,
  sourceFileName: string,
  extra: { customerId?: string | null; trustedHistoricalCustomerId?: string | null } = {}
): CustomerIdentityEvidence {
  const fileHint = extractCustomerHintFromExportFileName(sourceFileName);
  const inbound = session.messages.filter((message) => message.direction === 'inbound');
  const labels = uniq([session.customerName, ...inbound.map((message) => message.sender)]);
  const customerCodes = uniq([
    normalizeDawaaCustomerCode(fileHint.codeHint),
    ...labels.map((label) => extractTrailingCustomerCodeFromDisplayName(label)),
  ]);
  const contactPhones = validPhones(labels);
  const mentionedPhones = validPhones(
    inbound.flatMap((message) => String(message.text || '').match(PHONE_IN_TEXT_RX) || [])
  ).filter((phone) => !contactPhones.includes(phone));
  return {
    customerId: extra.customerId ?? null,
    customerCodes,
    contactPhones,
    mentionedPhones,
    trustedHistoricalCustomerId: extra.trustedHistoricalCustomerId ?? null,
    displayName: fileHint.nameHint || session.customerName || null,
  };
}

function canonicalId(id: string, candidates: CustomerIdentityCandidates): string | null {
  const row = candidates.byId.get(id);
  const alias = candidates.aliasToCanonical.get(id);
  if (alias) return alias;
  if (!row || row.isDuplicate) return null;
  return row.id;
}

function matchIds(
  kind: EvidenceKind,
  value: string,
  rows: CustomerIdentityCandidate[],
  candidates: CustomerIdentityCandidates
): CustomerIdentityEvidenceResult {
  const ids = uniq(rows.map((row) => canonicalId(row.id, candidates)));
  return {
    kind,
    value,
    customerIds: ids,
    result: ids.length === 1 ? 'match' : ids.length > 1 ? 'ambiguous' : 'none',
  };
}

/** Pure: resolves one conversation's identity from pre-loaded candidates. */
export function resolveCanonicalCustomerIdentity(
  evidence: CustomerIdentityEvidence,
  candidates: CustomerIdentityCandidates
): CanonicalCustomerIdentity {
  const rows = [...candidates.byId.values()];
  const results: CustomerIdentityEvidenceResult[] = [];

  if (evidence.customerId && isCustomerIdentityUuid(evidence.customerId)) {
    results.push(
      matchIds(
        'customer_id',
        evidence.customerId,
        rows.filter((row) => row.id === evidence.customerId),
        candidates
      )
    );
  }
  const codes = uniq(evidence.customerCodes.map((code) => normalizeDawaaCustomerCode(code)));
  for (const code of codes) {
    results.push(
      matchIds(
        'customer_code',
        code,
        rows.filter((row) => row.customerCode === code),
        candidates
      )
    );
  }
  const phoneKind: EvidenceKind = evidence.contactPhones.length
    ? 'contact_phone'
    : 'mentioned_phone';
  const phones = evidence.contactPhones.length ? evidence.contactPhones : evidence.mentionedPhones;
  for (const phone of phones) {
    results.push(
      matchIds(
        phoneKind,
        phone,
        rows.filter((row) => row.phones.includes(phone)),
        candidates
      )
    );
  }
  if (
    evidence.trustedHistoricalCustomerId &&
    isCustomerIdentityUuid(evidence.trustedHistoricalCustomerId)
  ) {
    results.push(
      matchIds(
        'historical_link',
        evidence.trustedHistoricalCustomerId,
        rows.filter((row) => row.id === evidence.trustedHistoricalCustomerId),
        candidates
      )
    );
  }

  const contactPhone = evidence.contactPhones[0] ?? null;
  const unresolvedBase = (
    status: CanonicalCustomerIdentityStatus,
    reason: string,
    candidateIds: string[]
  ) => ({
    status,
    customerId: null,
    customerCode: codes.length === 1 ? codes[0] : null,
    normalizedPhone: contactPhone,
    customerName: evidence.displayName ?? null,
    branch: null,
    resolvedBy: null,
    reason,
    confidence: 0,
    evidence: results,
    candidates: candidateIds.map((id) => {
      const row = candidates.byId.get(id);
      return { id, customerCode: row?.customerCode ?? null, name: row?.name ?? null };
    }),
  });

  // Two different export/contact codes are conflicting evidence before any lookup.
  if (codes.length > 1) {
    return unresolvedBase(
      'contradicted',
      `customer_code_conflict:${codes.join('|')}`,
      uniq(results.flatMap((r) => r.customerIds))
    );
  }

  const matched = results.filter((row) => row.result === 'match');
  const matchedIds = uniq(matched.flatMap((row) => row.customerIds));
  if (matchedIds.length > 1) {
    return unresolvedBase(
      'contradicted',
      `identity_evidence_conflict:${matched.map((row) => `${row.kind}=${row.customerIds[0]}`).join('|')}`,
      matchedIds
    );
  }

  if (matchedIds.length === 1) {
    const id = matchedIds[0];
    // An ambiguous rung that does not even include the matched customer contradicts it.
    const conflicting = results.find(
      (row) => row.result === 'ambiguous' && !row.customerIds.includes(id)
    );
    if (conflicting) {
      return unresolvedBase(
        'contradicted',
        `${conflicting.kind}_points_to_other_customers:${conflicting.value}`,
        uniq([id, ...conflicting.customerIds])
      );
    }
    const by = matched[0];
    const row = candidates.byId.get(id);
    // Every identity field of a resolved customer comes from that customer's record: a contact label,
    // contact phone or file code is evidence, never mixed into the resolved identity.
    return {
      status: 'resolved',
      customerId: id,
      customerCode: row?.customerCode ?? null,
      normalizedPhone: row?.phones[0] ?? null,
      customerName: row?.name ?? null,
      branch: row?.branch ?? null,
      resolvedBy: by.kind,
      reason: `unique_${by.kind}_match`,
      confidence: EVIDENCE_CONFIDENCE[by.kind],
      evidence: results,
      candidates: [{ id, customerCode: row?.customerCode ?? null, name: row?.name ?? null }],
    };
  }

  const ambiguous = results.filter((row) => row.result === 'ambiguous');
  if (ambiguous.length) {
    return unresolvedBase(
      'ambiguous',
      `identity_ambiguous:${ambiguous.map((row) => `${row.kind}=${row.value}`).join('|')}`,
      uniq(ambiguous.flatMap((row) => row.customerIds))
    );
  }
  return unresolvedBase(
    'unresolved',
    results.length ? 'no_matching_customer' : 'no_identity_evidence',
    []
  );
}

type QueryResult<T> = { data: T[] | null; error: { message: string } | null };
const CHUNK = 40;
const CUSTOMER_COLUMNS =
  'id,customer_code,effective_customer_code,code,name,display_name,customer_name,branch,effective_branch,is_duplicate,normalized_phone,phone,customer_phone,mobile,whatsapp_phone,whatsapp,phone_alt';

function toCandidate(row: any): CustomerIdentityCandidate {
  return {
    id: String(row.id),
    customerCode:
      normalizeDawaaCustomerCode(row.effective_customer_code) ||
      normalizeDawaaCustomerCode(row.customer_code) ||
      normalizeDawaaCustomerCode(row.code) ||
      null,
    phones: validPhones([
      row.normalized_phone,
      row.phone,
      row.customer_phone,
      row.mobile,
      row.whatsapp_phone,
      row.whatsapp,
      row.phone_alt,
    ]),
    name: String(row.display_name || row.name || row.customer_name || '').trim() || null,
    branch: String(row.effective_branch || row.branch || '').trim() || null,
    isDuplicate: Boolean(row.is_duplicate),
  };
}

function chunks<T>(values: T[]): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < values.length; index += CHUNK)
    out.push(values.slice(index, index + CHUNK));
  return out;
}

/**
 * Batch-loads every candidate customer for a set of evidences with a bounded number of queries
 * (ids, codes, phones, aliases — chunked), independent of the number of conversations.
 * Throws on any read error (fail closed: callers must not treat an outage as "unresolved").
 */
export async function loadCustomerIdentityCandidates(
  client: any,
  evidences: CustomerIdentityEvidence[]
): Promise<CustomerIdentityCandidates> {
  const ids = uniq(
    evidences
      .flatMap((e) => [e.customerId, e.trustedHistoricalCustomerId])
      .filter((id) => isCustomerIdentityUuid(id))
  );
  const codes = uniq(
    evidences.flatMap((e) => e.customerCodes.map((code) => normalizeDawaaCustomerCode(code)))
  );
  const phones = uniq(evidences.flatMap((e) => [...e.contactPhones, ...e.mentionedPhones]));
  const byId = new Map<string, CustomerIdentityCandidate>();
  const add = (rows: any[] | null) => {
    for (const row of rows || []) byId.set(String(row.id), toCandidate(row));
  };
  const run = async (label: string, query: Promise<QueryResult<any>>) => {
    const { data, error } = await query;
    if (error) throw new Error(`customer_identity_${label}_lookup_failed: ${error.message}`);
    add(data);
  };

  for (const chunk of chunks(ids)) {
    await run('id', client.from('customers').select(CUSTOMER_COLUMNS).in('id', chunk));
  }
  for (const chunk of chunks(codes)) {
    const list = chunk.join(',');
    await run(
      'code',
      client
        .from('customers')
        .select(CUSTOMER_COLUMNS)
        .or(`effective_customer_code.in.(${list}),customer_code.in.(${list}),code.in.(${list})`)
        .limit(500)
    );
  }
  for (const chunk of chunks(phones)) {
    const list = chunk.join(',');
    await run(
      'phone',
      client
        .from('customers')
        .select(CUSTOMER_COLUMNS)
        .or(
          [
            'normalized_phone',
            'phone',
            'customer_phone',
            'mobile',
            'whatsapp_phone',
            'whatsapp',
            'phone_alt',
          ]
            .map((column) => `${column}.in.(${list})`)
            .join(',')
        )
        .limit(500)
    );
  }

  const aliasToCanonical = new Map<string, string>();
  const duplicateIds = [...byId.values()].filter((row) => row.isDuplicate).map((row) => row.id);
  for (const chunk of chunks(duplicateIds)) {
    const { data, error } = (await client
      .from('customer_aliases')
      .select('alias_customer_id,canonical_customer_id')
      .in('alias_customer_id', chunk)) as QueryResult<{
      alias_customer_id: string;
      canonical_customer_id: string;
    }>;
    if (error) throw new Error(`customer_identity_alias_lookup_failed: ${error.message}`);
    for (const row of data || []) {
      if (row.alias_customer_id && row.canonical_customer_id) {
        aliasToCanonical.set(String(row.alias_customer_id), String(row.canonical_customer_id));
      }
    }
  }
  const missingCanonical = uniq([...aliasToCanonical.values()]).filter((id) => !byId.has(id));
  for (const chunk of chunks(missingCanonical)) {
    await run('alias_canonical', client.from('customers').select(CUSTOMER_COLUMNS).in('id', chunk));
  }
  return { byId, aliasToCanonical };
}

/** Batch resolve: one candidate load for all evidences, then pure resolution per evidence. */
export async function resolveCanonicalCustomerIdentities(
  client: any,
  evidences: CustomerIdentityEvidence[]
): Promise<CanonicalCustomerIdentity[]> {
  const candidates = await loadCustomerIdentityCandidates(client, evidences);
  return evidences.map((evidence) => resolveCanonicalCustomerIdentity(evidence, candidates));
}

/**
 * whatsapp_review_sources customer columns from one identity decision. Resolved: id + code + name +
 * phone all from the resolved customer. Otherwise customer_id stays null and the columns keep the
 * unresolved hints (code/name/phone evidence) for human review — ambiguity is never resolved here.
 */
export function canonicalCustomerSourceColumns(
  identity: Pick<CanonicalCustomerIdentity, 'status' | 'customerId' | 'customerCode' | 'customerName' | 'normalizedPhone'>,
  hints: { code?: string | null; name?: string | null; phone?: string | null } = {}
) {
  if (identity.status === 'resolved' && identity.customerId) {
    return {
      customer_id: identity.customerId,
      customer_code: identity.customerCode ?? null,
      customer_name: identity.customerName ?? null,
      customer_phone: identity.normalizedPhone ?? null,
    };
  }
  return {
    customer_id: null,
    customer_code: identity.customerCode || hints.code || null,
    customer_name: identity.customerName || hints.name || null,
    customer_phone: identity.normalizedPhone || hints.phone || null,
  };
}
