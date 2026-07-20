create table if not exists public.quick_reply_scripts_recovery_backup_20260721 as
select *, now() as backed_up_at
from public.quick_reply_scripts
where false;

insert into public.quick_reply_scripts_recovery_backup_20260721
select q.*, now()
from public.quick_reply_scripts q
where q.message_body = (
  select message_body
  from public.quick_reply_scripts
  group by message_body
  order by count(*) desc
  limit 1
)
and not exists (
  select 1 from public.quick_reply_scripts_recovery_backup_20260721 b where b.id = q.id
);

update public.quick_reply_scripts
set active = false,
    updated_at = now(),
    tags = array(select distinct x from unnest(coalesce(tags, array[]::text[]) || array['recovery_backup','duplicate_message_corruption']) x)
where message_body = (
  select message_body
  from public.quick_reply_scripts
  group by message_body
  order by count(*) desc
  limit 1
)
and (select count(*) from public.quick_reply_scripts q2 where q2.message_body = public.quick_reply_scripts.message_body) >= 20;

insert into public.quick_reply_scripts (shortcut,title,category,script_type,message_body,tags,active,created_by_name)
select * from (values
('/ترحيب','ترحيب احترافي بعميل جديد','ترحيب','welcome','أهلًا بحضرتك {{customer_name}}، مع حضرتك د/ {{doctor_name}} من صيدليات دواء. نورتنا، ويسعدنا نخدم حضرتك ونساعدك في أي استفسار عن دواء أو طلب أو متابعة. حضرتك تحت أمرنا في أي وقت.',array['ترحيب','عميل جديد']::text[],true,'استعادة آمنة'),
('/متابعة','متابعة بعد آخر تعامل','متابعة','followup','أهلًا بحضرتك {{customer_name}}، مع حضرتك د/ {{doctor_name}} من صيدليات دواء. حبيت أطمن على حضرتك بعد آخر تعامل: هل كل شيء تم بالشكل المطلوب؟ وهل في أي ملاحظة أو احتياج نقدر نساعد حضرتك فيه؟',array['متابعة','اطمئنان']::text[],true,'استعادة آمنة'),
('/انتظار','تم إرسال رسالة وفي انتظار الرد','متابعة','followup','أهلًا بحضرتك {{customer_name}}، بنفكّر حضرتك برسالتنا السابقة للاطمئنان عليك. خُد وقتك في الرد، وإحنا موجودين وقت ما يكون مناسب لحضرتك.',array['انتظار الرد','متابعة']::text[],true,'استعادة آمنة'),
('/لم_يرد','متابعة لطيفة بعد عدم الرد','متابعة','no_answer','مساء الخير يا {{customer_name}}، حاولنا نطمن على حضرتك وممكن يكون الوقت ماكانش مناسب. مش هنزعج حضرتك، وحضرتك تقدر ترد علينا في أي وقت يناسبك.',array['لم يرد','بدون ضغط']::text[],true,'استعادة آمنة'),
('/شكوى','احتواء شكوى واستعادة رضا العميل','شكاوى','complaint','بنعتذر جدًا لحضرتك عن التجربة اللي ضايقتك. يهمنا نسمع التفاصيل كاملة ونحل الموضوع بشكل يرضيك. ممكن توضح لنا اللي حصل ورقم الطلب لو متاح؟ وهنتابع مع حضرتك لحد التأكد إن المشكلة انتهت.',array['شكوى','حل مشكلة']::text[],true,'استعادة آمنة'),
('/توصيل','تأخير أو متابعة توصيل','توصيل','delivery_delay','طلب حضرتك محل اهتمامنا جدًا، وبنعتذر عن أي تأخير حصل. هراجع حالة الطلب مع الفرع فورًا وأرجع لحضرتك بتحديث واضح وموعد متوقع بدل ما نسيبك منتظر.',array['توصيل','تأخير']::text[],true,'استعادة آمنة'),
('/سعر','احتواء اعتراض السعر','اعتراضات','price_objection','حضرتك معاك حق تسأل عن السعر. هدفنا نوفر لحضرتك اختيار مناسب وفعال، ونوضح البدائل والعروض المتاحة بدون تغيير أي علاج إلا بعد التأكد إنه مناسب لحالتك. تحب أراجع لحضرتك أفضل اختيار متاح؟',array['سعر','بديل']::text[],true,'استعادة آمنة'),
('/روشتة','طلب صورة روشتة واضحة','روشتة','quick_reply','حضرتك ممكن تبعت صورة الروشتة كاملة وواضحة، ويفضل بإضاءة جيدة ومن غير قص أي جزء. دكتور صيدلي من صيدليات دواء هيراجعها ويوضح المتاح وطريقة الاستخدام والبدائل المناسبة عند الحاجة.',array['روشتة']::text[],true,'استعادة آمنة'),
('/مزمن','متابعة علاج شهري','متابعة شهرية','monthly_refill','أهلًا بحضرتك {{customer_name}}، بنطمن على علاج حضرتك الشهري: هل الأصناف قربت تخلص؟ وهل حصل أي تغيير في الجرعات أو تعليمات الطبيب؟ نقدر نجهز احتياجات حضرتك قبل الموعد المناسب.',array['مزمن','شهري']::text[],true,'استعادة آمنة'),
('/vip','متابعة عميل مميز','VIP','vip','أهلًا بحضرتك {{customer_name}}، حضرتك من عملائنا المميزين ويهمنا نخدمك بشكل يليق بثقتك. لو عندك علاج شهري أو أصناف متكررة أو أي ملاحظة تحب نسجلها، فريق صيدليات دواء تحت أمرك.',array['vip','مميز']::text[],true,'استعادة آمنة')
) as seed(shortcut,title,category,script_type,message_body,tags,active,created_by_name)
where not exists (
  select 1 from public.quick_reply_scripts q where lower(q.shortcut)=lower(seed.shortcut) and q.active is true
);

create or replace function public.prevent_quick_reply_mass_duplicate_message()
returns trigger
language plpgsql
as $$
begin
  if coalesce(new.active,true) and length(trim(new.message_body)) > 20 and (
    select count(*) from public.quick_reply_scripts q
    where q.id is distinct from new.id
      and q.active is true
      and trim(q.message_body)=trim(new.message_body)
  ) >= 3 then
    raise exception 'لا يمكن استخدام نفس نص الرد السريع لأكثر من 3 اختصارات نشطة';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_quick_reply_mass_duplicate_message on public.quick_reply_scripts;
create trigger trg_prevent_quick_reply_mass_duplicate_message
before insert or update of message_body,active on public.quick_reply_scripts
for each row execute function public.prevent_quick_reply_mass_duplicate_message();
