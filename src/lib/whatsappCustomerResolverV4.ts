import { normalizeArabicText, normalizePhone, searchCustomers, type CustomerSearchResult } from '@/lib/customerSearch';

export type WhatsAppResolvedCustomer = {
  customer: CustomerSearchResult | null;
  confidence: number;
  strategy: 'phone_exact' | 'name_exact_branch' | 'name_exact' | 'none' | 'ambiguous';
  reason: string;
  candidates: CustomerSearchResult[];
};

function normalizeBranch(value?: string | null) {
  return normalizeArabicText(String(value || '').replace(/^فرع\s+/i, ''));
}

function uniqueById(rows: CustomerSearchResult[]) {
  const map = new Map<string, CustomerSearchResult>();
  for (const row of rows) if (row.id) map.set(row.id, row);
  return [...map.values()];
}

export async function resolveWhatsAppCustomerIdentity(
  rawIdentity: string | null | undefined,
  branch?: string | null,
): Promise<WhatsAppResolvedCustomer> {
  const raw = String(rawIdentity || '').trim();
  if (!raw) return { customer: null, confidence: 0, strategy: 'none', reason: 'لا توجد هوية عميل ظاهرة في المحادثة.', candidates: [] };

  const candidates = uniqueById(await searchCustomers(raw, 12));
  if (!candidates.length) {
    return { customer: null, confidence: 0.2, strategy: 'none', reason: 'لم نجد عميلًا مطابقًا بشكل موثوق في قاعدة العملاء.', candidates: [] };
  }

  const rawPhone = normalizePhone(raw);
  const looksLikePhone = rawPhone.replace(/\D/g, '').length >= 10;
  if (looksLikePhone) {
    const exactPhone = candidates.filter((row) => normalizePhone(row.phone) === rawPhone);
    if (exactPhone.length === 1) {
      return { customer: exactPhone[0], confidence: 0.99, strategy: 'phone_exact', reason: 'تطابق رقم الهاتف بالكامل.', candidates };
    }
    if (exactPhone.length > 1) {
      return { customer: null, confidence: 0.45, strategy: 'ambiguous', reason: 'رقم الهاتف موجود لأكثر من سجل عميل؛ يحتاج اختيارًا بشريًا.', candidates: exactPhone };
    }
  }

  const rawName = normalizeArabicText(raw);
  const exactName = candidates.filter((row) => normalizeArabicText(row.name) === rawName);
  const branchKey = normalizeBranch(branch);
  if (branchKey && exactName.length) {
    const sameBranch = exactName.filter((row) => normalizeBranch(row.branch) === branchKey);
    if (sameBranch.length === 1) {
      return { customer: sameBranch[0], confidence: 0.94, strategy: 'name_exact_branch', reason: 'تطابق الاسم بالكامل داخل نفس الفرع.', candidates };
    }
    if (sameBranch.length > 1) {
      return { customer: null, confidence: 0.5, strategy: 'ambiguous', reason: 'يوجد أكثر من عميل بنفس الاسم داخل الفرع؛ لا يتم التخمين.', candidates: sameBranch };
    }
  }

  if (exactName.length === 1) {
    return { customer: exactName[0], confidence: 0.86, strategy: 'name_exact', reason: 'تطابق الاسم بالكامل مع سجل واحد فقط.', candidates };
  }
  if (exactName.length > 1) {
    return { customer: null, confidence: 0.4, strategy: 'ambiguous', reason: 'الاسم مطابق لأكثر من عميل؛ يحتاج اختيارًا بشريًا.', candidates: exactName };
  }

  return {
    customer: null,
    confidence: 0.35,
    strategy: candidates.length > 1 ? 'ambiguous' : 'none',
    reason: 'النتائج المتاحة ليست تطابقًا دقيقًا؛ لن يتم ربط عميل تلقائيًا.',
    candidates,
  };
}
