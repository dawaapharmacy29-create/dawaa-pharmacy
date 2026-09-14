import { readCustomerInvoices, type CustomerInvoiceReadRow } from '@/lib/readModels/customerInvoiceReadModel';
import type { FullConversationIntelligence } from './customerConversationIntelligence';
import { classifyConversionEligibility } from './conversionAnalytics';

export type InvoiceVerificationLookup = {
  customerId?: string | null;
  customerCode?: string | null;
  customerPhone?: string | null;
  customerName?: string | null;
  branch?: string | null;
};

export type InvoiceVerificationCandidate = {
  invoiceId: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  branch: string | null;
  sellerName: string | null;
  customerCode: string | null;
  customerName: string | null;
  amount: number | null;
  score: number;
  confidence: number;
  reasons: string[];
  matchedIdentityStrategies: string[];
};

export type InvoiceConversionVerification = {
  status: 'verified_converted' | 'probable_converted' | 'not_verified' | 'not_applicable' | 'needs_review';
  chatSuggestedSold: boolean;
  commercialEligible: boolean;
  bestCandidate: InvoiceVerificationCandidate | null;
  candidates: InvoiceVerificationCandidate[];
  verificationConfidence: number;
  revenue: number | null;
  reason: string;
  warnings: string[];
};

const DAY_MS = 24 * 60 * 60 * 1000;
const text = (value: unknown) => String(value ?? '').trim();

