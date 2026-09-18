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
            <span>
              official review:{' '}
              {item.status === 'preview'
                ? 'معاينة فقط — لم يتم الحفظ'
                : item.status === 'saved'
                  ? `تم إنشاؤه (${item.reviewId?.slice(0, 8)})`
                  : item.status}
            </span>
            <span>score: {item.finalScore ?? '-'}{item.level ? ` (${item.level})` : ''}</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-slate-400">
            <span>المراجع: {item.reviewerDisplay}</span>
            <span>automatic/manual: evaluation_kind=automatic</span>
            <span className={item.hasSevereError ? 'text-rose-300' : 'text-emerald-300'}>
              severe error: {item.hasSevereError ? 'مفعّل (خطأ في التصميم!)' : 'false'}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-slate-400">
            <span>تأثير النقاط المتوقع: {item.doctorPointsImpact}</span>
            <span className={item.pointsError ? 'text-rose-300' : item.status === 'preview' ? 'text-sky-300' : 'text-slate-400'}>
              points status:{' '}
              {item.status === 'preview'
                ? 'preview فقط — لم يتم استدعاء RPC'
                : item.pointsError
                  ? `فشل (${item.pointsError})`
                  : item.doctorPointsImpact === 0
                    ? 'لا يوجد أثر'
                    : 'pending'}
            </span>
            <span>duplicate prevented: {item.duplicatePrevented ? 'نعم' : 'لا'}</span>
          </div>
          <div className="mt-1 text-[11px] text-slate-400">
            notification status:{' '}
            {item.status === 'preview'
              ? 'لم يتم إرسال إشعار في Dry Run'
              : item.status === 'saved'
                ? 'تم تشغيل trigger الإشعار باسم التقييم الآلي'
                : '-'}
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
      description="التقييم الرسمي B فقط. Dry Run يشغّل محرك التقييم نفسه بدون إنشاء linking source أو تقييم أو نقاط أو إشعار."
      info={{
        name: 'Approach B — تقييم آلي رسمي',
        whatItDoes: 'يقيّم المحادثة وفق معايير التقييم الـ19. الحفظ الرسمي يحصل في Live Run فقط.',
        whatItSaves:
          'في Dry Run: لا شيء. في Live Run: conversation_sales_reviews + linking source أدنى + points pending عند وجود تأثير.',
        createsOfficialReview: true,
        addsPoints: true,
        needsHumanReview: true,
      }}
      warningNote="Dry Run هو الافتراضي ولا يكتب شيئًا. Live Run فقط يستخدم قاعدة البيانات الحية وقد ينشئ تقييمًا رسميًا ونقاط pending."
      onRunFile={runApproachBExperiment}
      renderDetails={(entry) => <ApproachBDetails entry={entry} />}
    />
  );
}
