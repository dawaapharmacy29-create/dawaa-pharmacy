-- Verify new SHA-256 final snapshots at read time.
-- Legacy MD5 snapshots remain readable and are explicitly marked legacy_unverified.
create or replace function public.dawaa_verify_monthly_evaluation_snapshot_v5(
  p_metrics jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path='public','pg_catalog','extensions'
as $function$
declare
  v_snapshot jsonb := p_metrics->'final_approval_snapshot';
  v_hash text := nullif(p_metrics->>'final_approval_hash','');
  v_alg text := lower(coalesce(nullif(p_metrics->>'final_approval_hash_algorithm',''),'legacy'));
  v_actual text;
begin
  if v_snapshot is null or v_hash is null then
    return jsonb_build_object('status','missing','verified',false);
  end if;
  if v_alg <> 'sha256' then
    return jsonb_build_object('status','legacy_unverified','verified',false,'algorithm',v_alg);
  end if;
  v_actual := encode(extensions.digest(convert_to(v_snapshot::text,'UTF8'),'sha256'::text),'hex');
  return jsonb_build_object(
    'status',case when v_actual=v_hash then 'verified' else 'mismatch' end,
    'verified',v_actual=v_hash,
    'algorithm','sha256'
  );
end;
$function$;

revoke all on function public.dawaa_verify_monthly_evaluation_snapshot_v5(jsonb)
  from public,anon,authenticated;
grant execute on function public.dawaa_verify_monthly_evaluation_snapshot_v5(jsonb) to service_role;

comment on function public.dawaa_verify_monthly_evaluation_snapshot_v5(jsonb)
is 'Recomputes the SHA-256 hash for V5 final evaluation snapshots; legacy hashes are readable but never falsely reported as verified.';

notify pgrst,'reload schema';
