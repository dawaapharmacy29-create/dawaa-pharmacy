import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Link2, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import {
  assignScheduleIdentity,
  getScheduleIdentityHealth,
  listScheduleStaffCandidates,
  listUnmappedScheduleGroups,
  type ScheduleIdentityHealth,
  type ScheduleStaffCandidate,
  type UnmappedScheduleGroup,
} from '@/lib/scheduleIdentityService';

export default function ScheduleIdentityGovernance() {
  const [health, setHealth] = useState<ScheduleIdentityHealth | null>(null);
  const [groups, setGroups] = useState<UnmappedScheduleGroup[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<UnmappedScheduleGroup | null>(null);
  const [candidateSearch, setCandidateSearch] = useState('');
  const [candidates, setCandidates] = useState<ScheduleStaffCandidate[]>([]);
  const [candidate, setCandidate] = useState<ScheduleStaffCandidate | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextHealth, nextGroups] = await Promise.all([
        getScheduleIdentityHealth(),
        listUnmappedScheduleGroups(search, 250),
      ]);
      setHealth(nextHealth);
      setGroups(nextGroups);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تحميل حالة ربط الجداول');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => { void load(); }, [load]);

  const coverage = useMemo(() => {
    if (!health?.total_rows) return 0;
    return Math.round((Number(health.linked_rows || 0) / Number(health.total_rows)) * 100);
  }, [health]);

  async function findCandidates() {
    if (!selected) return;
    if (candidateSearch.trim().length < 2) {
      toast.warning('اكتب حرفين على الأقل من اسم الموظف.');
      return;
    }
    setBusy(true);
    try {
      setCandidates(await listScheduleStaffCandidates({ search: candidateSearch, branch: selected.legacy_branch }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر البحث عن الموظف');
    } finally {
      setBusy(false);
    }
  }

  async function confirmMapping() {
    if (!selected || !candidate) return;
    if (!note.trim()) {
      toast.warning('اكتب سبب الربط حتى يظل التغيير موثقًا.');
      return;
    }
    setBusy(true);
    try {
      const result = await assignScheduleIdentity({
        legacyStaffName: selected.legacy_staff_name,
        legacyBranch: selected.legacy_branch,
        staffId: candidate.staff_id,
        note: note.trim(),
      });
      toast.success(`تم ربط ${Number(result.rows_updated || 0)} سجل جدول بـ ${result.staff_name}.`);
      setSelected(null); setCandidate(null); setCandidates([]); setCandidateSearch(''); setNote('');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر اعتماد ربط الجدول');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-black text-[var(--dawaa-theme-heading)]"><ShieldCheck size={20} /> جودة هوية جدول الموظفين</h2>
          <p className="mt-1 text-xs font-bold text-[var(--dawaa-theme-muted)]">أي سجل جدول قديم بدون staff_id يظل Legacy ولا يدخل القرار المالي تلقائيًا. الربط هنا يدوي، لنفس الفرع فقط، ومع Audit.</p>
        </div>
        <button onClick={() => void load()} className="btn-secondary"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> تحديث</button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="إجمالي سجلات الجدول" value={Number(health?.total_rows || 0)} icon={Link2} />
        <Metric label="مربوطة بهوية مؤكدة" value={Number(health?.linked_rows || 0)} icon={CheckCircle2} />
        <Metric label="Legacy غير مربوطة" value={Number(health?.unlinked_rows || 0)} icon={AlertTriangle} />
        <Metric label="نسبة الربط" value={`${coverage}%`} icon={ShieldCheck} />
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1"><Search size={16} className="absolute right-3 top-3 text-[var(--dawaa-theme-muted)]" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث باسم قديم أو فرع..." className="input-dark w-full pr-9" /></div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--dawaa-theme-border)]">
        <table className="min-w-full text-sm">
          <thead className="border-b border-[var(--dawaa-theme-border)] text-[var(--dawaa-theme-muted)]"><tr><th className="p-3 text-right">الاسم القديم</th><th className="p-3 text-right">الفرع</th><th className="p-3 text-right">السجلات</th><th className="p-3 text-right">الأيام</th><th className="p-3 text-right">مرشح آمن</th><th className="p-3 text-right">إجراء</th></tr></thead>
          <tbody>
            {groups.map((group) => <tr key={`${group.legacy_staff_name}-${group.legacy_branch}`} className="border-b border-[var(--dawaa-theme-border)]/60 last:border-0">
              <td className="p-3 font-black text-[var(--dawaa-theme-heading)]">{group.legacy_staff_name || 'بدون اسم'}</td>
              <td className="p-3">{group.legacy_branch || '-'}</td>
              <td className="p-3 font-black">{Number(group.schedule_rows || 0)}</td>
              <td className="p-3 text-xs">{(group.days || []).join('، ') || '-'}</td>
              <td className="p-3 text-xs">{group.exact_same_branch_candidate_name ? <span className="font-black text-[var(--dawaa-status-success-text)]">{group.exact_same_branch_candidate_name}</span> : <span className="text-[var(--dawaa-theme-muted)]">لا يوجد تطابق قطعي</span>}</td>
              <td className="p-3"><button onClick={() => { setSelected(group); setCandidateSearch(group.exact_same_branch_candidate_name || group.legacy_staff_name); setCandidates([]); setCandidate(group.exact_same_branch_candidate_id ? { staff_id: group.exact_same_branch_candidate_id, staff_name: group.exact_same_branch_candidate_name || '', branch: group.legacy_branch, role: '' } : null); setNote(''); }} className="btn-secondary text-xs">مراجعة الربط</button></td>
            </tr>)}
            {!groups.length && !loading && <tr><td colSpan={6} className="p-7 text-center font-bold text-[var(--dawaa-theme-muted)]">لا توجد سجلات جدول Legacy غير مربوطة في النطاق الحالي.</td></tr>}
          </tbody>
        </table>
      </div>

      {selected && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"><div className="w-full max-w-lg rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-5 shadow-2xl"><h3 className="text-lg font-black text-[var(--dawaa-theme-heading)]">ربط جدول قديم بهوية موظف</h3><p className="mt-1 text-sm font-bold text-[var(--dawaa-theme-muted)]">{selected.legacy_staff_name} — {selected.legacy_branch} — {selected.schedule_rows} سجل. الربط عبر الفروع ممنوع Server-side.</p><div className="mt-4 flex gap-2"><input value={candidateSearch} onChange={(e) => setCandidateSearch(e.target.value)} className="input-dark flex-1" placeholder="ابحث عن الموظف" /><button onClick={() => void findCandidates()} disabled={busy} className="btn-secondary">بحث</button></div><div className="mt-3 max-h-44 space-y-2 overflow-auto">{candidates.map((item) => <button type="button" key={item.staff_id} onClick={() => setCandidate(item)} className={`w-full rounded-xl border p-3 text-right ${candidate?.staff_id === item.staff_id ? 'border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)]' : 'border-[var(--dawaa-theme-border)]'}`}><div className="font-black text-[var(--dawaa-theme-heading)]">{item.staff_name}</div><div className="text-xs text-[var(--dawaa-theme-muted)]">{item.role} — {item.branch}</div></button>)}</div>{candidate && <div className="mt-3 rounded-xl border border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)] p-3 text-sm font-black text-[var(--dawaa-status-success-text)]">سيتم الربط بـ: {candidate.staff_name}</div>}<textarea value={note} onChange={(e) => setNote(e.target.value)} className="input-dark mt-3 min-h-20 w-full" placeholder="سبب التأكد من أن الاسم القديم يخص هذا الموظف..." /><div className="mt-4 flex gap-2"><button onClick={() => void confirmMapping()} disabled={busy || !candidate} className="btn-primary flex-1">اعتماد الربط الموثق</button><button onClick={() => { setSelected(null); setCandidate(null); setCandidates([]); }} className="btn-secondary">إلغاء</button></div></div></div>}
    </div>
  );
}

function Metric({ label, value, icon: Icon }: { label: string; value: string | number; icon: typeof Link2 }) {
  return <div className="rounded-xl border border-[var(--dawaa-theme-border)] p-3"><div className="flex items-center gap-2 text-xs font-black text-[var(--dawaa-theme-muted)]"><Icon size={16} /> {label}</div><div className="mt-2 text-2xl font-black text-[var(--dawaa-theme-heading)]">{value}</div></div>;
}
