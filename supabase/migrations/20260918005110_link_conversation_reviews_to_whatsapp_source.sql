
-- ربط تقييمات المحادثات (conversation_sales_reviews) بمصدر واتساب اللي
-- اتولدت منه آليًا (whatsapp_review_sources) — عشان نمنع تكرار إنشاء تقييم
-- آلي لنفس الجلسة لو اتعاد معالجة نفس الملف. إضافة غير هدّامة بالكامل:
-- عمود nullable + index جزئي (unique where not null)، من غير أي تعديل على
-- بيانات أو أعمدة موجودة.
alter table public.conversation_sales_reviews
  add column if not exists whatsapp_review_source_id uuid references public.whatsapp_review_sources(id);

create unique index if not exists conversation_sales_reviews_whatsapp_source_uk
  on public.conversation_sales_reviews (whatsapp_review_source_id)
  where whatsapp_review_source_id is not null;

comment on column public.conversation_sales_reviews.whatsapp_review_source_id is
  'لو التقييم اتولد آليًا من تحليل محادثة واتساب، بيشاور على whatsapp_review_sources.id المصدر. NULL يعني تقييم بشري عادي من صفحة المراجعة.';
