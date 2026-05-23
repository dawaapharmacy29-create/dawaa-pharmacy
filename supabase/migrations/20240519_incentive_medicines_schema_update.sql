-- Migration to update incentive_medicines table schema
-- Date: 2024-05-19

-- Add missing columns to incentive_medicines table
ALTER TABLE public.incentive_medicines
ADD COLUMN IF NOT EXISTS product_type TEXT,
ADD COLUMN IF NOT EXISTS product_price NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS incentive_type TEXT DEFAULT 'fixed',
ADD COLUMN IF NOT EXISTS incentive_percent NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS sold_quantity INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS responsible_doctor TEXT,
ADD COLUMN IF NOT EXISTS source_file_date DATE;

-- Add index for incentive medicines
CREATE INDEX IF NOT EXISTS incentive_medicines_active_incentive_idx 
ON public.incentive_medicines(active, incentive_value DESC);

-- Add comment for documentation
COMMENT ON COLUMN public.incentive_medicines.product_type IS 'Product type/category (e.g., تخسيس, معدة, مضاد حيوي)';
COMMENT ON COLUMN public.incentive_medicines.product_price IS 'Selling price of the product';
COMMENT ON COLUMN public.incentive_medicines.incentive_type IS 'Type of incentive: fixed (amount per unit) or percent (percentage of price)';
COMMENT ON COLUMN public.incentive_medicines.incentive_percent IS 'Incentive percentage when incentive_type is percent';
COMMENT ON COLUMN public.incentive_medicines.sold_quantity IS 'Quantity sold/dispensed';
COMMENT ON COLUMN public.incentive_medicines.responsible_doctor IS 'Doctor responsible for selling this product';
COMMENT ON COLUMN public.incentive_medicines.source_file_date IS 'Date of the source file from which data was imported';
