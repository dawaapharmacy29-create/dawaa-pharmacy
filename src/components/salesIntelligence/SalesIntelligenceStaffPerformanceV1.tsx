import { useEffect, useMemo, useState } from 'react';
import { BadgeCheck, CircleAlert, PackageCheck, ReceiptText, Search, UsersRound } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type StaffTruthRow = {
  case_id: string;
  invoice_amount: number | string | null;
  canonical_staff_id: string | null;
  canonical_staff_name: string | null;
  canonical_staff_role: string | null;
  canonical_staff_branch: string | null;
  invoice_staff_name_raw: string | null;
  staff_resolution_status: string;
  is_staff_resolved: boolean;
  item_evidence_available: boolean;
};

type OpportunityRow = {
  attributed_staff_id: string | null;
  attributed_staff_name: string | null;
  current_stage: string;
  leakage_code: string | null;
};

type StaffRow = {
  key: string;
  name: string;
  role: string | null;
  branch: string | null;
  officialSales: number;
  officialRevenue: number;
  itemEvidenceSales: number;
  opportunities: number;
  acceptedOrLater: number;
  leakageCases: number;
};

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: number): string {
  return new Intl.NumberFormat('ar-EG', {
    style: 'currency',
    currency: 'EGP',
    maximumFractionDigits: 0,
  }).format(value);
}

function Metric({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint: string;
  icon: typeof UsersRound;
}) {
  return (
    <div className="rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-soft)] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="dawaa-muted text-xs font-bold">{label}</div>
        <Icon size={18} className="dawaa-muted" />
      </div>
      <div className="dawaa-heading mt-2 text-2xl font-black">{value}</div>
      <div className="dawaa-muted mt-1 text-[11px]">{hint}</div>
    </div>
  );
}

