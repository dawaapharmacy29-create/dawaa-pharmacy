// Customer context for the Smart Folder — identity comes ONLY from the Canonical Customer
// Identity Resolver (src/lib/customers/canonicalCustomerIdentityResolver.ts), the same definition
// used by automatic ingest, Customer Case V22 and Sales Intelligence:
//   exact customer_id > unique canonical customer code > normalized phone > trusted historical link.
// Display names (WhatsApp contact label or export filename) are informational only and never pick a
// customer. Ambiguous / contradicted / unresolved identities fail closed (customer: null).
//
// The legacy `WhatsAppResolvedCustomer` shape is still produced (as a projection of the canonical
// identity) because the review transfer snapshot and the Reviews page consume it.
import { supabase } from '@/lib/supabase';
import type { WhatsAppConversationSession } from '@/lib/whatsappConversationParser';
import type { WhatsAppResolvedCustomer } from '@/lib/whatsappCustomerResolverV4';
import type { CustomerSearchResult } from '@/lib/customerSearch';
import { isValidEgyptianCustomerMobile, normalizeEgyptianCustomerPhone } from '@/lib/customers/customerIdentity';
import {
  extractCustomerIdentityEvidence,
  resolveCanonicalCustomerIdentities,
  type CanonicalCustomerIdentity,
} from '@/lib/customers/canonicalCustomerIdentityResolver';
import { extractCustomerHintFromExportFileName } from '@/lib/whatsappExportCustomerHint';

export interface CustomerPurchaseHistory {
  totalPurchases: number | null;
  totalSpent: number | null;
  avgMonthly: number | null;
  lastPurchaseAt: string | null;
}

export interface CustomerContextResult {
  /** Legacy-compatible projection of `canonical` (never resolved from a display name). */
  resolution: WhatsAppResolvedCustomer;
  /** The single identity truth for this case unit. */
  canonical: CanonicalCustomerIdentity;
  /** What the export filename / WhatsApp label called the customer (display only). */
  displayNameHint: string | null;
  phoneCandidate: string | null;
  purchaseHistory: CustomerPurchaseHistory | null;
}

const PHONE_CANDIDATE_RX = /\d[\d\s-]{9,14}\d/g;

/** بحث نصي بسيط عن رقم موبايل مصري صالح مذكور صراحة في المحادثة — best-effort، مش مصدر مؤكد. */
export function extractPhoneCandidate(session: WhatsAppConversationSession): string | null {
  for (const message of session.messages) {
    const matches = message.text.match(PHONE_CANDIDATE_RX) || [];
    for (const candidate of matches) {
      if (isValidEgyptianCustomerMobile(candidate)) return normalizeEgyptianCustomerPhone(candidate);
    }
  }
  return null;
}

const STRATEGY_BY_EVIDENCE: Record<string, WhatsAppResolvedCustomer['strategy']> = {
  customer_id: 'code_exact',
  customer_code: 'code_exact',
  contact_phone: 'phone_exact',
  mentioned_phone: 'phone_exact',
  historical_link: 'code_exact',
};

/** Pure projection of the canonical identity into the legacy transfer shape. */
export function toWhatsAppResolvedCustomer(identity: CanonicalCustomerIdentity): WhatsAppResolvedCustomer {
  const candidates: CustomerSearchResult[] = identity.candidates.map((row) => ({
    id: row.id,
    name: row.name || 'عميل بدون اسم',
    code: row.customerCode || '',
    phone: '',
    branch: '',
    category: '',
  }));
  if (identity.status === 'resolved' && identity.customerId) {
    return {
      customer: {
        id: identity.customerId,
        name: identity.customerName || 'عميل بدون اسم',
        code: identity.customerCode || '',
        phone: identity.normalizedPhone || '',
        branch: identity.branch || '',
        category: '',
      },
      // 0..1 like the legacy resolver (UI renders it as a percentage).
      confidence: identity.confidence,
      strategy: STRATEGY_BY_EVIDENCE[identity.resolvedBy || ''] || 'code_exact',
      reason: identity.reason,
      candidates: [],
    };
  }
  return {
    customer: null,
    confidence: 0,
    strategy: identity.status === 'unresolved' ? 'none' : 'ambiguous',
    reason: identity.reason,
    candidates,
  };
}

async function fetchPurchaseHistory(client: any, customerId: string): Promise<CustomerPurchaseHistory | null> {
  // Informational only (evaluation context). A failed read is reported as "unknown", never as zero.
  const { data, error } = await client
    .from('customers')
    .select('total_purchases,total_spent,avg_monthly,last_purchase')
    .eq('id', customerId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    totalPurchases: data.total_purchases ?? null,
    totalSpent: data.total_spent ?? null,
    avgMonthly: data.avg_monthly ?? null,
    lastPurchaseAt: data.last_purchase ?? null,
  };
}

/**
 * Batch-resolves every case unit of one export through the canonical resolver (bounded queries,
 * independent of the number of case units). Throws on lookup outage (fail closed — an outage must
 * not look like "unresolved").
 */
export async function resolveCanonicalCustomerContexts(
  sessions: WhatsAppConversationSession[],
  sourceFileName: string,
  client: any = supabase
): Promise<CustomerContextResult[]> {
  const evidences = sessions.map((session) => extractCustomerIdentityEvidence(session, sourceFileName));
  const identities = await resolveCanonicalCustomerIdentities(client, evidences);
  const fileHint = extractCustomerHintFromExportFileName(sourceFileName);
  const historyById = new Map<string, Promise<CustomerPurchaseHistory | null>>();
  return Promise.all(
    identities.map(async (canonical, index) => {
      const session = sessions[index];
      const customerId = canonical.status === 'resolved' ? canonical.customerId : null;
      if (customerId && !historyById.has(customerId)) {
        historyById.set(customerId, fetchPurchaseHistory(client, customerId));
      }
      return {
        resolution: toWhatsAppResolvedCustomer(canonical),
        canonical,
        displayNameHint: fileHint.nameHint || session.customerName || null,
        phoneCandidate: extractPhoneCandidate(session),
        purchaseHistory: customerId ? await historyById.get(customerId)! : null,
      };
    })
  );
}
