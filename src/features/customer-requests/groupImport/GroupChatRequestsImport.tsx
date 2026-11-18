import { useMemo, useState } from 'react';
import { Check, FileUp, Loader2, MessageCircle, X } from 'lucide-react';
import { toast } from 'sonner';
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery';
import { isActiveStaffFilter } from '@/lib/staffActiveFilter';
import { parseGroupChat } from '@/lib/followupRequests/groupChatRequests';
import { readChatFile } from '@/lib/followupRequests/followupRequestService';
import type { CustomerRequest } from '@/lib/api/customerRequests';
import CanonicalCreateRequestDialog from '../workspace/CanonicalCreateRequestDialog';
import { customerRequestBranchKey, customerRequestBranchLabel } from '../domain/branch';
import {
  DOCTOR_REASON_LABELS, candidatesInPeriod, cycleOfDay, detectGroupBranch, extractRequestCandidates,
  type RequestCandidate, type RequestPeriod,
} from './groupChatCustomerRequests';
import { loadShiftWindows } from './shiftWindows';
import { loggableCandidates, saveGroupRequests, type GroupImportResult } from './groupRequestLog';

type StaffOption = { id: string; name: string; role: string | null; branch: string | null };
const doctorLike = (item: StaffOption) => [item.name, item.role].filter(Boolean).some((v) => /د\/|دكتور|صيدلي|صيدلاني|doctor|pharmacist|branch_manager|مدير فرع/i.test(String(v)));

/** Requests marked "not a request" on this device; they are left out of the save. */
const DISMISSED_KEY = 'dawaa_group_chat_requests_handled_v1';
const readDismissed = (): Record<string, string> => {
  try { return JSON.parse(localStorage.getItem(DISMISSED_KEY) || '{}'); } catch { return {}; }
};
const writeDismissed = (value: Record<string, string>) => {
  try { localStorage.setItem(DISMISSED_KEY, JSON.stringify(value)); } catch { /* kept for this visit only */ }
};

const BRANCHES = ['فرع شكري', 'فرع الشامي'];
const PERIODS: Array<[RequestPeriod, string]> = [['cycle', 'الدورة الحالية'], ['two_cycles', 'الدورة دي واللي قبلها'], ['all', 'الملف كله']];
const timeLabel = (local: string) => `${local.slice(8, 10)}/${local.slice(5, 7)} ${local.slice(11, 16)}`;
const dayLabel = (day: string | null) => (day ? `${day.slice(8, 10)}/${day.slice(5, 7)}` : '—');

interface Loaded { fileName: string; content: string; branch: string | null; all: RequestCandidate[] }

/**
 * «طلبات من جروب الواتساب» (owner decision 2026-11-18): drop the group's export and the app finds the
 * branch, the period, the doctor, the customer and the items; one click saves them all. A request
 * from the pharmacy's account with no doctor named is saved for the branch and credited to nobody.
 */
