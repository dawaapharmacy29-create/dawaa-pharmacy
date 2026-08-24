-- Production reconciliation: the canonical point_appeals table already owns
-- this access path through point_appeals_subject_idx.
drop index if exists public.idx_point_appeals_subject_created_v1;
