import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Circle, FolderUp, Loader2, RefreshCw, Upload } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Panel, SectionTitle } from '@/components/dashboard/DashboardPrimitives';
import { SalesInvoiceItemsImport } from '@/components/invoices/SalesInvoiceItemsImport';
import { useAuth } from '@/hooks/useAuth';
import { BRANCHES } from '@/lib/constants';
import {
  importCustomersToDB,
  importInvoicesToDB,
  parseCustomerFile,
  parseInvoiceFile,
  type CustomerParseResult,
  type ParseResult,
} from '@/lib/invoiceImporter';
import { importPurchaseReport, readEPlusFile } from '@/lib/purchaseReview/api';
import { fillSupplierCodes } from '@/lib/purchaseReview/ePlusReport';
import { normalizeName } from '@/lib/purchaseReview/ledger';
import { GroupUpload } from '@/components/customerService/GroupsTab';
import { loadGroupUploads, type GroupUploads } from '@/lib/customerServiceTasks/groups';
import {
  PURCHASE_STORES,
  cairoDay,
  dayOnlyLabel,
  freshness,
  loadMorningUploads,
  loadPurchaseSuppliers,
  timeLabel,
  type FileKind,
  type MorningUploads,
} from '@/lib/customerServiceTasks/morningFiles';

// «ملفات الصبح»: أول حاجة فريق خدمة العملاء بيعملها لما يوصل. نفس دوال الرفع اللي في صفحة الفواتير ومراجعة المشتريات
// (بنفس الحمايات: التكرار والتعارض والفرع)، من غير باقي الصفحتين. الحذف ممنوع على الفريق من الداتابيز.

const money = (v: number) => Math.round(v).toLocaleString('ar-EG');

function Step({
  n,
  title,
  hint,
  fresh,
  status,
  children,
}: {
  n: number;
  title: string;
  hint: string;
  fresh: boolean | null;
  status: string;
  children: React.ReactNode;
}) {
  return (
    <Panel>
      <div className="flex items-start gap-3">
        <span
          className={fresh ? 'text-[var(--dawaa-status-success-text)]' : 'opacity-50'}
          aria-hidden
        >
          {fresh ? <CheckCircle2 size={24} /> : <Circle size={24} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-base font-black">
            {n}. {title}
          </div>
          <div className="text-xs opacity-70">{hint}</div>
          <div className="mt-1 text-xs font-bold">{status}</div>
        </div>
      </div>
      <div className="mt-3">{children}</div>
    </Panel>
  );
}

function FileButton({
  label,
  busy,
  multiple,
  onFiles,
}: {
  label: string;
  busy: boolean;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        className="btn-primary inline-flex items-center gap-1"
        disabled={busy}
        onClick={() => ref.current?.click()}
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />} {label}
      </button>
      <input
        ref={ref}
        type="file"
        accept=".xlsx,.xls,.csv"
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (ref.current) ref.current.value = '';
          if (files.length) onFiles(files);
        }}
      />
    </>
  );
}

