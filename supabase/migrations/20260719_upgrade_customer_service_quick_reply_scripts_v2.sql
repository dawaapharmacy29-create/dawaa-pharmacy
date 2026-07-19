begin;

update public.quick_reply_scripts set message_body = 'أهلًا بحضرتك {{customer_name}}، مع حضرتك د/ {{doctor_name}} من صيدليات دواء. نورتنا، ويسعدنا نخدم حضرتك ونساعدك في أي استفسار عن دواء أو طلب أو متابعة. حضرتك تحت أمرنا في أي وقت.', updated_at = now() where shortcut = '/ترحيب';
update public.quick_reply_scripts set message_body = 'أهلًا بحضرتك {{customer_name}}، مع حضرتك د/ {{doctor_name}} من صيدليات دواء. حبيت أطمن على حضرتك بعد آخر تعامل: هل كل شيء تم بالشكل المطلوب؟ وهل في أي ملاحظة أو احتياج نقدر نساعد حضرتك فيه؟', updated_at = now() where shortcut = '/متابعة';
update public.quick_reply_scripts set message_body = 'حضرتك معاك حق تسأل عن السعر. هدفنا نوفر لحضرتك اختيار مناسب وفعال، ونوضح البدائل والعروض المتاحة بدون تغيير أي علاج إلا بعد التأكد إنه مناسب لحالتك. تحب أراجع لحضرتك أفضل اختيار متاح؟', updated_at = now() where shortcut = '/سعر';
update public.quick_reply_scripts set message_body = 'طلب حضرتك محل اهتمامنا جدًا، وبنعتذر عن أي تأخير حصل. هراجع حالة الطلب مع الفرع فورًا وأرجع لحضرتك بتحديث واضح وموعد متوقع بدل ما نسيبك منتظر.', updated_at = now() where shortcut = '/توصيل';
update public.quick_reply_scripts set message_body = 'بنعتذر جدًا لحضرتك عن التجربة اللي ضايقتك. يهمنا نسمع التفاصيل كاملة ونحل الموضوع بشكل يرضيك. ممكن توضح لنا اللي حصل ورقم الطلب لو متاح؟ وهنتابع مع حضرتك لحد التأكد إن المشكلة انتهت.', updated_at = now() where shortcut = '/شكوى';
update public.quick_reply_scripts set message_body = 'حضرتك ممكن تبعت صورة الروشتة كاملة وواضحة، ويفضل بإضاءة جيدة ومن غير قص أي جزء. دكتور صيدلي من صيدليات دواء هيراجعها ويوضح المتاح وطريقة الاستخدام والبدائل المناسبة عند الحاجة.', updated_at = now() where shortcut = '/روشتة';
update public.quick_reply_scripts set message_body = 'أهلًا بحضرتك {{customer_name}}، مع حضرتك د/ {{doctor_name}} من صيدليات دواء. بنطمن على علاج حضرتك الشهري: هل الأصناف قربت تخلص؟ وهل حصل أي تغيير في الجرعات أو تعليمات الطبيب؟ نقدر نجهز احتياجات حضرتك قبل الموعد المناسب.', updated_at = now() where shortcut = '/مزمن';
update public.quick_reply_scripts set message_body = 'تمام يا فندم، شكرًا جدًا لوقت حضرتك. مش هنضغط عليك في أي شراء، وإحنا موجودين وقت ما تحتاج استفسار أو بديل أو متابعة. صيدليات دواء تتشرف بخدمتك دائمًا.', updated_at = now() where shortcut = '/رفض';
update public.quick_reply_scripts set message_body = 'أهلًا بحضرتك {{customer_name}}، حضرتك من عملائنا المميزين ويهمنا نخدمك بشكل يليق بثقتك. لو عندك علاج شهري أو أصناف متكررة أو أي ملاحظة تحب نسجلها، فريق صيدليات دواء تحت أمرك وهنرتبها بالطريقة والموعد المناسبين.', updated_at = now() where shortcut = '/vip';

commit;
