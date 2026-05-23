-- Migration for Penalty and Incentive System
-- Date: 2024-05-16

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create penalty_incentive_rules table for fixed rules
CREATE TABLE IF NOT EXISTS public.penalty_incentive_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL CHECK (category IN ('delivery', 'doctor', 'branch')),
  rule_type TEXT NOT NULL CHECK (rule_type IN ('penalty', 'incentive')),
  point_value NUMERIC NOT NULL DEFAULT 0,
  applies_to TEXT NOT NULL CHECK (applies_to IN ('delivery', 'doctor', 'branch')),
  severity TEXT CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  repeat_multiplier NUMERIC DEFAULT 2,
  repeat_period_start_day INTEGER DEFAULT 26,
  max_repeat_count INTEGER DEFAULT 5,
  requires_approval BOOLEAN DEFAULT FALSE,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default delivery penalty rules
INSERT INTO public.penalty_incentive_rules (code, title, description, category, rule_type, point_value, applies_to, severity, repeat_multiplier, repeat_period_start_day) VALUES
('DEL_COMPLAINT', 'شكوى عميل', 'شكوى من العميل على خدمة التوصيل', 'delivery', 'penalty', -40, 'delivery', 'high', 2, 26),
('DEL_LATE', 'تأخير في التوصيل', 'تأخير في وقت التوصيل المحدد', 'delivery', 'penalty', -20, 'delivery', 'medium', 2, 26),
('DEL_WRONG', 'توصيل منتج خاطئ', 'توصيل منتج مختلف عن المطلوب', 'delivery', 'penalty', -30, 'delivery', 'high', 2, 26),
('DEL_RUDE', 'سلوك غير مهني', 'سلوك غير مهني مع العميل', 'delivery', 'penalty', -50, 'delivery', 'critical', 2, 26),
('DEL_DAMAGE', 'تلف المنتج', 'تلف المنتج أثناء التوصيل', 'delivery', 'penalty', -25, 'delivery', 'high', 2, 26),
('DEL_FAST', 'توصيل سريع', 'توصيل أسرع من الوقت المحدد', 'delivery', 'incentive', 15, 'delivery', 'low', 1, 26),
('DEL_EXCELLENT', 'تقييم ممتاز', 'تقييم ممتاز من العميل', 'delivery', 'incentive', 25, 'delivery', 'medium', 1, 26)
ON CONFLICT (code) DO NOTHING;

-- Insert default doctor penalty rules
INSERT INTO public.penalty_incentive_rules (code, title, description, category, rule_type, point_value, applies_to, severity, repeat_multiplier, repeat_period_start_day) VALUES
('DOC_COMPLAINT', 'شكوى عميل', 'شكوى من العميل على خدمة الصيدلاني', 'doctor', 'penalty', -50, 'doctor', 'high', 2, 26),
('DOC_ERROR', 'خطأ دوائي', 'خطأ في صرف الدواء', 'doctor', 'penalty', -100, 'doctor', 'critical', 2, 26),
('DOC_RUDE', 'سلوك غير مهني', 'سلوك غير مهني مع العميل', 'doctor', 'penalty', -60, 'doctor', 'critical', 2, 26),
('DOC_EXCELLENT', 'تقييم ممتاز', 'تقييم ممتاز من العميل', 'doctor', 'incentive', 30, 'doctor', 'medium', 1, 26),
('DOC_SALES_TARGET', 'تحقيق هدف المبيعات', 'تحقيق هدف المبيعات الشهري', 'doctor', 'incentive', 50, 'doctor', 'medium', 1, 26)
ON CONFLICT (code) DO NOTHING;

-- Insert default branch penalty rules
INSERT INTO public.penalty_incentive_rules (code, title, description, category, rule_type, point_value, applies_to, severity, repeat_multiplier, repeat_period_start_day) VALUES
('BRANCH_INVENTORY', 'مشاكل في الجرد', 'مشاكل في الجرد أو نقص في المخزون', 'branch', 'penalty', -50, 'branch', 'high', 1, 26),
('BRANCH_HYGIENE', 'نظافة الفرع', 'عدم الالتزام بمعايير النظافة', 'branch', 'penalty', -30, 'branch', 'medium', 1, 26),
('BRANCH_COMPLAINT', 'شكاوى متعددة', 'شكاوى متعددة على الفرع', 'branch', 'penalty', -40, 'branch', 'high', 1, 26)
ON CONFLICT (code) DO NOTHING;

-- Create penalty_incentive_records table to track all penalties/incentives
CREATE TABLE IF NOT EXISTS public.penalty_incentive_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rule_code TEXT NOT NULL REFERENCES public.penalty_incentive_rules(code),
  employee_id UUID,
  employee_name TEXT,
  employee_role TEXT,
  branch TEXT NOT NULL,
  shift TEXT,
  record_date DATE NOT NULL DEFAULT CURRENT_DATE,
  cycle_month_start DATE NOT NULL,
  base_points NUMERIC NOT NULL,
  repeat_count INTEGER DEFAULT 0,
  multiplier NUMERIC DEFAULT 1,
  final_points NUMERIC NOT NULL,
  notes TEXT,
  recorded_by UUID,
  recorded_by_name TEXT,
  status TEXT DEFAULT 'applied' CHECK (status IN ('pending', 'applied', 'cancelled')),
  source_type TEXT,
  source_record_id UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for penalty_incentive_records
