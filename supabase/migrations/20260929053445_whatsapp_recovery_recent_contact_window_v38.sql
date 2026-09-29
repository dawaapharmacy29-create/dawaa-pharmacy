-- Recovery attribution window V38.
-- A customer is considered recovered only when a Canonical sale occurs after a real
-- recovery/contact event within the previous 45 days. This avoids both premature
-- recovery and permanently-expired recovery windows on long-running stories.

create or replace function public.dawaa_capture_whatsapp_canonical_purchase_v36()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_story public.whatsapp_customer_stories%rowtype;
  v_invoice_at timestamptz;
  v_invoice_number text;
  v_invoice_value numeric;
  v_journey_id uuid;
  v_effective_outcome text;
  v_is_canonical boolean;
begin
  v_effective_outcome := coalesce(new.confirmed_outcome,new.proposed_outcome);
  v_is_canonical :=
    new.confirmed_outcome='verified_sale'
    or coalesce(new.case_json #>> '{canonicalSaleProof,state}','')='proven';

  if v_effective_outcome<>'verified_sale'
     or new.verified_invoice_id is null
     or not v_is_canonical
  then
    return new;
  end if;

  if new.story_id is not null then
    select * into v_story
    from public.whatsapp_customer_stories s
    where s.id=new.story_id
    limit 1;
  end if;

  if v_story.id is null then
    select * into v_story
    from public.whatsapp_customer_stories s
    where
      (new.customer_id is not null and s.customer_id=new.customer_id)
      or (
        new.customer_code is not null
        and nullif(trim(new.customer_code),'') is not null
        and s.customer_code=new.customer_code
        and public.dawaa_customer_request_branch_key(s.branch)=public.dawaa_customer_request_branch_key(new.branch)
      )
      or (
        new.customer_phone is not null
        and nullif(regexp_replace(new.customer_phone,'\D','','g'),'') is not null
        and regexp_replace(coalesce(s.customer_phone,''),'\D','','g')=regexp_replace(new.customer_phone,'\D','','g')
        and public.dawaa_customer_request_branch_key(s.branch)=public.dawaa_customer_request_branch_key(new.branch)
      )
    order by
      case when new.customer_id is not null and s.customer_id=new.customer_id then 1
           when new.customer_code is not null and s.customer_code=new.customer_code then 2
           else 3 end,
      s.created_at asc
    limit 1;
  end if;

  if v_story.id is null then return new; end if;

  select
    coalesce(new.verified_sale_at,si.invoice_datetime,new.last_event_at,now()),
    coalesce(new.verified_invoice_number,nullif(trim(si.invoice_number),'')),
    coalesce(new.verified_revenue,si.net_amount,si.total_amount,si.amount,0)
  into v_invoice_at,v_invoice_number,v_invoice_value
  from public.sales_invoices si
  where si.id=new.verified_invoice_id::text
  limit 1;

  v_invoice_at := coalesce(v_invoice_at,new.verified_sale_at,new.last_event_at,now());
  v_invoice_number := coalesce(v_invoice_number,new.verified_invoice_number);
  v_invoice_value := coalesce(v_invoice_value,new.verified_revenue,0);

  select j.id into v_journey_id
  from public.whatsapp_customer_journeys j
  where j.story_id=v_story.id
    and j.journey_started_at<=v_invoice_at
  order by j.journey_started_at desc nulls last
  limit 1;

  insert into public.whatsapp_customer_story_events(
    story_id,event_key,event_type,event_at,journey_id,source_id,
    invoice_id,invoice_number,invoice_value,confidence,title,detail,payload
  )
  values(
    v_story.id,
    'canonical-verified-invoice:'||new.verified_invoice_id::text,
    'verified_purchase',
    v_invoice_at,
    coalesce(new.journey_id,v_journey_id),
    new.root_source_id,
    new.verified_invoice_id::text,
    v_invoice_number,
    v_invoice_value,
    100,
    'شراء مثبت Canonical',
    'تم إثبات الشراء من Customer Case بعد وصول Sale Proof Canonical إلى verified_sale.',
    jsonb_build_object(
      'proofSource','whatsapp_customer_cases_v22',
      'caseId',new.id,
      'canonicalSaleProofState',coalesce(
        new.case_json #>> '{canonicalSaleProof,state}',
        case when new.confirmed_outcome='verified_sale' then 'human_confirmed' else null end
      )
    )
  )
  on conflict(story_id,event_key) do update set
    event_at=excluded.event_at,
    journey_id=excluded.journey_id,
    source_id=excluded.source_id,
    invoice_number=excluded.invoice_number,
    invoice_value=excluded.invoice_value,
    confidence=excluded.confidence,
    title=excluded.title,
    detail=excluded.detail,
    payload=excluded.payload;

  update public.whatsapp_customer_stories s
  set
    last_verified_purchase_value=case
      when s.last_verified_purchase_at is null or v_invoice_at>=s.last_verified_purchase_at then v_invoice_value
      else s.last_verified_purchase_value
    end,
    last_verified_purchase_at=greatest(coalesce(s.last_verified_purchase_at,'epoch'::timestamptz),v_invoice_at),
    last_activity_at=greatest(coalesce(s.last_activity_at,'epoch'::timestamptz),v_invoice_at),
    updated_at=now()
  where s.id=v_story.id
  returning * into v_story;

  if v_story.status='recovery'
     and v_story.recovery_started_at is not null
     and v_invoice_at>=v_story.recovery_started_at
     and exists (
       select 1
       from public.whatsapp_customer_story_events e
       where e.story_id=v_story.id
         and e.event_type in ('recovery_attempt','apology_recovery','service_followup','complaint_followup')
         and e.event_at<=v_invoice_at
         and e.event_at>=v_invoice_at-interval '45 days'
     )
  then
    update public.whatsapp_customer_stories
    set
      status='recovered',
      recovered_at=v_invoice_at,
      recovered_invoice_id=new.verified_invoice_id::text,
      recovered_invoice_number=v_invoice_number,
      recovered_invoice_value=v_invoice_value,
      updated_at=now()
    where id=v_story.id;

    if coalesce(new.journey_id,v_journey_id) is not null then
      update public.whatsapp_customer_journeys
      set
        lifecycle_status='recovered',
        recovered_at=v_invoice_at,
        recovered_invoice_id=new.verified_invoice_id::text,
        recovered_invoice_number=v_invoice_number,
        recovered_invoice_value=v_invoice_value,
        updated_at=now()
      where id=coalesce(new.journey_id,v_journey_id);
    end if;

    update public.whatsapp_conversation_actions a
    set
      work_status='completed',
      completed_at=coalesce(a.completed_at,v_invoice_at),
      outcome='sold',
      outcome_note=case when nullif(a.outcome_note,'') is not null then a.outcome_note||E'\n' else '' end
        || 'تم تأكيد عودة العميل للشراء من خلال Sale Proof Canonical على Customer Case.',
      recovered_invoice_id=new.verified_invoice_id::text,
      recovered_invoice_number=v_invoice_number,
      recovered_invoice_value=v_invoice_value,
      recovered_at=v_invoice_at,
      updated_at=now()
    where a.work_status not in ('completed','cancelled','failed')
      and a.action_type in ('customer_followup','complaint_followup')
      and (
        a.action_key in ('customer-followup','complaint-followup')
        or a.action_key like 'recovery:%'
        or a.action_key like 'case-rescue:%'
      )
      and (
        (v_story.customer_id is not null and a.customer_id=v_story.customer_id)
        or (
          v_story.customer_code is not null
          and a.customer_code=v_story.customer_code
          and public.dawaa_customer_request_branch_key(a.branch)=public.dawaa_customer_request_branch_key(v_story.branch)
        )
        or (
          v_story.customer_phone is not null
          and regexp_replace(coalesce(a.customer_phone,''),'\D','','g')=regexp_replace(v_story.customer_phone,'\D','','g')
          and public.dawaa_customer_request_branch_key(a.branch)=public.dawaa_customer_request_branch_key(v_story.branch)
        )
      )
      and coalesce(a.created_at,a.due_at,now())>=v_story.recovery_started_at;

    insert into public.whatsapp_customer_story_events(
      story_id,event_key,event_type,event_at,journey_id,source_id,
      invoice_id,invoice_number,invoice_value,confidence,title,detail,payload
    )
    values(
      v_story.id,
      'canonical-recovered:'||new.verified_invoice_id::text,
      'customer_recovered',
      v_invoice_at,
      coalesce(new.journey_id,v_journey_id),
      new.root_source_id,
      new.verified_invoice_id::text,
      v_invoice_number,
      v_invoice_value,
      100,
      'تم استرجاع العميل — Canonical',
      'عاد العميل لشراء مثبت Canonical بعد محاولة متابعة فعلية خلال آخر 45 يومًا. الربط تشغيلي ولا يثبت وحده أن المتابعة هي سبب الشراء.',
      jsonb_build_object(
        'proofSource','whatsapp_customer_cases_v22',
        'caseId',new.id,
        'recoveryWindowRule','recent_recovery_event_within_45_days'
      )
    )
    on conflict(story_id,event_key) do update set
      event_at=excluded.event_at,
      journey_id=excluded.journey_id,
      source_id=excluded.source_id,
      invoice_number=excluded.invoice_number,
      invoice_value=excluded.invoice_value,
      confidence=excluded.confidence,
      title=excluded.title,
      detail=excluded.detail,
      payload=excluded.payload;
  end if;

  perform public.dawaa_refresh_whatsapp_customer_story_v16(v_story.id);
  return new;
end
$$;

revoke all on function public.dawaa_capture_whatsapp_canonical_purchase_v36() from public,anon,authenticated;
grant execute on function public.dawaa_capture_whatsapp_canonical_purchase_v36() to service_role;
