import type { InvoiceLike } from '@/lib/invoices/invoiceCore';

// Sanitized Local-only snapshot: exact candidate headers and item rows, with customer contact fields omitted.
export interface GoldenCaseInvoiceItemRow {
  invoice_id: string;
  invoice_number: string;
  branch: string;
  product_id?: string;
  product_code: string;
  product_name: string;
  quantity: number;
}

export const GOLDEN_CASE_1_INVOICES: InvoiceLike[] = [
  {
    id: '69e76fcb-b871-44a0-8f84-91619234b4e2',
    invoice_number: '74720',
    invoice_datetime: '2026-09-26T22:03:00+03:00',
    branch: 'فرع شكري',
    branch_name: null,
    seller_name: 'د دنيا',
    staff_id: null,
    customer_code: '5179',
    customer_name: null,
    net_amount: 1579,
  },
  {
    id: 'local-parity-74947-cdebcad6-2720-47c2-aa56-755e94b8e1fb',
    invoice_number: '74947',
    invoice_datetime: '2026-09-28T01:51:00+03:00',
    branch: 'فرع شكري',
    branch_name: 'فرع شكري',
    seller_name: 'د وائل',
    staff_id: null,
    customer_code: '5179',
    customer_name: 'محمد الجندي2',
    net_amount: 180,
  },
  {
    id: 'a925f3ae-e5eb-426a-b529-5cc2d0d9c49c',
    invoice_number: '74956',
    invoice_datetime: '2026-09-28T03:08:00+03:00',
    branch: 'فرع شكري',
    branch_name: null,
    seller_name: 'د محمد شبل',
    staff_id: null,
    customer_code: '5179',
    customer_name: null,
    net_amount: 155,
  },
];

export const GOLDEN_CASE_1_INVOICE_ITEMS: GoldenCaseInvoiceItemRow[] = [
  { invoice_id: '69e76fcb-b871-44a0-8f84-91619234b4e2', invoice_number: '74720', branch: 'فرع شكري', product_code: '30088', product_name: 'BEBELAC EC MILK', quantity: 3 },
  { invoice_id: '69e76fcb-b871-44a0-8f84-91619234b4e2', invoice_number: '74720', branch: 'فرع شكري', product_code: '30088', product_name: 'BEBELAC EC MILK', quantity: 1 },
  { invoice_id: '69e76fcb-b871-44a0-8f84-91619234b4e2', invoice_number: '74720', branch: 'فرع شكري', product_code: '36426', product_name: 'FLAGYL SUSP', quantity: 1 },
  { invoice_id: '69e76fcb-b871-44a0-8f84-91619234b4e2', invoice_number: '74720', branch: 'فرع شكري', product_code: '4620', product_name: 'GAST-REG SYRUP', quantity: 1 },
  { invoice_id: '69e76fcb-b871-44a0-8f84-91619234b4e2', invoice_number: '74720', branch: 'فرع شكري', product_code: '79693', product_name: 'توصيل منزلي', quantity: 1 },
  { invoice_id: '69e76fcb-b871-44a0-8f84-91619234b4e2', invoice_number: '74720', branch: 'فرع شكري', product_code: 'W', product_name: 'DISTILLED WATER SYRUP', quantity: 2 },
  { invoice_id: 'local-parity-74947-cdebcad6-2720-47c2-aa56-755e94b8e1fb', invoice_number: '74947', branch: 'فرع شكري', product_id: '60bf9629-2e60-479f-a811-972da45ae836', product_code: '67929', product_name: 'PEDICORT FORTE SYRUP 100 ML', quantity: 1 },
  { invoice_id: 'local-parity-74947-cdebcad6-2720-47c2-aa56-755e94b8e1fb', invoice_number: '74947', branch: 'فرع شكري', product_code: '69803', product_name: 'Omepure Drops 10 ml', quantity: 1 },
  { invoice_id: 'local-parity-74947-cdebcad6-2720-47c2-aa56-755e94b8e1fb', invoice_number: '74947', branch: 'فرع شكري', product_code: '79693', product_name: 'توصيل منزلي', quantity: 1 },
  { invoice_id: 'a925f3ae-e5eb-426a-b529-5cc2d0d9c49c', invoice_number: '74956', branch: 'فرع شكري', product_code: '56832', product_name: 'CERELAC WHEAT WITHOUT MILK 400 GM', quantity: 1 },
  { invoice_id: 'a925f3ae-e5eb-426a-b529-5cc2d0d9c49c', invoice_number: '74956', branch: 'فرع شكري', product_code: '6944', product_name: 'GYNOZOL 400MG VAGINAL SUPP', quantity: 1 },
  { invoice_id: 'a925f3ae-e5eb-426a-b529-5cc2d0d9c49c', invoice_number: '74956', branch: 'فرع شكري', product_code: '79693', product_name: 'توصيل منزلي', quantity: 1 },
];
