import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SalesIntelligenceCaseAnalysis } from '../../types';

/** Isolated PostgreSQL engine only. No URLs, secrets, real customers or operational tasks. */
export async function followupLifecycleHarness(initialRows: Record<string, unknown>[] = []) {
  const db = new PGlite();
  await db.exec(`
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
      completed_at timestamptz,outcome text,updated_at timestamptz default now());
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
  `);
  const file = readdirSync(resolve('supabase/migrations')).find((name) => name.endsWith('_canonical_followup_projection_lifecycle.sql'));
  if (!file) throw new Error('missing_lifecycle_migration');
  await db.exec(readFileSync(resolve('supabase/migrations', file), 'utf8'));
  const rows: Record<string, any>[] = [];
  async function reload() {
    const result = await db.query<Record<string, any>>('select * from whatsapp_conversation_actions order by id');
    rows.splice(0, rows.length, ...result.rows);
  }
  for (const row of initialRows) {
    const record = { ...row };
    delete record.id;
    const keys = Object.keys(record);
    await db.query(`insert into whatsapp_conversation_actions(${keys.join(',')}) values(${keys.map((_,i) => `$${i+1}`).join(',')})`,
      keys.map((key) => ['payload','evidence'].includes(key) ? JSON.stringify(record[key]) : record[key]));
  }
  await reload();
  return {
    db, rows, reload,
    async publish(analyses: SalesIntelligenceCaseAnalysis[], sources: { id: string; customer_name?: string | null; customer_code?: string | null }[], analysisId: string) {
      // Fixtures explicitly publish the canonical snapshot; the projector cannot publish it itself.
      for (const source of sources) {
        const branch = analyses.find((row) => row.conversationId===source.id)?.conversationCase.branchNameRaw || 'فرع شكري';
        const customerId=analyses.find((row) => row.conversationId===source.id)?.conversationCase.customerId ?? null;
        await db.query(`insert into whatsapp_review_sources(id,customer_name,customer_code,branch,customer_id) values($1,$2,$3,$4,$5)
          on conflict(id) do update set customer_name=excluded.customer_name,customer_code=excluded.customer_code,customer_id=excluded.customer_id`,
        [source.id,source.customer_name,source.customer_code,branch,customerId]);
      }
      for (const analysis of analyses) {
        await db.query('update sales_intelligence_case_analyses set is_current=false where case_id=$1',[analysis.caseId]);
        await db.query(`insert into sales_intelligence_case_analyses(analysis_id,case_id,evidence_snapshot) values($1,$2,$3)
          on conflict(analysis_id) do update set evidence_snapshot=excluded.evidence_snapshot,is_current=true`,
        [analysisId,analysis.caseId,JSON.stringify({caseIntelligence:{followUp:analysis.followUp}})]);
        await db.query(`insert into sales_intelligence_cases(case_id,conversation_id,published_analysis_id) values($1,$2,$3)
          on conflict(case_id) do update set published_analysis_id=excluded.published_analysis_id,is_active=true`,
        [analysis.caseId,analysis.conversationId,analysisId]);
      }
    },
    async rpc(name: string, args: {p_source_id: string;p_analysis_ids: Record<string,string>;p_rows: unknown[]}) {
      if (name !== 'dawaa_reconcile_canonical_followup_actions_v1') throw new Error(`unexpected_rpc:${name}`);
      try {
        const result = await db.query<{result: any}>(`select public.dawaa_reconcile_canonical_followup_actions_v1($1,$2,$3) result`,
          [args.p_source_id,JSON.stringify(args.p_analysis_ids),JSON.stringify(args.p_rows)]);
        await reload();
        return {data:result.rows[0].result,error:null};
      } catch (error) { return {data:null,error}; }
    },
    async authorize() {
      await db.exec(`set test.actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';set test.permission='true';
        set test.source_access='true';set test.branch_access='true';`);
    },
    async materialize(id: string) {
      return db.query('select dawaa_materialize_whatsapp_action_v1($1)',[id]);
    },
    close: () => db.close(),
  };
}
