-- Migration to update stagnant_medicines table schema
-- Date: 2024-05-19

-- Add missing columns to stagnant_medicines table
ALTER TABLE public.stagnant_medicines
ADD COLUMN IF NOT EXISTS product_type TEXT,
ADD COLUMN IF NOT EXISTS batch_details JSONB,
ADD COLUMN IF NOT EXISTS responsible_doctor TEXT,
ADD COLUMN IF NOT EXISTS dispensed_quantity INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_dispensed_at DATE,
ADD COLUMN IF NOT EXISTS source_file_date DATE;

-- Add index for batch details if needed
CREATE INDEX IF NOT EXISTS stagnant_medicines_priority_expiry_idx 
ON public.stagnant_medicines(priority, expiry_date);

-- Add comment for documentation
COMMENT ON COLUMN public.stagnant_medicines.batch_details IS 'JSON array of expiry batches with quantity and expiry_date';
COMMENT ON COLUMN public.stagnant_medicines.product_type IS 'Product type/category (e.g., معدة, تخسيس, مضاد حيوي)';
COMMENT ON COLUMN public.stagnant_medicines.responsible_doctor IS 'Doctor responsible for moving this stagnant medicine';
COMMENT ON COLUMN public.stagnant_medicines.dispensed_quantity IS 'Quantity dispensed to customers';
COMMENT ON COLUMN public.stagnant_medicines.last_dispensed_at IS 'Date of last dispensing';
COMMENT ON COLUMN public.stagnant_medicines.source_file_date IS 'Date of the source file from which data was imported';
