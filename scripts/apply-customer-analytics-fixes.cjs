const fs = require('fs');
const path = require('path');

function read(file) {
  return fs.readFileSync(path.join(process.cwd(), file), 'utf8');
}

function write(file, content) {
  fs.writeFileSync(path.join(process.cwd(), file), content, 'utf8');
}

function replaceOnce(text, oldText, newText, label) {
  if (text.includes(newText)) {
    console.log(`[repair] ${label}: already applied`);
    return text;
  }
  if (!text.includes(oldText)) {
    console.log(`[repair] ${label}: source changed, skipped`);
    return text;
  }
  console.log(`[repair] ${label}: applied`);
  return text.replace(oldText, newText);
}

// Customer API
{
  const file = 'src/lib/api/customers.ts';
  let text = read(file);

  text = replaceOnce(
    text,
`function normalizeSearchPattern(search: string) {
  const trimmed = search.replace(/\\s+/g, ' ').trim();
  if (!trimmed) return null;
  const safe = trimmed.replace(/[%,()]/g, '').replace(/\\*/g, '%');
  return safe.includes('%') ? safe : \`%\${safe}%\`;
}
`,
`function normalizeArabicSearchText(value: string) {
  const arabicDigits = '٠١٢٣٤٥٦٧٨٩';
  return value
    .normalize('NFKC')
    .replace(/[٠-٩]/g, (digit) => String(arabicDigits.indexOf(digit)))
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[\\u064B-\\u065F\\u0670\\u0640]/g, '')
    .replace(/\\s+/g, ' ')
    .trim();
}

function escapePostgrestLike(value: string) {
  return value.replace(/\\\\/g, '\\\\\\\\').replace(/%/g, '\\\\%').replace(/_/g, '\\\\_');
}

function normalizeSearchPattern(search: string) {
  const trimmed = normalizeArabicSearchText(search);
  if (!trimmed) return null;
  const wildcardSafe = trimmed
    .replace(/[(),]/g, ' ')
    .replace(/\\*+/g, '*')
    .split('*')
    .map(escapePostgrestLike)
    .join('%')
    .replace(/\\s+/g, ' ')
    .trim();
  if (!wildcardSafe) return null;
  return wildcardSafe.includes('%') ? wildcardSafe : \`%\${wildcardSafe}%\`;
}
`,
    'wildcard search'
  );

  if (!text.includes('async function hydrateCustomerListMetadata')) {
    const marker = 'export async function getCustomers(options: GetCustomersOptions = {}) {';
    const helper = `async function hydrateCustomerListMetadata(customers: CustomerMetric[]) {
  const ids = [...new Set(customers.map((customer) => customer.customer_id).filter((id): id is string => Boolean(id && isUuidLike(id))))];
  const codes = [...new Set(customers.map((customer) => String(customer.customer_code || '').trim()).filter(Boolean))];
  if (!ids.length && !codes.length) return customers;

  const fields = 'id,customer_code,branch,notes,whatsapp_notes,service_notes,team_notes,handling_notes,customer_flags,address,phone,mobile,whatsapp';
  const rows: Row[] = [];
  const [byIds, byCodes] = await Promise.allSettled([
    ids.length ? supabase.from('customers').select(fields).in('id', ids.slice(0, 100)) : Promise.resolve({ data: [], error: null }),
    codes.length ? supabase.from('customers').select(fields).in('customer_code', codes.slice(0, 100)) : Promise.resolve({ data: [], error: null }),
  ]);
  for (const result of [byIds, byCodes]) {
    if (result.status === 'fulfilled' && !result.value.error && result.value.data) rows.push(...(result.value.data as Row[]));
  }
  const byId = new Map(rows.map((row) => [String(row.id || ''), row]));
  const byCode = new Map(rows.map((row) => [String(row.customer_code || '').trim(), row]));
  return customers.map((customer) => {
    const profile = byId.get(String(customer.customer_id || '')) || byCode.get(String(customer.customer_code || '').trim());
    if (!profile) return customer;
    const masterBranch = normalizeBranchName(profile.branch);
    return {
      ...customer,
      branch: masterBranch || customer.branch,
      customer_flags: parseCustomerFlags(profile.customer_flags),
      notes: readFirst(profile, ['notes'], null),
      customer_notes: readFirst(profile, ['notes'], null),
      whatsapp_notes: readFirst(profile, ['whatsapp_notes'], null),
      service_notes: readFirst(profile, ['service_notes'], null),
      team_notes: readFirst(profile, ['team_notes'], null),
      handling_notes: readFirst(profile, ['handling_notes'], null),
      address: readFirst(profile, ['address'], null),
      phone: readFirst(profile, ['phone', 'mobile', 'whatsapp'], customer.phone),
    } as CustomerMetric;
  });
}

`;
    if (text.includes(marker)) text = text.replace(marker, helper + marker);
  }

  text = replaceOnce(
    text,
`  const mapped = await patchCustomerMetricsFromInvoices(
    ((data ?? []) as Row[]).map(normalizeCustomerMetric)
  );
`,
`  const mapped = await hydrateCustomerListMetadata(
    await patchCustomerMetricsFromInvoices(((data ?? []) as Row[]).map(normalizeCustomerMetric))
  );
`,
    'customer metadata hydration'
  );

  write(file, text);
}

