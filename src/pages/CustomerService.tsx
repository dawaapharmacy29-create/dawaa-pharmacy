import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Search, MessageSquare, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { ALL_FILTER } from '@/lib/api/customers';
import {
  calculateFollowupStats,
  fetchCustomerServiceFollowups,
  generateTodayFollowupsFromCustomerMetrics,
  updateFollowupResult,
  type FollowupRow,
} from '@/lib/api/customerServiceCommandCenter';
import { generateWhatsAppLink } from '@/lib/whatsapp';
import { normalizeBranchName } from '@/lib/branch';
import { BRANCHES } from '@/lib/constants';
import { canSeeAllBranches, effectiveBranchFilter } from '@/lib/security/permissionScopes';

function txt(value: unknown, fallback = '-') {
  const text = String(value ?? '').trim();
  return text || fallback;
}
function phoneOf(row: FollowupRow) {
  return String(row.customer_phone || row.phone || row.whatsapp_phone || row.phone_alt || '').trim();
}
function nameOf(row: FollowupRow) {
  return txt(row.customer_name || row.name, 'Customer');
}
function statusOf(row: FollowupRow) {
  if (row.completed_at) return 'done';
  if (row.postponed_until) return 'postponed';
  if (row.needs_manager) return 'manager';
  return txt(row.followup_status || row.status || row.contact_status, 'pending');
}
function dateText(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value).slice(0, 16) : date.toLocaleString('ar-EG');
}

