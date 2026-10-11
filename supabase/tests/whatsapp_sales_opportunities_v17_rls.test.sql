BEGIN;

CREATE SCHEMA IF NOT EXISTS test;
CREATE OR REPLACE FUNCTION test.assert(p_value boolean, p_message text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_value IS NOT TRUE THEN
    RAISE EXCEPTION 'assertion failed: %', p_message;
  END IF;
END;
$$;
GRANT USAGE ON SCHEMA test TO anon;
GRANT EXECUTE ON FUNCTION test.assert(boolean, text) TO anon;

SELECT test.assert(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.whatsapp_sales_opportunities_v17'::regclass)
  AND has_table_privilege('anon', 'public.whatsapp_sales_opportunities_v17', 'SELECT')
  AND has_table_privilege('anon', 'public.whatsapp_sales_opportunities_v17', 'INSERT')
  AND has_table_privilege('anon', 'public.whatsapp_sales_opportunities_v17', 'UPDATE')
  AND NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'public.whatsapp_sales_opportunities_v17'::regclass AND polcmd = 'd'
  ),
  'V17 has the production RLS boundary and select/insert/update policies without a delete policy'
);

SET LOCAL ROLE anon;
SELECT set_config('request.headers', '{"x-dawaa-user-id":"00000000-0000-4000-8000-0000000000a1"}', true);

DO $test$
DECLARE
  v_id uuid := '00000000-0000-4000-8000-000000000061';
  v_affected integer;
BEGIN
  INSERT INTO public.whatsapp_sales_opportunities_v17 (id, root_source_id, opportunity_key, current_stage)
  VALUES (v_id, '00000000-0000-4000-8000-000000000051', 'synthetic-opportunity', 'requested');

  PERFORM test.assert(
    (SELECT count(*) = 1 FROM public.whatsapp_sales_opportunities_v17 WHERE id = v_id),
    'authorized branch actor can insert and read an opportunity scoped to their source'
  );

  UPDATE public.whatsapp_sales_opportunities_v17
  SET current_stage = 'accepted'
  WHERE id = v_id;
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  PERFORM test.assert(v_affected = 1, 'authorized branch actor can update an in-scope opportunity');

  BEGIN
    INSERT INTO public.whatsapp_sales_opportunities_v17 (id, root_source_id, opportunity_key, current_stage)
    VALUES ('00000000-0000-4000-8000-000000000062', '00000000-0000-4000-8000-000000000052', 'cross-branch', 'requested');
    RAISE EXCEPTION 'cross-branch insert unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;
  END;

  PERFORM set_config('request.headers', '{"x-dawaa-user-id":"00000000-0000-4000-8000-0000000000a3"}', true);
  BEGIN
    INSERT INTO public.whatsapp_sales_opportunities_v17 (id, root_source_id, opportunity_key, current_stage)
    VALUES ('00000000-0000-4000-8000-000000000063', '00000000-0000-4000-8000-000000000051', 'read-only', 'requested');
    RAISE EXCEPTION 'actor without create permission unexpectedly inserted an opportunity';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;
  END;

  UPDATE public.whatsapp_sales_opportunities_v17
  SET current_stage = 'rejected'
  WHERE id = v_id;
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  PERFORM test.assert(v_affected = 0, 'actor without edit permission cannot update an opportunity');

  PERFORM set_config('request.headers', '{"x-dawaa-user-id":"00000000-0000-4000-8000-0000000000a2"}', true);
  PERFORM test.assert(
    (SELECT count(*) = 0 FROM public.whatsapp_sales_opportunities_v17 WHERE id = v_id),
    'other-branch actor cannot read an opportunity outside their source scope'
  );
END;
$test$;

RESET ROLE;
ROLLBACK;
