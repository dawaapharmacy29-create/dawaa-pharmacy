import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

// مزامنة تشغيل دواء بيلز للمراجعة اليومية: دفتر «تسوية التحصيلات» (CollectionSettlementBatch) كامل،
// وحركات المناديب (Trip / TripStop) اللي اتغيرت مؤخرًا → bills_*.
// تعمل كل 15 دقيقة عن طريق pg_cron + pg_net. {"full": true} بيجيب كل الحركات مرة واحدة.
const BASE44_APP_ID = '6a00735e63f2bcce7f4bb37e';
const BASE44_API_BASE = 'https://app.base44.com/api/apps';
const PAGE = 500;
// More than the stops changed between two runs; a status change moves a stop to the top again.
const RECENT = 1000;

async function fetchPages(key: string, entity: string, sort: string, limit: number) {
  const rows: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  for (let skip = 0; skip < limit; skip += PAGE) {
    const res = await fetch(
      `${BASE44_API_BASE}/${BASE44_APP_ID}/entities/${entity}?sort=${sort}&limit=${PAGE}&skip=${skip}`,
      { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } }
    );
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Base44 ${entity} error ${res.status}: ${body.slice(0, 300)}`);
    }
    const page = (await res.json()) as Array<Record<string, unknown>>;
    if (!Array.isArray(page)) throw new Error(`Invalid ${entity} response`);
    for (const row of page) {
      if (!row.id) throw new Error(`Invalid ${entity} row`);
      if (seen.has(String(row.id))) continue;
      seen.add(String(row.id));
      rows.push(row);
    }
    if (page.length < PAGE) return rows;
  }
  if (sort === 'id') throw new Error(`Snapshot exceeds safe limit: ${entity}`);
  return rows;
}

Deno.serve(async (req: Request) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(supabaseUrl, serviceRoleKey);
  const body = (await req.json().catch(() => ({}))) as { full?: boolean };

  try {
    const { data: keyData, error: keyError } = await admin.rpc('get_base44_api_key_v1');
    if (keyError || !keyData)
      throw new Error(`تعذر جلب مفتاح بيز٤٤: ${keyError?.message || 'مفيش مفتاح مخزن'}`);
    const key = keyData as string;

    const batches = await fetchPages(key, 'CollectionSettlementBatch', 'id', 200000);
    const [trips, stops] = body.full
      ? [
          await fetchPages(key, 'Trip', 'id', 200000),
          await fetchPages(key, 'TripStop', 'id', 200000),
        ]
      : [
          await fetchPages(key, 'Trip', '-updated_date', RECENT),
          await fetchPages(key, 'TripStop', '-updated_date', RECENT),
        ];

    const { data: rpcJson, error: rpcError } = await admin.rpc('import_base44_bills_ops_v1', {
      p_batches: batches,
      p_trips: trips,
      p_stops: stops,
    });
    if (rpcError) throw new Error(`import_base44_bills_ops_v1 error: ${rpcError.message}`);

    const result = (rpcJson || {}) as Record<string, unknown>;
    await admin.from('base44_sync_run_log').insert({
      source: 'bills_ops',
      status: 'success',
      total: stops.length,
      matched: (result.stops as number) ?? null,
    });
    return new Response(JSON.stringify({ ok: true, result }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await admin
      .from('base44_sync_run_log')
      .insert({ source: 'bills_ops', status: 'error', error_message: message });
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
