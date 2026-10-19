import { supabase } from '@/lib/supabase';
type Invoice = { id: string; invoice_number: string | null; invoice_date: string | null; customer_code: string | null; branch: string | null; customer_name: string | null; net_amount: number | null; net_total: number | null; amount: number | null; seller_name: string | null };
export async function loadInternalCodeInvoices(codes: string[], from: string, to: string, branch: string): Promise<Invoice[]> {
 const loaded: Invoice[]=[]; const pageSize=500;
 const previousDay=(value:string)=>{const d=new Date(value+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-1);return d.toISOString().slice(0,10);};
 const nextDay=(value:string)=>{const d=new Date(value+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10);};
 for(let offset=0;;offset+=pageSize){let query=supabase.from('sales_invoices').select('id,invoice_number,invoice_date,customer_code,branch,customer_name,net_amount,net_total,amount,seller_name').in('customer_code',codes).gte('invoice_date',previousDay(from)+'T00:00:00Z').lt('invoice_date',nextDay(to)+'T00:00:00Z').order('invoice_date',{ascending:true}).order('id',{ascending:true}).range(offset,offset+pageSize-1); if(branch!=='all')query=query.eq('branch',branch);const result=await query;if(result.error)throw new Error(result.error.message);const page=(result.data||[]) as Invoice[];loaded.push(...page);if(page.length<pageSize)break;if(offset>=100000)throw new Error('حجم النتائج كبير. قلل الفترة ثم أعد المحاولة.');}return loaded;
}
