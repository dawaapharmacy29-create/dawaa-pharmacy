SET LOCAL lock_timeout='2s';
DO $$ BEGIN
IF to_regclass('public.inventory_count_items_session_idx') IS NOT NULL THEN
  DROP INDEX IF EXISTS public.idx_inventory_count_items_session_id_fk;
END IF;
END $$;
