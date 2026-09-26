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

export interface CustomerContextResult {
  resolution: WhatsAppResolvedCustomer;
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
  const resolution = await resolveWhatsAppCustomerIdentity(phoneCandidate || fallbackIdentity, branchHint);
  const purchaseHistory = resolution.customer?.id ? await fetchPurchaseHistory(resolution.customer.id) : null;
  return { resolution, phoneCandidate, purchaseHistory };
}
