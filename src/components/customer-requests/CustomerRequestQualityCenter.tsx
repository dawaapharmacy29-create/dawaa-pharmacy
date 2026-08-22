import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronLeft, Loader2, RefreshCw, Search, ShieldAlert, UserRound, PackageSearch, Flame } from 'lucide-react';
import { toast } from 'sonner';
import type { CustomerRequest } from '@/lib/api/customerRequests';
import CustomerRequestBulkRepairPanel from '@/components/customer-requests/CustomerRequestBulkRepairPanel';
import CustomerRequestSourceAuditPanel from '@/components/customer-requests/CustomerRequestSourceAuditPanel';
import CustomerRequestProcurementExportPanel from '@/components/customer-requests/CustomerRequestProcurementExportPanel';
import CustomerRequestProductIntelligencePanel from '@/components/customer-requests/CustomerRequestProductIntelligencePanel';
import {
  getCustomerRequestQualityCenter,
  qualityIssueLabel,
  qualityPriorityLabel,
  type QualityCenterRow,
  type QualityIssueKey,
  type QualityIssueType,
  type QualityPriorityBand,
  type QualitySortMode,
} from '@/lib/api/customerRequestQualityCenter';

const ISSUE_TABS: Array<{ id: QualityIssueType; label: string }> = [
  { id: 'all', label: 'كل المشاكل' },
  { id: 'customer_link', label: 'ربط العميل' },
  { id: 'customer_code', label: 'كود العميل' },
  { id: 'phone', label: 'الهاتف' },
  { id: 'branch', label: 'الفرع' },
  { id: 'product_link', label: 'ربط الصنف' },
  { id: 'product_code', label: 'كود الصنف' },
  { id: 'sync_conflict', label: 'المزامنة' },
];

const PRIORITY_TABS: Array<{ id: QualityPriorityBand | 'all'; label: string }> = [
  { id: 'all', label: 'كل الأولويات' },
  { id: 'critical', label: 'حرج' },
  { id: 'high', label: 'عالي' },
  { id: 'medium', label: 'متوسط' },
  { id: 'low', label: 'منخفض' },
];

