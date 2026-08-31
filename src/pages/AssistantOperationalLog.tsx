import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock, Loader2, PackageCheck, PlusCircle, Repeat, Send, Trophy, Users } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { Panel, SectionTitle, MiniBox, EmptyState } from '@/components/dashboard/DashboardPrimitives';

// المسؤولات الثلاث المخوّل لهم استخدام الصفحة دي فقط — مطابق لجدول
// assistant_operational_eligible_staff في قاعدة البيانات (هي المصدر الحقيقي
// للصلاحية؛ الفحص هنا مجرد واجهة أسرع، مش بديل عنه).
const ELIGIBLE_STAFF_IDS = new Set([
  '82b9c2a1-6139-4b07-9937-ef80a6e926d8', // نور
  'e3640642-5c60-4815-8001-1bb93193668f', // هاجر
  'dea91886-1ae8-4766-a166-9952866a5024', // هبة حماده
]);

const BRANCHES = ['فرع شكري', 'فرع الشامي'] as const;
type Branch = (typeof BRANCHES)[number];

type TaskType = 'supplier_order' | 'branch_transfer' | 'followup_execution' | 'request_fulfillment' | 'exceptional_followup';

type StageOption = { stage: string; label: string; points: number; requiresInvoice?: boolean; deadlineDays?: number };

type TaskTypeConfig = {
  label: string;
  hint: string;
  icon: typeof PackageCheck;
  requiresCase: boolean;
  stages: StageOption[];
};

const TASK_CONFIG: Record<TaskType, TaskTypeConfig> = {
  supplier_order: {
    label: 'تجهيز وإرسال طلبية مورد',
    hint: 'حدث واحد — بمجرد التجهيز والإرسال',
    icon: PackageCheck,
    requiresCase: false,
    stages: [{ stage: 'sent', label: 'تم التجهيز والإرسال', points: 8 }],
  },
  branch_transfer: {
    label: 'تحويل صنف بين الفرعين',
    hint: 'حدث واحد — بمجرد تنفيذ التحويل',
    icon: Repeat,
    requiresCase: false,
    stages: [{ stage: 'transferred', label: 'تم تنفيذ التحويل', points: 2 }],
  },
  followup_execution: {
    label: 'متابعة عميل تنفّذها بنفسك',
    hint: 'منفصلة عن نقاط الدكتور اللي سجّل الطلب أصلاً',
    icon: Users,
    requiresCase: true,
    stages: [
      { stage: 'executed', label: 'تم تنفيذ المتابعة', points: 5 },
      { stage: 'purchased', label: 'العميل اشترى (خلال 3 أيام من أول إجراء)', points: 15, requiresInvoice: true, deadlineDays: 3 },
    ],
  },
  request_fulfillment: {
    label: 'تنفيذ طلب عميل (صنف مطلوب)',
    hint: 'تسجيل ← توفير ← إبلاغ الفرع ← شراء',
    icon: PackageCheck,
    requiresCase: true,
    stages: [
      { stage: 'logged', label: 'تسجيل الطلب', points: 1 },
      { stage: 'sourced', label: 'تم التوفير من المخازن', points: 2 },
      { stage: 'branch_notified', label: 'تم إبلاغ الفرع بالوصول', points: 3 },
      { stage: 'purchased', label: 'العميل اشترى (برقم فاتورة)', points: 6, requiresInvoice: true, deadlineDays: 3 },
    ],
  },
  exceptional_followup: {
    label: 'متابعة استثنائية (من مراجعة محادثات)',
    hint: 'تنفيذ ← رد العميل ← شراء خلال يومين بالظبط',
    icon: Clock,
    requiresCase: true,
    stages: [
      { stage: 'executed', label: 'تم تنفيذ المتابعة', points: 2 },
      { stage: 'customer_replied', label: 'العميل رد', points: 4 },
      { stage: 'exceptional_purchased', label: 'العميل اشترى (خلال يومين بالظبط)', points: 7, requiresInvoice: true, deadlineDays: 2 },
    ],
  },
};

