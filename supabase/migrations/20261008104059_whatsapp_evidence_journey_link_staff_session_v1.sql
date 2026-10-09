-- Evidence V17 journey/story link: staff-session command (Phase A successor to dawaa_link_whatsapp_evidence_journey_v17).
--
-- Root cause: the V17 link RPC started with `if auth.uid() is null then raise 'authentication required'`,
-- but Dawaa browser users authenticate through staff_account_login_v2 / staff_login_sessions, not
-- Supabase Auth, so auth.uid() is always null and the side projection never linked evidence.
-- Merely dropping that check would leave the RPC trusting dawaa_current_actor_can(), which resolves
-- the actor from the client-controlled x-dawaa-user-id request header. That is not authentication.
--
-- This command follows record_conversation_review_points_v1: the caller presents the opaque staff
-- session token; the server hashes it, requires a live (unrevoked, unexpired) session of an active,
-- login-enabled staff account, and derives every authorization decision from that account only.
-- No request header, auth.uid() or caller-supplied actor id participates.
--
-- Side projection: callers treat any error here as a warning; it never gates
-- Source -> V22 -> Sales Intelligence -> review_ready.
--
-- Cutover: Phase A (this file) only adds the session command; the legacy V17 RPC stays as-is for
-- deployment compatibility with the current Production bundle. No new caller may use it.
--
-- Idempotency: only journey_id/story_id are written, in place, and only when they differ. No evidence
-- fact or opportunity row is inserted or deleted, so repeated reanalysis converges, and reanalysing an
-- old source backfills its existing Evidence V17 rows onto the current journey/story.

create or replace function public.dawaa_link_whatsapp_evidence_journey_session_v1(
  p_session_token text,
  p_journey_id uuid,
  p_story_id uuid,
  p_source_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','extensions','pg_catalog'
as $function$
declare
  v_account public.staff_accounts%rowtype;
  v_role text;
  v_journey public.whatsapp_customer_journeys%rowtype;
  v_source_ids uuid[];
  v_facts integer := 0;
  v_opportunities integer := 0;
begin
  -- 1. Authenticate the opaque Dawaa staff session (never a request header or Supabase Auth).
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
    -- Fail closed: NULL in any account-state column denies (all four columns are nullable).
    and a.active is true
    and a.is_active is true
    and a.can_login is true
    and lower(btrim(coalesce(a.status,'')))='active'
  limit 1;

  if not found then
    raise exception 'invalid_or_expired_staff_session' using errcode='42501';
  end if;

  -- 2. Permission: same review/evidence permission set the V17 RPC required, evaluated for the
  --    session-bound account through the canonical permission resolver.
  v_role:=lower(btrim(coalesce(v_account.role,'')));
  if v_role not in ('general_manager','admin')
     and not public.dawaa_jsonb_has_true_any(
       coalesce(public.get_user_permissions(v_account.id),'{}'::jsonb),
       array['add_reviews','reviews.action.create','edit_reviews','approve_reviews','manage_conversation_evaluations']
     ) then
    raise exception 'not_authorized' using errcode='42501';
  end if;

  -- 3. Bounded, de-duplicated input.
  if p_journey_id is null then
    raise exception 'journey_required' using errcode='22023';
  end if;
  select coalesce(array_agg(distinct sid),'{}'::uuid[])
  into v_source_ids
  from unnest(coalesce(p_source_ids,'{}'::uuid[])) sid
  where sid is not null;
  if cardinality(v_source_ids)=0 then
    raise exception 'source_ids_required' using errcode='22023';
  end if;
  if cardinality(v_source_ids)>500 then
    raise exception 'too_many_source_ids' using errcode='22023';
  end if;

  -- 4. Journey/story integrity: every source must already be a session of this journey, and the
  --    story (when given) must be the journey's story. A valid session cannot re-point evidence
  --    onto an unrelated journey or story.
  select * into v_journey from public.whatsapp_customer_journeys where id=p_journey_id;
  if not found then
    raise exception 'journey_not_found' using errcode='P0002';
  end if;
  if exists (
    select 1 from unnest(v_source_ids) sid
    where not exists (
      select 1 from public.whatsapp_customer_journey_sessions js
      where js.journey_id=p_journey_id and js.source_id=sid
    )
  ) then
    raise exception 'journey_source_mismatch' using errcode='42501';
  end if;
  if p_story_id is not null and v_journey.story_id is distinct from p_story_id then
    raise exception 'story_journey_mismatch' using errcode='42501';
  end if;

  -- 5. Source/branch scope for the session-bound account on EVERY source (all-or-nothing).
  if exists (
    select 1 from unnest(v_source_ids) sid
    left join public.whatsapp_review_sources s on s.id=sid
    where s.id is null
       or not public.dawaa_can_read_conversation_review_row_v2(v_account.id,s.staff_id,null::uuid,s.branch,null::uuid)
  ) then
    raise exception 'source_access_denied' using errcode='42501';
  end if;

  -- 6. Idempotent in-place link. Rows already on this journey/story are not rewritten.
  update public.whatsapp_evidence_facts_v17 f
  set journey_id=p_journey_id,
      story_id=coalesce(p_story_id,f.story_id),
      updated_at=now()
  where f.source_id=any(v_source_ids)
    and (f.journey_id is distinct from p_journey_id
         or (p_story_id is not null and f.story_id is distinct from p_story_id));
  get diagnostics v_facts=row_count;

  update public.whatsapp_sales_opportunities_v17 o
  set journey_id=p_journey_id,
      story_id=coalesce(p_story_id,o.story_id),
      updated_at=now()
  where o.root_source_id=any(v_source_ids)
    and (o.journey_id is distinct from p_journey_id
         or (p_story_id is not null and o.story_id is distinct from p_story_id));
  get diagnostics v_opportunities=row_count;

  return jsonb_build_object(
    'journey_id',p_journey_id,
    'story_id',coalesce(p_story_id,v_journey.story_id),
    'source_count',cardinality(v_source_ids),
    'facts_linked',v_facts,
    'opportunities_linked',v_opportunities,
    'session_authorized',true
  );
end;
$function$;

-- Supabase default privileges grant new functions to anon/authenticated/service_role; reset
-- explicitly. anon/authenticated are required because the browser uses the anon key with the
-- custom staff session; the token check above is the authentication boundary.
revoke all on function public.dawaa_link_whatsapp_evidence_journey_session_v1(text,uuid,uuid,uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.dawaa_link_whatsapp_evidence_journey_session_v1(text,uuid,uuid,uuid[])
  to anon, authenticated;

comment on function public.dawaa_link_whatsapp_evidence_journey_session_v1(text,uuid,uuid,uuid[]) is
  'Staff-session-authenticated, journey-bound, source-scoped and idempotent Evidence V17 journey/story link. Side projection only.';

-- Phase A: the legacy dawaa_link_whatsapp_evidence_journey_v17 is intentionally NOT altered,
-- replaced, revoked or dropped here. Production (0b9bead) still calls it through the shared DB, so
-- its contract must stay byte-for-byte as today. Retirement is a separate Phase B cleanup migration,
-- created only after this application code is promoted and all deployed callers are re-audited.
