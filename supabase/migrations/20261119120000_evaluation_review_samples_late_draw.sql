-- «المراجعات الأسبوعية العشوائية»: a batch drawn late (the screen wasn't opened, or the
-- 20261119090000 grant fix came after the batch was due) took invoices the cameras had already erased,
-- so 7 of the first batch (14–17/11) were born «الكاميرا مسحتها». The cameras keep 5 days, so an
-- invoice batch now only draws invoices of the last 4 Cairo days (deadline = invoice day + 4 >= today).
-- Conversations have no camera limit; the screen now also draws the previous week if it was missed.
create or replace function public.generate_evaluation_review_batch_v1(p_kind text, p_batch_start date, p_batch_end date)
returns integer
language plpgsql
security definer
set search_path = 'public', 'pg_catalog'
as $function$
declare
  -- Invoices: only days the cameras still keep (invoice day + 4 >= today).
  v_from timestamptz := (case when p_kind = 'invoice'
    then greatest(p_batch_start, (now() at time zone 'Africa/Cairo')::date - 4) else p_batch_start end)::timestamp at time zone 'Africa/Cairo';
  v_to timestamptz := ((p_batch_end + 1)::timestamp) at time zone 'Africa/Cairo';
  v_cycle date := public.dawaa_review_cycle_start_v1(p_batch_start);
  v_seller record;
  v_slots integer;
  v_stratum text;
  v_pick record;
  v_added integer := 0;
