import { useEffect, useMemo, useState } from 'react';
import { AlertOctagon, Award, Eye, RefreshCw, ShieldAlert, ThumbsUp, TrendingDown, TrendingUp } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { canViewAllBranches, getDashboardBranchOverride } from '@/lib/security/userDataScope';
import { normalizeBranchName } from '@/lib/branch';
import { BRANCHES } from '@/lib/constants';
import {
  fetchDoctorQualitySummaries,
  type DoctorQualitySummary,
} from '@/lib/doctorQualitySummaryService';
import CoachingNoteComposer from '@/components/shared/CoachingNoteComposer';

const RISK_STYLE: Record<DoctorQualitySummary['riskLevel'], { label: string; className: string; icon: typeof ShieldAlert }> = {
  critical: { label: 'يحتاج تدخّل فوري', className: 'border-red-500/40 bg-red-500/10', icon: AlertOctagon },
  watch: { label: 'تحت المراقبة', className: 'border-amber-500/40 bg-amber-500/10', icon: ShieldAlert },
  stable: { label: 'أداء مستقر', className: 'border-slate-700 bg-slate-900/60', icon: Eye },
  excelling: { label: 'متميّز', className: 'border-emerald-500/40 bg-emerald-500/10', icon: Award },
};

const PERIODS = [
  { days: 7, label: 'آخر 7 أيام' },
  { days: 30, label: 'آخر 30 يوم' },
  { days: 90, label: 'آخر 90 يوم (ربع سنوي)' },
];

/**
 * ملخص ذكي لكل دكتور: نقاط قوة وضعف مستخرجة تلقائيًا من أبعاد تقييم
 * المحادثات + الأعلام الحرجة (شكوى/خطأ دوائي/نبرة سيئة) + ملاحظات التوجيه
 * الموجّهة له. مخصصة لمدير الفرع (فرعه فقط) ومدير الفروع/المدير العام
 * (كل الفروع، مع فلتر اختياري).
 */
