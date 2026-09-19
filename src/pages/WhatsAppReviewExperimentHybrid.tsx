import WhatsAppExperimentPage from '@/components/whatsappExperiments/WhatsAppExperimentPage';
import {
  ConversationTranscript,
  CriteriaBreakdown,
  SessionSummary,
} from '@/components/whatsappExperiments/ExperimentSessionDetails';
import { runHybridExperiment } from '@/lib/whatsappExperiments/hybridRunner';
import type { ExperimentFileLogEntry } from '@/lib/whatsappExperiments/types';

function HybridDetails({ entry }: { entry: ExperimentFileLogEntry }) {
  const count = Math.max(entry.approachA?.length || 0, entry.approachB?.length || 0);
  return (
    <div className="mt-2 space-y-3">
      {Array.from({ length: count }).map((_, i) => {
        const a = entry.approachA?.[i];
        const b = entry.approachB?.[i];
        const session = entry.sessions?.[i];
        const evidenceIds = b?.criteria?.flatMap((criterion) => criterion.evidenceMessageIds) || [];
        return (
          <details key={i} className="rounded-xl border border-amber-400/20 bg-amber-500/5 p-3">
            <summary className="cursor-pointer list-none">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-black text-amber-200">
                  جلسة {i + 1} — {session?.customerName || 'عميل غير محدد'}
                </div>
                <div className="flex flex-wrap gap-2 text-[10px] font-bold">
                  <span className="rounded-full bg-violet-500/15 px-2 py-1 text-violet-300">A ثقة {a?.confidence ?? '-'}%</span>
                  <span className="rounded-full bg-teal-500/15 px-2 py-1 text-teal-300">B {b?.finalScore ?? '-'}/100</span>
                  <span className="rounded-full bg-amber-500/15 px-2 py-1 text-amber-300">Fallback {b?.defaultFallbackCount ?? '-'}</span>
                </div>
              </div>
              <div className="mt-1 text-[11px] text-slate-400">
                مقارنة A مقابل B لنفس الجلسة — اضغط لعرض التحليل والتقييم والمحادثة
              </div>
            </summary>

            <SessionSummary session={session} />

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-violet-400/20 bg-violet-500/5 p-3 text-[11px]">
                <div className="mb-2 font-black text-violet-300">A — تحليل المحادثة</div>
                {a ? (
                  <div className="space-y-1.5">
                    <div><span className="font-black">النوع:</span> {a.primaryTypeLabel || '-'}</div>
                    <div><span className="font-black">النية:</span> {a.finalIntent || '-'}</div>
                    <div><span className="font-black">النتيجة:</span> {a.outcomeLabel || '-'}</div>
                    <div><span className="font-black">الثقة:</span> {a.confidence ?? '-'}%</div>
                    <div><span className="font-black">الأولوية:</span> {a.priority || '-'}</div>
                    <div><span className="font-black">Flags:</span> {a.flags.length ? a.flags.join('، ') : 'لا يوجد'}</div>
                    <div><span className="font-black">أول رد:</span> {a.firstResponseSeconds == null ? '-' : `${a.firstResponseSeconds} ثانية`}</div>
                    <div><span className="font-black">أطول انتظار:</span> {a.longestWaitSeconds == null ? '-' : `${a.longestWaitSeconds} ثانية`}</div>
                  </div>
                ) : <div className="text-slate-500">لا توجد نتيجة A.</div>}
              </div>

              <div className="rounded-xl border border-teal-400/20 bg-teal-500/5 p-3 text-[11px]">
                <div className="mb-2 font-black text-teal-300">B — التقييم الرسمي</div>
                {b ? (
                  <div className="space-y-1.5">
                    <div><span className="font-black">الدرجة:</span> {b.finalScore ?? '-'}/100 ({b.level || '-'})</div>
                    <div><span className="font-black">Signals:</span> {b.signalResolvedCount ?? '-'}</div>
                    <div><span className="font-black">Fallback:</span> {b.defaultFallbackCount ?? '-'}</div>
                    <div><span className="font-black">Coverage:</span> {b.coveragePercent ?? '-'}%</div>
                    <div><span className="font-black">يحتاج مراجعة:</span> {b.reviewRequiredCount ?? '-'}</div>
                    <div><span className="font-black">النقاط المتوقعة:</span> {b.doctorPointsImpact}</div>
                    <div><span className="font-black">Severe:</span> {b.hasSevereError ? 'مفعّل' : 'false'}</div>
                  </div>
                ) : <div className="text-slate-500">لا توجد نتيجة B.</div>}
              </div>
            </div>

            <div className="mt-4">
              <div className="mb-2 text-xs font-black text-[var(--dawaa-theme-heading)]">تفاصيل معايير B</div>
              <CriteriaBreakdown criteria={b?.criteria} session={session} />
            </div>

            <div className="mt-4">
              <div className="mb-2 text-xs font-black text-[var(--dawaa-theme-heading)]">المحادثة الأصلية</div>
              <ConversationTranscript session={session} evidenceIds={evidenceIds} />
            </div>
          </details>
        );
      })}
    </div>
  );
}

export default function WhatsAppReviewExperimentHybrid() {
  return (
    <WhatsAppExperimentPage
      approach="hybrid"
      pageTitle="واتساب - النظام المدمج A+B"
      description="يعرض A وB على نفس الجلسة مع المحادثة الأصلية وتفاصيل المعايير، عشان المقارنة تبقى مباشرة وواضحة."
      info={{
        name: 'Hybrid A+B — المسار المدمج',
        whatItDoes: 'يقارن نتيجة تحليل A مع التقييم الرسمي B لنفس الجلسة، ويعرض أسباب الاختلاف والأدلة.',
        whatItSaves: 'في Dry Run: لا شيء. في Live Run: مخرجات A + conversation_sales_reviews + points pending حسب النتيجة.',
        createsOfficialReview: true,
        addsPoints: true,
        needsHumanReview: true,
      }}
      warningNote="Dry Run آمن افتراضيًا. استخدمه أولًا لمراجعة الفرق بين A وB جلسة بجلسة قبل أي Live Run."
      onRunFile={runHybridExperiment}
      renderDetails={(entry) => <HybridDetails entry={entry} />}
    />
  );
}
