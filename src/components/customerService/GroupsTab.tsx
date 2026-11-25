import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, FileUp, Loader2, MessageCircle, RefreshCw, Search } from 'lucide-react';
import { toast } from 'sonner';
import {
  EmptyState,
  MiniBox,
  Panel,
  SectionTitle,
} from '@/components/dashboard/DashboardPrimitives';
import { readChatFile } from '@/lib/followupRequests/followupRequestService';
import {
  candidatesInPeriod,
  detectGroupBranch,
  type RequestCandidate,
} from '@/features/customer-requests/groupImport/groupChatCustomerRequests';
import {
  REQUEST_STATUSES,
  exportRequestsWorkbook,
  followupCandidates,
  importFollowups,
  importRequests,
  itemTotals,
  loadGroupDoctors,
  loadGroupFollowups,
  loadGroupRequests,
  parseItems,
  requestCandidates,
  updateGroupRequests,
  type FollowupCandidate,
  type GroupDoctor,
  type GroupFollowup,
  type GroupRequest,
  type RequestItem,
  type RequestStatus,
} from '@/lib/customerServiceTasks/groups';
import { whatsappNumber } from '@/lib/customerServiceTasks/tasks';

// «الجروبات»: البنت ترفع تصدير جروب المتابعات وجروب الطلبات من الواتساب.
// المتابعات بتبقى مهام في شيت النهارده، والطلبات بتتسجل بأصنافها وكمياتها وتتتابع لحد ما تتسلم وتتصدر إكسيل.

const BRANCHES = ['فرع شكري', 'فرع الشامي'];
const cairoToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const localLabel = (local: string) =>
  `${local.slice(8, 10)}/${local.slice(5, 7)} ${local.slice(11, 16)}`;
const isoLabel = (iso: string) =>
  new Date(iso).toLocaleString('ar-EG', {
    timeZone: 'Africa/Cairo',
    day: 'numeric',
    month: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
const short = (s: string, n = 160) => (s.length > n ? `${s.slice(0, n)}…` : s);
const STATUS_TONE: Record<RequestStatus, string> = {
  new: 'text-[var(--dawaa-status-info-text)]',
  sourcing: 'text-[var(--dawaa-status-warning-text,#b45309)]',
  available: 'text-[var(--dawaa-status-success-text)]',
  notified: 'text-[var(--dawaa-status-success-text)]',
  delivered: 'opacity-60',
  cancelled: 'opacity-50 line-through',
};

function useDoctors() {
  const [doctors, setDoctors] = useState<GroupDoctor[] | null>(null);
  useEffect(() => {
    loadGroupDoctors()
      .then(setDoctors)
      .catch(() => setDoctors([]));
  }, []);
  return doctors;
}

function FilePick({
  label,
  busy,
  onFile,
}: {
  label: string;
  busy: boolean;
  onFile: (f: File) => void;
}) {
  return (
    <label className="btn-primary inline-flex cursor-pointer items-center gap-1">
      {busy ? <Loader2 size={16} className="animate-spin" /> : <FileUp size={16} />} {label}
      <input
        type="file"
        accept=".zip,.txt"
        className="hidden"
        disabled={busy}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onFile(f);
        }}
      />
    </label>
  );
}

export default function GroupsTab({ onTasksAdded }: { onTasksAdded?: () => void }) {
  const doctors = useDoctors();
  const [section, setSection] = useState<'followups' | 'requests'>('followups');
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <button
          className={section === 'followups' ? 'btn-primary' : 'btn-secondary'}
          onClick={() => setSection('followups')}
        >
          جروب المتابعات
        </button>
        <button
          className={section === 'requests' ? 'btn-primary' : 'btn-secondary'}
          onClick={() => setSection('requests')}
        >
          جروب الطلبات
        </button>
      </div>
      {section === 'followups' ? (
        <FollowupsSection doctors={doctors} onTasksAdded={onTasksAdded} />
      ) : (
        <RequestsSection doctors={doctors} onTasksAdded={onTasksAdded} />
      )}
    </div>
  );
}

// ---------------- جروب المتابعات ----------------

type Loaded<T> = { fileName: string; branch: string; rows: T[] };

