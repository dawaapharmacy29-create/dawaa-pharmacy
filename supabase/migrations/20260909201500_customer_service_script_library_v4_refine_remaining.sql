-- Customer Service Script Library V4 — refine remaining high-impact scripts
-- Keeps the existing 40-script architecture; only improves copy and response flow.

update public.quick_reply_scripts set message_body='مساء الخير يا فندم 🌷
مع حضرتك هبة من خدمة عملاء صيدليات دواء.

سعداء جدًا إن حضرتك اتعرفت علينا عن طريق {{referrer_name}}، وثقة الترشيح دي محل تقدير كبير عندنا.

يهمنا أول تعامل يكون مريح لحضرتك من البداية.

تحب نبدأ بطلب أو روشتة، ولا في صنف معين محتاج نوفره؟', questions=array['طلب أو روشتة','توفير صنف معين','استفسار عن منتج'] where active=true and shortcut='/توصية';

update public.quick_reply_scripts set message_body='مساء الخير يا فندم 🌷
مع حضرتك هبة من خدمة عملاء صيدليات دواء.

بنتابع احتياجات الأطفال والبيت المعتادة عشان تكون موجودة وقت ما تحتاجوها، من غير ما تضطر تفتكر كل حاجة في آخر وقت.

في حاجة معينة قربت تخلص ونراجعها لحضرتك؟', questions=array['أدوية أو فيتامينات','مستلزمات أطفال','عناية شخصية','مفيش احتياج حاليًا'] where active=true and shortcut='/أطفال';

update public.quick_reply_scripts set message_body='مساء الخير يا فندم 🌷
مع حضرتك هبة من خدمة عملاء صيدليات دواء.

رأي حضرتك مهم بالنسبة لنا لأنه بيساعدنا نحافظ على مستوى الخدمة ونحسن أي تفصيلة محتاجة تتظبط.

تقييم حضرتك للتجربة الأخيرة كان إيه؟', questions=array['ممتازة ⭐','مقبولة','سيئة'] where active=true and shortcut='/طلب_تقييم';

update public.quick_reply_scripts set message_body='يا فندم، مقدّرين الإزعاج اللي حصل، وتم اعتماد {{goodwill_offer}} تقديرًا للموقف.

لكن الأهم بالنسبة لنا إن المشكلة نفسها تكون اتحلت بشكل يريح حضرتك، مش مجرد تقديم تعويض.

هل الحل دلوقتي مناسب لحضرتك؟', questions=array['مناسب تمامًا','مقبول','لسه في نقطة محتاجة متابعة'] where active=true and shortcut='/تعويض';

update public.quick_reply_scripts set message_body='يا فندم، الموضوع محتاج متابعة من المسؤول المختص عشان ياخد الاهتمام المناسب، وخدمة العملاء هتفضل متابعة مع حضرتك لحد ما يكون في رد واضح.

تحب نكمل المتابعة هنا على واتساب ولا بمكالمة؟', questions=array['واتساب','مكالمة'] where active=true and shortcut='/تصعيد';

update public.quick_reply_scripts set message_body='مساء الخير يا فندم 🌷
تحديث سريع على طلب حضرتك: هو حاليًا {{order_status}}.

لو تحب، نبلغ حضرتك أول ما يكون في تحديث جديد أو وقت وصول مؤكد.', questions=array['نعم، بلغوني','لا، شكرًا'] where active=true and shortcut='/حالة_الطلب';

update public.quick_reply_scripts set message_body='تمام يا فندم 🌷
قبل ما نبدأ التجهيز، خلينا نتأكد إن التفاصيل الأساسية صحيحة عشان الطلب يوصل مظبوط من أول مرة.

العنوان المسجل لسه مناسب لحضرتك؟', questions=array['نعم، صحيح','محتاج تعديل'] where active=true and shortcut='/تأكيد_طلب';

update public.quick_reply_scripts set message_body='أكيد يا فندم 🌷
عشان الترشيح يكون مناسب فعلًا، محتاجين نعرف الهدف الأساسي الأول بدل ما نعرض اختيارات كتير من غير فايدة.

إيه أكتر حاجة حابب تركز عليها؟', questions=array['ترطيب','حبوب وآثارها','تصبغات وتوحيد لون','عناية بالشعر','هدف تاني'] where active=true and shortcut='/كوزمو';