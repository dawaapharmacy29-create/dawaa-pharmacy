-- «تحرير المخزون» يوم بيوم (صاحب الصيدلية 2026-11-27): رأس المال والرواكد والبطيء لكل ملف رصيد، عشان نشوف التحرير ماشي ولا لأ.
-- رأس المال بيتقرا من inventory_stock_daily (موجود لكل ملف). الرواكد والبطيء مش بيتحفظوا مع الملف، فبيتسجلوا هنا أول ما
-- الصفحة تتفتح على الملف (صف واحد لكل فرع ويوم، upsert صغير).

create table if not exists public.inventory_liberation_daily (
  day date not null,
  branch text not null,
  capital numeric not null default 0,
  active numeric not null default 0,
  dead numeric not null default 0,
  slow numeric not null default 0,
  over numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (day, branch)
);
alter table public.inventory_liberation_daily enable row level security;
revoke all on public.inventory_liberation_daily from anon, authenticated;

do $do$
declare
  d text := pg_get_functiondef('public.dawaa_stock_liberation_v1(text)'::regprocedure);
  tail text := E'\n  return v_out;\nend;';
begin
  if position('inventory_liberation_daily' in d) > 0 then return; end if;
  if position(tail in d) = 0 then raise exception 'tail not found'; end if;
  d := replace(d, tail, $t$
  if p_branch is null then
    insert into public.inventory_liberation_daily (day, branch, capital, active, dead, slow, over, updated_at)
    select u.snapshot_day, x->>'branch', coalesce((x->>'value')::numeric, 0), coalesce((x->>'active_value')::numeric, 0),
           coalesce((x->>'dead_value')::numeric, 0), coalesce((x->>'slow_value')::numeric, 0), coalesce((x->>'over_value')::numeric, 0), now()
    from jsonb_array_elements(v_out->'activity') x
    on conflict (day, branch) do update set capital = excluded.capital, active = excluded.active, dead = excluded.dead,
      slow = excluded.slow, over = excluded.over, updated_at = now();
  end if;

  -- يوم بيوم: رأس المال من كل ملف، والرواكد والبطيء من اللي اتسجل.
  v_out := v_out || jsonb_build_object('trend', (
    select coalesce(jsonb_agg(jsonb_build_object('day', t.d, 'branch', t.branch, 'value', round(t.v), 'expiry', round(t.e),
                      'dead', round(l.dead), 'slow', round(l.slow), 'active', round(l.active)) order by t.d, t.branch), '[]'::jsonb)
    from (select snapshot_day d, branch, coalesce(sum(cost_value) filter (where store_kind in ('main', 'doctor')), 0) v,
                 coalesce(sum(cost_value) filter (where store_kind = 'expiry'), 0) e
          from public.inventory_stock_daily
          where snapshot_day >= u.snapshot_day - 120 and branch in ('فرع شكري', 'فرع الشامي')
            and (p_branch is null or branch = p_branch)
          group by 1, 2) t
    left join public.inventory_liberation_daily l on l.day = t.d and l.branch = t.branch));

  return v_out;
end;$t$);
  execute d;
end;
$do$;

grant execute on function public.dawaa_stock_liberation_v1(text) to anon, authenticated;
