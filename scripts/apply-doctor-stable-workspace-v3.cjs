const fs = require('fs');
const path = require('path');

function patchFile(relativePath, transform) {
  const filePath = path.join(process.cwd(), relativePath);
  const source = fs.readFileSync(filePath, 'utf8');
  const next = transform(source);
  if (next !== source) fs.writeFileSync(filePath, next);
}

patchFile('src/components/layout/Sidebar.tsx', (source) => {
  source = source.replace(
    `{ path: '/reviews', icon: ClipboardCheck, label: 'تقييم المحادثات', permission: 'view_reviews' },`,
    `{ path: '/doctor-dashboard?tab=reviews', icon: ClipboardCheck, label: 'تقييماتي الشخصية', permission: 'view_reviews' },`
  );
  if (!source.includes("label: 'إشعاراتي'")) {
    source = source.replace(
      `{ path: '/doctor-dashboard?tab=reviews', icon: ClipboardCheck, label: 'تقييماتي الشخصية', permission: 'view_reviews' },\n      { path: '/points', icon: Star, label: 'النقاط والحافز', permission: 'view_points' },`,
      `{ path: '/doctor-dashboard?tab=reviews', icon: ClipboardCheck, label: 'تقييماتي الشخصية', permission: 'view_reviews' },\n      { path: '/doctor-dashboard?tab=notifications', icon: BellRing, label: 'إشعاراتي', permission: 'view_doctor_dashboard' },\n      { path: '/points', icon: Star, label: 'النقاط والحافز', permission: 'view_points' },`
    );
  }
  return source;
});

patchFile('src/lib/salesAnalyticsSummaryService.ts', (source) => {
  source = source.replace(
    `import { normalizeBranchName } from '@/lib/branch';`,
    `import { branchMatches, normalizeBranchName } from '@/lib/branch';`
  );
  source = source.replace(
    `  const rows: Row[] = [];\n  let errorMessage: string | null = null;\n  const pageSize = 1000;\n  for (let from = 0; from < 10000; from += pageSize) {\n    let query = supabase\n      .from('sales_invoices')`,
    `  const rows: Row[] = [];\n  let errorMessage: string | null = null;\n  const pageSize = 1000;\n  for (let from = 0; from < 20000; from += pageSize) {\n    let query = supabase\n      .from('sales_invoices')`
  );
  source = source.replace(
    `    if (!isAll(filters.branch)) query = query.eq('branch', filters.branch);\n    if (!isAll(filters.doctor)) query = query.eq('seller_name', filters.doctor);`,
    `    // Branch labels are not stored consistently (e.g. "الشامي" vs "فرع الشامي").\n    // Fetch the cycle rows, then apply canonical branch matching in memory.\n    if (!isAll(filters.doctor)) query = query.eq('seller_name', filters.doctor);`
  );
  source = source.replace(
    `  return { rows, error: errorMessage };\n}\n\nfunction invoiceAmount`,
    `  const scopedRows = isAll(filters.branch)\n    ? rows\n    : rows.filter((row) => branchMatches(String(filters.branch || ''), read(row, ['branch_name', 'branch'], '')));\n  return { rows: scopedRows, error: errorMessage };\n}\n\nfunction invoiceAmount`
  );
  return source;
});

console.log('[doctor-stable-workspace-v3] applied');