export default function CustomerRequestQualityCenter({
  branch,
  onOpenRequest,
}: {
  branch: string;
  onOpenRequest: (request: CustomerRequest) => void;
}) {
  const [issue, setIssue] = useState<QualityIssueType>('all');
  const [priority, setPriority] = useState<QualityPriorityBand | 'all'>('all');
  const [sort, setSort] = useState<QualitySortMode>('smart');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<QualityCenterRow[]>([]);
  const [counts, setCounts] = useState<Record<QualityIssueType, number>>({
    all: 0,
    customer_link: 0,
    customer_code: 0,
    phone: 0,
    branch: 0,
    product_link: 0,
    product_code: 0,
    sync_conflict: 0,
  });
  const [priorityCounts, setPriorityCounts] = useState<Record<QualityPriorityBand, number>>({ critical: 0, high: 0, medium: 0, low: 0 });

  const load = async () => {
    setLoading(true);
    try {
      const data = await getCustomerRequestQualityCenter({ branch, issue, search, limit: 400, priority, sort });
      setRows(data.rows);
      setCounts(data.counts);
      setPriorityCounts(data.priorityCounts);
    } catch (error) {
      toast.error(`تعذر تحميل مشاكل بيانات الطلبات: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), search ? 250 : 20);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branch, issue, priority, sort, search]);

  const customerProblems = counts.customer_link + counts.customer_code + counts.phone + counts.branch;
  const productProblems = counts.product_link + counts.product_code;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard icon={<ShieldAlert size={18} />} label="طلبات تحتاج مراجعة" value={counts.all} tone="amber" />
        <SummaryCard icon={<Flame size={18} />} label="حرج — ابدأ بها" value={priorityCounts.critical} tone="red" />
        <SummaryCard icon={<UserRound size={18} />} label="مشاكل بيانات العميل" value={customerProblems} tone="cyan" />
        <SummaryCard icon={<PackageSearch size={18} />} label="مشاكل ربط الأصناف" value={productProblems} tone="violet" />
      </div>

      <CustomerRequestSourceAuditPanel branch={branch} />
      <CustomerRequestProcurementExportPanel branch={branch} />
      <CustomerRequestProductIntelligencePanel branch={branch} onChanged={() => void load()} />

      {!loading && rows.length > 0 && <CustomerRequestBulkRepairPanel rows={rows} onChanged={() => void load()} />}

      <div className="rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] p-3">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--dawaa-theme-muted)]" />
            <input
              className="input-dark h-10 w-full pr-9 text-sm"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="ابحث بالعميل، الكود، الهاتف، الصنف أو كود الصنف..."
            />
          </div>
          <select className="input-dark h-10 min-w-44 text-xs font-black" value={sort} onChange={(event) => setSort(event.target.value as QualitySortMode)}>
            <option value="smart">الأولوية الذكية</option>
            <option value="newest">الأحدث أولًا</option>
            <option value="issues">الأكثر مشاكل أولًا</option>
          </select>
          <button type="button" onClick={() => void load()} className="h-10 rounded-xl border border-[var(--dawaa-theme-border)] px-3 text-xs font-black text-[var(--dawaa-theme-text)] hover:bg-[var(--dawaa-theme-surface)]">
            <span className="inline-flex items-center gap-2"><RefreshCw size={14} /> تحديث الفحص</span>
          </button>
        </div>

        <div className="mt-3 border-t border-[var(--dawaa-theme-border)] pt-3">
          <div className="text-[10px] font-black text-[var(--dawaa-theme-muted)]">الأولوية التشغيلية</div>
          <div className="mt-2 overflow-x-auto">
            <div className="flex min-w-max gap-1.5">
              {PRIORITY_TABS.map((tab) => {
                const count = tab.id === 'all' ? counts.all : priorityCounts[tab.id];
                return <button key={tab.id} type="button" onClick={() => setPriority(tab.id)} className={`h-9 rounded-xl px-3 text-[11px] font-black transition ${priority === tab.id ? 'bg-[var(--dawaa-status-danger-bg)] text-[var(--dawaa-status-danger-text)] ring-1 ring-[var(--dawaa-status-danger-border)]' : 'text-[var(--dawaa-theme-muted)] hover:bg-[var(--dawaa-theme-surface)] hover:text-[var(--dawaa-theme-heading)]'}`}>{tab.label}<span className="mr-2 rounded-full bg-[var(--dawaa-theme-surface)] px-1.5 py-0.5 text-[10px]">{count.toLocaleString('ar-EG')}</span></button>;
              })}
            </div>
          </div>
        </div>

        <div className="mt-3 overflow-x-auto border-t border-[var(--dawaa-theme-border)] pt-3">
          <div className="text-[10px] font-black text-[var(--dawaa-theme-muted)]">نوع مشكلة البيانات</div>
          <div className="mt-2 flex min-w-max gap-1.5">
            {ISSUE_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setIssue(tab.id)}
                className={`h-10 rounded-xl px-3 text-xs font-black transition ${issue === tab.id ? 'bg-[var(--dawaa-status-warning-bg)] text-[var(--dawaa-status-warning-text)] ring-1 ring-[var(--dawaa-status-warning-border)]' : 'text-[var(--dawaa-theme-muted)] hover:bg-[var(--dawaa-theme-surface)] hover:text-[var(--dawaa-theme-heading)]'}`}
              >
                {tab.label}
                <span className="mr-2 rounded-full bg-[var(--dawaa-theme-surface)] px-1.5 py-0.5 text-[10px]">{counts[tab.id].toLocaleString('ar-EG')}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex min-h-52 items-center justify-center rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)]"><Loader2 className="animate-spin text-[var(--dawaa-theme-primary)]" /></div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)]/[0.06] p-8 text-center">
          <CheckCircle2 className="mx-auto text-[var(--dawaa-status-success-text)]" size={34} />
          <div className="mt-3 font-black text-[var(--dawaa-status-success-text)]">لا توجد مشاكل في هذا الفلتر</div>
          <div className="mt-1 text-xs text-[var(--dawaa-theme-muted)]">جرّب أولوية أو نوع مشكلة آخر أو غيّر البحث.</div>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map(({ request, issues, priorityScore, priorityBand, priorityReasons }) => (
            <button
              key={request.id}
              type="button"
              onClick={() => onOpenRequest(request)}
              className={`w-full rounded-2xl border p-3 text-right transition ${priorityBand === 'critical' ? 'border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)]/[0.055] hover:border-[var(--dawaa-status-danger-border)]' : priorityBand === 'high' ? 'border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)]/[0.04] hover:border-[var(--dawaa-status-warning-border)]' : 'border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] hover:border-[var(--dawaa-status-warning-border)] hover:bg-[var(--dawaa-status-warning-bg)]/[0.05]'}`}
            >
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <PriorityBadge band={priorityBand} score={priorityScore} />
                    <span className="font-black text-[var(--dawaa-theme-heading)]">{request.medicine_name || 'صنف غير محدد'}</span>
                    <span className="text-xs font-bold text-[var(--dawaa-theme-muted)]">#{request.product_code || 'بدون كود'}</span>
                  </div>
                  <div className="mt-1 text-xs text-[var(--dawaa-theme-muted)]">{request.customer_name || 'عميل غير محدد'} · كود {request.customer_code || '—'} · {request.customer_phone || 'بدون هاتف'} · {request.branch || 'بدون فرع'}</div>
                  {!!priorityReasons.length && <div className="mt-2 text-[10px] font-black text-[var(--dawaa-status-danger-text)]">سبب الأولوية: {priorityReasons.join(' · ')}</div>}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {issues.map((problem) => <IssuePill key={problem} issue={problem} />)}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2 text-xs font-black text-[var(--dawaa-theme-primary)]">
                  مراجعة وإصلاح <ChevronLeft size={16} />
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PriorityBadge({ band, score }: { band: QualityPriorityBand; score: number }) {
  const styles: Record<QualityPriorityBand, string> = {
    critical: 'border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] text-[var(--dawaa-status-danger-text)]',
    high: 'border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] text-[var(--dawaa-status-warning-text)]',
    medium: 'border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] text-[var(--dawaa-status-warning-text)]',
    low: 'border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] text-[var(--dawaa-theme-text)]',
  };
  return <span className={`rounded-lg border px-2 py-1 text-[10px] font-black ${styles[band]}`}>{qualityPriorityLabel(band)} · {score}</span>;
}

function IssuePill({ issue }: { issue: QualityIssueKey }) {
  return <span className="inline-flex items-center gap-1 rounded-lg border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] px-2 py-1 text-[10px] font-black text-[var(--dawaa-status-warning-text)]"><AlertTriangle size={10} />{qualityIssueLabel(issue)}</span>;
}

function SummaryCard({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: 'amber' | 'red' | 'cyan' | 'violet' }) {
  const tones = {
    amber: 'border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)]/[0.07] text-[var(--dawaa-status-warning-text)]',
    red: 'border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)]/[0.07] text-[var(--dawaa-status-danger-text)]',
    cyan: 'border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-primary)]/[0.07] text-[var(--dawaa-theme-primary)]',
    violet: 'border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)]/[0.07] text-[var(--dawaa-status-info-text)]',
  };
  return <div className={`rounded-2xl border p-4 ${tones[tone]}`}><div className="flex items-center gap-2 text-xs font-black">{icon}{label}</div><div className="mt-2 text-3xl font-black">{value.toLocaleString('ar-EG')}</div></div>;
}
