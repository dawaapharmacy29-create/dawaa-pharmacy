-- البحث عن عميل (بالاسم/الكود/التليفون) كان بياخد لغاية ٣.٤ ثانية لأي عملية
-- بحث ملهاش نتايج كتير، على ١٧ ألف عميل — لأن الفهارس التريجرام الموجودة
-- كانت متبنية على COALESCE(customer_name, name, '') وCOALESCE(customer_phone,
-- phone, whatsapp_phone, '')، بينما src/lib/customerSearch.ts (المستخدمة في
-- أكتر من ١٥ صفحة/كومبوننت) بتفلتر على الأعمدة الخام name/phone/customer_code
-- مباشرة، فالفهارس دي محدش كان بيستخدمها خالص والبحث كان بيرجع لمسح كامل
-- الجدول. اتأكد بـ EXPLAIN ANALYZE: من ٣٣٨٣ مللي ثانية لـ٢ مللي ثانية بعد
-- إضافة فهارس تريجرام على الأعمدة الخام نفسها.
create index if not exists idx_customers_name_ilike_trgm on public.customers using gin (name gin_trgm_ops);
create index if not exists idx_customers_customer_code_ilike_trgm on public.customers using gin (customer_code gin_trgm_ops);
create index if not exists idx_customers_phone_ilike_trgm on public.customers using gin (phone gin_trgm_ops);