function FollowupsSection({
  doctors,
  onTasksAdded,
}: {
  doctors: GroupDoctor[] | null;
  onTasksAdded?: () => void;
}) {
  const today = cairoToday();
  const [loaded, setLoaded] = useState<Loaded<FollowupCandidate> | null>(null);
  const [days, setDays] = useState(3);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<GroupFollowup[] | null>(null);
  const [branchView, setBranchView] = useState('');

  const loadSaved = useCallback(async () => {
    try {
      setSaved(await loadGroupFollowups(branchView || null, addDays(today, -3)));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      setSaved([]);
    }
  }, [branchView, today]);
  useEffect(() => {
    void loadSaved();
  }, [loadSaved]);

  async function open(file: File) {
    if (!doctors) {
      toast.error('لسه بنحمّل أسماء الدكاترة، جرّبي كمان ثانية');
      return;
    }
    setBusy(true);
    try {
      const content = await readChatFile(file);
      const rows = followupCandidates(content, doctors);
      if (!rows.length) throw new Error('empty');
      const branch = detectGroupBranch(file.name, content) ?? '';
      setLoaded({ fileName: file.name, branch, rows });
      setPicked(Object.fromEntries(rows.map((r) => [r.fingerprint, r.likely])));
      setCodes({});
    } catch {
      toast.error('الملف مفيهوش محادثة واتساب. ارفعي ملف التصدير (zip أو txt)');
    } finally {
      setBusy(false);
    }
  }

  const from = addDays(today, -(days - 1));
  const shown = (loaded?.rows ?? []).filter((r) => r.sentAtLocal.slice(0, 10) >= from);
  const codeOf = (r: FollowupCandidate) => {
    const typed = (codes[r.fingerprint] ?? '')
      .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
      .replace(/\D/g, '');
    return typed || r.customerCode;
  };
  const chosen = shown.filter((r) => picked[r.fingerprint]);
  const willTask = chosen.filter(
    (r) => (codeOf(r) || r.customerPhone) && r.sentAtLocal.slice(0, 10) >= addDays(today, -3)
  ).length;

  async function save() {
    if (!loaded?.branch) {
      toast.error('اختاري الفرع');
      return;
    }
    setBusy(true);
    try {
      const r = await importFollowups(
        loaded.fileName,
        loaded.branch,
        chosen.map((c) => ({ ...c, customerCode: codeOf(c) }))
      );
      const parts = [`اتسجل ${r.saved} حالة`, `${r.tasks} مهمة جديدة في شيت النهارده`];
      if (r.no_customer) parts.push(`${r.no_customer} من غير كود ولا رقم`);
      if (r.old) parts.push(`${r.old} أقدم من ٣ أيام ماتعملهاش مهمة`);
      toast.success(parts.join(' · '), { duration: 10000 });
      if (r.tasks) onTasksAdded?.();
      setLoaded(null);
      await loadSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Panel>
        <SectionTitle
          title="جروب المتابعات"
          subtitle="صدّري الجروب من الواتساب (من غير وسائط) وارفعيه. كل حالة فيها كود أو رقم عميل بتبقى مهمة في شيت النهارده، وبتتحسب للدكتور في المسابقة."
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <FilePick label="ارفعي تصدير جروب المتابعات" busy={busy} onFile={(f) => void open(f)} />
          {loaded ? (
            <>
              <select
                className="input-field w-auto"
                value={loaded.branch}
                onChange={(e) => setLoaded({ ...loaded, branch: e.target.value })}
              >
                <option value="">الفرع؟</option>
                {BRANCHES.map((b) => (
                  <option key={b}>{b}</option>
                ))}
              </select>
              <select
                className="input-field w-auto"
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
              >
                <option value={1}>النهارده بس</option>
                <option value={2}>امبارح والنهارده</option>
                <option value={3}>آخر ٣ أيام</option>
                <option value={7}>آخر أسبوع (اللي أقدم من ٣ أيام بيتحسب للدكتور بس)</option>
              </select>
            </>
          ) : null}
        </div>
        {loaded ? (
          <>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <MiniBox label="رسايل في الفترة" value={String(shown.length)} tone="blue" />
              <MiniBox label="مختارة" value={String(chosen.length)} tone="cyan" />
              <MiniBox label="هتبقى مهام" value={String(willTask)} tone="green" />
              <MiniBox
                label="مختارة من غير كود ولا رقم"
                value={String(chosen.filter((r) => !codeOf(r) && !r.customerPhone).length)}
                tone="amber"
              />
            </div>
            <p className="mt-2 text-xs opacity-70">
              اللي متعلم عليه السيستم شايفه حالة متابعة. شيلي العلامة من أي رسالة مش حالة، ولو
              الحالة صورة فاتورة من غير كود اكتبي كود العميل في خانته. الرسالة اللي اترفعت قبل كده
              مابتتكررش.
            </p>
            <div className="mt-3 max-h-[60vh] overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-right opacity-70">
                    <th className="p-2"></th>
                    <th className="p-2">الوقت</th>
                    <th className="p-2">الدكتور</th>
                    <th className="p-2">الرسالة</th>
                    <th className="p-2">كود العميل</th>
                    <th className="p-2">الرقم</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr
                      key={r.fingerprint}
                      className={`border-t border-[var(--dawaa-theme-border)] align-top ${picked[r.fingerprint] ? '' : 'opacity-50'}`}
                    >
                      <td className="p-2">
                        <input
                          type="checkbox"
                          checked={!!picked[r.fingerprint]}
                          onChange={(e) =>
                            setPicked({ ...picked, [r.fingerprint]: e.target.checked })
                          }
                        />
                      </td>
                      <td className="p-2 whitespace-nowrap text-xs">{localLabel(r.sentAtLocal)}</td>
                      <td className="p-2 text-xs">
                        <span className="font-bold">{r.doctorName ?? r.sender}</span>
                        {r.doctorName && r.doctorName !== r.sender ? (
                          <span className="block opacity-60">من {r.sender}</span>
                        ) : null}
                      </td>
                      <td className="p-2 text-xs whitespace-pre-wrap">
                        {r.hasImage ? '📷 ' : ''}
                        {short(r.body, 220)}
                      </td>
                      <td className="p-2">
                        <input
                          className="input-field w-24 !py-1 text-xs"
                          inputMode="numeric"
                          placeholder={r.customerCode ?? 'الكود'}
                          value={codes[r.fingerprint] ?? ''}
                          onChange={(e) => setCodes({ ...codes, [r.fingerprint]: e.target.value })}
                        />
                      </td>
                      <td className="p-2 text-xs whitespace-nowrap">{r.customerPhone ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex gap-2">
              <button
                className="btn-primary inline-flex items-center gap-1"
                disabled={busy || !chosen.length || !loaded.branch}
                onClick={() => void save()}
              >
                {busy ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <MessageCircle size={16} />
                )}{' '}
                سجّلي {chosen.length} حالة
              </button>
              <button className="btn-secondary" disabled={busy} onClick={() => setLoaded(null)}>
                إلغاء
              </button>
            </div>
          </>
        ) : null}
      </Panel>

      <Panel>
        <SectionTitle
          title="اللي اترفع آخر ٣ أيام"
          subtitle="كل حالة: بقت مهمة على مين، ونتيجتها لو اتعملت"
        />
        <div className="mt-2 flex gap-2">
          <select
            className="input-field w-auto"
            value={branchView}
            onChange={(e) => setBranchView(e.target.value)}
          >
            <option value="">الفرعين</option>
            {BRANCHES.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
          <button
            className="btn-secondary inline-flex items-center gap-1"
            onClick={() => void loadSaved()}
          >
            <RefreshCw size={16} /> تحديث
          </button>
        </div>
        {!saved ? (
          <div className="flex justify-center p-6">
            <Loader2 className="animate-spin" />
          </div>
        ) : saved.length === 0 ? (
          <EmptyState label="مفيش حالات اترفعت آخر ٣ أيام" />
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-right opacity-70">
                  <th className="p-2">الوقت</th>
                  <th className="p-2">الفرع</th>
                  <th className="p-2">الدكتور</th>
                  <th className="p-2">العميل</th>
                  <th className="p-2">الرسالة</th>
                  <th className="p-2">المهمة</th>
                </tr>
              </thead>
              <tbody>
                {saved.map((f) => (
                  <tr
                    key={f.fingerprint}
                    className="border-t border-[var(--dawaa-theme-border)] align-top"
                  >
                    <td className="p-2 text-xs whitespace-nowrap">{isoLabel(f.sent_at)}</td>
                    <td className="p-2 text-xs">{f.branch.replace('فرع ', '')}</td>
                    <td className="p-2 text-xs">{f.doctor}</td>
                    <td className="p-2 text-xs">
                      {f.customer_name ?? ''} {f.customer_code ? `(${f.customer_code})` : ''}
                      {f.customer_phone ? (
                        <span className="block opacity-70">{f.customer_phone}</span>
                      ) : null}
                    </td>
                    <td className="p-2 text-xs">{short(f.body, 140)}</td>
                    <td className="p-2 text-xs">
                      {f.task_date ? (
                        <>
                          <span className="font-bold">{f.result ? 'اتعملت' : 'في الشيت'}</span>
                          {f.assigned_name ? (
                            <span className="block opacity-70">على {f.assigned_name}</span>
                          ) : null}
                        </>
                      ) : f.customer_code || f.customer_phone ? (
                        <span className="opacity-60">أقدم من ٣ أيام</span>
                      ) : (
                        <span className="text-[var(--dawaa-status-danger-text)]">محتاجة كود</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}

// ---------------- جروب الطلبات ----------------

function RequestsSection({
  doctors,
  onTasksAdded,
}: {
  doctors: GroupDoctor[] | null;
  onTasksAdded?: () => void;
}) {
  const today = cairoToday();
  const [loaded, setLoaded] = useState<Loaded<RequestCandidate> | null>(null);
  const [period, setPeriod] = useState<'cycle' | 'two_cycles' | 'all'>('cycle');
  const [busy, setBusy] = useState(false);

  const [from, setFrom] = useState(addDays(today, -30));
  const [to, setTo] = useState(today);
  const [branch, setBranch] = useState('');
  const [status, setStatus] = useState('open');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<GroupRequest[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState('');

  const load = useCallback(async () => {
    try {
      setRows(
        await loadGroupRequests({
          from,
          to,
          branch: branch || null,
          status: status || null,
          q: query,
        })
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      setRows([]);
    }
  }, [from, to, branch, status, query]);
  useEffect(() => {
    const t = setTimeout(() => void load(), query ? 350 : 0);
    return () => clearTimeout(t);
  }, [load, query]);

  async function open(file: File) {
    if (!doctors) {
      toast.error('لسه بنحمّل أسماء الدكاترة، جرّبي كمان ثانية');
      return;
    }
    setBusy(true);
    try {
      const content = await readChatFile(file);
      const all = requestCandidates(content, doctors);
      if (!all.length) throw new Error('empty');
      setLoaded({
        fileName: file.name,
        branch: detectGroupBranch(file.name, content) ?? '',
        rows: all,
      });
    } catch {
      toast.error('الملف مفيهوش طلبات أو مش محادثة واتساب. ارفعي ملف التصدير (zip أو txt)');
    } finally {
      setBusy(false);
    }
  }

  const inPeriod = useMemo(
    () => (loaded ? candidatesInPeriod(loaded.rows, period) : null),
    [loaded, period]
  );

  async function saveImport() {
    if (!loaded?.branch || !inPeriod) {
      toast.error('اختاري الفرع');
      return;
    }
    setBusy(true);
    try {
      const r = await importRequests(loaded.fileName, loaded.branch, inPeriod.list);
      toast.success(
        `اتسجل ${r.added} طلب جديد${r.already ? ` · ${r.already} كانوا متسجلين قبل كده` : ''}`
      );
      setLoaded(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function update(
    list: Array<{
      fingerprint: string;
      status?: RequestStatus;
      items?: RequestItem[];
      note?: string | null;
    }>,
    key: string
  ) {
    setSaving(key);
    try {
      const r = await updateGroupRequests(list);
      toast.success(
        `اتحفظ ${r.saved}${r.tasks ? ` · ${r.tasks} مهمة تبليغ اتضافت لشيت النهارده` : ''}`
      );
      if (r.tasks) onTasksAdded?.();
      setPicked(new Set());
      setEditing(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving('');
    }
  }

  async function exportExcel() {
    if (!rows?.length) {
      toast.error('مفيش طلبات تتصدر');
      return;
    }
    const list = picked.size ? rows.filter((r) => picked.has(r.fingerprint)) : rows;
    const blob = await exportRequestsWorkbook(
      list,
      `طلبات العملاء من الجروب · ${from.split('-').reverse().join('/')} لـ ${to.split('-').reverse().join('/')}${branch ? ` · ${branch}` : ''}`
    );
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `طلبات-العملاء-${to}.xlsx`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    (rows ?? []).forEach((r) => (c[r.status] = (c[r.status] ?? 0) + 1));
    return c;
  }, [rows]);
  const totals = useMemo(() => itemTotals(rows ?? []).slice(0, 8), [rows]);
  const allPicked = !!rows?.length && rows.every((r) => picked.has(r.fingerprint));

  return (
    <>
      <Panel>
        <SectionTitle
          title="جروب الطلبات"
          subtitle="صدّري جروب طلبات العملاء وارفعيه: كل طلب فيه كود أو رقم عميل بيتسجل بأصنافه وكمياته، ومابيتكررش لو الملف اترفع تاني."
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <FilePick label="ارفعي تصدير جروب الطلبات" busy={busy} onFile={(f) => void open(f)} />
          {loaded && inPeriod ? (
            <>
              <select
                className="input-field w-auto"
                value={loaded.branch}
                onChange={(e) => setLoaded({ ...loaded, branch: e.target.value })}
              >
                <option value="">الفرع؟</option>
                {BRANCHES.map((b) => (
                  <option key={b}>{b}</option>
                ))}
              </select>
              <select
                className="input-field w-auto"
                value={period}
                onChange={(e) => setPeriod(e.target.value as typeof period)}
              >
                <option value="cycle">الدورة الحالية</option>
                <option value="two_cycles">الدورة دي واللي قبلها</option>
                <option value="all">الملف كله</option>
              </select>
              <span className="text-sm font-bold">{inPeriod.list.length} طلب</span>
              <button
                className="btn-primary"
                disabled={busy || !loaded.branch || !inPeriod.list.length}
                onClick={() => void saveImport()}
              >
                سجّلي الطلبات
              </button>
              <button className="btn-secondary" onClick={() => setLoaded(null)}>
                إلغاء
              </button>
            </>
          ) : null}
        </div>
        {loaded && inPeriod ? (
          <div className="mt-3 max-h-[40vh] overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-right opacity-70">
                  <th className="p-2">الوقت</th>
                  <th className="p-2">العميل</th>
                  <th className="p-2">الأصناف والكمية</th>
                  <th className="p-2">مين بعت</th>
                </tr>
              </thead>
              <tbody>
                {inPeriod.list.slice(0, 200).map((c) => (
                  <tr
                    key={c.fingerprint}
                    className="border-t border-[var(--dawaa-theme-border)] align-top"
                  >
                    <td className="p-2 text-xs whitespace-nowrap">{localLabel(c.sentAtLocal)}</td>
                    <td className="p-2 text-xs">
                      {c.customerName ?? ''} {c.customerCode ? `(${c.customerCode})` : ''}
                      {c.customerPhone ? (
                        <span className="block opacity-70">{c.customerPhone}</span>
                      ) : null}
                    </td>
                    <td className="p-2 text-xs">
                      {parseItems(c.details)
                        .map((i) => `${i.name}${i.qty ? ` × ${i.qty}` : ''}`)
                        .join('، ') ||
                        c.details ||
                        '—'}
                    </td>
                    <td className="p-2 text-xs">{c.sender}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Panel>

      <Panel>
        <SectionTitle
          title="متابعة الطلبات"
          subtitle="جديد ← بنوفره ← اتوفر (بيعمل مهمة تبليغ في الشيت) ← العميل اتبلغ ← اتسلم"
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[15rem] flex-1">
            <Search size={16} className="absolute top-1/2 right-3 -translate-y-1/2 opacity-50" />
            <input
              className="input-field !pr-9"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="دوّري باسم العميل أو كوده أو رقمه، أو الصنف، أو الدكتور"
            />
          </div>
          <select
            className="input-field w-auto"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="open">المفتوحة (جديد وبنوفره واتوفر)</option>
            <option value="">كل الحالات</option>
            {(Object.keys(REQUEST_STATUSES) as RequestStatus[]).map((s) => (
              <option key={s} value={s}>
                {REQUEST_STATUSES[s]}
              </option>
            ))}
          </select>
          <select
            className="input-field w-auto"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
          >
            <option value="">الفرعين</option>
            {BRANCHES.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
          <label className="inline-flex items-center gap-1 text-xs font-bold">
            من
            <input
              type="date"
              className="input-field w-auto"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="inline-flex items-center gap-1 text-xs font-bold">
            لحد
            <input
              type="date"
              className="input-field w-auto"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <button
            className="btn-secondary inline-flex items-center gap-1"
            onClick={() => void exportExcel()}
          >
            <Download size={16} /> إكسيل{picked.size ? ` (${picked.size})` : ''}
          </button>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
          {(Object.keys(REQUEST_STATUSES) as RequestStatus[]).map((s) => (
            <MiniBox
              key={s}
              label={REQUEST_STATUSES[s]}
              value={String(counts[s] ?? 0)}
              tone={s === 'available' ? 'green' : s === 'new' ? 'blue' : 'cyan'}
            />
          ))}
        </div>
        {totals.length ? (
          <p className="mt-2 text-xs">
            <span className="font-black">أكتر أصناف مطلوبة: </span>
            {totals
              .map((t) => `${t.name}${t.qty ? ` (${t.qty})` : ''} لـ ${t.customers}`)
              .join(' · ')}
          </p>
        ) : null}

        {picked.size ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-[var(--dawaa-theme-soft)] p-2 text-sm">
            <span className="font-black">اخترتي {picked.size}</span>
            {(Object.keys(REQUEST_STATUSES) as RequestStatus[]).map((s) => (
              <button
                key={s}
                className="btn-secondary !px-2 !py-1 text-xs"
                disabled={saving === 'bulk'}
                onClick={() =>
                  void update(
                    [...picked].map((fingerprint) => ({ fingerprint, status: s })),
                    'bulk'
                  )
                }
              >
                {REQUEST_STATUSES[s]}
              </button>
            ))}
            <button
              className="btn-secondary !px-2 !py-1 text-xs"
              onClick={() => setPicked(new Set())}
            >
              إلغاء الاختيار
            </button>
          </div>
        ) : null}

        {!rows ? (
          <div className="flex justify-center p-6">
            <Loader2 className="animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState label={query ? 'مفيش طلبات بالبحث ده' : 'مفيش طلبات في الفترة دي'} />
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-right opacity-70">
                  <th className="p-2">
                    <input
                      type="checkbox"
                      aria-label="اختاري الكل"
                      checked={allPicked}
                      onChange={() =>
                        setPicked(allPicked ? new Set() : new Set(rows.map((r) => r.fingerprint)))
                      }
                    />
                  </th>
                  <th className="p-2">اليوم</th>
                  <th className="p-2">العميل</th>
                  <th className="p-2">الأصناف والكمية</th>
                  <th className="p-2">الدكتور</th>
                  <th className="p-2">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <RequestRow
                    key={r.fingerprint}
                    row={r}
                    picked={picked.has(r.fingerprint)}
                    onPick={() =>
                      setPicked((prev) => {
                        const next = new Set(prev);
                        if (next.has(r.fingerprint)) next.delete(r.fingerprint);
                        else next.add(r.fingerprint);
                        return next;
                      })
                    }
                    editing={editing === r.fingerprint}
                    onEdit={() => setEditing(editing === r.fingerprint ? null : r.fingerprint)}
                    saving={saving === r.fingerprint}
                    onSave={(u) =>
                      void update([{ fingerprint: r.fingerprint, ...u }], r.fingerprint)
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}

function RequestRow({
  row: r,
  picked,
  onPick,
  editing,
  onEdit,
  saving,
  onSave,
}: {
  row: GroupRequest;
  picked: boolean;
  onPick: () => void;
  editing: boolean;
  onEdit: () => void;
  saving: boolean;
  onSave: (u: { status?: RequestStatus; items?: RequestItem[]; note?: string | null }) => void;
}) {
  const wa = whatsappNumber(r.customer_phone);
  return (
    <>
      <tr
        className={`border-t border-[var(--dawaa-theme-border)] align-top ${picked ? 'bg-[var(--dawaa-theme-soft)]' : ''}`}
      >
        <td className="p-2">
          <input type="checkbox" checked={picked} onChange={onPick} aria-label="اختيار" />
        </td>
        <td className="p-2 text-xs whitespace-nowrap">
          {isoLabel(r.sent_at)}
          <span className="block opacity-70">{r.branch.replace('فرع ', '')}</span>
        </td>
        <td className="p-2 text-xs">
          <span className="font-bold">{r.customer_name ?? '—'}</span>{' '}
          {r.customer_code ? `(${r.customer_code})` : ''}
          {r.customer_phone ? (
            wa ? (
              <a
                className="block text-[var(--dawaa-status-info-text)]"
                href={`https://wa.me/${wa}`}
                target="_blank"
                rel="noreferrer"
              >
                {r.customer_phone}
              </a>
            ) : (
              <span className="block">{r.customer_phone}</span>
            )
          ) : null}
        </td>
        <td className="p-2 text-xs">
          {r.items.length ? (
            <ul className="space-y-0.5">
              {r.items.map((i, n) => (
                <li key={n}>
                  {i.name}{' '}
                  <span className={i.qty ? 'font-black' : 'text-[var(--dawaa-status-danger-text)]'}>
                    × {i.qty ?? 'كمية؟'}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <span>{r.details ?? short(r.body, 120)}</span>
          )}
          {r.status_note ? (
            <span className="mt-1 block opacity-70">ملاحظة: {r.status_note}</span>
          ) : null}
          <button className="mt-1 text-[11px] font-bold underline opacity-70" onClick={onEdit}>
            {editing ? 'قفل' : 'عدّلي الأصناف والكمية'}
          </button>
        </td>
        <td className="p-2 text-xs">{r.doctor ?? r.sender ?? '—'}</td>
        <td className="p-2 text-xs">
          <select
            className={`input-field w-auto !py-1 text-xs font-black ${STATUS_TONE[r.status] ?? ''}`}
            value={r.status}
            disabled={saving}
            onChange={(e) => onSave({ status: e.target.value as RequestStatus })}
          >
            {(Object.keys(REQUEST_STATUSES) as RequestStatus[]).map((s) => (
              <option key={s} value={s}>
                {REQUEST_STATUSES[s]}
              </option>
            ))}
          </select>
          {r.status_by ? <span className="mt-1 block opacity-60">{r.status_by}</span> : null}
          {r.notify_task ? (
            <span className="block text-[var(--dawaa-status-success-text)]">
              مهمة التبليغ في الشيت
            </span>
          ) : null}
        </td>
      </tr>
      {editing ? (
        <tr>
          <td colSpan={6} className="bg-[var(--dawaa-theme-soft)] p-3">
            <ItemsEditor
              row={r}
              saving={saving}
              onSave={(items, note) => onSave({ items, note })}
            />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function ItemsEditor({
  row,
  saving,
  onSave,
}: {
  row: GroupRequest;
  saving: boolean;
  onSave: (items: RequestItem[], note: string | null) => void;
}) {
  const [items, setItems] = useState<Array<{ name: string; qty: string }>>(() =>
    (row.items.length ? row.items : parseItems(row.details)).map((i) => ({
      name: i.name,
      qty: i.qty ? String(i.qty) : '',
    }))
  );
  const [note, setNote] = useState(row.status_note ?? '');
  const set = (n: number, patch: Partial<{ name: string; qty: string }>) =>
    setItems(items.map((it, i) => (i === n ? { ...it, ...patch } : it)));
  return (
    <div className="space-y-2">
      <p className="text-xs opacity-70 whitespace-pre-wrap">الرسالة: {row.body}</p>
      {items.map((it, n) => (
        <div key={n} className="flex gap-2">
          <input
            className="input-field flex-1"
            value={it.name}
            placeholder="الصنف"
            onChange={(e) => set(n, { name: e.target.value })}
          />
          <input
            className="input-field w-24"
            inputMode="numeric"
            value={it.qty}
            placeholder="الكمية"
            onChange={(e) => set(n, { qty: e.target.value })}
          />
          <button
            className="btn-secondary !px-2 text-xs"
            onClick={() => setItems(items.filter((_, i) => i !== n))}
          >
            شيل
          </button>
        </div>
      ))}
      <button
        className="btn-secondary !px-2 !py-1 text-xs"
        onClick={() => setItems([...items, { name: '', qty: '' }])}
      >
        + صنف
      </button>
      <input
        className="input-field"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="ملاحظة (اختياري): مثلاً المورد هيجيبه بكرة"
      />
      <button
        className="btn-primary inline-flex items-center gap-1"
        disabled={saving}
        onClick={() =>
          onSave(
            items
              .filter((i) => i.name.trim())
              .map((i) => {
                const q = Number(i.qty.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))));
                return { name: i.name.trim(), qty: Number.isFinite(q) && q > 0 ? q : null };
              }),
            note
          )
        }
      >
        {saving ? <Loader2 size={16} className="animate-spin" /> : null} حفظ
      </button>
    </div>
  );
}
