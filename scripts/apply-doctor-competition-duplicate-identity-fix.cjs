const fs = require('node:fs');
const path = require('node:path');

const filePath = path.join(process.cwd(), 'src/pages/DoctorCompetition.tsx');
if (!fs.existsSync(filePath)) {
  console.log('[doctor-competition-duplicate-identity] DoctorCompetition.tsx not found; skipped');
  process.exit(0);
}

let source = fs.readFileSync(filePath, 'utf8');
const before = source;

const oldLookup = `function buildUniqueStaffLookup(rows: Array<Pick<DoctorCompetitionScore, 'staffId' | 'name'>>) {
  const candidates = new Map<string, Set<string>>();
  rows.forEach((row) => {
    if (!row.staffId) return;
    const name = normalizedIdentityName(row.name);
    if (!name || name === 'غير محدد') return;
    const set = candidates.get(name) || new Set<string>();
    set.add(row.staffId);
    candidates.set(name, set);
  });
  const lookup: IdentityLookup = new Map();
  candidates.forEach((staffIds, name) => {
    if (staffIds.size === 1) lookup.set(name, [...staffIds][0]);
  });
  return lookup;
}

function identityKey(row: Pick<DoctorCompetitionScore, 'staffId' | 'name'>, lookup: IdentityLookup) {
  if (row.staffId) return \`staff:\${row.staffId}\`;
  const normalizedName = normalizedIdentityName(row.name);
  const resolvedStaffId = lookup.get(normalizedName);
  return resolvedStaffId ? \`staff:\${resolvedStaffId}\` : \`name:\${normalizedName}\`;
}`;

const newLookup = `function identityLookupKey(row: Pick<DoctorCompetitionScore, 'name' | 'branch'>) {
  const normalizedName = normalizedIdentityName(row.name);
  const branch = normalizeBranchName(row.branch) || row.branch || 'all';
  return \`\${branch}|\${normalizedName}\`;
}

function buildUniqueStaffLookup(rows: Array<Pick<DoctorCompetitionScore, 'staffId' | 'name' | 'branch'>>) {
  const candidates = new Map<string, Set<string>>();
  rows.forEach((row) => {
    if (!row.staffId) return;
    const name = normalizedIdentityName(row.name);
    if (!name || name === 'غير محدد') return;
    const key = identityLookupKey(row);
    const set = candidates.get(key) || new Set<string>();
    set.add(row.staffId);
    candidates.set(key, set);
  });

  const lookup: IdentityLookup = new Map();
  candidates.forEach((staffIds, key) => {
    // عند وجود حسابين لنفس الاسم داخل نفس الفرع نستخدم هوية واحدة ثابتة.
    const canonicalStaffId = [...staffIds].sort()[0];
    if (canonicalStaffId) lookup.set(key, canonicalStaffId);
  });
  return lookup;
}

function identityKey(
  row: Pick<DoctorCompetitionScore, 'staffId' | 'name' | 'branch'>,
  lookup: IdentityLookup
) {
  const normalizedName = normalizedIdentityName(row.name);
  const resolvedStaffId = lookup.get(identityLookupKey(row));
  if (resolvedStaffId) return \`staff:\${resolvedStaffId}\`;
  if (row.staffId) return \`staff:\${row.staffId}\`;
  const branch = normalizeBranchName(row.branch) || row.branch || 'all';
  return \`name:\${branch}:\${normalizedName}\`;
}`;

if (!source.includes(newLookup)) {
  if (!source.includes(oldLookup)) {
    throw new Error('[doctor-competition-duplicate-identity] expected identity helpers were not found');
  }
  source = source.replace(oldLookup, newLookup);
}

const oldMergeStart = `function mergeRows(existing: DoctorCompetitionScore | undefined, incoming: DoctorCompetitionScore) {
  if (!existing) return { ...incoming };
  const totalSales = existing.totalSales + incoming.totalSales;
  const invoices = existing.invoices + incoming.invoices;
  const preferred = incoming.staffId && !existing.staffId ? incoming : existing;`;

const newMergeStart = `function mergeRows(existing: DoctorCompetitionScore | undefined, incoming: DoctorCompetitionScore) {
  if (!existing) return { ...incoming };
  const duplicateIdentity = Boolean(
    existing.staffId &&
    incoming.staffId &&
    existing.staffId !== incoming.staffId &&
    normalizedIdentityName(existing.name) === normalizedIdentityName(incoming.name) &&
    (normalizeBranchName(existing.branch) || existing.branch) ===
      (normalizeBranchName(incoming.branch) || incoming.branch)
  );
  // الحسابان المكرران قد يشيران لنفس فواتير المبيعات؛ لذلك نستخدم القيمة الأكبر
  // بدل جمعها حتى لا تتضاعف مبيعات الدكتور بعد الدمج.
  const totalSales = duplicateIdentity
    ? Math.max(existing.totalSales, incoming.totalSales)
    : existing.totalSales + incoming.totalSales;
  const invoices = duplicateIdentity
    ? Math.max(existing.invoices, incoming.invoices)
    : existing.invoices + incoming.invoices;
  const preferred = incoming.staffId && !existing.staffId ? incoming : existing;`;

if (!source.includes(newMergeStart)) {
  if (!source.includes(oldMergeStart)) {
    throw new Error('[doctor-competition-duplicate-identity] mergeRows anchor was not found');
  }
  source = source.replace(oldMergeStart, newMergeStart);
}

const sumFields = [
  'listItems',
  'stagnantItems',
  'incentiveValue',
  'totalQuantity',
  'linkedInvoiceCount',
  'reviewCount',
  'reviewTotal',
  'excellentReviews',
  'negativeReviews',
  'followups',
  'completedFollowups',
  'recoveredCustomers',
  'followupSales',
  'satisfactionTotal',
  'satisfactionCount',
];

for (const field of sumFields) {
  const oldExpression = `${field}: existing.${field} + incoming.${field},`;
  const newExpression = `${field}: duplicateIdentity ? Math.max(existing.${field}, incoming.${field}) : existing.${field} + incoming.${field},`;
  if (!source.includes(newExpression) && source.includes(oldExpression)) {
    source = source.replace(oldExpression, newExpression);
  }
}

if (source !== before) {
  fs.writeFileSync(filePath, source);
  console.log('[doctor-competition-duplicate-identity] applied');
} else {
  console.log('[doctor-competition-duplicate-identity] already applied');
}
