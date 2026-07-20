import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, DatabaseZap, Loader2, MessageCircle, RefreshCw } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { normalizeBranchName } from '@/lib/branch';
import { canViewAllBranches } from '@/lib/security/userDataScope';
import { supabase } from '@/lib/supabase';

const ALL_BRANCHES = 'كل الفروع';
const OPEN = ['pending','معلق','مؤجل','لم يرد','في انتظار الرد','تم إرسال رسالة','waiting_reply','message_sent','no_answer'];
const WAITING = ['في انتظار الرد','تم إرسال رسالة','waiting_reply','message_sent'];
const NO_ANSWER = ['لم يرد','no_answer'];
const text = (v: unknown) => String(v ?? '').trim();
const statusOf = (r: Record<string, unknown>) => text(r.contact_status || r.followup_status || r.response_status || r.status || r.followup_result);
const localDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };

export default function CustomerServiceCommandOverview() {
  const { user } = useAuth();
  const manager = canViewAllBranches(user);
  const userBranch = normalizeBranchName(user?.branch || '');
  const [branch, setBranch] = useState(manager ? ALL_BRANCHES : userBranch);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!manager && !userBranch) return;
    setLoading(true);
    try {
      let query = supabase.from('daily_followups')
        .select('id,branch,status,followup_status,contact_status,response_status,followup_result,next_followup_date,contacted_at,created_at,needs_manager,data_quality_status,data_issues,customer_code,customer_phone,phone,completed_at,is_hidden')
        .eq('is_hidden', false).is('completed_at', null).limit(5000);
      if (branch !== ALL_BRANCHES) query = query.eq('branch', branch);
      const { data, error } = await query;
      if (error) throw error;
      setRows((data || []) as Record<string, unknown>[]);
    } finally { setLoading(false); }
  }, [branch, manager, userBranch]);

  useEffect(() => { void load(); }, [load]);

  const stats = useMemo(() => {
    const today = localDate();
    let open = 0, waiting = 0, noAnswer = 0, overdue = 0, managerNeeded = 0, badData = 0;
    for (const row of rows) {
      const status = statusOf(row);
      if (OPEN.includes(status) || !status) open += 1;
      if (WAITING.includes(status)) waiting += 1;
      if (NO_ANSWER.includes(status)) noAnswer += 1;
      if (text(row.next_followup_date) && text(row.next_followup_date).slice(0,10) < today) overdue += 1;
      if (row.needs_manager === true) managerNeeded += 1;
      const phone = text(row.customer_phone || row.phone).replace(/\D/g,'').replace(/^20(?=1\d{9}$)/,'');
      if (!text(row.customer_code) || !/^01[0125]\d{8}$/.test(phone)) badData += 1;
    }
    return { open, waiting, noAnswer, overdue, managerNeeded, badData };
  }, [rows]);

  const cards = [
    ['مفتوح الآن', stats.open, Clock3], ['انتظار رد', stats.waiting, MessageCircle], ['لم يرد', stats.noAnswer, AlertTriangle],
    ['متأخر', stats.overdue, Clock3], ['يحتاج مديرًا', stats.managerNeeded, AlertTriangle], ['مراجعة بيانات', stats.badData, DatabaseZap],
  ] as const;

  return <section className="mx-4 mt-4 rounded-3xl border border-cyan-400/20 bg-[#0a1d30] p-4" dir="rtl">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-xl font-black text-white">مركز قيادة خدمة العملاء</h2><p className="mt-1 text-xs font-bold text-slate-400">ملخص حي قبل بدء العمل — الفرع والحالات المتأخرة وجودة البيانات.</p></div>
      <div className="flex gap-2">{manager ? <select className="input-dark" value={branch} onChange={(e)=>setBranch(e.target.value)}><option>{ALL_BRANCHES}</option><option>فرع الشامي</option><option>فرع شكري</option></select> : <div className="input-dark font-black">{userBranch}</div>}<button className="btn-secondary" onClick={()=>void load()} disabled={loading}>{loading ? <Loader2 className="animate-spin" size={16}/> : <RefreshCw size={16}/>}</button></div>
    </div>
    <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">{cards.map(([label,value,Icon])=><div key={label} className="rounded-2xl border border-white/10 bg-white/[0.035] p-3"><Icon size={17} className="text-cyan-300"/><div className="mt-2 text-xs font-black text-slate-400">{label}</div><div className="text-2xl font-black text-white">{value}</div></div>)}</div>
    {!loading && stats.overdue === 0 && stats.managerNeeded === 0 ? <div className="mt-3 flex items-center gap-2 rounded-2xl bg-emerald-500/10 px-3 py-2 text-xs font-black text-emerald-200"><CheckCircle2 size={16}/> لا توجد حالات متأخرة أو تصعيد مدير في النطاق الحالي.</div> : null}
  </section>;
}