const TASK_ORDER: TaskType[] = ['supplier_order', 'branch_transfer', 'followup_execution', 'request_fulfillment', 'exceptional_followup'];

type LogRow = {
  id: string;
  task_type: TaskType;
  stage: string;
  branch: string | null;
  case_key: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  purchase_invoice_no: string | null;
  target_cumulative_points: number | null;
  review_status: 'pending' | 'approved' | 'rejected';
  reviewer_note: string | null;
  points_awarded: number | null;
  logged_at: string;
};

type LeaderboardRow = {
  staff_id: string;
  staff_name: string;
  branch: string | null;
  total_points: number;
};

type CaseRow = {
  case_key: string;
  task_type: TaskType;
  branch: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  current_cumulative_points: number;
  first_action_at: string;
  last_action_at: string;
};

const STATUS_LABEL: Record<LogRow['review_status'], { label: string; color: string; bg: string; borderColor: string }> = {
  pending: { label: 'بانتظار اعتماد مدير الفروع', color: 'var(--dawaa-status-warning-text)', bg: 'var(--dawaa-status-warning-bg)', borderColor: 'var(--dawaa-status-warning-border)' },
  approved: { label: 'معتمد', color: 'var(--dawaa-status-success-text)', bg: 'var(--dawaa-status-success-bg)', borderColor: 'var(--dawaa-status-success-border)' },
  rejected: { label: 'مرفوض', color: 'var(--dawaa-status-danger-text)', bg: 'var(--dawaa-status-danger-bg)', borderColor: 'var(--dawaa-status-danger-border)' },
};

const MAX_CASE_POINTS: Record<TaskType, number> = {
  supplier_order: 8,
  branch_transfer: 2,
  followup_execution: 15,
  request_fulfillment: 6,
  exceptional_followup: 7,
};

function friendlyError(message: string): string {
  if (message.includes('purchase_invoice_required')) return 'لازم تكتب رقم الفاتورة قبل ما تسجّل خطوة الشراء.';
  if (message.includes('purchase_window_expired')) return 'المهلة الزمنية للشراء خلصت — الحالة دي معدّاها الميعاد.';
  if (message.includes('case_key required')) return 'محتاج تختار حالة مفتوحة أو تبدأ حالة جديدة الأول.';
  if (message.includes('not enabled for this staff member')) return 'الصفحة دي مقصورة على نور وهاجر وهبة حماده فقط.';
  return message;
}

