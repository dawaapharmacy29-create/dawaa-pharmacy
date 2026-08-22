create or replace function public.get_customer_followup_records_v1(
  p_actor_id text,
  p_branch text default 'كل الفروع',
  p_mode text default 'completed',
  p_search text default null,
  p_from date default null,
  p_to date default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_actor record;
  v_branch text;
  v_limit integer := greatest(1, least(coalesce(p_limit,50), 200));
  v_offset integer := greatest(0, coalesce(p_offset,0));
  v_mode text := lower(coalesce(nullif(btrim(p_mode),''),'completed'));
  v_search text := nullif(btrim(coalesce(p_search,'')),'');
  v_rows jsonb;
  v_total bigint;
begin
  select a.id,a.staff_id,lower(coalesce(a.role,'')) role,coalesce(a.branch,'') branch
    into v_actor
  from public.staff_accounts a
  where (a.id::text=p_actor_id or a.staff_id::text=p_actor_id or lower(a.username)=lower(p_actor_id))
    and coalesce(a.active,false)=true and coalesce(a.can_login,false)=true
  order by case when a.id::text=p_actor_id then 0 when a.staff_id::text=p_actor_id then 1 else 2 end
  limit 1;
  if not found then raise exception 'unauthorized'; end if;

  if v_mode not in ('exceptional','waiting','no_answer','completed','performance') then raise exception 'invalid mode'; end if;
  if p_from is not null and p_to is not null and p_from>p_to then raise exception 'invalid date range'; end if;
  if p_from is not null and p_to is not null and p_to-p_from>366 then raise exception 'date range too large'; end if;

  v_branch:=coalesce(nullif(btrim(p_branch),''),'كل الفروع');
  if v_actor.role not in ('general_manager','branches_manager','executive_manager') then
    v_branch:=case when v_actor.branch in ('فرع الشامي','فرع شكري') then v_actor.branch else v_branch end;
  end if;
  if v_branch not in ('كل الفروع','فرع الشامي','فرع شكري') then raise exception 'invalid branch'; end if;

  with base as materialized (
    select d.*,
      lower(concat_ws(' ',d.followup_status,d.status,d.contact_status,d.response_status,d.followup_result,d.contact_result)) as combined_status,
      coalesce(d.completed_at,d.closed_at,d.updated_at,d.created_at) as effective_completed_at,
      lower(concat_ws(' ',d.request_type,d.request_source,d.followup_reason,d.notes)) as request_text,
      (d.needs_next_followup is true and d.next_followup_date is not null) as has_next
    from public.daily_followups d
    where (v_branch='كل الفروع' or d.branch=v_branch)
      and (p_from is null or coalesce(d.completed_at,d.closed_at,d.updated_at,d.created_at)::date >= p_from)
      and (p_to is null or coalesce(d.completed_at,d.closed_at,d.updated_at,d.created_at)::date <= p_to)
      and (
        v_search is null
        or coalesce(d.customer_name,d.name,'') ilike '%'||v_search||'%'
        or coalesce(d.customer_code,'') ilike '%'||v_search||'%'
        or coalesce(d.customer_phone,d.phone,'') ilike '%'||v_search||'%'
      )
  ), classified as materialized (
    select b.*,
      (b.combined_status ~ '(cancel|cancelled|archived|ملغي|ملغاة|مؤرشف|الأرشيف)') as is_cancelled,
      (
        not (b.combined_status ~ '(cancel|cancelled|archived|ملغي|ملغاة|مؤرشف|الأرشيف)')
        and not b.has_next
        and (
          b.completed_at is not null or b.closed_at is not null
          or b.combined_status ~ '(completed|closed|resolved|مكتمل|تم الشراء|تم الحل|تم التنفيذ|تم الرد|رد العميل|replied|customer_replied)'
        )
      ) as is_completed
    from base b
  ), scoped as materialized (
    select c.* from classified c
    where case v_mode
      when 'exceptional' then c.request_text ~ '(exceptional_followup|متابعة استثنائية)' and not c.is_completed and not c.is_cancelled
      when 'waiting' then not c.is_completed and not c.is_cancelled and c.combined_status ~ '(waiting|awaiting|sent|message_sent|انتظار الرد|في انتظار|تم الإرسال|تم ارسال|بعتنا|أرسلنا)'
      when 'no_answer' then not c.is_completed and not c.is_cancelled and c.combined_status ~ '(no.?answer|unreachable|لم يرد|لا يرد|مغلق|غير متاح)'
      when 'completed' then c.is_completed and coalesce(c.import_source,'') <> 'historical_excel_import'
      when 'performance' then c.is_completed
      else false end
  ), counted as (select count(*)::bigint total from scoped),
  paged as (
    select s.* from scoped s
    order by s.created_at desc nulls last,s.id
    limit v_limit offset v_offset
  )
  select
    coalesce(jsonb_agg(to_jsonb(p) - 'combined_status' - 'effective_completed_at' - 'request_text' - 'has_next' - 'is_cancelled' - 'is_completed' order by p.created_at desc nulls last,p.id),'[]'::jsonb),
    (select total from counted)
  into v_rows,v_total
  from paged p;

  return jsonb_build_object('branch',v_branch,'mode',v_mode,'total',coalesce(v_total,0),'limit',v_limit,'offset',v_offset,'rows',coalesce(v_rows,'[]'::jsonb));
end;
$function$;

grant execute on function public.get_customer_followup_records_v1(text,text,text,text,date,date,integer,integer) to authenticated;
