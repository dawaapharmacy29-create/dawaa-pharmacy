const fs = require('fs');
const path = require('path');

function patchFile(relativePath, replacements) {
  const filePath = path.join(process.cwd(), relativePath);
  let source = fs.readFileSync(filePath, 'utf8');
  for (const { before, after, label } of replacements) {
    if (source.includes(after)) continue;
    if (!source.includes(before)) throw new Error(`${relativePath}: ${label}`);
    source = source.replace(before, after);
  }
  fs.writeFileSync(filePath, source);
}

patchFile('src/components/layout/Sidebar.tsx', [
  {
    label: 'doctor customer links',
    before: `{ path: '/customer-service?quickFollowup=1', icon: HeadphonesIcon, label: 'متابعة العملاء', permission: 'view_customer_service' },`,
    after: `{ path: '/doctor-dashboard?section=followups', icon: HeadphonesIcon, label: 'متابعاتي المطلوبة', permission: 'view_doctor_dashboard' },
      { path: '/customers', icon: Users, label: 'بحث العملاء', permission: 'view_customers' },`,
  },
  {
    label: 'nav scroll state imports',
    before: `import { useEffect, useMemo, useState, type ElementType } from 'react';`,
    after: `import { useEffect, useMemo, useRef, useState, type ElementType } from 'react';`,
  },
  {
    label: 'nav ref state',
    before: `  const pendingShiftNotes = usePendingShiftNotesCount();`,
    after: `  const pendingShiftNotes = usePendingShiftNotesCount();
  const navRef = useRef<HTMLElement | null>(null);`,
  },
  {
    label: 'restore navigation scroll',
    before: `  const toggleGroup = (title: string) => {`,
    after: `  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const stored = Number(sessionStorage.getItem('dawaa.sidebar.scrollTop') || 0);
    nav.scrollTop = stored;
    const active = nav.querySelector('.nav-item-active');
    if (active instanceof HTMLElement) active.scrollIntoView({ block: 'nearest' });
    const save = () => sessionStorage.setItem('dawaa.sidebar.scrollTop', String(nav.scrollTop));
    nav.addEventListener('scroll', save, { passive: true });
    return () => nav.removeEventListener('scroll', save);
  }, [location.pathname]);

  const toggleGroup = (title: string) => {`,
  },
  {
    label: 'nav ref binding',
    before: `<nav className="flex-1 space-y-2 overflow-y-auto p-3" id="sidebar-nav">`,
    after: `<nav ref={navRef} className="flex-1 space-y-2 overflow-y-auto p-3" id="sidebar-nav">`,
  },
]);

patchFile('src/pages/Schedule.tsx', [
  {
    label: 'schedule auth imports',
    before: `import { toast } from 'sonner';`,
    after: `import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { isDoctorRole } from '@/lib/security/userDataScope';`,
  },
  {
    label: 'doctor schedule scope',
    before: `export default function Schedule() {
  const [branchFilter, setBranchFilter] = useState('الكل');`,
    after: `export default function Schedule() {
  const { user } = useAuth();
  const doctorView = isDoctorRole(user);
  const [branchFilter, setBranchFilter] = useState('الكل');`,
  },
  {
    label: 'filter own schedule',
    before: `      e.status === 'نشط' &&
      (branchFilter === 'الكل' || normalizeBranch(e.branch) === branchFilter) &&`,
    after: `      e.status === 'نشط' &&
      (!doctorView || e.id === (user?.staffId || user?.id)) &&
      (doctorView || branchFilter === 'الكل' || normalizeBranch(e.branch) === branchFilter) &&`,
  },
  {
    label: 'hide branch filters',
    before: `        <div className="mr-auto flex gap-2 flex-wrap">
          {['الكل', ...BRANCHES].map((b) => (`,
    after: `        {!doctorView && <div className="mr-auto flex gap-2 flex-wrap">
          {['الكل', ...BRANCHES].map((b) => (`,
  },
  {
    label: 'close branch filters wrapper',
    before: `          ))}
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">`,
    after: `          ))}
        </div>}
      </div>

      {!doctorView && <div className="flex gap-2 flex-wrap">`,
  },
  {
    label: 'close role filters wrapper',
    before: `        ))}
      </div>

      <div className="bg-[#1B2B4B`,
    after: `        ))}
      </div>}

      <div className="bg-[#1B2B4B`,
  },
]);

