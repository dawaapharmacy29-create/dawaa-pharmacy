-- Complete index coverage for the canonical customer identity phone lookup.
CREATE INDEX IF NOT EXISTS customers_mobile_idx ON public.customers (mobile);
CREATE INDEX IF NOT EXISTS customers_whatsapp_idx ON public.customers (whatsapp);
CREATE INDEX IF NOT EXISTS customers_phone_alt_idx ON public.customers (phone_alt);
