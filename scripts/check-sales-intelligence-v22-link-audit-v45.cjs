async function main() {
  const url = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');

  if (!url || !key) {
    console.error('[si-v22-link-audit-v45] missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const response = await fetch(`${url}/rest/v1/rpc/dawaa_sales_intelligence_v22_link_audit_v45`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(`[si-v22-link-audit-v45] audit RPC failed: HTTP ${response.status} ${body}`);
    process.exit(1);
  }

  const audit = await response.json();
  console.log('[si-v22-link-audit-v45]', JSON.stringify({ ok: audit?.ok, totals: audit?.totals, byClass: audit?.byClass }));

  if (!audit || audit.ok !== true) {
    const failing = new Set(audit?.failingClasses || []);
    for (const row of audit?.cases || []) {
      if (failing.has(row.linkClass)) console.error('[si-v22-link-audit-v45] FAIL', JSON.stringify(row));
    }
    console.error('[si-v22-link-audit-v45] a Sales Intelligence case is unlinked from Customer Case V22 without an explained reason');
    process.exit(1);
  }

  console.log('[si-v22-link-audit-v45] PASS: every unlinked Sales Intelligence case has a deterministic reason.');
}

main().catch((error) => {
  console.error('[si-v22-link-audit-v45] unexpected failure', error);
  process.exit(1);
});
