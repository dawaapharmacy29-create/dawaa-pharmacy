import { normalizeArabicText, normalizePhone, searchCustomers, type CustomerSearchResult } from '@/lib/customerSearch';

export type WhatsAppResolvedCustomer = {
  customer: CustomerSearchResult | null;
  confidence: number;
  strategy: 'code_exact' | 'phone_exact' | 'name_exact_branch' | 'name_exact' | 'strong_name_candidates' | 'none' | 'ambiguous';
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

function levenshteinDistance(a: string, b: string) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const next = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i += 1) {
    next[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      next[j] = Math.min(
        next[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = next[j];
  }
  return prev[b.length];
}

export function customerNameSimilarity(a: string, b: string) {
  const left = normalizeArabicText(a);
  const right = normalizeArabicText(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const maxLen = Math.max(left.length, right.length);
  const editScore = maxLen ? 1 - levenshteinDistance(left, right) / maxLen : 0;
  const leftTokens = new Set(left.split(' ').filter(Boolean));
  const rightTokens = new Set(right.split(' ').filter(Boolean));
  const shared = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const tokenScore = Math.max(leftTokens.size, rightTokens.size)
    ? shared / Math.max(leftTokens.size, rightTokens.size)
    : 0;
  return Math.max(editScore, tokenScore);
}

function strongNameCandidates(
  rows: CustomerSearchResult[],
  rawName: string,
  branch?: string | null,
) {
  const branchKey = normalizeBranch(branch);
  return rows
    .map((row) => {
      const similarity = customerNameSimilarity(rawName, row.name);
      const sameBranch = Boolean(branchKey && normalizeBranch(row.branch) === branchKey);
      const score = Math.min(1, similarity + (sameBranch ? 0.03 : 0));
      return { row, score };
    })
    .filter((item) => item.score >= 0.9)
    .sort((a, b) => b.score - a.score || a.row.name.localeCompare(b.row.name))
    .slice(0, 3);
}

export async function resolveWhatsAppCustomerIdentity(
  rawIdentity: string | null | undefined,
  branch?: string | null,
): Promise<WhatsAppResolvedCustomer> {
  const raw = String(rawIdentity || '').trim();
  if (!raw) {
    return {
      customer: null,
      confidence: 0,
      strategy: 'none',
      reason: 'لا توجد هوية عميل ظاهرة في المحادثة.',
      candidates: [],
    };
  }

  const codeHint = (raw.match(/(?:^|\s|[-_])(\d{2,8})(?=$|\s|[-_])/g) || [])
    .map((value) => value.replace(/\D/g, ''))
    .filter(Boolean)
    .pop() || null;
  const nameWithoutCode = raw
    .replace(/(?:^|\s|[-_])\d{2,8}(?=$|\s|[-_])/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const searches = await Promise.all([
    searchCustomers(raw, 12),
    ...(codeHint ? [searchCustomers(codeHint, 8)] : []),
    ...(nameWithoutCode && nameWithoutCode !== raw ? [searchCustomers(nameWithoutCode, 8)] : []),
  ]);
  const candidates = uniqueById(searches.flat());

  if (!candidates.length) {
    return {
      customer: null,
      confidence: 0.2,
      strategy: 'none',
      reason: 'لم نجد عميلًا مطابقًا بشكل موثوق في قاعدة العملاء.',
      candidates: [],
    };
  }

  if (codeHint) {
    const exactCode = candidates.filter((row) => String(row.code || '').trim() === codeHint);
    if (exactCode.length === 1) {
      return {
        customer: exactCode[0],
        confidence: 0.995,
        strategy: 'code_exact',
        reason: 'تطابق كود العميل بالكامل.',
        candidates: exactCode,
      };
    }
    if (exactCode.length > 1) {
      const branchKey = normalizeBranch(branch);
      const sameBranch = branchKey
        ? exactCode.filter((row) => normalizeBranch(row.branch) === branchKey)
        : [];
      if (sameBranch.length === 1) {
        return {
          customer: sameBranch[0],
          confidence: 0.98,
          strategy: 'code_exact',
          reason: 'كود العميل متطابق وتم حسم السجل باستخدام الفرع.',
          candidates: exactCode,
        };
      }
      return {
        customer: null,
        confidence: 0.5,
        strategy: 'ambiguous',
        reason: 'كود العميل موجود في أكثر من سجل؛ يحتاج اختيارًا بشريًا.',
        candidates: exactCode.slice(0, 3),
      };
    }
  }

  const rawPhone = normalizePhone(raw);
  const looksLikePhone = rawPhone.replace(/\D/g, '').length >= 10;
  if (looksLikePhone) {
    const exactPhone = candidates.filter((row) => normalizePhone(row.phone) === rawPhone);
    if (exactPhone.length === 1) {
      return {
        customer: exactPhone[0],
        confidence: 0.99,
        strategy: 'phone_exact',
        reason: 'تطابق رقم الهاتف بالكامل.',
        candidates: exactPhone,
      };
    }
    if (exactPhone.length > 1) {
      return {
        customer: null,
        confidence: 0.45,
        strategy: 'ambiguous',
        reason: 'رقم الهاتف موجود لأكثر من سجل عميل؛ يحتاج اختيارًا بشريًا.',
        candidates: exactPhone.slice(0, 3),
      };
    }
  }

  const rawName = normalizeArabicText(nameWithoutCode || raw);
  const exactName = candidates.filter((row) => normalizeArabicText(row.name) === rawName);
  const branchKey = normalizeBranch(branch);

  if (branchKey && exactName.length) {
    const sameBranch = exactName.filter((row) => normalizeBranch(row.branch) === branchKey);
    if (sameBranch.length === 1) {
      return {
        customer: sameBranch[0],
        confidence: 0.94,
        strategy: 'name_exact_branch',
        reason: 'تطابق الاسم بالكامل داخل نفس الفرع.',
        candidates: sameBranch,
      };
    }
    if (sameBranch.length > 1) {
      return {
        customer: null,
        confidence: 0.5,
        strategy: 'ambiguous',
        reason: 'يوجد أكثر من عميل بنفس الاسم داخل الفرع؛ لا يتم التخمين.',
        candidates: sameBranch.slice(0, 3),
      };
    }
  }

  if (exactName.length === 1) {
    return {
      customer: exactName[0],
      confidence: 0.86,
      strategy: 'name_exact',
      reason: 'تطابق الاسم بالكامل مع سجل واحد فقط.',
      candidates: exactName,
    };
  }
  if (exactName.length > 1) {
    return {
      customer: null,
      confidence: 0.4,
      strategy: 'ambiguous',
      reason: 'الاسم مطابق لأكثر من عميل؛ يحتاج اختيارًا بشريًا.',
      candidates: exactName.slice(0, 3),
    };
  }

  const strong = strongNameCandidates(candidates, nameWithoutCode || raw, branch);
  if (strong.length) {
    const confidence = Math.round(strong[0].score * 100) / 100;
    return {
      customer: null,
      confidence,
      strategy: 'strong_name_candidates',
      reason: 'لا يوجد تطابق دقيق. تم عرض أقرب المرشحين الموثوقين فقط للمراجعة البشرية.',
      candidates: strong.map((item) => item.row),
    };
  }

  return {
    customer: null,
    confidence: 0.25,
    strategy: 'none',
    reason: 'تعذر تحديد العميل تلقائيًا بدرجة ثقة كافية. لن يتم عرض نتائج بحث عامة أو ربط عميل بالتخمين.',
    candidates: [],
  };
}
