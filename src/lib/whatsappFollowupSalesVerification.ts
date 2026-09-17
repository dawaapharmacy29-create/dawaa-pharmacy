import { readCustomerInvoices, type CustomerInvoiceMatch, type CustomerInvoiceReadRow } from '@/lib/readModels/customerInvoiceReadModel';
import { customerIdentityText } from '@/lib/customers/customerIdentity';

export type FollowupSaleVerificationInput = {
  customerPhone?: string | null;
  customerName?: string | null;
  customerCode?: string | null;
  customerId?: string | null;
  branch?: string | null;
  signalAt: string | Date;
  windowDays?: number;
};

export type FollowupSaleCandidate = {
  invoiceId: string | null;
  invoiceNumber: string | null;
  invoiceDate: string;
  branch: string | null;
  amount: number | null;
  sellerName: string | null;
  confidence: number;
  matchedBy: CustomerInvoiceMatch | 'mixed' | null;
  reasons: string[];
};

export type FollowupSaleVerification = {
  status: 'verified_candidate' | 'weak_candidate' | 'not_found' | 'insufficient_identity';
  candidates: FollowupSaleCandidate[];
  warnings: string[];
};

function normalizeBranch(value: unknown) {
  return customerIdentityText(value)
    .replace(/^فرع\s+/i, '')
    .replace(/^صيدليات?\s+دواء\s*/i, '')
    .replace(/^دواء\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('ar-EG');
}

function dateValue(row: CustomerInvoiceReadRow) {
  return customerIdentityText(row.invoice_date || row.sale_date);
}

function amountValue(row: CustomerInvoiceReadRow) {
  const raw = row.net_total ?? row.net_amount ?? row.discounted_amount ?? row.amount ?? row.gross_total ?? row.gross_amount ?? row.total_amount;
  const number = Number(raw);
  return Number.isFinite(number) ? number : null;
}

function startOfDay(value: string | Date) {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('تاريخ إشارة المتابعة غير صالح');
  date.setHours(0, 0, 0, 0);
  return date;
}

function strategyBaseConfidence(matchedBy: FollowupSaleCandidate['matchedBy']) {
  if (matchedBy === 'code' || matchedBy === 'customer_id' || matchedBy === 'phone') return 0.9;
  if (matchedBy === 'mixed') return 0.88;
  if (matchedBy === 'phone_tail') return 0.76;
  if (matchedBy === 'name') return 0.52;
  return 0.4;
}

export async function verifyFollowupSale(input: FollowupSaleVerificationInput): Promise<FollowupSaleVerification> {
  const hasIdentity = Boolean(
    customerIdentityText(input.customerCode) ||
    customerIdentityText(input.customerId) ||
    customerIdentityText(input.customerPhone) ||
    customerIdentityText(input.customerName)
  );
  if (!hasIdentity) return { status: 'insufficient_identity', candidates: [], warnings: [] };

  const result = await readCustomerInvoices({
    customerCode: input.customerCode,
    customerId: input.customerId,
    customerPhone: input.customerPhone,
    customerName: input.customerName,
  });

  const from = startOfDay(input.signalAt);
  const until = new Date(from);
  until.setDate(until.getDate() + Math.max(1, Math.min(input.windowDays ?? 14, 45)));
  until.setHours(23, 59, 59, 999);
  const targetBranch = normalizeBranch(input.branch);

  const candidates = result.rows
    .map((row): FollowupSaleCandidate | null => {
      const invoiceDateText = dateValue(row);
      if (!invoiceDateText) return null;
      const invoiceDate = new Date(invoiceDateText);
      if (Number.isNaN(invoiceDate.getTime()) || invoiceDate < from || invoiceDate > until) return null;

      const invoiceBranch = customerIdentityText(row.branch_name || row.branch) || null;
      const branchMatches = !targetBranch || !invoiceBranch || normalizeBranch(invoiceBranch) === targetBranch;
      if (targetBranch && invoiceBranch && !branchMatches) return null;

      const reasons: string[] = [];
      let confidence = strategyBaseConfidence(result.matchedBy);
      reasons.push(`مطابقة العميل: ${result.matchedBy || 'غير محددة'}`);
      if (branchMatches && targetBranch && invoiceBranch) {
        confidence += 0.05;
        reasons.push('نفس الفرع');
      }
      const daysAfter = Math.max(0, Math.floor((invoiceDate.getTime() - from.getTime()) / 86400000));
      if (daysAfter <= 3) {
        confidence += 0.04;
        reasons.push('الفاتورة قريبة زمنيًا من المتابعة');
      }

      return {
        invoiceId: customerIdentityText(row.id) || null,
        invoiceNumber: customerIdentityText(row.invoice_number || row.invoice_no) || null,
        invoiceDate: invoiceDateText,
        branch: invoiceBranch,
        amount: amountValue(row),
        sellerName: customerIdentityText(row.normalized_seller_name || row.seller_name || row.staff_name) || null,
        confidence: Math.min(0.99, confidence),
        matchedBy: result.matchedBy,
        reasons,
      };
    })
    .filter((candidate): candidate is FollowupSaleCandidate => Boolean(candidate))
    .sort((a, b) => b.confidence - a.confidence || new Date(a.invoiceDate).getTime() - new Date(b.invoiceDate).getTime())
    .slice(0, 5);

  if (!candidates.length) return { status: 'not_found', candidates: [], warnings: result.warnings };
  return {
    status: candidates[0].confidence >= 0.75 ? 'verified_candidate' : 'weak_candidate',
    candidates,
    warnings: result.warnings,
  };
}
