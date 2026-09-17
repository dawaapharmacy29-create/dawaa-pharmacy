import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, FileArchive, Loader2, Search, Sparkles, Upload, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { readWhatsAppExportFile } from '@/lib/whatsappExportFileReader';
import { parseWhatsAppExport, splitWhatsAppSessions, type WhatsAppConversationSession } from '@/lib/whatsappConversationParser';
import { applyWhatsAppAnalysisScope, collectDetectedDoctors, toLocalDateTimeInput } from '@/lib/whatsappAnalysisScope';
import { buildSmartConversationReviewSummary } from '@/lib/whatsappSmartReviewSummary';
import { appendWhatsAppReviewAudit, hashWhatsAppSession } from '@/lib/whatsappReviewPersistenceV4';

type ReviewDecision = 'approved' | 'flagged' | 'detailed';

type ReviewActor = {
  id: string | null;
  name: string | null;
};

function fmt(value: Date) {
  return value.toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });
}

function duration(seconds: number | null) {
  if (seconds == null) return 'غير محسوب';
  if (seconds < 60) return `${seconds} ث`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} د${seconds % 60 ? ` ${seconds % 60} ث` : ''}`;
}

function sessionRawText(session: WhatsAppConversationSession) {
  return session.messages.map((message) => message.raw || `${message.rawTimestamp} ${message.sender}: ${message.text}`).join('\n');
}

async function getReviewActor(): Promise<ReviewActor> {
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return { id: null, name: null };
  const metadata = user.user_metadata || {};
  return {
    id: user.id,
    name: metadata.full_name || metadata.name || user.email || null,
  };
}

export default function SmartConversationReview() {
  const [fileName, setFileName] = useState('');
  const [sourceFileName, setSourceFileName] = useState<string | null>(null);
  const [innerFileName, setInnerFileName] = useState<string | null>(null);
  const [sessions, setSessions] = useState<WhatsAppConversationSession[]>([]);
  const [doctor, setDoctor] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [applied, setApplied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [savingDecision, setSavingDecision] = useState<ReviewDecision | null>(null);
  const [savedDecision, setSavedDecision] = useState<ReviewDecision | null>(null);

  const doctors = useMemo(() => collectDetectedDoctors(sessions), [sessions]);
  const preview = useMemo(() => applyWhatsAppAnalysisScope(sessions, {
    doctor: doctor || null,
    from: from ? new Date(from) : null,
    to: to ? new Date(to) : null,
  }), [sessions, doctor, from, to]);

  const effectiveSessions = applied ? preview.sessions : sessions;
  const latestSession = useMemo(() => [...effectiveSessions].sort((a, b) => b.endedAt.getTime() - a.endedAt.getTime())[0] || null, [effectiveSessions]);
  const summary = useMemo(() => latestSession ? buildSmartConversationReviewSummary(latestSession) : null, [latestSession]);

  const handleFile = async (file?: File | null) => {
    if (!file) return;
    setLoading(true);
    try {
      const source = await readWhatsAppExportFile(file);
      const messages = parseWhatsAppExport(source.text);
      if (!messages.length) throw new Error('لم يتم التعرف على رسائل WhatsApp داخل الملف.');
      const parsed = splitWhatsAppSessions(messages, 120);
      setSessions(parsed);
      setSourceFileName(source.sourceFileName || file.name);
      setInnerFileName(source.innerFileName || null);
      setFileName(source.innerFileName ? `${source.sourceFileName} → ${source.innerFileName}` : source.sourceFileName);
      setDoctor('');
      setFrom(toLocalDateTimeInput(messages[0]?.timestamp));
      setTo(toLocalDateTimeInput(messages[messages.length - 1]?.timestamp));
      setApplied(false);
      setSavedDecision(null);
      toast.success(`تمت قراءة ${messages.length} رسالة`);
    } catch (error) {
      setSessions([]);
      setFileName('');
      setSourceFileName(null);
      setInnerFileName(null);
      setSavedDecision(null);
      toast.error(error instanceof Error ? error.message : 'تعذر قراءة المحادثة');
    } finally {
      setLoading(false);
    }
  };

  const applyScope = () => {
    if (from && to && new Date(from).getTime() > new Date(to).getTime()) {
      toast.error('وقت البداية لازم يكون قبل وقت النهاية');
      return;
    }
    if (!preview.sessions.length) {
      toast.error('لا توجد رسائل مطابقة للدكتور والفترة المحددين');
      return;
    }
    setApplied(true);
    setSavedDecision(null);
    toast.success('تم تطبيق نطاق المراجعة الذكية');
  };

  async function ensureReviewSource(session: WhatsAppConversationSession) {
    if (!summary) throw new Error('لا توجد خلاصة تحليل متاحة للحفظ');
    const sourceHash = await hashWhatsAppSession(session);
    const { data: existing, error: existingError } = await supabase
      .from('whatsapp_review_sources')
      .select('id')
      .eq('source_hash', sourceHash)
      .maybeSingle();
    if (existingError && existingError.code !== 'PGRST116') throw existingError;
    if (existing?.id) return String(existing.id);

    const { data, error } = await supabase
      .from('whatsapp_review_sources')
      .insert({
        source_hash: sourceHash,
        source_type: 'whatsapp_export_manual_smart_review',
        source_filename: sourceFileName,
        inner_filename: innerFileName,
        customer_name: session.customerName || null,
        staff_name: session.outboundStaffNames[0] || null,
        conversation_started_at: session.startedAt.toISOString(),
        conversation_ended_at: session.endedAt.toISOString(),
        message_count: session.messages.length,
        parser_version: 'whatsapp-smart-review-v2',
        analysis_version: 'smart-summary-v1',
        analysis_status: 'analyzed',
        review_status: summary.confidence < 60 ? 'needs_context' : 'ready_quick',
        priority: summary.flags.length ? 'important' : 'normal',
        analysis_confidence: summary.confidence,
        commercial_eligible: summary.outcome === 'sale_intent',
        followup_required: summary.flags.length > 0,
        suggested_followup_reason: summary.flags.join('، ') || null,
        analysis_json: JSON.parse(JSON.stringify(summary)),
        raw_text: sessionRawText(session),
      })
      .select('id')
      .single();

    if (error) {
      if (error.code === '23505') {
        const { data: duplicate, error: duplicateError } = await supabase
          .from('whatsapp_review_sources')
          .select('id')
          .eq('source_hash', sourceHash)
          .single();
        if (duplicateError) throw duplicateError;
        return String(duplicate.id);
      }
      throw error;
    }

    return String(data.id);
  }

  async function saveReviewDecision(decision: ReviewDecision) {
    if (!latestSession || !summary || savingDecision) return;
    setSavingDecision(decision);
    try {
      const sourceId = await ensureReviewSource(latestSession);
      const actor = await getReviewActor();
      const { data: before, error: beforeError } = await supabase
        .from('whatsapp_review_sources')
        .select('id,review_status,analysis_status,reviewer_confirmed,reviewer_id,reviewer_name')
        .eq('id', sourceId)
        .single();
      if (beforeError) throw beforeError;

      const now = new Date().toISOString();
      const patch = decision === 'approved'
        ? {
            review_status: 'approved',
            reviewer_confirmed: true,
            reviewer_id: actor.id,
            reviewer_name: actor.name,
            reviewer_confirmed_at: now,
            updated_at: now,
          }
        : {
            review_status: 'ready_detailed',
            analysis_status: 'needs_review',
            reviewer_confirmed: false,
            reviewer_id: actor.id,
            reviewer_name: actor.name,
            reviewer_confirmed_at: null,
            updated_at: now,
          };

      const { error: updateError } = await supabase
        .from('whatsapp_review_sources')
        .update(patch)
        .eq('id', sourceId);
      if (updateError) throw updateError;

      const action = decision === 'approved'
        ? 'smart_review_approved'
        : decision === 'flagged'
          ? 'smart_review_flagged'
          : 'smart_review_detailed_requested';
      const note = decision === 'approved'
        ? 'اعتماد بشري: المحادثة سليمة بالكامل.'
        : decision === 'flagged'
          ? 'المراجع البشري وجد ملاحظة ويطلب مراجعة تفصيلية.'
          : 'تم تحويل المحادثة يدويًا للمراجعة التفصيلية.';

      await appendWhatsAppReviewAudit(sourceId, action, before, patch, actor.id, actor.name, null, note);
      setSavedDecision(decision);
      toast.success(decision === 'approved' ? 'تم حفظ اعتماد المراجعة' : 'تم تحويل المحادثة للمراجعة التفصيلية');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر حفظ قرار المراجعة');
    } finally {
      setSavingDecision(null);
    }
  }

  return (
    <div dir="rtl" className="space-y-5">
      <section className="dawaa-card dawaa-card--raised p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-cyan-200"><Sparkles size={20} /><span className="text-xs font-black">نظام منفصل عن التقييم المعتاد</span></div>
            <h1 className="mt-2 text-2xl font-black text-white">مراجعة المحادثات الذكية</h1>
            <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-300">ارفع المحادثة، حدد الدكتور والفترة، وشاهد خلاصة ذكية مركزة: نوع المحادثة، الرحلة، آخر نية، النتيجة والمسؤول. لا يوجد خصم نقاط أو اعتماد تلقائي.</p>
          </div>
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-cyan-400/35 bg-cyan-500/10 px-5 py-3 font-black text-cyan-100 hover:bg-cyan-500/15">
            <Upload size={18} /> {loading ? 'جاري القراءة...' : 'رفع محادثة'}
            <input className="hidden" type="file" accept=".zip,.txt,.md,text/plain,application/zip" disabled={loading} onChange={(event) => void handleFile(event.target.files?.[0])} />
          </label>
        </div>
        {fileName ? <div className="mt-4 flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950/50 px-3 py-2 text-xs text-slate-300"><FileArchive size={15} />{fileName}</div> : null}
      </section>

      {sessions.length ? (
        <section className="dawaa-card dawaa-card--raised p-4">
          <div className="mb-3">
            <div className="font-black text-white">1) حدد الجزء المطلوب مراجعته</div>
            <div className="mt-1 text-xs text-slate-400">المحادثة الكاملة تظل محفوظة كسياق، لكن الخلاصة هنا تعتمد على النطاق المحدد.</div>
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            <label className="text-xs text-slate-300">الدكتور
              <select value={doctor} onChange={(e) => { setDoctor(e.target.value); setApplied(false); setSavedDecision(null); }} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white">
                <option value="">كل الدكاترة</option>{doctors.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-300">من
              <input type="datetime-local" value={from} onChange={(e) => { setFrom(e.target.value); setApplied(false); setSavedDecision(null); }} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white" />
            </label>
            <label className="text-xs text-slate-300">إلى
              <input type="datetime-local" value={to} onChange={(e) => { setTo(e.target.value); setApplied(false); setSavedDecision(null); }} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white" />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-700 bg-slate-950/45 p-3 text-xs text-slate-300">
            <div>مطابق: <b className="text-cyan-200">{preview.scopedMessageCount}</b> من {preview.originalMessageCount} رسالة — {preview.matchedSessionCount} جلسة</div>
            <button type="button" onClick={applyScope} className="flex items-center gap-2 rounded-lg bg-cyan-500/15 px-4 py-2 font-black text-cyan-100"><Search size={15} />تحليل النطاق المحدد</button>
          </div>
        </section>
      ) : null}

      {!summary ? (
        <section className="dawaa-card dawaa-card--soft p-10 text-center">
          <Upload className="mx-auto text-slate-500" size={34} />
          <div className="mt-3 font-black text-white">ارفع محادثة حقيقية للبدء</div>
          <div className="mt-2 text-sm text-slate-400">الصفحة مصممة للمراجعة الذكية فقط، بعيدًا عن نموذج التقييم التقليدي.</div>
        </section>
      ) : (
        <>
          <section className="dawaa-card dawaa-card--raised p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-xs font-black text-cyan-200">2) الخلاصة الذكية لآخر محادثة داخل النطاق</div>
                <div className="mt-2 text-2xl font-black text-white">{summary.primaryTypeLabel}</div>
                <div className="mt-2 text-sm text-slate-400">{fmt(summary.startedAt)} ← {fmt(summary.endedAt)}</div>
              </div>
              <span className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-black text-emerald-200">ثقة مبدئية {summary.confidence}%</span>
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="dawaa-card dawaa-card--soft p-4"><div className="text-xs text-slate-400">آخر مسؤول</div><div className="mt-2 font-black text-white">{summary.lastOwner || 'غير مؤكد'}</div></div>
              <div className="dawaa-card dawaa-card--soft p-4"><div className="text-xs text-slate-400">آخر نية للعميل</div><div className="mt-2 font-black text-white">{summary.finalIntent}</div></div>
              <div className="dawaa-card dawaa-card--soft p-4"><div className="text-xs text-slate-400">النتيجة</div><div className="mt-2 font-black text-white">{summary.outcomeLabel}</div></div>
              <div className="dawaa-card dawaa-card--soft p-4"><div className="text-xs text-slate-400">الرسائل</div><div className="mt-2 font-black text-white">{summary.messageCount}</div></div>
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="dawaa-card dawaa-card--raised p-4">
              <div className="font-black text-white">رحلة المحادثة</div>
              <div className="mt-3 flex flex-wrap gap-2">{summary.journey.map((step, index) => <span key={`${step}-${index}`} className="rounded-full border border-cyan-400/25 bg-cyan-500/10 px-3 py-1.5 text-xs font-black text-cyan-100">{index + 1}. {step}</span>)}</div>
              <div className="mt-4 text-xs leading-6 text-slate-400">الدكاترة المكتشفون: <b className="text-emerald-200">{summary.doctors.join('، ') || 'غير مؤكد'}</b></div>
            </div>
            <div className="dawaa-card dawaa-card--raised p-4">
              <div className="font-black text-white">مؤشرات الخدمة</div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-slate-950/45 p-3"><Clock3 className="mx-auto text-cyan-300" size={16} /><div className="mt-2 text-xs text-slate-400">أول رد</div><b className="text-white">{duration(summary.firstResponseSeconds)}</b></div>
                <div className="rounded-xl bg-slate-950/45 p-3"><Clock3 className="mx-auto text-amber-300" size={16} /><div className="mt-2 text-xs text-slate-400">أطول انتظار</div><b className="text-white">{duration(summary.longestWaitSeconds)}</b></div>
                <div className="rounded-xl bg-slate-950/45 p-3"><UserRound className="mx-auto text-rose-300" size={16} /><div className="mt-2 text-xs text-slate-400">بلا رد</div><b className="text-white">{summary.unansweredInboundCount}</b></div>
              </div>
            </div>
          </section>

          <section className="dawaa-card dawaa-card--raised p-4">
            <div className="font-black text-white">آخر تفاعل حقيقي</div>
            {summary.lastMeaningfulMessage ? <div className="mt-3 rounded-2xl border border-slate-700 bg-slate-950/50 p-4"><div className="text-xs text-slate-400">{summary.lastMeaningfulMessage.sender} • {fmt(summary.lastMeaningfulMessage.timestamp)}</div><div className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-100">{summary.lastMeaningfulMessage.text}</div></div> : <div className="mt-3 text-sm text-slate-400">لم يتم العثور على تفاعل واضح.</div>}
          </section>

          <section className="dawaa-card dawaa-card--soft p-4">
            <div className="flex items-center gap-2 font-black text-white">{summary.flags.length ? <AlertTriangle className="text-amber-300" size={18} /> : <CheckCircle2 className="text-emerald-300" size={18} />}قرار المراجعة</div>
            {summary.flags.length ? <div className="mt-3 flex flex-wrap gap-2">{summary.flags.map((flag) => <span key={flag} className="rounded-full border border-amber-400/25 bg-amber-500/10 px-3 py-1.5 text-xs font-black text-amber-100">{flag}</span>)}</div> : <div className="mt-3 text-sm text-emerald-200">لا توجد إشارات نصية قوية تستدعي التصعيد تلقائيًا. يظل الاعتماد النهائي بشريًا.</div>}
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              <button type="button" disabled={Boolean(savingDecision)} onClick={() => void saveReviewDecision('approved')} className="flex items-center justify-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 font-black text-emerald-100 disabled:opacity-50">{savingDecision === 'approved' ? <Loader2 className="animate-spin" size={16} /> : null}سليمة بالكامل</button>
              <button type="button" disabled={Boolean(savingDecision)} onClick={() => void saveReviewDecision('flagged')} className="flex items-center justify-center gap-2 rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 font-black text-amber-100 disabled:opacity-50">{savingDecision === 'flagged' ? <Loader2 className="animate-spin" size={16} /> : null}فيها ملاحظة</button>
              <button type="button" disabled={Boolean(savingDecision)} onClick={() => void saveReviewDecision('detailed')} className="flex items-center justify-center gap-2 rounded-xl border border-slate-600 bg-slate-900/70 px-4 py-3 font-black text-slate-100 disabled:opacity-50">{savingDecision === 'detailed' ? <Loader2 className="animate-spin" size={16} /> : null}مراجعة تفصيلية</button>
            </div>
            {savedDecision ? <div className="mt-3 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-xs font-black text-emerald-200">تم حفظ قرار المراجع وتسجيله في سجل التدقيق.</div> : null}
            <div className="mt-3 text-[11px] leading-6 text-slate-500">القرار محفوظ كمراجعة بشرية مستقلة فقط؛ لا يتم إنشاء خصم نقاط أو تقييم رسمي تلقائيًا من هذه الصفحة.</div>
          </section>
        </>
      )}
    </div>
  );
}
