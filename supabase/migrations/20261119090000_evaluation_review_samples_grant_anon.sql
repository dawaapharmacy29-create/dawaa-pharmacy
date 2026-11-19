-- The app calls with the anon role and a staff session (see 20261118160000 / 20261118190000).
-- 20261117120000 granted the weekly review-sample functions to authenticated only, so the
-- «المراجعات الأسبوعية العشوائية» screen failed with "permission denied for function
-- generate_evaluation_review_batch_v1" and showed no samples; listing, saving a review and saving
-- a branch cycle target failed the same way. Each function checks
-- dawaa_current_actor_can(array['manage_evaluation_rules']) itself (false without a verified
-- session), the same guard as get_evaluation_review_scores_v1 / list_evaluation_branch_cycle_targets_v1,
-- which already have anon. Internal helpers (pool/source) stay revoked.
grant execute on function public.generate_evaluation_review_batch_v1(text, date, date) to anon;
grant execute on function public.list_evaluation_review_samples_v1(date) to anon;
grant execute on function public.save_evaluation_invoice_review_v1(uuid, jsonb, text, boolean) to anon;
grant execute on function public.save_evaluation_branch_cycle_target_v1(text, date, integer, integer, text) to anon;