// Customer chips
{
  const file = 'src/lib/customerDisplay.tsx';
  let text = read(file);
  text = replaceOnce(
    text,
`    ...labelFromValue(row.classification),
  ];
`,
`    ...labelFromValue(row.classification),
    ...labelFromValue(row.handling_notes),
    ...labelFromValue(row.service_notes),
    ...labelFromValue(row.team_notes),
    ...labelFromValue(row.whatsapp_notes),
    ...labelFromValue(row.customer_notes ?? row.notes),
  ];
`,
    'visible customer notes'
  );
  text = replaceOnce(
    text,
`  return [...new Set(labels.map((label) => label.trim()).filter(Boolean))].slice(0, 8);
`,
`  const cleaned = [...new Set(labels.map((label) => label.trim()).filter(Boolean))];
  const important = cleaned.filter((label) => /مهم|توقف|تحذير|ممنوع|لا يقبل|لا يضاف|حساس|سرعة|VIP/i.test(label));
  const rest = cleaned.filter((label) => !important.includes(label));
  return [...important, ...rest].slice(0, 8);
`,
    'customer note priority'
  );
  write(file, text);
}

// Customers page placeholder
{
  const file = 'src/pages/Customers.tsx';
  let text = read(file);
  text = text.replace(
    'placeholder="بحث بالكود، الاسم، الهاتف... مثال: احمد* أو *ا*س*لا*م أو 010*"',
    'placeholder="بحث مرن بالكود أو الاسم أو الهاتف — استخدم * قبل أو بعد أي جزء، مثال: *احمد* أو 782*"'
  );
  write(file, text);
}

