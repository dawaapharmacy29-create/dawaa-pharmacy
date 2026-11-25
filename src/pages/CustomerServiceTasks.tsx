import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Download, FileSpreadsheet, Loader2, RefreshCw, Save, Upload, Users } from 'lucide-react';
import { toast } from 'sonner';
import {
  EmptyState,
  MiniBox,
  Panel,
  SectionTitle,
} from '@/components/dashboard/DashboardPrimitives';
import { cairoToday } from '@/lib/evaluationLab/reviewSamples';
import {
  buildTodayTasks,
  listTasks,
  loadOverview,
  loadTaskSettings,
  saveTaskSettings,
  submitSheet,
  type DailyTask,
  type Overview,
  type TaskMember,
  type TaskSettings,
} from '@/lib/customerServiceTasks/api';
import {
  OUTCOME_CHOICES,
  REASON_CHOICES,
  SOURCE_LABELS,
  choiceLabel,
  sourceLabel,
  type DoctorCase,
  type SheetProblem,
  type TaskUpdate,
} from '@/lib/customerServiceTasks/tasks';
import { buildTaskWorkbook, readTaskWorkbook } from '@/lib/customerServiceTasks/sheet';
import CsCompetitionTab from '@/components/customerService/CsCompetitionTab';
import MorningChecklist from '@/components/customerService/MorningChecklist';
import MorningFilesTab from '@/components/customerService/MorningFilesTab';
import MorningPurchasesTab from '@/components/customerService/MorningPurchasesTab';
import GroupsTab from '@/components/customerService/GroupsTab';
import {
  loadOnboarding,
  submitOnboarding,
  type OnboardingUpdate,
} from '@/lib/customerServiceTasks/onboarding';
import MorningTransfersTab from '@/components/customerService/MorningTransfersTab';
import DoctorEntryErrorsTab from '@/components/customerService/DoctorEntryErrorsTab';
import { buildUncodedNoteTasks } from '@/lib/customerServiceTasks/morning';
import { useAuth } from '@/hooks/useAuth';
import { normalizeRole } from '@/lib/core/permissionSystem';

// شيت مهام خدمة العملاء اليومي: كل واحد في الفريق بيحمّل مهامه الصبح، يشتغل على الإكسيل، ويرفعه آخر اليوم.
// اللي يفتح الصفحة لأي حد تاني هو مفتاح customer_service_daily_tasks من صلاحيات الحسابات، والإدارة بمفتاح _manage.

type PageTab = 'mine' | 'files' | 'purchases' | 'transfers' | 'groups' | 'team' | 'competition' | 'errors';
const PAGE_TABS: PageTab[] = [
  'mine',
  'files',
  'purchases',
  'transfers',
  'groups',
  'team',
  'competition',
  'errors',
];

function cycleStart(today: string): string {
  const [y, m, d] = today.split('-').map(Number);
  const start = d >= 26 ? new Date(Date.UTC(y, m - 1, 26)) : new Date(Date.UTC(y, m - 2, 26));
  return start.toISOString().slice(0, 10);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

// EmptyState بيخفي نص الخطأ؛ هنا بنعرض السبب الحقيقي (مثلاً «مهام خدمة العملاء غير مسموحة لهذا الحساب»).
function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-[var(--dawaa-status-danger-border)] p-6 text-center text-[var(--dawaa-status-danger-text)]">
      <span className="text-sm font-black">تعذر تحميل البيانات</span>
      <span className="text-xs font-bold">{message}</span>
      <button type="button" className="btn-secondary mt-1" onClick={onRetry}>
        إعادة المحاولة
      </button>
    </div>
  );
}

type Pending = {
  updates: TaskUpdate[];
  onboarding: OnboardingUpdate[];
  cases: DoctorCase[];
  problems: SheetProblem[];
  fileName: string;
};

