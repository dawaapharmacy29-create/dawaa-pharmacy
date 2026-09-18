import WhatsAppExperimentPage from '@/components/whatsappExperiments/WhatsAppExperimentPage';
import { runApproachBExperiment } from '@/lib/whatsappExperiments/approachBRunner';
import type { ExperimentFileLogEntry } from '@/lib/whatsappExperiments/types';

function ApproachBDetails({ entry }: { entry: ExperimentFileLogEntry }) {
  if (!entry.approachB?.length) return null;
  return (
    <div className="mt-2 space-y-2">
      {entry.approachB.map((item, i) => (
        <div key={i} className="rounded-lg border border-teal-400/20 bg-teal-500/5 p-2">
          <div className="flex flex-wrap gap-3 text-[11px] font-bold text-slate-300">
            <span>official review: {item.status === 'saved' ? `تم إنشاؤه (${item.reviewId?.slice(0, 8)})` : item.status}</span>
            <span>score: {item.finalScore ?? '-'}{item.level ? ` (${item.level})` : ''}</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-slate-400">
            <span>المراجع: {item.reviewerDisplay}</span>
            <span>automatic/manual: evaluation_kind=automatic</span>
            <span className={item.hasSevereError ? 'text-rose-300' : 'text-emerald-300'}>
              severe error: {item.hasSevereError ? 'مفعّل (خطأ في التصميم!)' : 'false دايمًا (مضمونة)'}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-slate-400">
            <span>تأثير النقاط: {item.doctorPointsImpact}</span>
            <span className={item.pointsError ? 'text-rose-300' : item.pointsRecorded ? 'text-emerald-300' : 'text-slate-400'}>
              points status: {item.pointsError ? `فشل (${item.pointsError})` : item.doctorPointsImpact === 0 ? 'لا يوجد أثر' : 'pending'}
            </span>
            <span>duplicate prevented: {item.duplicatePrevented ? 'نعم' : 'لا'}</span>
          </div>
          <div className="mt-1 text-[11px] text-slate-400">
            notification status: {item.status === 'saved' ? 'الإشعار للدكتور اتبعت تلقائيًا (trigger notify_doctor_on_conversation_review) باسم "تقييم آلي" وليس اسم موظف حقيقي' : '-'}
          </div>
          {item.suspicions.length ? (
            <div className="mt-1 text-[11px] text-amber-300">⚠ اشتباه (بدون اعتماد تلقائي): {item.suspicions.join(' | ')}</div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export default function WhatsAppReviewExperimentApproachB() {
  return (
    <WhatsAppExperimentPage
      approach="B"
      pageTitle="التقييم الآلي لواتساب - الطريقة B"
      description="التقييم الآلي الرسمي وحده — بيستخدم أقل ربط ممكن بجدول whatsapp_review_sources (فقط عشان قيد الربط في قاعدة البيانات)، من غير تشغيل تحليل/طابور/متابعة Approach A."
      info={{
        name: 'Approach B — تقييم آلي رسمي',
        whatItDoes: 'تقييم آلي رسمي للمحادثة وفق معايير التقييم الـ19 (نفس محرك المراجعة اليدوية)، ويحفظ النتيجة مباشرة في conversation_sales_reviews.',
        whatItSaves:
          'صف رسمي في conversation_sales_reviews (evaluation_kind=automatic)، وصف ربط أدنى في whatsapp_review_sources (مطلوب من قيد قاعدة البيانات فقط)، وحركة نقاط pending في employee_transactions لو فيه تأثير نقاط.',
        createsOfficialReview: true,
        addsPoints: true,
        needsHumanReview: true,
      }}
      warningNote="⚠️ تجربة حقيقية: بتنشئ تقييم رسمي فعلي + حركة نقاط pending على قاعدة البيانات الحية. النقاط لن تُعتمد إلا بمراجعة مدير يدويًا."
      onRunFile={runApproachBExperiment}
      renderDetails={(entry) => <ApproachBDetails entry={entry} />}
    />
  );
}
