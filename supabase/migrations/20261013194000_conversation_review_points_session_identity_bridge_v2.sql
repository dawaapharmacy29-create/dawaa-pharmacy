-- Fix conversation review save completion for staff-session users.
-- record_conversation_review_points_v1 already verifies the opaque session token against
-- staff_login_sessions. After that verification, downstream canonical actor resolvers need the
-- server-owned account id in request.headers. Never trust a browser-supplied user id here.

create or replace function public.record_conversation_review_points_v1(
  p_session_token text,
  p_review_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_catalog'
as $function$
declare
  v_account public.staff_accounts%rowtype;
  v_review public.conversation_sales_reviews%rowtype;
  v_points numeric;
  v_status text;
  v_actor_role text;
  v_actor_branch text;
  v_is_global boolean;
  v_is_branch_manager boolean;
  v_result jsonb;
  v_recovered_staff_id uuid;
  v_recovered_count integer := 0;
begin
  if nullif(btrim(coalesce(p_session_token,'')),'') is null then
    raise exception 'staff_session_required' using errcode='42501';
  end if;

  select a.* into v_account
  from public.staff_login_sessions s
  join public.staff_accounts a on a.id=s.staff_account_id
  where s.token_hash=encode(extensions.digest(btrim(p_session_token),'sha256'),'hex')
    and s.revoked_at is null
    and s.expires_at>now()
    and coalesce(a.active,true)=true
    and coalesce(a.is_active,true)=true
    and coalesce(a.can_login,true)=true
    and coalesce(a.status,'active')='active'
  limit 1;

  if not found then
    raise exception 'invalid_or_expired_staff_session' using errcode='42501';
  end if;

  perform set_config(
    'request.headers',
    jsonb_build_object('x-dawaa-user-id',v_account.id::text)::text,
    true
  );
  if public.dawaa_current_staff_account_id_strict() is distinct from v_account.id then
    raise exception 'staff_session_identity_mismatch' using errcode='42501';
  end if;

  select * into v_review
  from public.conversation_sales_reviews
  where id=p_review_id
  for update;

  if not found then
    raise exception 'conversation_review_not_found' using errcode='P0002';
  end if;

  if v_review.reviewer_id is null
     or (v_review.reviewer_id::text is distinct from v_account.id::text
         and v_review.reviewer_id::text is distinct from coalesce(v_account.staff_id::text,'')) then
    raise exception 'review_author_session_mismatch' using errcode='42501';
  end if;

  if v_review.staff_id is null then
    select (array_agg(s.id order by s.id))[1], count(*)::integer
      into v_recovered_staff_id, v_recovered_count
    from public.staff s
    where coalesce(s.active,true)=true
      and coalesce(lower(btrim(s.status)),'active') not in ('inactive','archived','غير نشط')
      and btrim(coalesce(s.name,'')) = btrim(coalesce(v_review.staff_name, v_review.doctor_name, ''))
      and btrim(coalesce(s.branch,'')) = btrim(coalesce(v_review.branch,''));

    if v_recovered_count = 1 and v_recovered_staff_id is not null then
      update public.conversation_sales_reviews
      set staff_id = v_recovered_staff_id,
          doctor_id = coalesce(doctor_id, v_recovered_staff_id),
          updated_at = now()
      where id = v_review.id;

      v_review.staff_id := v_recovered_staff_id;
      v_review.doctor_id := coalesce(v_review.doctor_id, v_recovered_staff_id);
    else
      raise exception 'conversation_review_staff_missing' using errcode='23514';
    end if;
  end if;

  v_actor_role:=lower(btrim(coalesce(v_account.role,'')));
  v_actor_branch:=nullif(btrim(coalesce(v_account.branch,'')),'');
  v_is_global:=v_actor_role in ('general_manager','admin','executive_manager','branches_manager','manager','مدير عام','مدير تنفيذي','مديرة الفروع','مدير الفروع');
  v_is_branch_manager:=v_actor_role in ('branch_manager','customer_service_manager','مدير فرع','مديرة فرع','مسؤولة خدمة العملاء','مسؤول خدمة العملاء');

  if not v_is_global and not v_is_branch_manager then
    null;
  elsif v_is_branch_manager and not v_is_global
        and coalesce(btrim(v_review.branch),'') is distinct from coalesce(v_actor_branch,'') then
    raise exception 'not_authorized_for_branch' using errcode='42501';
  end if;

  v_points:=coalesce(v_review.doctor_points_impact,v_review.point_impact,0);
  if v_points=0 then
    return jsonb_build_object('review_id',v_review.id,'status','no_points','points_delta',0);
  end if;

  v_status:=case when lower(coalesce(v_review.impact_status,''))='approved' then 'approved' else 'pending' end;

  v_result:=public.record_employee_points_transaction_v4(
    v_review.staff_id,
    v_points,
    format('تقييم محادثة عميل - النتيجة %s/100',coalesce(v_review.final_score,v_review.total_score,0)),
    coalesce(nullif(btrim(coalesce(v_review.reviewer_notes,'')),''),nullif(btrim(coalesce(v_review.training_recommendation,'')),'')),
    'conversation_evaluation',
    v_review.id,
    null,
    v_review.month_cycle,
    v_review.branch,
    v_status,
    null,
    jsonb_build_object(
      'source_module','conversation_evaluation',
      'review_id',v_review.id,
      'reviewer_account_id',v_account.id,
      'session_command','record_conversation_review_points_v1',
      'staff_identity_recovered', v_recovered_count = 1,
      'session_identity_bridge','verified_account_id'
    ),
    false
  );

  update public.staff_login_sessions
  set last_used_at=now(),expires_at=now()+interval '12 hours'
  where staff_account_id=v_account.id
    and token_hash=encode(extensions.digest(btrim(p_session_token),'sha256'),'hex')
    and revoked_at is null;

  return coalesce(v_result,'{}'::jsonb)
    || jsonb_build_object(
      'review_id',v_review.id,
      'session_authorized',true,
      'staff_identity_recovered', v_recovered_count = 1
    );
end;
$function$;

revoke all on function public.record_conversation_review_points_v1(text,uuid) from public;
grant execute on function public.record_conversation_review_points_v1(text,uuid) to anon,authenticated;
