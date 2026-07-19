begin;

-- Customer-facing scripts must never reveal the employee or doctor who requested
-- the internal follow-up. Only the serving agent and Dawaa Pharmacy brand appear.
update public.quick_reply_scripts
set message_body = case
  when script_type = 'complaint' then
    'أهلًا بحضرتك، مع حضرتك فريق خدمة عملاء صيدليات دواء. بنعتذر لحضرتك عن التجربة اللي ضايقتك، وحقك علينا إننا نسمعك كويس ونراجع الموضوع خطوة بخطوة. ممكن حضرتك توضح لنا اللي حصل من البداية؟ هنحدد لحضرتك الإجراء وموعد الرجوع بشكل واضح.'
  when script_type = 'followup' then
    'أهلًا بحضرتك أستاذ/ {{customer_name}}، مع حضرتك {{doctor_name}} من خدمة عملاء صيدليات دواء. حابين نطمن على حضرتك بعد آخر تعامل ونتأكد إن كل حاجة تمت بالشكل المناسب. هل الدواء أو الطلب مناسب مع حضرتك؟ وهل في أي استفسار أو ملاحظة نقدر نساعد فيها؟'
  when script_type = 'monthly_refill' then
    'أهلًا بحضرتك أستاذ/ {{customer_name}}، مع حضرتك {{doctor_name}} من صيدليات دواء. حابين نطمن على حضرتك ونسأل إذا كانت أدوية حضرتك الشهرية قربت تخلص، علشان نساعد في تجهيزها في الوقت المناسب. ولو حصل أي تغيير في الجرعات أو تعليمات العلاج، بلغنا قبل التجهيز علشان نخدم حضرتك بشكل آمن ودقيق.'
  when script_type = 'vip' then
    'أهلًا بحضرتك أستاذ/ {{customer_name}}، مع حضرتك {{doctor_name}} من صيدليات دواء. وجود حضرتك من عملائنا المميزين محل تقدير كبير عندنا، وحابين نطمن إن كل احتياجاتك متوفرة بالشكل المناسب. لو في صنف شهري أو طلب خاص أو ملاحظة تحب نسجلها، يشرفنا نهتم بيها ونتابعها مع حضرتك.'
  when script_type = 'no_answer' then
    'تمام يا فندم، شكرًا جدًا لوقت حضرتك. مش هنضغط على حضرتك في أي شراء، وصيدليات دواء موجودة وقت ما تحتاج أي استفسار أو مساعدة أو بديل مناسب. نتشرف بخدمة حضرتك في أي وقت.'
  when script_type = 'delivery_delay' then
    'أهلًا بحضرتك، مع حضرتك خدمة عملاء صيدليات دواء. بنعتذر لحضرتك عن التأخير، وطلبك محل اهتمامنا. هنراجع حالته فورًا ونرجع لحضرتك بتحديث واضح وموعد متوقع بدل ما نسيب حضرتك منتظر من غير معلومة.'
  else message_body
end,
updated_at = now()
where active is true
  and script_type in ('complaint','followup','monthly_refill','vip','no_answer','delivery_delay');

commit;
