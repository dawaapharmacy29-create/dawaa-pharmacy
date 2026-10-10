DROP POLICY IF EXISTS whatsapp_customer_journeys_select_v15 ON public.whatsapp_customer_journeys;
CREATE POLICY whatsapp_customer_journeys_select_v15
ON public.whatsapp_customer_journeys
FOR SELECT
TO public
USING (
  EXISTS (
    SELECT 1
    FROM public.whatsapp_review_sources s
    WHERE s.id = whatsapp_customer_journeys.root_source_id
      AND public.dawaa_can_read_conversation_review_row_v2(
        public.dawaa_current_staff_account_id_strict(),
        s.staff_id,
        NULL::uuid,
        s.branch,
        NULL::uuid
      )
  )
);

DROP POLICY IF EXISTS whatsapp_customer_journeys_insert_v15 ON public.whatsapp_customer_journeys;
CREATE POLICY whatsapp_customer_journeys_insert_v15
ON public.whatsapp_customer_journeys
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
  AND EXISTS (
    SELECT 1
    FROM public.whatsapp_review_sources s
    WHERE s.id = whatsapp_customer_journeys.root_source_id
      AND public.dawaa_can_read_conversation_review_row_v2(
        public.dawaa_current_staff_account_id_strict(),
        s.staff_id,
        NULL::uuid,
        s.branch,
        NULL::uuid
      )
  )
);

DROP POLICY IF EXISTS whatsapp_customer_journeys_update_v15 ON public.whatsapp_customer_journeys;
CREATE POLICY whatsapp_customer_journeys_update_v15
ON public.whatsapp_customer_journeys
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
    FROM public.whatsapp_review_sources s
    WHERE s.id = whatsapp_customer_journeys.root_source_id
      AND public.dawaa_can_read_conversation_review_row_v2(
        public.dawaa_current_staff_account_id_strict(),
        s.staff_id,
        NULL::uuid,
        s.branch,
        NULL::uuid
      )
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
    FROM public.whatsapp_review_sources s
    WHERE s.id = whatsapp_customer_journeys.root_source_id
      AND public.dawaa_can_read_conversation_review_row_v2(
        public.dawaa_current_staff_account_id_strict(),
        s.staff_id,
        NULL::uuid,
        s.branch,
        NULL::uuid
      )
  )
);

DROP POLICY IF EXISTS whatsapp_customer_journey_sessions_select_v15 ON public.whatsapp_customer_journey_sessions;
CREATE POLICY whatsapp_customer_journey_sessions_select_v15
ON public.whatsapp_customer_journey_sessions
FOR SELECT
TO public
USING (
  EXISTS (
    SELECT 1
    FROM public.whatsapp_review_sources s
    WHERE s.id = whatsapp_customer_journey_sessions.source_id
      AND public.dawaa_can_read_conversation_review_row_v2(
        public.dawaa_current_staff_account_id_strict(),
        s.staff_id,
        NULL::uuid,
        s.branch,
        NULL::uuid
      )
  )
);

DROP POLICY IF EXISTS whatsapp_customer_journey_sessions_insert_v15 ON public.whatsapp_customer_journey_sessions;
CREATE POLICY whatsapp_customer_journey_sessions_insert_v15
ON public.whatsapp_customer_journey_sessions
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
  AND EXISTS (
    SELECT 1
    FROM public.whatsapp_review_sources s
    WHERE s.id = whatsapp_customer_journey_sessions.source_id
      AND public.dawaa_can_read_conversation_review_row_v2(
        public.dawaa_current_staff_account_id_strict(),
        s.staff_id,
        NULL::uuid,
        s.branch,
        NULL::uuid
      )
  )
);

DROP POLICY IF EXISTS whatsapp_customer_journey_sessions_update_v15 ON public.whatsapp_customer_journey_sessions;
CREATE POLICY whatsapp_customer_journey_sessions_update_v15
ON public.whatsapp_customer_journey_sessions
FOR UPDATE
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
    FROM public.whatsapp_review_sources s
    WHERE s.id = whatsapp_customer_journey_sessions.source_id
      AND public.dawaa_can_read_conversation_review_row_v2(
        public.dawaa_current_staff_account_id_strict(),
        s.staff_id,
        NULL::uuid,
        s.branch,
        NULL::uuid
      )
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
    FROM public.whatsapp_review_sources s
    WHERE s.id = whatsapp_customer_journey_sessions.source_id
      AND public.dawaa_can_read_conversation_review_row_v2(
        public.dawaa_current_staff_account_id_strict(),
        s.staff_id,
        NULL::uuid,
        s.branch,
        NULL::uuid
      )
  )
);

REVOKE DELETE, TRUNCATE ON public.whatsapp_customer_journeys FROM PUBLIC, anon, authenticated;
REVOKE DELETE, TRUNCATE ON public.whatsapp_customer_journey_sessions FROM PUBLIC, anon, authenticated;
