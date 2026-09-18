import WhatsAppExperimentPage from '@/components/whatsappExperiments/WhatsAppExperimentPage';
import { runHybridExperiment } from '@/lib/whatsappExperiments/hybridRunner';
import type { ExperimentFileLogEntry } from '@/lib/whatsappExperiments/types';

function HybridDetails({ entry }: { entry: ExperimentFileLogEntry }) {
  return (
    <div className="mt-2 grid gap-2 md:grid-cols-2">
      <div>
        <div className="mb-1 text-[11px] font-black text-violet-300">A result</div>
        <div className="space-y-1.5">
          {(entry.approachA || []).map((item, i) => (
            <div key={i} className="rounded-lg border border-violet-400/20 bg-violet-500/5 p-2 text-[11px] text-slate-300">
              <div>Source: {item.sourceId?.slice(0, 8) || (entry.runMode === 'dry-run' ? 'preview' : '-')} · {item.reviewStatus || '-'} · ثقة {item.confidence ?? '-'}%</div>
              <div className="mt-0.5 text-slate-400">{item.primaryTypeLabel || '-'} · {item.outcomeLabel || '-'}</div>
              {item.duplicate ? <div className="mt-0.5 text-violet-300">duplicate</div> : null}
            </div>
          ))}
          {!entry.approachA?.length ? <div className="text-[11px] text-slate-500">لا يوجد.</div> : null}
        </div>
      </div>
      <div>
        <div className="mb-1 text-[11px] font-black text-teal-300">B result</div>
        <div className="space-y-1.5">
          {(entry.approachB || []).map((item, i) => (
            <div key={i} className="rounded-lg border border-teal-400/20 bg-teal-500/5 p-2 text-[11px] text-slate-300">
              <div>
                review: {item.status === 'preview' ? `preview — ${item.finalScore}/100` : item.status === 'saved' ? `${item.reviewId?.slice(0, 8)} — ${item.finalScore}/100` : item.status} · المراجع: {item.reviewerDisplay}
              </div>
              <div className="mt-0.5 text-slate-400">
                نقاط: {item.doctorPointsImpact} ({entry.runMode === 'dry-run' ? 'preview' : item.impactStatus || '-'}) · severe: {item.hasSevereError ? 'مفعّل!' : 'false'}
              </div>
              {item.pointsError ? <div className="mt-0.5 text-rose-300">points error: {item.pointsError}</div> : null}
              {item.error ? <div className="mt-0.5 text-rose-300">{item.error}</div> : null}
            </div>
          ))}
          {!entry.approachB?.length ? <div className="text-[11px] text-slate-500">لا يوجد.</div> : null}
        </div>
      </div>
    </div>
  );
}

export default function WhatsAppReviewExperimentHybrid() {
  return (
    <WhatsAppExperimentPage
      approach="hybrid"
      pageTitle="واتساب - النظام المدمج A+B"
      description="يعرض A وB على نفس الملف. Dry Run يشغّل الاثنين كمعاينة بدون أي كتابة؛ Live Run فقط يشغّل مسار الإنتاج المدمج."
      info={{
        name: 'Hybrid A+B — المسار المدمج',
        whatItDoes: 'يقارن نتيجة تحليل A مع التقييم الرسمي B لنفس الملف.',
        whatItSaves: 'في Dry Run: لا شيء. في Live Run: مخرجات A + conversation_sales_reviews + points pending حسب النتيجة.',
        createsOfficialReview: true,
        addsPoints: true,
        needsHumanReview: true,
      }}
      warningNote="Dry Run آمن افتراضيًا. Live Run هو الوحيد المطابق لمسار الإنتاج الحالي وبيكتب بيانات حقيقية."
      onRunFile={runHybridExperiment}
      renderDetails={(entry) => <HybridDetails entry={entry} />}
    />
  );
}
