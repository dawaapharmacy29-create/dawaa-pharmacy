import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, FileSpreadsheet, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { EmptyState, Panel, SectionTitle } from '@/components/dashboard/DashboardPrimitives';
import { isBranchManagerRole, useAuth } from '@/hooks/useAuth';
import { normalizeBranchName } from '@/lib/branch';
import { BRANCHES } from '@/lib/constants';
import { canSeeAllBranches } from '@/lib/core/branchScope';
import {
  REVIEW_RESULT_LABELS,
  WEEKLY_COUNT_STATUS_LABELS,
  createWeeklyCount,
  listWeeklyCountItems,
  listWeeklyCountSessions,
  readWeeklyCountFile,
  reviewWeeklyCount,
  saveCountedQuantities,
  submitWeeklyCount,
  weeklyCountErrorMessage,
  type ParsedWeeklyCountFile,
  type ReviewResult,
  type WeeklyCountItem,
  type WeeklyCountSession,
  type WeeklyCountStatus,
} from '@/lib/inventory/weeklyInventoryCounts';

// Weekly branch inventory: the week's items come from the pharmacy program's Excel, the assistants
// count, the branch manager reviews the differences and approves.

const CAIRO_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' });
const today = () => CAIRO_DAY.format(new Date());
const addDays = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 864e5).toISOString().slice(0, 10);
const fmt = (value: number | null | undefined) => (value === null || value === undefined ? '—' : Number(value).toLocaleString('ar-EG'));
const statusLabel = (status: string | null) => WEEKLY_COUNT_STATUS_LABELS[status as WeeklyCountStatus] || status || '—';
const inputClass =
  'rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] px-3 py-2 text-sm font-bold text-[var(--dawaa-theme-heading)]';
const buttonClass =
  'inline-flex items-center gap-2 rounded-xl border border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-surface)] px-4 py-2 text-sm font-black text-[var(--dawaa-theme-heading)] disabled:opacity-50';

type ReviewDraft = { result: ReviewResult; qty: string; reason: string };

