async function main() {
  const url = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');

  if (!url || !key) {
    console.error('[story-truth-v39] missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const response = await fetch(`${url}/rest/v1/rpc/dawaa_whatsapp_story_truth_health_v39`, {
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
    console.error(`[story-truth-v39] health RPC failed: HTTP ${response.status} ${body}`);
    process.exit(1);
  }

  const health = await response.json();
  console.log('[story-truth-v39]', JSON.stringify(health));

  if (!health || health.ok !== true) {
    console.error('[story-truth-v39] canonical Story/Recovery invariant failed');
    process.exit(1);
  }

  console.log('[story-truth-v39] PASS: Story purchase/recovery truth is Canonical-only.');
}

main().catch((error) => {
  console.error('[story-truth-v39] unexpected failure', error);
  process.exit(1);
});
