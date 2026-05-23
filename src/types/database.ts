export interface Customer {
  id: string;
  customer_code?: string | null;
  name: string;
  phone: string;
  branch: string | null;
  type: string | null;
  avg_monthly: number | null;
  total_purchases: number | null;
  total_invoices: number | null;
  avg_invoice: number | null;
  clv: number | null;
  risk_score: number | null;
  retention_status: string | null;
  last_purchase: string | null;
  first_purchase: string | null;
  notes: string | null;
  whatsapp_notes: string | null;
  customer_notes: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface DailyFollowup {
  id: string;
  customer_id: string | null;
  customer_code?: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  branch: string | null;
  status: string | null;
  assigned_to: string | null;
  notes: string | null;
  date?: string | null;
  followup_date: string | null;
  category?: string | null;
  suggested_action?: string | null;
  followup_type?: string | null;
  priority?: string | null;
  contact_method?: string | null;
  followup_summary?: string | null;
  followup_result?: string | null;
  next_followup_date?: string | null;
  request_type?: string | null;
  request_details?: string | null;
  request_status?: string | null;
  purchase_after_followup?: boolean | null;
  purchase_invoice_no?: string | null;
  purchase_amount?: number | null;
  purchase_date?: string | null;
  closed_at?: string | null;
  created_by?: string | null;
  created_by_name?: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface Branch {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  manager_id: string | null;
  active: boolean | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface Staff {
  id: string;
  name: string;
  username: string | null;
  phone: string | null;
  role: string | null;
  branch: string | null;
  active: boolean | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface Complaint {
  id: string;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  branch: string | null;
  status: string | null;
  priority: string | null;
  details: string | null;
  assigned_to: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface ConversationReview {
  id: string;
  customer_id: string | null;
  staff_id: string | null;
  branch: string | null;
  channel: string | null;
  rating: number | null;
  notes: string | null;
  reviewed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}
