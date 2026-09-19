import type {
  ApproachBCriterionDetail,
  ExperimentSessionSnapshot,
} from '@/lib/whatsappExperiments/types';

function formatDateTime(value: string) {
  try {
    return new Date(value).toLocaleString('ar-EG');
  } catch {
    return value;
  }
}

export function SessionSummary({ session }: { session?: ExperimentSessionSnapshot }) {
  if (!session) return null;
  return (
    <div className="mt-2 grid gap-2 rounded-xl border border-[var(--dawaa-theme-border)] bg-black/10 p-3 text-[11px] sm:grid-cols-2 lg:grid-cols-4">
      <div><span className="font-black">العميل:</span> {session.customerName || 'غير محدد'}</div>
      <div><span className="font-black">الدكتور/الدكاترة:</span> {session.doctors.length ? session.doctors.join('، ') : 'غير محدد'}</div>
      <div><span className="font-black">البداية:</span> {formatDateTime(session.startedAt)}</div>
      <div><span className="font-black">النهاية:</span> {formatDateTime(session.endedAt)}</div>
      <div><span className="font-black">الرسائل:</span> {session.messageCount}</div>
      <div><span className="font-black">الميديا:</span> {session.mediaCount}</div>
      <div><span className="font-black">ميديا غير متاحة:</span> {session.missingMediaCount}</div>
      <div><span className="font-black">المشاركون:</span> {session.participants.join('، ') || '-'}</div>
    </div>
  );
}

export function ConversationTranscript({
  session,
  evidenceIds = [],
}: {
  session?: ExperimentSessionSnapshot;
  evidenceIds?: string[];
}) {
  if (!session) return <div className="text-xs text-slate-500">نص الجلسة غير متاح.</div>;
  const evidence = new Set(evidenceIds);
  return (
    <div className="max-h-[520px] space-y-2 overflow-y-auto rounded-xl border border-[var(--dawaa-theme-border)] bg-black/10 p-3">
      {session.messages.map((message) => {
        const isEvidence = evidence.has(message.id);
        const isOutbound = message.direction === 'outbound';
        return (
          <div
            key={message.id}
            className={`max-w-[92%] rounded-xl border p-2.5 text-xs leading-6 ${
              isEvidence
                ? 'border-amber-400/60 bg-amber-500/10'
                : isOutbound
                  ? 'mr-auto border-teal-400/20 bg-teal-500/10'
                  : 'ml-auto border-slate-400/20 bg-slate-500/10'
            }`}
          >
            <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] font-bold text-slate-400">
              <span className={isOutbound ? 'text-teal-300' : 'text-sky-300'}>{message.sender}</span>
              <span>{formatDateTime(message.timestamp)}</span>
              <span>{message.kind}</span>
              {isEvidence ? <span className="text-amber-300">دليل للتقييم</span> : null}
            </div>
            <div className="whitespace-pre-wrap text-[var(--dawaa-theme-heading)]">{message.text || '—'}</div>
          </div>
        );
      })}
    </div>
  );
}

function statusLabel(status: ApproachBCriterionDetail['status']) {
  if (status === 'assessed') return 'تم تقييمه آليًا';
  if (status === 'not_applicable') return 'غير منطبق';
  return 'يحتاج مراجعة بشرية';
}

export function CriteriaBreakdown({
  criteria,
  session,
}: {
  criteria?: ApproachBCriterionDetail[];
  session?: ExperimentSessionSnapshot;
}) {
  if (!criteria?.length) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--dawaa-theme-border)] p-3 text-xs text-slate-500">
        تفاصيل المعايير غير متاحة لهذا السجل المحفوظ. استخدم Dry Run لرؤية تفسير الـ19 معيار والأدلة كاملة.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {criteria.map((criterion, index) => {
        const evidenceMessages =
          session?.messages.filter((message) => criterion.evidenceMessageIds.includes(message.id)) || [];
        return (
          <details key={criterion.key} className="rounded-xl border border-[var(--dawaa-theme-border)] bg-black/10 p-3">
            <summary className="cursor-pointer list-none">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-black text-[var(--dawaa-theme-heading)]">
                  {index + 1}. {criterion.label}
                </div>
                <div className="flex flex-wrap gap-2 text-[10px] font-bold">
                  <span className="rounded-full bg-slate-500/15 px-2 py-1">{statusLabel(criterion.status)}</span>
                  <span className={`rounded-full px-2 py-1 ${
                    criterion.source === 'signal'
                      ? 'bg-emerald-500/15 text-emerald-300'
                      : 'bg-amber-500/15 text-amber-300'
                  }`}>
                    {criterion.source === 'signal' ? 'دليل فعلي' : 'Default fallback'}
                  </span>
                  <span className="rounded-full bg-sky-500/15 px-2 py-1 text-sky-300">
                    ثقة {criterion.confidence}%
                  </span>
                  <span className="rounded-full bg-violet-500/15 px-2 py-1 text-violet-300">
                    {criterion.pointsEarned == null ? '—' : criterion.pointsEarned}/{criterion.maxPoints}
                  </span>
                </div>
              </div>
              <div className="mt-1 text-[11px] text-slate-400">{criterion.selectedLabel}</div>
            </summary>

            <div className="mt-3 space-y-2 border-t border-[var(--dawaa-theme-border)] pt-3 text-[11px]">
              <div><span className="font-black">سبب الحكم:</span> {criterion.reason}</div>
              <div><span className="font-black">مصدر الحكم:</span> {criterion.source === 'signal' ? 'إشارة/دليل من المحادثة' : 'قيمة افتراضية لأن البند لم يُحسم من النص'}</div>
              {evidenceMessages.length ? (
                <div>
                  <div className="mb-1 font-black text-amber-300">الرسائل التي استند إليها الحكم:</div>
                  <div className="space-y-1">
                    {evidenceMessages.map((message) => (
                      <div key={message.id} className="rounded-lg border border-amber-400/20 bg-amber-500/5 p-2">
                        <span className="font-black">{message.sender}: </span>
                        {message.text}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-slate-500">لا توجد رسالة دليل محددة لهذا البند.</div>
              )}
            </div>
          </details>
        );
      })}
    </div>
  );
}
