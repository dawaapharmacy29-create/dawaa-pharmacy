-- Sales Intelligence current basket/invoice-match read boundary v1
--
-- Keep historical child evaluations intact for audit, but never expose a child
-- evaluation belonging to a superseded case analysis through normal client reads.
-- `is_current_evaluation` is scoped to one analysis_id; it is not a global
-- "current case" marker. The parent case-analysis state is therefore part of
-- the canonical read contract.

create or replace view public.sales_intelligence_current_basket_invoice_matches
with (security_invoker = true)
as
select b.*
from public.sales_intelligence_basket_invoice_matches b
join public.sales_intelligence_case_analyses ca
  on ca.analysis_id = b.analysis_id
 and ca.is_current = true
join public.sales_intelligence_cases c
  on c.case_id = b.case_id
join public.whatsapp_review_sources s
  on s.id = c.conversation_id
where b.is_current_evaluation = true
  and c.source_case_id_v22 is not null
  and coalesce(s.review_status, '') <> 'archived';

grant select on public.sales_intelligence_current_basket_invoice_matches to anon, authenticated, service_role;

-- The raw table is still retained as immutable history, and SECURITY DEFINER
-- persistence RPCs can continue to supersede/re-evaluate rows within an exact
-- analysis_id. Client SELECTs, however, must never treat a child row from a
-- superseded analysis as current truth.
drop policy if exists sales_intelligence_bim_select_v1
  on public.sales_intelligence_basket_invoice_matches;

create policy sales_intelligence_bim_select_v1
on public.sales_intelligence_basket_invoice_matches
for select
to public
using (
  exists (
    select 1
    from public.sales_intelligence_case_analyses current_analysis
    where current_analysis.analysis_id = sales_intelligence_basket_invoice_matches.analysis_id
      and current_analysis.is_current = true
  )
  and (
    (select public.dawaa_actor_is_top_management_v1())
    or exists (
      select 1
      from public.staff_accounts me
      join public.sales_intelligence_cases c
        on c.case_id = sales_intelligence_basket_invoice_matches.case_id
      where me.id = (select public.dawaa_current_staff_account_id_strict())
        and coalesce(me.active, false)
        and coalesce(me.can_login, false)
        and (
          lower(trim(coalesce(me.role, ''))) in ('team_dawaa_alpha', 'customer_service_manager')
          or (
            lower(trim(coalesce(me.role, ''))) in (
              'branch_manager',
              'customer_service',
              'shift_supervisor_morning',
              'shift_supervisor_evening'
            )
            and public.dawaa_customer_request_branch_key(me.branch) is not null
            and public.dawaa_customer_request_branch_key(me.branch)
                = public.dawaa_customer_request_branch_key(c.branch_name_raw)
          )
        )
    )
  )
);

comment on view public.sales_intelligence_current_basket_invoice_matches is
  'Canonical current basket/invoice-match read surface: current child evaluation + current parent analysis + active canonical review source.';
