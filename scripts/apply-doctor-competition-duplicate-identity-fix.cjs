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
    // عند وجود حسابين لنفس الاسم داخل نفس الفرع نستخدم هوية واحدة ثابتة
    // ثم mergeRows يجمع المبيعات والفواتير والتقييمات في صف واحد فقط.
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

if (source.includes(newLookup)) {
  console.log('[doctor-competition-duplicate-identity] already applied');
} else if (!source.includes(oldLookup)) {
  throw new Error('[doctor-competition-duplicate-identity] expected identity helpers were not found');
} else {
  source = source.replace(oldLookup, newLookup);
}

if (source !== before) {
  fs.writeFileSync(filePath, source);
  console.log('[doctor-competition-duplicate-identity] applied');
}
