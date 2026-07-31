const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/StaffMonthlyEvaluation.tsx');
if (!fs.existsSync(file)) throw new Error('[monthly-development-model] StaffMonthlyEvaluation.tsx not found');

let source = fs.readFileSync(file, 'utf8');
const before = source;

const sections = `const BASE_SECTIONS: Section[] = [
  { key: 'policies', title: 'الالتزام بالسياسات والسلوك المهني', description: 'الالتزام بسياسات وتعليمات الصيدلية • الحضور والانضباط • الوقوف عند التعامل مع العميل • الالتزام بالزي والنظافة والمظهر المهني • احترام خصوصية العميل والفرع', weight: 15, score: 0, notes: '' },
  { key: 'customer_service', title: 'خدمة العميل وسرعة الاستجابة', description: 'سرعة الرد على العميل • الترحيب والأسلوب المحترم • فهم الطلب وعدم التسرع • حل المشكلة ومتابعة العميل • إنهاء المحادثة بصورة احترافية', weight: 12, score: 0, notes: '' },
  { key: 'dispensing', title: 'دقة صرف الدواء والإرشاد', description: 'دقة صرف الأدوية للعملاء • مراجعة الاسم والتركيز والكمية • شرح الجرعة وطريقة الاستخدام • شرح تاريخ الصلاحية والحفظ • التنبيه على الاحتياطات المهمة والبدائل الآمنة', weight: 15, score: 0, notes: '' },
  { key: 'transactions', title: 'دقة التسجيل والفواتير', description: 'الدقة في تسجيل المشتريات • الدقة في تسجيل فواتير البيع • مراجعة الكميات والأسعار والخصومات • ربط الفاتورة بالعميل الصحيح • منع السهو أو التكرار أو التعديل غير الموثق', weight: 10, score: 0, notes: '' },
  { key: 'requests_followups', title: 'طلبات العملاء والمتابعات', description: 'تسجيل طلبات العملاء والنواقص فورًا • تنفيذ المتابعات المطلوبة • توثيق نتيجة التواصل • تحديد الموعد التالي عند الحاجة • عدم ترك طلب أو متابعة بدون نتيجة واضحة', weight: 8, score: 0, notes: '' },
  { key: 'shift_handover', title: 'تسليم الشيفت وملاحظاته', description: 'الدقة في تسليم الشيفت • مراجعة ملاحظات الشيفتات • تسجيل المشكلات والطلبات المفتوحة • تسليم النقدية والعهدة والمعلومات المهمة • متابعة ما تم استلامه من الشيفت السابق', weight: 10, score: 0, notes: '' },
  { key: 'inventory', title: 'المخزون والنواقص والصلاحية', description: 'التبليغ عن العجز أو الزيادة في الأصناف • متابعة النواقص والرواكد • مراجعة الصلاحية • الدقة في الجرد والترتيب • التصعيد السريع عند وجود مشكلة مخزون', weight: 8, score: 0, notes: '' },
  { key: 'teamwork', title: 'التعاون والتشغيل بين الفرق', description: 'التعامل الجيد مع الفريق • التعاون مع الدليفري • سرعة التعاون مع الفروع والمخزن • تحمل المسؤولية وقت الضغط • احترام الأدوار وعدم تعطيل سير العمل', weight: 8, score: 0, notes: '' },
  { key: 'sales_quality', title: 'جودة البيع وتنمية الفاتورة', description: 'رفع متوسط الفاتورة بصورة مناسبة للعميل • زيادة عدد الأصناف المفيدة في الفاتورة • البيع الإضافي والبدائل بدون ضغط أو تضليل • اكتشاف الاحتياج الكامل • جودة العرض وليس تحقيق تارجت المبيعات', weight: 8, score: 0, notes: '' },
  { key: 'development', title: 'التعلم والتطوير والتحسن', description: 'تقبل الملاحظات • تنفيذ خطة التطوير • حضور التدريب • عدم تكرار الأخطاء • التحسن مقارنة بالشهر السابق • مشاركة المعرفة والمبادرة في التعلم', weight: 6, score: 0, notes: '' },
];`;

