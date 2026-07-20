const fs = require('node:fs');
const path = require('node:path');

function patchFile(relativePath, transform) {
  const file = path.join(process.cwd(), relativePath);
  const original = fs.readFileSync(file, 'utf8');
  const next = transform(original);
  if (next !== original) fs.writeFileSync(file, next, 'utf8');
}

patchFile('src/lib/api/customerServiceOperations.ts', (source) => {
  if (!source.includes("import { normalizeBranchName } from '@/lib/branch';")) {
    source = source.replace(
      "import { supabase } from '@/lib/supabase';",
      "import { supabase } from '@/lib/supabase';\nimport { normalizeBranchName } from '@/lib/branch';"
    );
  }

  if (!source.includes('function normalizeOperationIdentity')) {
    source = source.replace(
      `function throwDatabaseError(error: { message?: string } | null, fallback: string): never {\n  throw new Error(error?.message?.trim() || fallback);\n}\n`,
      `function throwDatabaseError(error: { message?: string } | null, fallback: string): never {\n  throw new Error(error?.message?.trim() || fallback);\n}\n\nfunction normalizeDigits(value?: string | null) {\n  return String(value || '').replace(/\\D/g, '');\n}\n\nfunction normalizeOperationIdentity(row: CustomerServiceOperationsRow) {\n  const code = String(row.customer_code || '').trim();\n  if (code && !['0', '00', '01'].includes(code)) return \`code:\${code}\`;\n\n  const phone = normalizeDigits(row.display_phone || row.customer_phone || row.phone || row.whatsapp_phone || row.phone_alt);\n  if (phone.length >= 10 && phone !== normalizeDigits(code)) return \`phone:\${phone}\`;\n\n  const customerId = String(row.customer_id || '').trim();\n  if (customerId) return \`customer:\${customerId}\`;\n  return \`followup:\${row.id}\`;\n}\n\nfunction operationTime(row: CustomerServiceOperationsRow) {\n  const value = row.last_event_at || row.updated_at || row.created_at || '';\n  const time = new Date(value).getTime();\n  return Number.isNaN(time) ? 0 : time;\n}\n\nfunction dedupeOperationalRows(rows: CustomerServiceOperationsRow[]) {\n  const activeStatuses = new Set<CustomerServiceOperationalStatus>(['open', 'postponed', 'needs_manager']);\n  const active = new Map<string, CustomerServiceOperationsRow>();\n  const history: CustomerServiceOperationsRow[] = [];\n\n  for (const row of rows) {\n    if (!activeStatuses.has(row.operational_status)) {\n      history.push(row);\n      continue;\n    }\n    const key = normalizeOperationIdentity(row);\n    const current = active.get(key);\n    if (!current || operationTime(row) > operationTime(current)) active.set(key, row);\n  }\n\n  return [...active.values(), ...history].sort((a, b) => operationTime(b) - operationTime(a));\n}\n`
    );
  }

  source = source.replace(
    `row.display_phone || row.phone || row.mobile`,
    `row.display_phone || row.customer_phone || row.phone || row.whatsapp_phone || row.phone_alt`
  );

  if (!source.includes('async function enrichOperationalBranches')) {
    source = source.replace(
      `function dedupeOperationalRows(rows: CustomerServiceOperationsRow[]) {`,
      `function chunkValues<T>(values: T[], size = 150) {\n  const chunks: T[][] = [];\n  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));\n  return chunks;\n}\n\nasync function enrichOperationalBranches(rows: CustomerServiceOperationsRow[]) {\n  const customerIds = [...new Set(rows.map((row) => String(row.customer_id || '').trim()).filter((value) => /^[0-9a-f-]{36}$/i.test(value)))];\n  const customerCodes = [...new Set(rows.map((row) => String(row.customer_code || '').trim()).filter(Boolean))];\n  const byId = new Map<string, string>();\n  const byCode = new Map<string, string>();\n\n  for (const ids of chunkValues(customerIds)) {\n    const { data, error } = await supabase.from('customers').select('id,customer_code,branch').in('id', ids);\n    if (!error) {\n      for (const customer of data || []) {\n        const branch = normalizeBranchName(customer.branch || '');\n        if (branch) byId.set(String(customer.id), branch);\n        if (branch && customer.customer_code) byCode.set(String(customer.customer_code).trim(), branch);\n      }\n    }\n  }\n\n  for (const codes of chunkValues(customerCodes)) {\n    const missingCodes = codes.filter((code) => !byCode.has(code));\n    if (!missingCodes.length) continue;\n    const { data, error } = await supabase.from('customers').select('id,customer_code,branch').in('customer_code', missingCodes);\n    if (!error) {\n      for (const customer of data || []) {\n        const branch = normalizeBranchName(customer.branch || '');\n        if (branch) byId.set(String(customer.id), branch);\n        if (branch && customer.customer_code) byCode.set(String(customer.customer_code).trim(), branch);\n      }\n    }\n  }\n\n  return rows.map((row) => {\n    const canonical = byId.get(String(row.customer_id || '').trim())\n      || byCode.get(String(row.customer_code || '').trim())\n      || normalizeBranchName(row.branch || '');\n    return canonical ? { ...row, branch: canonical } : row;\n  });\n}\n\nfunction buildUniqueStats(rows: CustomerServiceOperationsRow[]): CustomerServiceStats {\n  const total = new Set<string>();\n  const byStatus = {\n    open: new Set<string>(), postponed: new Set<string>(), needs_manager: new Set<string>(),\n    completed: new Set<string>(), cancelled: new Set<string>(), archived: new Set<string>(),\n  };\n  const overdue = new Set<string>();\n  const dueToday = new Set<string>();\n  const withoutSchedule = new Set<string>();\n  const activeStatuses = new Set<CustomerServiceOperationalStatus>(['open', 'postponed', 'needs_manager']);\n\n  for (const row of rows) {\n    const key = normalizeOperationIdentity(row);\n    total.add(key);\n    byStatus[row.operational_status].add(key);\n    if (!activeStatuses.has(row.operational_status)) continue;\n    if (row.due_bucket === 'overdue') overdue.add(key);\n    if (row.due_bucket === 'today') dueToday.add(key);\n    if (row.due_bucket === 'unscheduled') withoutSchedule.add(key);\n  }\n\n  return {\n    total: total.size, open: byStatus.open.size, postponed: byStatus.postponed.size,\n    needs_manager: byStatus.needs_manager.size, completed: byStatus.completed.size,\n    cancelled: byStatus.cancelled.size, archived: byStatus.archived.size,\n    overdue: overdue.size, due_today: dueToday.size, without_schedule: withoutSchedule.size,\n  };\n}\n\nfunction dedupeOperationalRows(rows: CustomerServiceOperationsRow[]) {`
    );
  }

  source = source.replace(
    `export async function fetchCustomerServiceStats(branch?: string | null) {\n  const { data, error } = await supabase.rpc('dawaa_customer_service_stats_v2', {\n    p_branch: branch?.trim() || null,\n  });\n  if (error) throwDatabaseError(error, 'تعذر تحميل إحصائيات خدمة العملاء');\n  return data as CustomerServiceStats;\n}`,
    `export async function fetchCustomerServiceStats(branch?: string | null) {\n  const rows = await fetchCustomerServiceOperations({ branch, status: 'all', due: 'all', limit: 5000 });\n  return buildUniqueStats(rows);\n}`
  );

  source = source.replace(
    `  const limit = Math.min(Math.max(filters.limit || 500, 1), 2000);`,
    `  const limit = Math.min(Math.max(filters.limit || 500, 1), 5000);`
  );
  source = source.replace(
    `  if (filters.branch?.trim()) query = query.eq('branch', filters.branch.trim());\n`,
    ``
  );
  const finalReturn = `  const enriched = await enrichOperationalBranches((data || []) as CustomerServiceOperationsRow[]);\n  const deduped = dedupeOperationalRows(enriched);\n  const requestedBranch = normalizeBranchName(filters.branch || '');\n  return requestedBranch\n    ? deduped.filter((row) => normalizeBranchName(row.branch || '') === requestedBranch)\n    : deduped;`;
  source = source.replace(`  return (data || []) as CustomerServiceOperationsRow[];`, finalReturn);
  source = source.replace(`  return dedupeOperationalRows((data || []) as CustomerServiceOperationsRow[]);`, finalReturn);
  return source;
});

patchFile('src/components/customerService/CustomerServiceOperationsPanel.tsx', (source) => {
  source = source.replace(
    `  return parsed.toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });`,
    `  return parsed.toLocaleDateString('ar-EG', { dateStyle: 'medium' });`
  );
  source = source.replace(
    `  const [status, setStatus] = useState<CustomerServiceOperationalStatus | 'all'>('all');`,
    `  const [status, setStatus] = useState<CustomerServiceOperationalStatus | 'all'>('open');`
  );
  source = source.replace(
    `{row.due_bucket && <span className="rounded-full border border-white/10 px-2 py-1 text-xs font-bold text-slate-300">{DUE_LABELS[row.due_bucket]}</span>}`,
    `{['open', 'postponed', 'needs_manager'].includes(row.operational_status) && row.due_bucket && <span className="rounded-full border border-white/10 px-2 py-1 text-xs font-bold text-slate-300">{DUE_LABELS[row.due_bucket]}</span>}`
  );
  return source;
});

console.log('Applied canonical customer branches, unique stats, operations deduplication, and date-only display.');
