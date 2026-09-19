import WhatsAppExperimentPage from '@/components/whatsappExperiments/WhatsAppExperimentPage';
import {
  ConversationTranscript,
  CriteriaBreakdown,
  SessionSummary,
} from '@/components/whatsappExperiments/ExperimentSessionDetails';
import { runApproachBExperiment } from '@/lib/whatsappExperiments/approachBRunner';
import type { ExperimentFileLogEntry } from '@/lib/whatsappExperiments/types';

function ApproachBDetails({ entry }: { entry: ExperimentFileLogEntry }) {
  if (!entry.approachB?.length) return null;
  return (
    <div className="mt-2 space-y-3">
      {entry.approachB.map((item, i) => {
        const session = entry.sessions?.[i];
        const evidenceIds = item.criteria?.flatMap((criterion) => criterion.evidenceMessageIds) || [];
        return (
          <details key={i} className="rounded-xl border border-teal-400/20 bg-teal-500/5 p-3">
            <summary className="cursor-pointer list-none">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-black text-teal-200">
                  جلسة {i + 1} — {session?.customerName || 'عميل غير محدد'}
                </div>
                <div className="flex flex-wrap gap-2 text-[10px] font-bold">
                  <span className="rounded-full bg-teal-500/15 px-2 py-1 text-teal-200">Score {item.finalScore ?? '-'}/100</span>
                  <span className="rounded-full bg-emerald-500/15 px-2 py-1 text-emerald-300">
                    Signals {item.signalResolvedCount ?? '-'}
                  </span>
                  <span className="rounded-full bg-amber-500/15 px-2 py-1 text-amber-300">
                    Fallback {item.defaultFallbackCount ?? '-'}
                  </span>
                  <span className="rounded-full bg-sky-500/15 px-2 py-1 text-sky-300">
                    Coverage {item.coveragePercent ?? '-'}%
                  </span>
                </div>
              </div>
              <div className="mt-1 text-[11px] text-slate-400">
                {item.level || '-'} · {item.reviewRequiredCount ?? '-'} بند يحتاج مراجعة بشرية · اضغط لمراجعة الـ19 معيار والمحادثة
              </div>
            </summary>

            <SessionSummary session={session} />

            <div className="mt-3 grid gap-2 text-[11px] sm:grid-cols-2 lg:grid-cols-4">
              <div><span className="font-black">المراجع:</span> {item.reviewerDisplay}</div>
              <div><span className="font-black">نوع التقييم:</span> {item.evaluationKind}</div>
              <div><span className="font-black">تأثير النقاط المتوقع:</span> {item.doctorPointsImpact}</div>
              <div><span className="font-black">Severe:</span> {item.hasSevereError ? 'مفعّل' : 'false'}</div>
              <div><span className="font-black">Signals:</span> {item.signalResolvedCount ?? '-'}</div>
              <div><span className="font-black">Fallback:</span> {item.defaultFallbackCount ?? '-'}</div>
              <div><span className="font-black">غير منطبق:</span> {item.notApplicableCount ?? '-'}</div>
              <div><span className="font-black">يحتاج مراجعة:</span> {item.reviewRequiredCount ?? '-'}</div>
            </div>

            {item.suspicions.length ? (
              <div className="mt-3 rounded-xl border border-amber-400/20 bg-amber-500/5 p-3 text-[11px] text-amber-200">
                <div className="font-black">اشتباه يحتاج تأكيد بشري:</div>
                <div className="mt-1">{item.suspicions.join(' | ')}</div>
              </div>
            ) : null}

            <div className="mt-4">
              <div className="mb-2 text-xs font-black text-[var(--dawaa-theme-heading)]">تفاصيل الـ19 معيار</div>
              <CriteriaBreakdown criteria={item.criteria} session={session} />
            </div>

            <div className="mt-4">
              <div className="mb-2 text-xs font-black text-[var(--dawaa-theme-heading)]">
                المحادثة كاملة — الرسائل المظللة هي أدلة مستخدمة في التقييم
              </div>
              <ConversationTranscript session={session} evidenceIds={evidenceIds} />
            </div>
          </details>
        );
      })}
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
        whatItDoes: 'يقيّم المحادثة وفق معايير التقييم الـ19، مع عرض سبب وثقة ودليل كل معيار.',
        whatItSaves:
          'في Dry Run: لا شيء. في Live Run: conversation_sales_reviews + linking source أدنى + points pending عند وجود تأثير.',
        createsOfficialReview: true,
        addsPoints: true,
        needsHumanReview: true,
      }}
      warningNote="Dry Run هو الافتراضي ولا يكتب شيئًا. افتح كل جلسة لمراجعة الـ19 معيار ومصدر كل حكم قبل أي Live Run."
      onRunFile={runApproachBExperiment}
      renderDetails={(entry) => <ApproachBDetails entry={entry} />}
    />
  );
}
