import { supabase } from '@/lib/supabase';

export type PerformanceSalesCycleRow={
 cycle_start?:string;cycle_end?:string;sales?:number;invoices?:number;customers?:number;first_sale_date?:string|null;
};
export type PerformanceSalesPeriodRow={sales?:number;invoices?:number;customers?:number;first_sale_date?:string|null};
export type PerformanceSalesBundlePayload={
 cycles?:PerformanceSalesCycleRow[];
 samePeriod?:{current?:PerformanceSalesPeriodRow;previous?:PerformanceSalesPeriodRow};
 dataAsOf?:string|null;effectiveDays?:number|null;
 /** Set when the caller may read only one branch: every figure is limited to that branch. */
 scopeBranch?:string|null;
};
type Cached={at:number;promise:Promise<{payload:PerformanceSalesBundlePayload;error:unknown}>};
const cache=new Map<string,Cached>();
const TTL_MS=60_000;
export function invalidatePerformanceSalesBundleCache(staffId?:string){
 for(const key of cache.keys())if(!staffId||key.startsWith(staffId+':'))cache.delete(key);
}
export function loadPerformanceSalesBundle(args:{staffId:string;windowStart:string;windowEnd:string;currentStart:string;elapsedDays:number}){
 const key=[args.staffId,args.windowStart,args.windowEnd,args.currentStart,args.elapsedDays].join(':');
 const existing=cache.get(key);
 if(existing&&Date.now()-existing.at<TTL_MS)return existing.promise;
 const promise=supabase.rpc('get_staff_performance_sales_bundle_v1',{
  p_staff_id:args.staffId,p_window_start:args.windowStart,p_window_end:args.windowEnd,p_current_start:args.currentStart,p_elapsed_days:args.elapsedDays,
 }).then(({data,error})=>({payload:(data||{}) as PerformanceSalesBundlePayload,error}));
 cache.set(key,{at:Date.now(),promise});
 void promise.then(result=>{if(result.error&&cache.get(key)?.promise===promise)cache.delete(key)}).catch(()=>{if(cache.get(key)?.promise===promise)cache.delete(key)});
 return promise;
}