source = source.replace(/const BASE_SECTIONS: Section\[\] = \[[\s\S]*?\n\];/, sections);

if (!source.includes('function incentiveFor(score: number)')) {
  source = source.replace(
    /function gradeFor\(score: number\) \{[^\n]*\}/,
    (match) => `${match}\nfunction incentiveFor(score: number) { if (score >= 95) return 1500; if (score >= 90) return 1350; if (score >= 85) return 1200; if (score >= 80) return 1000; if (score >= 75) return 750; if (score >= 70) return 500; if (score >= 60) return 250; return 0; }`
  );
}
source = source.replace(/const suggestedIncentive = [^;]+;/, 'const suggestedIncentive = incentiveFor(overallScore);');

source = source.replace(
  /const strengthOptions = \[[^\n]*\];/,
  "const strengthOptions = ['ملتزم بالسياسات','مظهر مهني ممتاز','خدمة عميل ممتازة','سريع الاستجابة','دقيق في صرف الدواء','دقيق في الفواتير','يسجل الطلبات والمتابعات','يسلم الشيفت بدقة','متعاون مع الفريق والدليفري','مبادر في حل المشكلات','يطور متوسط الفاتورة باحتراف','سريع التعلم ويتحسن'];"
);
source = source.replace(
  /const developmentOptions = \[[^\n]*\];/,
  "const developmentOptions = ['الالتزام بالسياسات والتعليمات','الالتزام بالوقوف والزي','تحسين سرعة الرد','تقليل أخطاء الصرف','تحسين شرح الجرعة والصلاحية','زيادة دقة تسجيل المشتريات','زيادة دقة فواتير البيع','تسجيل طلبات العملاء فورًا','تحسين تسليم الشيفت','متابعة ملاحظات الشيفتات','تحسين التعاون مع الدليفري','تحسين التعاون مع الفروع والمخزن','رفع متوسط الفاتورة','زيادة عدد الأصناف المناسبة','منع تكرار الأخطاء'];"
);

source = source.replace(
  /async function downloadPdf\(\) \{[\s\S]*?\n  \}/,
  `async function downloadPdf() {
    if (!printRef.current || !selected) return;
    const pages = Array.from(printRef.current.querySelectorAll<HTMLElement>('[data-pdf-page]'));
    if (!pages.length) return;
    const pdf = new jsPDF('p', 'mm', 'a4');
    for (let index = 0; index < pages.length; index += 1) {
      const canvas = await html2canvas(pages[index], { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
      const image = canvas.toDataURL('image/png');
      if (index > 0) pdf.addPage();
      pdf.addImage(image, 'PNG', 0, 0, 210, 297);
    }
    const safeName = selected.name.replace(/[\\/:*?\"<>|]/g, '-');
    pdf.save(\`تقييم-تطوير-\${safeName}-\${month}.pdf\`);
    toast.success('تم إصدار تقرير التقييم التفصيلي');
  }`
);

source = source.replace(
  '<p className="mt-2 text-sm font-bold text-slate-300">نموذج موحّد يعتمد على بيانات التطبيق وتقييم مدير الفرع، ويربط النتيجة بالحافز وخطة التطوير.</p>',
  '<p className="mt-2 text-sm font-bold text-slate-300">نموذج تطوير وتشغيل موحّد بقيمة حافز قصوى 1500 جنيه، مستقل تمامًا عن حافز تارجت المبيعات.</p>'
);

