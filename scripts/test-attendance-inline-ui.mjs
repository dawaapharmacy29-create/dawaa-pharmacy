// Isolated browser contract test of the real component with service fixtures.
// No credentials, application login, network API calls or production writes.
// PLAYWRIGHT_MODULE_PATH may point to a preinstalled playwright package.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const fixture = `
export const state = globalThis.fixture = {
  role:'general_manager', finalizable:true, shiftCalls: 0, approvals: 0, permissionCreates: 0, permissionDecisions: 0, failRead: false,
  row: { id:'day1',staff_id:'staff1',staff_name:'موظف الاختبار',branch:'فرع الشامي',staff_branch:'فرع الشامي',
    staff_active:true,attendance_date:'2026-10-24',resolution_status:'early_leave_review',queue_lane:'manager',
    triage_code:'manager',issue_group:'early_leave',issue_label:'انصراف مبكر',raw_events:2,first_in:'2026-10-24T06:00:00Z',
    last_out:'2026-10-24T12:00:00Z',candidate_hours:6,status:'pending_review',scheduled_start_at:'2026-10-24T06:00:00Z',
    scheduled_end_at:'2026-10-24T14:00:00Z',late_minutes:0,early_leave_minutes:120,priority_code:'P1',sort_rank:1 }, requests: []
};
export const listAttendanceExceptionInbox = async () => state.row.status==='approved'?[]:[{...state.row}];
export const getAttendanceDiagnosticSummaryV1 = async () => ({total_cases:1,manager_cases:1,system_cases:0,causes:[]});
export const getAttendanceCaseDiagnosticV1 = async () => ({owner:'manager',confidence:100,blocking_reason:'راجع الدليل',suggested_actions:[],
  evidence:{canonical_finalizable:state.finalizable,canonical_route:'standard_v2',canonical_system_resolvable:false}});
export const getAttendanceDayEvidence = async () => { if(state.failRead) throw Error('fixture read outage'); return {...state.row}; };
export const resolveDatedAttendanceShift = async () => { state.shiftCalls++; await new Promise(r=>setTimeout(r,100));
  state.row.scheduled_end_at='2026-10-24T12:00:00Z'; state.row.candidate_hours=6; return {success:true}; };
export const approveAttendanceResolution = async () => { state.approvals++; state.row.status='approved'; return {...state.row}; };
export const isFormerAttendanceReviewRow = () => false;
export const listStaffTimeOffRequests = async () => state.requests;
export const createStaffTimeOffRequest = async () => { state.permissionCreates++; const r={id:'request1',request_kind:'permission',status:'pending',start_time:'09:00',end_time:'10:00',staff_id:'staff1',start_date:'2026-10-24',end_date:'2026-10-24'};state.requests.push(r); return r; };
export const getTimeOffRequestPreflightV3 = async () => ({allowed:false,blockers:[{label:'تجاوز سياسة الإذن'}]});
export const decideStaffTimeOffRequest = async () => {state.permissionDecisions++;};
export const materializeAttendanceRange=async()=>({});
export const getMissingPunchContextV1=async()=>({});
export const listStaffMissingPunchHistoryV1=async()=>[];
export const resolveMissingPunchIncidentV1=async()=>({});
export const approveAttendanceFullDayTimeOffV1=async()=>({});
export const getAnnualLeaveAttendancePreviewV1=async()=>({});
export const resolveAnnualLeaveFromAttendanceV1=async()=>({});
export const getWeeklyOffSwapPreviewV1=async()=>({});
export const resolveWeeklyOffSwapFromAttendanceV1=async()=>({});
`;
const result = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
import Center from './src/components/attendance/AttendanceResolutionCenter';
createRoot(document.getElementById('root')).render(React.createElement(Center,{initialDate:'2026-10-24'}));`, resolveDir:process.cwd(),loader:'js' },
  bundle:true,write:false,format:'esm',platform:'browser',jsx:'automatic',plugins:[{name:'fixtures',setup(b){
    b.onResolve({filter:/^@\/lib\/(attendance\/attendanceResolutionService|timeOffService|hr\/canonicalScheduleService)$/},()=>({path:'fixture',namespace:'fixture'}));
    b.onResolve({filter:/^@\/components\/attendance\/(EmployeeProfileDrawer|AttendanceCorrectionReviewPanel|AttendanceShiftMismatchReview)$/},()=>({path:'empty',namespace:'fixture'}));
    b.onResolve({filter:/^@\/hooks\/useAuth$/},()=>({path:'auth',namespace:'fixture'}));
    b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='fixture'?fixture:args.path==='auth'?"export const useAuth=()=>({user:{role:globalThis.fixture.role}})":'export default function Empty(){return null}',loader:'js'}));
  }}] });
