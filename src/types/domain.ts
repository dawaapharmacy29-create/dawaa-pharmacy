export type CustomerMetric = {
  id: string;
  final_customer_key: string | null;
  customer_id: string | null;
  customer_code: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  phone: string | null;
  name: string | null;
  branch: string | null;
  invoices_count: number;
  total_spent: number;
  total_purchases: number;
  avg_invoice: number;
  first_purchase: string | null;
  last_purchase: string | null;
  active_months: number;
  avg_monthly: number;
  segment: string;
  type: string;
  customer_status: string;
  status: string;
  retention_status: string;
};

export type CustomerLike = Record<string, unknown>;

export type SalesInvoiceLike = Record<string, unknown>;
