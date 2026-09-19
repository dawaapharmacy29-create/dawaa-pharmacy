import WhatsAppExperimentPage from '@/components/whatsappExperiments/WhatsAppExperimentPage';
import {
  ConversationTranscript,
  SessionSummary,
} from '@/components/whatsappExperiments/ExperimentSessionDetails';
import { runApproachAExperiment } from '@/lib/whatsappExperiments/approachARunner';
import type { ExperimentFileLogEntry } from '@/lib/whatsappExperiments/types';

function ApproachADetails({ entry }: { entry: ExperimentFileLogEntry }) {
  if (!entry.approachA?.length) return null;
  return (
    <div className="mt-2 space-y-3">
      {entry.approachA.map((item, i) => {
        const session = entry.sessions?.[i];
        return (
          <details key={i} className="rounded-xl border border-violet-400/20 bg-violet-500/5 p-3">
            <summary className="cursor-pointer list-none">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-black text-violet-200">
                  جلسة {i + 1} — {session?.customerName || 'عميل غير محدد'}
                </div>
                <div className="flex flex-wrap gap-2 text-[10px] font-bold">
                  <span className="rounded-full bg-violet-500/15 px-2 py-1">ثقة {item.confidence ?? '-'}%</span>
                  <span className="rounded-full bg-slate-500/15 px-2 py-1">{item.priority || '-'}</span>
                  <span className="rounded-full bg-amber-500/15 px-2 py-1 text-amber-300">{item.flags.length} flags</span>
                </div>
              </div>
              <div className="mt-1 text-[11px] text-slate-400">
                {item.primaryTypeLabel || '-'} · {item.outcomeLabel || '-'} · اضغط لمراجعة الجلسة بالتفصيل
              </div>
            </summary>

            <SessionSummary session={session} />

            <div className="mt-3 grid gap-2 text-[11px] sm:grid-cols-2 lg:grid-cols-3">
              <div><span className="font-black">النية النهائية:</span> {item.finalIntent || '-'}</div>
              <div><span className="font-black">آخر مسؤول:</span> {item.lastOwner || '-'}</div>
              <div><span className="font-black">أول رد:</span> {item.firstResponseSeconds == null ? '-' : `${item.firstResponseSeconds} ثانية`}</div>
              <div><span className="font-black">أطول انتظار:</span> {item.longestWaitSeconds == null ? '-' : `${item.longestWaitSeconds} ثانية`}</div>
              <div><span className="font-black">رسائل بلا رد:</span> {item.unansweredInboundCount ?? '-'}</div>
              <div><span className="font-black">مطابقة الفاتورة:</span> {item.invoiceMatchStatus || '-'}</div>
            </div>

            {item.flags.length ? (
              <div className="mt-3 rounded-xl border border-amber-400/20 bg-amber-500/5 p-3 text-[11px]">
                <div className="font-black text-amber-300">لماذا A رفعت تنبيه؟</div>
                <div className="mt-1">{item.flags.join('، ')}</div>
                {item.suggestedFollowupReason ? <div className="mt-1">سبب المتابعة: {item.suggestedFollowupReason}</div> : null}
              </div>
            ) : null}

            {item.lastMeaningfulMessage ? (
              <div className="mt-3 rounded-xl border border-[var(--dawaa-theme-border)] p-3 text-[11px]">
                <span className="font-black">آخر رسالة ذات معنى:</span> {item.lastMeaningfulMessage}
              </div>
            ) : null}

            <div className="mt-3">
              <div className="mb-2 text-xs font-black text-[var(--dawaa-theme-heading)]">المحادثة كاملة</div>
              <ConversationTranscript session={session} />
            </div>

            {!item.v4FieldsPopulated ? (
              <div className="mt-3 text-[11px] text-slate-500">
                مؤشرات V4 مثل medical safety flags / lost sales غير مُعبأة في هذا المسار؛ الظاهر هنا هو ناتج smart-summary-v1 الفعلي.
              </div>
            ) : null}
          </details>
        );
      })}
    </div>
  );
}

export default function WhatsAppReviewExperimentApproachA() {
  return (
    <WhatsAppExperimentPage
      approach="A"
      pageTitle="تحليل واتساب الذكي - الطريقة A"
      description="مسار التحليل والطابور A فقط. المعاينة الآمنة هي الوضع الافتراضي ولا تكتب أي بيانات."
      info={{
        name: 'Approach A — تحليل ذكي + طابور',
        whatItDoes:
          'تحليل ذكي للمحادثة + Queue + فرص ضائعة + Follow-up. لا ينشئ تقييمًا رسميًا في conversation_sales_reviews حاليًا.',
        whatItSaves: 'في Dry Run: لا شيء. في Live Run فقط: whatsapp_review_sources وربما whatsapp_auto_followup_requests.',
        createsOfficialReview: false,
        addsPoints: false,
        needsHumanReview: true,
      }}
      warningNote="Dry Run آمن افتراضيًا. فعّل Live Run يدويًا فقط لو عايز اختبار الكتابة الحقيقية للطريقة A."
      onRunFile={runApproachAExperiment}
      renderDetails={(entry) => <ApproachADetails entry={entry} />}
    />
  );
}