const css=readdirSync('dist/assets').filter(file=>file.endsWith('.css')).map(file=>readFileSync('dist/assets/'+file,'utf8')).join('\n');
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':req.url==='/styles.css'?'text/css':'text/html; charset=utf-8');
  res.end(req.url==='/bundle.js'?result.outputFiles[0].text:req.url==='/styles.css'?css:'<html lang="ar" dir="rtl"><head><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;let passed=0;
try {
  browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL || 'msedge',headless:true});
  const page=await browser.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>route.request().url().startsWith('http://127.0.0.1:')?route.continue():route.abort());
  const url='http://127.0.0.1:'+server.address().port;
  async function open(){await page.goto(url);await page.getByRole('button',{name:'اتخاذ قرار',exact:true}).last().click();}
  async function check(name,fn){await fn();passed++;console.log('PASS '+name);}
  await open();
  await check('separate final approval starts disabled',async()=>assert.equal(await page.getByRole('button',{name:'اعتماد القرار النهائي',exact:true}).isDisabled(),true));
  await page.getByText('تصحيح الجدول',{exact:true}).click();
  await page.getByLabel('نهاية الشيفت',{exact:true}).fill('15:00');
  await page.getByLabel('ملاحظة القرار',{exact:true}).fill('دليل موثق لتعديل يوم واحد');
  const originalStart=await page.getByLabel('بداية الشيفت',{exact:true}).inputValue();
  await page.getByLabel('نهاية الشيفت',{exact:true}).fill(originalStart);
  await page.getByRole('button',{name:'حفظ شيفت هذا اليوم وإعادة مراجعة الحضور',exact:true}).click();
  await check('equal shift times are rejected before mutation',async()=>assert.equal(await page.evaluate(()=>fixture.shiftCalls),0));
  await page.getByLabel('نهاية الشيفت',{exact:true}).fill('15:00');
  page.on('dialog',d=>d.accept());
  await page.getByRole('button',{name:'حفظ شيفت هذا اليوم وإعادة مراجعة الحضور',exact:true}).click();
  await page.getByText('تم حفظ شيفت هذا اليوم. راجع الأدلة والساعات ثم اعتمد القرار النهائي.',{exact:true}).waitFor();
  await check('shift save keeps the real decision dialog open',async()=>assert.equal(await page.getByRole('heading',{name:'قرار حضور — موظف الاختبار'}).count(),1));
  await check('shift is saved exactly once',async()=>assert.equal(await page.evaluate(()=>fixture.shiftCalls),1));
  await check('shift does not implicitly approve attendance',async()=>assert.equal(await page.evaluate(()=>fixture.approvals),0));
  await check('post-save evidence enables separate approval',async()=>assert.equal(await page.getByRole('button',{name:'اعتماد القرار النهائي',exact:true}).isEnabled(),true));
  await page.getByRole('button',{name:'اعتماد القرار النهائي',exact:true}).evaluate(el=>{el.click();el.click();});
  await page.getByRole('heading',{name:'قرار حضور — موظف الاختبار'}).waitFor({state:'detached'});
  await check('verified approval removes pending case',async()=>{assert.equal(await page.evaluate(()=>fixture.approvals),1);assert.equal(await page.getByRole('button',{name:'اتخاذ قرار',exact:true}).count(),0);});
  await open();await page.getByText('إذن معتمد',{exact:true}).click();
  await page.getByLabel('بداية الإذن',{exact:true}).fill('09:00');await page.getByLabel('نهاية الإذن',{exact:true}).fill('10:00');
  await page.getByLabel('ملاحظة القرار',{exact:true}).fill('سبب الإذن موثق');
  await page.getByRole('button',{name:'حفظ الإذن وتحديث الأدلة',exact:true}).click();
  await page.getByText(/تم تسجيل طلب الإذن للمراجعة فقط/).waitFor();
  await check('blocked permission stays pending with visible policy reason',async()=>{assert.equal(await page.evaluate(()=>fixture.permissionCreates),1);assert.equal(await page.evaluate(()=>fixture.permissionDecisions),0);assert.equal(await page.evaluate(()=>fixture.approvals),0);});
  await page.getByRole('button',{name:'حفظ الإذن وتحديث الأدلة',exact:true}).click();
  await check('retry reuses pending permission',async()=>assert.equal(await page.evaluate(()=>fixture.permissionCreates),1));
  await page.evaluate(()=>{fixture.failRead=true;});
  await page.getByRole('button',{name:'تحديث أدلة اليوم',exact:true}).click();
  await page.getByText(/تعذر التحقق من الأدلة/).waitFor();
  await check('read outage blocks final approval',async()=>assert.equal(await page.getByRole('button',{name:'اعتماد القرار النهائي',exact:true}).isDisabled(),true));
  await open();await page.getByLabel('ملاحظة القرار',{exact:true}).fill('دليل موثق');
  await page.evaluate(()=>{fixture.finalizable=false;});
  await page.getByRole('button',{name:'تحديث أدلة اليوم',exact:true}).click();
  await page.getByText('تم تحديث الأدلة من قاعدة البيانات',{exact:true}).waitFor();
  await check('unresolved canonical evidence blocks approval',async()=>assert.equal(await page.getByRole('button',{name:'اعتماد القرار النهائي',exact:true}).isDisabled(),true));
  await page.evaluate(()=>{fixture.finalizable=true;fixture.role='doctor';});
  await page.getByRole('button',{name:'تحديث أدلة اليوم',exact:true}).click();
  await check('user without payroll approval permission cannot finalize',async()=>assert.equal(await page.getByRole('button',{name:'اعتماد القرار النهائي',exact:true}).isDisabled(),true));
  await page.setViewportSize({width:390,height:844});
  await check('mobile dialog remains usable',async()=>assert.equal(await page.getByRole('heading',{name:'قرار حضور — موظف الاختبار'}).isVisible(),true));
  if(process.env.ATTENDANCE_UI_SCREENSHOT) await page.screenshot({path:process.env.ATTENDANCE_UI_SCREENSHOT,fullPage:true});
  assert.deepEqual(errors,[]);console.log('Browser contract: '+passed+' passed, 0 failed. Fixtures only; database not tested.');
} finally {await browser?.close();await new Promise(r=>server.close(r));}