patchFile('src/pages/DoctorDashboard.tsx', [
  {
    label: 'followup icon import',
    before: `  Wallet,
} from 'lucide-react';`,
    after: `  Wallet,
  Send,
} from 'lucide-react';`,
  },
  {
    label: 'followup row type',
    before: `interface IncentiveMedicine {`,
    after: `interface MyFollowupRow {
  id: string;
  customer_name?: string | null;
  customer_code?: string | null;
  branch?: string | null;
  request_type?: string | null;
  request_details?: string | null;
  notes?: string | null;
  followup_status?: string | null;
  status?: string | null;
  contact_result?: string | null;
  followup_result?: string | null;
  responsible_name?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  completed_at?: string | null;
  needs_manager?: boolean | null;
}

interface IncentiveMedicine {`,
  },
  {
    label: 'own followup query',
    before: `  const { data: incentiveMedicines } = useSupabaseQuery<IncentiveMedicine>({`,
    after: `  const { data: myFollowups, loading: myFollowupsLoading, refetch: refetchMyFollowups } = useSupabaseQuery<MyFollowupRow>({
    table: 'daily_followups',
    filters: [{ column: 'created_by', operator: 'eq', value: user?.id || effectiveId }],
    orderBy: { column: 'created_at', ascending: false },
    realtimeEnabled: true,
  });

  const { data: incentiveMedicines } = useSupabaseQuery<IncentiveMedicine>({`,
  },
  {
    label: 'followup reminder handler',
    before: `  async function handleCompleteTask(taskId: string) {`,
    after: `  async function remindCustomerService(followupId: string) {
    const { error } = await supabase
      .from('daily_followups')
      .update({ needs_manager: true, response_status: 'تنبيه من طالب المتابعة', updated_at: new Date().toISOString() })
      .eq('id', followupId);
    if (error) {
      toast.error('تعذر إرسال التنبيه لخدمة العملاء');
      return;
    }
    toast.success('تم إرسال تنبيه لخدمة العملاء لمراجعة المتابعة');
    refetchMyFollowups?.();
  }

  async function handleCompleteTask(taskId: string) {`,
  },
  {
    label: 'followup section before leaderboard',
    before: `      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,.85fr)]">`,
    after: `      <section id="my-followups" className="rounded-3xl border border-teal-400/20 bg-slate-900/65 p-5">
        <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-xs font-black text-teal-200">متابعاتي المطلوبة</div>
            <h2 className="mt-1 text-xl font-black text-white">نتيجة المتابعات التي طلبتها بنفسي</h2>
            <p className="mt-1 text-sm text-slate-300">تظهر ملاحظة الدكتور ونتيجة خدمة العملاء والمسؤول عن التنفيذ.</p>
          </div>
          <button className="btn-primary" onClick={() => window.dispatchEvent(new CustomEvent('openQuickFollowup'))}>طلب متابعة سريعة</button>
        </div>
        {myFollowupsLoading ? (
          <div className="py-8 text-center text-slate-400">جاري تحميل متابعاتك…</div>
        ) : !myFollowups?.length ? (
          <div className="rounded-2xl border border-white/10 p-5 text-center text-slate-400">لم تطلب متابعات حتى الآن.</div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {myFollowups.slice(0, 12).map((row) => {
              const done = Boolean(row.completed_at) || ['تم', 'completed', 'done'].includes(String(row.followup_status || row.status || '').toLowerCase());
              return (
                <div key={row.id} className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-black text-white">{row.customer_name || 'عميل بدون اسم'}</div>
                      <div className="mt-1 text-xs text-slate-400">{[row.customer_code, row.branch].filter(Boolean).join(' — ')}</div>
                    </div>
                    <span className={done ? 'rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-black text-emerald-300' : 'rounded-full bg-amber-500/15 px-3 py-1 text-xs font-black text-amber-300'}>{done ? 'تمت المتابعة' : 'قيد المتابعة'}</span>
                  </div>
                  <div className="mt-3 space-y-2 text-sm text-slate-200">
                    <div><span className="font-black text-teal-200">طلبي:</span> {row.request_details || row.notes || row.request_type || '—'}</div>
                    <div><span className="font-black text-sky-200">نتيجة خدمة العملاء:</span> {row.followup_result || row.contact_result || 'لم تسجل نتيجة بعد'}</div>
                    <div><span className="font-black text-violet-200">المسؤول:</span> {row.responsible_name || 'لم يتم التحديد'}</div>
                  </div>
                  {!done && (
                    <button onClick={() => void remindCustomerService(row.id)} className="btn-secondary mt-3 flex items-center gap-2">
                      <Send size={15} /> تنبيه خدمة العملاء
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,.85fr)]">`,
  },
]);

console.log('[doctor-workspace-followups-navigation] applied');