const policyBanner = `<section className="rounded-3xl border border-amber-300/25 bg-amber-500/5 p-4"><h2 className="font-black text-amber-200">سياسة التقييم والحافز</h2><p className="mt-2 text-sm leading-7 text-slate-300">هذا التقييم هدفه التعليم والتطوير ورفع جودة تشغيل الفرع بالكامل. حافز الـ1500 جنيه مستقل عن تارجت المبيعات. يتم تقييم كل محور من 1 إلى 5، وتُحسب نقاطه حسب وزنه. يجب كتابة ملاحظة واضحة عند منح 1 أو 2 نجمة، وتحديد خطوة تطوير قابلة للقياس للشهر التالي. الأخطاء الجسيمة في صرف الدواء أو التلاعب في الفواتير تستوجب مراجعة إدارية مستقلة ولا يعوضها ارتفاع باقي الدرجات.</p></section>`;
if (!source.includes('سياسة التقييم والحافز')) {
  source = source.replace('<section className="space-y-3">{sections.map', `${policyBanner}\n\n          <section className="space-y-3">{sections.map`);
}

source = source.replace(
  /<div ref=\{printRef\}[\s\S]*?<\/div>\n        <\/?> :/,
  `<div ref={printRef} className="fixed -left-[10000px] top-0 w-[794px] bg-white text-slate-900" dir="rtl">
            <section data-pdf-page className="h-[1123px] w-[794px] bg-white p-12">
              <div className="border-b-4 border-cyan-700 pb-5 text-center"><h1 className="text-3xl font-black text-slate-900">صيدليات دواء - تقرير التقييم والتطوير الشهري</h1><p className="mt-3 text-lg font-bold">{selected.name} - {selected.branch} - {month}</p><p className="mt-2 text-sm text-slate-600">حافز تطوير وتشغيل مستقل عن تارجت المبيعات</p></div>
              <div className="mt-6 grid grid-cols-4 gap-3 text-center"><div className="rounded-xl border-2 border-slate-300 p-4"><b>النتيجة</b><div className="mt-2 text-2xl font-black">{overallScore}/100</div></div><div className="rounded-xl border-2 border-slate-300 p-4"><b>التقدير</b><div className="mt-2 text-xl font-black">{grade}</div></div><div className="rounded-xl border-2 border-slate-300 p-4"><b>الحافز المقترح</b><div className="mt-2 text-xl font-black">{suggestedIncentive} ج</div></div><div className="rounded-xl border-2 border-slate-300 p-4"><b>الحافز المعتمد</b><div className="mt-2 text-xl font-black">{approvedIncentive || 0} ج</div></div></div>
              <div className="mt-6 rounded-2xl border-2 border-amber-300 bg-amber-50 p-5"><h2 className="text-xl font-black">هدف التقييم</h2><p className="mt-2 leading-7">تحسين أداء الدكتور وتطوير الفريق والفرع، ورفع جودة الخدمة والدقة والتعاون والالتزام. تحقيق تارجت المبيعات له حافز منفصل ولا يدخل في نتيجة هذا التقرير.</p></div>
              <h2 className="mt-7 text-xl font-black">ملخص المحاور والأوزان</h2>
              <table className="mt-3 w-full table-fixed border-collapse text-[12px]"><thead><tr className="bg-slate-800 text-white"><th className="w-[34%] border p-2">المحور</th><th className="w-[10%] border p-2">الوزن</th><th className="w-[12%] border p-2">الدرجة</th><th className="w-[12%] border p-2">النقاط</th><th className="w-[32%] border p-2">ملخص المعيار</th></tr></thead><tbody>{sections.map((x)=><tr key={x.key}><td className="border p-2 font-bold">{x.title}</td><td className="border p-2 text-center">{x.weight}%</td><td className="border p-2 text-center">{x.score}/5</td><td className="border p-2 text-center font-black">{Math.round(((x.score/5)*x.weight)*10)/10}</td><td className="border p-2 leading-5">{x.description.split('•').slice(0,2).join(' • ')}</td></tr>)}</tbody></table>
            </section>
            <section data-pdf-page className="h-[1123px] w-[794px] bg-white p-12">
              <div className="border-b-4 border-cyan-700 pb-4"><h1 className="text-2xl font-black">تفاصيل محاور التقييم</h1><p className="mt-2 text-sm text-slate-600">{selected.name} - {month}</p></div>
              <div className="mt-5 grid grid-cols-2 gap-3">{sections.map((x)=><article key={x.key} className="break-inside-avoid rounded-xl border-2 border-slate-300 p-4"><div className="flex items-center justify-between gap-3"><h3 className="text-base font-black">{x.title}</h3><span className="rounded-lg bg-cyan-100 px-2 py-1 text-xs font-black">{x.weight}% - {x.score}/5</span></div><p className="mt-2 text-[11px] leading-6 text-slate-700">{x.description}</p><div className="mt-3 border-t pt-2 text-[11px]"><b>ملاحظات المدير:</b><p className="mt-1 min-h-10 whitespace-pre-wrap">{x.notes || 'لا توجد ملاحظات مسجلة'}</p></div></article>)}</div>
            </section>
            <section data-pdf-page className="h-[1123px] w-[794px] bg-white p-12">
              <div className="border-b-4 border-cyan-700 pb-4"><h1 className="text-2xl font-black">خطة التطوير والاعتماد</h1><p className="mt-2 text-sm text-slate-600">{selected.name} - {selected.branch} - {month}</p></div>
              <div className="mt-6 grid grid-cols-2 gap-4"><div className="rounded-xl border-2 border-emerald-300 bg-emerald-50 p-5"><h2 className="text-lg font-black">نقاط القوة</h2><p className="mt-3 leading-7">{strengths.join('، ') || 'لم يتم تحديد نقاط قوة'}</p></div><div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-5"><h2 className="text-lg font-black">نقاط التطوير</h2><p className="mt-3 leading-7">{developmentPoints.join('، ') || 'لم يتم تحديد نقاط تطوير'}</p></div></div>
              <div className="mt-5 rounded-xl border-2 border-slate-300 p-5"><h2 className="text-lg font-black">خطة الشهر القادم وملاحظات المدير</h2><p className="mt-3 min-h-32 whitespace-pre-wrap leading-7">{managerNotes || 'لا توجد ملاحظات مسجلة'}</p></div>
              <div className="mt-5 rounded-xl border-2 border-slate-300 p-5"><h2 className="text-lg font-black">مؤشرات مساندة من التطبيق</h2><div className="mt-3 grid grid-cols-3 gap-3 text-sm">{Object.entries(metrics).map(([key,value])=><div key={key} className="rounded-lg bg-slate-100 p-3"><b>{key.replaceAll('_',' ')}</b><div className="mt-1 text-lg font-black">{value}</div></div>)}</div></div>
              <div className="mt-6 rounded-xl border-2 border-cyan-300 bg-cyan-50 p-5"><h2 className="text-lg font-black">سياسة الحافز التطويري</h2><p className="mt-2 leading-7">95-100 = 1500 ج، 90-94 = 1350 ج، 85-89 = 1200 ج، 80-84 = 1000 ج، 75-79 = 750 ج، 70-74 = 500 ج، 60-69 = 250 ج، وأقل من 60 بدون حافز مع خطة تحسين. الأخطاء الجسيمة تخضع لمراجعة إدارية مستقلة.</p></div>
              <div className="mt-20 flex justify-between text-base font-bold"><span>توقيع مدير الفرع: __________________</span><span>توقيع الدكتور: __________________</span></div>
            </section>
          </div>
        </> :`
);

if (!source.includes("title: 'الالتزام بالسياسات والسلوك المهني'")) throw new Error('[monthly-development-model] sections patch failed');
if (!source.includes('data-pdf-page')) throw new Error('[monthly-development-model] PDF pages patch failed');
if (!source.includes('حافز تطوير وتشغيل مستقل')) throw new Error('[monthly-development-model] policy wording missing');

if (source !== before) {
  fs.writeFileSync(file, source);
  console.log('[monthly-development-model] strong development model and 3-page PDF applied');
} else {
  console.log('[monthly-development-model] already applied');
}
