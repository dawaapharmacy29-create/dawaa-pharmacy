-- CANDIDATE ONLY: future archival events, not historical repair.
BEGIN;
CREATE OR REPLACE FUNCTION public.sales_intelligence_on_source_archived_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_catalog AS $$
DECLARE result jsonb;
BEGIN
  result := public.sales_intelligence_reconcile_case_set_v2(NEW.id, '{}'::text[], '{}'::jsonb);
  IF result->>'ok' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'archival lifecycle reconciliation failed: %', result->>'status';
  END IF;
  RETURN NEW;
END $$;
ALTER FUNCTION public.sales_intelligence_on_source_archived_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.sales_intelligence_on_source_archived_v1() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER sales_intelligence_source_archived_v1
AFTER UPDATE OF review_status ON public.whatsapp_review_sources
FOR EACH ROW WHEN (NEW.review_status = 'archived' AND OLD.review_status IS DISTINCT FROM NEW.review_status)
EXECUTE FUNCTION public.sales_intelligence_on_source_archived_v1();
COMMIT;
