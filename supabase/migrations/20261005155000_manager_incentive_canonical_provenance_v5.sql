-- Manager incentive settlement must consume only canonical server-validated final evaluations.
create or replace function public.dawaa_manager_evaluation_is_canonical_v5(p_eval public.manager_weekly_evaluations)
returns boolean
language sql stable security invoker
set search_path='public','pg_catalog'
as $function$
  select p_eval.status='submitted'
     and coalesce(p_eval.auto_metrics->>'__server_validated_at','')<>''
     and jsonb_typeof(coalesce(p_eval.auto_metrics->'__criterion_system_scores','{}'::jsonb))='object'
     and jsonb_typeof(coalesce(p_eval.auto_metrics->'__criterion_combined_scores','{}'::jsonb))='object'
     and coalesce((p_eval.auto_metrics->>'__system_performance_weight')::numeric,-1)=0.8
     and coalesce((p_eval.auto_metrics->>'__manager_judgment_weight')::numeric,-1)=0.2
     and abs(
       p_eval.total_score -
       round((
         (p_eval.auto_metrics->>'__objective_score')::numeric*0.8+
         (p_eval.auto_metrics->>'__manager_judgment_score')::numeric*0.2
       )::numeric,1)
     )<=0.001;
$function$;

revoke all on function public.dawaa_manager_evaluation_is_canonical_v5(public.manager_weekly_evaluations) from public,anon,authenticated;
grant execute on function public.dawaa_manager_evaluation_is_canonical_v5(public.manager_weekly_evaluations) to service_role;

-- Settlement functions are privileged financial commands, never browser RPCs.
revoke all on function public.settle_manager_evaluation_incentive() from public,anon,authenticated;
grant execute on function public.settle_manager_evaluation_incentive() to service_role;

comment on function public.dawaa_manager_evaluation_is_canonical_v5(public.manager_weekly_evaluations)
is 'Canonical provenance predicate for server-built manager evaluation snapshots. Financial consumers must require it.';

notify pgrst,'reload schema';
