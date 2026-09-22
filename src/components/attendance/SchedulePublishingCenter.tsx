import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, FileEdit, Loader2, RefreshCw, Rocket, Save, ShieldCheck, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import {
  cancelScheduleDraft,
  createScheduleDraft,
  getScheduleDraftSeed,
  listScheduleDrafts,
  publishScheduleDraft,
  updateScheduleDraft,
  validateScheduleDraft,
  type ScheduleDraft,
  type ScheduleDraftRow,
} from '@/lib/hr/scheduleDraftService';

type StaffOption = { id: string; name: string; role: string; branch: string };
const DAYS = ['السبت','الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة'];

function cairoDate(offset = 0) {
  const now = new Date();
  now.setDate(now.getDate() + offset);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

function emptyRows(): ScheduleDraftRow[] {
  return DAYS.map((day, index) => ({
    day_name: day,
    shift_start: '09:00',
    shift_end: '18:00',
    is_off: day === 'الجمعة',
    is_day_off: day === 'الجمعة',
    sort_order: index,
  }));
}

function statusMeta(status: ScheduleDraft['status']) {
  if (status === 'published') return { label: 'منشور', cls: 'border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)] text-[var(--dawaa-status-success-text)]' };
  if (status === 'validated') return { label: 'جاهز للنشر', cls: 'border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] text-[var(--dawaa-status-info-text)]' };
  if (status === 'cancelled') return { label: 'ملغي', cls: 'border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] text-[var(--dawaa-theme-muted)]' };
  return { label: 'مسودة', cls: 'border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] text-[var(--dawaa-status-warning-text)]' };
}

export default function SchedulePublishingCenter({ staff, branch }: { staff: StaffOption[]; branch: string }) {
  const visibleStaff = useMemo(
    () => staff.filter((s) => branch === 'الكل' || s.branch === branch),
    [branch, staff]
  );
  const [selectedStaffId, setSelectedStaffId] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(cairoDate(1));
  const [rows, setRows] = useState<ScheduleDraftRow[]>(emptyRows());
  const [note, setNote] = useState('');
  const [currentDraftId, setCurrentDraftId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<ScheduleDraft[]>([]);
  const [loadingSeed, setLoadingSeed] = useState(false);
  const [loadingDrafts, setLoadingDrafts] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const loadDrafts = useCallback(async () => {
    setLoadingDrafts(true);
    try {
      setDrafts(await listScheduleDrafts({ branch: branch === 'الكل' ? null : branch, limit: 60 }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تحميل مسودات الجداول');
    } finally {
      setLoadingDrafts(false);
    }
  }, [branch]);

  useEffect(() => { void loadDrafts(); }, [loadDrafts]);

  async function seedFromCurrent(staffId: string, date = effectiveFrom) {
    if (!staffId) { setRows(emptyRows()); return; }
    setLoadingSeed(true);
    try {
      const seed = await getScheduleDraftSeed(staffId, date);
      setRows((seed.rows || emptyRows()).map((r, index) => ({
        ...r,
        shift_start: r.shift_start ? String(r.shift_start).slice(0, 5) : null,
        shift_end: r.shift_end ? String(r.shift_end).slice(0, 5) : null,
        sort_order: Number(r.sort_order ?? index),
      })));
      setNote('');
      setCurrentDraftId(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر قراءة الجدول الحالي');
    } finally {
      setLoadingSeed(false);
    }
  }

  function updateRow(index: number, patch: Partial<ScheduleDraftRow>) {
    setRows((prev) => prev.map((row, i) => i === index ? { ...row, ...patch } : row));
  }

  async function saveDraft() {
    if (!selectedStaffId) { toast.warning('اختر موظفًا أولًا.'); return; }
    setBusy('save');
    try {
      if (currentDraftId) {
        await updateScheduleDraft(currentDraftId, rows, note);
        toast.success('تم حفظ تعديلات المسودة وإرجاعها للمراجعة.');
      } else {
        const result = await createScheduleDraft({ staffId: selectedStaffId, effectiveFrom, rows, note });
        setCurrentDraftId(result.draft_id);
        toast.success('تم إنشاء مسودة. لم تؤثر على الحضور بعد.');
      }
      await loadDrafts();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر حفظ المسودة');
    } finally { setBusy(null); }
  }

  async function validateCurrent() {
    if (!currentDraftId) { toast.warning('احفظ المسودة أولًا.'); return; }
    setBusy('validate');
    try {
      const result = await validateScheduleDraft(currentDraftId);
      if (result.valid) toast.success('المسودة صالحة للنشر: ' + result.working_days + ' أيام عمل · ' + result.off_days + ' راحة.');
      else toast.error('المسودة بها ' + result.errors.length + ' أخطاء يجب إصلاحها.');
      await loadDrafts();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر التحقق من المسودة');
    } finally { setBusy(null); }
  }

  async function publishCurrent() {
    if (!currentDraftId) return;
    const draft = drafts.find((d) => d.id === currentDraftId);
    if (draft?.status !== 'validated') { toast.warning('يجب التحقق من المسودة بنجاح قبل النشر.'); return; }
    if (!window.confirm('نشر جدول ' + draft.staff_name + ' اعتبارًا من ' + draft.effective_from + '؟ سيتم حفظ النسخة السابقة تاريخيًا.')) return;
    setBusy('publish');
    try {
      await publishScheduleDraft(currentDraftId, 'نشر معتمد من مركز الجداول');
      toast.success('تم نشر الجدول وحفظ النسخة السابقة تاريخيًا.');
      setCurrentDraftId(null); setSelectedStaffId(''); setRows(emptyRows()); setNote('');
      await loadDrafts();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر نشر الجدول');
    } finally { setBusy(null); }
  }

  async function cancelDraft(id: string) {
    if (!window.confirm('إلغاء هذه المسودة؟ لن يتغير الجدول المنشور الحالي.')) return;
    setBusy('cancel-' + id);
    try {
      await cancelScheduleDraft(id, 'إلغاء من مركز الجداول');
      if (currentDraftId === id) { setCurrentDraftId(null); setSelectedStaffId(''); setRows(emptyRows()); }
      toast.success('تم إلغاء المسودة بدون تأثير على الجدول المنشور.');
      await loadDrafts();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر إلغاء المسودة');
    } finally { setBusy(null); }
  }

  function openDraft(draft: ScheduleDraft) {
    setCurrentDraftId(draft.id);
    setSelectedStaffId(draft.staff_id);
    setEffectiveFrom(draft.effective_from);
    setNote(draft.note || '');
    setRows((draft.rows || []).map((row, index) => ({
      ...row,
      shift_start: row.shift_start ? String(row.shift_start).slice(0, 5) : null,
      shift_end: row.shift_end ? String(row.shift_end).slice(0, 5) : null,
      sort_order: Number(row.sort_order ?? index),
    })));
  }

  const current = drafts.find((d) => d.id === currentDraftId) || null;
  const currentMeta = current ? statusMeta(current.status) : null;
  const readOnly = current?.status === 'published' || current?.status === 'cancelled';

  return (
    <section className="rounded-3xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm" dir="rtl">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="text-xs font-black text-[var(--dawaa-theme-primary-strong)]">Draft → Validate → Publish</div>
          <h2 className="mt-1 text-lg font-black text-[var(--dawaa-theme-heading)]">مركز نشر الجداول</h2>
          <p className="mt-1 max-w-3xl text-xs font-bold leading-5 text-[var(--dawaa-theme-muted)]">
            أي تعديل يبدأ كمسودة منفصلة لا تدخل الحضور أو المرتب. بعد التحقق فقط يمكن نشرها بتاريخ سريان واضح، مع الاحتفاظ بالنسخة السابقة.
          </p>
        </div>
        <button onClick={() => void loadDrafts()} className="btn-secondary">
          <RefreshCw size={15} className={loadingDrafts ? 'animate-spin' : ''} /> تحديث المسودات
        </button>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_220px_220px]">
        <label className="text-xs font-black text-[var(--dawaa-theme-muted)]">
          الموظف
          <select
            value={selectedStaffId}
            disabled={Boolean(currentDraftId)}
            onChange={(e) => { const id = e.target.value; setSelectedStaffId(id); void seedFromCurrent(id); }}
            className="input-dark mt-1 w-full"
          >
            <option value="">اختر الموظف</option>
            {visibleStaff.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.branch}</option>)}
          </select>
        </label>
        <label className="text-xs font-black text-[var(--dawaa-theme-muted)]">
          يسري من
          <input
            type="date"
            min={cairoDate()}
            value={effectiveFrom}
            disabled={Boolean(currentDraftId)}
            onChange={(e) => { setEffectiveFrom(e.target.value); if (selectedStaffId) void seedFromCurrent(selectedStaffId, e.target.value); }}
            className="input-dark mt-1 w-full"
          />
        </label>
        <label className="text-xs font-black text-[var(--dawaa-theme-muted)]">
          الحالة
          <div className="mt-1 flex h-[42px] items-center">
            {currentMeta
              ? <span className={'rounded-full border px-3 py-1 text-xs font-black ' + currentMeta.cls}>{currentMeta.label}</span>
              : <span className="text-xs font-bold text-[var(--dawaa-theme-muted)]">مسودة جديدة لم تُحفظ بعد</span>}
          </div>
        </label>
      </div>

      <label className="mt-3 block text-xs font-black text-[var(--dawaa-theme-muted)]">
        ملاحظة التغيير
        <input disabled={readOnly} value={note} onChange={(e) => setNote(e.target.value)} className="input-dark mt-1 w-full" placeholder="مثال: تعديل شيفت الأسبوع الجديد..." />
      </label>

      <div className="mt-4 overflow-x-auto rounded-2xl border border-[var(--dawaa-theme-border)]">
        <table className="min-w-[760px] w-full text-sm">
          <thead className="border-b border-[var(--dawaa-theme-border)] text-xs font-black text-[var(--dawaa-theme-muted)]">
            <tr><th className="p-3 text-right">اليوم</th><th className="p-3 text-right">الحالة</th><th className="p-3 text-right">من</th><th className="p-3 text-right">إلى</th><th className="p-3 text-right">ملاحظة</th></tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.day_name} className="border-b border-[var(--dawaa-theme-border)]/60 last:border-0">
                <td className="p-3 font-black text-[var(--dawaa-theme-heading)]">{row.day_name}</td>
                <td className="p-3">
                  <label className="inline-flex items-center gap-2 text-xs font-bold">
                    <input
                      type="checkbox" checked={row.is_off} disabled={readOnly}
                      onChange={(e) => updateRow(index, {
                        is_off: e.target.checked, is_day_off: e.target.checked,
                        shift_start: e.target.checked ? null : (row.shift_start || '09:00'),
                        shift_end: e.target.checked ? null : (row.shift_end || '18:00'),
                      })}
                    />
                    {row.is_off ? 'راحة' : 'عمل'}
                  </label>
                </td>
                <td className="p-3"><input type="time" disabled={row.is_off || readOnly} value={row.shift_start || ''} onChange={(e) => updateRow(index,{ shift_start:e.target.value })} className="input-dark w-32" /></td>
                <td className="p-3"><input type="time" disabled={row.is_off || readOnly} value={row.shift_end || ''} onChange={(e) => updateRow(index,{ shift_end:e.target.value })} className="input-dark w-32" /></td>
                <td className="p-3"><input disabled={readOnly} value={row.notes || ''} onChange={(e) => updateRow(index,{ notes:e.target.value })} className="input-dark min-w-48" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {loadingSeed && <div className="mt-3 flex items-center gap-2 text-xs font-bold text-[var(--dawaa-theme-muted)]"><Loader2 size={14} className="animate-spin" /> جاري نسخ الجدول المنشور الحالي إلى المسودة...</div>}

      {current?.validation && (
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {!!current.validation.errors?.length && <div className="rounded-xl border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] p-3 text-xs font-bold text-[var(--dawaa-status-danger-text)]">{current.validation.errors.map((e, i) => <div key={i}>• {e.label || e.code}</div>)}</div>}
          {!!current.validation.warnings?.length && <div className="rounded-xl border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] p-3 text-xs font-bold text-[var(--dawaa-status-warning-text)]">{current.validation.warnings.map((e, i) => <div key={i}>• {e.label || e.code}</div>)}</div>}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button disabled={!selectedStaffId || busy !== null || readOnly} onClick={() => void saveDraft()} className="btn-secondary"><Save size={15} /> {currentDraftId ? 'حفظ تعديلات المسودة' : 'حفظ كمسودة'}</button>
        <button disabled={!currentDraftId || busy !== null || readOnly} onClick={() => void validateCurrent()} className="btn-secondary"><ShieldCheck size={15} /> تحقق قبل النشر</button>
        <button disabled={!currentDraftId || busy !== null || current?.status !== 'validated'} onClick={() => void publishCurrent()} className="btn-primary"><Rocket size={15} /> نشر الجدول</button>
      </div>

      <div className="mt-5 border-t border-[var(--dawaa-theme-border)] pt-4">
        <div className="flex items-center gap-2 font-black text-[var(--dawaa-theme-heading)]"><FileEdit size={16} /> آخر مسودات الجداول</div>
        <div className="mt-3 grid gap-2 xl:grid-cols-2">
          {drafts.slice(0, 12).map((draft) => {
            const meta = statusMeta(draft.status);
            return (
              <div key={draft.id} className="rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div><div className="font-black text-[var(--dawaa-theme-heading)]">{draft.staff_name}</div><div className="mt-1 text-[11px] font-bold text-[var(--dawaa-theme-muted)]">{draft.branch || '-'} · يسري {draft.effective_from}</div></div>
                  <span className={'rounded-full border px-2 py-1 text-[10px] font-black ' + meta.cls}>{meta.label}</span>
                </div>
                {draft.note && <div className="mt-2 text-xs font-bold text-[var(--dawaa-theme-muted)]">{draft.note}</div>}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button onClick={() => openDraft(draft)} className="btn-secondary !px-3 !py-1.5 text-xs">{draft.status === 'published' || draft.status === 'cancelled' ? 'عرض' : 'فتح للتعديل'}</button>
                  {draft.status !== 'published' && draft.status !== 'cancelled' && <button disabled={busy !== null} onClick={() => void cancelDraft(draft.id)} className="btn-secondary !px-3 !py-1.5 text-xs"><XCircle size={13} /> إلغاء</button>}
                  {draft.status === 'validated' && <span className="inline-flex items-center gap-1 text-[10px] font-black text-[var(--dawaa-status-success-text)]"><CheckCircle2 size={12} /> التحقق ناجح</span>}
                </div>
              </div>
            );
          })}
          {!drafts.length && !loadingDrafts && <div className="rounded-xl border border-dashed border-[var(--dawaa-theme-border)] p-4 text-center text-xs font-bold text-[var(--dawaa-theme-muted)]">لا توجد مسودات جداول بعد.</div>}
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] p-3 text-xs font-bold text-[var(--dawaa-status-info-text)]">
        المسودات موجودة في جداول مستقلة ولا يقرأها Attendance Truth. النشر فقط ينشئ نسخة تشغيلية جديدة، والنسخة السابقة تُغلق بتاريخ ولا تُحذف.
      </div>
    </section>
  );
}
