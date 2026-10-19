import { afterEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(()=>({errors:[] as string[]}));
vi.mock('@supabase/supabase-js',()=>({createClient:()=>({from:(table:string)=>{
  const query:any={select:()=>query,eq:()=>query,update:()=>query,
    maybeSingle:async()=>({data:table==='staff_login_sessions'
      ? {staff_account_id:'actor',expires_at:'2099-01-01',revoked_at:null}
      : table==='staff_accounts' ? {id:'actor'} : {id:'11111111-1111-4111-8111-111111111111',raw_text:'synthetic text'},error:null}),
    then:(resolve:any)=>resolve({error:null})};return query;
}})}));
vi.mock('../../deployEnvironmentGuard',()=>({evaluateDeployEnvironment:()=>({ok:true})}));
vi.mock('../../../../server/sales-intelligence-refresh-authorization',()=>({authorizeRefreshActor:async()=>({allowed:true}),isRefreshSourceInActorScope:async()=>true}));
vi.mock('../refresh/storyProjectionRefresh',()=>({refreshCustomerStoryProjectionsForSources:async()=>({errors:[]})}));
vi.mock('../refresh/canonicalRefreshService',()=>({CANONICAL_REFRESH_SOURCE_COLUMNS:'id',runCanonicalSalesIntelligenceRefresh:async()=>({
  status:'ok',admittedSourceIds:['11111111-1111-4111-8111-111111111111'],blockedSources:[],batch:null,
  operationalProjection:{errors:fixture.errors},
})}));
import handler from '../../../../server/sales-intelligence-refresh-source';

async function request() {
  vi.stubEnv('SUPABASE_URL','https://synthetic.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','synthetic-server-key');vi.stubEnv('VITE_SUPABASE_ANON_KEY','synthetic-public-key');
  let status=0;let body:any;
  const response:any={status:(code:number)=>{status=code;return response;},setHeader:()=>response,end:(value:string)=>{body=JSON.parse(value);}};
  await handler({method:'POST',headers:{authorization:'Bearer synthetic-test-session'},body:{sourceId:'11111111-1111-4111-8111-111111111111'}},response);
  return {status,body};
}
afterEach(()=>{vi.unstubAllEnvs();fixture.errors=[];});
describe('operational projection transport outcome',()=>{
  it('reports a blocked operational projection without pretending canonical publication was rolled back',async()=>{
    fixture.errors=['canonical_complaint_legacy_work_requires_review'];const result=await request();
    expect(result.status).toBe(500);expect(result.body).toMatchObject({error:'canonical_operational_projection_failure',canonicalPublished:true});
    expect(result.body.detail).toContain('legacy_work_requires_review');
  });
  it('includes the verified operational projection in the successful response',async()=>{
    const result=await request();expect(result.status).toBe(200);expect(result.body.operationalProjection.errors).toEqual([]);
  });
});
