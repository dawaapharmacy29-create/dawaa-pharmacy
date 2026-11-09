import { supabase } from '@/lib/supabase';

export type ListIncentiveInvoiceLine = {
  invoice_id: string;
  invoice_number: string;
  sale_date: string;
  branch: string;
  line_no: number;
  seller_id: string | null;
  seller_name: string | null;
  attribution: 'eligible' | 'not_eligible' | 'unlinked';
  product_code: string;
  medicine_id: string | null;
  kind: 'list' | 'stagnant';
  units: number;
  rate: number;
};

/** Failures throw, so an outage can never look like a cycle with no sales. */
export async function getListIncentiveInvoiceLines(args: {
  start: string;
  end: string;
}): Promise<ListIncentiveInvoiceLine[]> {
  const { data, error } = await supabase
    .rpc('get_list_incentive_invoice_lines_v1', { p_start: args.start, p_end: args.end, p_branch: null })
    .eq('kind', 'list')
    .limit(5000);
  if (error) throw new Error(error.message);
  return (data || []) as ListIncentiveInvoiceLine[];
}
