import assert from 'node:assert/strict';
export async function runNativeConcurrency({db,test,reset,c,write,reconcile,scalar,row,source,pointer,current}) {
  const a=await db.connectPeer(), b=await db.connectPeer();
  const pid=async client=>(await client.query('select pg_backend_pid() pid')).rows[0].pid;
  const bPid=await pid(b);
  const waitBlocked=async blocked=>{
    for(let i=0;i<100;i++){
      if(await scalar('select cardinality(pg_blocking_pids($1)) > 0',[blocked]))return;
      await new Promise(r=>setTimeout(r,20));
    }
    throw new Error('Expected real worker lock contention was not observed');
  };
  const stage=(client,hash)=>client.query('select sales_intelligence_stage_case_analysis_v1($1,$2::jsonb) result',['a',JSON.stringify(row(hash))]).then(r=>r.rows[0].result);
  const publish=(client,id)=>client.query('select sales_intelligence_reconcile_case_set_v2($1,$2::text[],$3::jsonb) result',[source,['a'],JSON.stringify({a:id})]).then(r=>r.rows[0].result);
  try {
    await test('native concurrent same-case stages serialize and return one semantic analysis; versions remain monotonic',async()=>{
      await reset();await c();await a.query('BEGIN');
      const first=await stage(a,'parallel');const second=stage(b,'parallel');
      await waitBlocked(bPid);await a.query('COMMIT');
      assert.equal((await second).analysis_id,first.analysis_id);
      const next=await Promise.all([stage(a,'parallel-next'),stage(b,'parallel-next')]);
      assert.equal(next[0].analysis_id,next[1].analysis_id);assert.equal(next[0].analysis_version,2);
      assert.equal(await scalar('select count(*)::int from sales_intelligence_case_analyses'),2);
      assert.equal((await reconcile(['a'],{a:next[0].analysis_id})).ok,true);
      assert.equal(await scalar('select count(*)::int from sales_intelligence_case_analyses where is_current'),1);
    });
    await test('native concurrent same-source reconciliation blocks and converges with atomic reader visibility',async()=>{
      await reset();await c();const staged=await write();await a.query('BEGIN');
      await publish(a,staged.analysis_id);const second=publish(b,staged.analysis_id);
      await waitBlocked(bPid);assert.equal(await pointer(),null);
      await a.query('COMMIT');assert.equal((await second).ok,true);
      assert.equal(await pointer(),await current());
      assert.equal(await scalar('select count(*)::int from sales_intelligence_case_analyses where is_current'),1);
    });
    await test('native older staged candidate is rejected, retirement/reactivation retain history and owned proof is revoked',async()=>{
      await reset();await c();const old=await write('a','old-stage'),fresh=await write('a','fresh-stage');
      await reconcile(['a'],{a:fresh.analysis_id});assert.equal((await reconcile(['a'],{a:old.analysis_id})).ok,false);
      assert.equal(await pointer(),fresh.analysis_id);await reconcile([],{});
      const next=await write('a','reactivate');const result=await reconcile(['a'],{a:next.analysis_id});
      assert.deepEqual(result.reactivatedCaseIds,['a']);
      await db.exec("CREATE OR REPLACE FUNCTION public.dawaa_revoke_whatsapp_canonical_sale_proof_v46(uuid,text,jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$ BEGIN INSERT INTO proof_revocations VALUES($1,$2); RETURN '{}'::jsonb; END $$;");
      await db.query("insert into whatsapp_customer_cases_v22(id,case_key,root_source_id,case_type,case_state,started_at,last_event_at,case_json) values('44444444-4444-4444-8444-444444444444','proof',$1,'order','open','2026-01-01','2026-01-01',$2::jsonb)",[source,JSON.stringify({canonicalSaleProof:{salesCaseId:'a'}})]);
      await reconcile([],{});assert.equal(await scalar('select count(*)::int from proof_revocations'),1);
      assert.equal(await scalar('select count(*)::int from sales_intelligence_case_analyses'),3);
    });
    await test('native archive versus reconcile uses compatible locks: archive wins without deadlock or reactivation',async()=>{
      await reset();await c();const staged=await write();await reconcile(['a'],{a:staged.analysis_id});
      await a.query('BEGIN');await a.query('select id from whatsapp_review_sources where id=$1 for update',[source]);
      await b.query('BEGIN');
      const rec=publish(b,staged.analysis_id).then(async r=>{await b.query('COMMIT');return r;}).catch(async e=>{await b.query('ROLLBACK');throw e;});
      // Attach a rejection handler immediately while waiting for the deliberately contested row.
      rec.catch(()=>{});
      await waitBlocked(bPid);
      const archive=a.query("update whatsapp_review_sources set review_status='archived' where id=$1",[source]).then(async r=>{await a.query('COMMIT');return r;}).catch(async e=>{await a.query('ROLLBACK');throw e;});
      const results=await Promise.allSettled([archive,rec]);
      const errors=results.filter(r=>r.status==='rejected').map(r=>({code:r.reason.code,message:r.reason.message,detail:r.reason.detail}));
      assert.deepEqual(errors,[],JSON.stringify(errors));
      assert.equal(await scalar('select review_status from whatsapp_review_sources where id=$1',[source]),'archived');
      assert.equal(await scalar('select count(*)::int from sales_intelligence_cases where conversation_id=$1 and is_active',[source]),0);
      assert.equal(await pointer(),null);assert.equal(await scalar('select count(*)::int from sales_intelligence_case_analyses'),1);
    });
  } finally {await a.query('ROLLBACK').catch(()=>{});await b.query('ROLLBACK').catch(()=>{});await a.end();await b.end();}
}
