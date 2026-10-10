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
  has_table_privilege('anon', 'public.whatsapp_customer_journeys', 'SELECT')
  AND has_table_privilege('anon', 'public.whatsapp_customer_journeys', 'INSERT')
  AND has_table_privilege('anon', 'public.whatsapp_customer_journeys', 'UPDATE')
  AND has_table_privilege('anon', 'public.whatsapp_customer_journey_sessions', 'SELECT')
  AND has_table_privilege('anon', 'public.whatsapp_customer_journey_sessions', 'INSERT')
  AND has_table_privilege('anon', 'public.whatsapp_customer_journey_sessions', 'UPDATE')
  AND NOT has_table_privilege('anon', 'public.whatsapp_customer_journeys', 'DELETE')
  AND NOT has_table_privilege('anon', 'public.whatsapp_customer_journey_sessions', 'DELETE'),
  'browser has only the Journey select/insert/update table privileges'
);

SET LOCAL ROLE anon;
SELECT set_config(
  'request.headers',
  '{"x-dawaa-user-id":"00000000-0000-4000-8000-0000000000a1"}',
  true
);

DO $test$
DECLARE
  v_journey_id uuid := '00000000-0000-4000-8000-000000000061';
  v_affected integer;
BEGIN
  INSERT INTO public.whatsapp_customer_journeys (id, root_source_id)
  VALUES (v_journey_id, '00000000-0000-4000-8000-000000000051');

  PERFORM test.assert(
    (SELECT count(*) = 1 FROM public.whatsapp_customer_journeys WHERE id = v_journey_id),
    'authorized branch actor can read and insert a same-source journey'
  );

  UPDATE public.whatsapp_customer_journeys
  SET root_source_id = '00000000-0000-4000-8000-000000000051'
  WHERE id = v_journey_id;
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  PERFORM test.assert(v_affected = 1, 'authorized branch actor can update a same-source journey');

  INSERT INTO public.whatsapp_customer_journey_sessions (journey_id, source_id, session_id)
  VALUES (v_journey_id, '00000000-0000-4000-8000-000000000051', 'synthetic-session-1');
  PERFORM test.assert(
    (SELECT count(*) = 1 FROM public.whatsapp_customer_journey_sessions WHERE journey_id = v_journey_id),
    'authorized branch actor can read and insert a same-source journey session'
  );

  UPDATE public.whatsapp_customer_journey_sessions
  SET session_id = 'synthetic-session-1-updated'
  WHERE journey_id = v_journey_id
    AND source_id = '00000000-0000-4000-8000-000000000051';
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  PERFORM test.assert(v_affected = 1, 'authorized branch actor can update a same-source journey session');

  BEGIN
    INSERT INTO public.whatsapp_customer_journeys (id, root_source_id)
    VALUES ('00000000-0000-4000-8000-000000000062', '00000000-0000-4000-8000-000000000052');
    RAISE EXCEPTION 'journey insert with a cross-branch source unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;
  END;

  BEGIN
    INSERT INTO public.whatsapp_customer_journey_sessions (journey_id, source_id, session_id)
    VALUES (v_journey_id, '00000000-0000-4000-8000-000000000052', 'synthetic-cross-branch-session');
    RAISE EXCEPTION 'session insert with a cross-branch source unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;
  END;

  BEGIN
    UPDATE public.whatsapp_customer_journeys
    SET root_source_id = '00000000-0000-4000-8000-000000000052'
    WHERE id = v_journey_id;
    RAISE EXCEPTION 'journey update to a cross-branch source unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;
  END;

  BEGIN
    UPDATE public.whatsapp_customer_journey_sessions
    SET source_id = '00000000-0000-4000-8000-000000000052'
    WHERE journey_id = v_journey_id
      AND source_id = '00000000-0000-4000-8000-000000000051';
    RAISE EXCEPTION 'session update to a cross-branch source unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;
  END;

  PERFORM set_config(
    'request.headers',
    '{"x-dawaa-user-id":"00000000-0000-4000-8000-0000000000a3"}',
    true
  );

  PERFORM test.assert(
    (SELECT count(*) = 1 FROM public.whatsapp_customer_journeys WHERE id = v_journey_id),
    'read-only actor can select an in-scope journey'
  );
  BEGIN
    INSERT INTO public.whatsapp_customer_journeys (id, root_source_id)
    VALUES ('00000000-0000-4000-8000-000000000063', '00000000-0000-4000-8000-000000000051');
    RAISE EXCEPTION 'actor without create permission unexpectedly inserted a journey';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;
  END;
  UPDATE public.whatsapp_customer_journeys
  SET root_source_id = '00000000-0000-4000-8000-000000000051'
  WHERE id = v_journey_id;
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  PERFORM test.assert(v_affected = 0, 'actor without edit permission cannot update a journey');

  PERFORM test.assert(
    (SELECT count(*) = 1 FROM public.whatsapp_customer_journey_sessions WHERE journey_id = v_journey_id),
    'read-only actor can select an in-scope journey session'
  );
  BEGIN
    INSERT INTO public.whatsapp_customer_journey_sessions (journey_id, source_id, session_id)
    VALUES (v_journey_id, '00000000-0000-4000-8000-000000000051', 'synthetic-read-only-session');
    RAISE EXCEPTION 'actor without create permission unexpectedly inserted a session';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;
  END;
  UPDATE public.whatsapp_customer_journey_sessions
  SET session_id = 'forbidden-read-only-update'
  WHERE journey_id = v_journey_id
    AND source_id = '00000000-0000-4000-8000-000000000051';
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  PERFORM test.assert(v_affected = 0, 'actor without edit permission cannot update a journey session');

  PERFORM set_config(
    'request.headers',
    '{"x-dawaa-user-id":"00000000-0000-4000-8000-0000000000a2"}',
    true
  );
  PERFORM test.assert(
    (SELECT count(*) = 0 FROM public.whatsapp_customer_journeys WHERE id = v_journey_id),
    'other-branch actor cannot select the journey'
  );
  PERFORM test.assert(
    (SELECT count(*) = 0 FROM public.whatsapp_customer_journey_sessions WHERE journey_id = v_journey_id),
    'other-branch actor cannot select the journey session'
  );
  BEGIN
    INSERT INTO public.whatsapp_customer_journeys (id, root_source_id)
    VALUES ('00000000-0000-4000-8000-000000000064', '00000000-0000-4000-8000-000000000051');
    RAISE EXCEPTION 'other-branch actor unexpectedly inserted a journey';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;
  END;
END;
$test$;

RESET ROLE;
ROLLBACK;
