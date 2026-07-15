const fs = require('fs');
const path = require('path');

const filePath = path.join(process.cwd(), 'src/pages/DoctorDashboard.tsx');
let source = fs.readFileSync(filePath, 'utf8');

function replaceOnce(before, after, label) {
  if (source.includes(after)) return;
  if (!source.includes(before)) throw new Error(`doctor-service-rules: ${label}`);
  source = source.replace(before, after);
}

replaceOnce(
`function canInspectTeam(role?: string) {`,
`const CONVERSATION_SCORE_RULES = [
  { title: 'الترحيب وبداية الحوار', score: 10, detail: 'ترحيب ودود، استخدام اسم العميل عند توفره، وتعريف واضح بصيدليات دواء.' },
  { title: 'فهم الاحتياج', score: 20, detail: 'الاستماع بدون مقاطعة، سؤال توضيحي مناسب، ثم تلخيص طلب العميل قبل الترشيح.' },
  { title: 'الترشيح الآمن والمناسب', score: 25, detail: 'ترشيح الأنسب للحالة وليس الأغلى، مع مراجعة الموانع والتعارضات وعدم تكرار المادة الفعالة.' },
  { title: 'شرح الفائدة والاستخدام', score: 15, detail: 'شرح مبسط للفائدة وطريقة الاستخدام والفرق بين البدائل بدون مبالغة أو وعود غير مؤكدة.' },
  { title: 'Cross-selling أخلاقي', score: 10, detail: 'منتج مكمل مناسب بعد سؤال العميل، مرتبط باحتياجه الحقيقي وبدون ضغط.' },
  { title: 'Up-selling مسؤول', score: 10, detail: 'عرض اختيار أفضل فقط عند وجود فائدة واضحة، مع شرح فرق السعر وترك القرار للعميل.' },
  { title: 'عدم الضغط والاحترام', score: 5, detail: 'احترام رفض العميل وعدم استخدام عبارات إجبارية أو تخويف أو تقليل من اختياره.' },
  { title: 'الختام والمتابعة', score: 5, detail: 'تأكيد الطلب والاستخدام، سؤال العميل إن كان يحتاج شيئًا آخر، وإنهاء ودود مع عرض المتابعة.' },
];

const CHANNEL_RULES = [
  {
    title: 'داخل الصيدلية',
    points: ['الوقوف واستقبال العميل باهتمام', 'فهم الطلب قبل إحضار المنتج', 'شرح الاستخدام بوضوح', 'اقتراح بديل مناسب عند عدم التوافر', 'التأكد من رضا العميل قبل إنهاء التعامل'],
  },
  {
    title: 'واتساب',
    points: ['الرد خلال 0–5 دقائق قدر الإمكان', 'الترحيب باسم العميل', 'عدم إرسال رد مقتضب أو غير واضح', 'تأكيد السعر والتوافر والتوصيل', 'ختام المحادثة والتأكد من عدم وجود طلب إضافي'],
  },
  {
    title: 'المكالمة',
    points: ['التعريف بالنفس وبالصيدلية', 'الاستماع دون مقاطعة', 'تلخيص الطلب قبل التنفيذ', 'تأكيد الاسم والعنوان والطلب', 'إنهاء المكالمة بملخص واضح وودود'],
  },
];

const DISCIPLINE_RULES = [
  { title: 'الالتزام بالشيفت', detail: 'الحضور والانصراف في الموعد، وعدم ترك الشيفت أو التأخير بدون إذن مسجل.' },
  { title: 'التأخير', detail: 'أكثر من 20 إلى 30 دقيقة: -10 نقاط، من 30 إلى 60 دقيقة: -20 نقطة، أكثر من ساعة: -30 نقطة.' },
  { title: 'الغياب بدون إذن', detail: '-80 نقطة، مع تطبيق الإجراء الإداري المعتمد.' },
  { title: 'تكرار التأخير', detail: 'بعد استهلاك السماحات الشهرية: -30 نقطة وفق اللائحة.' },
  { title: 'الزي والمظهر', detail: 'بالطو نظيف ومظهر مهني، والالتزام بالوقوف والاهتمام بالعميل.' },
  { title: 'السلامة المهنية', detail: 'لا ترشيح غير مناسب طبيًا، ولا تكرار مادة فعالة، ولا معلومة غير مؤكدة.' },
];

function canInspectTeam(role?: string) {`,
'policy constants'
);

replaceOnce(
`  const [quickFollowupOpen, setQuickFollowupOpen] = useState(false);`,
`  const [quickFollowupOpen, setQuickFollowupOpen] = useState(false);
  const [serviceRulesOpen, setServiceRulesOpen] = useState(true);`,
'policy open state'
);