export default function CustomerServiceTasks() {
  const today = cairoToday();
  const { user } = useAuth();
  // تقرير أخطاء التسجيل للمدير العام والتنفيذي بس؛ الداتابيز بترفض أي حد تاني كمان.
  const isTopManager = ['general_manager', 'executive_manager'].includes(normalizeRole(user?.role));
  const [settings, setSettings] = useState<TaskSettings | null>(null);
  const [loadError, setLoadError] = useState('');
  // التبويب في الرابط (?tab=competition) عشان «المسابقة» في القايمة الجانبية تفتح عليه على طول.
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: PageTab = PAGE_TABS.includes(searchParams.get('tab') as PageTab)
    ? (searchParams.get('tab') as PageTab)
    : 'mine';
  const setTab = (next: PageTab) =>
    setSearchParams(next === 'mine' ? {} : { tab: next }, { replace: true });

  const reloadSettings = useCallback(async () => {
    try {
      setLoadError('');
      setSettings(await loadTaskSettings());
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    void reloadSettings();
  }, [reloadSettings]);

  if (loadError)
    return (
      <div className="p-4">
        <LoadError message={loadError} onRetry={() => void reloadSettings()} />
      </div>
    );
  if (!settings)
    return (
      <div className="flex justify-center p-10">
        <Loader2 className="animate-spin" />
      </div>
    );

  return (
    <div className="space-y-4 p-4" dir="rtl">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-black">مهام خدمة العملاء اليومية</h1>
        <div className="mr-auto flex flex-wrap gap-2">
          <button
            className={tab === 'files' ? 'btn-primary' : 'btn-secondary'}
            onClick={() => setTab('files')}
          >
            ملفات الصبح
          </button>
          <button
            className={tab === 'mine' ? 'btn-primary' : 'btn-secondary'}
            onClick={() => setTab('mine')}
          >
            الشيت
          </button>
          <button
            className={tab === 'purchases' ? 'btn-primary' : 'btn-secondary'}
            onClick={() => setTab('purchases')}
          >
            فواتير امبارح
          </button>
          <button
            className={tab === 'transfers' ? 'btn-primary' : 'btn-secondary'}
            onClick={() => setTab('transfers')}
          >
            التحويلات
          </button>
          <button
            className={tab === 'groups' ? 'btn-primary' : 'btn-secondary'}
            onClick={() => setTab('groups')}
          >
            الجروبات
          </button>
          {isTopManager ? (
            <button
              className={tab === 'errors' ? 'btn-primary' : 'btn-secondary'}
              onClick={() => setTab('errors')}
            >
              أخطاء التسجيل
            </button>
          ) : null}
          {settings.can_manage ? (
            <button
              className={tab === 'team' ? 'btn-primary' : 'btn-secondary'}
              onClick={() => setTab('team')}
            >
              الفريق والمتابعة
            </button>
          ) : null}
          <button
            className={tab === 'competition' ? 'btn-primary' : 'btn-secondary'}
            onClick={() => setTab('competition')}
          >
            المسابقة والكريديت
          </button>
        </div>
      </div>
      {tab === 'competition' ? (
        <CsCompetitionTab />
      ) : tab === 'files' ? (
        <MorningFilesTab today={today} />
      ) : tab === 'purchases' ? (
        <MorningPurchasesTab />
      ) : tab === 'transfers' ? (
        <MorningTransfersTab />
      ) : tab === 'groups' ? (
        <GroupsTab />
      ) : tab === 'errors' && isTopManager ? (
        <DoctorEntryErrorsTab today={today} />
      ) : tab === 'team' && settings.can_manage ? (
        <TeamTab today={today} settings={settings} onSaved={reloadSettings} />
      ) : (
        <SheetTab today={today} settings={settings} />
      )}
    </div>
  );
}

function otherBranch(branch: string | null | undefined): string | null {
  if (branch === 'فرع شكري') return 'فرع الشامي';
  if (branch === 'فرع الشامي') return 'فرع شكري';
  return null;
}

function SheetTab({ today, settings }: { today: string; settings: TaskSettings }) {
  const members = settings.members.filter((m) => m.staff_account_id);
  const isMember = members.some((m) => m.staff_account_id === settings.me);
  const [who, setWho] = useState<string>(isMember || !settings.can_manage ? settings.me : 'all');
  const [tasks, setTasks] = useState<DailyTask[] | null>(null);
  const [busy, setBusy] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const all = who === 'all';
  const whoName = all
    ? 'الفريق كله'
    : (members.find((m) => m.staff_account_id === who)?.name ?? 'أنا');

  const refresh = useCallback(async () => {
    try {
      setTasks(await listTasks(today, all ? { all: true } : { staffAccountId: who }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      setTasks([]);
    }
  }, [today, who, all]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const counts = useMemo(() => {
    const out: Record<string, { n: number; done: number }> = {};
    for (const t of tasks ?? []) {
      const c = (out[t.source] ??= { n: 0, done: 0 });
      c.n += 1;
      if (t.result) c.done += 1;
    }
    return out;
  }, [tasks]);
  const doneCount = (tasks ?? []).filter((t) => t.result).length;

  async function build() {
    setBusy('build');
    try {
      const r = await buildTodayTasks();
      // العملاء اللي اتكتبوا في ملاحظات فواتير امبارح من غير كود (أغلبهم الشامي) بيدخلوا الشيت بعد البناء.
      const uncoded = await buildUncodedNoteTasks().catch((e) => {
        toast.warning(e instanceof Error ? e.message : String(e));
        return null;
      });
      if (uncoded) {
        const parts = [
          uncoded.added ? `${uncoded.added} عميل مش متكود من ملاحظات الفواتير` : '',
          uncoded.carried ? `${uncoded.carried} عميل جديد لسه ناقصه خطوة من امبارح` : '',
          uncoded.dropped ? `${uncoded.dropped} اتشالوا عشان اترحب بيهم قبل كده` : '',
        ].filter(Boolean);
        if (parts.length) toast.success(parts.join(' · '));
      }
      const added = Object.values(r.counts ?? {}).reduce((s, n) => s + Number(n || 0), 0);
      if (!r.yesterday_invoices)
        toast.warning('فواتير امبارح لسه مترفعتش، اتجهز اللي ينفع بس. جرّب تاني بعد رفع المبيعات.');
      toast.success(added ? `اتضاف ${added} مهمة لنهارده` : 'مهام النهارده متجهزة خلاص، مفيش جديد');
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  }

  async function download() {
    if (!tasks?.length) {
      toast.error('مفيش مهام للنهارده لسه. دوس «جهّز مهام النهارده» الأول.');
      return;
    }
    setBusy('download');
    try {
      const onboarding = await loadOnboarding(
        today,
        all ? { all: true } : { staffAccountId: who }
      ).catch((e) => {
        toast.warning(`شيت العملاء الجداد ماتحملش: ${e instanceof Error ? e.message : String(e)}`);
        return [];
      });
      const blob = await buildTaskWorkbook(tasks, today, whoName, onboarding);
      downloadBlob(blob, `مهام خدمة العملاء - ${whoName} - ${today}.xlsx`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  }

  async function pickFile(file: File | undefined) {
    if (!file) return;
    setBusy('read');
    try {
      const parsed = await readTaskWorkbook(await file.arrayBuffer(), today);
      setPending({ ...parsed, fileName: file.name });
    } catch (e) {
      toast.error(`الملف ده مش مقروء: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy('');
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function confirmUpload() {
    if (!pending) return;
    setBusy('submit');
    try {
      if (pending.onboarding.length) {
        const o = await submitOnboarding(pending.onboarding);
        toast.success(
          `العملاء الجداد: ${o.done} خلصوا${o.partial ? ` و${o.partial} ناقصهم خطوة وهيرجعوا بكرة` : ''}`
        );
        // تنبيه الكود اللي طلع لعميل تاني بيفضل ظاهر لحد ما تقفله، عشان يتصلح على بي كونكت.
        for (const w of o.warnings ?? [])
          toast.warning(`${w.name ? `${w.name}: ` : ''}${w.why}`, { duration: Infinity });
        if (o.skipped?.length)
          toast.warning(
            `${o.skipped.length} عميل جديد اتساب: ${o.skipped
              .slice(0, 3)
              .map((s) => `${s.name ? `${s.name} ` : ''}(${s.why})`)
              .join('، ')}`
          );
      }
      if (pending.updates.length || pending.cases.length) {
        const r = await submitSheet(pending.updates, pending.cases);
        toast.success(
          `اتسجل ${r.updated} نتيجة و${r.added} حالة دكتور${r.coupons ? ` و${r.coupons} كوبون (اعمله على كود العميل في برنامج البيع)` : ''}`
        );
        if (r.skipped?.length)
          toast.warning(
            `${r.skipped.length} صف اتساب: ${r.skipped
              .slice(0, 3)
              .map((s) => s.why)
              .join('، ')}`
          );
      }
      setPending(null);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="space-y-4">
      {who === settings.me ? <MorningChecklist tasks={tasks} /> : null}
      <Panel>
        <SectionTitle
          icon={<FileSpreadsheet size={18} />}
          title={`شيت ${today}`}
          subtitle="الصبح: جهّز وحمّل · آخر اليوم: ارفع الشيت بعد ما تكتب النتايج"
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {settings.can_manage ? (
            <select
              className="input-field w-auto"
              value={who}
              onChange={(e) => setWho(e.target.value)}
            >
              {!isMember ? null : <option value={settings.me}>مهامي</option>}
              {members
                .filter((m) => m.staff_account_id !== settings.me)
                .map((m) => (
                  <option key={m.staff_account_id} value={m.staff_account_id}>
                    {m.name ?? m.staff_account_id}
                    {m.branch ? ` · ${m.branch}` : ''}
                    {m.on_leave ? ' (إجازة)' : ''}
                  </option>
                ))}
              <option value="all">الفريق كله</option>
            </select>
          ) : null}
          <button
            className="btn-secondary inline-flex items-center gap-1"
            disabled={!!busy}
            onClick={() => void build()}
          >
            {busy === 'build' ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <RefreshCw size={16} />
            )}{' '}
            جهّز مهام النهارده
          </button>
          <button
            className="btn-primary inline-flex items-center gap-1"
            disabled={!!busy}
            onClick={() => void download()}
          >
            {busy === 'download' ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Download size={16} />
            )}{' '}
            حمّل الشيت
          </button>
          <button
            className="btn-secondary inline-flex items-center gap-1"
            disabled={!!busy}
            onClick={() => fileRef.current?.click()}
          >
            {busy === 'read' ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Upload size={16} />
            )}{' '}
            ارفع الشيت بعد الشغل
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(e) => void pickFile(e.target.files?.[0])}
          />
        </div>
        <p className="mt-2 text-xs opacity-70">
          الحد الحالي للاطمئنان بعد الفاتورة:{' '}
          {Number(settings.big_invoice_min).toLocaleString('ar-EG')} ج · أقصى مهام للواحد في اليوم:{' '}
          {settings.daily_cap}. فواتير امبارح بتترفع حوالي الضهر، فلو دوست «جهّز» بدري ممكن تدوس
          تاني بعد الرفع ويزوّد الجديد بس.
        </p>
      </Panel>

      {pending ? (
        <Panel>
          <SectionTitle title={`مراجعة قبل الرفع: ${pending.fileName}`} />
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MiniBox
              label="عملاء جداد اتشغل عليهم"
              value={String(pending.onboarding.length)}
              tone="green"
            />
            <MiniBox label="نتايج مكالمات" value={String(pending.updates.length)} tone="green" />
            <MiniBox label="حالات دكاترة" value={String(pending.cases.length)} tone="blue" />
            <MiniBox
              label="ملاحظات على الشيت"
              value={String(pending.problems.length)}
              tone={pending.problems.length ? 'amber' : 'cyan'}
            />
          </div>
          {pending.problems.length ? (
            <ul className="mt-2 list-disc space-y-1 pr-5 text-sm">
              {pending.problems.slice(0, 20).map((p, i) => (
                <li key={i}>
                  {p.sheet} · صف {p.row}: {p.problem}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mt-3 flex gap-2">
            <button
              className="btn-primary inline-flex items-center gap-1"
              disabled={
                !!busy ||
                (!pending.updates.length && !pending.cases.length && !pending.onboarding.length)
              }
              onClick={() => void confirmUpload()}
            >
              {busy === 'submit' ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Save size={16} />
              )}{' '}
              سجّل
            </button>
            <button className="btn-secondary" disabled={!!busy} onClick={() => setPending(null)}>
              إلغاء
            </button>
          </div>
        </Panel>
      ) : null}

      <Panel>
        <SectionTitle
          title={`مهام ${whoName} النهارده`}
          subtitle={tasks ? `${doneCount} من ${tasks.length} اتعملوا` : undefined}
        />
        {tasks == null ? (
          <div className="flex justify-center p-6">
            <Loader2 className="animate-spin" />
          </div>
        ) : tasks.length === 0 ? (
          <EmptyState label="مفيش مهام لسه. دوس «جهّز مهام النهارده»." />
        ) : (
          <>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(Object.keys(SOURCE_LABELS) as Array<keyof typeof SOURCE_LABELS>)
                .filter((s) => counts[s])
                .map((s) => (
                  <MiniBox
                    key={s}
                    label={SOURCE_LABELS[s]}
                    value={`${counts[s].done} / ${counts[s].n}`}
                    tone={counts[s].done === counts[s].n ? 'green' : 'cyan'}
                  />
                ))}
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-right opacity-70">
                    <th className="p-2">النوع</th>
                    <th className="p-2">الفرع</th>
                    <th className="p-2">العميل</th>
                    <th className="p-2">السبب</th>
                    {all ? <th className="p-2">مع</th> : null}
                    <th className="p-2">النتيجة</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.slice(0, 200).map((t) => (
                    <tr key={t.id} className="border-t border-[var(--dawaa-theme-border)]">
                      <td className="p-2 whitespace-nowrap">{sourceLabel(t.source)}</td>
                      <td className="p-2 whitespace-nowrap">{t.branch.replace('فرع ', '')}</td>
                      <td className="p-2">
                        {t.customer_name}
                        <span className="block text-xs opacity-60">
                          {t.customer_code} · {t.customer_phone ?? 'من غير رقم'}
                        </span>
                      </td>
                      <td className="p-2 text-xs">{t.reason}</td>
                      {all ? (
                        <td className="p-2 whitespace-nowrap text-xs">{t.assigned_name ?? '—'}</td>
                      ) : null}
                      <td className="p-2 whitespace-nowrap text-xs">{t.result_label ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Panel>

      <Panel>
        <SectionTitle
          title="آخر حاجة في اليوم: تصدير المحادثات"
          subtitle="صدّر محادثات واتساب الفرع وارفعها على العقل المدبر"
        />
        <Link to="/reviews" className="btn-secondary mt-2 inline-block">
          افتح صفحة تقييم المحادثات
        </Link>
      </Panel>
    </div>
  );
}

function TeamTab({
  today,
  settings,
  onSaved,
}: {
  today: string;
  settings: TaskSettings;
  onSaved: () => Promise<void>;
}) {
  const [minInvoice, setMinInvoice] = useState(String(settings.big_invoice_min));
  const [cap, setCap] = useState(String(settings.daily_cap));
  const [members, setMembers] = useState<TaskMember[]>(settings.members);
  const [adding, setAdding] = useState('');
  const [saving, setSaving] = useState(false);
  const [from, setFrom] = useState(cycleStart(today));
  const [overview, setOverview] = useState<Overview | null>(null);
  const [overviewError, setOverviewError] = useState('');

  const loadOv = useCallback(async () => {
    try {
      setOverviewError('');
      setOverview(await loadOverview(from, today));
    } catch (e) {
      setOverviewError(e instanceof Error ? e.message : String(e));
    }
  }, [from, today]);
  useEffect(() => {
    void loadOv();
  }, [loadOv]);

  const candidates = (settings.candidates ?? []).filter(
    (c) => !members.some((m) => m.staff_account_id === String(c.staff_account_id))
  );

  async function save() {
    const min = Number(minInvoice);
    const capN = Number(cap);
    if (!(min >= 100) || !(capN >= 10 && capN <= 150)) {
      toast.error('الحد لازم ١٠٠ ج أو أكتر، والمهام بين ١٠ و ١٥٠');
      return;
    }
    setSaving(true);
    try {
      await saveTaskSettings(min, Math.round(capN), members);
      toast.success('اتحفظ');
      await onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <Panel>
        <SectionTitle
          icon={<Users size={18} />}
          title="الفريق والإعدادات"
          subtitle="كل واحدة شغالة على فرع الشهر ده، والفروع بتتبدّل أول كل شهر لوحدها"
        />
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            أقل فاتورة للاطمئنان (ج)
            <input
              className="input-field mt-1"
              type="number"
              min={100}
              step={50}
              value={minInvoice}
              onChange={(e) => setMinInvoice(e.target.value)}
            />
          </label>
          <label className="text-sm">
            أقصى مهام للواحد في اليوم
            <input
              className="input-field mt-1"
              type="number"
              min={10}
              max={150}
              value={cap}
              onChange={(e) => setCap(e.target.value)}
            />
          </label>
        </div>
        <div className="mt-3 space-y-2">
          {members.map((m) => (
            <div
              key={m.staff_account_id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--dawaa-theme-border)] p-2 text-sm"
            >
              <span className="font-bold">{m.name ?? m.staff_account_id}</span>
              {m.has_permission === false ? (
                <span className="rounded px-2 text-xs bg-[var(--dawaa-status-warning-bg)] text-[var(--dawaa-status-warning-text)]">
                  مش معاه صلاحية الصفحة — افتحها من{' '}
                  <Link to="/roles-permissions" className="underline">
                    صلاحيات الحسابات
                  </Link>
                </span>
              ) : null}
              <label className="inline-flex items-center gap-1">
                فرع الشهر ده
                <select
                  className="input-field w-auto py-1"
                  value={m.branch ?? ''}
                  onChange={(e) =>
                    setMembers(
                      members.map((x) =>
                        x === m ? { ...x, branch: e.target.value || null, next_month_branch: otherBranch(e.target.value) } : x
                      )
                    )
                  }
                >
                  <option value="">الفرعين (بتساعد)</option>
                  <option value="فرع شكري">فرع شكري</option>
                  <option value="فرع الشامي">فرع الشامي</option>
                </select>
              </label>
              {m.branch ? (
                <span className="text-xs opacity-70">الشهر الجاي: {otherBranch(m.branch)}</span>
              ) : null}
              <label className="mr-auto inline-flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={m.on_leave}
                  onChange={(e) =>
                    setMembers(
                      members.map((x) => (x === m ? { ...x, on_leave: e.target.checked } : x))
                    )
                  }
                />{' '}
                إجازة
              </label>
              <button
                className="text-xs text-[var(--dawaa-status-danger-text)]"
                onClick={() => setMembers(members.filter((x) => x !== m))}
              >
                شيل من الفريق
              </button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <select
              className="input-field w-auto"
              value={adding}
              onChange={(e) => setAdding(e.target.value)}
            >
              <option value="">ضيف حد للفريق…</option>
              {candidates.map((c) => (
                <option key={c.staff_account_id} value={String(c.staff_account_id)}>
                  {c.name}
                  {c.branch ? ` · ${c.branch}` : ''}
                </option>
              ))}
            </select>
            <button
              className="btn-secondary"
              disabled={!adding}
              onClick={() => {
                const c = candidates.find((x) => String(x.staff_account_id) === adding);
                if (c)
                  setMembers([
                    ...members,
                    { staff_account_id: String(c.staff_account_id), name: c.name, on_leave: false },
                  ]);
                setAdding('');
              }}
            >
              ضيف
            </button>
          </div>
          <p className="text-xs opacity-70">
            كل فرع بياخد مهامه للي شغالين عليه. لو فرع مالوش حد النهارده (إجازة)، الموجودين بيتقسم عليهم
            الفرعين لحد ما ترجع. اللي بتضيفه هنا بياخد مهام. عشان يفتح الصفحة لازم يكون معاه «مهام خدمة العملاء اليومية»
            من{' '}
            <Link to="/roles-permissions" className="underline">
              صلاحيات الحسابات
            </Link>
            ، و«إدارة مهام خدمة العملاء» لو هيشوف الفريق كله.
          </p>
        </div>
        <button
          className="btn-primary mt-3 inline-flex items-center gap-1"
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} احفظ
        </button>
      </Panel>

      <Panel>
        <div className="flex flex-wrap items-center gap-2">
          <SectionTitle title="الشغل اتعمل إزاي" subtitle={`من ${from} لحد النهارده`} />
          <input
            className="input-field mr-auto w-auto"
            type="date"
            value={from}
            max={today}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        {overviewError ? (
          <LoadError message={overviewError} onRetry={() => void loadOv()} />
        ) : !overview ? (
          <div className="flex justify-center p-6">
            <Loader2 className="animate-spin" />
          </div>
        ) : (
          <div className="mt-3 space-y-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-right opacity-70">
                    <th className="p-2">الاسم</th>
                    <th className="p-2">مهام</th>
                    <th className="p-2">اتعملت</th>
                    <th className="p-2">رد</th>
                    <th className="p-2">مردش</th>
                    <th className="p-2">هيشتري / أوردر</th>
                    <th className="p-2">شكاوى</th>
                    <th className="p-2">اشترى خلال أسبوع</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.members.map((m) => (
                    <tr
                      key={m.staff_account_id ?? m.name}
                      className="border-t border-[var(--dawaa-theme-border)]"
                    >
                      <td className="p-2 font-bold">{m.name}</td>
                      <td className="p-2">{m.tasks}</td>
                      <td className="p-2">
                        {m.done} {m.tasks ? `(${Math.round((m.done / m.tasks) * 100)}%)` : ''}
                      </td>
                      <td className="p-2">
                        {m.reached ?? 0}{' '}
                        {m.done ? `(${Math.round(((m.reached ?? 0) / m.done) * 100)}%)` : ''}
                      </td>
                      <td className="p-2">{m.no_answer}</td>
                      <td className="p-2">{m.will_buy ?? 0}</td>
                      <td className="p-2">{m.complaints}</td>
                      <td className="p-2">{m.bought_after}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {overview.by_source.map((s) => (
                <MiniBox
                  key={s.source}
                  label={sourceLabel(s.source)}
                  value={`${s.done} / ${s.tasks}${s.reached != null ? ` · رد ${s.reached}` : ''}`}
                />
              ))}
            </div>
            {overview.outcomes?.length || overview.reasons?.length ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="mb-1 font-bold">العملا قالوا إيه</div>
                  {(overview.outcomes ?? []).map((o) => (
                    <div key={o.outcome} className="flex justify-between text-sm">
                      <span>{choiceLabel(OUTCOME_CHOICES, o.outcome) ?? o.outcome}</span>
                      <b>{o.n}</b>
                    </div>
                  ))}
                </div>
                <div>
                  <div className="mb-1 font-bold">الأسباب (حسب نوع المكالمة)</div>
                  {(overview.reasons ?? []).map((x) => (
                    <div key={`${x.reason_code}-${x.source}`} className="flex justify-between text-sm">
                      <span>
                        {choiceLabel(REASON_CHOICES, x.reason_code) ?? x.reason_code} ·{' '}
                        <span className="opacity-70">{sourceLabel(x.source)}</span>
                      </span>
                      <b>{x.n}</b>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {overview.complaints.length ? (
              <div>
                <div className="mb-1 font-bold">الشكاوى</div>
                <ul className="space-y-1 text-sm">
                  {overview.complaints.map((c, i) => (
                    <li key={i}>
                      {c.queue_date} · {c.branch.replace('فرع ', '')} · {c.customer_name} (
                      {c.customer_code}) — {choiceLabel(REASON_CHOICES, c.reason_code) ?? ''}{' '}
                      {c.result_note ?? (c.reason_code ? '' : 'من غير ملاحظة')} · {c.by_name}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <div className="mb-1 font-bold">المتابعات الجاية (٧ أيام)</div>
                {overview.upcoming.length ? (
                  overview.upcoming.map((u) => (
                    <div key={u.day} className="text-sm">
                      {u.day}: {u.n}
                    </div>
                  ))
                ) : (
                  <div className="text-sm opacity-60">مفيش</div>
                )}
              </div>
              <div>
                <div className="mb-1 font-bold">تصدير المحادثات (آخر ٧ أيام)</div>
                {overview.chat_exports.length ? (
                  overview.chat_exports.map((c) => (
                    <div key={`${c.day}-${c.branch}`} className="text-sm">
                      {c.day} · {c.branch}: {c.n}
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-[var(--dawaa-status-warning-text)]">
                    مفيش أي تصدير اترفع
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
