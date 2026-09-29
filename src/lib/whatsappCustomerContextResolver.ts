// حل هوية العميل الحقيقية (customer_id) لمحادثة واتساب — قراءة فقط، بدون resolver جديد.
// بيعيد استخدام whatsappCustomerResolverV4.ts (نفس محرك customerSearch.ts المعتمد في باقي
// التطبيق) بأفضل هوية متاحة بالترتيب: phone (لو اتلاقى رقم مصري صالح داخل نص المحادثة) >
// اسم العميل > branchHint لفك تعارض الأسماء المتكررة. لو العميل ambiguous، الـresolver
// نفسه بيرجع customer:null + candidates — من غير أي اختيار تلقائي، وده بيتنقل زي ما هو
// من غير أي "تحسين" أو تخمين إضافي هنا.
import { supabase } from '@/lib/supabase';
import type { WhatsAppConversationSession } from '@/lib/whatsappConversationParser';
import { resolveWhatsAppCustomerIdentity, type WhatsAppResolvedCustomer } from '@/lib/whatsappCustomerResolverV4';
import { isValidEgyptianCustomerMobile, normalizeEgyptianCustomerPhone } from '@/lib/customers/customerIdentity';

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
  phoneCandidate: string | null;
  purchaseHistory: CustomerPurchaseHistory | null;
  contactProfile: CustomerContactProfile | null;
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

export async function resolveCustomerContext(
  session: WhatsAppConversationSession,
  branchHint: string | null,
  hint?: { customerNameHint?: string | null; customerCodeHint?: string | null }
): Promise<CustomerContextResult> {
  const phoneCandidate = extractPhoneCandidate(session);
  const hintedIdentity = [hint?.customerNameHint, hint?.customerCodeHint].filter(Boolean).join(' ').trim();
  const fallbackIdentity = hintedIdentity || session.customerName;

  const identityResolution = await resolveWhatsAppCustomerIdentity(fallbackIdentity, branchHint);
  const phoneResolution = phoneCandidate
    ? await resolveWhatsAppCustomerIdentity(phoneCandidate, branchHint)
    : null;

  const uniqueCandidates = (rows: Array<NonNullable<WhatsAppResolvedCustomer['customer']>>) => {
    const byId = new Map(rows.map((row) => [row.id, row]));
    return [...byId.values()];
  };

  let resolution = identityResolution;
  const explicitCodeHint = Boolean(String(hint?.customerCodeHint || '').trim());
  const identityCustomer = identityResolution.customer;
  const phoneCustomer = phoneResolution?.customer || null;

  if (explicitCodeHint && identityResolution.strategy === 'code_exact' && identityCustomer) {
    if (phoneResolution?.strategy === 'phone_exact' && phoneCustomer && phoneCustomer.id !== identityCustomer.id) {
      resolution = {
        customer: null,
        confidence: 0.5,
        strategy: 'ambiguous',
        reason: 'تعارض بين كود العميل الصريح ورقم هاتف مذكور داخل المحادثة؛ لا يتم اختيار عميل تلقائيًا.',
        candidates: uniqueCandidates([identityCustomer, phoneCustomer]),
      };
    }
    // Otherwise the explicit customer code remains the strongest identity evidence.
  } else if (phoneResolution?.strategy === 'phone_exact' && phoneCustomer) {
    if (identityResolution.strategy === 'ambiguous' && identityResolution.candidates.length) {
      const candidateMatch = identityResolution.candidates.some((row) => row.id === phoneCustomer.id);
      if (candidateMatch) {
        resolution = {
          ...phoneResolution,
          confidence: Math.max(phoneResolution.confidence, 0.99),
          reason: 'رقم الهاتف حسم هوية كانت غامضة بين نفس مرشحي الاسم/الكود.',
        };
      } else if (explicitCodeHint) {
        resolution = {
          customer: null,
          confidence: 0.5,
          strategy: 'ambiguous',
          reason: 'رقم الهاتف لا يطابق أي مرشح للكود الصريح؛ يحتاج الربط لمراجعة بشرية.',
          candidates: uniqueCandidates([...identityResolution.candidates, phoneCustomer]),
        };
      } else {
        resolution = phoneResolution;
      }
    } else if (
      identityCustomer &&
      identityCustomer.id !== phoneCustomer.id &&
      ['code_exact', 'name_exact_branch', 'name_exact'].includes(identityResolution.strategy)
    ) {
      resolution = {
        customer: null,
        confidence: 0.5,
        strategy: 'ambiguous',
        reason: 'تعارض بين هوية العميل من الاسم/الكود ورقم الهاتف المذكور؛ لا يتم التخمين.',
        candidates: uniqueCandidates([identityCustomer, phoneCustomer]),
      };
    } else {
      resolution = phoneResolution;
    }
  }

  const customerId = resolution.customer?.id || null;
  const [purchaseHistory, contactProfile] = customerId
    ? await Promise.all([
        fetchPurchaseHistory(customerId),
        fetchCustomerContactProfile(customerId),
      ])
    : [null, null];
  return { resolution, phoneCandidate, purchaseHistory, contactProfile };
}
