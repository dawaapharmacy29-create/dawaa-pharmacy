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

-- Grant a real branch-scoped review permission in the fixture. The permission and identity helpers
-- under test remain the same helpers used by production RLS.
UPDATE public.staff_accounts
SET permissions = '{"add_reviews":true,"view_reviews":true,"edit_reviews":true}'::jsonb
WHERE id IN (
  '00000000-0000-4000-8000-0000000000a1',
  '00000000-0000-4000-8000-0000000000a3'
);

SELECT test.assert(
  has_table_privilege('anon', 'public.whatsapp_customer_cases_v22', 'SELECT')
  AND has_table_privilege('anon', 'public.whatsapp_customer_cases_v22', 'INSERT')
  AND has_table_privilege('anon', 'public.whatsapp_customer_cases_v22', 'UPDATE')
  AND has_column_privilege('anon', 'public.whatsapp_customer_cases_v22', 'case_key', 'INSERT')
  AND has_column_privilege('anon', 'public.whatsapp_customer_cases_v22', 'case_json', 'UPDATE'),
  'browser envelope read/write privileges granted'
);
SELECT test.assert(
  NOT has_table_privilege('anon', 'public.whatsapp_customer_cases_v22', 'DELETE')
  AND NOT has_table_privilege('anon', 'public.whatsapp_customer_cases_v22', 'TRUNCATE'),
  'browser cannot delete or truncate cases'
);

SET LOCAL ROLE anon;
SELECT set_config(
  'request.headers',
  '{"x-dawaa-user-id":"00000000-0000-4000-8000-0000000000a1"}',
  true
);

DO $test$
DECLARE
  v_case_id uuid;
  v_affected integer;
BEGIN
  INSERT INTO public.whatsapp_customer_cases_v22 (
    case_key, root_source_id, source_ids, branch, case_type, case_state,
    started_at, last_event_at
  )
  VALUES (
    'syn-v22-rls-branch-allowed',
    '00000000-0000-4000-8000-000000000051',
    ARRAY['00000000-0000-4000-8000-000000000051']::uuid[],
    'فرع شكري',
    'order',
    'open',
    now(),
    now()
  )
  RETURNING id INTO v_case_id;
  PERFORM test.assert(v_case_id IS NOT NULL, 'branch staff with add_reviews can insert a same-branch envelope');

  PERFORM test.assert(
    (SELECT count(*) = 1 FROM public.whatsapp_customer_cases_v22 WHERE id = v_case_id),
    'branch staff with view_reviews can read the same-branch envelope'
  );

  UPDATE public.whatsapp_customer_cases_v22
  SET summary = 'branch-scoped update'
  WHERE id = v_case_id;
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  PERFORM test.assert(v_affected = 1, 'branch staff with edit_reviews can update a same-branch envelope');

  BEGIN
    UPDATE public.whatsapp_customer_cases_v22
    SET verified_invoice_id = 'synthetic-forbidden'
    WHERE id = v_case_id;
    RAISE EXCEPTION 'browser proof-column update unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;
  END;

  BEGIN
    UPDATE public.whatsapp_customer_cases_v22
    SET responsibility_status = 'confirmed'
    WHERE id = v_case_id;
    RAISE EXCEPTION 'browser reviewer-field update unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;
  END;

  BEGIN
    INSERT INTO public.whatsapp_customer_cases_v22 (
      case_key, root_source_id, source_ids, branch, case_type, case_state,
      started_at, last_event_at, verified_invoice_id
    )
    VALUES (
      'syn-v22-rls-forged-proof-denied',
      '00000000-0000-4000-8000-000000000051',
      ARRAY['00000000-0000-4000-8000-000000000051']::uuid[],
      'فرع شكري',
      'order',
      'open',
      now(),
      now(),
      'synthetic-forbidden'
    );
    RAISE EXCEPTION 'browser proof-column insert unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;
  END;

  BEGIN
    INSERT INTO public.whatsapp_customer_cases_v22 (
      case_key, root_source_id, source_ids, branch, case_type, case_state,
      started_at, last_event_at
    )
    VALUES (
      'syn-v22-rls-forged-branch-denied',
      '00000000-0000-4000-8000-000000000051',
      ARRAY['00000000-0000-4000-8000-000000000051']::uuid[],
      'فرع الشامي',
      'order',
      'open',
      now(),
      now()
    );
    RAISE EXCEPTION 'mismatched root-source branch unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;
  END;

  PERFORM set_config(
    'request.headers',
    '{"x-dawaa-user-id":"00000000-0000-4000-8000-0000000000a3"}',
    true
  );
  BEGIN
    INSERT INTO public.whatsapp_customer_cases_v22 (
      case_key, root_source_id, source_ids, branch, case_type, case_state,
      started_at, last_event_at
    )
    VALUES (
      'syn-v22-rls-cross-branch-denied',
      '00000000-0000-4000-8000-000000000051',
      ARRAY['00000000-0000-4000-8000-000000000051']::uuid[],
      'فرع شكري',
      'order',
      'open',
      now(),
      now()
    );
    RAISE EXCEPTION 'cross-branch insert unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;
  END;

  UPDATE public.whatsapp_customer_cases_v22
  SET summary = 'cross-branch update must be hidden'
  WHERE id = v_case_id;
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  PERFORM test.assert(v_affected = 0, 'cross-branch staff cannot read/update another branch envelope');

  PERFORM set_config(
    'request.headers',
    '{"x-dawaa-user-id":"00000000-0000-4000-8000-0000000000a4"}',
    true
  );
  BEGIN
    INSERT INTO public.whatsapp_customer_cases_v22 (
      case_key, root_source_id, source_ids, branch, case_type, case_state,
      started_at, last_event_at
    )
    VALUES (
      'syn-v22-rls-inactive-denied',
      '00000000-0000-4000-8000-000000000051',
      ARRAY['00000000-0000-4000-8000-000000000051']::uuid[],
      'فرع شكري',
      'order',
      'open',
      now(),
      now()
    );
    RAISE EXCEPTION 'inactive account insert unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;
  END;
END;
$test$;

ROLLBACK;