begin
  if not coalesce(public.dawaa_current_actor_can(array['manage_evaluation_rules']), false) then
    raise exception 'review_samples_not_authorized' using errcode = '42501';
  end if;
  if p_kind not in ('invoice', 'conversation') or p_batch_end < p_batch_start or p_batch_end - p_batch_start > 6
     or p_batch_end >= (now() at time zone 'Africa/Cairo')::date then
    raise exception 'review_samples_invalid_batch' using errcode = '22023';
  end if;
  insert into public.evaluation_review_batches_v1 (kind, batch_start, batch_end, created_by)
  values (p_kind, p_batch_start, p_batch_end, public.dawaa_current_staff_account_id_strict()::text)
  on conflict (kind, batch_start) do nothing;
  if not found then
    return 0;
  end if;

  create temporary table if not exists review_candidates (
    invoice_id text, staff_id uuid, branch text, invoice_number text, invoice_at timestamptz, net numeric,
    items integer, customer_code text, customer_name text, customer_phone text, stratum text, rnd text
  ) on commit drop;
  truncate review_candidates;

  insert into review_candidates
  with base as (
    select si.id::text as invoice_id, si.staff_id::uuid as staff_id, si.branch, coalesce(si.invoice_number, si.invoice_no) as invoice_number,
           si.invoice_datetime as invoice_at, coalesce(si.net_amount, si.total_amount)::numeric as net, si.line_items_count as items,
           nullif(btrim(si.customer_code), '') as customer_code, si.customer_name,
           nullif(right(regexp_replace(coalesce(nullif(si.whatsapp_phone, ''), si.customer_phone, ''), '\D', '', 'g'), 10), '') as customer_phone
    from public.sales_invoices si
    join public.dawaa_review_sample_pool_v1() p on p.staff_id::text = si.staff_id
    where si.invoice_datetime >= v_from and si.invoice_datetime < v_to
      and si.invoice_type = case when p_kind = 'invoice' then 'كاش' else 'توصيل منزلى' end
      and coalesce(si.invoice_category, '') not like 'internal%'
      and coalesce(si.customer_type, '') <> 'internal_account'
      and coalesce(btrim(si.customer_code), '') not in ('5', '10', '20', '54', '170', '4902', '12820')
      and coalesce(si.net_amount, si.total_amount, 0) > 0
  ), cuts as (
    select branch, percentile_cont(0.4) within group (order by net) as p40, percentile_cont(0.8) within group (order by net) as p80
    from base group by branch
  )
  select b.invoice_id, b.staff_id, b.branch, b.invoice_number, b.invoice_at, b.net, b.items, b.customer_code, b.customer_name, b.customer_phone,
         case when coalesce(b.items, 0) >= 4 or b.net >= c.p80 then 'big'
              when coalesce(b.items, 1) <= 2 and b.net <= c.p40 then 'small'
              else 'medium' end,
         md5(b.invoice_id || '|' || p_batch_start::text)
  from base b join cuts c on c.branch is not distinct from b.branch
  where p_kind = 'invoice'
     or exists (select 1 from public.whatsapp_review_sources w
                where w.deleted_at is null
                  and ((b.customer_phone is not null and right(regexp_replace(coalesce(w.customer_phone, ''), 'D', '', 'g'), 10) = b.customer_phone)
                    or (b.customer_code is not null and btrim(coalesce(w.customer_code, '')) = b.customer_code))
                  and coalesce(w.conversation_ended_at, w.conversation_started_at, w.created_at) between b.invoice_at - interval '3 days' and b.invoice_at + interval '3 days');

  for v_seller in
    select c.staff_id, min(c.branch) as branch, count(distinct (c.invoice_at at time zone 'Africa/Cairo')::date) as days
    from review_candidates c group by c.staff_id
  loop
    v_slots := case
      when p_kind = 'conversation' then least(3, v_seller.days)
      when p_batch_end - p_batch_start >= 3 then case when v_seller.days >= 3 then 2 else 1 end
      else 1 end;
    for i in 1..v_slots loop
      -- The stratum this seller has least of in the cycle (small first, so small invoices are never skipped).
      select s.k into v_stratum
      from (values ('small', 1), ('big', 2), ('medium', 3)) as s(k, o)
      where exists (select 1 from review_candidates c where c.staff_id = v_seller.staff_id and c.stratum = s.k
                      and not exists (select 1 from public.evaluation_review_samples_v1 x where x.kind = p_kind and x.invoice_id = c.invoice_id))
      order by (select count(*) from public.evaluation_review_samples_v1 x
                where x.kind = p_kind and x.cycle_start = v_cycle and x.staff_id = v_seller.staff_id and x.stratum = s.k), s.o
      limit 1;
      exit when v_stratum is null;
      select c.* into v_pick
      from review_candidates c
      where c.staff_id = v_seller.staff_id and c.stratum = v_stratum
        and not exists (select 1 from public.evaluation_review_samples_v1 x where x.kind = p_kind and x.invoice_id = c.invoice_id)
      -- A customer already sampled for this seller in the cycle goes last.
      order by exists (select 1 from public.evaluation_review_samples_v1 x
                       where x.kind = p_kind and x.cycle_start = v_cycle and x.staff_id = v_seller.staff_id
                         and ((c.customer_code is not null and x.customer_code = c.customer_code)
                           or (c.customer_phone is not null and x.customer_phone = c.customer_phone))),
               c.rnd
      limit 1;
      exit when not found;
      insert into public.evaluation_review_samples_v1 (kind, batch_start, cycle_start, staff_id, branch, invoice_id, invoice_number,
        invoice_at, net, items, stratum, customer_code, customer_name, customer_phone, deadline)
      values (p_kind, p_batch_start, v_cycle, v_pick.staff_id, v_pick.branch, v_pick.invoice_id, v_pick.invoice_number,
        v_pick.invoice_at, v_pick.net, v_pick.items, v_pick.stratum, v_pick.customer_code, v_pick.customer_name, v_pick.customer_phone,
        case when p_kind = 'invoice' then (v_pick.invoice_at at time zone 'Africa/Cairo')::date + 4
             else (now() at time zone 'Africa/Cairo')::date + 7 end)
      on conflict (kind, invoice_id) do nothing;
      if found then v_added := v_added + 1; end if;
    end loop;
  end loop;

  update public.evaluation_review_batches_v1 set samples = v_added where kind = p_kind and batch_start = p_batch_start;
  return v_added;
end;
$function$;
