import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronLeft, Loader2, RefreshCw, Search, ShieldAlert, UserRound, PackageSearch } from 'lucide-react';
import { toast } from 'sonner';
import type { CustomerRequest } from '@/lib/api/customerRequests';
import {
  getCustomerRequestQualityCenter,
  qualityIssueLabel,
  type QualityIssueKey,
  type QualityIssueType,
  type QualityCenterRequest,
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

export default function CustomerRequestQualityCenter({
  branch,
  onOpenRequest,
}: {
  branch: string;
  onOpenRequest: (request: CustomerRequest) => void;
}) {
  const [issue, setIssue] = useState<QualityIssueType>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Array<{ request: QualityCenterRequest; issues: QualityIssueKey[] }>>([]);
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

  const load = async () => {
    setLoading(true);
    try {
      const data = await getCustomerRequestQualityCenter({ branch, issue, search, limit: 400 });
      setRows(data.rows);
      setCounts(data.counts);
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
  }, [branch, issue, search]);

  const customerProblems = counts.customer_link + counts.customer_code + counts.phone + counts.branch;
  const productProblems = counts.product_link + counts.product_code;
  const cleanPercent = useMemo(() => {
    const base = Math.max(counts.all, 1);
    return Math.max(0, Math.round((1 - Math.min(counts.all, base) / base) * 100));
  }, [counts.all]);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <SummaryCard icon={<ShieldAlert size={18} />} label="طلبات تحتاج مراجعة" value={counts.all} tone="amber" />
        <SummaryCard icon={<UserRound size={18} />} label="مشاكل بيانات العميل" value={customerProblems} tone="cyan" />
        <SummaryCard icon={<PackageSearch size={18} />} label="مشاكل ربط الأصناف" value={productProblems} tone="violet" />
      </div>

      <div className="rounded-2xl border border-slate-700 bg-slate-950/45 p-3">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              className="input-dark h-10 w-full pr-9 text-sm"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="ابحث بالعميل، الكود، الهاتف، الصنف أو كود الصنف..."
            />
          </div>
          <button type="button" onClick={() => void load()} className="h-10 rounded-xl border border-slate-700 px-3 text-xs font-black text-slate-300 hover:bg-slate-900">
            <span className="inline-flex items-center gap-2"><RefreshCw size={14} /> تحديث الفحص</span>
          </button>
        </div>

        <div className="mt-3 overflow-x-auto border-t border-slate-800 pt-3">
          <div className="flex min-w-max gap-1.5">
            {ISSUE_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setIssue(tab.id)}
                className={`h-10 rounded-xl px-3 text-xs font-black transition ${issue === tab.id ? 'bg-amber-500/15 text-amber-100 ring-1 ring-amber-400/30' : 'text-slate-400 hover:bg-slate-900 hover:text-white'}`}
              >
                {tab.label}
                <span className="mr-2 rounded-full bg-slate-900/70 px-1.5 py-0.5 text-[10px]">{counts[tab.id].toLocaleString('ar-EG')}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex min-h-52 items-center justify-center rounded-2xl border border-slate-700 bg-slate-950/45"><Loader2 className="animate-spin text-cyan-300" /></div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/[0.06] p-8 text-center">
          <CheckCircle2 className="mx-auto text-emerald-300" size={34} />
          <div className="mt-3 font-black text-emerald-100">لا توجد مشاكل في هذا الفلتر</div>
          <div className="mt-1 text-xs text-slate-400">جرّب نوع مشكلة آخر أو غيّر البحث.</div>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map(({ request, issues }) => (
            <button
              key={request.id}
              type="button"
              onClick={() => onOpenRequest(request)}
              className="w-full rounded-2xl border border-slate-700 bg-slate-950/45 p-3 text-right transition hover:border-amber-400/30 hover:bg-amber-500/[0.05]"
            >
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-black text-white">{request.medicine_name || 'صنف غير محدد'}</span>
                    <span className="text-xs font-bold text-slate-500">#{request.product_code || 'بدون كود'}</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-400">{request.customer_name || 'عميل غير محدد'} · كود {request.customer_code || '—'} · {request.customer_phone || 'بدون هاتف'} · {request.branch || 'بدون فرع'}</div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {issues.map((problem) => <IssuePill key={problem} issue={problem} />)}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2 text-xs font-black text-cyan-200">
                  مراجعة وإصلاح <ChevronLeft size={16} />
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="hidden">{cleanPercent}</div>
    </div>
  );
}

function IssuePill({ issue }: { issue: QualityIssueKey }) {
  return <span className="inline-flex items-center gap-1 rounded-lg border border-amber-400/15 bg-amber-500/10 px-2 py-1 text-[10px] font-black text-amber-100"><AlertTriangle size={10} />{qualityIssueLabel(issue)}</span>;
}

function SummaryCard({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: 'amber' | 'cyan' | 'violet' }) {
  const tones = {
    amber: 'border-amber-400/20 bg-amber-500/[0.07] text-amber-200',
    cyan: 'border-cyan-400/20 bg-cyan-500/[0.07] text-cyan-200',
    violet: 'border-violet-400/20 bg-violet-500/[0.07] text-violet-200',
  };
  return <div className={`rounded-2xl border p-4 ${tones[tone]}`}><div className="flex items-center gap-2 text-xs font-black">{icon}{label}</div><div className="mt-2 text-3xl font-black">{value.toLocaleString('ar-EG')}</div></div>;
}
