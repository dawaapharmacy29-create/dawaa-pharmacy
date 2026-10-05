-- Secure conversation-review points bridge for the custom Dawaa staff session.
-- Browser users authenticate with staff_account_login_v2, not Supabase Auth, so direct
-- EXECUTE on record_employee_points_transaction_v4 correctly remains unavailable to anon.
-- This command validates the opaque staff session, binds it to the saved review author,
-- derives the points from the saved review, and then enters the canonical V4 boundary.
-- V3's semantic-event unique key keeps retries idempotent for the same review.

create or replace function public.record_conversation_review_points_v1(
  p_session_token text,
  p_review_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','extensions','pg_catalog'
as $function$
declare
  v_account public.staff_accounts%rowtype;
  v_review public.conversation_sales_reviews%rowtype;
  v_points numeric;
  v_status text;
  v_result jsonb;
begin
  if nullif(btrim(coalesce(p_session_token,'')),'') is null then
    raise exception 'staff_session_required' using errcode='42501';
  end if;

  select a.*
  into v_account
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

  select *
  into v_review
  from public.conversation_sales_reviews
  where id=p_review_id
  for update;

  if not found then
    raise exception 'conversation_review_not_found' using errcode='P0002';
  end if;

  -- The review payload may identify either the staff account UUID or the linked staff UUID,
  -- depending on which reviewer selector path created it. Accept only those two server-known
  -- identities; never trust a caller-supplied actor id.
  if v_review.reviewer_id is null
     or (
       v_review.reviewer_id::text is distinct from v_account.id::text
       and v_review.reviewer_id::text is distinct from coalesce(v_account.staff_id::text,'')
     ) then
    raise exception 'review_author_session_mismatch' using errcode='42501';
  end if;

  if v_review.staff_id is null then
    raise exception 'conversation_review_staff_missing' using errcode='23514';
  end if;

  v_points:=coalesce(v_review.doctor_points_impact,v_review.point_impact,0);
  if v_points=0 then
    return jsonb_build_object(
      'review_id',v_review.id,
      'status','no_points',
      'points_delta',0
    );
  end if;

  v_status:=case
    when lower(coalesce(v_review.impact_status,''))='approved' then 'approved'
    else 'pending'
  end;

  -- V3 resolves the operating actor from request.headers. Bind that context only
  -- after the opaque server-side session has been validated.
  perform set_config(
    'request.headers',
    jsonb_build_object('x-dawaa-user-id',v_account.id::text)::text,
    true
  );

  v_result:=public.record_employee_points_transaction_v4(
    v_review.staff_id,
    v_points,
    format('تقييم محادثة عميل - النتيجة %s/100',coalesce(v_review.final_score,v_review.total_score,0)),
    coalesce(
      nullif(btrim(coalesce(v_review.reviewer_notes,'')),''),
      nullif(btrim(coalesce(v_review.training_recommendation,'')),'')
    ),
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
      'session_command','record_conversation_review_points_v1'
    ),
    false
  );

  update public.staff_login_sessions
  set last_used_at=now(),
      expires_at=now()+interval '12 hours'
  where staff_account_id=v_account.id
    and token_hash=encode(extensions.digest(btrim(p_session_token),'sha256'),'hex')
    and revoked_at is null;

  return coalesce(v_result,'{}'::jsonb)||jsonb_build_object(
    'review_id',v_review.id,
    'session_authorized',true
  );
end;
$function$;

revoke all on function public.record_conversation_review_points_v1(text,uuid) from public;
grant execute on function public.record_conversation_review_points_v1(text,uuid) to anon,authenticated;

comment on function public.record_conversation_review_points_v1(text,uuid) is
  'Staff-session-aware, review-bound and idempotent bridge into canonical points V4. Points are derived from the saved conversation review; browser input cannot choose the amount.';
