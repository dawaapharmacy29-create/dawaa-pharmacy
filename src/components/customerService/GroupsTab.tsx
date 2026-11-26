import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, FileUp, Loader2, MessageCircle, Plus, RefreshCw, Search } from 'lucide-react';
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
  createGroupRequest,
  exportFollowupsWorkbook,
  exportRequestsWorkbook,
  followupCandidates,
  importFollowups,
  importRequests,
  itemTotals,
  knownFingerprints,
  loadGroupDoctors,
  loadGroupFollowups,
  loadGroupRequests,
  moveRequestsToShortages,
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
import { loadCatalog } from '@/lib/customerServiceTasks/productSearch';
import {
  FOLLOWUP_KINDS,
  followupBrief,
  understandFollowup,
  withKind,
  type FollowupKind,
  type FollowupUnderstanding,
} from '@/lib/customerServiceTasks/followupUnderstanding';
import RequestItemsPicker from '@/components/customerService/RequestItemsPicker';
import { loadStockForCodes, type StockByCode } from '@/lib/inventory/stock';
import GroupFolder from '@/components/customerService/GroupFolder';
import { markExportsDone, type GroupExport } from '@/lib/customerServiceTasks/groupFolder';

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

/** Only the upload of one group, for the morning files page. */
export function GroupUpload({
  kind,
  onDone,
}: {
  kind: 'followups' | 'requests';
  onDone?: () => void;
}) {
  const doctors = useDoctors();
  return kind === 'followups' ? (
    <FollowupsSection doctors={doctors} uploadOnly onUploaded={onDone} />
  ) : (
    <RequestsSection doctors={doctors} uploadOnly onUploaded={onDone} />
  );
}

// ---------------- جروب المتابعات ----------------

type Loaded<T> = {
  fileName: string;
  branch: string;
  rows: T[];
  /** Messages of the file that were saved before and left out. */
  already: number;
  /** Folder files to mark done once saved. */
  keys: string[];
};

/** Drops the messages saved before; when the check fails, the server still skips them on save. */
async function onlyNew<T extends { fingerprint: string }>(
  kind: 'followups' | 'requests',
  rows: T[]
): Promise<{ rows: T[]; already: number }> {
  const known = await knownFingerprints(
    kind,
    rows.map((r) => r.fingerprint)
  ).catch(() => new Set<string>());
  const fresh = rows.filter((r) => !known.has(r.fingerprint));
  return { rows: fresh, already: rows.length - fresh.length };
}

