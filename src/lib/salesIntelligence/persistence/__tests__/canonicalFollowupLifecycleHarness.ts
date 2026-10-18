import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SalesIntelligenceCaseAnalysis } from '../../types';

/** Isolated PostgreSQL engine only. No URLs, secrets, real customers or operational tasks. */
export async function followupLifecycleHarness(initialRows: Record<string, unknown>[] = []) {
  const db = new PGlite();
  await db.exec(readFileSync(resolve('scripts/staging/fixtures/canonical-followup-lifecycle.sql'), 'utf8'));
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
