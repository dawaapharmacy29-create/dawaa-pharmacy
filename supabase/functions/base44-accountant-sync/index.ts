import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { resolveAccountantSnapshot } from './snapshot.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

// مزامنة دفتر الخزن من تطبيق دواء بيلز (AccountantVault + AccountantTransaction) → accountant_*.
// تعمل كل 15 دقيقة عن طريق pg_cron + pg_net. دواء بيلز اتنقل من بيز٤٤ لـ Lovable يوم 14/11/2026، فالمزامنة
// بتقرا من صفحة القراءة بس اللي في التطبيق الجديد (نفس شكل سجلات بيز٤٤) بمفتاح dawaabills_export_key.
// SOURCE = 'base44' بيرجّع القراءة من بيز٤٤ زي الأول.
const SOURCE: 'lovable' | 'base44' = 'lovable';
const LOVABLE_EXPORT_URL = 'https://dawaabill.lovable.app/api/public/accountant-export';
const BASE44_APP_ID = '6a00735e63f2bcce7f4bb37e';
const BASE44_API_BASE = 'https://app.base44.com/api/apps';
const PAGE = 500;

function pageRequest(key: string, entity: string, skip: number): [string, RequestInit] {
  if (SOURCE === 'lovable')
    return [
      `${LOVABLE_EXPORT_URL}?entity=${entity}&limit=${PAGE}&skip=${skip}`,
      { headers: { 'x-export-key': key } },
    ];
  return [
    `${BASE44_API_BASE}/${BASE44_APP_ID}/entities/${entity}?sort=id&limit=${PAGE}&skip=${skip}`,
    { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } },
  ];
}

const VAULT_FIELDS = [
  'id',
  'code',
  'name',
  'opening_balance',
  'opening_date',
  'is_active',
  'is_sample',
  'source_closing_balance',
  'source_closing_date',
  'source_filename',
  'import_batch',
] as const;
const TX_FIELDS = [
  'id',
  'vault_code',
  'date',
  'direction',
  'amount',
  'category_name',
  'category_group',
  'classification_override',
  'description',
  'created_by_name',
  'category_id',
  'original_description',
  'description_edited_by',
  'description_edited_at',
  'source_sheet',
  'source_row',
  'source_part',
  'source_original_date',
  'source_date_adjusted',
  'source_excel_balance',
  'import_batch',
  'import_key',
  'is_offset_pair',
  'voided',
  'is_sample',
  'created_date',
  'updated_date',
] as const;

// import_base44_accountant_v1 reads created_date/updated_date as Base44 sends them: UTC with no zone
// ("2026-11-14T17:43:12.017"), and appends Z. Lovable sends "+00:00", so bring it to the same shape.
function base44Time(value: unknown) {
  if (typeof value !== 'string' || !/[zZ]|[+-]dd:?dd$/.test(value)) return value ?? null;
  const t = new Date(value);
  return Number.isNaN(t.getTime()) ? value : t.toISOString().slice(0, -1);
}

async function fetchAll(key: string, entity: string, fields: readonly string[]) {
  const rows: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  for (let skip = 0; skip < 200000; skip += PAGE) {
    const res = await fetch(...pageRequest(key, entity, skip));
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`${SOURCE} ${entity} error ${res.status}: ${body.slice(0, 300)}`);
    }
    const page = (await res.json()) as Array<Record<string, unknown>>;
    if (!Array.isArray(page)) throw new Error(`Invalid ${entity} response`);
    for (const row of page) {
      if (!row.id || seen.has(String(row.id))) throw new Error(`Incomplete ${entity} pagination`);
      seen.add(String(row.id));
      const record: Record<string, unknown> = {};
      for (const field of fields) record[field] = row[field] ?? null;
      for (const field of ['created_date', 'updated_date']) record[field] = base44Time(record[field]);
      rows.push(record);
    }
    if (page.length < PAGE) return rows;
  }
  throw new Error(`Snapshot exceeds safe limit: ${entity}`);
}

Deno.serve(async (_req: Request) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(supabaseUrl, serviceRoleKey);

  try {
    const { data: keyData, error: keyError } = await admin.rpc(
      SOURCE === 'lovable' ? 'get_dawaabills_export_key_v1' : 'get_base44_api_key_v1'
    );
    if (keyError || !keyData)
      throw new Error(`تعذر جلب مفتاح ${SOURCE}: ${keyError?.message || 'مفيش مفتاح مخزن'}`);

    const vaults = await fetchAll(keyData as string, 'AccountantVault', VAULT_FIELDS);
    const transactions = await fetchAll(keyData as string, 'AccountantTransaction', TX_FIELDS);

    const categories = await fetchAll(keyData as string, 'AccountantCategory', [
      'id',
      'name',
      'group',
    ]);
    const aliases = await fetchAll(keyData as string, 'AccountantAlias', [
      'id',
      'source_key',
      'target_name',
      'group',
      'updated_date',
      'created_date',
    ]);
    const resolved = resolveAccountantSnapshot(transactions, categories, aliases);

    const { data: rpcJson, error: rpcError } = await admin.rpc('import_base44_accountant_v1', {
      p_vaults: vaults,
      p_transactions: resolved,
    });
    if (rpcError) throw new Error(`import_base44_accountant_v1 error: ${rpcError.message}`);

    const result = (rpcJson || {}) as Record<string, unknown>;
    await admin.from('base44_sync_run_log').insert({
      source: 'accountant',
      status: 'success',
      total: (result.total as number) ?? transactions.length,
      matched: (result.transactions as number) ?? null,
    });
    return new Response(JSON.stringify({ ok: true, result }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await admin
      .from('base44_sync_run_log')
      .insert({ source: 'accountant', status: 'error', error_message: message });
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