replaceOnce(
`      <QuickFollowupModal open={quickFollowupOpen} onClose={() => setQuickFollowupOpen(false)} onCreated={() => refetchMyFollowups?.()} />`,
`      <QuickFollowupModal open={quickFollowupOpen} onClose={() => setQuickFollowupOpen(false)} onCreated={() => refetchMyFollowups?.()} />

      <section className="rounded-3xl border border-amber-300/25 bg-gradient-to-l from-amber-500/10 via-slate-900/90 to-teal-500/10 p-5 shadow-xl">
        <button
          type="button"
          onClick={() => setServiceRulesOpen((value) => !value)}
          className="flex w-full items-start justify-between gap-4 text-right"
          aria-expanded={serviceRulesOpen}
        >
          <div>
            <div className="text-xs font-black text-amber-200">اقرأ قبل بدء الشيفت</div>
            <h2 className="mt-1 text-2xl font-black text-white">قواعد التعامل مع العميل والالتزام المهني</h2>
            <p className="mt-2 text-sm leading-7 text-slate-300">
              جودة الخدمة أهم من البيع: افهم الاحتياج، رشّح الأنسب بأمان، اشرح بوضوح، لا تضغط على العميل، واختم باهتمام.
            </p>
          </div>
          <span className="shrink-0 rounded-full border border-white/10 bg-slate-950/50 px-4 py-2 text-sm font-black text-teal-200">
            {serviceRulesOpen ? 'إخفاء التفاصيل' : 'عرض التفاصيل'}
          </span>
        </button>

        {serviceRulesOpen && (
          <div className="mt-5 space-y-5">
            <div>
              <div className="mb-3 flex items-center gap-2">
                <Star size={18} className="text-amber-300" />
                <h3 className="text-lg font-black text-white">تقييم المحادثة والبيع — 100 درجة</h3>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {CONVERSATION_SCORE_RULES.map((rule) => (
                  <div key={rule.title} className="rounded-2xl border border-white/10 bg-slate-950/45 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <h4 className="font-black text-white">{rule.title}</h4>
                      <span className="rounded-full bg-teal-500/15 px-2.5 py-1 text-xs font-black text-teal-200">{rule.score} درجات</span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-300">{rule.detail}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-3">
              {CHANNEL_RULES.map((channel) => (
                <div key={channel.title} className="rounded-2xl border border-sky-400/15 bg-sky-500/5 p-4">
                  <h3 className="font-black text-sky-100">{channel.title}</h3>
                  <div className="mt-3 space-y-2">
                    {channel.points.map((point) => (
                      <div key={point} className="flex items-start gap-2 text-sm leading-6 text-slate-200">
                        <CheckCircle2 size={16} className="mt-1 shrink-0 text-teal-300" />
                        <span>{point}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="grid gap-4 xl:grid-cols-[1.1fr_.9fr]">
              <div className="rounded-2xl border border-violet-400/20 bg-violet-500/5 p-4">
                <h3 className="font-black text-violet-100">طريقة الترشيح الصحيحة</h3>
                <div className="mt-3 grid gap-3 md:grid-cols-5">
                  {['اسأل', 'افهم', 'رشّح', 'اشرح', 'أكد الرضا'].map((step, index) => (
                    <div key={step} className="rounded-xl bg-slate-950/45 p-3 text-center">
                      <div className="text-xs font-black text-violet-300">{index + 1}</div>
                      <div className="mt-1 font-black text-white">{step}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 rounded-xl border border-red-400/15 bg-red-500/5 p-3 text-sm leading-6 text-red-100">
                  ممنوع الضغط على العميل، أو ترشيح الأغلى لمجرد السعر، أو استخدام عبارات مثل «خد ده وخلاص» و«الأغلى أكيد أحسن».
                </div>
              </div>

              <div className="rounded-2xl border border-red-400/20 bg-red-500/5 p-4">
                <div className="mb-3 flex items-center gap-2">
                  <ShieldCheck size={18} className="text-red-300" />
                  <h3 className="font-black text-red-100">الالتزام والانضباط</h3>
                </div>
                <div className="space-y-2">
                  {DISCIPLINE_RULES.map((rule) => (
                    <div key={rule.title} className="rounded-xl bg-slate-950/40 p-3">
                      <div className="font-black text-white">{rule.title}</div>
                      <div className="mt-1 text-sm leading-6 text-slate-300">{rule.detail}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-teal-400/20 bg-teal-500/5 p-4 text-sm leading-7 text-teal-50">
              <span className="font-black">القاعدة الذهبية:</span> البيع الاستشاري الأخلاقي هو أن تبيع ما يناسب العميل فعلًا، وتحافظ على سلامته وثقته حتى لو كان المنتج الأقل سعرًا.
            </div>
          </div>
        )}
      </section>`,
'policy section at dashboard top'
);

fs.writeFileSync(filePath, source);
console.log('[doctor-service-discipline-rules] applied');
