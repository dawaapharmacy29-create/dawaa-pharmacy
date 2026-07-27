const fs = require('node:fs');
const path = require('node:path');

const target = path.join(process.cwd(), 'src/lib/customerEngagement.ts');
let source = fs.readFileSync(target, 'utf8');

const before = `export async function searchCustomerIdentity(query: string): Promise<CustomerIdentity[]> {
  const q = query.trim();
  if (!q) return [];
  const { data, error } = await supabase
    .from('customer_metrics_summary')
    .select('customer_id,customer_code,customer_name,customer_phone,branch')
    .or(\`customer_code.ilike.%\${q}%,customer_phone.ilike.%\${q}%,customer_name.ilike.%\${q}%\`)
    .limit(20);
  if (error) throw new Error(error.message);
  return (data || []) as CustomerIdentity[];
}`;

const after = `export async function searchCustomerIdentity(query: string): Promise<CustomerIdentity[]> {
  const q = query.trim();
  if (!q) return [];

  const { data, error } = await supabase.rpc('search_customer_identity_for_points', {
    p_query: q,
    p_limit: 20,
  });

  if (!error) {
    return (data || []).map((row: Record<string, unknown>) => ({
      customer_id: String(row.customer_id || '') || null,
      customer_code: String(row.customer_code || '') || null,
      customer_name: String(row.customer_name || '') || null,
      customer_phone: String(row.customer_phone || '') || null,
      branch: String(row.branch || '') || null,
    })) as CustomerIdentity[];
  }

  // Compatibility fallback while the new RPC is being deployed.
  const exactCode = /^\\d+$/.test(q);
  let direct = supabase
    .from('customers')
    .select('id,customer_code,name,phone,mobile,whatsapp,branch')
    .limit(20);

  direct = exactCode
    ? direct.eq('customer_code', q)
    : direct.or(\`customer_code.ilike.%\${q}%,phone.ilike.%\${q}%,mobile.ilike.%\${q}%,whatsapp.ilike.%\${q}%,name.ilike.%\${q}%\`);

  const { data: customers, error: directError } = await direct;
  if (directError) throw new Error(error.message || directError.message || 'تعذر البحث في قاعدة العملاء.');

  return (customers || []).map((row: Record<string, unknown>) => ({
    customer_id: String(row.id || '') || null,
    customer_code: String(row.customer_code || '') || null,
    customer_name: String(row.name || '') || null,
    customer_phone: String(row.phone || row.mobile || row.whatsapp || '') || null,
    branch: String(row.branch || '') || null,
  })) as CustomerIdentity[];
}`;

if (!source.includes(after)) {
  if (!source.includes(before)) throw new Error('Original searchCustomerIdentity function not found');
  source = source.replace(before, after);
  fs.writeFileSync(target, source, 'utf8');
}

console.log('Customer identity search fallback applied.');
