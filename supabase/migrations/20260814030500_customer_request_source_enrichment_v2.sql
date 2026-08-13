create or replace function public.customer_request_autolink_dawaawael_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_branch text;
  v_customer_id text;
  v_manager_id uuid;
  v_manager_name text;
  v_raw_type text;
  v_requested_at timestamptz;
begin
  if coalesce(new.source_system,'') <> 'dawaawael' then
    return new;
  end if;

  -- Preserve richer fields carried by Base44 instead of flattening them during ingest.
  if new.source_payload is not null then
    if coalesce((new.source_payload->>'quantity')::numeric, 0) > 0 then
      new.quantity := (new.source_payload->>'quantity')::numeric;
    elsif new.quantity is null or new.quantity <= 0 then
      new.quantity := 1;
    end if;

    begin
      v_requested_at := nullif(new.source_payload->>'requested_at','')::timestamptz;
    exception when others then
      v_requested_at := null;
    end;
    if v_requested_at is null then
      begin
        v_requested_at := nullif(new.source_payload->>'created_date','')::timestamptz;
      exception when others then
        v_requested_at := null;
      end;
    end if;
    if v_requested_at is not null then
      new.requested_at := v_requested_at;
    end if;

    v_raw_type := public.dawaa_sync_norm_text(new.source_payload->>'request_type');
    if v_raw_type = 'نواقص' then new.request_type := 'shortage';
    elsif v_raw_type = 'استفسار' then new.request_type := 'inquiry';
    elsif v_raw_type = 'عادي' then new.request_type := 'normal';
    end if;

    new.created_by_name := coalesce(
      nullif(btrim(new.created_by_name),''),
      nullif(btrim(new.source_payload->>'recorded_by'),''),
      nullif(btrim(new.source_payload #>> '{timeline,0,by}'),'')
    );
  end if;

  v_branch := nullif(btrim(new.branch),'');

  if v_branch is null and nullif(btrim(coalesce(new.customer_id,'')),'') is not null then
    select coalesce(nullif(c.effective_branch,''),nullif(c.corrected_branch,''),nullif(c.branch,''),nullif(c.branch_name,''))
      into v_branch
    from public.customers c
    where c.id::text = btrim(new.customer_id)
    limit 1;
  end if;

  if v_branch is null and nullif(btrim(coalesce(new.customer_code,'')),'') is not null
     and btrim(new.customer_code) not in ('0','00') then
    select min(x.branch_value)
      into v_branch
    from (
      select distinct coalesce(nullif(c.effective_branch,''),nullif(c.corrected_branch,''),nullif(c.branch,''),nullif(c.branch_name,'')) as branch_value
      from public.customers c
      where btrim(coalesce(c.effective_customer_code,c.customer_code,c.code,'')) = btrim(new.customer_code)
    ) x
    where x.branch_value is not null
    having count(*) = 1;
  end if;

  if v_branch is null and nullif(btrim(coalesce(new.customer_phone,'')),'') is not null
     and length(regexp_replace(new.customer_phone,'\D','','g')) >= 10 then
    select min(x.branch_value)
      into v_branch
    from (
      select distinct coalesce(nullif(c.effective_branch,''),nullif(c.corrected_branch,''),nullif(c.branch,''),nullif(c.branch_name,'')) as branch_value
      from public.customers c
      where public.dawaa_sync_norm_phone(coalesce(c.customer_phone,c.phone,c.mobile,c.whatsapp_phone,c.whatsapp)) = public.dawaa_sync_norm_phone(new.customer_phone)
    ) x
    where x.branch_value is not null
    having count(*) = 1;
  end if;

  if v_branch in ('فرع الشامي','فرع شكري') then
    new.branch := v_branch;
  end if;

  -- Link customer only when the match is unambiguous. Same-branch matching safely resolves
  -- duplicated phone numbers that exist across historical customer rows.
  if nullif(btrim(coalesce(new.customer_id,'')),'') is null then
    if nullif(btrim(coalesce(new.customer_code,'')),'') is not null and btrim(new.customer_code) not in ('0','00') then
      select min(c.id::text)
        into v_customer_id
      from public.customers c
      where btrim(coalesce(c.effective_customer_code,c.customer_code,c.code,'')) = btrim(new.customer_code)
        and (new.branch is null or coalesce(nullif(c.effective_branch,''),nullif(c.corrected_branch,''),nullif(c.branch,''),nullif(c.branch_name,'')) = new.branch)
      having count(*) = 1;
    end if;

    if v_customer_id is null and nullif(btrim(coalesce(new.customer_phone,'')),'') is not null
       and length(regexp_replace(new.customer_phone,'\D','','g')) >= 10 then
      select min(c.id::text)
        into v_customer_id
      from public.customers c
      where public.dawaa_sync_norm_phone(coalesce(c.customer_phone,c.phone,c.mobile,c.whatsapp_phone,c.whatsapp)) = public.dawaa_sync_norm_phone(new.customer_phone)
        and (new.branch is null or coalesce(nullif(c.effective_branch,''),nullif(c.corrected_branch,''),nullif(c.branch,''),nullif(c.branch_name,'')) = new.branch)
      having count(*) = 1;
    end if;

    if v_customer_id is not null then
      new.customer_id := v_customer_id;
    end if;
  end if;

  if new.primary_responsible_id is null and new.branch in ('فرع الشامي','فرع شكري') then
    select sa.staff_id::uuid,
           coalesce(nullif(sa.staff_name,''),nullif(sa.name,''),sa.username)
      into v_manager_id, v_manager_name
    from public.staff_accounts sa
    where coalesce(sa.active,false)=true
      and coalesce(sa.can_login,false)=true
      and sa.branch = new.branch
      and sa.staff_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and (
        sa.role='branch_manager'
        or sa.role='مدير فرع'
        or coalesce(sa.role_label,'') ilike '%مدير فرع%'
        or coalesce(sa.job_title,'') ilike '%مدير فرع%'
      )
    order by case when sa.role='branch_manager' then 0 else 1 end,
             sa.updated_at desc nulls last
    limit 1;

    if v_manager_id is not null then
      new.primary_responsible_id := v_manager_id;
      new.primary_responsible_name := v_manager_name;
      new.primary_responsible_role := 'مدير الفرع';
    end if;
  end if;

  return new;
end;
$$;

-- Re-run the trigger on existing synced rows without altering business workflow state.
update public.customer_requests
set source_payload = source_payload
where source_system='dawaawael'
  and source_entity='CustomerOrder'
  and (
    customer_id is null
    or requested_at is null
    or created_by_name is null
    or coalesce(quantity,0) <= 1
  );