export default function DoctorQualitySummaryPage() {
  const { user } = useAuth();
  const viewAllBranches = canViewAllBranches(user);
  const defaultBranch = viewAllBranches ? '' : (getDashboardBranchOverride(user) || normalizeBranchName(user?.branch || ''));

  const [branch, setBranch] = useState(defaultBranch);
  const [days, setDays] = useState(30);
  const [rows, setRows] = useState<DoctorQualitySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [composerFor, setComposerFor] = useState<DoctorQualitySummary | null>(null);

  const load = async () => {
    setLoading(true);
    setError('');
    const { rows: result, error: err } = await fetchDoctorQualitySummaries(branch || null, days);
    if (err) setError(err);
    setRows(result);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branch, days]);

  const criticalCount = useMemo(() => rows.filter((r) => r.riskLevel === 'critical').length, [rows]);
  const watchCount = useMemo(() => rows.filter((r) => r.riskLevel === 'watch').length, [rows]);

  if (!viewAllBranches && !user?.branch && !defaultBranch) {
    return <div dir="rtl" className="p-6 text-sm text-slate-400">هذه الشاشة متاحة لمدراء الفروع ومدير الفروع والمدير العام.</div>;
  }

  return (
    <div dir="rtl" className="space-y-5 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-white">ملخص أداء الدكاترة الذكي</h1>
          <p className="mt-1 text-sm text-slate-400">نقاط القوة والضعف لكل دكتور، مستخرجة تلقائيًا من تقييمات المحادثات وملاحظات التوجيه.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {viewAllBranches ? (
            <select className="input-dark" value={branch} onChange={(e) => setBranch(e.target.value)}>
              <option value="">كل الفروع</option>
              {BRANCHES.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          ) : null}
          <select className="input-dark" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {PERIODS.map((p) => <option key={p.days} value={p.days}>{p.label}</option>)}
          </select>
          <button type="button" onClick={() => void load()} disabled={loading} className="btn-secondary disabled:opacity-50">
            <RefreshCw className={`ml-1 inline h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> تحديث
          </button>
        </div>
      </div>

      {(criticalCount > 0 || watchCount > 0) && (
        <div className="flex flex-wrap gap-3">
          {criticalCount > 0 && (
            <div className="flex items-center gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm font-bold text-red-100">
              <AlertOctagon size={16} /> {criticalCount} دكتور يحتاج تدخّل فوري
            </div>
          )}
          {watchCount > 0 && (
            <div className="flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm font-bold text-amber-100">
              <ShieldAlert size={16} /> {watchCount} دكتور تحت المراقبة
            </div>
          )}
        </div>
      )}

      {error ? <p className="text-sm text-red-300">{error}</p> : null}
      {loading ? <p className="text-sm text-slate-400">جارٍ التحميل...</p> : null}

      {!loading && !rows.length ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 text-center text-sm text-slate-400">
          لا توجد تقييمات محادثات كافية في الفترة المختارة.
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        {rows.map((row) => {
          const style = RISK_STYLE[row.riskLevel];
          const Icon = style.icon;
          const isOpen = expandedId === (row.doctorId || row.doctorName);
          return (
            <div key={row.doctorId || row.doctorName} className={`rounded-2xl border p-4 ${style.className}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-black text-white">{row.doctorName}</div>
                  <div className="mt-0.5 text-xs text-slate-400">{row.branch} · {row.reviewCount} محادثة مقيّمة</div>
                </div>
                <div className="text-left">
                  <div className="flex items-center gap-1 text-xs font-bold"><Icon size={14} /> {style.label}</div>
                  <div className="mt-1 text-2xl font-black text-white">{row.avgFinalScore ?? '—'}<span className="text-xs text-slate-500">/100</span></div>
                </div>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <div>
                  <div className="flex items-center gap-1 text-xs font-black text-emerald-300"><ThumbsUp size={13} /> نقاط القوة</div>
                  {row.strengths.length ? (
                    <ul className="mt-1 space-y-0.5 text-xs text-emerald-100">
                      {row.strengths.map((s) => <li key={s.key}>• {s.label} ({s.avg}/10)</li>)}
                    </ul>
                  ) : <p className="mt-1 text-xs text-slate-500">لا توجد بيانات كافية بعد.</p>}
                </div>
                <div>
                  <div className="flex items-center gap-1 text-xs font-black text-amber-300"><TrendingDown size={13} /> فرص التحسين</div>
                  {row.weaknesses.length ? (
                    <ul className="mt-1 space-y-0.5 text-xs text-amber-100">
                      {row.weaknesses.map((w) => <li key={w.key}>• {w.label} ({w.avg}/10)</li>)}
                    </ul>
                  ) : <p className="mt-1 text-xs text-slate-500">مفيش نقاط ضعف واضحة حاليًا.</p>}
                </div>
              </div>

              {(row.flags.complaintCount || row.flags.medicalErrorCount || row.flags.badToneCount || row.coachingNotes.warning) ? (
                <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                  {row.flags.medicalErrorCount > 0 && <span className="rounded-lg bg-red-500/20 px-2 py-1 font-bold text-red-100">{row.flags.medicalErrorCount} خطأ دوائي</span>}
                  {row.flags.complaintCount > 0 && <span className="rounded-lg bg-red-500/15 px-2 py-1 font-bold text-red-100">{row.flags.complaintCount} شكوى</span>}
                  {row.flags.badToneCount > 0 && <span className="rounded-lg bg-amber-500/15 px-2 py-1 font-bold text-amber-100">{row.flags.badToneCount} نبرة سيئة</span>}
                  {row.coachingNotes.warning > 0 && <span className="rounded-lg bg-amber-500/15 px-2 py-1 font-bold text-amber-100">{row.coachingNotes.warning} تنبيه سابق</span>}
                  {row.flags.excellentCaseCount > 0 && <span className="rounded-lg bg-emerald-500/15 px-2 py-1 font-bold text-emerald-100"><TrendingUp className="inline h-3 w-3" /> {row.flags.excellentCaseCount} موقف متميز</span>}
                </div>
              ) : null}

              <div className="mt-3 flex items-center gap-3 text-xs">
                <button type="button" className="underline text-slate-300" onClick={() => setExpandedId(isOpen ? null : (row.doctorId || row.doctorName))}>
                  {isOpen ? 'إخفاء كل الأبعاد' : 'عرض كل الأبعاد'}
                </button>
                <button type="button" className="underline text-teal-300" onClick={() => setComposerFor(composerFor?.doctorId === row.doctorId ? null : row)}>
                  إرسال ملاحظة للدكتور
                </button>
              </div>

              {isOpen ? (
                <div className="mt-2 grid grid-cols-2 gap-1 rounded-xl bg-black/20 p-2 text-[11px] text-slate-300 sm:grid-cols-3">
                  {row.dimensions.map((d) => (
                    <div key={d.key} className="flex justify-between gap-1">
                      <span>{d.label}</span><span className="font-bold text-white">{d.avg ?? '—'}</span>
                    </div>
                  ))}
                </div>
              ) : null}

              {composerFor?.doctorId === row.doctorId ? (
                <div className="mt-3">
                  <CoachingNoteComposer
                    fromStaffId={user?.staffId || user?.id || null}
                    fromStaffName={String(user?.name || 'الإدارة')}
                    fromRole={viewAllBranches ? 'branches_manager' : 'branch_manager'}
                    toStaffId={row.doctorId || ''}
                    toStaffName={row.doctorName}
                    toRole="doctor"
                    branch={row.branch}
                    onSent={() => setComposerFor(null)}
                  />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
