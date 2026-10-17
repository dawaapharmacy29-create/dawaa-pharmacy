import {describe,it,expect} from 'vitest';
import {upsertSalesIntelligenceCase} from '../caseWriter';
import type {CaseRowContent} from '../mappers';
const content={conversationId:'source',sourceCaseIdV22:'v22',customerId:'customer',customerPhone:null,branchId:null,branchNameRaw:'branch',caseStartedAt:'2026-10-01',caseEndedAt:'2026-10-01'} as CaseRowContent;
describe('staged case insert never resets existing lifecycle',()=>{
 it.each([false,true])('stale pre-read with concurrent publication=%s keeps active/published state',async(concurrent)=>{
  let row:any=concurrent?{case_id:'a',is_active:true,published_analysis_id:'published'}:null;
  const client={from:()=>({
   select:()=>({eq:()=>({maybeSingle:async()=>({data:null,error:null})})}),
   upsert:async(payload:any,options:any)=>{expect(options.ignoreDuplicates).toBe(true);if(!row)row={...payload};return {error:null};},
   update:(payload:any)=>({eq:async()=>{expect(payload).not.toHaveProperty('is_active');expect(payload).not.toHaveProperty('published_analysis_id');row={...row,...payload};return {error:null};}}),
  })};
  await upsertSalesIntelligenceCase(client,'a',content,true);
  expect(row.is_active).toBe(concurrent);
  expect(row.published_analysis_id).toBe(concurrent?'published':undefined);
 });
});
