// Customer context for a WhatsApp case unit — built ONLY from the Canonical Customer Identity
// (src/lib/customers/canonicalCustomerIdentityResolver.ts), the single identity definition shared
// with automatic ingest and Sales Intelligence. This module adds read-only display context
// (contact profile, purchase history) for a RESOLVED customer; it never resolves identity itself.
import { supabase } from '@/lib/supabase';
import type { WhatsAppResolvedCustomer } from '@/lib/whatsappCustomerResolverV4';
import type { CanonicalCustomerIdentity } from '@/lib/customers/canonicalCustomerIdentityResolver';

export interface CustomerPurchaseHistory {
  totalPurchases: number | null;
  totalSpent: number | null;
  avgMonthly: number | null;
  lastPurchaseAt: string | null;
}

export interface CustomerContactProfile {
  phone: string | null;
  customerPhone: string | null;
  mobile: string | null;
  normalizedPhone: string | null;
  whatsappPhone: string | null;
  alternatePhone: string | null;
  address: string | null;
}

export interface CustomerContextResult {
  resolution: WhatsAppResolvedCustomer;
  identity: CanonicalCustomerIdentity;
  /** Contact phone evidence of the conversation (never a phone merely mentioned in text). */
  phoneCandidate: string | null;
  purchaseHistory: CustomerPurchaseHistory | null;
  contactProfile: CustomerContactProfile | null;
}

async function fetchCustomerContactProfile(customerId: string): Promise<CustomerContactProfile> {
  const { data, error } = await supabase
    .from('customers')
    .select('phone,customer_phone,mobile,normalized_phone,whatsapp_phone,phone_alt,address')
    .eq('id', customerId)
    .maybeSingle();
  if (error) {
    console.warn('[whatsapp-customer-context] contact profile lookup failed', error);
    return {
      phone: null,
      customerPhone: null,
      mobile: null,
      normalizedPhone: null,
      whatsappPhone: null,
      alternatePhone: null,
      address: null,
    };
  }
  return {
    phone: data?.phone ? String(data.phone).trim() : null,
    customerPhone: data?.customer_phone ? String(data.customer_phone).trim() : null,
    mobile: data?.mobile ? String(data.mobile).trim() : null,
    normalizedPhone: data?.normalized_phone ? String(data.normalized_phone).trim() : null,
    whatsappPhone: data?.whatsapp_phone ? String(data.whatsapp_phone).trim() : null,
    alternatePhone: data?.phone_alt ? String(data.phone_alt).trim() : null,
    address: data?.address ? String(data.address).trim() : null,
  };
}

async function fetchPurchaseHistory(customerId: string): Promise<CustomerPurchaseHistory> {
  const { data } = await supabase
    .from('customers')
    .select('total_purchases,total_spent,avg_monthly,last_purchase')
    .eq('id', customerId)
    .maybeSingle();
  return {
    totalPurchases: data?.total_purchases ?? null,
    totalSpent: data?.total_spent ?? null,
    avgMonthly: data?.avg_monthly ?? null,
    lastPurchaseAt: data?.last_purchase ?? null,
  };
}

/** Maps the canonical identity to the resolver shape the watcher's review snapshot consumes. */
export function toWhatsAppResolvedCustomer(
  identity: CanonicalCustomerIdentity
): WhatsAppResolvedCustomer {
  const candidates = identity.candidates.map((row) => ({
    id: row.id,
    name: row.name || '',
    code: row.customerCode || '',
    phone: '',
    branch: '',
    category: '',
  }));
  if (identity.status === 'resolved' && identity.customerId) {
    return {
      customer: {
        id: identity.customerId,
        name: identity.customerName || '',
        code: identity.customerCode || '',
        phone: identity.normalizedPhone || '',
        branch: identity.branch || '',
        category: '',
      },
      confidence: identity.confidence,
      strategy:
        identity.resolvedBy === 'customer_code'
          ? 'code_exact'
          : identity.resolvedBy === 'contact_phone' || identity.resolvedBy === 'mentioned_phone'
            ? 'phone_exact'
            : identity.resolvedBy === 'historical_link'
              ? 'historical_link'
              : 'customer_id_exact',
      reason: identity.reason,
      candidates,
    };
  }
  return {
    customer: null,
    confidence: 0,
    strategy:
      identity.status === 'contradicted'
        ? 'contradicted'
        : identity.status === 'ambiguous'
          ? 'ambiguous'
          : 'none',
    reason: identity.reason,
    candidates,
  };
}

/**
 * Builds the watcher's customer context from an already-resolved canonical identity.
 * Contact profile / purchase history are read only for a resolved customer (cache per customer id).
 */
export async function customerContextFromCanonicalIdentity(
  identity: CanonicalCustomerIdentity,
  cache: Map<string, Promise<[CustomerPurchaseHistory, CustomerContactProfile]>> = new Map()
): Promise<CustomerContextResult> {
  const resolution = toWhatsAppResolvedCustomer(identity);
  const customerId = identity.status === 'resolved' ? identity.customerId : null;
  let purchaseHistory: CustomerPurchaseHistory | null = null;
  let contactProfile: CustomerContactProfile | null = null;
  if (customerId) {
    let request = cache.get(customerId);
    if (!request) {
      request = Promise.all([
        fetchPurchaseHistory(customerId),
        fetchCustomerContactProfile(customerId),
      ]);
      cache.set(customerId, request);
    }
    [purchaseHistory, contactProfile] = await request;
  }
  return {
    resolution,
    identity,
    phoneCandidate: identity.normalizedPhone,
    purchaseHistory,
    contactProfile,
  };
}
