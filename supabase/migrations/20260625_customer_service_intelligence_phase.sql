alter table if exists public.daily_followups
  add column if not exists internal_rating numeric null,
  add column if not exists need_understood boolean null,
  add column if not exists cross_sell_offered boolean default false,
  add column if not exists up_sell_offered boolean default false,
  add column if not exists needs_next_followup boolean default false,
  add column if not exists no_purchase_reason text null,
  add column if not exists doctor_internal_note text null,
  add column if not exists evaluated_by text null,
  add column if not exists evaluated_by_name text null,
  add column if not exists evaluated_at timestamptz null;

create table if not exists public.customer_branch_overrides (
  id uuid primary key default gen_random_uuid(),
  customer_code text null,
  customer_id text null,
  customer_phone text null,
  customer_name text null,
  old_branch text null,
  new_branch text not null,
  suggested_branch text null,
  reason text null,
  created_by text null,
  created_by_name text null,
  created_at timestamptz default now(),
  active boolean default true
);

create index if not exists idx_customer_branch_overrides_code
  on public.customer_branch_overrides (customer_code);
create index if not exists idx_customer_branch_overrides_phone
  on public.customer_branch_overrides (customer_phone);
create index if not exists idx_customer_branch_overrides_customer_id
  on public.customer_branch_overrides (customer_id);
create index if not exists idx_customer_branch_overrides_active
  on public.customer_branch_overrides (active);

create table if not exists public.quick_reply_scripts (
  id uuid primary key default gen_random_uuid(),
  shortcut text not null,
  title text not null,
  category text not null,
  script_type text not null,
  doctor_name text null,
  branch text null,
  message_body text not null,
  questions text[] null,
  suggested_products text[] null,
  tags text[] null,
  active boolean default true,
  usage_count integer default 0,
  created_by text null,
  created_by_name text null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_quick_reply_scripts_shortcut
  on public.quick_reply_scripts (shortcut);
create index if not exists idx_quick_reply_scripts_category
  on public.quick_reply_scripts (category);
create index if not exists idx_quick_reply_scripts_script_type
  on public.quick_reply_scripts (script_type);
create index if not exists idx_quick_reply_scripts_doctor_name
  on public.quick_reply_scripts (doctor_name);
create index if not exists idx_quick_reply_scripts_active
  on public.quick_reply_scripts (active);

insert into public.quick_reply_scripts
  (shortcut, title, category, script_type, message_body, questions, tags, active)
values
  ('/برد', 'استفسار أعراض برد', 'برد ومناعة', 'cold_flu', 'أهلا بحضرتك، مع حضرتك صيدليات دواء. نطمن على حضرتك الأول: هل في حرارة؟ كحة ناشفة ولا ببلغم؟ رشح أو انسداد أنف؟ وهل حضرتك عندك حساسية من أي دواء أو ضغط/سكر أو حمل؟', array['هل في حرارة؟','الكحة ناشفة ولا ببلغم؟','هل يوجد حساسية أو حمل أو ضغط/سكر؟'], array['برد','أعراض','آمن'], true),
  ('/مناعة', 'Cross Sell خفيف للمناعة', 'Cross Sell', 'cross_sell', 'ممكن كمان نهتم برفع المناعة والسوائل الدافئة والراحة، ولو حضرتك بتحب نرشح لحضرتك اختيار مناسب حسب السن والحالة.', null, array['مناعة','cross-sell'], true),
  ('/متابعة', 'متابعة بعد آخر تعامل', 'متابعة', 'followup', 'أهلا بحضرتك، مع حضرتك صيدليات دواء. بنطمن على حضرتك بعد آخر تعامل، هل الدواء مناسب مع حضرتك؟ وهل في أي ملاحظة نقدر نساعد فيها؟', null, array['متابعة'], true),
  ('/سعر', 'اعتراض على السعر', 'اعتراضات', 'price_objection', 'حضرتك معاك حق تسأل على السعر. إحنا بنحاول نوفر لحضرتك أفضل اختيار مناسب وفعال، ولو تحب نرشح بديل مناسب حسب الحالة والسعر المتاح.', null, array['سعر','بديل'], true),
  ('/توصيل', 'تأخير أو متابعة توصيل', 'توصيل', 'delivery_delay', 'طلب حضرتك محل اهتمامنا، وهنراجع حالة التوصيل فورًا ونطمن حضرتك بالتحديث. بنعتذر لحضرتك عن أي تأخير.', null, array['توصيل'], true),
  ('/شكوى', 'احتواء شكوى', 'شكاوى', 'complaint', 'بنعتذر جدًا لحضرتك عن أي تجربة غير مرضية. يهمنا نحل الموضوع فورًا، ممكن حضرتك توضح لنا تفاصيل المشكلة ورقم الطلب لو متاح؟', null, array['شكوى'], true),
  ('/روشتة', 'طلب صورة روشتة واضحة', 'روشتة', 'quick_reply', 'حضرتك ممكن تبعت صورة الروشتة بوضوح، ويفضل تكون الإضاءة كويسة، وهنراجعها لحضرتك ونوضح المتاح والبدائل المناسبة.', null, array['روشتة'], true),
  ('/مزمن', 'متابعة علاج شهري', 'متابعة شهرية', 'monthly_refill', 'بنطمن على علاج حضرتك الشهري. هل حضرتك محتاج نفس الأصناف الشهر ده؟ ولو فيه أي تغيير في الجرعات أو تعليمات الدكتور بلغنا.', null, array['مزمن','شهري'], true),
  ('/رفض', 'إغلاق محترم بدون ضغط', 'متابعة', 'no_answer', 'تمام يا فندم، تحت أمر حضرتك في أي وقت. لو احتجت أي استفسار أو بديل مناسب، صيدليات دواء تتشرف بخدمتك دائمًا.', null, array['رفض'], true),
  ('/vip', 'متابعة عميل مميز', 'VIP', 'vip', 'حضرتك من عملائنا المميزين، ويهمنا نتابع احتياجاتك بشكل أفضل. لو فيه أي صنف شهري أو ملاحظة خاصة تحب نسجلها لحضرتك، تحت أمرك.', null, array['vip','مميز'], true)
on conflict do nothing;
