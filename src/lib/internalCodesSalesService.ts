import { readInternalCodeLedgerPage } from '@/lib/readModels/invoiceRecordReadModel';
export type Invoice = { id: string; invoice_number: string | null; invoice_date: string | null; customer_code: string | null; branch: string | null; customer_name: string | null; net_amount: number | null; net_total: number | null; amount: number | null; seller_name: string | null };
export async function loadInternalCodeInvoices(codes: string[], from: string, to: string, branch: string): Promise<Invoice[]> {
 const loaded: Invoice[]=[]; const pageSize=500;
 const previousDay=(value:string)=>{const d=new Date(value+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-1);return d.toISOString().slice(0,10);};
 const nextDay=(value:string)=>{const d=new Date(value+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10);};
 for(let offset=0;;offset+=pageSize){const page=(await readInternalCodeLedgerPage(codes,previousDay(from)+'T00:00:00Z',nextDay(to)+'T00:00:00Z',branch,offset,pageSize)) as Invoice[];loaded.push(...page);if(page.length<pageSize)break;if(offset>=100000)throw new Error('حجم النتائج كبير. قلل الفترة ثم أعد المحاولة.');}return loaded;
}
