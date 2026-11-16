-- Canonical customer identity lookup ORs the three raw code columns. The existing
-- btrim/coalesce expression indexes cannot serve effective_customer_code = ANY(...),
-- so that unindexed OR arm forced a full customers scan and timed out WhatsApp refresh.
-- Complete the existing customer_code/code bitmap-OR path without changing identity,
-- uniqueness, RLS, grants, customer rows or historical manager decisions.
SET LOCAL lock_timeout = '3s';
CREATE INDEX IF NOT EXISTS customers_effective_customer_code_lookup_idx_v1
  ON public.customers USING btree (effective_customer_code);
