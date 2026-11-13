import { describe, expect, it } from 'vitest';
import { deriveCanonicalComplaintAssessment } from '../../complaintAssessmentEngine';
import { buildCanonicalComplaintActionRows, projectCanonicalComplaintsToActions } from '../canonicalComplaintProjector';

const source = {
  id: '11111111-1111-4111-8111-111111111111',
  customer_name: 'عميل اختبار',
  customer_code: '6060',
  raw_text: '[11/13/26, 2:36:55 AM] Customer: تمام مفيش مشكله',
};
const message = { id:'m1', role:'customer' as const, text:'تمام مفيش مشكله',
  at:'2026-11-13T00:36:55.000Z', meaningful:true };
const analysis = {
  caseId:'case-6060', conversationId:source.id,
  complaintAssessment:deriveCanonicalComplaintAssessment({ caseId:'case-6060', messages:[message] }),
  conversationCase:{ customerId:'33333333-3333-4333-8333-333333333333',branchNameRaw:'فرع شكري' },
  caseIntelligence:{ interaction:{ messages:[message] } },
} as any;

function fakeDb(initial: any[]) {
  const rows=structuredClone(initial);
  const client = {
    from: () => {
      const filters: Array<(row:any)=>boolean> = [];
      let updateValue:any=null;
      const query:any = {
        select:()=>query,
        eq:(k:string,v:any)=>{ filters.push(row=>row[k]===v); return query; },
        in:(k:string,vs:any[])=>{ filters.push(row=>vs.includes(row[k])); return query; },
        is:(k:string,v:any)=>{ filters.push(row=>v===null ? row[k]==null : row[k]===v); return query; },
        update:(v:any)=>{updateValue=v;return query;},
        then:(resolve:any)=>{
          const matches=rows.filter(row=>filters.every(fn=>fn(row)));
          if(updateValue)matches.forEach(row=>Object.assign(row,updateValue));
          return resolve({data:matches,error:null});
        },
        maybeSingle:async()=>{const result=await query;return {...result,data:result.data?.[0]??null};},
      };
      return query;
    },
  };
  return {rows,client};
}
const stale = (patch:any={}) => ({
  id:'old-complaint',source_id:source.id,action_key:'canonical-complaint:old',
  action_type:'complaint_followup',status:'ready',work_status:'unassigned',
  updated_at:'old',created_by:'si-canonical-complaint-projection-v1',
  auto_eligible:false,followup_attempts:0,evidence:['m1'],
  payload:{canonicalProjectionVersion:'si-canonical-complaint-projection-v1',
    caseId:'case-6060',canonicalComplaintState:'detected'},
  ...patch,
});

describe('canonical stale complaint withdrawal',()=>{
  it('V50 removes unworked phantom complaint without recreating an action',async()=>{
    expect(analysis.complaintAssessment.state).toBe('none');
    expect(buildCanonicalComplaintActionRows([analysis],[source]).rows).toHaveLength(0);
    const db=fakeDb([stale()]);
    const result=await projectCanonicalComplaintsToActions(db.client,[analysis],[source]);
    expect(result.inserted).toBe(0);
    expect(db.rows[0]).toMatchObject({
      status:'dismissed',auto_eligible:false,
      payload:{canonicalLifecycle:'withdrawn',
        canonicalWithdrawalReason:'canonical_complaint_no_longer_actionable'},
    });
    await projectCanonicalComplaintsToActions(db.client,[analysis],[source]);
    expect(db.rows[0].status).toBe('dismissed');
  });
  it.each([{assigned_to_id:'staff'}, {target_id:'followup'}, {work_status:'in_progress'}, {followup_attempts:1}])(
    'refuses to remove a complaint with human work %j',async(patch)=>{
      const db=fakeDb([stale(patch)]);
      await expect(projectCanonicalComplaintsToActions(db.client,[analysis],[source]))
        .rejects.toThrow('canonical_complaint_stale_proposal_has_human_work');
      expect(db.rows[0].status).toBe('ready');
    }
  );
  it('never dismisses a canonical complaint belonging to a different case',async()=>{
    const other=stale({payload:{canonicalProjectionVersion:'si-canonical-complaint-projection-v1',caseId:'case-other'}});
    const db=fakeDb([other]);
    await projectCanonicalComplaintsToActions(db.client,[analysis],[source]);
    expect(db.rows).toEqual([other]);
  });
  it('never touches an older legacy rule or a human dismissal',async()=>{
    const legacy=stale({created_by:'legacy',payload:{caseId:'case-6060'}});
    const dismissed=stale({id:'dismissed',status:'dismissed'});
    const db=fakeDb([legacy,dismissed]);
    await projectCanonicalComplaintsToActions(db.client,[analysis],[source]);
    expect(db.rows).toEqual([legacy,dismissed]);
  });
});
