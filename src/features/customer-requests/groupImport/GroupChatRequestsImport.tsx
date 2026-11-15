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
import { DOCTOR_REASON_LABELS, extractRequestCandidates, type RequestCandidate } from './groupChatCustomerRequests';
import { loadShiftWindows } from './shiftWindows';
import { loggableCandidates, saveGroupRequests } from './groupRequestLog';

type StaffOption = { id: string; name: string; role: string | null; branch: string | null };
const doctorLike = (item: StaffOption) => [item.name, item.role].filter(Boolean).some((v) => /د\/|دكتور|صيدلي|صيدلاني|doctor|pharmacist|branch_manager|مدير فرع/i.test(String(v)));

/** Requests already recorded or dismissed on this device (the request form also blocks a 24-hour duplicate). */
const HANDLED_KEY = 'dawaa_group_chat_requests_handled_v1';
const readHandled = (): Record<string, 'saved' | 'dismissed'> => {
  try { return JSON.parse(localStorage.getItem(HANDLED_KEY) || '{}'); } catch { return {}; }
};
const writeHandled = (value: Record<string, 'saved' | 'dismissed'>) => {
  try { localStorage.setItem(HANDLED_KEY, JSON.stringify(value)); } catch { /* kept for this visit only */ }
};

const BRANCHES = ['فرع شكري', 'فرع الشامي'];
const branchFromName = (fileName: string) => BRANCHES.find((b) => fileName.includes(b.replace('فرع ', ''))) || '';
const timeLabel = (local: string) => `${local.slice(8, 10)}/${local.slice(5, 7)} ${local.slice(11, 16)}`;

