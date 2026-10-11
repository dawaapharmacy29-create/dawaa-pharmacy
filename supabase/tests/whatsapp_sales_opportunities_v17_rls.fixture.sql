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

CREATE TABLE public.whatsapp_review_sources (
  id uuid PRIMARY KEY,
  staff_id uuid,
  branch text
);

CREATE OR REPLACE FUNCTION public.dawaa_customer_request_branch_key(p_branch text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(lower(trim(p_branch)), '')
$$;

\ir ../staging/30_session_helpers.sql

CREATE TABLE public.whatsapp_sales_opportunities_v17 (
  id uuid PRIMARY KEY,
  root_source_id uuid NOT NULL REFERENCES public.whatsapp_review_sources(id),
  opportunity_key text NOT NULL,
  current_stage text
);

ALTER TABLE public.whatsapp_review_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_review_sources_select_fixture
ON public.whatsapp_review_sources
FOR SELECT
TO public
USING (
  public.dawaa_current_actor_can(ARRAY['view_reviews','view_conversation_reviews','manage_conversation_evaluations'])
  AND public.dawaa_can_read_conversation_review_row_v2(
    public.dawaa_current_staff_account_id_strict(),
    staff_id,
    NULL::uuid,
    branch,
    NULL::uuid
  )
);

GRANT SELECT ON public.whatsapp_review_sources TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.whatsapp_sales_opportunities_v17 TO anon, authenticated;

\ir ../staging/38_whatsapp_sales_opportunities_v17_rls.sql

INSERT INTO public.staff_accounts (id, staff_id, role, branch, active, can_login, permissions) VALUES
  ('00000000-0000-4000-8000-0000000000a1', 'SYN-V17-S1', 'branch_manager', 'فرع شكري', true, true,
   '{"add_reviews":true,"view_reviews":true,"edit_reviews":true}'),
  ('00000000-0000-4000-8000-0000000000a2', 'SYN-V17-S2', 'branch_manager', 'فرع الشامي', true, true,
   '{"add_reviews":true,"view_reviews":true,"edit_reviews":true}'),
  ('00000000-0000-4000-8000-0000000000a3', 'SYN-V17-READ', 'customer_service', 'فرع شكري', true, true,
   '{"view_reviews":true}');

INSERT INTO public.whatsapp_review_sources (id, staff_id, branch) VALUES
  ('00000000-0000-4000-8000-000000000051', '00000000-0000-4000-8000-0000000000a1', 'فرع شكري'),
  ('00000000-0000-4000-8000-000000000052', '00000000-0000-4000-8000-0000000000a2', 'فرع الشامي');
