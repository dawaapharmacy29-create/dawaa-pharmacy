const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/lib/salesAnalyticsSummaryService.ts');
let text = fs.readFileSync(file, 'utf8');

function replaceOnce(oldText, newText, label) {
  if (text.includes(newText)) {
    console.log(`[analytics-summary] ${label}: already applied`);
    return;
  }
  if (!text.includes(oldText)) {
    console.log(`[analytics-summary] ${label}: source changed, skipped`);
    return;
  }
  text = text.replace(oldText, newText);
  console.log(`[analytics-summary] ${label}: applied`);
}

if (!text.includes('async function fetchCustomerCardsSummary()')) {
  const marker = 'async function countCustomers(filter: (query: any) => any) {';
  const helper = `async function fetchCustomerCardsSummary() {
  const { data, error } = await supabase
    .from('analytics_customer_cards_v1')
    .select('important,stopped,threatened,invalid_phone')
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return {
    important: data?.important == null ? null : Number(data.important),
    stopped: data?.stopped == null ? null : Number(data.stopped),
    threatened: data?.threatened == null ? null : Number(data.threatened),
    invalidPhone: data?.invalid_phone == null ? null : Number(data.invalid_phone),
  };
}

`;
  if (text.includes(marker)) {
    text = text.replace(marker, helper + marker);
    console.log('[analytics-summary] customer cards helper: applied');
  }
}

replaceOnce(
`    Promise.allSettled([
      countCustomers((query) => query.in('segment', ['مهم جدًا', 'مهم'])),
      countCustomers((query) => query.eq('customer_status', 'متوقف')),
      countCustomers((query) => query.eq('customer_status', 'مهدد بالتوقف')),
      countCustomers((query) => query.or('customer_phone.is.null,customer_phone.eq.,customer_phone.ilike.code:%')),
    ]).then((results) => results.map((result) => result.status === 'fulfilled' ? result.value : null)),
`,
`    fetchCustomerCardsSummary(),
`,
  'customer cards query'
);

replaceOnce(
`    customerCards:
      customerResult.status === 'fulfilled'
        ? {
            important: customerResult.value[0] ?? null,
            stopped: customerResult.value[1] ?? null,
            threatened: customerResult.value[2] ?? null,
            invalidPhone: customerResult.value[3] ?? null,
          }
        : { important: null, stopped: null, threatened: null, invalidPhone: null },
`,
`    customerCards:
      customerResult.status === 'fulfilled'
        ? customerResult.value
        : { important: null, stopped: null, threatened: null, invalidPhone: null },
`,
  'customer cards mapping'
);

fs.writeFileSync(file, text, 'utf8');
console.log('[analytics-summary] completed');