/** «طلبات من جروب الواتساب»: upload the group's export, review each request, record it with the canonical form. */
export default function GroupChatRequestsImport({ onClose, onCreated }: { onClose: () => void; onCreated: (request: CustomerRequest) => void | Promise<void> }) {
  const { data: staff } = useSupabaseQuery<StaffOption>({ table: 'staff', filters: isActiveStaffFilter(), realtimeEnabled: false });
  const [branch, setBranch] = useState('');
  const [fileName, setFileName] = useState('');
  const [candidates, setCandidates] = useState<RequestCandidate[]>([]);
  const [doctorFor, setDoctorFor] = useState<Record<string, string>>({});
  const [handled, setHandled] = useState(readHandled);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<RequestCandidate | null>(null);
  const [showHandled, setShowHandled] = useState(false);
  const [saving, setSaving] = useState(false);

  /** Saves every request of the export to the evaluation's log at once (the doctor chosen on each card). */
  const saveAll = async () => {
    setSaving(true);
    try {
      const r = await saveGroupRequests(fileName, branch, candidates, doctorFor);
      toast.success(`اتحفظ ${r.saved} طلب جديد من ${r.sent} في سجل التقييم${r.withoutDoctor ? ` · ${r.withoutDoctor} من غير دكتور بيتحسبوا للفرع بس` : ''}`);
    } catch (error) {
      toast.error(String((error as Error)?.message).includes('not_authorized') ? 'الحفظ بالجملة للمدير العام بس' : 'تعذر الحفظ — جرّب تاني');
    } finally {
      setSaving(false);
    }
  };

  const doctors = useMemo(() => (staff || []).filter(doctorLike)
    .filter((d) => !branch || customerRequestBranchKey(d.branch) === customerRequestBranchKey(branch)), [staff, branch]);
  const nameOf = (id: string | null | undefined) => doctors.find((d) => d.id === id)?.name || (staff || []).find((d) => d.id === id)?.name || '';

  const upload = async (file: File, pickedBranch: string) => {
    setLoading(true);
    try {
      const messages = parseGroupChat(await readChatFile(file));
      if (!messages.length) throw new Error('empty');
      const branchDoctors = (staff || []).filter(doctorLike)
        .filter((d) => !pickedBranch || customerRequestBranchKey(d.branch) === customerRequestBranchKey(pickedBranch));
      const days = messages.map((m) => m.sentAtLocal.slice(0, 10)).sort();
      const shifts = await loadShiftWindows(branchDoctors.map((d) => d.id), days[0], days[days.length - 1]);
      const found = extractRequestCandidates(messages, branchDoctors.map((d) => ({ staffId: d.id, name: d.name })), shifts);
      setCandidates(found);
      setDoctorFor(Object.fromEntries(found.map((c) => [c.fingerprint, c.doctorId || ''])));
      toast.success(`لقينا ${found.length} طلب في ${messages.length} رسالة`);
    } catch (error) {
      toast.error(String((error as Error)?.message).includes('chat_file_missing') ? 'الملف مفيهوش محادثة واتساب' : 'تعذر قراءة الملف — ارفع ملف التصدير (zip أو txt)');
    } finally {
      setLoading(false);
    }
  };

  const mark = (fingerprint: string, state: 'saved' | 'dismissed') => {
    const next = { ...handled, [fingerprint]: state };
    setHandled(next);
    writeHandled(next);
  };

  const visible = candidates.filter((c) => showHandled || !handled[c.fingerprint]);
  const pending = candidates.filter((c) => !handled[c.fingerprint]).length;

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/35 p-2 backdrop-blur-sm md:p-4" dir="rtl">
      <section className="flex max-h-[95vh] w-full max-w-4xl flex-col overflow-hidden rounded-[28px] border border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-surface)] shadow-2xl">
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--dawaa-theme-border)] px-4 py-4 md:px-6">
          <div>
            <div className="flex items-center gap-2 text-xl font-black text-[var(--dawaa-theme-heading)]"><MessageCircle size={20} className="text-[var(--dawaa-theme-primary)]" /> طلبات من جروب الواتساب</div>
            <p className="mt-1 text-xs font-bold text-[var(--dawaa-theme-muted)]">ارفع تصدير جروب طلبات العملاء. كل رسالة فيها كود عميل أو موبايل بتظهر هنا، تراجعها وتسجلها كطلب. الدكتور بيتحدد من موبايله، أو من اسمه في الرسالة، أو من بصمته في الفرع وقتها.</p>
          </div>
          <button type="button" className="rounded-xl border border-[var(--dawaa-theme-border)] p-2 text-[var(--dawaa-theme-muted)]" onClick={onClose} aria-label="إغلاق"><X size={18} /></button>
        </header>

        <div className="flex flex-wrap items-end gap-2 border-b border-[var(--dawaa-theme-border)] px-4 py-3 md:px-6">
          <label className="text-xs font-black">الفرع
            <select className="input-dark mt-1" value={branch} onChange={(e) => setBranch(e.target.value)}>
              <option value="">اختار الفرع</option>
              {BRANCHES.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </label>
          <label className={`btn-primary flex cursor-pointer items-center gap-2 !py-2 text-xs ${loading ? 'opacity-60' : ''}`}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : <FileUp size={14} />} ارفع ملف الجروب
            <input type="file" accept=".zip,.txt" className="hidden" disabled={loading} onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              const picked = branch || branchFromName(file.name);
              if (!picked) { toast.error('اختار الفرع الأول'); return; }
              setBranch(picked);
              setFileName(file.name);
              void upload(file, picked);
            }} />
          </label>
          {candidates.length ? (
            <div className="text-xs font-bold text-[var(--dawaa-theme-muted)]">
              {fileName} · {candidates.length} طلب · فاضل {pending}
              <button type="button" className="ms-2 underline" onClick={() => setShowHandled((v) => !v)}>{showHandled ? 'اخفي المتسجل' : 'اعرض المتسجل'}</button>
            </div>
          ) : null}
          {candidates.length ? (
            <button type="button" className="btn-primary ms-auto flex items-center gap-2 !py-2 text-xs" disabled={saving} onClick={() => void saveAll()}
              title="كل طلب فيه كود عميل أو موبايل بيتحفظ مرة واحدة ويتحسب في التقييم للدكتور المختار">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} احفظ الكل في التقييم ({loggableCandidates(candidates).length})
            </button>
          ) : null}
        </div>

        <div className="space-y-2 overflow-y-auto p-3 md:p-5">
          {!candidates.length && !loading ? <div className="rounded-2xl border border-dashed border-[var(--dawaa-theme-border)] p-6 text-center text-sm font-bold text-[var(--dawaa-theme-muted)]">من الواتساب: افتح الجروب ← النقط التلاتة ← المزيد ← تصدير الدردشة ← بدون وسائط، وارفع الملف هنا.</div> : null}
          {visible.map((c) => {
            const state = handled[c.fingerprint];
            const chosen = doctorFor[c.fingerprint] || '';
            return (
              <article key={c.fingerprint} className={`rounded-2xl border border-[var(--dawaa-theme-border)] p-3 ${state ? 'opacity-60' : ''}`}>
                <div className="flex flex-wrap items-center gap-2 text-[11px] font-black text-[var(--dawaa-theme-muted)]">
                  <span>{timeLabel(c.sentAtLocal)}</span><span>· {c.sender}</span>
                  {c.kind === 'confirmation' ? <span className="dawaa-badge dawaa-badge--info rounded-full px-2">رسالة تأكيد للعميل</span> : null}
                  {c.customerCode ? <span className="dawaa-badge dawaa-badge--success rounded-full px-2">كود {c.customerCode}</span> : null}
                  {c.customerPhone ? <span className="dawaa-badge dawaa-badge--success rounded-full px-2">موبايل {c.customerPhone}</span> : null}
                  {state === 'saved' ? <span className="dawaa-badge dawaa-badge--success rounded-full px-2">اتسجل</span> : state === 'dismissed' ? <span className="dawaa-badge rounded-full px-2">مش طلب</span> : null}
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm font-bold leading-6 text-[var(--dawaa-theme-heading)]">{c.body}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <select className="input-dark !w-auto !py-1.5 text-xs" value={chosen} onChange={(e) => setDoctorFor({ ...doctorFor, [c.fingerprint]: e.target.value })}>
                    <option value="">اختار الدكتور</option>
                    {doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                  <span className="text-[11px] font-bold text-[var(--dawaa-theme-muted)]">
                    {chosen && chosen === c.doctorId ? DOCTOR_REASON_LABELS[c.doctorReason] : !chosen ? DOCTOR_REASON_LABELS[c.doctorReason] : 'اختيار يدوي'}
                    {c.onShift.length > 1 ? ` · باصمين: ${c.onShift.map(nameOf).filter(Boolean).join('، ')}` : ''}
                  </span>
                  {!state ? (
                    <div className="ms-auto flex gap-2">
                      <button type="button" className="btn-secondary !py-1.5 text-xs" onClick={() => mark(c.fingerprint, 'dismissed')}>مش طلب</button>
                      <button type="button" className="btn-primary flex items-center gap-1 !py-1.5 text-xs" disabled={!chosen} onClick={() => setOpen(c)}><Check size={14} /> سجّل الطلب</button>
                    </div>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {open ? (
        <CanonicalCreateRequestDialog
          initial={{
            doctorId: doctorFor[open.fingerprint] || null,
            channel: 'واتساب',
            notes: `من جروب طلبات العملاء (${customerRequestBranchLabel(branch)}) ${timeLabel(open.sentAtLocal)}:\n${open.body}`,
            hint: `رسالة الجروب: ${open.body}${open.customerCode ? `\nابحث عن العميل بالكود ${open.customerCode}` : ''}${open.customerPhone ? `\nابحث عن العميل بالموبايل ${open.customerPhone}` : ''}${open.confirmedItem ? `\nالصنف في رسالة التأكيد: ${open.confirmedItem}` : ''}`,
          }}
          onClose={() => setOpen(null)}
          onCreated={async (request) => { mark(open.fingerprint, 'saved'); await onCreated(request); }}
        />
      ) : null}
    </div>
  );
}
