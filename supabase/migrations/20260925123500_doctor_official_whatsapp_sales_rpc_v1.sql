-- Self-scoped doctor metric for official WhatsApp-attributed sales.
-- Never accepts a staff id from the client: identity comes from the current Dawaa actor.

create or replace function public.get_my_official_whatsapp_sales_v1(
  p_start date,
  p_end date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_id text;
  v_result jsonb;
begin
  v_staff_id := public.dawaa_current_staff_id_v1();

  if nullif(trim(v_staff_id), '') is null then
    raise exception 'staff_identity_required';
  end if;

  if p_start is null or p_end is null or p_end < p_start then
    raise exception 'invalid_date_range';
  end if;

  select jsonb_build_object(
    'sales_count', count(*)::integer,
    'revenue', coalesce(sum(coalesce(t.invoice_amount, 0)), 0),
    'item_evidence_count', count(*) filter (where t.item_evidence_available)::integer,
    'staff_id', v_staff_id
  )
  into v_result
  from public.sales_intelligence_invoice_staff_truth_v1 t
  where t.canonical_staff_id::text = v_staff_id
    and (t.invoice_datetime at time zone 'Africa/Cairo')::date between p_start and p_end;

  return coalesce(
    v_result,
    jsonb_build_object(
      'sales_count', 0,
      'revenue', 0,
      'item_evidence_count', 0,
      'staff_id', v_staff_id
    )
  );
end;
$$;

revoke all on function public.get_my_official_whatsapp_sales_v1(date, date) from public;
grant execute on function public.get_my_official_whatsapp_sales_v1(date, date) to anon, authenticated;

comment on function public.get_my_official_whatsapp_sales_v1(date, date) is
'Returns only the current Dawaa staff actor official WhatsApp-attributed sales for the requested Cairo-local date range. Client cannot choose another staff id.';
