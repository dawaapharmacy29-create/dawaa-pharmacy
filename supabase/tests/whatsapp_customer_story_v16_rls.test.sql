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
  has_table_privilege('anon', 'public.whatsapp_customer_stories', 'SELECT')
  AND has_table_privilege('anon', 'public.whatsapp_customer_stories', 'INSERT')
  AND has_table_privilege('anon', 'public.whatsapp_customer_stories', 'UPDATE')
  AND has_table_privilege('anon', 'public.whatsapp_customer_story_events', 'SELECT')
  AND has_table_privilege('anon', 'public.whatsapp_customer_story_events', 'INSERT')
  AND has_table_privilege('anon', 'public.whatsapp_customer_story_events', 'UPDATE')
  AND NOT has_table_privilege('anon', 'public.whatsapp_customer_stories', 'DELETE')
  AND NOT has_table_privilege('anon', 'public.whatsapp_customer_story_events', 'DELETE'),
  'browser has only Story select/insert/update table privileges'
);

SET LOCAL ROLE anon;
SELECT set_config(
  'request.headers',
  '{"x-dawaa-user-id":"00000000-0000-4000-8000-0000000000a1"}',
  true
);

DO $test$
DECLARE
  v_branch_a_story uuid := '00000000-0000-4000-8000-000000000061';
  v_branch_b_story uuid := '00000000-0000-4000-8000-000000000062';
  v_allowed_event uuid := '00000000-0000-4000-8000-000000000071';
  v_cross_branch_event uuid := '00000000-0000-4000-8000-000000000072';
  v_affected integer;
BEGIN
  INSERT INTO public.whatsapp_customer_stories (id, story_key, branch)
  VALUES (v_branch_a_story, 'synthetic-story-a', 'فرع شكري');
  PERFORM test.assert(
    (SELECT count(*) = 1 FROM public.whatsapp_customer_stories WHERE id = v_branch_a_story),
    'authorized actor can insert and select an in-branch story'
  );

  UPDATE public.whatsapp_customer_stories
  SET story_key = 'synthetic-story-a-updated'
  WHERE id = v_branch_a_story;
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  PERFORM test.assert(v_affected = 1, 'authorized actor can update an in-branch story');

  INSERT INTO public.whatsapp_customer_story_events (id, story_id, event_key)
  VALUES (v_allowed_event, v_branch_a_story, 'synthetic-story-event-a');
  PERFORM test.assert(
    (SELECT count(*) = 1 FROM public.whatsapp_customer_story_events WHERE id = v_allowed_event),
    'authorized actor can insert and select an event for a visible story'
  );

  UPDATE public.whatsapp_customer_story_events
  SET event_key = 'synthetic-story-event-a-updated'
  WHERE id = v_allowed_event;
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  PERFORM test.assert(v_affected = 1, 'authorized actor can update an event for a visible story');

  PERFORM set_config(
    'request.headers',
    '{"x-dawaa-user-id":"00000000-0000-4000-8000-0000000000a3"}',
    true
  );

  UPDATE public.whatsapp_customer_story_events
  SET event_key = 'forbidden-read-only-update'
  WHERE id = v_allowed_event;
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  PERFORM test.assert(v_affected = 0, 'actor without edit permission cannot update an event');

  BEGIN
    INSERT INTO public.whatsapp_customer_stories (id, story_key, branch)
    VALUES ('00000000-0000-4000-8000-000000000063', 'synthetic-unauthorized-story', 'فرع شكري');
    RAISE EXCEPTION 'actor without create permission unexpectedly inserted a story';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;
  END;

  BEGIN
    INSERT INTO public.whatsapp_customer_story_events (id, story_id, event_key)
    VALUES ('00000000-0000-4000-8000-000000000073', v_branch_a_story, 'synthetic-unauthorized-event');
    RAISE EXCEPTION 'actor without create permission unexpectedly inserted a story event';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;
  END;

  BEGIN
    UPDATE public.whatsapp_customer_stories
    SET story_key = 'forbidden-update'
    WHERE id = v_branch_a_story;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    PERFORM test.assert(v_affected = 0, 'actor without edit permission cannot update a story');
  END;

  PERFORM set_config(
    'request.headers',
    '{"x-dawaa-user-id":"00000000-0000-4000-8000-0000000000a2"}',
    true
  );
  INSERT INTO public.whatsapp_customer_stories (id, story_key, branch)
  VALUES (v_branch_b_story, 'synthetic-story-b', 'فرع الشامي');
  INSERT INTO public.whatsapp_customer_story_events (id, story_id, event_key)
  VALUES (v_cross_branch_event, v_branch_b_story, 'synthetic-story-event-b');

  PERFORM test.assert(
    (SELECT count(*) = 0 FROM public.whatsapp_customer_stories WHERE id = v_branch_a_story),
    'branch B actor cannot select branch A story'
  );
  PERFORM test.assert(
    (SELECT count(*) = 0 FROM public.whatsapp_customer_story_events WHERE id = v_allowed_event),
    'story event select is scoped by visibility of its parent story'
  );

  UPDATE public.whatsapp_customer_stories
  SET story_key = 'cross-branch-forbidden'
  WHERE id = v_branch_a_story;
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  PERFORM test.assert(v_affected = 0, 'branch B actor cannot update branch A story');

  UPDATE public.whatsapp_customer_story_events
  SET event_key = 'cross-branch-forbidden'
  WHERE id = v_allowed_event;
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  PERFORM test.assert(v_affected = 0, 'branch B actor cannot update event of branch A story');

  PERFORM set_config(
    'request.headers',
    '{"x-dawaa-user-id":"00000000-0000-4000-8000-0000000000a4"}',
    true
  );
  PERFORM test.assert(
    (SELECT count(*) = 2 FROM public.whatsapp_customer_stories),
    'top management actor can select stories across branches'
  );
  PERFORM test.assert(
    (SELECT count(*) = 2 FROM public.whatsapp_customer_story_events),
    'top management actor can select events whose stories are visible'
  );
END;
$test$;

RESET ROLE;
ROLLBACK;
