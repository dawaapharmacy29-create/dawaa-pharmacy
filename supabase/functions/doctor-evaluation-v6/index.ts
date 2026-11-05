import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
// Bundled from src/lib/evaluationLab (scripts/build-doctor-evaluation-edge.mjs): the same engine as /evaluation-lab.
import { computeCycleScores, serverCycle, setEvidenceClient, LAB_CURRENT_VERSION } from './engine.js';

// Monthly evaluation (lab engine) for the signed-in staff member. The engine needs every branch's
// attendance and invoices, which only top management may read, so it runs here with the service
// role and returns the caller's own row (top management: every row). Results are cached per cycle.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-dawaa-session-token, x-dawaa-user-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const TOP_ROLES = new Set(['general_manager', 'executive_manager', 'branches_manager', 'admin']);
const RUNNING_TTL_MS = 60 * 60 * 1000;
const CLOSED_TTL_MS = 24 * 60 * 60 * 1000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

type Score = { staffId: string; name: string; branch: string | null; family: string; total: number | null; readiness: string };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  // Identity: only the staff session token is trusted (same contract as the database).
  const token = (req.headers.get('x-dawaa-session-token') || '').trim();
  if (!token) return json({ error: 'not_authorized' }, 401);
  const asCaller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { persistSession: false },
    global: { headers: { 'x-dawaa-session-token': token } },
  });
  const { data: accountId, error: idError } = await asCaller.rpc('dawaa_current_staff_account_id_strict');
  if (idError || !accountId) return json({ error: 'not_authorized' }, 401);
  const { data: account } = await service.from('staff_accounts').select('id,staff_id,role').eq('id', accountId).maybeSingle();
  const staffId = String(account?.staff_id || '').trim();
  const isTop = TOP_ROLES.has(String(account?.role || '').trim().toLowerCase());
  if (!staffId && !isTop) return json({ error: 'no_staff_record' }, 403);

  const body = await req.json().catch(() => ({}));
  const kind = body?.cycle === 'closed' ? 'closed' : 'running';
  const cycle = serverCycle(kind);
  if (!cycle) return json({ cycle: null, reason: 'cycle_first_day' });

  // Levels are set by the general manager in the lab; a newer level makes the cache stale.
  const { data: levelRows } = await service.from('evaluation_v6_doctor_levels').select('staff_id,level,updated_at');
  const levels = Object.fromEntries((levelRows || []).map((row) => [String(row.staff_id), String(row.level)]));
  const levelsAt = Math.max(0, ...(levelRows || []).map((row) => Date.parse(String(row.updated_at)) || 0));

  const { data: cached } = await service.from('evaluation_v6_score_cache')
    .select('computed_at,scores')
    .eq('cycle_start', cycle.start).eq('cycle_end_exclusive', cycle.endExclusive).eq('version', LAB_CURRENT_VERSION)
    .maybeSingle();
  const cachedAt = cached ? Date.parse(String(cached.computed_at)) : 0;
  const ttl = kind === 'running' ? RUNNING_TTL_MS : CLOSED_TTL_MS;
  let scores: Score[];
  let computedAt: string;
  if (cached && Date.now() - cachedAt < ttl && cachedAt >= levelsAt && body?.refresh !== true) {
    scores = cached.scores as Score[];
    computedAt = String(cached.computed_at);
  } else {
    setEvidenceClient(evidenceClient(service));
    scores = await computeCycleScores(cycle, levels) as Score[];
    computedAt = new Date().toISOString();
    await service.from('evaluation_v6_score_cache').upsert({
      cycle_start: cycle.start, cycle_end_exclusive: cycle.endExclusive, version: LAB_CURRENT_VERSION, computed_at: computedAt, scores,
    });
    // Earlier days of the running cycle are superseded.
    await service.from('evaluation_v6_score_cache').delete().eq('cycle_start', cycle.start).lt('cycle_end_exclusive', cycle.endExclusive);
  }

  const me = scores.find((row) => row.staffId === staffId) || null;
  // Rank among the same role family, counting only cards with enough measured data.
  const ranked = me ? scores.filter((row) => row.family === me.family && row.total !== null && row.readiness !== 'insufficient')
    .sort((a, b) => (b.total ?? 0) - (a.total ?? 0)) : [];
  const rankIndex = me ? ranked.findIndex((row) => row.staffId === me.staffId) : -1;
  const familyTotals = ranked.map((row) => row.total ?? 0);
  return json({
    version: LAB_CURRENT_VERSION,
    cycle,
    computedAt,
    me,
    rank: rankIndex >= 0 ? rankIndex + 1 : null,
    rankOf: ranked.length,
    familyMedian: familyTotals.length ? familyTotals[Math.floor((familyTotals.length - 1) / 2)] : null,
    all: isTop && body?.all === true ? scores : undefined,
  });
});

/**
 * The service client, with the one RPC the engine calls that needs a signed-in actor
 * (list_staff_violations_v1) answered from the tables directly.
 */
// deno-lint-ignore no-explicit-any
function evidenceClient(service: any) {
  return new Proxy(service, {
    get(target, prop) {
      if (prop === 'rpc') {
        return async (name: string, args: Record<string, unknown>) => {
          if (name !== 'list_staff_violations_v1') return target.rpc(name, args);
          const { data, error } = await target.from('staff_compliance_violations')
            .select('staff_account_id,category,points,withdrawn_at')
            .gte('occurred_on', args.p_from).lte('occurred_on', args.p_to);
          if (error) return { data: null, error };
          const ids = [...new Set((data || []).map((row: { staff_account_id: string }) => row.staff_account_id))];
          const { data: accounts } = ids.length
            ? await target.from('staff_accounts').select('id,staff_id').in('id', ids)
            : { data: [] };
          const staffOf = new Map((accounts || []).map((row: { id: string; staff_id: string | null }) => [row.id, row.staff_id]));
          return {
            error: null,
            data: (data || []).map((row: { staff_account_id: string; category: string; points: number; withdrawn_at: string | null }) => ({
              staff_account_id: row.staff_account_id,
              staff_id: staffOf.get(row.staff_account_id) || null,
              category: row.category,
              points: row.points,
              withdrawn: row.withdrawn_at !== null,
            })),
          };
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
