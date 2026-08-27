import { useMemo, useState } from 'react';
import { ShieldAlert, Send, CheckCircle2, XCircle, Clock, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery';
import { useEmployeeTransactions } from '@/hooks/useEmployeeTransactions';
import { supabase } from '@/lib/supabase';
import { TABLES } from '@/lib/supabaseTables';
import { useAuth } from '@/hooks/useAuth';
import { isManagerRole } from '@/lib/security/userDataScope';
import { POINT_APPEAL_WINDOW_DAYS } from '@/lib/incentives/incentiveRulesEngine';

interface PointAppeal {
  id: string;
  event_id?: string | null;
  point_record_id?: string | null;
  subject_staff_id: string;
  subject_name?: string | null;
  branch?: string | null;
  rule_code?: string | null;
  original_points_delta?: number | null;
  reason: string;
  status: 'pending' | 'under_review' | 'upheld' | 'overturned';
  raised_by_staff_id?: string | null;
  raised_by_name?: string | null;
  reviewed_by_staff_id?: string | null;
  reviewed_by_name?: string | null;
  review_note?: string | null;
  appeal_deadline: string;
  created_at: string;
  reviewed_at?: string | null;
}

interface AppealablePenalty {
  id: string;
  staff_id: string;
  employee_id?: string | null;
  type?: string | null;
  reason: string;
  points: number;
  points_delta?: number | null;
  description?: string | null;
  created_at: string;
}

const STATUS_LABELS: Record<PointAppeal['status'], { label: string; tone: string }> = {
  pending: { label: 'قيد الانتظار', tone: 'text-amber-300 border-amber-400/30 bg-amber-500/10' },
  under_review: { label: 'قيد المراجعة', tone: 'text-sky-300 border-sky-400/30 bg-sky-500/10' },
  upheld: { label: 'الخصم اتأكد', tone: 'text-red-300 border-red-400/30 bg-red-500/10' },
  overturned: { label: 'الخصم اتلغى', tone: 'text-emerald-300 border-emerald-400/30 bg-emerald-500/10' },
};

function daysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

export default function PointAppeals() {
  const { user } = useAuth();
  const managerView = isManagerRole(user);
  const staffId = user?.staffId || user?.id || '';
  const [selectedPenaltyId, setSelectedPenaltyId] = useState('');
  const [appealReason, setAppealReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState('');

  const { data: myAppeals = [], refetch: refetchMine } = useSupabaseQuery<PointAppeal>({
    table: TABLES.pointAppeals,
    filters: staffId ? [{ column: 'subject_staff_id', operator: 'eq', value: staffId }] : [],
    orderBy: { column: 'created_at', ascending: false },
    realtimeEnabled: true,
  });

  const { data: allAppeals = [], refetch: refetchAll } = useSupabaseQuery<PointAppeal>({
    table: TABLES.pointAppeals,
    orderBy: { column: 'created_at', ascending: false },
    realtimeEnabled: managerView,
  });

  const appealWindowStart = useMemo(() => daysAgo(POINT_APPEAL_WINDOW_DAYS), []);
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const { data: recentTransactions = [] } = useEmployeeTransactions<AppealablePenalty>({
    startDate: appealWindowStart.slice(0, 10),
    endDate: today,
    realtimeEnabled: false,
  });
  const recentPenalties = useMemo(
    () =>
      recentTransactions.filter((row) => {
        const rowStaffId = String(row.staff_id || row.employee_id || '');
        return (
          Boolean(staffId) &&
          rowStaffId === staffId &&
          row.type === 'penalty' &&
          new Date(row.created_at).getTime() >= new Date(appealWindowStart).getTime()
        );
      }),
    [appealWindowStart, recentTransactions, staffId]
  );

  const appealedTransactionIds = useMemo(
    () => new Set(myAppeals.map((a) => a.point_record_id).filter(Boolean)),
    [myAppeals]
  );
  const appealablePenalties = useMemo(
    () => recentPenalties.filter((p) => !appealedTransactionIds.has(p.id)),
    [recentPenalties, appealedTransactionIds]
  );

  const pendingForManager = useMemo(
    () => allAppeals.filter((a) => a.status === 'pending' || a.status === 'under_review'),
    [allAppeals]
  );

  const submitAppeal = async () => {
    if (!selectedPenaltyId) return toast.error('اختر الخصم اللي عايز تعترض عليه');
    if (!appealReason.trim()) return toast.error('اكتب سبب الاعتراض');
    const penalty = recentPenalties.find((p) => p.id === selectedPenaltyId);
    if (!penalty) return toast.error('تعذر إيجاد الخصم المحدد');
    setSubmitting(true);
    try {
      const deadline = new Date(penalty.created_at);
      deadline.setDate(deadline.getDate() + POINT_APPEAL_WINDOW_DAYS);
      const { error } = await supabase.from(TABLES.pointAppeals).insert({
        point_record_id: penalty.id,
        subject_staff_id: staffId,
        subject_name: user?.name || null,
        branch: user?.branch || null,
        rule_code: (penalty.description || penalty.reason || '').match(/[A-Z]+(?:-[A-Z]+)*-\d+[A-Z]?/)?.[0] || null,
        original_points_delta: Math.abs(penalty.points_delta ?? penalty.points ?? 0) * -1,
        reason: appealReason.trim(),
        status: 'pending',
        raised_by_staff_id: staffId,
        raised_by_name: user?.name || null,
        appeal_deadline: deadline.toISOString(),
      });
      if (error) throw new Error(error.message);
      toast.success('تم إرسال اعتراضك، هيتراجع خلال أيام قليلة');
      setSelectedPenaltyId('');
      setAppealReason('');
      refetchMine();
    } catch (err) {
      toast.error(`تعذر إرسال الاعتراض: ${(err as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const reviewAppeal = async (appeal: PointAppeal, decision: 'upheld' | 'overturned') => {
    setReviewingId(appeal.id);
    try {
      const { error } = await supabase.rpc('review_point_appeal_v1', {
        p_appeal_id: appeal.id,
        p_decision: decision,
        p_review_note: reviewNote.trim() || null,
      });
      if (error) throw new Error(error.message);
      toast.success(decision === 'overturned' ? 'تم إلغاء الخصم ورد النقاط' : 'تم تأكيد الخصم');
      setReviewNote('');
      refetchAll();
      refetchMine();
    } catch (err) {
      toast.error(`تعذر حفظ القرار: ${(err as Error).message}`);
    } finally {
      setReviewingId(null);
    }
  };

  return (
    <div dir="rtl" className="space-y-6 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <ShieldAlert className="h-6 w-6 text-amber-300" />
        <div>
          <h1 className="text-xl font-black text-white">اعتراضات النقاط</h1>
          <p className="text-sm text-slate-400">اعترض على أي خصم اتحط عليك خلال {POINT_APPEAL_WINDOW_DAYS} أيام من تاريخه.</p>
        </div>
      </div>

      <section className="stat-card space-y-4">
        <h2 className="text-base font-black text-white">اعتراض جديد</h2>
        {appealablePenalties.length === 0 ? (
          <p className="text-sm text-slate-400">مفيش خصومات قابلة للاعتراض عليها دلوقتي (إما مفيش خصومات، أو انتهت مهلة الاعتراض).</p>
        ) : (
          <>
            <select
              className="input-dark w-full"
              value={selectedPenaltyId}
              onChange={(e) => setSelectedPenaltyId(e.target.value)}
            >
              <option value="">اختر الخصم اللي عايز تعترض عليه</option>
              {appealablePenalties.map((p) => (
                <option key={p.id} value={p.id}>
                  {new Date(p.created_at).toLocaleDateString('ar-EG')} — {p.reason} (-{Math.abs(p.points_delta ?? p.points ?? 0)} نقطة)
                </option>
              ))}
            </select>
            <textarea
              className="input-dark w-full min-h-[90px]"
              placeholder="اكتب سبب اعتراضك بالتفصيل..."
              value={appealReason}
              onChange={(e) => setAppealReason(e.target.value)}
            />
            <button
              type="button"
              onClick={submitAppeal}
              disabled={submitting}
              className="flex items-center gap-2 rounded-xl bg-amber-500 px-5 py-2 font-black text-slate-950 disabled:opacity-50"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              إرسال الاعتراض
            </button>
          </>
        )}
      </section>

      <section className="stat-card space-y-3">
        <h2 className="text-base font-black text-white">اعتراضاتي</h2>
        {myAppeals.length === 0 ? (
          <p className="text-sm text-slate-400">مفيش اعتراضات مسجلة.</p>
        ) : (
          <div className="space-y-2">
            {myAppeals.map((a) => (
              <div key={a.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold text-white">{a.reason}</span>
                  <span className={`rounded-full border px-3 py-1 text-xs font-black ${STATUS_LABELS[a.status].tone}`}>
                    {STATUS_LABELS[a.status].label}
                  </span>
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  {new Date(a.created_at).toLocaleDateString('ar-EG')}
                  {a.original_points_delta ? ` — قيمة الخصم المعترض عليه: ${Math.abs(a.original_points_delta)} نقطة` : ''}
                </div>
                {a.review_note && (
                  <div className="mt-2 rounded-lg bg-black/20 p-2 text-xs text-slate-300">
                    رد المراجع: {a.review_note}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {managerView && (
        <section className="stat-card space-y-3">
          <h2 className="text-base font-black text-white">مراجعة الاعتراضات ({pendingForManager.length})</h2>
          {pendingForManager.length === 0 ? (
            <p className="text-sm text-slate-400">مفيش اعتراضات محتاجة مراجعة دلوقتي.</p>
          ) : (
            <div className="space-y-3">
              {pendingForManager.map((a) => (
                <div key={a.id} className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-black text-white">{a.subject_name || a.subject_staff_id}</div>
                      <div className="text-xs text-slate-400">
                        {a.branch || ''} — {new Date(a.created_at).toLocaleDateString('ar-EG')}
                        {a.original_points_delta ? ` — الخصم: ${Math.abs(a.original_points_delta)} نقطة` : ''}
                      </div>
                    </div>
                    <span className="flex items-center gap-1 rounded-full border border-amber-400/30 bg-amber-500/10 px-3 py-1 text-xs font-black text-amber-300">
                      <Clock className="h-3 w-3" /> مهلة: {new Date(a.appeal_deadline).toLocaleDateString('ar-EG')}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-slate-200">{a.reason}</p>
                  <textarea
                    className="input-dark mt-3 w-full min-h-[70px]"
                    placeholder="ملاحظة المراجعة (اختياري)..."
                    onChange={(e) => setReviewNote(e.target.value)}
                  />
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      disabled={reviewingId === a.id}
                      onClick={() => reviewAppeal(a, 'overturned')}
                      className="flex items-center gap-1 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-black text-slate-950 disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-4 w-4" /> إلغاء الخصم ورد النقاط
                    </button>
                    <button
                      type="button"
                      disabled={reviewingId === a.id}
                      onClick={() => reviewAppeal(a, 'upheld')}
                      className="flex items-center gap-1 rounded-xl border border-red-400/40 px-4 py-2 text-sm font-black text-red-300 disabled:opacity-50"
                    >
                      <XCircle className="h-4 w-4" /> تأكيد الخصم
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