export default function GroupChatRequestsImport({ onClose, onCreated }: { onClose: () => void; onCreated: (request: CustomerRequest) => void | Promise<void> }) {
  const { data: staff, loading: staffLoading, error: staffError } = useSupabaseQuery<StaffOption>({ table: 'staff', filters: isActiveStaffFilter(), realtimeEnabled: false });
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [period, setPeriod] = useState<RequestPeriod>('cycle');
  const [doctorFor, setDoctorFor] = useState<Record<string, string>>({});
  const [dismissed, setDismissed] = useState(readDismissed);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<GroupImportResult | null>(null);
  const [open, setOpen] = useState<RequestCandidate | null>(null);

  const branch = loaded?.branch || '';
  const doctorsOf = (forBranch: string) => (staff || []).filter(doctorLike)
    .filter((d) => !forBranch || customerRequestBranchKey(d.branch) === customerRequestBranchKey(forBranch));
  const doctors = useMemo(() => doctorsOf(branch), [staff, branch]); // eslint-disable-line react-hooks/exhaustive-deps
  const nameOf = (id: string | null | undefined) => (staff || []).find((d) => d.id === id)?.name || '';

  const analyse = async (fileName: string, content: string, forBranch: string | null) => {
    const messages = parseGroupChat(content);
    if (!messages.length) throw new Error('empty');
    const branchDoctors = forBranch ? doctorsOf(forBranch) : [];
    const newest = messages.reduce((max, m) => (m.sentAtLocal > max ? m.sentAtLocal : max), messages[0].sentAtLocal).slice(0, 10);
    // Who was punched in is shown only (it credits nobody), so the bounded current cycle is enough.
    const shifts = forBranch ? await loadShiftWindows(branchDoctors.map((d) => d.id), cycleOfDay(newest).start, newest) : [];
    const all = extractRequestCandidates(messages, branchDoctors.map((d) => ({ staffId: d.id, name: d.name })), shifts);
    setLoaded({ fileName, content, branch: forBranch, all });
    setDoctorFor(Object.fromEntries(all.map((c) => [c.fingerprint, c.doctorId || ''])));
    setResult(null);
  };

  const upload = async (file: File) => {
    // Without the doctors every request would silently land "for the branch only".
    if (staffError) { toast.error('تعذر تحميل أسماء الدكاترة — اعمل تحديث للصفحة وجرّب تاني'); return; }
    if (staffLoading || !staff?.length) { toast.error('لسه بنحمّل أسماء الدكاترة — جرّب كمان ثانية'); return; }
    setLoading(true);
    try {
      const content = await readChatFile(file);
      await analyse(file.name, content, detectGroupBranch(file.name, content));
    } catch (error) {
      toast.error(String((error as Error)?.message).includes('chat_file_missing') ? 'الملف مفيهوش محادثة واتساب' : 'تعذر قراءة الملف — ارفع ملف التصدير (zip أو txt)');
    } finally {
      setLoading(false);
    }
  };

  const chooseBranch = async (value: string) => {
    if (!loaded || !value) return;
    setLoading(true);
    try { await analyse(loaded.fileName, loaded.content, value); } finally { setLoading(false); }
  };

  const inPeriod = useMemo(() => (loaded ? candidatesInPeriod(loaded.all, period) : null), [loaded, period]);
  const toSave = useMemo(() => loggableCandidates(inPeriod?.list || []).filter((c) => !dismissed[c.fingerprint]), [inPeriod, dismissed]);
  const credited = toSave.filter((c) => doctorFor[c.fingerprint]).length;

  const saveAll = async () => {
    if (!loaded?.branch || !toSave.length) return;
    setSaving(true);
    try {
      const r = await saveGroupRequests(loaded.fileName, loaded.branch, toSave, doctorFor);
      setResult(r);
      toast.success(`اتسجل ${r.added} طلب جديد${r.already ? ` · ${r.already} كانوا متسجلين قبل كده` : ''}`);
    } catch (error) {
      toast.error(String((error as Error)?.message).includes('not_authorized') ? 'التسجيل للمدير العام بس' : 'تعذر الحفظ — جرّب تاني');
    } finally {
      setSaving(false);
    }
  };

  const dismiss = (fingerprint: string) => {
    const next = { ...dismissed, [fingerprint]: 'dismissed' };
    setDismissed(next);
    writeDismissed(next);
  };

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/35 p-2 backdrop-blur-sm md:p-4" dir="rtl">
      <section className="flex max-h-[95vh] w-full max-w-4xl flex-col overflow-hidden rounded-[28px] border border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-surface)] shadow-2xl">
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--dawaa-theme-border)] px-4 py-4 md:px-6">
          <div>
            <div className="flex items-center gap-2 text-xl font-black text-[var(--dawaa-theme-heading)]"><MessageCircle size={20} className="text-[var(--dawaa-theme-primary)]" /> طلبات من جروب الواتساب</div>
            <p className="mt-1 text-xs font-bold text-[var(--dawaa-theme-muted)]">ارفع ملف الجروب بس، والباقي علينا: الفرع والفترة والدكتور والعميل والصنف. الطلب اللي من رقم الصيدلية ومن غير اسم دكتور بيتسجل للفرع ومش بيتحسب لحد.</p>
          </div>
          <button type="button" className="rounded-xl border border-[var(--dawaa-theme-border)] p-2 text-[var(--dawaa-theme-muted)]" onClick={onClose} aria-label="إغلاق"><X size={18} /></button>
        </header>

        <div className="overflow-y-auto p-3 md:p-5">
          <label className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[var(--dawaa-theme-accent-border)] p-5 text-center ${loading ? 'opacity-60' : ''}`}>
            {loading ? <Loader2 size={26} className="animate-spin text-[var(--dawaa-theme-primary)]" /> : <FileUp size={26} className="text-[var(--dawaa-theme-primary)]" />}
            <span className="text-sm font-black text-[var(--dawaa-theme-heading)]">{loaded ? `${loaded.fileName} · ارفع ملف تاني` : 'ارفع ملف الجروب (zip أو txt)'}</span>
            <span className="text-[11px] font-bold text-[var(--dawaa-theme-muted)]">من الواتساب: الجروب ← النقط التلاتة ← المزيد ← تصدير الدردشة ← بدون وسائط</span>
            <input type="file" accept=".zip,.txt" className="hidden" disabled={loading} onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void upload(file);
            }} />
          </label>

          {loaded ? (
            <div className="mt-3 grid gap-2 rounded-2xl border border-[var(--dawaa-theme-border)] p-3 text-sm font-bold md:grid-cols-4">
              <div>
                <div className="text-[11px] text-[var(--dawaa-theme-muted)]">الفرع</div>
                {loaded.branch ? <div className="font-black">{loaded.branch}</div> : (
                  <select aria-label="الفرع" className="input-dark mt-1 !py-1 text-xs" value="" onChange={(e) => void chooseBranch(e.target.value)}>
                    <option value="">مش واضح — اختار</option>
                    {BRANCHES.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                )}
              </div>
              <div>
                <div className="text-[11px] text-[var(--dawaa-theme-muted)]">الفترة</div>
                <select aria-label="الفترة" className="input-dark mt-1 !py-1 text-xs" value={period} onChange={(e) => setPeriod(e.target.value as RequestPeriod)}>
                  {PERIODS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                <div className="mt-1 text-[11px] text-[var(--dawaa-theme-muted)]">من {dayLabel(inPeriod?.from ?? null)} لحد {dayLabel(inPeriod?.to ?? null)}</div>
              </div>
              <div>
                <div className="text-[11px] text-[var(--dawaa-theme-muted)]">الطلبات</div>
                <div className="font-black">{toSave.length} طلب</div>
                <div className="text-[11px] text-[var(--dawaa-theme-muted)]">{credited} لدكاترة · {toSave.length - credited} للفرع بس</div>
              </div>
              <button type="button" className="btn-primary flex items-center justify-center gap-2 !py-2 text-sm" disabled={saving || !loaded.branch || !toSave.length} onClick={() => void saveAll()}>
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} سجّل الكل
              </button>
            </div>
          ) : null}

          {result ? (
            <div className="mt-3 rounded-2xl border border-[var(--dawaa-theme-success-border,#b9e3cf)] bg-[var(--dawaa-theme-success-soft,#e9f7f1)] p-3 text-sm font-black text-[var(--dawaa-theme-heading)]">
              ✓ اتسجل {result.added} طلب جديد · {result.credited} منهم لدكاترة · {result.customers} اتربطوا بكارت العميل
              {result.already ? <span className="ms-2 text-xs font-bold text-[var(--dawaa-theme-muted)]">({result.already} كانوا متسجلين قبل كده ومتغيروش)</span> : null}
            </div>
          ) : null}

          <div className="mt-3 space-y-2">
            {toSave.map((c) => {
              const chosen = doctorFor[c.fingerprint] || '';
              return (
                <article key={c.fingerprint} className="rounded-2xl border border-[var(--dawaa-theme-border)] p-3">
                  <div className="flex flex-wrap items-center gap-2 text-[11px] font-black text-[var(--dawaa-theme-muted)]">
                    <span>{timeLabel(c.sentAtLocal)}</span><span>· {c.sender}</span>
                    {c.customerCode ? <span className="dawaa-badge dawaa-badge--success rounded-full px-2">كود {c.customerCode}</span> : null}
                    {c.customerPhone ? <span className="dawaa-badge dawaa-badge--success rounded-full px-2">موبايل {c.customerPhone}</span> : null}
                  </div>
                  <div className="mt-1 text-sm font-black text-[var(--dawaa-theme-heading)]">{c.customerName || 'عميل'}{c.details ? <span className="font-bold text-[var(--dawaa-theme-muted)]"> · {c.details}</span> : null}</div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <select aria-label={`دكتور طلب ${timeLabel(c.sentAtLocal)}`} className="input-dark !w-auto !py-1.5 text-xs" value={chosen} onChange={(e) => setDoctorFor({ ...doctorFor, [c.fingerprint]: e.target.value })}>
                      <option value="">للفرع بس (مش لدكتور)</option>
                      {doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                    <span className="text-[11px] font-bold text-[var(--dawaa-theme-muted)]">
                      {chosen && chosen !== c.doctorId ? 'اختيار يدوي' : DOCTOR_REASON_LABELS[c.doctorReason]}
                      {!chosen && c.onShift.length ? ` · كان باصم: ${c.onShift.map(nameOf).filter(Boolean).join('، ')}` : ''}
                    </span>
                    <div className="ms-auto flex gap-2">
                      <button type="button" className="btn-secondary !py-1 text-xs" onClick={() => dismiss(c.fingerprint)}>مش طلب</button>
                      <button type="button" className="btn-secondary !py-1 text-xs" onClick={() => setOpen(c)}>افتح كطلب متابعة</button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {open ? (
        <CanonicalCreateRequestDialog
          initial={{
            doctorId: doctorFor[open.fingerprint] || null,
            channel: 'واتساب',
            notes: `من جروب طلبات العملاء (${customerRequestBranchLabel(branch)}) ${timeLabel(open.sentAtLocal)}:\n${open.body}`,
            hint: `رسالة الجروب: ${open.body}${open.customerCode ? `\nابحث عن العميل بالكود ${open.customerCode}` : ''}${open.customerPhone ? `\nابحث عن العميل بالموبايل ${open.customerPhone}` : ''}`,
          }}
          onClose={() => setOpen(null)}
          onCreated={async (request) => { await onCreated(request); }}
        />
      ) : null}
    </div>
  );
}
