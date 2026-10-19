import {describe,it,expect} from 'vitest';
import {runSalesIntelligencePipeline} from '../salesIntelligencePipeline';
import {aggregateV22Projection,decideV22Projection,type SiCaseProjectionFact} from '../refresh/v22SemanticProjection';
function fact(required=false,id='a'):SiCaseProjectionFact {
 const r=runSalesIntelligencePipeline({conversationId:'synthetic-review-preservation',rawWhatsAppExportText:'[10/19/26, 9:00:00 AM] Customer: عايزة شريط بانادول',resolveInvoiceCandidates:()=>[]});
 const view=r.caseAnalyses[0].caseIntelligence;
 return {salesCaseId:id,analysisId:id,pipelineVersion:'synthetic',view:{...view,review:{required,reasons:[]}}};
}
const now='2026-10-19T17:00:00Z';
describe('V22 projection preserves required review',()=>{
 it('keeps canonical review for one case',()=>{
  const r=aggregateV22Projection([fact(true)]);
  expect(r.status==='ok' && r.values.needs_human_review).toBe(true);
 });
 it('keeps canonical review when agreeing cases include a reviewed case',()=>{
  const r=aggregateV22Projection([fact(false,'a'),fact(true,'b')]);
  expect(r.status==='ok' && r.values.needs_human_review).toBe(true);
 });
 it('keeps review when media is missing even if canonical text needs no review',()=>{
  const r=decideV22Projection({id:'v22',case_json:{},confirmed_outcome:null,updated_at:now,media_missing:3,needs_human_review:false},[fact()],now);
  expect(r.patch?.needs_human_review).toBe(true);
 });
 it('never clears an existing review requirement as a side effect of semantic refresh',()=>{
  const r=decideV22Projection({id:'v22',case_json:{},confirmed_outcome:null,updated_at:now,media_missing:0,needs_human_review:true},[fact()],now);
  expect(r.patch?.needs_human_review).not.toBe(false);
 });
 it('preserves explicit approval requirement and never changes media evidence',()=>{
  const r=decideV22Projection({id:'v22',case_json:{requiresHumanApproval:true},confirmed_outcome:null,updated_at:now,media_missing:0,needs_human_review:false},[fact()],now);
  expect(r.patch?.needs_human_review).toBe(true);
  expect(r.patch).not.toHaveProperty('media_missing');
 });
 it('does not invent review for a complete case with no existing requirement',()=>{
  const r=aggregateV22Projection([fact()]);
  expect(r.status==='ok' && r.values.needs_human_review).toBe(false);
 });
 it('is idempotent after the preserved review projection',()=>{
  const row={id:'v22',case_json:{},confirmed_outcome:null,updated_at:now,media_missing:3,needs_human_review:true};
  const first=decideV22Projection(row,[fact()],now);
  const second=decideV22Projection({...row,...first.patch},[fact()],now);
  expect(second.status).toBe('unchanged');
 });
});
