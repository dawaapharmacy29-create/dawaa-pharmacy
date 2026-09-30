-- Sales Intelligence Phase H.1B — live-schema gap fix (instruction #1: "re-inspect the live
-- schema first, it is now the contract"). sales_intelligence_basket_invoice_matches was created in
-- H.1A without a matching_input_hash column, even though the H.0.2 design (design doc §11) requires
-- match idempotency to be keyed on analysis_id + attribution_row_id + matching input hash + matching
-- engine version. Table confirmed empty at the time of this fix, so NOT NULL is added directly via
-- an add-default/drop-default two-step rather than a backfill.
alter table public.sales_intelligence_basket_invoice_matches
  add column if not exists matching_input_hash text not null default '';
alter table public.sales_intelligence_basket_invoice_matches
  alter column matching_input_hash drop default;

comment on column public.sales_intelligence_basket_invoice_matches.matching_input_hash is
  'Deterministic hash of the exact inputs this match evaluation was computed from (active basket state + selected invoice fields + matching engine version). Idempotency key alongside analysis_id/attribution_row_id/evaluation_version.';