export default function MorningFilesTab({ today }: { today: string }) {
  const { user } = useAuth();
  const [uploads, setUploads] = useState<MorningUploads | null>(null);
  const [error, setError] = useState('');
  const [groups, setGroups] = useState<GroupUploads | null>(null);

  const load = useCallback(async () => {
    try {
      setError('');
      const [u, g] = await Promise.all([
        loadMorningUploads(),
        loadGroupUploads().catch(() => null),
      ]);
      setUploads(u);
      setGroups(g);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const fresh: Record<FileKind, boolean> | null = uploads ? freshness(uploads, today) : null;
  const groupFresh = {
    followups: !!groups && cairoDay(groups.followups.at) === today,
    requests: !!groups && cairoDay(groups.requests.at) === today,
  };
  const done = fresh
    ? Object.values(fresh).filter(Boolean).length + Object.values(groupFresh).filter(Boolean).length
    : 0;
  const groupLine = (g: GroupUploads['followups'] | undefined) =>
    g
      ? `آخر رفع ${timeLabel(g.at, today)} · آخر رسالة فيه ${timeLabel(g.last_message, today)}`
      : '…';
  const branchLine = (rows: MorningUploads['sales']) =>
    BRANCHES.map((b) => {
      const r = rows.find((x) => x.branch === b);
      return `${b.replace('فرع ', '')}: آخر يوم فيه فواتير ${dayOnlyLabel(r?.last_invoice_at, today)}`;
    }).join(' · ');

  return (
    <div className="space-y-4">
      <Panel>
        <SectionTitle
          icon={<FolderUp size={18} />}
          title="ملفات الصبح"
          subtitle="أول ما توصلي ارفعي الملفات بالترتيب، وبعدين ارجعي للشيت ودوسي «جهّز مهام النهارده»"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-black">
            {fresh ? `${done} من 6 جاهزين` : <Loader2 size={16} className="animate-spin" />}
          </span>
          <button
            className="btn-secondary inline-flex items-center gap-1"
            onClick={() => void load()}
          >
            <RefreshCw size={16} /> تحديث
          </button>
        </div>
        {error ? (
          <p className="mt-2 text-xs text-[var(--dawaa-status-danger-text)]">{error}</p>
        ) : null}
        <p className="mt-2 text-xs opacity-70">
          الملفات دي من بي كونكت وإي بلس زي ما هي. الرفع بيكمّل على اللي موجود ومابيمسحش حاجة، ولو
          ملف اترفع مرتين الفواتير المكررة بتتساب لوحدها.
        </p>
      </Panel>

      <Step
        n={1}
        title="ملف المبيعات (فواتير امبارح)"
        hint="ملف المبيعات اليومي لكل فرع. من غيره مفيش عملاء جداد ولا تحويلات ولا مهام امبارح."
        fresh={fresh?.sales ?? null}
        status={uploads ? branchLine(uploads.sales) : '…'}
      >
        <SalesUpload userId={user?.id ?? null} onDone={load} />
      </Step>

      <Step
        n={2}
        title="ملف أصناف المبيعات"
        hint="تفاصيل أصناف الفواتير: بتظهر في شيت العملاء الجداد (اشترى إيه) وفي التحويلات."
        fresh={fresh?.items ?? null}
        status={uploads ? branchLine(uploads.items) : '…'}
      >
        <SalesInvoiceItemsImport branches={BRANCHES} />
        <button className="btn-secondary mt-2 text-xs" onClick={() => void load()}>
          خلصت؟ حدّث الحالة
        </button>
      </Step>

      <Step
        n={3}
        title="ملف العملاء"
        hint="العملاء الجداد اللي اتكودوا امبارح: من غيره العميل الجديد في شكري بيبان من غير رقم، والكود اللي كتبتيه للشامي مابيتأكدش."
        fresh={fresh?.customers ?? null}
        status={
          uploads ? `آخر تحديث للعملاء ${timeLabel(uploads.customers.uploaded_at, today)}` : '…'
        }
      >
        <CustomersUpload onDone={load} />
      </Step>

      <Step
        n={4}
        title="ملفات المشتريات (المخازن الأربعة)"
        hint="تقرير مشتريات إي بلس لكل مخزن. ممكن تختاري الأربع ملفات مرة واحدة."
        fresh={fresh?.purchases ?? null}
        status={
          uploads
            ? PURCHASE_STORES.map(({ store }) => {
                const p = uploads.purchases.find((x) => x.store === store);
                return `${store}: ${timeLabel(p?.uploaded_at, today)}`;
              }).join(' · ')
            : '…'
        }
      >
        <PurchasesUpload onDone={load} />
      </Step>

      <Step
        n={5}
        title="جروب المتابعات (واتساب)"
        hint="صدّري جروب المتابعات من غير وسائط: كل حالة فيها كود أو رقم عميل بتبقى مهمة في شيت النهارده وبتتحسب للدكتور."
        fresh={groups ? groupFresh.followups : null}
        status={groupLine(groups?.followups)}
      >
        <GroupUpload kind="followups" onDone={() => void load()} />
      </Step>

      <Step
        n={6}
        title="جروب طلبات العملاء (واتساب)"
        hint="صدّري جروب الطلبات: كل طلب بيتسجل بأصنافه وكمياته وتتابعيه من «الجروبات»."
        fresh={groups ? groupFresh.requests : null}
        status={groupLine(groups?.requests)}
      >
        <GroupUpload kind="requests" onDone={() => void load()} />
      </Step>
    </div>
  );
}

function SalesUpload({ userId, onDone }: { userId: string | null; onDone: () => Promise<void> }) {
  const [branch, setBranch] = useState<string>(BRANCHES[0]);
  const [parsed, setParsed] = useState<{ file: string; result: ParseResult } | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [summary, setSummary] = useState('');

  async function read(file: File) {
    setBusy(true);
    setSummary('');
    try {
      const result = parseInvoiceFile(await file.arrayBuffer(), file.name, branch);
      if (!result.rows.length) toast.error('الملف ده مفيهوش فواتير مبيعات');
      setParsed({ file: file.name, result });
    } catch (e) {
      toast.error(`الملف ده مش مقروء: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!parsed?.result.rows.length) return;
    setBusy(true);
    setProgress(0);
    try {
      const batch = `import-sales-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}`;
      const s = await importInvoicesToDB(
        parsed.result.rows,
        branch,
        batch,
        (d, t) => setProgress(t ? Math.round((d / t) * 100) : 0),
        {
          fileName: parsed.file,
          importedBy: userId,
          importedAt: new Date().toISOString(),
          parseErrors: parsed.result.errors,
        }
      );
      const confirmed = s.confirmedExistingInvoices ?? s.updatedInvoices ?? 0;
      const mismatch = (s.errors || []).find((e) => e.field === 'الفرع');
      setSummary(
        `${branch}: اتضاف ${s.insertedRows} فاتورة جديدة، و${confirmed} كانت موجودة${
          s.skippedDuplicates ? `، و${s.skippedDuplicates} مكررة اتسابت` : ''
        }${s.needsReviewRows ? `، و${s.needsReviewRows} محتاجة مراجعة الإدارة` : ''}.`
      );
      if (mismatch) toast.error(mismatch.message, { duration: 15000 });
      else toast.success('ملف المبيعات اترفع');
      setParsed(null);
      await onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const rows = parsed?.result.rows ?? [];
  const total = rows.reduce((s, r) => s + Number(r.netAmount ?? r.amount ?? 0), 0);
  const dates = rows
    .map((r) => r.date)
    .filter(Boolean)
    .sort();

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm font-bold">
          الفرع
          <select
            className="input-field mr-1 w-auto"
            value={branch}
            disabled={busy}
            onChange={(e) => {
              setBranch(e.target.value);
              setParsed(null);
            }}
          >
            {BRANCHES.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </label>
        <FileButton
          label="اختاري ملف المبيعات"
          busy={busy && !parsed}
          onFiles={(f) => void read(f[0])}
        />
      </div>
      {parsed ? (
        <div className="rounded-2xl border border-[var(--dawaa-theme-border)] p-3 text-sm">
          <div className="font-black">{parsed.file}</div>
          <div className="mt-1">
            {branch} · {rows.length.toLocaleString('ar-EG')} فاتورة · {money(total)} ج
            {dates.length ? ` · من ${dates[0]} لـ ${dates[dates.length - 1]}` : ''}
            {parsed.result.errors.length ? ` · ${parsed.result.errors.length} صف مش مقروء` : ''}
          </div>
          <div className="mt-2 flex gap-2">
            <button
              className="btn-primary inline-flex items-center gap-1"
              disabled={busy || !rows.length}
              onClick={() => void save()}
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />} ارفعي{' '}
              {busy && progress ? `${progress}%` : ''}
            </button>
            <button className="btn-secondary" disabled={busy} onClick={() => setParsed(null)}>
              إلغاء
            </button>
          </div>
          <p className="mt-1 text-xs opacity-70">
            اتأكدي إن الفرع اللي فوق هو فرع الملف قبل ما ترفعي.
          </p>
        </div>
      ) : null}
      {summary ? <p className="text-sm font-bold">{summary}</p> : null}
    </div>
  );
}

function CustomersUpload({ onDone }: { onDone: () => Promise<void> }) {
  const [parsed, setParsed] = useState<{ file: string; result: CustomerParseResult } | null>(null);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState('');

  async function read(file: File) {
    setBusy(true);
    setSummary('');
    try {
      const result = parseCustomerFile(await file.arrayBuffer(), file.name);
      // لما الملف مايتقريش لازم يبان السبب (عمود ناقص، والأعمدة اللي لقاها) مش «مفيهوش عملاء» وبس.
      if (!result.rows.length) {
        const why = result.errors.map((e) => e.message).join('، ');
        const cols = result.headers.filter((h) => !/^Column \d+$/.test(h)).slice(0, 12);
        toast.error(
          `الملف ده ماطلعش منه عملاء${why ? `: ${why}` : ''}${
            cols.length ? ` · الأعمدة اللي لقيتها: ${cols.join('، ')}` : ''
          }`,
          { duration: 20000 }
        );
      }
      setParsed({ file: file.name, result });
    } catch (e) {
      toast.error(`الملف ده مش مقروء: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!parsed?.result.rows.length) return;
    setBusy(true);
    try {
      const batch = `import-customers-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}`;
      const s = await importCustomersToDB(parsed.result.rows, batch);
      const failed = s.errors?.[0]?.message;
      setSummary(
        `اتضاف ${s.newCustomers} عميل جديد واتحدث ${s.updatedCustomers}${
          s.needsReviewRows ? `، و${s.needsReviewRows} محتاجين مراجعة` : ''
        }.${failed ? ` حصلت مشكلة في ${s.errors.length} جزء: ${failed}` : ''}`
      );
      if (failed && !s.newCustomers && !s.updatedCustomers) toast.error(failed, { duration: 15000 });
      else toast.success('ملف العملاء اترفع');
      setParsed(null);
      await onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <FileButton
        label="اختاري ملف العملاء"
        busy={busy && !parsed}
        onFiles={(f) => void read(f[0])}
      />
      {parsed ? (
        <div className="rounded-2xl border border-[var(--dawaa-theme-border)] p-3 text-sm">
          <div className="font-black">{parsed.file}</div>
          <div className="mt-1">
            {parsed.result.rows.length.toLocaleString('ar-EG')} عميل
            {parsed.result.errors.length ? ` · ${parsed.result.errors.length} صف مش مقروء` : ''}
          </div>
          <div className="mt-2 flex gap-2">
            <button
              className="btn-primary inline-flex items-center gap-1"
              disabled={busy || !parsed.result.rows.length}
              onClick={() => void save()}
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />} ارفعي
            </button>
            <button className="btn-secondary" disabled={busy} onClick={() => setParsed(null)}>
              إلغاء
            </button>
          </div>
        </div>
      ) : null}
      {summary ? <p className="text-sm font-bold">{summary}</p> : null}
    </div>
  );
}

// Keep in step with the morning review RPCs' Cairo 09:00 cutoff and transfer supplier rules.
function purchaseReviewLinks(report: Awaited<ReturnType<typeof readEPlusFile>>) {
  const windows = new Map<string, { tab: string; day: string; count: number }>();
  for (const invoice of report.invoices) {
    const [date, time] = invoice.invoice_at.split('T');
    const end = new Date(`${date}T00:00:00Z`);
    if (time >= '09:00:00') end.setUTCDate(end.getUTCDate() + 1);
    const day = end.toISOString().slice(0, 10);
    const shokry = report.branch === 'فرع شكري';
    const internal = invoice.supplier_code === (shokry ? '475' : '300') ||
      invoice.supplier_name.trim() === (shokry ? 'دواء الشامي' : 'دواء ابو العزم');
    const tab = internal ? 'transfers' : 'purchases';
    const key = `${tab}:${day}`;
    const count = (windows.get(key)?.count ?? 0) + 1;
    windows.set(key, { tab, day, count });
  }
  return Array.from(windows.values()).map(({ tab, day, count }) => ({
    href: `?${new URLSearchParams({ tab, reviewDay: day, reviewBranch: report.branch })}`,
    label: `${tab === 'transfers' ? 'التحويلات' : 'المشتريات'} · ${day} حتى ٩ ص · ${count} فاتورة`,
  }));
}

type PurchaseUploadMessage = {
  ok: boolean;
  text: string;
  links?: ReturnType<typeof purchaseReviewLinks>;
};

function PurchasesUpload({ onDone }: { onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<PurchaseUploadMessage[]>([]);

  async function upload(files: File[]) {
    setBusy(true);
    const out: PurchaseUploadMessage[] = [];
    let suppliers: Array<{ code: string; name: string }> = [];
    try {
      suppliers = await loadPurchaseSuppliers();
    } catch {
      // التقرير اللي فيه أكواد مش محتاج القايمة؛ المجمّع بالمورد هيقول مين ناقص كود.
    }
    for (const file of files) {
      try {
        const { report, unknown } = fillSupplierCodes(
          await readEPlusFile(file),
          suppliers,
          (name) => normalizeName(name, false)
        );
        const r = await importPurchaseReport(report, file.name);
        out.push({
          ok: true,
          links: purchaseReviewLinks(report),
          text: `${report.store}: ${r.invoices} فاتورة لحد ${r.last_day}${
            unknown.length ? ` · مورد جديد من غير كود: ${unknown.join('، ')}` : ''
          }`,
        });
      } catch (e) {
        out.push({
          ok: false,
          text: `${file.name}: ${e instanceof Error ? e.message : String(e)}`,
        });
      }
      setLog([...out]);
    }
    setBusy(false);
    if (out.some((l) => l.ok)) toast.success('ملفات المشتريات اترفعت');
    await onDone();
  }

  return (
    <div className="space-y-2">
      <FileButton
        label="اختاري ملفات المشتريات"
        busy={busy}
        multiple
        onFiles={(f) => void upload(f)}
      />
      {log.length ? (
        <ul className="space-y-1 text-sm">
          {log.map((l, i) => (
            <li key={i} className={l.ok ? '' : 'font-bold text-[var(--dawaa-status-danger-text)]'}>
              {l.ok ? '✔' : '✖'} {l.text}
              {l.links?.length ? (
                <div className="mt-1 flex flex-wrap gap-1">
                  {l.links.map((link) => <Link key={link.href} className="btn-secondary text-xs" to={link.href}>{link.label}</Link>)}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
