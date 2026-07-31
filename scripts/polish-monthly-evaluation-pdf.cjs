const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/StaffMonthlyEvaluation.tsx');
if (!fs.existsSync(file)) throw new Error('[monthly-pdf-polish] StaffMonthlyEvaluation.tsx not found');

let source = fs.readFileSync(file, 'utf8');
const before = source;

const polished = `<div ref={printRef} className="fixed -left-[10000px] top-0 w-[794px] bg-white text-slate-900" dir="rtl">
            <section data-pdf-page className="h-[1123px] w-[794px] overflow-hidden bg-white px-12 py-10">
              <header className="border-b-[3px] border-teal-600 pb-5 text-center">
                <h1 className="text-[28px] font-black text-slate-900">صيدليات دواء</h1>
                <p className="mt-2 text-[21px] font-black text-slate-800">تقرير التقييم والتطوير الشهري</p>
                <p className="mt-3 text-[16px] font-bold text-slate-600">{selected.name} — {selected.branch} — {month}</p>
                <p className="mt-2 text-[12px] font-bold text-teal-700">حافز تطوير وتشغيل مستقل تمامًا عن تارجت المبيعات</p>
              </header>

              <div className="mt-6 grid grid-cols-4 gap-3 text-center">
                <div className="rounded-xl border border-slate-300 bg-slate-50 p-4"><div className="text-[12px] font-bold text-slate-500">النتيجة</div><div className="mt-2 text-[24px] font-black text-slate-900">{overallScore}/100</div></div>
                <div className="rounded-xl border border-slate-300 bg-slate-50 p-4"><div className="text-[12px] font-bold text-slate-500">التقدير</div><div className="mt-2 text-[20px] font-black text-slate-900">{grade}</div></div>
                <div className="rounded-xl border border-slate-300 bg-slate-50 p-4"><div className="text-[12px] font-bold text-slate-500">الحافز المقترح</div><div className="mt-2 text-[20px] font-black text-teal-700">{suggestedIncentive.toLocaleString('ar-EG')} ج</div></div>
                <div className="rounded-xl border border-slate-300 bg-slate-50 p-4"><div className="text-[12px] font-bold text-slate-500">الحافز المعتمد</div><div className="mt-2 text-[20px] font-black text-slate-900">{approvedIncentive.toLocaleString('ar-EG')} ج</div></div>
              </div>

              <div className="mt-6 rounded-xl border border-teal-200 bg-teal-50 p-5">
                <h2 className="text-[18px] font-black text-slate-900">هدف التقييم</h2>
                <p className="mt-2 text-[13px] leading-7 text-slate-700">تحسين أداء الدكتور وتطوير الفريق والفرع، ورفع جودة الخدمة والدقة والتعاون والالتزام. هذا الحافز لا يعتمد على تحقيق تارجت المبيعات، لأن تارجت المبيعات له نظام وحافز منفصل.</p>
              </div>

              <h2 className="mt-7 text-[18px] font-black text-slate-900">ملخص المحاور والأوزان</h2>
              <table className="mt-3 w-full table-fixed border-collapse text-[11px]">
                <thead><tr className="bg-slate-800 text-white"><th className="w-[38%] border border-slate-500 p-2">المحور</th><th className="w-[12%] border border-slate-500 p-2">الوزن</th><th className="w-[14%] border border-slate-500 p-2">التقييم</th><th className="w-[14%] border border-slate-500 p-2">النقاط</th><th className="w-[22%] border border-slate-500 p-2">الملاحظة المختصرة</th></tr></thead>
                <tbody>{sections.map((x,index)=><tr key={x.key} className={index%2===0?'bg-white':'bg-slate-50'}><td className="border border-slate-300 p-2 font-bold">{x.title}</td><td className="border border-slate-300 p-2 text-center">{x.weight}%</td><td className="border border-slate-300 p-2 text-center">{x.score}/5</td><td className="border border-slate-300 p-2 text-center font-black">{Math.round((x.score/5)*x.weight*10)/10}</td><td className="border border-slate-300 p-2 text-[10px] leading-5">{x.notes || '—'}</td></tr>)}</tbody>
                <tfoot><tr className="bg-slate-100 font-black"><td className="border border-slate-300 p-2" colSpan={3}>الإجمالي النهائي</td><td className="border border-slate-300 p-2 text-center">{overallScore}/100</td><td className="border border-slate-300 p-2"></td></tr></tfoot>
              </table>

              <footer className="mt-6 flex justify-between border-t border-slate-300 pt-3 text-[10px] text-slate-500"><span>صيدليات دواء — تقرير داخلي للتطوير</span><span>صفحة 1 من 4</span></footer>
            </section>

            <section data-pdf-page className="h-[1123px] w-[794px] overflow-hidden bg-white px-12 py-10">
              <header className="border-b-[3px] border-teal-600 pb-4"><h2 className="text-[24px] font-black text-slate-900">تفاصيل محاور التقييم — الجزء الأول</h2><p className="mt-2 text-[13px] font-bold text-slate-500">{selected.name} — {month}</p></header>
              <div className="mt-6 space-y-4">{sections.slice(0,5).map((x)=><article key={x.key} className="rounded-xl border border-slate-300 bg-white p-4"><div className="flex items-start justify-between gap-4"><div className="min-w-0"><h3 className="text-[17px] font-black text-slate-900">{x.title}</h3><p className="mt-2 text-[11px] leading-6 text-slate-600">{x.description}</p></div><div className="shrink-0 rounded-lg bg-teal-50 px-4 py-3 text-center"><div className="text-[11px] font-bold text-teal-800">{x.weight}%</div><div className="mt-1 text-[18px] font-black text-slate-900">{x.score}/5</div><div className="mt-1 text-[10px] text-slate-500">{Math.round((x.score/5)*x.weight*10)/10} نقطة</div></div></div><div className="mt-3 border-t border-slate-200 pt-3"><div className="text-[11px] font-black text-slate-700">ملاحظات المدير</div><p className="mt-1 min-h-[28px] text-[11px] leading-6 text-slate-600">{x.notes || 'لا توجد ملاحظات مسجلة.'}</p></div></article>)}</div>
              <footer className="mt-5 flex justify-between border-t border-slate-300 pt-3 text-[10px] text-slate-500"><span>تفاصيل المحاور 1–5</span><span>صفحة 2 من 4</span></footer>
            </section>

            <section data-pdf-page className="h-[1123px] w-[794px] overflow-hidden bg-white px-12 py-10">
              <header className="border-b-[3px] border-teal-600 pb-4"><h2 className="text-[24px] font-black text-slate-900">تفاصيل محاور التقييم — الجزء الثاني</h2><p className="mt-2 text-[13px] font-bold text-slate-500">{selected.name} — {month}</p></header>
              <div className="mt-6 space-y-4">{sections.slice(5,10).map((x)=><article key={x.key} className="rounded-xl border border-slate-300 bg-white p-4"><div className="flex items-start justify-between gap-4"><div className="min-w-0"><h3 className="text-[17px] font-black text-slate-900">{x.title}</h3><p className="mt-2 text-[11px] leading-6 text-slate-600">{x.description}</p></div><div className="shrink-0 rounded-lg bg-teal-50 px-4 py-3 text-center"><div className="text-[11px] font-bold text-teal-800">{x.weight}%</div><div className="mt-1 text-[18px] font-black text-slate-900">{x.score}/5</div><div className="mt-1 text-[10px] text-slate-500">{Math.round((x.score/5)*x.weight*10)/10} نقطة</div></div></div><div className="mt-3 border-t border-slate-200 pt-3"><div className="text-[11px] font-black text-slate-700">ملاحظات المدير</div><p className="mt-1 min-h-[28px] text-[11px] leading-6 text-slate-600">{x.notes || 'لا توجد ملاحظات مسجلة.'}</p></div></article>)}</div>
              <footer className="mt-5 flex justify-between border-t border-slate-300 pt-3 text-[10px] text-slate-500"><span>تفاصيل المحاور 6–10</span><span>صفحة 3 من 4</span></footer>
            </section>

            <section data-pdf-page className="h-[1123px] w-[794px] overflow-hidden bg-white px-12 py-10">
              <header className="border-b-[3px] border-teal-600 pb-4"><h2 className="text-[24px] font-black text-slate-900">خطة التطوير والاعتماد</h2><p className="mt-2 text-[13px] font-bold text-slate-500">{selected.name} — {selected.branch} — {month}</p></header>
              <div className="mt-6 grid grid-cols-2 gap-4"><div className="rounded-xl border border-emerald-300 bg-emerald-50 p-5"><h3 className="text-[17px] font-black text-emerald-900">نقاط القوة</h3><p className="mt-3 text-[12px] leading-7 text-slate-700">{strengths.join('، ') || 'لم يتم تحديد نقاط قوة.'}</p></div><div className="rounded-xl border border-amber-300 bg-amber-50 p-5"><h3 className="text-[17px] font-black text-amber-900">نقاط التطوير</h3><p className="mt-3 text-[12px] leading-7 text-slate-700">{developmentPoints.join('، ') || 'لم يتم تحديد نقاط تطوير.'}</p></div></div>
              <div className="mt-5 rounded-xl border border-slate-300 p-5"><h3 className="text-[17px] font-black text-slate-900">خطة الشهر القادم وملاحظات المدير</h3><p className="mt-3 min-h-[110px] whitespace-pre-wrap text-[12px] leading-7 text-slate-700">{managerNotes || 'لا توجد ملاحظات مسجلة.'}</p></div>
              <div className="mt-5 rounded-xl border border-slate-300 p-5"><h3 className="text-[17px] font-black text-slate-900">مؤشرات مساندة من التطبيق</h3><div className="mt-4 grid grid-cols-4 gap-3 text-center">{Object.entries(metrics).map(([key,value])=>{ const labels: Record<string,string> = { review_count:'عدد تقييمات المحادثات', review_average:'متوسط تقييم المحادثات', completed_followups:'المتابعات المكتملة', followup_count:'إجمالي المتابعات', positive_points:'النقاط الموجبة', negative_points:'النقاط السالبة', attendance_days:'أيام الحضور المسجلة', present_days:'أيام الالتزام' }; return <div key={key} className="rounded-lg bg-slate-50 p-3"><div className="text-[10px] font-bold leading-4 text-slate-500">{labels[key] || key}</div><div className="mt-2 text-[18px] font-black text-slate-900">{value}</div></div>})}</div></div>
              <div className="mt-5 rounded-xl border border-teal-300 bg-teal-50 p-5"><h3 className="text-[16px] font-black text-teal-900">سياسة الحافز التطويري</h3><p className="mt-2 text-[11px] leading-6 text-slate-700">95–100 = 1500 ج، 90–94 = 1350 ج، 85–89 = 1200 ج، 80–84 = 1000 ج، 75–79 = 750 ج، 70–74 = 500 ج، 60–69 = 250 ج، وأقل من 60 بدون حافز مع خطة تحسين. الأخطاء الجسيمة تخضع لمراجعة إدارية مستقلة.</p></div>
              <div className="mt-12 flex justify-between text-[13px] font-bold text-slate-700"><span>توقيع مدير الفرع: __________________</span><span>توقيع الموظف: __________________</span></div>
              <footer className="mt-10 flex justify-between border-t border-slate-300 pt-3 text-[10px] text-slate-500"><span>خطة التطوير والاعتماد</span><span>صفحة 4 من 4</span></footer>
            </section>
          </div>`;

source = source.replace(/<div ref=\{printRef\}[\s\S]*?<\/div>\n        <\/?> :/, `${polished}\n        </> :`);

if (!source.includes('صفحة 4 من 4')) throw new Error('[monthly-pdf-polish] polished PDF block was not applied');
fs.writeFileSync(file, source);
console.log(`[monthly-pdf-polish] ${source === before ? 'already applied' : 'applied white A4 print layout'}`);
