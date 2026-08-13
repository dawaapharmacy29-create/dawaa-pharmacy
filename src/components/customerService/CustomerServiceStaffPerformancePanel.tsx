import { useEffect, useMemo, useState } from 'react';
import {
  BadgeDollarSign,
  CalendarDays,
  CheckCircle2,
  Clock3,
  FileSpreadsheet,
  Gift,
  MessageCircleReply,
  PhoneCall,
  RefreshCw,
  ShoppingCart,
  Sparkles,
  Target,
  UsersRound,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { normalizeBranchName } from '@/lib/branch';
import { canViewAllBranches } from '@/lib/security/userDataScope';
import { supabase } from '@/lib/supabase';

type Row = Record<string, any>;

type DayMetrics = {
  date: string;
  total: number;
  executed: number;
  responded: number;
  completed: number;
  points: number;
  plus500: number;
  vip: number;
  purchases: number;
  purchaseValue: number;
};

type StaffMetrics = {
  key: string;
  name: string;
  branch: string;
  total: number;
  executed: number;
  responded: number;
  noAnswer: number;
  completed: number;
  scheduled: number;
  points: number;
  plus500: number;
  vip: number;
  activity: number;
  purchases: number;
  purchaseValue: number;
  documented: number;
  timestamped: number;
  timely: number;
  imported: number;
  activeDays: number;
  avgPerActiveDay: number;
  completionRate: number;
  responseRate: number;
  executionRate: number;
  score: number;
  incentive: number;
  provisional: boolean;
  daily: DayMetrics[];
};

const text = (value: unknown) => String(value ?? '').trim();
const norm = (value: unknown) => text(value)
  .replace(/[ًٌٍَُِّْـ]/g, '')
  .replace(/[أإآ]/g, 'ا')
  .replace(/ى/g, 'ي')
  .replace(/ة/g, 'ه')
  .replace(/^\s*(دكتور|دكتوره|د\.?|dr\.?)[\s/.-]*/i, '')
  .replace(/[\s/_.-]+/g, ' ')
  .trim()
  .toLowerCase();

const displayName = (value: unknown) => {
  const clean = text(value)
    .replace(/^\s*(دكتور|دكتوره|د\.?|dr\.?)[\s/.-]*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return clean ? `د/ ${clean}` : 'غير محدد';
};

const localIso = (date = new Date()) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

function monthBounds(month: string) {
  const [y, m] = month.split('-').map(Number);
  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const endDate = new Date(y, m, 0);
  return { start, end: localIso(endDate) };
}

function rowDate(row: Row) {
  const value = text(row.date || row.followup_date || row.contacted_at || row.completed_at || row.created_at);
  return value.slice(0, 10);
}

function completed(row: Row) {
  const status = `${text(row.status)} ${text(row.followup_status)} ${text(row.contact_status)} ${text(row.response_status)}`.toLowerCase();
  return Boolean(row.completed_at || row.closed_at) || /completed|closed|مكتمل|تم الرد|تم التنفيذ/.test(status);
}

function executed(row: Row) {
  return Boolean(row.contacted_at || row.first_attempt_at || row.last_attempt_at || row.completed_at || row.closed_at || text(row.followup_result || row.contact_result || row.followup_summary));
}

function responded(row: Row) {
  const status = `${text(row.contact_status)} ${text(row.response_status)} ${text(row.followup_result)} ${text(row.contact_result)}`.toLowerCase();
  if (/no.?answer|لم يرد|لا يرد|unreachable/.test(status)) return false;
  return /responded|replied|تم الرد|رد العميل|تم الشراء|تم الحل/.test(status) || (executed(row) && Boolean(text(row.followup_result || row.contact_result)));
}

function noAnswer(row: Row) {
  return /no.?answer|لم يرد|لا يرد|unreachable/.test(`${text(row.contact_status)} ${text(row.response_status)} ${text(row.followup_result)} ${text(row.contact_result)}`.toLowerCase());
}

function taskType(row: Row) {
  const queue = text(row.customer_metrics?.queue_type || row.customer_metrics?.queueType).toLowerCase();
  const source = `${text(row.followup_type)} ${text(row.request_type)} ${text(row.request_source)} ${text(row.followup_reason)}`.toLowerCase();
  return {
    points: queue === 'points' || /نقاط|points/.test(source),
    plus500: queue === 'plus500' || /\+?500/.test(source),
    vip: queue === 'vip_recent' || /vip|اهم العملاء|أهم العملاء/.test(source),
    activity: queue === 'activity' || /نشاط العميل|تراجع|متحسن/.test(source),
  };
}

function isHistoricalImport(row: Row) {
  return row.customer_metrics?.source === 'historical_excel_backfill' || /excel_2026_08_12|historical_excel/i.test(text(row.request_source));
}

function performerName(row: Row) {
  if (isHistoricalImport(row) && text(row.created_by_name)) return text(row.created_by_name);
  return text(row.completed_by_name || row.responsible_name || row.assigned_to || row.handled_by_name || row.updated_by_name || row.created_by_name || 'غير محدد');
}

function performerKey(row: Row) {
  if (isHistoricalImport(row)) {
    return text(row.handled_by_staff_id || row.created_by || row.assigned_to_staff_id) || `name:${norm(performerName(row))}`;
  }
  return text(row.handled_by_staff_id || row.assigned_to_staff_id || row.assigned_staff_id || row.staff_id || row.created_by) || `name:${norm(performerName(row))}`;
}

function rowBranch(row: Row) {
  return normalizeBranchName(row.branch || '') || text(row.branch) || 'غير محدد';
}

function rate(value: number, total: number) {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

function money(value: number) {
  return `${Math.round(value || 0).toLocaleString('ar-EG')} ج.م`;
}

export default function CustomerServiceStaffPerformancePanel() {
  const { user } = useAuth();
  const managerView = canViewAllBranches(user);
  const userBranch = normalizeBranchName(user?.branch || '');
  const [month, setMonth] = useState(() => localIso().slice(0, 7));
  const [branch, setBranch] = useState(() => managerView ? 'كل الفروع' : userBranch);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (!managerView && userBranch) setBranch(userBranch);
  }, [managerView, userBranch]);

  async function load() {
    const { start, end } = monthBounds(month);
    setLoading(true);
    try {
      let query = supabase
        .from('daily_followups')
        .select('id,date,followup_date,customer_code,customer_name,branch,status,followup_status,contact_status,response_status,followup_result,contact_result,followup_summary,followup_type,request_type,request_source,followup_reason,request_details,notes,created_at,updated_at,contacted_at,first_attempt_at,last_attempt_at,completed_at,closed_at,needs_next_followup,next_followup_date,purchase_after_followup,purchase_amount,responsible_name,assigned_to,assigned_staff_id,assigned_to_staff_id,handled_by_staff_id,staff_id,created_by,created_by_name,updated_by_name,completed_by_name,customer_metrics')
        .gte('date', start)
        .lte('date', end)
        .order('date', { ascending: true })
        .limit(10000);
      if (!managerView && userBranch) query = query.eq('branch', userBranch);
      else if (branch !== 'كل الفروع') query = query.eq('branch', branch);
      const { data, error } = await query;
      if (error) throw error;
      setRows((data || []) as Row[]);
    } catch (error) {
      toast.error(`تعذر تحميل أداء خدمة العملاء: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [month, branch, managerView, userBranch]);
  useEffect(() => {
    const refresh = () => void load();
    window.addEventListener('dataChanged', refresh);
    window.addEventListener('customer-followup-imported', refresh);
    return () => {
      window.removeEventListener('dataChanged', refresh);
      window.removeEventListener('customer-followup-imported', refresh);
    };
  });

  const staff = useMemo<StaffMetrics[]>(() => {
    const groups = new Map<string, { names: string[]; rows: Row[]; branches: Set<string> }>();
    for (const row of rows) {
      const name = performerName(row);
      const normalized = norm(name);
      if (!normalized || normalized === 'غير محدد') continue;
      const key = performerKey(row);
      const group = groups.get(key) || { names: [], rows: [], branches: new Set<string>() };
      group.names.push(name);
      group.rows.push(row);
      group.branches.add(rowBranch(row));
      groups.set(key, group);
    }

    return [...groups.entries()].map(([key, group]) => {
      const preferred = group.names.sort((a, b) => b.length - a.length)[0] || 'غير محدد';
      const total = group.rows.length;
      const executedRows = group.rows.filter(executed);
      const respondedRows = group.rows.filter(responded);
      const completedRows = group.rows.filter(completed);
      const noAnswerRows = group.rows.filter(noAnswer);
      const scheduledRows = group.rows.filter((row) => row.needs_next_followup === true || Boolean(row.next_followup_date));
      const pointsRows = group.rows.filter((row) => taskType(row).points);
      const plus500Rows = group.rows.filter((row) => taskType(row).plus500);
      const vipRows = group.rows.filter((row) => taskType(row).vip);
      const activityRows = group.rows.filter((row) => taskType(row).activity);
      const purchaseRows = group.rows.filter((row) => row.purchase_after_followup === true || Number(row.purchase_amount || 0) > 0);
      const purchaseValue = purchaseRows.reduce((sum, row) => sum + Number(row.purchase_amount || 0), 0);
      const documented = group.rows.filter((row) => text(row.notes || row.followup_summary || row.request_details).length >= 12).length;
      const imported = group.rows.filter(isHistoricalImport).length;
      const timestampedRows = group.rows.filter((row) => !isHistoricalImport(row) && row.created_at && (row.completed_at || row.closed_at));
      const timely = timestampedRows.filter((row) => {
        const start = new Date(row.created_at).getTime();
        const end = new Date(row.completed_at || row.closed_at).getTime();
        return Number.isFinite(start) && Number.isFinite(end) && end >= start && end - start <= 48 * 60 * 60 * 1000;
      }).length;

      const dailyMap = new Map<string, DayMetrics>();
      for (const row of group.rows) {
        const date = rowDate(row);
        if (!date) continue;
        const day = dailyMap.get(date) || { date, total: 0, executed: 0, responded: 0, completed: 0, points: 0, plus500: 0, vip: 0, purchases: 0, purchaseValue: 0 };
        const type = taskType(row);
        day.total += 1;
        if (executed(row)) day.executed += 1;
        if (responded(row)) day.responded += 1;
        if (completed(row)) day.completed += 1;
        if (type.points) day.points += 1;
        if (type.plus500) day.plus500 += 1;
        if (type.vip) day.vip += 1;
        if (row.purchase_after_followup === true || Number(row.purchase_amount || 0) > 0) {
          day.purchases += 1;
          day.purchaseValue += Number(row.purchase_amount || 0);
        }
        dailyMap.set(date, day);
      }
      const daily = [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date));
      const activeDays = daily.filter((day) => day.executed > 0).length;
      const executionRate = rate(executedRows.length, total);
      const responseRate = rate(respondedRows.length, Math.max(executedRows.length - noAnswerRows.length + noAnswerRows.length, 0));
      const completionRate = rate(completedRows.length, total);
      const documentationRate = rate(documented, total);
      const timelyRate = timestampedRows.length ? rate(timely, timestampedRows.length) : 100;

      // يحافظ على فكرة الحافز الحالي حتى 500 جنيه، لكن لا يعاقب الاستيراد التاريخي لعدم وجود ساعة تنفيذ دقيقة.
      const score = Math.round(
        completionRate * 0.35 +
        executionRate * 0.20 +
        responseRate * 0.20 +
        documentationRate * 0.15 +
        timelyRate * 0.10
      );
      const confidence = Math.min(total / 10, 1);
      const incentive = Math.round(500 * (score / 100) * confidence);

      return {
        key,
        name: displayName(preferred),
        branch: group.branches.size === 1 ? [...group.branches][0] : 'أكثر من فرع',
        total,
        executed: executedRows.length,
        responded: respondedRows.length,
        noAnswer: noAnswerRows.length,
        completed: completedRows.length,
        scheduled: scheduledRows.length,
        points: pointsRows.length,
        plus500: plus500Rows.length,
        vip: vipRows.length,
        activity: activityRows.length,
        purchases: purchaseRows.length,
        purchaseValue,
        documented,
        timestamped: timestampedRows.length,
        timely,
        imported,
        activeDays,
        avgPerActiveDay: activeDays ? Math.round((executedRows.length / activeDays) * 10) / 10 : 0,
        completionRate,
        responseRate,
        executionRate,
        score,
        incentive,
        provisional: total < 10,
        daily,
      };
    }).sort((a, b) => b.executed - a.executed || b.score - a.score);
  }, [rows]);

  const summary = useMemo(() => ({
    total: staff.reduce((sum, item) => sum + item.total, 0),
    executed: staff.reduce((sum, item) => sum + item.executed, 0),
    responded: staff.reduce((sum, item) => sum + item.responded, 0),
    points: staff.reduce((sum, item) => sum + item.points, 0),
    plus500: staff.reduce((sum, item) => sum + item.plus500, 0),
    vip: staff.reduce((sum, item) => sum + item.vip, 0),
    purchases: staff.reduce((sum, item) => sum + item.purchases, 0),
    purchaseValue: staff.reduce((sum, item) => sum + item.purchaseValue, 0),
  }), [staff]);

  return (
    <section className="mx-4 rounded-3xl border border-cyan-300/15 bg-[#091b2d] p-4 shadow-xl" dir="rtl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black text-cyan-300">أداء خدمة العملاء</p>
          <h2 className="mt-1 text-xl font-black text-white">لوحة أداء الموظفين — شغل فعلي موثق</h2>
          <p className="mt-1 max-w-4xl text-xs font-bold leading-6 text-slate-400">تعرض المتابعات المنفذة، الردود، +500، النقاط، VIP، المشتريات بعد المتابعة، والمتابعات القادمة. الأعمال المستوردة من Excel تُنسب للمنفذ المسجل، بينما تقييم السرعة يعتمد فقط على السجلات التي لها وقت تنفيذ حقيقي.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {managerView ? <select className="input-dark min-w-40" value={branch} onChange={(e) => setBranch(e.target.value)}><option>كل الفروع</option><option>فرع شكري</option><option>فرع الشامي</option></select> : null}
          <input className="input-dark max-w-44" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          <button type="button" className="btn-secondary flex items-center gap-2" onClick={() => void load()} disabled={loading}><RefreshCw size={16} className={loading ? 'animate-spin' : ''}/>تحديث</button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
        {[
          { label: 'إجمالي المهام', value: summary.total, icon: Target },
          { label: 'تم التنفيذ', value: summary.executed, icon: CheckCircle2 },
          { label: 'تم الرد', value: summary.responded, icon: MessageCircleReply },
          { label: '+500', value: summary.plus500, icon: BadgeDollarSign },
          { label: 'إبلاغ نقاط', value: summary.points, icon: Gift },
          { label: 'VIP', value: summary.vip, icon: UsersRound },
          { label: 'شراء بعد المتابعة', value: summary.purchases, icon: ShoppingCart },
          { label: 'قيمة الشراء', value: money(summary.purchaseValue), icon: Sparkles },
        ].map(({ label, value, icon: Icon }) => <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.04] p-3"><div className="flex items-center gap-2 text-[11px] font-black text-slate-400"><Icon size={14} className="text-cyan-300"/>{label}</div><div className="mt-2 text-xl font-black text-white">{value}</div></div>)}
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-2">
        {staff.map((item, index) => {
          const isOpen = expanded === item.key;
          return <article key={item.key} className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.035]">
            <div className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><div className="text-lg font-black text-white">#{index + 1} {item.name}</div><div className="mt-1 text-xs font-bold text-slate-400">{item.branch} · {item.activeDays} يوم نشاط · متوسط {item.avgPerActiveDay} متابعة/يوم</div></div>
                <div className="flex flex-wrap gap-2"><span className="rounded-full border border-cyan-300/20 bg-cyan-400/10 px-3 py-1 text-sm font-black text-cyan-200">{item.score}/100</span>{item.provisional ? <span className="rounded-full border border-amber-300/20 bg-amber-400/10 px-2 py-1 text-[10px] font-black text-amber-200">تقييم مبدئي</span> : null}</div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
                <div className="rounded-xl bg-white/5 p-2.5"><div className="text-[10px] font-bold text-slate-400">التنفيذ</div><div className="mt-1 font-black text-white">{item.executed}/{item.total} · {item.executionRate}%</div></div>
                <div className="rounded-xl bg-white/5 p-2.5"><div className="text-[10px] font-bold text-slate-400">الردود</div><div className="mt-1 font-black text-white">{item.responded} · {item.responseRate}%</div></div>
                <div className="rounded-xl bg-white/5 p-2.5"><div className="text-[10px] font-bold text-slate-400">المكتمل</div><div className="mt-1 font-black text-white">{item.completed} · {item.completionRate}%</div></div>
                <div className="rounded-xl bg-white/5 p-2.5"><div className="text-[10px] font-bold text-slate-400">متابعة قادمة</div><div className="mt-1 font-black text-white">{item.scheduled}</div></div>
                <div className="rounded-xl border border-emerald-300/10 bg-emerald-400/[0.05] p-2.5"><div className="text-[10px] font-bold text-emerald-200">+500</div><div className="mt-1 font-black text-white">{item.plus500}</div></div>
                <div className="rounded-xl border border-cyan-300/10 bg-cyan-400/[0.05] p-2.5"><div className="text-[10px] font-bold text-cyan-200">إبلاغ نقاط</div><div className="mt-1 font-black text-white">{item.points}</div></div>
                <div className="rounded-xl border border-amber-300/10 bg-amber-400/[0.05] p-2.5"><div className="text-[10px] font-bold text-amber-200">VIP</div><div className="mt-1 font-black text-white">{item.vip}</div></div>
                <div className="rounded-xl border border-fuchsia-300/10 bg-fuchsia-400/[0.05] p-2.5"><div className="text-[10px] font-bold text-fuchsia-200">شراء بعد المتابعة</div><div className="mt-1 font-black text-white">{item.purchases} · {money(item.purchaseValue)}</div></div>
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/10 p-3">
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-bold text-slate-300">
                  <span><FileSpreadsheet size={13} className="ml-1 inline text-emerald-300"/>مستورد من Excel: {item.imported}</span>
                  <span><Clock3 size={13} className="ml-1 inline text-cyan-300"/>له وقت قابل لقياس السرعة: {item.timestamped}</span>
                  <span><PhoneCall size={13} className="ml-1 inline text-rose-300"/>لم يرد: {item.noAnswer}</span>
                </div>
                <div className="rounded-lg bg-emerald-400/10 px-3 py-2 text-xs font-black text-emerald-200">الحافز المقترح: {item.incentive} جنيه</div>
              </div>

              <button type="button" onClick={() => setExpanded(isOpen ? null : item.key)} className="mt-3 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-black text-slate-200 hover:bg-white/10">{isOpen ? 'إخفاء الأداء اليومي' : 'عرض الأداء يومًا بيوم'}</button>
            </div>

            {isOpen ? <div className="border-t border-white/10 bg-black/10 p-3">
              <div className="overflow-x-auto rounded-xl border border-white/10">
                <table className="min-w-[900px] w-full text-xs">
                  <thead className="bg-[#102941] text-slate-300"><tr>{['التاريخ','الإجمالي','منفذ','رد','مكتمل','+500','نقاط','VIP','شراء','قيمة الشراء'].map((h) => <th key={h} className="p-2 text-center font-black">{h}</th>)}</tr></thead>
                  <tbody>{item.daily.map((day) => <tr key={day.date} className="border-t border-white/5 text-slate-200"><td className="p-2 text-center font-black text-white"><CalendarDays size={13} className="ml-1 inline text-cyan-300"/>{day.date}</td>{[day.total,day.executed,day.responded,day.completed,day.plus500,day.points,day.vip,day.purchases].map((v, i) => <td key={i} className="p-2 text-center font-bold">{v}</td>)}<td className="p-2 text-center font-black text-emerald-200">{money(day.purchaseValue)}</td></tr>)}</tbody>
                </table>
              </div>
            </div> : null}
          </article>;
        })}
      </div>

      {!loading && !staff.length ? <div className="mt-4 rounded-2xl border border-white/10 p-8 text-center text-slate-400">لا توجد بيانات أداء في الشهر والفرع المحددين.</div> : null}
      {loading ? <div className="mt-4 text-center font-black text-cyan-200">جارٍ تحميل الأداء...</div> : null}
    </section>
  );
}
