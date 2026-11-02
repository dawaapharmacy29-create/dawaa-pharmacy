import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
const DELIVERY_URL = 'https://qlugjplnnkjzxcbhwopg.supabase.co';
Deno.serve(async (req: Request) => {
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );
  const { data: config, error: configError } = await admin.rpc('delivery_invoice_bridge_config_v1');
  const secret = config?.delivery_invoice_bridge_key;
  if (configError || !secret || req.headers.get('x-dawaa-integration-key') !== secret)
    return new Response('Unauthorized', { status: 401 });
  const { data: job, error: claimError } = await admin.rpc('claim_delivery_invoice_export_v1');
  if (claimError) return Response.json({ ok: false, error: 'export_unavailable' }, { status: 503 });
  if (!job) return Response.json({ ok: true, idle: true });
  try {
    const response = await fetch(
      DELIVERY_URL + '/rest/v1/rpc/ingest_management_invoice_snapshot_v1',
      {
        method: 'POST',
        headers: {
          apikey: config.delivery_invoice_publishable_key,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          p_key: secret,
          p_start: job.period_start,
          p_end: job.period_end,
          p_revision: job.revision,
          p_rows: job.rows,
        }),
        signal: AbortSignal.timeout(110000),
      }
    );
    const result = await response.json();
    if (!response.ok) throw new Error(String(result.message || 'delivery_ingest_failed'));
    const { data: confirmed, error } = await admin.rpc('finish_delivery_invoice_export_v1', {
      p_start: job.period_start,
      p_revision: job.revision,
      p_lease: job.lease_id,
      p_result: result,
      p_error: null,
    });
    if (error || !confirmed) throw new Error('export_acknowledgement_unconfirmed');
    return Response.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'sync_failed';
    await admin.rpc('finish_delivery_invoice_export_v1', {
      p_start: job.period_start,
      p_revision: job.revision,
      p_lease: job.lease_id,
      p_result: null,
      p_error: message,
    });
    return Response.json({ ok: false, error: message }, { status: 503 });
  }
});
