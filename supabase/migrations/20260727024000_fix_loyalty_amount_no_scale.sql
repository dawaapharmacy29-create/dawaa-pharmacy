-- Fix loyalty invoice amounts: imported values are already in EGP, not milli-units.

create or replace function public.loyalty_invoice_amount(
  p_net_total numeric,
  p_gross_total numeric,
  p_total_amount numeric,
  p_net_amount numeric,
  p_discounted_amount numeric,
  p_gross_amount numeric,
  p_amount numeric,
  p_source text,
  p_import_batch text
)
returns numeric
language sql
immutable
as $$
  select round(
    coalesce(
      nullif(p_net_total, 0),
      nullif(p_gross_total, 0),
      nullif(p_total_amount, 0),
      nullif(p_net_amount, 0),
      nullif(p_discounted_amount, 0),
      nullif(p_gross_amount, 0),
      nullif(p_amount, 0),
      0
    ),
    3
  );
$$;

grant execute on function public.loyalty_invoice_amount(
  numeric,
  numeric,
  numeric,
  numeric,
  numeric,
  numeric,
  numeric,
  text,
  text
) to authenticated;

select pg_notify('pgrst','reload schema');