function amountOf(row: CustomerInvoiceReadRow) {
  for (const key of ['net_total', 'net_amount', 'discounted_amount', 'total_amount', 'amount', 'gross_total', 'gross_amount']) {
    const n = Number(row[key]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

const dateOf = (row: CustomerInvoiceReadRow) => text(row.invoice_date || row.sale_date) || null;
const branchOf = (row: CustomerInvoiceReadRow) => text(row.branch_name || row.branch) || null;
const invoiceNumberOf = (row: CustomerInvoiceReadRow) => text(row.invoice_number || row.invoice_no) || null;
const normalizeBranch = (v?: string | null) => text(v).replace(/^فرع\s+/i, '').replace(/\s+/g, ' ').toLowerCase();

function chatRange(intelligence: FullConversationIntelligence) {
  const times = intelligence.base.messages.map((m) => m.timestamp ? new Date(m.timestamp).getTime() : NaN).filter(Number.isFinite) as number[];
  return times.length ? { start: Math.min(...times), end: Math.max(...times) } : { start: null as number | null, end: null as number | null };
}

function extractInvoiceHints(intelligence: FullConversationIntelligence) {
  const all = intelligence.base.messages.map((m) => m.text).join(' ');
  const invoiceNumbers = [...new Set([...all.matchAll(/(?:فاتور(?:ه|ة)|invoice|inv)\s*[:#-]?\s*(\d{3,12})/gi)].map((m) => m[1]))];
  const money = [...all.matchAll(/(?:جنيه|ج\.م|egp)?\s*(\d{2,6}(?:[.,]\d{1,2})?)\s*(?:جنيه|ج\.م|egp)/gi)]
    .map((m) => Number(String(m[1]).replace(',', '.')))
    .filter((n) => Number.isFinite(n) && n > 0);
  return { invoiceNumbers, money };
}

function candidateFromRow(row: CustomerInvoiceReadRow, intelligence: FullConversationIntelligence, lookup: InvoiceVerificationLookup, identityStrategies: string[]): InvoiceVerificationCandidate {
  const reasons: string[] = [];
  let score = 0;
  const range = chatRange(intelligence);
  const invoiceDate = dateOf(row);
  const invoiceTs = invoiceDate ? new Date(invoiceDate).getTime() : NaN;
  const invoiceBranch = branchOf(row);
  const invoiceNumber = invoiceNumberOf(row);
  const amount = amountOf(row);
  const hints = extractInvoiceHints(intelligence);

  if (Number.isFinite(invoiceTs) && range.start != null) {
    const deltaDays = (invoiceTs - (range.end ?? range.start)) / DAY_MS;
    if (deltaDays >= -0.25 && deltaDays <= 1.5) { score += 42; reasons.push('الفاتورة في نفس يوم/قرب وقت المحادثة'); }
    else if (deltaDays > 1.5 && deltaDays <= 3) { score += 25; reasons.push('الفاتورة خلال 3 أيام من المحادثة'); }
    else if (deltaDays >= -1 && deltaDays < -0.25) { score += 16; reasons.push('الفاتورة قبل نهاية المحادثة بفترة قصيرة'); }
    else if (Math.abs(deltaDays) <= 7) { score += 8; reasons.push('الفاتورة خلال أسبوع من المحادثة'); }
    else score -= 20;
  }

  if (lookup.branch && invoiceBranch && normalizeBranch(lookup.branch) === normalizeBranch(invoiceBranch)) { score += 18; reasons.push('نفس الفرع'); }
  else if (lookup.branch && invoiceBranch) { score -= 12; reasons.push('الفرع مختلف'); }
  if (invoiceNumber && hints.invoiceNumbers.includes(invoiceNumber)) { score += 40; reasons.push('رقم الفاتورة مذكور داخل الشات'); }
  if (amount != null && hints.money.some((x) => Math.abs(x - amount) <= Math.max(2, amount * .01))) { score += 18; reasons.push('قيمة قريبة من مبلغ مذكور داخل الشات'); }
  if (identityStrategies.includes('code')) { score += 24; reasons.push('تطابق كود العميل'); }
  if (identityStrategies.includes('customer_id')) { score += 24; reasons.push('تطابق معرف العميل'); }
  if (identityStrategies.includes('phone')) { score += 22; reasons.push('تطابق رقم الهاتف'); }
  if (identityStrategies.includes('phone_tail')) { score += 14; reasons.push('تطابق آخر أرقام الهاتف'); }
  if (identityStrategies.includes('name')) { score += 6; reasons.push('تطابق الاسم فقط'); }

  return {
    invoiceId: text(row.id) || null,
    invoiceNumber,
    invoiceDate,
    branch: invoiceBranch,
    sellerName: text(row.seller_name || row.normalized_seller_name || row.staff_name) || null,
    customerCode: text(row.customer_code) || null,
    customerName: text(row.customer_name) || null,
    amount,
    score,
    confidence: Number(Math.max(0, Math.min(.99, score / 110)).toFixed(2)),
    reasons,
    matchedIdentityStrategies: identityStrategies,
  };
}

export async function verifyConversationAgainstInvoices(intelligence: FullConversationIntelligence, lookup: InvoiceVerificationLookup): Promise<InvoiceConversionVerification> {
  const eligibility = classifyConversionEligibility({ id: 'invoice-verification', label: 'invoice-verification', branch: lookup.branch, customerName: lookup.customerName, intelligence });
  const commercialEligible = eligibility.salesEligible;
  const chatSuggestedSold = eligibility.converted;
  if (!commercialEligible) return { status: 'not_applicable', chatSuggestedSold, commercialEligible, bestCandidate: null, candidates: [], verificationConfidence: 1, revenue: null, reason: 'المحادثة ليست فرصة بيع مؤهلة وفق نفس قاعدة الـConversion.', warnings: [] };
  if (eligibility.lowConfidence) return { status: 'needs_review', chatSuggestedSold, commercialEligible, bestCandidate: null, candidates: [], verificationConfidence: eligibility.confidence, revenue: null, reason: 'نية البيع نفسها منخفضة الثقة؛ لا يتم إثبات Conversion آليًا.', warnings: [] };

  const hasIdentity = Boolean(lookup.customerId || lookup.customerCode || lookup.customerPhone || lookup.customerName);
  if (!hasIdentity) return { status: 'needs_review', chatSuggestedSold, commercialEligible, bestCandidate: null, candidates: [], verificationConfidence: 0, revenue: null, reason: 'لا توجد هوية عميل كافية لمطابقة الفواتير.', warnings: ['أدخل كود العميل أو الهاتف أو الاسم قبل التحقق.'] };

  const result = await readCustomerInvoices({ customerId: lookup.customerId, customerCode: lookup.customerCode, customerPhone: lookup.customerPhone, customerName: lookup.customerName });
  const candidates = result.rows.map((row) => candidateFromRow(row, intelligence, lookup, result.matchedStrategies)).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 8);
  const best = candidates[0] || null;
  if (!best) return { status: 'not_verified', chatSuggestedSold, commercialEligible, bestCandidate: null, candidates, verificationConfidence: .75, revenue: null, reason: 'لم توجد فاتورة قريبة ومرتبطة بالعميل بما يكفي لإثبات التحويل.', warnings: result.warnings };
  if (best.confidence >= .82) return { status: 'verified_converted', chatSuggestedSold, commercialEligible, bestCandidate: best, candidates, verificationConfidence: best.confidence, revenue: best.amount, reason: 'تم العثور على فاتورة قوية التطابق مع هوية العميل وتوقيت/سياق المحادثة.', warnings: result.warnings };
  if (best.confidence >= .62) return { status: 'probable_converted', chatSuggestedSold, commercialEligible, bestCandidate: best, candidates, verificationConfidence: best.confidence, revenue: best.amount, reason: 'يوجد تطابق مرجح مع فاتورة لكن يحتاج مراجعة بشرية قبل الاعتماد الرسمي.', warnings: result.warnings };
  return { status: 'needs_review', chatSuggestedSold, commercialEligible, bestCandidate: best, candidates, verificationConfidence: best.confidence, revenue: best.amount, reason: 'وجدت فاتورة محتملة لكن قوة التطابق غير كافية للاعتماد.', warnings: result.warnings };
}