export default function CustomerService() {
  const { user } = useAuth();
  const mountedRef = useRef(true);
  const firstLoadRef = useRef(true);
  const [rows, setRows] = useState<FollowupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [branch, setBranch] = useState(ALL_FILTER);
  const [status, setStatus] = useState(ALL_FILTER);
  const [search, setSearch] = useState('');
  const canAllBranches = canSeeAllBranches(user?.role);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!canAllBranches && user?.branch) setBranch(normalizeBranchName(user.branch));
  }, [canAllBranches, user?.branch]);

  const load = useCallback(async (soft = false) => {
    if (soft) setRefreshing(true);
    else if (firstLoadRef.current) setLoading(true);
    setError(null);
    try {
      const scopedBranch = effectiveBranchFilter(user, branch, ALL_FILTER);
      const data = await fetchCustomerServiceFollowups({ branch: scopedBranch, status, search, limit: 180 });
      if (!mountedRef.current) return;
      setRows(data);
      firstLoadRef.current = false;
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : 'Load failed');
      firstLoadRef.current = false;
    } finally {
      if (!mountedRef.current) return;
      setLoading(false);
      setRefreshing(false);
    }
  }, [branch, search, status, user]);

  useEffect(() => {
    const timer = window.setTimeout(() => load(rows.length > 0), 350);
    return () => window.clearTimeout(timer);
  }, [load]);

  const stats = useMemo(() => calculateFollowupStats(rows), [rows]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => [nameOf(row), row.customer_code, phoneOf(row), row.branch, statusOf(row)].join(' ').toLowerCase().includes(q));
  }, [rows, search]);

  const markDone = async (row: FollowupRow) => {
    try {
      const updated = await updateFollowupResult(row.id, { followup_status: 'تم', status: 'تم', completed_at: new Date().toISOString(), updated_by: user?.id || user?.name || null });
      setRows((items) => items.map((item) => item.id === updated.id ? updated : item));
      toast.success('Saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    }
  };

  const generateToday = async () => {
    setGenerating(true);
    try {
      const scopedBranch = effectiveBranchFilter(user, branch, ALL_FILTER);
      const created = await generateTodayFollowupsFromCustomerMetrics(scopedBranch, user?.name);
      toast.success(created.length ? `Created ${created.length}` : 'No new followups');
      await load(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Generate failed');
    } finally {
      setGenerating(false);
    }
  };

  if (loading && !rows.length) {
    return <div className="flex min-h-[60vh] items-center justify-center"><div className="rounded-3xl border border-slate-700 bg-slate-900 p-8 text-center text-white"><RefreshCw className="mx-auto mb-4 h-8 w-8 animate-spin text-cyan-300" /><div className="text-lg font-black">Loading followups...</div></div></div>;
  }

  return (
    <div className="space-y-5" dir="rtl">
      <section className="rounded-3xl border border-cyan-500/20 bg-slate-950/70 p-5 text-slate-100">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div><span className="rounded-full bg-cyan-500/10 px-3 py-1 text-xs font-bold text-cyan-200">Customer Service</span><h1 className="mt-3 text-2xl font-black">مركز خدمة العملاء</h1><p className="mt-1 text-sm text-slate-400">Stable followups list with soft refresh.</p></div>
          <div className="flex flex-wrap gap-2"><button onClick={() => load(true)} disabled={refreshing} className="rounded-2xl bg-slate-800 px-4 py-2 text-sm font-bold hover:bg-slate-700 disabled:opacity-60"><RefreshCw className={`ml-2 inline h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />Refresh</button><button onClick={generateToday} disabled={generating} className="rounded-2xl bg-cyan-600 px-4 py-2 text-sm font-bold text-white hover:bg-cyan-500 disabled:opacity-60">{generating ? 'Creating...' : 'Create today list'}</button></div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-4">
        <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-4 text-slate-100"><div className="text-xs text-slate-400">Total</div><div className="mt-2 text-2xl font-black">{stats.totalToday}</div></div>
        <div className="rounded-2xl border border-emerald-700/40 bg-emerald-950/30 p-4 text-slate-100"><div className="text-xs text-slate-400">Done</div><div className="mt-2 text-2xl font-black text-emerald-300">{stats.completed}</div></div>
        <div className="rounded-2xl border border-amber-700/40 bg-amber-950/30 p-4 text-slate-100"><div className="text-xs text-slate-400">Overdue</div><div className="mt-2 text-2xl font-black text-amber-300">{stats.overdue}</div></div>
        <div className="rounded-2xl border border-rose-700/40 bg-rose-950/30 p-4 text-slate-100"><div className="text-xs text-slate-400">Manager</div><div className="mt-2 text-2xl font-black text-rose-300">{stats.needsManager}</div></div>
      </section>

      <section className="rounded-3xl border border-slate-700 bg-slate-950/70 p-4"><div className="grid gap-3 md:grid-cols-4"><select value={branch} onChange={(e) => setBranch(e.target.value)} disabled={!canAllBranches} className="rounded-xl border border-slate-700 bg-slate-900 p-2 text-slate-100"><option value={ALL_FILTER}>All branches</option>{BRANCHES.map((b) => <option key={b} value={b}>{b}</option>)}</select><select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-xl border border-slate-700 bg-slate-900 p-2 text-slate-100">{[ALL_FILTER, 'معلق', 'تم', 'لم يرد', 'مؤجل', 'متأخرة', 'يحتاج مدير'].map((s) => <option key={s} value={s}>{s}</option>)}</select><div className="relative md:col-span-2"><Search className="absolute right-3 top-2.5 h-4 w-4 text-slate-500" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search customer, code, phone" className="w-full rounded-xl border border-slate-700 bg-slate-900 py-2 pr-10 text-slate-100" /></div></div></section>
      {error && <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-100">{error}</div>}
      <section className="rounded-3xl border border-slate-700 bg-slate-950/70 p-4"><div className="mb-3 flex items-center justify-between text-slate-100"><h2 className="text-lg font-black">Followups</h2>{refreshing && <span className="text-xs text-cyan-300">Refreshing...</span>}</div>{!filtered.length ? <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-slate-400">No matching followups.</div> : <div className="grid gap-3">{filtered.map((row) => { const phone = phoneOf(row); const wa = phone ? generateWhatsAppLink(phone, `Hello ${nameOf(row)}, Dawaa Pharmacy is following up with you.`) : ''; return <article key={row.id} className="rounded-2xl border border-slate-700 bg-slate-900/70 p-4 text-slate-100"><div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"><div><div className="flex flex-wrap items-center gap-2"><h3 className="text-lg font-black">{nameOf(row)}</h3><span className="rounded-full bg-slate-800 px-2 py-1 text-xs text-slate-300">{statusOf(row)}</span></div><div className="mt-2 grid gap-1 text-sm text-slate-400 md:grid-cols-3"><span>Code: {txt(row.customer_code)}</span><span>Phone: {txt(phone)}</span><span>Branch: {txt(row.branch)}</span><span>Last: {dateText(row.last_purchase_date)}</span><span>Due: {dateText(row.followup_datetime || row.followup_date || row.created_at)}</span><span>Spent: {Number(row.total_spent || 0).toLocaleString('ar-EG')}</span></div></div><div className="flex shrink-0 flex-wrap gap-2">{phone && <a href={wa} target="_blank" rel="noreferrer" className="rounded-xl bg-emerald-600 px-3 py-2 text-sm font-bold text-white hover:bg-emerald-500"><MessageSquare className="ml-1 inline h-4 w-4" />WhatsApp</a>}<button onClick={() => markDone(row)} className="rounded-xl bg-cyan-600 px-3 py-2 text-sm font-bold text-white hover:bg-cyan-500"><CheckCircle2 className="ml-1 inline h-4 w-4" />Done</button></div></div></article>; })}</div>}</section>
    </div>
  );
}
