-- Synthetic isolated PostgreSQL fixture; never run against an application database.

    create role anon; create role authenticated; create role service_role;
    create table whatsapp_review_sources(id uuid primary key,customer_id uuid,customer_name text,customer_code text,
      branch text,staff_id uuid,canonical boolean default true);
    create view whatsapp_operational_canonical_sources_v1 as
      select id source_id from whatsapp_review_sources where canonical;
    create table sales_intelligence_cases(case_id text primary key,conversation_id uuid,
      is_active boolean default true,published_analysis_id uuid);
    create table sales_intelligence_case_analyses(analysis_id uuid primary key,case_id text,
      is_current boolean default true,superseded_at timestamptz,evidence_snapshot jsonb);
    create table whatsapp_conversation_actions(
      id uuid primary key default gen_random_uuid(),source_id uuid,action_key text,action_type text,
      status text check(status in ('proposed','ready','created','dismissed','error')),
      work_status text default 'unassigned',auto_eligible boolean default false,branch text,
      customer_id uuid,customer_code text,customer_name text,customer_phone text,product_id uuid,
      product_name text,quantity numeric,due_at timestamptz,reason text,evidence jsonb,payload jsonb,
      followup_identity text unique,assigned_to_id uuid,assigned_to_name text,created_by text,
      target_table text,target_id text,assigned_at timestamptz,started_at timestamptz,
      completed_at timestamptz,outcome text,outcome_note text,followup_attempts integer default 0,
      last_followup_at timestamptz,next_followup_at timestamptz,recovered_at timestamptz,recovered_invoice_id text,
      updated_at timestamptz default now());
    create function dawaa_current_staff_account_id_strict() returns uuid language sql as $$
      select nullif(current_setting('test.actor',true),'')::uuid $$;
    create function dawaa_current_actor_can(text[]) returns boolean language sql as $$
      select coalesce(current_setting('test.permission',true),'false')='true' $$;
    create function dawaa_can_read_conversation_review_row_v2(uuid,uuid,uuid,text,uuid)
      returns boolean language sql as $$
      select coalesce(current_setting('test.source_access',true),'false')='true' $$;
    create function dawaa_can_access_customer_request_branch(text,text)
      returns boolean language sql as $$
      select coalesce(current_setting('test.branch_access',true),'false')='true' $$;
    create function dawaa_materialize_whatsapp_action_core_v2(uuid) returns jsonb language plpgsql as $$
      begin
        update whatsapp_conversation_actions set status='created',target_table='daily_followups',
          target_id=coalesce(target_id,'isolated-target') where id=$1;
        return '{"ok":true}'::jsonb;
      end $$;
    grant usage on schema public to anon,authenticated,service_role;
    grant all on all tables in schema public to service_role;

