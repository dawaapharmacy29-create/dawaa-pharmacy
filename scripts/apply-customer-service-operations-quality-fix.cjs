const fs = require('node:fs');
const path = require('node:path');

function patchFile(relativePath, transform) {
  const file = path.join(process.cwd(), relativePath);
  const original = fs.readFileSync(file, 'utf8');
  const next = transform(original);
  if (next !== original) fs.writeFileSync(file, next, 'utf8');
}

patchFile('src/lib/api/customerServiceOperations.ts', (source) => {
  if (!source.includes('function normalizeOperationIdentity')) {
    source = source.replace(
      `function throwDatabaseError(error: { message?: string } | null, fallback: string): never {\n  throw new Error(error?.message?.trim() || fallback);\n}\n`,
      `function throwDatabaseError(error: { message?: string } | null, fallback: string): never {\n  throw new Error(error?.message?.trim() || fallback);\n}\n\nfunction normalizeDigits(value?: string | null) {\n  return String(value || '').replace(/\\D/g, '');\n}\n\nfunction normalizeOperationIdentity(row: CustomerServiceOperationsRow) {\n  const code = String(row.customer_code || '').trim();\n  if (code && !['0', '00', '01'].includes(code)) return \`code:${'${code}'}\`;\n\n  const phone = normalizeDigits(row.display_phone || row.phone || row.mobile);\n  if (phone.length >= 10 && phone !== normalizeDigits(code)) return \`phone:${'${phone}'}\`;\n\n  const customerId = String(row.customer_id || '').trim();\n  if (customerId) return \`customer:${'${customerId}'}\`;\n  return \`followup:${'${row.id}'}\`;\n}\n\nfunction operationTime(row: CustomerServiceOperationsRow) {\n  const value = row.last_event_at || row.updated_at || row.created_at || '';\n  const time = new Date(value).getTime();\n  return Number.isNaN(time) ? 0 : time;\n}\n\nfunction dedupeOperationalRows(rows: CustomerServiceOperationsRow[]) {\n  const activeStatuses = new Set<CustomerServiceOperationalStatus>(['open', 'postponed', 'needs_manager']);\n  const active = new Map<string, CustomerServiceOperationsRow>();\n  const history: CustomerServiceOperationsRow[] = [];\n\n  for (const row of rows) {\n    if (!activeStatuses.has(row.operational_status)) {\n      history.push(row);\n      continue;\n    }\n    const key = normalizeOperationIdentity(row);\n    const current = active.get(key);\n    if (!current || operationTime(row) > operationTime(current)) active.set(key, row);\n  }\n\n  return [...active.values(), ...history].sort((a, b) => operationTime(b) - operationTime(a));\n}\n`
    );
  }
  source = source.replace(
    `  return (data || []) as CustomerServiceOperationsRow[];`,
    `  return dedupeOperationalRows((data || []) as CustomerServiceOperationsRow[]);`
  );
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

console.log('Applied operations deduplication, active-first default, and date-only display.');