export default function InventoryCounts() {
  const { user, checkPermission } = useAuth();
  const allBranches = canSeeAllBranches(user?.role);
  const ownBranch = BRANCHES.find((b) => normalizeBranchName(b) === normalizeBranchName(user?.branch || '')) || null;
  const [pickedBranch, setPickedBranch] = useState<string>(BRANCHES[0]);
  const branch = allBranches ? pickedBranch : ownBranch;
  // Planning and review: inventory managers, the branch manager and top management (enforced again by the RPCs).
  const canManage = checkPermission('manage_inventory') || isBranchManagerRole(user?.role) || allBranches;
  const [openId, setOpenId] = useState<string | null>(null);

  const sessions = useQuery({
    queryKey: ['weekly-inventory-sessions', branch],
    queryFn: () => listWeeklyCountSessions(branch),
    enabled: Boolean(branch),
  });

  if (!branch) {
    return (
      <div className="p-6">
        <EmptyState label="حسابك مش مربوط بفرع، كلم الإدارة." />
      </div>
    );
  }

  return (
    <div dir="rtl" className="space-y-4 p-4 md:p-6">
      <Panel className="p-5">
        <SectionTitle
          icon={<ClipboardList className="h-5 w-5" />}
          title="الجرد الأسبوعي للفرع"
          subtitle="أصناف الأسبوع ورصيدها من برنامج الصيدلية · المساعدين يجردوا · مدير الفرع يراجع الفروقات ويعتمد"
        />
        {allBranches ? (
          <select
            className={inputClass}
            value={pickedBranch}
            onChange={(e) => {
              setPickedBranch(e.target.value);
              setOpenId(null);
            }}
          >
            {BRANCHES.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        ) : (
          <span className="dawaa-badge dawaa-badge--info">{branch}</span>
        )}
      </Panel>

      {canManage ? <PlanWeek branch={branch} onCreated={(id) => setOpenId(id)} /> : null}

      <Panel className="p-5">
        <SectionTitle title="جرد الأسابيع" subtitle="اضغط على الأسبوع عشان تفتح أصنافه" />
        {sessions.isLoading ? <Loader2 className="mx-auto h-6 w-6 animate-spin" /> : null}
        {sessions.isError ? <EmptyState label="" error onRetry={() => sessions.refetch()} /> : null}
        {sessions.data && !sessions.data.length ? <EmptyState label="لسه مفيش جرد أسبوعي متسجل للفرع" /> : null}
        <div className="space-y-2">
          {(sessions.data || []).map((session) => (
            <div key={session.id} className="rounded-2xl border border-[var(--dawaa-theme-border)]">
              <button
                type="button"
                className="flex w-full flex-wrap items-center justify-between gap-2 p-3 text-right"
                onClick={() => setOpenId(openId === session.id ? null : session.id)}
              >
                <span className="text-sm font-black text-[var(--dawaa-theme-heading)]">{session.title || `أسبوع ${session.week_start}`}</span>
                <span className="dawaa-caption text-xs font-bold">
                  التسليم {session.due_date || '—'} · {statusLabel(session.status)}
                </span>
              </button>
              {openId === session.id ? <SessionDetail session={session} canManage={canManage} /> : null}
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function PlanWeek({ branch, onCreated }: { branch: string; onCreated: (id: string) => void }) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedWeeklyCountFile | null>(null);
  const [fileName, setFileName] = useState('');
  const [weekStart, setWeekStart] = useState(today());
  const [dueDate, setDueDate] = useState(addDays(today(), 3));

  const create = useMutation({
    mutationFn: () => createWeeklyCount({ branch, weekStart, dueDate, items: parsed?.items || [] }),
    onSuccess: (result) => {
      toast.success(`اتسجل جرد الأسبوع: ${result.items} صنف`);
      setParsed(null);
      setFileName('');
      if (fileRef.current) fileRef.current.value = '';
      queryClient.invalidateQueries({ queryKey: ['weekly-inventory-sessions'] });
      onCreated(result.session_id);
    },
    onError: (error) => toast.error(weeklyCountErrorMessage(error)),
  });

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const result = await readWeeklyCountFile(file);
      setParsed(result);
      setFileName(file.name);
      if (!result.columns.name || !result.columns.balance) toast.error('مش لاقي عمود «اسم الصنف» أو «الرصيد» في الملف');
    } catch {
      toast.error('تعذّر قراءة ملف الإكسيل');
    }
  };

  return (
    <Panel className="p-5">
      <SectionTitle
        icon={<FileSpreadsheet className="h-5 w-5" />}
        title={`جرد أسبوع جديد · ${branch}`}
        subtitle="ارفع ملف الإكسيل اللي طالع من برنامج الصيدلية: كود الصنف، اسم الصنف، الرصيد (والسعر لو موجود)"
      />
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-xs font-bold">
          <span className="block">ملف الأصناف</span>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className={inputClass} onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        <label className="space-y-1 text-xs font-bold">
          <span className="block">بداية الأسبوع</span>
          <input type="date" className={inputClass} value={weekStart} onChange={(e) => setWeekStart(e.target.value)} />
        </label>
        <label className="space-y-1 text-xs font-bold">
          <span className="block">آخر ميعاد للتسليم</span>
          <input type="date" className={inputClass} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </label>
        <button type="button" className={buttonClass} disabled={!parsed?.items.length || create.isPending} onClick={() => create.mutate()}>
          {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          سجّل جرد الأسبوع
        </button>
      </div>
      {parsed ? (
        <div className="dawaa-caption mt-3 space-y-1 text-xs font-bold">
          <p>
            {fileName}: {parsed.items.length} صنف جاهز
            {parsed.skipped ? ` · ${parsed.skipped} سطر اتساب (من غير اسم أو رصيد)` : ''}
            {parsed.duplicates ? ` · ${parsed.duplicates} صنف متكرر اتشال` : ''}
          </p>
          <p>
            الأعمدة: الكود «{parsed.columns.code || 'مش موجود'}» · الاسم «{parsed.columns.name || 'مش موجود'}» · الرصيد «
            {parsed.columns.balance || 'مش موجود'}» · السعر «{parsed.columns.price || 'مش موجود'}»
          </p>
        </div>
      ) : null}
    </Panel>
  );
}

function SessionDetail({ session, canManage }: { session: WeeklyCountSession; canManage: boolean }) {
  const queryClient = useQueryClient();
  const items = useQuery({ queryKey: ['weekly-inventory-items', session.id], queryFn: () => listWeeklyCountItems(session.id) });
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [reviews, setReviews] = useState<Record<string, ReviewDraft>>({});
  const open = session.status === 'planned' || session.status === 'counting';
  const reviewing = session.status === 'submitted' && canManage;
  const closed = session.status === 'closed';

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['weekly-inventory-items', session.id] });
    queryClient.invalidateQueries({ queryKey: ['weekly-inventory-sessions'] });
  };
  const fail = (error: unknown) => toast.error(weeklyCountErrorMessage(error));
  const pendingCounts = () =>
    Object.entries(counts)
      .filter(([, value]) => value.trim() !== '')
      .map(([item_id, actual_qty]) => ({ item_id, actual_qty: actual_qty.trim() }));

  const save = useMutation({
    mutationFn: () => saveCountedQuantities(session.id, pendingCounts()),
    onSuccess: (n) => {
      toast.success(`اتحفظ ${n} صنف`);
      setCounts({});
      refresh();
    },
    onError: fail,
  });
  const submit = useMutation({
    mutationFn: async () => {
      const unsaved = pendingCounts();
      if (unsaved.length) await saveCountedQuantities(session.id, unsaved);
      await submitWeeklyCount(session.id);
    },
    onSuccess: () => {
      toast.success('الجرد اتسلم لمدير الفرع');
      setCounts({});
      refresh();
    },
    onError: (error) => {
      fail(error);
      refresh();
    },
  });
  const decide = useMutation({
    mutationFn: (decision: 'approve' | 'return') =>
      reviewWeeklyCount(
        session.id,
        Object.entries(reviews).map(([item_id, r]) => ({
          item_id,
          review_result: r.result,
          reviewed_qty: r.result === 'corrected' && r.qty.trim() ? r.qty.trim() : null,
          reason: r.reason.trim() || null,
        })),
        decision
      ),
    onSuccess: (_, decision) => {
      toast.success(decision === 'approve' ? 'الجرد اتعتمد' : 'الجرد رجع للمساعدين');
      setReviews({});
      refresh();
    },
    onError: fail,
  });

  const summary = useMemo(() => {
    const rows = items.data || [];
    const counted = rows.filter((row) => row.actual_qty !== null);
    const differences = counted.filter((row) => Number(row.difference) !== 0);
    const value = differences.reduce((s, row) => s + Number(row.difference) * (Number(row.unit_price) || 0), 0);
    return { total: rows.length, counted: counted.length, differences: differences.length, value };
  }, [items.data]);

  if (items.isLoading) {
    return (
      <div className="p-3">
        <Loader2 className="mx-auto h-5 w-5 animate-spin" />
      </div>
    );
  }
  if (items.isError) {
    return (
      <div className="p-3">
        <EmptyState label="" error onRetry={() => items.refetch()} />
      </div>
    );
  }

  return (
    <div className="space-y-3 border-t border-[var(--dawaa-theme-border)] p-3">
      <p className="dawaa-caption text-xs font-bold">
        اتجرد {summary.counted} من {summary.total} صنف · {summary.differences} صنف فيه فرق
        {summary.value ? ` · قيمة الفروقات ${fmt(Math.round(summary.value))} ج` : ''}
        {session.reviewer_staff_name ? ` · راجعه ${session.reviewer_staff_name}` : ''}
      </p>
      <div className="max-h-[60vh] overflow-auto">
        <table className="w-full text-right text-xs">
          <thead className="sticky top-0 bg-[var(--dawaa-theme-surface)] font-black">
            <tr>
              <th className="p-2">الصنف</th>
              <th className="p-2">رصيد البرنامج</th>
              <th className="p-2">الفعلي</th>
              <th className="p-2">الفرق</th>
              {reviewing || closed ? <th className="p-2">المراجعة</th> : null}
            </tr>
          </thead>
          <tbody>
            {(items.data || []).map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                open={open}
                reviewing={reviewing}
                closed={closed}
                count={counts[item.id]}
                onCount={(value) => setCounts((prev) => ({ ...prev, [item.id]: value }))}
                review={reviews[item.id]}
                onReview={(value) => setReviews((prev) => ({ ...prev, [item.id]: value }))}
              />
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-2">
        {open ? (
          <>
            <button type="button" className={buttonClass} disabled={save.isPending || !pendingCounts().length} onClick={() => save.mutate()}>
              حفظ الكميات
            </button>
            <button type="button" className={buttonClass} disabled={submit.isPending} onClick={() => submit.mutate()}>
              تسليم الجرد للمدير
            </button>
          </>
        ) : null}
        {reviewing ? (
          <>
            <button type="button" className={buttonClass} disabled={decide.isPending} onClick={() => decide.mutate('approve')}>
              اعتماد الجرد
            </button>
            <button type="button" className={buttonClass} disabled={decide.isPending} onClick={() => decide.mutate('return')}>
              رجّعه للمساعدين
            </button>
          </>
        ) : null}
        {session.status === 'submitted' && !canManage ? (
          <span className="dawaa-caption text-xs font-bold">الجرد عند مدير الفرع للمراجعة</span>
        ) : null}
      </div>
    </div>
  );
}

function ItemRow({
  item,
  open,
  reviewing,
  closed,
  count,
  onCount,
  review,
  onReview,
}: {
  item: WeeklyCountItem;
  open: boolean;
  reviewing: boolean;
  closed: boolean;
  count: string | undefined;
  onCount: (value: string) => void;
  review: ReviewDraft | undefined;
  onReview: (value: ReviewDraft) => void;
}) {
  const difference = Number(item.difference) || 0;
  const flagged = item.actual_qty !== null && difference !== 0;
  const current: ReviewDraft = review || { result: 'confirmed', qty: '', reason: '' };
  return (
    <tr className={`border-t border-[var(--dawaa-theme-border)] ${flagged ? 'bg-[var(--dawaa-status-warning-bg)]' : ''}`}>
      <td className="p-2 font-bold">
        {item.item_name}
        {item.product_code ? <span className="dawaa-caption block">{item.product_code}</span> : null}
      </td>
      <td className="p-2">{fmt(item.expected_qty)}</td>
      <td className="p-2">
        {open ? (
          <input
            inputMode="decimal"
            className={`${inputClass} w-20`}
            value={count ?? (item.actual_qty === null ? '' : String(item.actual_qty))}
            onChange={(e) => onCount(e.target.value)}
            aria-label={`الكمية الفعلية ${item.item_name || ''}`}
          />
        ) : (
          fmt(item.actual_qty)
        )}
      </td>
      <td className="p-2 font-black">{item.actual_qty === null ? '—' : difference > 0 ? `+${fmt(difference)}` : fmt(difference)}</td>
      {reviewing ? (
        <td className="p-2">
          {flagged ? (
            <div className="flex flex-wrap gap-1">
              <select className={inputClass} value={current.result} onChange={(e) => onReview({ ...current, result: e.target.value as ReviewResult })}>
                {(Object.keys(REVIEW_RESULT_LABELS) as ReviewResult[]).map((key) => (
                  <option key={key} value={key}>
                    {REVIEW_RESULT_LABELS[key]}
                  </option>
                ))}
              </select>
              {current.result === 'corrected' ? (
                <input
                  inputMode="decimal"
                  placeholder="الكمية بعد المراجعة"
                  className={`${inputClass} w-28`}
                  value={current.qty}
                  onChange={(e) => onReview({ ...current, qty: e.target.value })}
                />
              ) : null}
              <input placeholder="السبب" className={`${inputClass} w-36`} value={current.reason} onChange={(e) => onReview({ ...current, reason: e.target.value })} />
            </div>
          ) : (
            '—'
          )}
        </td>
      ) : closed ? (
        <td className="p-2">
          {item.review_result ? REVIEW_RESULT_LABELS[item.review_result as ReviewResult] || item.review_result : '—'}
          {item.reviewed_qty !== null ? ` · ${fmt(item.reviewed_qty)}` : ''}
          {item.reason ? <span className="dawaa-caption block">{item.reason}</span> : null}
        </td>
      ) : null}
    </tr>
  );
}
