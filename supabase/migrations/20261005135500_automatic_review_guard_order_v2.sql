-- PostgreSQL runs triggers of the same timing/event in name order.
-- Put the automatic-review immutability guard after legacy normalizers so it validates the final
-- row image rather than an intermediate one. updated_at is intentionally excluded by the guard.

drop trigger if exists automatic_conversation_review_writer_guard_v2
  on public.conversation_sales_reviews;
drop trigger if exists zzzz_automatic_conversation_review_writer_guard_v2
  on public.conversation_sales_reviews;

create trigger zzzz_automatic_conversation_review_writer_guard_v2
before insert or update
on public.conversation_sales_reviews
for each row
execute function public.dawaa_guard_automatic_conversation_review_writer_v2();

notify pgrst,'reload schema';
