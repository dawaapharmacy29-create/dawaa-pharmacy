import { describe, expect, it } from 'vitest';
import { buildCanonicalComplaintActionRows, projectCanonicalComplaintsToActions } from '../canonicalComplaintProjector';
import { deriveCanonicalComplaintAssessment } from '../../complaintAssessmentEngine';

const source = { id: '11111111-1111-4111-8111-111111111111', customer_name: 'عميل اختبار', customer_code: '17',
  raw_text: '[10/17/26, 10:00:00 AM] Customer: انا زعلان من مشكلة التوصيل' };
const message = { id: 'm1', role: 'customer' as const, at: '2026-10-17T07:00:00.000Z', text: 'انا زعلان من مشكلة التوصيل', meaningful: true };
const analysis = { caseId: 'case-1', conversationId: source.id,
  complaintAssessment: deriveCanonicalComplaintAssessment({caseId:'case-1',messages:[message]}),
  conversationCase:{customerId:'33333333-3333-4333-8333-333333333333',branchNameRaw:'شكري'},
  caseIntelligence:{interaction:{messages:[message]}} } as any;
const legacy = () => ({ id:'legacy',source_id:source.id,action_key:'complaint-followup',action_type:'complaint_followup',
  status:'ready',work_status:'unassigned',updated_at:'before',auto_eligible:true,evidence:['m1'],payload:{history:'preserved'},followup_attempts:0 });

function database(initial: any[], options: {readError?:boolean;insertError?:boolean;beforeUpdate?:(rows:any[])=>void} = {}) {
  const rows = structuredClone(initial);
  let inserts = 0;
  const client = {from: () => {
    const filters: Array<(row:any)=>boolean> = [];
    let change:any = null;
    const query:any = {
      select:()=>query, eq:(key:string,value:any)=>{filters.push(row=>row[key]===value);return query;},
      in:(key:string,values:any[])=>{filters.push(row=>values.includes(row[key]));return query;},
      is:(key:string,value:any)=>{filters.push(row=>value===null ? row[key]==null : row[key]===value);return query;},
      update:(value:any)=>{change=value;return query;},
      insert:async(value:any)=>{
        inserts++;
        // A replacement must never be inserted while the old proposal is executable.
        expect(rows.filter(row=>row.source_id===source.id && row.action_key==='complaint-followup' && row.status==='ready')).toHaveLength(0);
        if(options.insertError)return {error:{code:'failure'}};
        if(rows.some(row=>row.followup_identity===value.followup_identity))return {error:{code:'23505'}};
        rows.push({...value,id:'canonical'});return {error:null};
      },
      then:(resolve:any)=>{
        if(options.readError && !change)return resolve({data:null,error:new Error('read unavailable')});
        if(change) options.beforeUpdate?.(rows);
        const matches=rows.filter(row=>filters.every(filter=>filter(row)));
        if(change) matches.forEach(row=>Object.assign(row,change,{updated_at:'after'}));
        return resolve({data:matches,error:null});
      },
      maybeSingle:async()=>{const result=await query;return {...result,data:result.data?.[0]??null};},
    };
    return query;
  }};
  return {client,rows,get inserts(){return inserts;}};
}

describe('canonical complaint legacy proposal cutover',()=>{
  it('withdraws the matching untouched legacy proposal before publishing its canonical replacement',async()=>{
    const db=database([legacy()]);
    const first=await projectCanonicalComplaintsToActions(db.client,[analysis],[source]);
    expect(first.inserted).toBe(1);
    expect(db.rows[0]).toMatchObject({status:'dismissed',auto_eligible:false,payload:{history:'preserved',canonicalLifecycle:'withdrawn'}});
    expect(db.rows.filter(row=>row.status==='ready')).toHaveLength(1);
    const before=JSON.stringify(db.rows);
    const retry=await projectCanonicalComplaintsToActions(db.client,[analysis],[source]);
    expect(retry.existing).toBe(1);expect(db.inserts).toBe(1);expect(JSON.stringify(db.rows)).toBe(before);
  });
  it('withdraws the legacy duplicate when the canonical proposal already exists',async()=>{
    const canonical=buildCanonicalComplaintActionRows([analysis],[source]).rows[0];
    const db=database([legacy(),{...canonical,id:'existing-canonical'}]);
    const result=await projectCanonicalComplaintsToActions(db.client,[analysis],[source]);
    expect(result).toMatchObject({inserted:0,existing:1});expect(db.inserts).toBe(0);
    expect(db.rows.filter(row=>row.status==='ready')).toHaveLength(1);
  });
  it.each([{target_id:'real-followup'}, {assigned_to_id:'staff'}, {work_status:'in_progress'},
    {followup_attempts:1},{outcome_note:'contacted'},{last_followup_at:'today'}])('preserves human work and blocks a parallel proposal: %j',async(patch)=>{
    const existing={...legacy(),...patch};const db=database([existing]);
    await expect(projectCanonicalComplaintsToActions(db.client,[analysis],[source])).rejects.toThrow('legacy_work_requires_review');
    expect(db.rows).toEqual([existing]);expect(db.inserts).toBe(0);
  });
  it('does not conflate another complaint or missing evidence with the canonical operation',async()=>{
    const db=database([{...legacy(),evidence:['other']}]);
    await expect(projectCanonicalComplaintsToActions(db.client,[analysis],[source])).rejects.toThrow('legacy_evidence_requires_review');
    expect(db.rows[0].status).toBe('ready');expect(db.inserts).toBe(0);
  });
  it('keeps a concurrent human materialization intact and does not insert a replacement',async()=>{
    const db=database([legacy()],{beforeUpdate:rows=>Object.assign(rows[0],{target_id:'real-followup',updated_at:'concurrent'})});
    await expect(projectCanonicalComplaintsToActions(db.client,[analysis],[source])).rejects.toThrow('concurrent_work_requires_review');
    expect(db.rows[0]).toMatchObject({target_id:'real-followup',status:'ready'});expect(db.inserts).toBe(0);
  });
  it('fails closed on a read failure instead of treating it as no legacy work',async()=>{
    const db=database([legacy()],{readError:true});
    await expect(projectCanonicalComplaintsToActions(db.client,[analysis],[source])).rejects.toThrow('read unavailable');expect(db.inserts).toBe(0);
  });
  it('leaves the old proposal disabled on insert failure, and a retry finishes the replacement',async()=>{
    const db=database([legacy()],{insertError:true});
    await expect(projectCanonicalComplaintsToActions(db.client,[analysis],[source])).rejects.toEqual({code:'failure'});
    expect(db.rows[0].status).toBe('dismissed');
    const retry=database(db.rows);await projectCanonicalComplaintsToActions(retry.client,[analysis],[source]);
    expect(retry.rows.filter(row=>row.status==='ready')).toHaveLength(1);
  });
  it('never edits another source or a human dismissal',async()=>{
    const initial=[{...legacy(),source_id:'other'},{...legacy(),id:'dismissed',status:'dismissed'}];
    const db=database(initial);await projectCanonicalComplaintsToActions(db.client,[analysis],[source]);
    expect(db.rows.slice(0,2)).toEqual(initial);
  });
});
