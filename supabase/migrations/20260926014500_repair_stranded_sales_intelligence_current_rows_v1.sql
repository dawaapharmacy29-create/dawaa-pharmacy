-- Repair one historical pre-atomic-writer case that was superseded without a replacement.
-- The current sales_intelligence_write_case_analysis RPC inserts the replacement first and is safe.
-- This migration only reactivates rows when the case has exactly one historical analysis and no current analysis.

do $$
declare
  v_case_id text := '9a59338b-f1ca-4b68-bd3b-c081fee914a8:interaction:1';
  v_analysis_id uuid;
  v_analysis_count integer;
  v_current_count integer;
begin
  select count(*), count(*) filter (where is_current)
    into v_analysis_count, v_current_count
  from public.sales_intelligence_case_analyses
  where case_id = v_case_id;

  if v_analysis_count = 1 and v_current_count = 0 then
    select analysis_id into v_analysis_id
    from public.sales_intelligence_case_analyses
    where case_id = v_case_id
    limit 1;

    update public.sales_intelligence_case_analyses
    set is_current = true,
        superseded_at = null,
        superseded_by_analysis_id = null
    where analysis_id = v_analysis_id;

    update public.sales_intelligence_attributions
    set is_current_evaluation = true,
        superseded_at = null,
        superseded_by_evaluation_version = null
    where analysis_id = v_analysis_id
      and evaluation_version = (
        select max(evaluation_version)
        from public.sales_intelligence_attributions
        where analysis_id = v_analysis_id
      );

    update public.sales_intelligence_basket_invoice_matches
    set is_current_evaluation = true,
        superseded_at = null,
        superseded_by_evaluation_version = null
    where analysis_id = v_analysis_id
      and evaluation_version = (
        select max(evaluation_version)
        from public.sales_intelligence_basket_invoice_matches
        where analysis_id = v_analysis_id
      );
  end if;
end;
$$;

-- Fail the migration if any case is still stranded. This turns the invariant into a merge-time gate.
do $$
begin
  if exists (
    select 1
    from public.sales_intelligence_cases c
    left join public.sales_intelligence_current_case_analyses a on a.case_id = c.case_id
    where a.analysis_id is null
  ) then
    raise exception 'sales_intelligence_case_without_current_analysis';
  end if;

  if exists (
    select 1
    from public.sales_intelligence_current_case_analyses a
    left join public.sales_intelligence_current_attributions t on t.case_id = a.case_id
    where t.id is null
  ) then
    raise exception 'sales_intelligence_current_analysis_without_current_attribution';
  end if;
end;
$$;
