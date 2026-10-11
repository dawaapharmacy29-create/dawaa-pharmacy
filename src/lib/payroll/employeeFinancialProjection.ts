export type FinancialComponentState='settled'|'pending'|'unavailable'|'not_applicable';
export type FinancialComponentKey='base_salary'|'performance_incentive'|'target_incentive'|'product_incentive'|'near_expiry_incentive'|'overtime'|'other_adjustments';

export type FinancialComponent={
 key:FinancialComponentKey;
 label:string;
 state:FinancialComponentState;
 amountEgp:number|null;
 source:string;
 settlementId?:string|null;
 evidenceRefs?:string[];
 note?:string;
};

export type EmployeeFinancialProjection={
 schema:'employee_financial_projection_v1';
 ready:boolean;
 payableTotalEgp:number|null;
 pendingTotalEgp:number;
 blockers:string[];
 components:FinancialComponent[];
};

const payable=(x:FinancialComponent)=>x.state==='settled'&&Number.isFinite(x.amountEgp);
const pending=(x:FinancialComponent)=>x.state==='pending'&&Number.isFinite(x.amountEgp);

export function buildEmployeeFinancialProjection(components:FinancialComponent[]):EmployeeFinancialProjection{
 const required:FinancialComponentKey[]=['base_salary','performance_incentive','target_incentive','product_incentive','near_expiry_incentive','overtime','other_adjustments'];
 const counts=new Map<FinancialComponentKey,number>();
 for(const item of components)counts.set(item.key,(counts.get(item.key)||0)+1);
 const byKey=new Map(components.map(x=>[x.key,x]));
 const normalized=required.map(key=>byKey.get(key)??({
  key,label:key,state:'unavailable',amountEgp:null,source:'missing'
 } as FinancialComponent));
 const blockers=[
  ...normalized.filter(x=>x.state==='unavailable').map(x=>`${x.label}: unavailable`),
  ...normalized.filter(x=>(x.state==='settled'||x.state==='pending')&&!Number.isFinite(x.amountEgp)).map(x=>`${x.label}: invalid amount`),
  ...required.filter(key=>(counts.get(key)||0)>1).map(key=>`${key}: duplicate component`),
 ];
 const ready=blockers.length===0&&normalized.every(x=>x.state==='settled'||x.state==='not_applicable');
 const payableTotalEgp=ready?Math.round(normalized.filter(payable).reduce((n,x)=>n+(x.amountEgp||0),0)*100)/100:null;
 const pendingTotalEgp=Math.round(normalized.filter(pending).reduce((n,x)=>n+(x.amountEgp||0),0)*100)/100;
 return {schema:'employee_financial_projection_v1',ready,payableTotalEgp,pendingTotalEgp,blockers,components:normalized};
}
