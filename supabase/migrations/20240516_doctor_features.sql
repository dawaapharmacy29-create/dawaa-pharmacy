-- Migration for doctor-specific features
-- Date: 2024-05-16

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create conversation_sales_reviews table (if not exists)
CREATE TABLE IF NOT EXISTS public.conversation_sales_reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reviewer_id UUID,
  reviewer_name TEXT,
  reviewer_role TEXT,
  staff_id UUID,
  staff_name TEXT,
  staff_role TEXT,
  branch TEXT,
  customer_id TEXT,
  customer_name TEXT,
  customer_code TEXT,
  customer_phone TEXT,
  evaluation_kind TEXT,
  invoice_number TEXT,
  invoice_time TIMESTAMP,
  evaluation_reason TEXT,
  total_score NUMERIC,
  raw_scores JSONB,
  has_complaint BOOLEAN DEFAULT FALSE,
  has_medical_error BOOLEAN DEFAULT FALSE,
  has_invoice_error BOOLEAN DEFAULT FALSE,
  reviewer_notes TEXT,
  training_recommendation TEXT,
  final_score NUMERIC,
  point_impact NUMERIC,
  impact_status TEXT DEFAULT 'approved',
  reviewed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for conversation_sales_reviews
CREATE INDEX IF NOT EXISTS conversation_sales_reviews_staff_idx ON public.conversation_sales_reviews(staff_id, created_at DESC);
CREATE INDEX IF NOT EXISTS conversation_sales_reviews_reviewer_idx ON public.conversation_sales_reviews(reviewer_id, created_at DESC);

-- Create stagnant_medicines table
CREATE TABLE IF NOT EXISTS public.stagnant_medicines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  medicine_name TEXT NOT NULL,
  usage TEXT,
  expiry_date DATE,
  quantity_available INTEGER DEFAULT 0,
  branch TEXT NOT NULL,
  priority TEXT DEFAULT 'medium',
  notes TEXT,
  uploaded_by UUID,
  upload_date DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for stagnant_medicines
CREATE INDEX IF NOT EXISTS stagnant_medicines_branch_idx ON public.stagnant_medicines(branch, priority);

-- Create incentive_medicines table
CREATE TABLE IF NOT EXISTS public.incentive_medicines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_name TEXT NOT NULL,
  incentive_value NUMERIC DEFAULT 0,
  current_quantity INTEGER DEFAULT 0,
  branch TEXT NOT NULL,
  active BOOLEAN DEFAULT TRUE,
  effective_date DATE DEFAULT CURRENT_DATE,
  expiry_date DATE,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for incentive_medicines
CREATE INDEX IF NOT EXISTS incentive_medicines_branch_idx ON public.incentive_medicines(branch, active);

-- Add customer_notes column to customers table if not exists
ALTER TABLE public.customers 
ADD COLUMN IF NOT EXISTS customer_notes TEXT;

-- Create doctor_permissions table
CREATE TABLE IF NOT EXISTS public.doctor_permissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  doctor_id UUID NOT NULL,
  doctor_name TEXT NOT NULL,
  can_view_dashboard BOOLEAN DEFAULT TRUE,
  can_view_analytics BOOLEAN DEFAULT TRUE,
  can_view_customers BOOLEAN DEFAULT TRUE,
  can_view_reviews BOOLEAN DEFAULT TRUE,
  can_view_points BOOLEAN DEFAULT TRUE,
  can_edit_customers BOOLEAN DEFAULT FALSE,
  can_add_reviews BOOLEAN DEFAULT FALSE,
  can_view_stagnant_medicines BOOLEAN DEFAULT TRUE,
  can_view_incentive_medicines BOOLEAN DEFAULT TRUE,
  branch_access TEXT[] DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for doctor_permissions
CREATE INDEX IF NOT EXISTS doctor_permissions_doctor_idx ON public.doctor_permissions(doctor_id);

-- Create doctor_metrics table for storing daily/monthly metrics
CREATE TABLE IF NOT EXISTS public.doctor_metrics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  doctor_id UUID NOT NULL,
  doctor_name TEXT NOT NULL,
  branch TEXT NOT NULL,
  metric_date DATE NOT NULL,
  daily_sales NUMERIC DEFAULT 0,
  monthly_sales NUMERIC DEFAULT 0,
  daily_invoice_count INTEGER DEFAULT 0,
  monthly_invoice_count INTEGER DEFAULT 0,
  points_balance INTEGER DEFAULT 0,
  rewards_balance NUMERIC DEFAULT 0,
  discount_balance NUMERIC DEFAULT 0,
  customers_to_contact INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for doctor_metrics
CREATE INDEX IF NOT EXISTS doctor_metrics_doctor_date_idx ON public.doctor_metrics(doctor_id, metric_date DESC);

-- Add updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Add triggers for updated_at
CREATE TRIGGER update_stagnant_medicines_updated_at BEFORE UPDATE ON public.stagnant_medicines
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_incentive_medicines_updated_at BEFORE UPDATE ON public.incentive_medicines
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_doctor_permissions_updated_at BEFORE UPDATE ON public.doctor_permissions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_doctor_metrics_updated_at BEFORE UPDATE ON public.doctor_metrics
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
