DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END;
$$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;

CREATE TABLE public.staff_accounts (
  id uuid PRIMARY KEY,
  staff_id text,
  role text,
  branch text,
  active boolean NOT NULL DEFAULT false,
  can_login boolean NOT NULL DEFAULT false,
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE OR REPLACE FUNCTION public.dawaa_customer_request_branch_key(p_branch text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(lower(trim(p_branch)), '')
$$;

\ir ../staging/30_session_helpers.sql

CREATE TABLE public.whatsapp_customer_stories (
  id uuid PRIMARY KEY,
  story_key text NOT NULL,
  branch text
);

CREATE TABLE public.whatsapp_customer_story_events (
  id uuid PRIMARY KEY,
  story_id uuid NOT NULL REFERENCES public.whatsapp_customer_stories(id),
  event_key text NOT NULL
);

ALTER TABLE public.whatsapp_customer_stories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_customer_story_events ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.whatsapp_customer_stories TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.whatsapp_customer_story_events TO anon, authenticated;

INSERT INTO public.staff_accounts (id, staff_id, role, branch, active, can_login, permissions) VALUES
  ('00000000-0000-4000-8000-0000000000a1', 'SYN-STORY-A', 'branch_manager', 'فرع شكري', true, true, '{"add_reviews":true,"view_reviews":true,"edit_reviews":true}'),
  ('00000000-0000-4000-8000-0000000000a2', 'SYN-STORY-B', 'branch_manager', 'فرع الشامي', true, true, '{"add_reviews":true,"view_reviews":true,"edit_reviews":true}'),
  ('00000000-0000-4000-8000-0000000000a3', 'SYN-STORY-READ', 'customer_service', 'فرع شكري', true, true, '{"view_reviews":true}'),
  ('00000000-0000-4000-8000-0000000000a4', 'SYN-STORY-GM', 'general_manager', NULL, true, true, '{"view_reviews":true,"add_reviews":true,"edit_reviews":true}');
