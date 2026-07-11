import { normalizeBranchName } from '@/lib/branch';

type AnyRow = Record<string, unknown>;

function isRecord(row: unknown): row is AnyRow {
  return Boolean(row && typeof row === 'object');
}

function text(value: unknown) {
  return String(value ?? '').trim();
}

function readNestedBranch(row: AnyRow) {
  const customer = row.customer;
  return isRecord(customer) ? customer.branch : undefined;
}

function labelFromValue(value: unknown): string[] {
  if (value == null || value === false) return [];
  if (Array.isArray(value)) return value.flatMap(labelFromValue);
  if (typeof value === 'object') {
    return Object.entries(value as AnyRow)
      .filter(([, entryValue]) => entryValue !== false && entryValue != null && entryValue !== '')
      .flatMap(([key, entryValue]) => {
        if (typeof entryValue === 'string') return entryValue;
        if (entryValue === true) return key;
        if (typeof entryValue === 'object') {
          const record = entryValue as AnyRow;
          return text(record.label ?? record.name ?? record.title ?? key);
        }
        return key;
      });
  }
  return text(value)
    .split(/[,،|;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeBranchCandidate(value: unknown) {
  const raw = text(value);
  if (!raw) return '';
  const normalized = normalizeBranchName(raw);
  if (normalized) return normalized;
  const lower = raw.toLowerCase();
  if (/shamy|الشامي|شامي/.test(lower)) return 'فرع الشامي';
  if (/shokry|شكري|شكرى/.test(lower)) return 'فرع شكري';
  if (/store|warehouse|مخزن|المخزن/.test(lower)) return 'المخزن';
  return '';
}

export function getCustomerCodeSafe(row: unknown): string {
  if (!isRecord(row)) return '';
  return text(row.customer_code ?? row.code ?? row.raw_customer_code ?? row.customerCode ?? row.final_customer_key);
}

export function resolveCustomerBranch(row: unknown): {
  branch: string;
  source: string;
  needsReview: boolean;
} {
  if (!isRecord(row)) return { branch: 'غير محدد', source: 'missing_row', needsReview: true };

  const candidates: Array<[string, unknown]> = [
    ['branch', readNestedBranch(row) ?? row.branch],
    ['current_branch', row.current_branch],
    ['last_invoice_branch', row.last_invoice_branch ?? row.branch_last_purchase],
    ['invoice_branch', row.invoice_branch],
    ['followup_branch', row.followup_branch],
    ['raw_branch', row.raw_branch],
    ['suggested_branch', row.suggested_branch],
  ];

  for (const [source, value] of candidates) {
    const branch = normalizeBranchCandidate(value);
    if (branch) return { branch, source, needsReview: false };
  }

  const searchText = [
    row.customer_name,
    row.name,
    row.notes,
    row.customer_notes,
    row.service_notes,
    row.team_notes,
    row.followup_notes,
  ]
    .map(text)
    .join(' ')
    .toLowerCase();
  const inferred = normalizeBranchCandidate(searchText);
  if (inferred) return { branch: inferred, source: 'text_inference', needsReview: true };

  return { branch: 'غير محدد', source: 'missing', needsReview: true };
}

export function getCustomerFlagChips(row: unknown): string[] {
  if (!isRecord(row)) return [];
  const labels = [
    ...labelFromValue(row.customer_flags),
    ...labelFromValue(row.flags),
    ...labelFromValue(row.tags),
    ...labelFromValue(row.customer_tags),
    ...labelFromValue(row.segment),
    ...labelFromValue(row.status ?? row.customer_status),
    ...labelFromValue(row.risk_label),
    ...labelFromValue(row.priority_label ?? row.priority),
    ...labelFromValue(row.classification),
  ];

  const code = getCustomerCodeSafe(row);
  const branch = resolveCustomerBranch(row);
  if (!code) labels.push('بدون كود');
  if (branch.needsReview) labels.push('فرع غير مؤكد');
  if (text(row.source_type).includes('unregistered') || text(row.customer_status).includes('غير مسجل')) {
    labels.push('عميل غير مسجل');
  }

  return [...new Set(labels.map((label) => label.trim()).filter(Boolean))].slice(0, 8);
}

export function CustomerFlagChips({ row, className = '' }: { row: unknown; className?: string }) {
  const chips = getCustomerFlagChips(row);
  if (!chips.length) return null;
  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`}>
      {chips.map((chip) => (
        <span
          key={chip}
          className="rounded-full border border-teal-300/30 bg-teal-500/10 px-2.5 py-1 text-[11px] font-black text-teal-100"
        >
          {chip}
        </span>
      ))}
    </div>
  );
}
