-- Synthetic isolated PostgreSQL fixture for 20261020153000; never run against an application database.
-- Applied after canonical-followup-lifecycle.sql. Shared by the PGlite tests and the native
-- multi-session concurrency test so both exercise the identical schema.

  alter table whatsapp_review_sources add column raw_text text, add column source_hash text unique,
    add column staff_name text, add column review_status text, add column reviewer_confirmed boolean,
    add column invoice_link_confirmed boolean, add column invoice_link_confirmed_invoice_id uuid,
    add column official_review_id uuid, add column conversation_started_at timestamptz,
    add column conversation_ended_at timestamptz, add column updated_at timestamptz default now();
  alter table whatsapp_conversation_actions add column staff_id uuid, add column staff_name text,
    add column product_code text, add column confidence numeric, add column created_at timestamptz default clock_timestamp(),
    add constraint actions_source_key_uk unique(source_id, action_key);
  create table staff(id uuid primary key,name text,branch text,active boolean,is_active boolean);
  create table staff_accounts(id uuid primary key,name text,staff_name text,username text,role text);
  create table customers(id uuid primary key,name text);
  create table products(id uuid primary key,product_code text);
  create table customer_requests(id uuid primary key,customer_id uuid,product_id uuid,doctor_id uuid,branch text);
  create table whatsapp_review_audit(id bigserial primary key,source_id uuid,action text,actor_id text,
    actor_name text,actor_role text,before_state jsonb,after_state jsonb,note text,created_at timestamptz default clock_timestamp());
  create function dawaa_customer_request_branch_key(p_branch text) returns text language sql immutable as $$
    select case
      when lower(trim(coalesce(p_branch,''))) in ('فرع شكري','شكري','shokry','shoukry') then 'shokry'
      when lower(trim(coalesce(p_branch,''))) in ('فرع الشامي','الشامي','الشامى','elshamy','el-shamy','alshamy') then 'elshamy'
      when trim(coalesce(p_branch,'')) = '' then null
      else lower(trim(p_branch))
    end $$;
  -- The isolated core only records the materialization; production calls the canonical creators.
  create or replace function dawaa_materialize_whatsapp_action_core_v2(uuid) returns jsonb language plpgsql as $$
    declare v_action whatsapp_conversation_actions%rowtype; v_target uuid;
    begin
      select * into v_action from whatsapp_conversation_actions where id=$1 for update;
      if v_action.status='created' then
        return jsonb_build_object('ok',true,'already_created',true,'target_id',v_action.target_id);
      end if;
      if v_action.action_type='customer_request' then
        v_target := gen_random_uuid();
        insert into customer_requests values (v_target,v_action.customer_id,v_action.product_id,v_action.staff_id,v_action.branch);
        update whatsapp_conversation_actions set status='created',target_table='customer_requests',target_id=v_target::text where id=$1;
      else
        v_target := gen_random_uuid();
        update whatsapp_conversation_actions set status='created',target_table='daily_followups',target_id=v_target::text where id=$1;
      end if;
      return jsonb_build_object('ok',true,'already_created',false,'target_id',v_target);
    end $$;