CREATE INDEX IF NOT EXISTS penalty_incentive_records_employee_idx ON public.penalty_incentive_records(employee_id, record_date DESC);
CREATE INDEX IF NOT EXISTS penalty_incentive_records_branch_idx ON public.penalty_incentive_records(branch, record_date DESC);
CREATE INDEX IF NOT EXISTS penalty_incentive_records_cycle_idx ON public.penalty_incentive_records(cycle_month_start, employee_id);

-- Create branch_penalty_distributions table to track branch-wide penalties
CREATE TABLE IF NOT EXISTS public.branch_penalty_distributions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rule_code TEXT NOT NULL REFERENCES public.penalty_incentive_rules(code),
  branch TEXT NOT NULL,
  shift TEXT,
  total_penalty_points NUMERIC NOT NULL,
  affected_doctors INTEGER NOT NULL,
  points_per_doctor NUMERIC NOT NULL,
  distribution_date DATE NOT NULL DEFAULT CURRENT_DATE,
  cycle_month_start DATE NOT NULL,
  notes TEXT,
  recorded_by UUID,
  recorded_by_name TEXT,
  status TEXT DEFAULT 'applied' CHECK (status IN ('pending', 'applied', 'cancelled')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for branch_penalty_distributions
CREATE INDEX IF NOT EXISTS branch_penalty_distributions_branch_idx ON public.branch_penalty_distributions(branch, distribution_date DESC);

-- Add date_end column to shift_exceptions if not exists (for multi-day leaves)
ALTER TABLE public.shift_exceptions 
ADD COLUMN IF NOT EXISTS date_end DATE;

-- Add trigger function to calculate cycle month start (26th of previous month)
CREATE OR REPLACE FUNCTION get_cycle_month_start(p_date DATE)
RETURNS DATE AS $$
BEGIN
    IF EXTRACT(DAY FROM p_date) >= 26 THEN
        RETURN DATE_TRUNC('month', p_date) + INTERVAL '25 days';
    ELSE
        RETURN DATE_TRUNC('month', p_date - INTERVAL '1 month') + INTERVAL '25 days';
    END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Add trigger function to calculate repeat count and multiplier
CREATE OR REPLACE FUNCTION calculate_penalty_multiplier()
RETURNS TRIGGER AS $$
DECLARE
    v_repeat_count INTEGER;
    v_cycle_start DATE;
    v_rule RECORD;
BEGIN
    -- Get the rule details
    SELECT * INTO v_rule FROM public.penalty_incentive_rules WHERE code = NEW.rule_code;
    
    -- Calculate cycle month start
    v_cycle_start := get_cycle_month_start(NEW.record_date);
    NEW.cycle_month_start := v_cycle_start;
    
    -- Count previous occurrences in the same cycle
    SELECT COUNT(*) INTO v_repeat_count
    FROM public.penalty_incentive_records
    WHERE rule_code = NEW.rule_code
      AND employee_id = NEW.employee_id
      AND cycle_month_start = v_cycle_start
      AND status = 'applied';
    
    NEW.repeat_count := v_repeat_count;
    
    -- Calculate multiplier based on repeat count
    IF v_repeat_count > 0 AND v_rule.repeat_multiplier > 1 THEN
        NEW.multiplier := POWER(v_rule.repeat_multiplier, LEAST(v_repeat_count, v_rule.max_repeat_count));
    ELSE
        NEW.multiplier := 1;
    END IF;
    
    -- Calculate final points
    NEW.final_points := NEW.base_points * NEW.multiplier;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add trigger for penalty_incentive_records
CREATE TRIGGER calculate_penalty_multiplier_trigger
    BEFORE INSERT ON public.penalty_incentive_records
    FOR EACH ROW EXECUTE FUNCTION calculate_penalty_multiplier();

-- Add updated_at trigger for new tables
CREATE TRIGGER update_penalty_incentive_records_updated_at BEFORE UPDATE ON public.penalty_incentive_records
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_branch_penalty_distributions_updated_at BEFORE UPDATE ON public.branch_penalty_distributions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create view for monthly performance summary
CREATE OR REPLACE VIEW monthly_performance_summary AS
SELECT 
    employee_id,
    employee_name,
    employee_role,
    branch,
    cycle_month_start,
    COUNT(*) as total_records,
    SUM(CASE WHEN final_points < 0 THEN ABS(final_points) ELSE 0 END) as total_deductions,
    SUM(CASE WHEN final_points > 0 THEN final_points ELSE 0 END) as total_incentives,
    SUM(final_points) as net_points,
    RANK() OVER (PARTITION BY branch, cycle_month_start ORDER BY SUM(final_points) DESC) as branch_rank,
    RANK() OVER (PARTITION BY cycle_month_start ORDER BY SUM(final_points) DESC) as overall_rank
FROM public.penalty_incentive_records
WHERE status = 'applied'
GROUP BY employee_id, employee_name, employee_role, branch, cycle_month_start;