function FollowupsSection({
  doctors,
  onTasksAdded,
  uploadOnly,
  onUploaded,
}: {
  doctors: GroupDoctor[] | null;
  onTasksAdded?: () => void;
  uploadOnly?: boolean;
  onUploaded?: () => void;
}) {
  const today = cairoToday();
  const [loaded, setLoaded] = useState<Loaded<FollowupCandidate> | null>(null);
  const [days, setDays] = useState(3);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [codes, setCodes] = useState<Record<string, string>>({});
  // اللي السيستم فهمه من كل رسالة، والبنت بتعدّله قبل الحفظ.
  const [reads, setReads] = useState<Record<string, FollowupUnderstanding>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<GroupFollowup[] | null>(null);
  const [branchView, setBranchView] = useState('');
  const [folderVersion, setFolderVersion] = useState(0);

  const loadSaved = useCallback(async () => {
    if (uploadOnly) return;
    try {
      setSaved(await loadGroupFollowups(branchView || null, addDays(today, -3)));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      setSaved([]);
    }
  }, [branchView, today, uploadOnly]);
  useEffect(() => {
    void loadSaved();
  }, [loadSaved]);

  async function open(file: File, keys: string[] = []) {
    if (!doctors) {
      toast.error('لسه بنحمّل أسماء الدكاترة، جرّبي كمان ثانية');
      return;
    }
    setBusy(true);
    try {
      const content = await readChatFile(file);
      const all = followupCandidates(content, doctors);
      if (!all.length) throw new Error('empty');
      // التصدير فيه الجروب من أوله: بناخد آخر أسبوع بس (أقصى فترة للمراجعة) ومن غير اللي اتسجل قبل كده.
      const week = addDays(today, -6);
      const { rows, already } = await onlyNew(
        'followups',
        all.filter((r) => r.sentAtLocal.slice(0, 10) >= week)
      );
      if (!rows.length) {
        if (keys.length) markExportsDone(keys);
        setFolderVersion((v) => v + 1);
        toast.success('مفيش رسايل جديدة في الملف ده، كله اتسجل قبل كده');
        return;
      }
      const branch = detectGroupBranch(file.name, content) ?? '';
      const catalog = await loadCatalog().catch(() => null);
      setReads(
        Object.fromEntries(
          rows.map((r) => [
            r.fingerprint,
            understandFollowup(r.body, r.sentAtLocal.slice(0, 10), catalog),
          ])
        )
      );
      setLoaded({ fileName: file.name, branch, rows, already, keys });
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
    (r) =>
      (codeOf(r) || r.customerPhone) &&
      (r.sentAtLocal.slice(0, 10) >= addDays(today, -3) ||
        (reads[r.fingerprint]?.dueDate ?? '') >= today)
  ).length;
  const setRead = (fp: string, u: FollowupUnderstanding) => setReads({ ...reads, [fp]: u });

  async function exportSaved() {
    if (!saved?.length) return;
    const blob = await exportFollowupsWorkbook(
      saved,
      `متابعات الجروب ${branchView || 'الفرعين'} — من ${addDays(today, -3)}`
    );
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `متابعات-الجروب-${today}.xlsx`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

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
        chosen.map((c) => {
          const u = reads[c.fingerprint];
          return {
            ...c,
            customerCode: codeOf(c),
            understanding: u ? { ...u, brief: followupBrief(u, c.doctorName ?? c.sender) } : null,
          };
        })
      );
      const parts = [
        `اتسجل ${r.saved} حالة`,
        `${r.tasks} مهمة جديدة (في شيت النهارده أو يوم ميعادها)`,
      ];
      if (r.no_customer) parts.push(`${r.no_customer} من غير كود ولا رقم`);
      if (r.old) parts.push(`${r.old} أقدم من ٣ أيام ماتعملهاش مهمة`);
      toast.success(parts.join(' · '), { duration: 10000 });
      if (r.tasks) onTasksAdded?.();
      onUploaded?.();
      if (loaded.keys.length) markExportsDone(loaded.keys);
      setFolderVersion((v) => v + 1);
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
          <GroupFolder
            kind="followups"
            busy={busy}
            version={folderVersion}
            onOpen={(e: GroupExport) => void open(e.file, e.keys)}
          />
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
              <MiniBox
                label={
                  loaded.already ? `رسايل جديدة (${loaded.already} اتسجلت قبل كده)` : 'رسايل جديدة'
                }
                value={String(shown.length)}
                tone="blue"
              />
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
              الحالة صورة فاتورة من غير كود اكتبي كود العميل في خانته. في خانة «المتابعة» السيستم
              فهم نوعها والمطلوب والأصناف والميعاد من كلام الدكتور: راجعيهم وعدّلي لو محتاج، وده
              اللي هيتكتب للبنت في الشيت. لو في ميعاد المهمة بتنزل في يومه. الرسالة اللي اترفعت قبل
              كده مابتتكررش.
            </p>
            <div className="mt-3 max-h-[60vh] overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-right opacity-70">
                    <th className="p-2"></th>
                    <th className="p-2">الوقت</th>
                    <th className="p-2">الدكتور</th>
                    <th className="p-2">الرسالة</th>
                    <th className="p-2">المتابعة</th>
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
                      <td className="p-2 min-w-[15rem]">
                        {reads[r.fingerprint] ? (
                          <FollowupReadEditor
                            u={reads[r.fingerprint]}
                            today={today}
                            onChange={(u) => setRead(r.fingerprint, u)}
                          />
                        ) : null}
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

      {uploadOnly ? null : (
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
            <button
              className="btn-secondary inline-flex items-center gap-1"
              disabled={!saved?.length}
              onClick={() => void exportSaved()}
            >
              <Download size={16} /> ملف إكسيل للفريق
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
                    <th className="p-2">المطلوب</th>
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
                      <td className="p-2 text-xs">
                        {f.kind ? (
                          <span
                            className={`font-bold ${f.urgent ? 'text-[var(--dawaa-status-danger-text)]' : ''}`}
                          >
                            {FOLLOWUP_KINDS[f.kind]}
                            {f.urgent ? ' · ضروري' : ''}
                          </span>
                        ) : null}
                        <span className="block whitespace-pre-wrap">
                          {f.brief
                            ? short(f.brief.split('\n')[0].replace(/^[^:]+:\s*/, ''), 160)
                            : short(f.body, 140)}
                        </span>
                        {f.items?.length ? (
                          <span className="block opacity-70">الأصناف: {f.items.join('، ')}</span>
                        ) : null}
                        {f.due_date ? (
                          <span className="block opacity-70">
                            الميعاد: {f.due_date.slice(8, 10)}/{f.due_date.slice(5, 7)}
                          </span>
                        ) : null}
                      </td>
                      <td className="p-2 text-xs">
                        {f.task_date ? (
                          <>
                            <span className="font-bold">
                              {f.result
                                ? 'اتعملت'
                                : f.task_date > today
                                  ? 'في شيت يوم'
                                  : 'في الشيت'}
                              {!f.result && f.task_date > today
                                ? ` ${f.task_date.slice(8, 10)}/${f.task_date.slice(5, 7)}`
                                : ''}
                            </span>
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
      )}
    </>
  );
}

/** What the system understood from one message, for the team to check and correct before saving. */
function FollowupReadEditor({
  u,
  today,
  onChange,
}: {
  u: FollowupUnderstanding;
  today: string;
  onChange: (u: FollowupUnderstanding) => void;
}) {
  return (
    <div className="space-y-1 text-xs">
      <div className="flex items-center gap-1">
        <select
          className="input-field w-auto !py-1 text-xs font-bold"
          value={u.kind}
          onChange={(e) => onChange(withKind(u, e.target.value as FollowupKind))}
        >
          {(Object.keys(FOLLOWUP_KINDS) as FollowupKind[]).map((k) => (
            <option key={k} value={k}>
              {FOLLOWUP_KINDS[k]}
            </option>
          ))}
        </select>
        <label className="inline-flex items-center gap-1 whitespace-nowrap">
          <input
            type="checkbox"
            checked={u.urgent}
            onChange={(e) => onChange({ ...u, urgent: e.target.checked })}
          />
          ضروري
        </label>
      </div>
      <textarea
        className="input-field !py-1 text-xs"
        rows={2}
        value={u.action}
        onChange={(e) => onChange({ ...u, action: e.target.value })}
      />
      {u.items.length || u.patient ? (
        <div className="opacity-70">
          {u.patient ? <span>المريض: {u.patient} </span> : null}
          {u.items.length ? <span>الأصناف: {u.items.join('، ')}</span> : null}
        </div>
      ) : null}
      <label className="flex items-center gap-1">
        <span className="opacity-70 whitespace-nowrap">الميعاد</span>
        <input
          type="date"
          className="input-field w-auto !py-0.5 text-xs"
          min={today}
          value={u.dueDate ?? ''}
          onChange={(e) => {
            const d = e.target.value || null;
            onChange({
              ...u,
              dueDate: d,
              dueLabel: d ? `يوم ${d.slice(8, 10)}/${d.slice(5, 7)}` : null,
            });
          }}
        />
        {u.dueLabel && u.dueDate ? <span className="opacity-60">({u.dueLabel})</span> : null}
        {!u.dueDate ? <span className="opacity-60">في أقرب وقت</span> : null}
      </label>
    </div>
  );
}

// ---------------- جروب الطلبات ----------------

function RequestsSection({
  doctors,
  onTasksAdded,
  uploadOnly,
  onUploaded,
}: {
  doctors: GroupDoctor[] | null;
  onTasksAdded?: () => void;
  uploadOnly?: boolean;
  onUploaded?: () => void;
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
  const [adding, setAdding] = useState(false);
  const [stock, setStock] = useState<StockByCode | null>(null);
  const [onlyInStock, setOnlyInStock] = useState(false);
  const [folderVersion, setFolderVersion] = useState(0);

  const load = useCallback(async () => {
    if (uploadOnly) return;
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
  }, [from, to, branch, status, query, uploadOnly]);
  useEffect(() => {
    const t = setTimeout(() => void load(), query ? 350 : 0);
    return () => clearTimeout(t);
  }, [load, query]);

  // رصيد أصناف الطلبات من آخر ملف «رصيد المخازن»: الصنف اتوفر في الفرع ولا في الفرع التاني.
  const codesKey = useMemo(
    () =>
      [...new Set((rows ?? []).flatMap((r) => r.items.map((i) => i.code ?? '').filter(Boolean)))]
        .sort()
        .join(','),
    [rows]
  );
  useEffect(() => {
    if (!codesKey) {
      setStock(null);
      return;
    }
    let live = true;
    loadStockForCodes(codesKey.split(','))
      .then((s) => {
        if (live) setStock(s);
      })
      .catch(() => {
        if (live) setStock(null);
      });
    return () => {
      live = false;
    };
  }, [codesKey]);
  const inStock = useCallback(
    (r: GroupRequest) =>
      r.items.some((i) => !!i.code && (stock?.stock.get(i.code)?.[r.branch] ?? 0) > 0),
    [stock]
  );
  const visible = useMemo(
    () => (rows && onlyInStock ? rows.filter(inStock) : rows),
    [rows, onlyInStock, inStock]
  );

  async function open(file: File, keys: string[] = []) {
    if (!doctors) {
      toast.error('لسه بنحمّل أسماء الدكاترة، جرّبي كمان ثانية');
      return;
    }
    setBusy(true);
    try {
      const content = await readChatFile(file);
      const all = requestCandidates(content, doctors);
      if (!all.length) throw new Error('empty');
      const { rows, already } = await onlyNew('requests', all);
      if (!rows.length) {
        if (keys.length) markExportsDone(keys);
        setFolderVersion((v) => v + 1);
        toast.success('مفيش طلبات جديدة في الملف ده، كله اتسجل قبل كده');
        return;
      }
      setLoaded({
        fileName: file.name,
        branch: detectGroupBranch(file.name, content) ?? '',
        rows,
        already,
        keys,
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
      if (loaded.keys.length) markExportsDone(loaded.keys);
      setFolderVersion((v) => v + 1);
      setLoaded(null);
      onUploaded?.();
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
      // بنعدّل الصفوف في مكانها من غير ما نحمّل القايمة تاني.
      const by = new Map(list.map((u) => [u.fingerprint, u]));
      setRows((prev) =>
        (prev ?? []).map((row) => {
          const u = by.get(row.fingerprint);
          if (!u) return row;
          return {
            ...row,
            ...(u.status ? { status: u.status } : {}),
            ...(u.items ? { items: u.items } : {}),
            ...(u.note !== undefined ? { status_note: u.note } : {}),
            notify_task: row.notify_task || u.status === 'available',
          };
        })
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving('');
    }
  }

  async function toShortages() {
    setSaving('bulk');
    try {
      const list = [...picked];
      const r = await moveRequestsToShortages(list);
      toast.success(
        `اتحول ${r.requests} طلب للنواقص (${r.items} صنف)${r.skipped ? ` · ${r.skipped} كانوا متحولين قبل كده` : ''}`
      );
      const set = new Set(list);
      setRows((prev) =>
        (prev ?? []).map((row) =>
          set.has(row.fingerprint) && row.status === 'new'
            ? {
                ...row,
                status: 'sourcing' as RequestStatus,
                status_note: [row.status_note, 'اتحول للنواقص'].filter(Boolean).join(' · '),
              }
            : row
        )
      );
      setPicked(new Set());
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
    const list = picked.size ? rows.filter((r) => picked.has(r.fingerprint)) : (visible ?? rows);
    const blob = await exportRequestsWorkbook(
      list,
      `طلبات العملاء من الجروب · ${from.split('-').reverse().join('/')} لـ ${to.split('-').reverse().join('/')}${branch ? ` · ${branch}` : ''}`,
      stock?.stock
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
  const allPicked = !!visible?.length && visible.every((r) => picked.has(r.fingerprint));
  const inStockCount = useMemo(() => (rows ?? []).filter(inStock).length, [rows, inStock]);

  return (
    <>
      <Panel>
        <SectionTitle
          title="جروب الطلبات"
          subtitle="صدّري جروب طلبات العملاء وارفعيه: كل طلب فيه كود أو رقم عميل بيتسجل بأصنافه وكمياته، ومابيتكررش لو الملف اترفع تاني."
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <FilePick label="ارفعي تصدير جروب الطلبات" busy={busy} onFile={(f) => void open(f)} />
          <GroupFolder
            kind="requests"
            busy={busy}
            version={folderVersion}
            onOpen={(e: GroupExport) => void open(e.file, e.keys)}
          />
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
              <span className="text-sm font-bold">
                {inPeriod.list.length} طلب جديد
                {loaded.already ? (
                  <span className="mr-1 text-xs font-normal opacity-60">
                    ({loaded.already} اتسجلوا قبل كده)
                  </span>
                ) : null}
              </span>
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

      {uploadOnly ? null : (
        <Panel>
          <SectionTitle
            title="متابعة الطلبات"
            subtitle="جديد ← بنوفره ← اتوفر (بيعمل مهمة تبليغ في الشيت) ← العميل اتبلغ ← اتسلم"
          />
          <button
            className={`${adding ? 'btn-secondary' : 'btn-primary'} inline-flex items-center gap-1`}
            onClick={() => setAdding(!adding)}
          >
            <Plus size={16} /> {adding ? 'قفل الطلب الجديد' : 'سجّلي طلب جديد'}
          </button>
          {adding ? (
            <NewRequestForm
              doctors={doctors}
              defaultBranch={branch}
              onSaved={() => {
                setAdding(false);
                setStatus('open');
                void load();
              }}
            />
          ) : null}
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
            {stock?.day ? (
              <label className="inline-flex items-center gap-1 text-xs font-bold">
                <input
                  type="checkbox"
                  checked={onlyInStock}
                  onChange={(e) => setOnlyInStock(e.target.checked)}
                />
                صنفها اتوفر في الفرع ({inStockCount})
              </label>
            ) : null}
          </div>
          {stock?.day ? (
            <p className="mt-1 text-[11px] opacity-60">
              الرصيد من ملف رصيد المخازن يوم {stock.day.split('-').reverse().join('/')} (للأصناف
              اللي ليها كود بس).
            </p>
          ) : null}

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
                className="btn-secondary !px-2 !py-1 text-xs font-black"
                disabled={saving === 'bulk'}
                onClick={() => void toShortages()}
              >
                حوّلي للنواقص
              </button>
              <button
                className="btn-secondary !px-2 !py-1 text-xs"
                onClick={() => setPicked(new Set())}
              >
                إلغاء الاختيار
              </button>
            </div>
          ) : null}

          {!visible ? (
            <div className="flex justify-center p-6">
              <Loader2 className="animate-spin" />
            </div>
          ) : visible.length === 0 ? (
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
                          setPicked(
                            allPicked ? new Set() : new Set(visible.map((r) => r.fingerprint))
                          )
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
                  {visible.map((r) => (
                    <RequestRow
                      key={r.fingerprint}
                      row={r}
                      stock={stock?.stock ?? null}
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
      )}
    </>
  );
}

/** A request typed in here (a customer at the counter or on the phone), not from the group. */
function NewRequestForm({
  doctors,
  defaultBranch,
  onSaved,
}: {
  doctors: GroupDoctor[] | null;
  defaultBranch: string;
  onSaved: () => void;
}) {
  const [branch, setBranch] = useState(defaultBranch);
  const [code, setCode] = useState('');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [items, setItems] = useState<RequestItem[]>([]);
  const [note, setNote] = useState('');
  const [staffId, setStaffId] = useState('');
  const [busy, setBusy] = useState(false);
  const missingQty = items.filter((i) => !i.qty).length;

  async function save() {
    if (!branch) return toast.error('اختاري الفرع');
    if (!code.trim() && !phone.trim()) return toast.error('اكتبي كود العميل أو رقم موبايله');
    if (!items.length) return toast.error('ضيفي صنف واحد على الأقل');
    setBusy(true);
    try {
      await createGroupRequest({
        branch,
        customerCode: code,
        customerPhone: phone,
        customerName: name,
        items,
        note,
        staffId: staffId || null,
      });
      toast.success('الطلب اتسجل «جديد» وظاهر في المتابعة');
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 space-y-3 rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-soft)] p-3">
      <div className="grid gap-2 sm:grid-cols-4">
        <select className="input-field" value={branch} onChange={(e) => setBranch(e.target.value)}>
          <option value="">الفرع؟</option>
          {BRANCHES.map((b) => (
            <option key={b}>{b}</option>
          ))}
        </select>
        <input
          className="input-field"
          inputMode="numeric"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="كود العميل"
        />
        <input
          className="input-field"
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="أو رقم الموبايل"
        />
        <input
          className="input-field"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="اسم العميل (اختياري)"
        />
      </div>
      <RequestItemsPicker items={items} onChange={setItems} />
      <div className="grid gap-2 sm:grid-cols-2">
        <select
          className="input-field"
          value={staffId}
          onChange={(e) => setStaffId(e.target.value)}
        >
          <option value="">الدكتور اللي جاب الطلب (اختياري)</option>
          {(doctors ?? [])
            .filter((d) => !branch || !d.branch || d.branch === branch)
            .map((d) => (
              <option key={d.staffId} value={d.staffId}>
                {d.name}
              </option>
            ))}
        </select>
        <input
          className="input-field"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="ملاحظة (اختياري)"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          className="btn-primary inline-flex items-center gap-1"
          disabled={busy}
          onClick={() => void save()}
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : null} سجّلي الطلب
        </button>
        {missingQty ? (
          <span className="text-xs text-[var(--dawaa-status-danger-text)]">
            {missingQty} صنف من غير كمية
          </span>
        ) : null}
      </div>
    </div>
  );
}

function RequestRow({
  row: r,
  stock,
  picked,
  onPick,
  editing,
  onEdit,
  saving,
  onSave,
}: {
  row: GroupRequest;
  stock: Map<string, Record<string, number>> | null;
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
                <li key={n} className="flex items-center gap-1.5">
                  {i.image ? (
                    <a href={i.image} target="_blank" rel="noreferrer">
                      <img src={i.image} alt="" className="h-7 w-7 rounded object-cover" />
                    </a>
                  ) : null}
                  <span dir="auto">{i.name}</span>
                  <span className={i.qty ? 'font-black' : 'text-[var(--dawaa-status-danger-text)]'}>
                    × {i.qty ?? 'كمية؟'}
                  </span>
                  {i.code ? <span className="opacity-60">({i.code})</span> : null}
                  {i.code && stock ? (
                    <StockBadge stock={stock.get(i.code)} branch={r.branch} />
                  ) : null}
                  {i.new ? <span className="opacity-60">(جديد)</span> : null}
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

/** The item's stock here and in the other branch, from the last stock file. */
function StockBadge({ stock, branch }: { stock?: Record<string, number>; branch: string }) {
  const here = stock?.[branch] ?? 0;
  const other = Object.entries(stock ?? {})
    .filter(([b]) => b !== branch)
    .reduce((t, [, q]) => t + q, 0);
  const fmt = (v: number) => v.toLocaleString('ar-EG', { maximumFractionDigits: 1 });
  if (here > 0)
    return (
      <span className="rounded bg-[var(--dawaa-status-success-bg)] px-1 text-[10px] font-black text-[var(--dawaa-status-success-text)]">
        موجود {fmt(here)}
      </span>
    );
  if (other > 0)
    return (
      <span className="rounded bg-[var(--dawaa-status-info-bg)] px-1 text-[10px] font-black text-[var(--dawaa-status-info-text)]">
        في الفرع التاني {fmt(other)}
      </span>
    );
  return <span className="text-[10px] font-bold opacity-50">مش موجود</span>;
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
  const [items, setItems] = useState<RequestItem[]>(() =>
    row.items.length ? row.items : parseItems(row.details)
  );
  const [note, setNote] = useState(row.status_note ?? '');
  return (
    <div className="space-y-2">
      <p className="text-xs whitespace-pre-wrap opacity-70">الرسالة: {row.body}</p>
      <p className="text-[11px] opacity-70">
        الأصناف اللي «من الرسالة» اتقرت من الكلام؛ لو عايزة تربطيها بالكتالوج شيليها ودوّري عليها
        تحت.
      </p>
      <RequestItemsPicker items={items} onChange={setItems} />
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
            items.filter((i) => i.name.trim()),
            note
          )
        }
      >
        {saving ? <Loader2 size={16} className="animate-spin" /> : null} حفظ
      </button>
    </div>
  );
}
