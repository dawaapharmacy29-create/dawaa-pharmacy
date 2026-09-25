import { useEffect, useMemo, useState } from 'react';
import { BadgeCheck, CircleAlert, PackageCheck, ReceiptText, Search, UsersRound } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { dateFallsInCycleV1, nextDayYmdV1, type SalesIntelligenceCycleScopeV1 } from '@/lib/salesIntelligence/dashboardScopeV1';

type StaffTruthRow = {
  case_id: string;
  invoice_datetime: string | null;
  invoice_branch: string | null;
  invoice_amount: number | string | null;
  canonical_staff_id: string | null;
  canonical_staff_name: string | null;
  canonical_staff_role: string | null;
  canonical_staff_branch: string | null;
  staff_resolution_status: string;
  is_staff_resolved: boolean;
  item_evidence_available: boolean;
};

type OpportunityRow = {
  attributed_staff_id: string | null;
  attributed_staff_name: string | null;
  branch: string | null;
  cycle_start: string;
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

function cairoDateKey(value: string | null): string | null {
  if (!value) return null;
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Cairo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(value));
  } catch {
    return value.slice(0, 10);
  }
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

export default function SalesIntelligenceStaffPerformanceV1({
  cycle,
  branch,
}: {
  cycle: SalesIntelligenceCycleScopeV1;
  branch: string;
}) {
  const [truthRows, setTruthRows] = useState<StaffTruthRow[]>([]);
  const [opportunities, setOpportunities] = useState<OpportunityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);

      let truthQuery = supabase
        .from('sales_intelligence_invoice_staff_truth_v1')
        .select('case_id,invoice_datetime,invoice_branch,invoice_amount,canonical_staff_id,canonical_staff_name,canonical_staff_role,canonical_staff_branch,staff_resolution_status,is_staff_resolved,item_evidence_available')
        .gte('invoice_datetime', `${cycle.start}T00:00:00Z`)
        .lt('invoice_datetime', `${nextDayYmdV1(cycle.end)}T23:59:59Z`)
        .limit(2000);

      let opportunityQuery = supabase
        .from('whatsapp_product_demand_detail_v22')
        .select('attributed_staff_id,attributed_staff_name,branch,cycle_start,current_stage,leakage_code')
        .eq('cycle_start', cycle.start)
        .limit(3000);

      if (branch !== 'all') {
        truthQuery = truthQuery.eq('invoice_branch', branch);
        opportunityQuery = opportunityQuery.eq('branch', branch);
      }

      const [truthResult, opportunityResult] = await Promise.all([truthQuery, opportunityQuery]);
      if (cancelled) return;

      if (truthResult.error) {
        setError(truthResult.error.message);
        setTruthRows([]);
      } else {
        setTruthRows(
          ((truthResult.data || []) as StaffTruthRow[]).filter((row) =>
            dateFallsInCycleV1(cairoDateKey(row.invoice_datetime), cycle) &&
            (branch === 'all' || row.invoice_branch === branch)
          )
        );
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
  }, [branch, cycle.end, cycle.start]);

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
      if (['accepted', 'order_confirmed', 'verified_sale'].includes(opportunity.current_stage)) current.acceptedOrLater += 1;
      if (opportunity.leakage_code) current.leakageCases += 1;
    }

    return Array.from(map.values()).sort((a, b) =>
      b.officialSales - a.officialSales ||
      b.officialRevenue - a.officialRevenue ||
      a.name.localeCompare(b.name, 'ar')
    );
  }, [opportunities, truthRows]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return staffRows.filter((row) =>
      !needle ||
      row.name.toLowerCase().includes(needle) ||
      (row.role || '').toLowerCase().includes(needle)
    );
  }, [search, staffRows]);

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
              دورة {cycle.label} • {branch === 'all' ? 'كل الفروع' : branch}. الاسم الملتبس أو الفاتورة التي لا تحتوي موظفًا لا تدخل أرقام أي دكتور.
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
        <label className="relative block">
          <Search size={16} className="dawaa-muted absolute right-3 top-1/2 -translate-y-1/2" />
          <input className="dawaa-input w-full pr-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث باسم الدكتور أو الدور..." />
        </label>
      </section>

      <section className="dawaa-card overflow-hidden p-0">
        {loading ? (
          <div className="dawaa-muted py-12 text-center">جاري تحميل أداء الفريق...</div>
        ) : !filtered.length ? (
          <div className="dawaa-empty-state py-12 text-center">لا توجد مبيعات رسمية قابلة للنسب في النطاق الحالي.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="dawaa-muted border-b border-[var(--dawaa-theme-border)] text-right">
                  {['الموظف','الفرع','البيع الرسمي','قيمة البيع','بأدلة أصناف','فرص الأصناف','وصلت للقبول','فقد بيع'].map((heading) => <th key={heading} className="p-3">{heading}</th>)}
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const conversion = row.opportunities ? Math.round((row.acceptedOrLater / row.opportunities) * 100) : null;
                  return (
                    <tr key={row.key} className="border-b border-[var(--dawaa-theme-border)]/60">
                      <td className="p-3"><div className="dawaa-heading font-black">{row.name}</div><div className="dawaa-muted mt-1 text-[11px]">{row.role || 'الدور غير محدد'}</div></td>
                      <td className="p-3">{row.branch || '—'}</td>
                      <td className="p-3 font-black">{row.officialSales.toLocaleString('ar-EG')}</td>
                      <td className="p-3 font-black">{money(row.officialRevenue)}</td>
                      <td className="p-3">{row.itemEvidenceSales.toLocaleString('ar-EG')}</td>
                      <td className="p-3">{row.opportunities ? row.opportunities.toLocaleString('ar-EG') : '—'}</td>
                      <td className="p-3">
                        {row.opportunities ? (
                          <div><div className="font-black">{row.acceptedOrLater.toLocaleString('ar-EG')}</div><div className="dawaa-muted text-[10px]">{conversion}% من الفرص</div></div>
                        ) : '—'}
                      </td>
                      <td className="p-3">{row.opportunities ? row.leakageCases.toLocaleString('ar-EG') : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {!opportunities.length && !loading ? (
        <div className="dawaa-muted text-[11px]">
          تحليل فرص الأصناف للدورة الحالية غير مكتمل؛ المبيعات الرسمية تظل صحيحة، وستظهر أعمدة الفرص والقبول تلقائيًا مع اكتمال Product Demand.
        </div>
      ) : null}
    </div>
  );
}