// Analytics service: summary-first and isolated expensive counts
{
  const file = 'src/lib/salesAnalyticsSummaryService.ts';
  let text = read(file);
  const oldBlock = `  const [
    liveInvoicesResult,
    salesResult,
    staffResult,
    staffIdentityResult,
    customerResult,
    healthResult,
  ] = await Promise.allSettled([
    fetchLiveInvoiceRows(filters),
    fetchAllSummaryRows(
      'sales_daily_summary',
      'sale_date',
      filters.startDate,
      filters.endDate,
      filters.branch
    ),
    fetchAllSummaryRows(
      'staff_sales_summary',
      'sale_date',
      filters.startDate,
      filters.endDate,
      filters.branch,
      filters.doctor
    ),
    fetchStaffIdentityRows(),
    Promise.all([
      countCustomers((query) => query.in('segment', ['مهم جدًا', 'مهم'])),
      countCustomers((query) => query.eq('customer_status', 'متوقف')),
      countCustomers((query) => query.eq('customer_status', 'مهدد بالتوقف')),
      countCustomers((query) =>
        query.or('customer_phone.is.null,customer_phone.eq.,customer_phone.ilike.code:%')
      ),
    ]),
    Promise.all([
      countMissing('customer_code', filters.startDate, filters.endDate, filters.branch),
      countMissing('seller_name', filters.startDate, filters.endDate, filters.branch),
      countMissing('branch', filters.startDate, filters.endDate, filters.branch),
    ]),
  ]);
`;
  const newBlock = `  const [salesResult, staffResult, staffIdentityResult] = await Promise.allSettled([
    fetchAllSummaryRows('sales_daily_summary', 'sale_date', filters.startDate, filters.endDate, filters.branch),
    fetchAllSummaryRows('staff_sales_summary', 'sale_date', filters.startDate, filters.endDate, filters.branch, filters.doctor),
    fetchStaffIdentityRows(),
  ]);
  const summaryRowsAvailable = salesResult.status === 'fulfilled' && salesResult.value.rows.length > 0;
  const [liveInvoicesResult, customerResult, healthResult] = await Promise.allSettled([
    summaryRowsAvailable ? Promise.resolve({ rows: [] as Row[], error: null as string | null }) : fetchLiveInvoiceRows(filters),
    Promise.allSettled([
      countCustomers((query) => query.in('segment', ['مهم جدًا', 'مهم'])),
      countCustomers((query) => query.eq('customer_status', 'متوقف')),
      countCustomers((query) => query.eq('customer_status', 'مهدد بالتوقف')),
      countCustomers((query) => query.or('customer_phone.is.null,customer_phone.eq.,customer_phone.ilike.code:%')),
    ]).then((results) => results.map((result) => result.status === 'fulfilled' ? result.value : null)),
    Promise.allSettled([
      countMissing('customer_code', filters.startDate, filters.endDate, filters.branch),
      countMissing('seller_name', filters.startDate, filters.endDate, filters.branch),
      countMissing('branch', filters.startDate, filters.endDate, filters.branch),
    ]).then((results) => results.map((result) => result.status === 'fulfilled' ? result.value : null)),
  ]);
`;
  text = replaceOnce(text, oldBlock, newBlock, 'analytics summary-first loading');
  text = text.replace('important: customerResult.value[0],', 'important: customerResult.value[0] ?? null,');
  text = text.replace('stopped: customerResult.value[1],', 'stopped: customerResult.value[1] ?? null,');
  text = text.replace('threatened: customerResult.value[2],', 'threatened: customerResult.value[2] ?? null,');
  text = text.replace('invalidPhone: customerResult.value[3],', 'invalidPhone: customerResult.value[3] ?? null,');
  text = text.replace('invoicesWithoutCustomer: healthResult.value[0],', 'invoicesWithoutCustomer: healthResult.value[0] ?? null,');
  text = text.replace('invoicesWithoutDoctor: healthResult.value[1],', 'invoicesWithoutDoctor: healthResult.value[1] ?? null,');
  text = text.replace('invoicesWithoutBranch: healthResult.value[2],', 'invoicesWithoutBranch: healthResult.value[2] ?? null,');
  write(file, text);
}

// Friendly Analytics error
{
  const file = 'src/pages/Analytics.tsx';
  let text = read(file);
  text = replaceOnce(
    text,
`      setError(cacheError.message || 'تعذر تحميل بيانات التحليلات');
`,
`      const rawMessage = cacheError.message || '';
      setError(
        /statement timeout|cancelling statement/i.test(rawMessage)
          ? 'تعذر تحديث بعض مؤشرات التحليلات مؤقتًا. تم الاحتفاظ بالأقسام المتاحة ويمكن إعادة المحاولة.'
          : rawMessage || 'تعذر تحميل بيانات التحليلات'
      );
`,
    'friendly analytics error'
  );
  write(file, text);
}

console.log('[repair] completed');