export default function AssistantOperationalLog() {
  const { user } = useAuth();
  const staffId = user?.staffId || user?.id || '';
  const isEligible = ELIGIBLE_STAFF_IDS.has(staffId);

  const [taskType, setTaskType] = useState<TaskType>('supplier_order');
  const [stage, setStage] = useState<string>(TASK_CONFIG.supplier_order.stages[0].stage);
  const [branch, setBranch] = useState<Branch>('فرع شكري');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [referenceNote, setReferenceNote] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [selectedCaseKey, setSelectedCaseKey] = useState<string>('');
  const [startingNewCase, setStartingNewCase] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [logs, setLogs] = useState<LogRow[]>([]);
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const config = TASK_CONFIG[taskType];
  const stageConfig = config.stages.find((s) => s.stage === stage) || config.stages[0];

  const load = useCallback(async () => {
    if (!isEligible) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(false);
    const [logsRes, casesRes, leaderboardRes] = await Promise.all([
      supabase.rpc('list_my_assistant_operational_logs_v1', { p_limit: 30 }),
      supabase.rpc('list_my_assistant_open_cases_v1'),
      supabase.rpc('get_assistant_operational_leaderboard_v1'),
    ]);
    if (logsRes.error || casesRes.error) {
      setLoadError(true);
      setLoading(false);
      return;
    }
    setLogs((logsRes.data || []) as LogRow[]);
    setCases((casesRes.data || []) as CaseRow[]);
    if (!leaderboardRes.error) {
      setLeaderboard((leaderboardRes.data || []) as LeaderboardRow[]);
    }
    setLoading(false);
  }, [isEligible]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCasesForType = useMemo(
    () => cases.filter((c) => c.task_type === taskType && c.current_cumulative_points < MAX_CASE_POINTS[taskType]),
    [cases, taskType]
  );

  const handleTaskTypeChange = (next: TaskType) => {
    setTaskType(next);
    setStage(TASK_CONFIG[next].stages[0].stage);
    setSelectedCaseKey('');
    setStartingNewCase(false);
    setInvoiceNo('');
  };

  const handleSubmit = useCallback(async () => {
    if (!isEligible) return;
    let caseKey: string | null = null;
    if (config.requiresCase) {
      if (startingNewCase) {
        if (!customerName.trim() && !customerPhone.trim()) {
          toast.error('محتاج اسم أو رقم العميل عشان تبدأ حالة جديدة.');
          return;
        }
        caseKey = `${taskType}_${staffId}_${Date.now()}`;
      } else if (selectedCaseKey) {
        caseKey = selectedCaseKey;
      } else {
        toast.error('اختار حالة مفتوحة أو ابدأ حالة جديدة.');
        return;
      }
    }
    if (stageConfig.requiresInvoice && !invoiceNo.trim()) {
      toast.error('محتاج رقم الفاتورة عشان تسجّل خطوة الشراء.');
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase.rpc('submit_my_assistant_operational_log_v1', {
        p_task_type: taskType,
        p_stage: stage,
        p_branch: branch,
        p_case_key: caseKey,
        p_customer_name: customerName.trim() || null,
        p_customer_phone: customerPhone.trim() || null,
        p_reference_note: referenceNote.trim() || null,
        p_purchase_invoice_no: invoiceNo.trim() || null,
      });
      if (error) throw error;
      toast.success('اتسجل، وهيتراجع من مدير الفروع.');
      setCustomerName('');
      setCustomerPhone('');
      setReferenceNote('');
      setInvoiceNo('');
      setSelectedCaseKey('');
      setStartingNewCase(false);
      await load();
    } catch (err) {
      toast.error(friendlyError(err instanceof Error ? err.message : 'حصل خطأ في الحفظ'));
    } finally {
      setSubmitting(false);
    }
  }, [isEligible, config.requiresCase, startingNewCase, customerName, customerPhone, selectedCaseKey, stageConfig.requiresInvoice, invoiceNo, taskType, stage, branch, referenceNote, staffId, load]);

  if (!isEligible) {
    return (
      <div className="p-6 text-center text-sm font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
        الصفحة دي مقصورة على نور وهاجر وهبة حماده فقط.
      </div>
    );
  }

  const pendingCount = logs.filter((l) => l.review_status === 'pending').length;
  const approvedPoints = logs.filter((l) => l.review_status === 'approved').reduce((sum, l) => sum + (l.points_awarded || 0), 0);

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-4 pb-24" dir="rtl">
      <div>
        <h1 className="text-xl font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>تسجيل عمليات المشتريات وخدمة العملاء</h1>
        <p className="mt-1 text-sm font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
          سجّل كل عملية بمجرد تنفيذها — هتتراجع من مدير الفروع قبل ما تتحول لنقاط حقيقية.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-2">
        <MiniBox label="بانتظار المراجعة" value={String(pendingCount)} tone="amber" />
        <MiniBox label="نقاط معتمدة (آخر 30 عملية)" value={String(approvedPoints)} tone="green" />
      </div>

      {leaderboard.length > 0 ? (
        <Panel className="p-4">
          <SectionTitle title="ترتيب الشهر" subtitle="نقاط معتمدة من عمليات المشتريات وخدمة العملاء فقط" icon={<Trophy size={18} />} />
          <div className="space-y-2">
            {leaderboard.map((row, index) => (
              <div
                key={row.staff_id}
                className="flex items-center justify-between gap-3 rounded-xl border p-3"
                style={{
                  borderColor: row.staff_id === staffId ? 'var(--dawaa-theme-primary)' : 'var(--dawaa-theme-border)',
                  background: row.staff_id === staffId ? 'var(--dawaa-theme-soft)' : 'transparent',
                }}
              >
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-black" style={{ background: 'var(--dawaa-theme-soft)', color: 'var(--dawaa-theme-primary-strong)' }}>
                    {index + 1}
                  </span>
                  <span className="font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>{row.staff_name}</span>
                </div>
                <span className="text-sm font-black" style={{ color: 'var(--dawaa-status-success-text)' }}>{row.total_points} نقطة</span>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}

      <Panel className="p-4 space-y-4">
        <SectionTitle title="تسجيل عملية جديدة" icon={<Send size={18} />} />

        <div>
          <p className="mb-2 text-xs font-black" style={{ color: 'var(--dawaa-theme-muted)' }}>نوع العملية</p>
          <div className="grid grid-cols-1 gap-2">
            {TASK_ORDER.map((t) => {
              const c = TASK_CONFIG[t];
              const Icon = c.icon;
              const active = t === taskType;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => handleTaskTypeChange(t)}
                  className="flex items-center gap-3 rounded-xl border p-3 text-right transition"
                  style={{
                    borderColor: active ? 'var(--dawaa-theme-primary)' : 'var(--dawaa-theme-border)',
                    background: active ? 'var(--dawaa-theme-soft)' : 'transparent',
                  }}
                >
                  <Icon size={18} style={{ color: 'var(--dawaa-theme-primary-strong)' }} />
                  <div className="flex-1">
                    <p className="font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>{c.label}</p>
                    <p className="text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>{c.hint}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-black" style={{ color: 'var(--dawaa-theme-muted)' }}>الفرع</p>
          <div className="flex gap-2">
            {BRANCHES.map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setBranch(b)}
                className="flex-1 rounded-xl border py-2 text-sm font-black transition"
                style={{
                  borderColor: branch === b ? 'var(--dawaa-theme-primary)' : 'var(--dawaa-theme-border)',
                  background: branch === b ? 'var(--dawaa-theme-soft)' : 'transparent',
                  color: 'var(--dawaa-theme-heading)',
                }}
              >
                {b}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-black" style={{ color: 'var(--dawaa-theme-muted)' }}>المرحلة</p>
          <div className="space-y-2">
            {config.stages.map((s) => (
              <button
                key={s.stage}
                type="button"
                onClick={() => setStage(s.stage)}
                className="flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-right transition"
                style={{
                  borderColor: stage === s.stage ? 'var(--dawaa-theme-primary)' : 'var(--dawaa-theme-border)',
                  background: stage === s.stage ? 'var(--dawaa-theme-soft)' : 'transparent',
                }}
              >
                <span className="font-bold" style={{ color: 'var(--dawaa-theme-text)' }}>{s.label}</span>
                <span className="shrink-0 text-xs font-black" style={{ color: 'var(--dawaa-status-success-text)' }}>+{s.points} إجمالي</span>
              </button>
            ))}
          </div>
        </div>

        {config.requiresCase ? (
          <div className="space-y-2 rounded-xl border p-3" style={{ borderColor: 'var(--dawaa-theme-border)' }}>
            <p className="text-xs font-black" style={{ color: 'var(--dawaa-theme-muted)' }}>الحالة</p>
            {openCasesForType.length > 0 && !startingNewCase ? (
              <div className="space-y-2">
                {openCasesForType.map((c) => (
                  <button
                    key={c.case_key}
                    type="button"
                    onClick={() => setSelectedCaseKey(c.case_key)}
                    className="flex w-full items-center justify-between gap-2 rounded-lg border p-2 text-right text-sm"
                    style={{
                      borderColor: selectedCaseKey === c.case_key ? 'var(--dawaa-theme-primary)' : 'var(--dawaa-theme-border)',
                      background: selectedCaseKey === c.case_key ? 'var(--dawaa-theme-soft)' : 'transparent',
                    }}
                  >
                    <span className="font-bold">{c.customer_name || c.customer_phone || 'حالة بدون اسم'}</span>
                    <span className="text-xs font-black" style={{ color: 'var(--dawaa-theme-muted)' }}>{c.current_cumulative_points}/{MAX_CASE_POINTS[taskType]} نقطة</span>
                  </button>
                ))}
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setStartingNewCase(true);
                setSelectedCaseKey('');
              }}
              className="flex items-center gap-2 text-sm font-black"
              style={{ color: 'var(--dawaa-theme-primary-strong)' }}
            >
              <PlusCircle size={16} /> بدء حالة جديدة
            </button>
            {startingNewCase ? (
              <div className="space-y-2 pt-1">
                <input
                  type="text"
                  className="input-dark w-full text-sm"
                  placeholder="اسم العميل"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                />
                <input
                  type="text"
                  className="input-dark w-full text-sm"
                  placeholder="رقم العميل"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                />
              </div>
            ) : null}
          </div>
        ) : null}

        {stageConfig.requiresInvoice ? (
          <div>
            <p className="mb-2 text-xs font-black" style={{ color: 'var(--dawaa-theme-muted)' }}>
              رقم الفاتورة (إجباري{stageConfig.deadlineDays ? ` — خلال ${stageConfig.deadlineDays} ${stageConfig.deadlineDays === 2 ? 'يومين بالظبط' : 'أيام من أول إجراء'}` : ''})
            </p>
            <input
              type="text"
              className="input-dark w-full text-sm"
              placeholder="رقم الفاتورة"
              value={invoiceNo}
              onChange={(e) => setInvoiceNo(e.target.value)}
            />
          </div>
        ) : null}

        <div>
          <p className="mb-2 text-xs font-black" style={{ color: 'var(--dawaa-theme-muted)' }}>ملاحظة (اختياري)</p>
          <input
            type="text"
            className="input-dark w-full text-sm"
            placeholder="ملاحظة سريعة..."
            value={referenceNote}
            onChange={(e) => setReferenceNote(e.target.value)}
          />
        </div>

        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={submitting}
          className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-black text-white transition"
          style={{ background: 'var(--dawaa-theme-primary)' }}
        >
          {submitting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          تسجيل العملية
        </button>
      </Panel>

      <Panel className="p-4">
        <SectionTitle title="آخر العمليات" icon={<CheckCircle2 size={18} />} />
        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="animate-spin" style={{ color: 'var(--dawaa-theme-muted)' }} /></div>
        ) : loadError ? (
          <EmptyState label="تعذّر تحميل العمليات" error onRetry={() => void load()} />
        ) : logs.length === 0 ? (
          <EmptyState label="لسه مفيش عمليات مسجّلة" />
        ) : (
          <div className="space-y-2">
            {logs.map((l) => {
              const status = STATUS_LABEL[l.review_status];
              return (
                <div key={l.id} className="rounded-xl border p-3" style={{ borderColor: 'var(--dawaa-theme-border)' }}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>
                      {TASK_CONFIG[l.task_type]?.label || l.task_type} — {TASK_CONFIG[l.task_type]?.stages.find((s) => s.stage === l.stage)?.label || l.stage}
                    </p>
                    <span className="shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-black" style={{ borderColor: status.borderColor, background: status.bg, color: status.color }}>
                      {status.label}
                    </span>
                  </div>
                  {l.customer_name || l.customer_phone ? (
                    <p className="mt-1 text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>{l.customer_name} {l.customer_phone}</p>
                  ) : null}
                  {l.review_status === 'rejected' && l.reviewer_note ? (
                    <p className="mt-1 text-xs font-bold" style={{ color: 'var(--dawaa-status-danger-text)' }}>سبب الرفض: {l.reviewer_note}</p>
                  ) : null}
                  {l.review_status === 'approved' ? (
                    <p className="mt-1 text-xs font-black" style={{ color: 'var(--dawaa-status-success-text)' }}>+{l.points_awarded} نقطة</p>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}