export default function SalesIntelligenceStaffPerformanceV1() {
  const [truthRows, setTruthRows] = useState<StaffTruthRow[]>([]);
  const [opportunities, setOpportunities] = useState<OpportunityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [branch, setBranch] = useState('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      const [truthResult, opportunityResult] = await Promise.all([
        supabase
          .from('sales_intelligence_invoice_staff_truth_v1')
          .select('case_id,invoice_amount,canonical_staff_id,canonical_staff_name,canonical_staff_role,canonical_staff_branch,invoice_staff_name_raw,staff_resolution_status,is_staff_resolved,item_evidence_available')
          .limit(1000),
        supabase
          .from('whatsapp_product_demand_detail_v22')
          .select('attributed_staff_id,attributed_staff_name,current_stage,leakage_code')
          .limit(2000),
      ]);
      if (cancelled) return;
      if (truthResult.error) {
        setError(truthResult.error.message);
        setTruthRows([]);
      } else {
        setTruthRows((truthResult.data || []) as StaffTruthRow[]);
      }
      if (!opportunityResult.error) {
        setOpportunities((opportunityResult.data || []) as OpportunityRow[]);
      } else {
        setOpportunities([]);
      }
      setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  const staffRows = useMemo(() => {
    const map = new Map<string, StaffRow>();
    for (const row of truthRows) {
      if (!row.is_staff_resolved || !row.canonical_staff_id || !row.canonical_staff_name) continue;
      const key = row.canonical_staff_id;
      const current = map.get(key) || {
        key,
        name: row.canonical_staff_name,
        role: row.canonical_staff_role,
        branch: row.canonical_staff_branch,
        officialSales: 0,
        officialRevenue: 0,
        itemEvidenceSales: 0,
        opportunities: 0,
        acceptedOrLater: 0,
        leakageCases: 0,
      };
      current.officialSales += 1;
      current.officialRevenue += number(row.invoice_amount);
      if (row.item_evidence_available) current.itemEvidenceSales += 1;
      map.set(key, current);
    }

    for (const opportunity of opportunities) {
      const name = String(opportunity.attributed_staff_name || '').trim();
      if (!name) continue;
      const byId = opportunity.attributed_staff_id ? map.get(opportunity.attributed_staff_id) : null;
      const byName = Array.from(map.values()).find((row) => row.name.trim() === name);
      const current = byId || byName;
      if (!current) continue;
      current.opportunities += 1;
      if (['accepted', 'order_confirmed', 'verified_sale'].includes(opportunity.current_stage)) {
        current.acceptedOrLater += 1;
      }
      if (opportunity.leakage_code) current.leakageCases += 1;
    }
    return Array.from(map.values()).sort((a, b) => b.officialSales - a.officialSales || b.officialRevenue - a.officialRevenue);
  }, [truthRows, opportunities]);

  const branches = useMemo(
    () => Array.from(new Set(staffRows.map((row) => row.branch).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b, 'ar')),
    [staffRows]
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return staffRows.filter((row) => {
      if (branch !== 'all' && row.branch !== branch) return false;
      if (needle && !row.name.toLowerCase().includes(needle) && !(row.role || '').toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [branch, search, staffRows]);

  const unresolvedOfficial = truthRows.filter((row) => !row.is_staff_resolved).length;
  const totalRevenue = staffRows.reduce((sum, row) => sum + row.officialRevenue, 0);
  const totalSales = staffRows.reduce((sum, row) => sum + row.officialSales, 0);
  const itemEvidenceSales = staffRows.reduce((sum, row) => sum + row.itemEvidenceSales, 0);

  return (
    <div className="space-y-5" dir="rtl">
      <section className="dawaa-card">
        <div className="flex items-start gap-3">
          <span className="dawaa-icon-tile h-10 w-10 shrink-0"><UsersRound size={19} /></span>
          <div>
            <div className="dawaa-heading text-lg font-black">أداء الفريق — المبيعات المنسوبة رسميًا</div>
            <p className="dawaa-muted mt-1 max-w-3xl text-sm leading-6">
              هذه الشاشة تعتمد على Staff Truth الآمن فقط. الاسم الملتبس أو الفاتورة التي لا تحتوي موظفًا لا تدخل أرقام أي دكتور حتى يتم حسمها.
            </p>
          </div>
        </div>
      </section>

      {error ? <div className="dawaa-alert dawaa-alert--warning text-xs">{error}</div> : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric icon={BadgeCheck} label="بيعات رسمية مرتبطة بموظف" value={loading ? '…' : totalSales.toLocaleString('ar-EG')} hint="لا تشمل الأسماء غير المحسومة" />
        <Metric icon={ReceiptText} label="قيمة المبيعات الرسمية" value={loading ? '…' : money(totalRevenue)} hint="إجمالي قيمة الفواتير الرسمية" />
        <Metric icon={PackageCheck} label="بيعات بأدلة أصناف" value={loading ? '…' : itemEvidenceSales.toLocaleString('ar-EG')} hint="يمكن مراجعة الصنف والكمية داخل الفاتورة" />
        <Metric icon={CircleAlert} label="بيعات رسمية غير منسوبة" value={loading ? '…' : unresolvedOfficial.toLocaleString('ar-EG')} hint="تظل في QA ولا تدخل تقييم موظف" />
      </section>

      <section className="dawaa-card">
        <div className="grid gap-3 md:grid-cols-[1fr_220px]">
          <label className="relative">
            <Search size={16} className="dawaa-muted absolute right-3 top-1/2 -translate-y-1/2" />
            <input className="dawaa-input w-full pr-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث باسم الدكتور أو الدور..." />
          </label>
          <select className="dawaa-select" value={branch} onChange={(event) => setBranch(event.target.value)}>
            <option value="all">كل الفروع</option>
            {branches.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </div>
      </section>

      <section className="dawaa-card overflow-hidden p-0">
        {loading ? (
          <div className="dawaa-muted py-12 text-center">جاري تحميل أداء الفريق...</div>
        ) : !filtered.length ? (
          <div className="dawaa-empty-state py-12 text-center">لا توجد مبيعات رسمية قابلة للنسب للفلتر الحالي.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="dawaa-muted border-b border-[var(--dawaa-theme-border)] text-right">
                  {['الموظف','الفرع','البيع الرسمي','قيمة البيع','بأدلة أصناف','فرص V22','وصلت للقبول','فقد بيع'].map((heading) => (
                    <th key={heading} className="p-3">{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.key} className="border-b border-[var(--dawaa-theme-border)]/60">
                    <td className="p-3"><div className="dawaa-heading font-black">{row.name}</div><div className="dawaa-muted mt-1 text-[11px]">{row.role || 'الدور غير محدد'}</div></td>
                    <td className="p-3">{row.branch || '—'}</td>
                    <td className="p-3 font-black">{row.officialSales.toLocaleString('ar-EG')}</td>
                    <td className="p-3 font-black">{money(row.officialRevenue)}</td>
                    <td className="p-3">{row.itemEvidenceSales.toLocaleString('ar-EG')}</td>
                    <td className="p-3">{row.opportunities ? row.opportunities.toLocaleString('ar-EG') : '—'}</td>
                    <td className="p-3">{row.opportunities ? row.acceptedOrLater.toLocaleString('ar-EG') : '—'}</td>
                    <td className="p-3">{row.opportunities ? row.leakageCases.toLocaleString('ar-EG') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {!opportunities.length && !loading ? (
        <div className="dawaa-muted text-[11px]">
          بيانات فرص الأصناف V22 غير مكتملة حاليًا؛ لذلك أرقام الفرص/القبول/فقد البيع ستظهر تلقائيًا عندما يكتمل تحليل Product Demand، بدون التأثير على أرقام المبيعات الرسمية أعلاه.
        </div>
      ) : null}
    </div>
  );
}
