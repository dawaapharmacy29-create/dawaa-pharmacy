import WhatsAppExperimentPage from '@/components/whatsappExperiments/WhatsAppExperimentPage';
import { runApproachAExperiment } from '@/lib/whatsappExperiments/approachARunner';
import type { ExperimentFileLogEntry } from '@/lib/whatsappExperiments/types';

function ApproachADetails({ entry }: { entry: ExperimentFileLogEntry }) {
  if (!entry.approachA?.length) return null;
  return (
    <div className="mt-2 space-y-2">
      {entry.approachA.map((item, i) => (
        <div key={i} className="rounded-lg border border-violet-400/20 bg-violet-500/5 p-2">
          <div className="flex flex-wrap gap-3 text-[11px] font-bold text-slate-300">
            <span>Source ID: {item.sourceId ? item.sourceId.slice(0, 8) : entry.runMode === 'dry-run' ? 'preview only' : '-'}</span>
            <span>analysis status: {item.analysisStatus || '-'}</span>
            <span>queue status: {item.reviewStatus || '-'}</span>
            <span>priority: {item.priority || '-'}</span>
            <span>confidence: {item.confidence != null ? `${item.confidence}%` : '-'}</span>
            {item.duplicate ? <span className="text-violet-300">duplicate (مصدر موجود بالفعل)</span> : null}
          </div>
          <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-slate-400">
            <span>رحلة المحادثة: {item.primaryTypeLabel || '-'} {item.journey.length ? `(${item.journey.join('، ')})` : ''}</span>
            <span>النتيجة: {item.outcomeLabel || '-'}</span>
          </div>
          {item.flags.length ? (
            <div className="mt-1 text-[11px] text-amber-300">أعلام: {item.flags.join('، ')}</div>
          ) : null}
          <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-slate-400">
            <span>متابعة مطلوبة: {item.followupRequired ? `نعم (${item.suggestedFollowupReason || '-'})` : 'لا'}</span>
            <span>مطابقة الفاتورة: {item.invoiceMatchStatus || '-'}</span>
          </div>
          {!item.v4FieldsPopulated ? (
            <div className="mt-1 text-[11px] text-slate-500">
              ملاحظة: مؤشرات "medical safety flags" / "lost sales" (V4 unified intelligence) غير مُملوءة هنا — مسار
              الاستيراد التلقائي الحقيقي بيستخدم محرك smart-summary-v1 بدلها.
            </div>
          ) : null}
        </div>
      ))}
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
