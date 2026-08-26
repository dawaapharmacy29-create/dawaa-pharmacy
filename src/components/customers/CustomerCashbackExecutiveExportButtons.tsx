import { useEffect, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { BRANCHES } from '@/lib/constants';
import { friendlySupabaseError } from '@/lib/supabaseError';
import type { CashbackComparisonPayload, CashbackComparisonRow } from '@/lib/customerCashbackAnalyticsExport';
import type { CashbackOperationsPayload } from '@/lib/customerCashbackExecutiveExport';
import { exportCustomerCashbackPrimaryExecutiveWorkbook, type CashbackCurrentRow } from '@/lib/customerCashbackPrimaryExecutiveExport';

type Props = { forcedBranch?: string };
const ALL = '__all__';

async function fetchComparison(targetBranch: string | null) {
  const rows: CashbackComparisonRow[] = [];
  let offset = 0;
  let total = 1;
  let payload: CashbackComparisonPayload = { periods: { current_start: '', current_end: '', previous_start: '', previous_end: '' }, summary: {}, branch_summary: [] };
  do {
    const { data, error } = await (supabase as any).rpc('dawaa_customer_cashback_cycle_comparison_v1', {
      p_reference_date: null,
      p_branch: targetBranch,
      p_search: null,
      p_limit: 500,
      p_offset: offset,
    });
    if (error) throw error;
    if (offset === 0) payload = {
      periods: data?.periods || payload.periods,
      summary: data?.summary || {},
      branch_summary: Array.isArray(data?.branch_summary) ? data.branch_summary : [],
    };
    const chunk = Array.isArray(data?.rows) ? data.rows as CashbackComparisonRow[] : [];
    rows.push(...chunk);
    total = Number(data?.filtered_count || 0);
    offset += chunk.length;
    if (!chunk.length) break;
  } while (offset < total);
  return { rows, payload };
}

async function fetchOperations(branch: string) {
  const { data, error } = await (supabase as any).rpc('dawaa_customer_cashback_branch_operations_v1', { p_branch: branch, p_reference_date: null });
  if (error) throw error;
  return data as CashbackOperationsPayload;
}

async function fetchCurrentRows(branch: string, operations: CashbackOperationsPayload) {
  const period = operations.current;
  if (!period) return [] as CashbackCurrentRow[];
  const rows: CashbackCurrentRow[] = [];
  let offset = 0;
  let total = 1;
  do {
    const { data, error } = await (supabase as any).rpc('dawaa_customer_cashback_fast_page_v1', {
      p_cycle_start: period.period_start,
      p_cycle_end: period.period_end,
      p_branch: branch,
      p_status: null,
      p_quick_filter: 'all',
      p_search: null,
      p_limit: 500,
      p_offset: offset,
    });
    if (error) throw error;
    const chunk = Array.isArray(data?.rows) ? data.rows as CashbackCurrentRow[] : [];
    rows.push(...chunk);
    total = Number(data?.totals?.count || 0);
    offset += chunk.length;
    if (!chunk.length) break;
  } while (offset < total);
  return rows;
}

export default function CustomerCashbackExecutiveExportButtons({ forcedBranch = '' }: Props) {
  const [allowedBranches, setAllowedBranches] = useState<string[]>(forcedBranch ? [forcedBranch] : []);
  const [exporting, setExporting] = useState('');

  useEffect(() => {
    if (forcedBranch) { setAllowedBranches([forcedBranch]); return; }
    void (async () => {
      const { data, error } = await (supabase as any).rpc('dawaa_customer_points_allowed_branches_v1', { p_manage: false });
      if (error) return;
      const branches = Array.from(new Set((Array.isArray(data) ? data : []).map(String).filter((b) => BRANCHES.includes(b))));
      setAllowedBranches(branches);
    })();
  }, [forcedBranch]);

  const exportReport = async (target: string | null) => {
    const key = target || ALL;
    setExporting(key);
    try {
      const branches = target ? [target] : allowedBranches.filter((b) => BRANCHES.includes(b));
      if (!branches.length) throw new Error('لا توجد فروع متاحة للتقرير');
      const comparison = await fetchComparison(target);
      const operations = await Promise.all(branches.map(fetchOperations));
      const currentRows = (await Promise.all(branches.map((b, i) => fetchCurrentRows(b, operations[i])))).flat();
      await exportCustomerCashbackPrimaryExecutiveWorkbook({
        rows: comparison.rows,
        payload: comparison.payload,
        branchLabel: target || 'كل الفروع',
        operations,
        currentRows,
      });
      toast.success(`تم تجهيز تقرير Excel التنفيذي — ${target || 'كل الفروع'}`);
    } catch (error) {
      toast.error(friendlySupabaseError(error as any) || (error as Error)?.message || 'تعذر تجهيز تقرير Excel التنفيذي');
    } finally {
      setExporting('');
    }
  };

  if (!allowedBranches.length) return null;
  return (
    <div dir="rtl" className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-500/5 px-4 py-3">
      <div>
        <div className="text-sm font-black text-[var(--theme-heading)]">تصدير Excel التنفيذي</div>
        <div className="mt-1 text-xs font-semibold text-[var(--theme-muted)]">Dashboard + كل عملاء الدورة + التبليغ والتسوية + مقارنة الدورة السابقة + معدلات النمو + رسوم السرعة.</div>
      </div>
      <div className="flex flex-wrap gap-2">
        {allowedBranches.includes('فرع الشامي') && <button type="button" className="dawaa-button-primary" disabled={!!exporting} onClick={() => void exportReport('فرع الشامي')}>
          {exporting === 'فرع الشامي' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} {forcedBranch ? 'تقرير Excel التنفيذي' : 'تقرير الشامي'}
        </button>}
        {allowedBranches.includes('فرع شكري') && <button type="button" className="dawaa-button-primary" disabled={!!exporting} onClick={() => void exportReport('فرع شكري')}>
          {exporting === 'فرع شكري' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} {forcedBranch ? 'تقرير Excel التنفيذي' : 'تقرير شكري'}
        </button>}
        {!forcedBranch && allowedBranches.length > 1 && <button type="button" className="btn-secondary" disabled={!!exporting} onClick={() => void exportReport(null)}>
          {exporting === ALL ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} التقرير الموحّد
        </button>}
      </div>
    </div>
  );
}
