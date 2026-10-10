DROP POLICY IF EXISTS whatsapp_customer_stories_insert_v16 ON public.whatsapp_customer_stories;
CREATE POLICY whatsapp_customer_stories_insert_v16
ON public.whatsapp_customer_stories
FOR INSERT
TO public
WITH CHECK (
  public.dawaa_current_actor_can(
    ARRAY[
      'add_reviews',
      'reviews.action.create',
      'manage_conversation_evaluations'
    ]
  )
);

DROP POLICY IF EXISTS whatsapp_customer_stories_select_v16 ON public.whatsapp_customer_stories;
CREATE POLICY whatsapp_customer_stories_select_v16
ON public.whatsapp_customer_stories
FOR SELECT
TO public
USING (
  public.dawaa_current_actor_can(
    ARRAY[
      'view_reviews',
      'view_conversation_reviews',
      'manage_conversation_evaluations'
    ]
  )
  AND (
    public.dawaa_actor_is_top_management_v1()
    OR EXISTS (
      SELECT 1
      FROM public.staff_accounts me
      WHERE me.id = public.dawaa_current_staff_account_id_strict()
        AND coalesce(me.active, false)
        AND coalesce(me.can_login, false)
        AND (
          lower(trim(coalesce(me.role, ''))) IN (
            'team_dawaa_alpha',
            'customer_service_manager'
          )
          OR (
            public.dawaa_customer_request_branch_key(me.branch) IS NOT NULL
            AND public.dawaa_customer_request_branch_key(me.branch)
              = public.dawaa_customer_request_branch_key(whatsapp_customer_stories.branch)
          )
        )
    )
  )
);

DROP POLICY IF EXISTS whatsapp_customer_stories_update_v16 ON public.whatsapp_customer_stories;
CREATE POLICY whatsapp_customer_stories_update_v16
ON public.whatsapp_customer_stories
FOR UPDATE
TO public
USING (
  public.dawaa_current_actor_can(
    ARRAY[
      'edit_reviews',
      'approve_reviews',
      'manage_conversation_evaluations'
    ]
  )
)
WITH CHECK (
  public.dawaa_current_actor_can(
    ARRAY[
      'edit_reviews',
      'approve_reviews',
      'manage_conversation_evaluations'
    ]
  )
);

DROP POLICY IF EXISTS whatsapp_customer_story_events_insert_v16 ON public.whatsapp_customer_story_events;
CREATE POLICY whatsapp_customer_story_events_insert_v16
ON public.whatsapp_customer_story_events
FOR INSERT
TO public
WITH CHECK (
  public.dawaa_current_actor_can(
    ARRAY[
      'add_reviews',
      'reviews.action.create',
      'manage_conversation_evaluations'
    ]
  )
);

DROP POLICY IF EXISTS whatsapp_customer_story_events_select_v16 ON public.whatsapp_customer_story_events;
CREATE POLICY whatsapp_customer_story_events_select_v16
ON public.whatsapp_customer_story_events
FOR SELECT
TO public
USING (
  EXISTS (
    SELECT 1
    FROM public.whatsapp_customer_stories s
    WHERE s.id = whatsapp_customer_story_events.story_id
  )
);

DROP POLICY IF EXISTS whatsapp_customer_story_events_update_v16 ON public.whatsapp_customer_story_events;
CREATE POLICY whatsapp_customer_story_events_update_v16
ON public.whatsapp_customer_story_events
FOR UPDATE
TO public
USING (
  public.dawaa_current_actor_can(
    ARRAY[
      'edit_reviews',
      'approve_reviews',
      'manage_conversation_evaluations'
    ]
  )
  AND EXISTS (
    SELECT 1
    FROM public.whatsapp_customer_stories s
    WHERE s.id = whatsapp_customer_story_events.story_id
  )
)
WITH CHECK (
  public.dawaa_current_actor_can(
    ARRAY[
      'edit_reviews',
      'approve_reviews',
      'manage_conversation_evaluations'
    ]
  )
  AND EXISTS (
    SELECT 1
    FROM public.whatsapp_customer_stories s
    WHERE s.id = whatsapp_customer_story_events.story_id
  )
);

REVOKE DELETE, TRUNCATE ON public.whatsapp_customer_stories FROM PUBLIC, anon, authenticated;
REVOKE DELETE, TRUNCATE ON public.whatsapp_customer_story_events FROM PUBLIC, anon, authenticated;
