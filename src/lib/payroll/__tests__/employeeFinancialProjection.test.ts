import { describe,expect,it } from 'vitest';
import { buildEmployeeFinancialProjection,type FinancialComponent } from '../employeeFinancialProjection';

const base:FinancialComponent[]=[
 {key:'base_salary',label:'الراتب الأساسي',state:'settled',amountEgp:5000,source:'payroll'},
 {key:'performance_incentive',label:'حافز الأداء',state:'settled',amountEgp:1500,source:'performance_settlement'},
 {key:'target_incentive',label:'حافز التارجت',state:'settled',amountEgp:600,source:'target_settlement'},
 {key:'product_incentive',label:'حافز اللستة والرواكد',state:'settled',amountEgp:100,source:'product_settlement'},
 {key:'near_expiry_incentive',label:'حافز قرب الصلاحية',state:'not_applicable',amountEgp:0,source:'near_expiry_settlement'},
 {key:'overtime',label:'الأوفر تايم',state:'settled',amountEgp:200,source:'overtime_settlement'},
 {key:'other_adjustments',label:'تسويات أخرى',state:'settled',amountEgp:-50,source:'payroll_adjustments'},
];

describe('employee financial projection',()=>{
 it('sums only a fully settled projection',()=>{
  const x=buildEmployeeFinancialProjection(base);
  expect(x.ready).toBe(true);expect(x.payableTotalEgp).toBe(7350);
 });
 it('never pays through an unavailable component',()=>{
  const x=buildEmployeeFinancialProjection(base.map(v=>v.key==='target_incentive'?{...v,state:'unavailable',amountEgp:null}:v));
  expect(x.ready).toBe(false);expect(x.payableTotalEgp).toBeNull();
 });
 it('keeps pending money visible but excluded from payable total',()=>{
  const x=buildEmployeeFinancialProjection(base.map(v=>v.key==='overtime'?{...v,state:'pending',amountEgp:200}:v));
  expect(x.ready).toBe(false);expect(x.payableTotalEgp).toBeNull();expect(x.pendingTotalEgp).toBe(200);
 });
});
