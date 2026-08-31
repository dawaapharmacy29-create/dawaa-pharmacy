import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, ClipboardList, FileSpreadsheet, Loader2, PackageSearch } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { Panel, SectionTitle, EmptyState } from '@/components/dashboard/DashboardPrimitives';

const ELIGIBLE_STAFF_IDS = new Set([
  '8088db32-c552-4f5b-9737-984d0d594b0c', // د/ شيماء
  'bc718b18-b361-43a4-90fb-f8d7f6884b9a', // يوسف عصام
]);

const TASK_KIND_LABEL: Record<string, string> = {
  shelf: 'رص',
  inventory: 'جرد',
};

type Assignment = { task_kind: 'shelf' | 'inventory'; zone: string; branch: string };
type LogRow = {
  id: string;
  task_kind: 'shelf' | 'inventory';
  zone: string;
  log_date: string;
  status: 'pending' | 'approved' | 'rejected';
  points: number;
  notes: string | null;
  reviewer_note: string | null;
};

const STATUS_LABEL: Record<LogRow['status'], { label: string; color: string; bg: string; borderColor: string }> = {
  pending: { label: 'بانتظار الاعتماد', color: 'var(--dawaa-status-warning-text)', bg: 'var(--dawaa-status-warning-bg)', borderColor: 'var(--dawaa-status-warning-border)' },
  approved: { label: 'معتمد', color: 'var(--dawaa-status-success-text)', bg: 'var(--dawaa-status-success-bg)', borderColor: 'var(--dawaa-status-success-border)' },
  rejected: { label: 'مرفوض', color: 'var(--dawaa-status-danger-text)', bg: 'var(--dawaa-status-danger-bg)', borderColor: 'var(--dawaa-status-danger-border)' },
};

function todayInput() {
  return new Date().toISOString().slice(0, 10);
}

export default function PharmacyZoneTasks() {
  const { user } = useAuth();
  const staffId = user?.staffId || user?.id || '';
  const isEligible = ELIGIBLE_STAFF_IDS.has(staffId);

  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [submittingZone, setSubmittingZone] = useState<string | null>(null);
  const [uploadingLogId, setUploadingLogId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isEligible) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(false);
    const [assignmentRes, logsRes] = await Promise.all([
      supabase.rpc('get_my_pharmacy_zone_assignment_v1', { p_date: todayInput() }),
      supabase.rpc('list_my_pharmacy_zone_tasks_v1', { p_limit: 30 }),
    ]);
    if (assignmentRes.error || logsRes.error) {
      setLoadError(true);
      setLoading(false);
      return;
    }
    setAssignments((assignmentRes.data || []) as Assignment[]);
    setLogs((logsRes.data || []) as LogRow[]);
    setLoading(false);
  }, [isEligible]);

  useEffect(() => {
    void load();
  }, [load]);

  const isDoneToday = useCallback(
    (kind: string, zone: string) => logs.some((l) => l.task_kind === kind && l.zone === zone && l.log_date === todayInput()),
    [logs]
  );

  const handleSubmit = useCallback(
    async (assignment: Assignment) => {
      const key = `${assignment.task_kind}:${assignment.zone}`;
      setSubmittingZone(key);
      try {
        const { error } = await supabase.rpc('submit_my_pharmacy_zone_task_v1', {
          p_task_kind: assignment.task_kind,
          p_zone: assignment.zone,
          p_log_date: todayInput(),
          p_notes: notes[key]?.trim() || null,
        });
        if (error) throw error;
        toast.success('اتسجل، هيتراجع من مدير الفرع.');
        await load();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'حصل خطأ في الحفظ');
      } finally {
        setSubmittingZone(null);
      }
    },
    [notes, load]
  );

  const handleExcelUpload = useCallback(
    async (logId: string, file: File) => {
      setUploadingLogId(logId);
      try {
        const XLSX = await import('xlsx');
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
        const pick = (row: Record<string, unknown>, keys: string[]) => {
          for (const key of keys) {
            const found = Object.keys(row).find((item) => item.trim().toLowerCase() === key.trim().toLowerCase());
            if (found && row[found] !== '') return row[found];
          }
          return '';
        };
        const items = rows
          .map((row) => ({
            item_name: String(pick(row, ['اسم الصنف', 'الصنف', 'item_name', 'name'])).trim(),
            expected_qty: pick(row, ['الكمية المتوقعة', 'expected_qty', 'السيستم', 'الرصيد']),
            actual_qty: pick(row, ['الكمية الفعلية', 'actual_qty', 'الفعلي', 'الكمية']),
            expiry_date: pick(row, ['تاريخ الصلاحية', 'expiry_date', 'الصلاحية', 'تاريخ الانتهاء']),
            unit_price: pick(row, ['السعر', 'سعر الصنف', 'unit_price', 'price']),
            reason: String(pick(row, ['سبب الفرق', 'reason'])).trim(),
            action: String(pick(row, ['الإجراء', 'action'])).trim(),
            notes: String(pick(row, ['ملاحظات', 'notes'])).trim(),
          }))
          .filter((row) => row.item_name);
        if (!items.length) {
          toast.error('الملف مفيهوش أصناف صحيحة');
          return;
        }
        const { data: count, error } = await supabase.rpc('submit_pharmacy_inventory_items_v1', {
          p_log_id: logId,
          p_items: items,
        });
        if (error) throw error;
        toast.success(`اترفع ${count ?? items.length} صنف`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'تعذّر رفع الملف');
      } finally {
        setUploadingLogId(null);
      }
    },
    []
  );

  if (!isEligible) {
    return (
      <div className="p-6 text-center text-sm font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
        الصفحة دي مقصورة على شيماء ويوسف عصام فقط.
      </div>
    );
  }

  const pendingCount = logs.filter((l) => l.status === 'pending').length;

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-4 pb-24" dir="rtl">
      <div>
        <h1 className="text-xl font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>الرص والجرد اليومي</h1>
        <p className="mt-1 text-sm font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
          مهامك المجدولة النهارده — سجّلها بمجرد التنفيذ.
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-6"><Loader2 className="animate-spin" style={{ color: 'var(--dawaa-theme-muted)' }} /></div>
      ) : loadError ? (
        <EmptyState label="تعذّر تحميل مهام النهارده" error onRetry={() => void load()} />
      ) : (
        <Panel className="p-4 space-y-3">
          <SectionTitle title="مهام النهارده" icon={<PackageSearch size={18} />} />
          {assignments.length === 0 ? (
            <EmptyState label="مفيش مهمة مجدولة عليك النهارده" />
          ) : (
            assignments.map((a) => {
              const key = `${a.task_kind}:${a.zone}`;
              const done = isDoneToday(a.task_kind, a.zone);
              const doneLog = logs.find((l) => l.task_kind === a.task_kind && l.zone === a.zone && l.log_date === todayInput());
              return (
                <div key={key} className="rounded-xl border p-3" style={{ borderColor: 'var(--dawaa-theme-border)' }}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>
                      {TASK_KIND_LABEL[a.task_kind]} — {a.zone}
                    </p>
                    {done && doneLog ? (
                      <span
                        className="rounded-full border px-2 py-0.5 text-[10px] font-black"
                        style={{
                          borderColor: STATUS_LABEL[doneLog.status].borderColor,
                          background: STATUS_LABEL[doneLog.status].bg,
                          color: STATUS_LABEL[doneLog.status].color,
                        }}
                      >
                        {STATUS_LABEL[doneLog.status].label}
                      </span>
                    ) : null}
                  </div>
                  {!done ? (
                    <div className="mt-2 space-y-2">
                      <input
                        type="text"
                        className="input-dark w-full text-sm"
                        placeholder="ملاحظة (اختياري)"
                        value={notes[key] || ''}
                        onChange={(e) => setNotes((prev) => ({ ...prev, [key]: e.target.value }))}
                      />
                      <button
                        type="button"
                        disabled={submittingZone === key}
                        onClick={() => void handleSubmit(a)}
                        className="flex w-full items-center justify-center gap-2 rounded-lg py-2 text-sm font-black text-white"
                        style={{ background: 'var(--dawaa-theme-primary)' }}
                      >
                        {submittingZone === key ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                        تم التنفيذ
                      </button>
                    </div>
                  ) : a.task_kind === 'inventory' && doneLog ? (
                    <div className="mt-2">
                      <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed p-2 text-xs font-black" style={{ borderColor: 'var(--dawaa-theme-border)', color: 'var(--dawaa-theme-primary-strong)' }}>
                        {uploadingLogId === doneLog.id ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />}
                        رفع ملف إكسل بالأصناف (اختياري)
                        <input
                          type="file"
                          accept=".xlsx,.xls,.csv"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) void handleExcelUpload(doneLog.id, file);
                            e.target.value = '';
                          }}
                        />
                      </label>
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </Panel>
      )}

      <Panel className="p-4">
        <SectionTitle title="آخر المهام" icon={<ClipboardList size={18} />} />
        {pendingCount > 0 ? (
          <p className="mb-2 text-xs font-bold" style={{ color: 'var(--dawaa-status-warning-text)' }}>{pendingCount} مهمة بانتظار الاعتماد</p>
        ) : null}
        {logs.length === 0 ? (
          <EmptyState label="لسه مفيش مهام مسجّلة" />
        ) : (
          <div className="space-y-2">
            {logs.map((l) => {
              const status = STATUS_LABEL[l.status];
              return (
                <div key={l.id} className="rounded-xl border p-3" style={{ borderColor: 'var(--dawaa-theme-border)' }}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>
                      {TASK_KIND_LABEL[l.task_kind]} — {l.zone}
                    </p>
                    <span className="shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-black" style={{ borderColor: status.borderColor, background: status.bg, color: status.color }}>
                      {status.label}
                    </span>
                  </div>
                  <p className="mt-1 text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>{l.log_date}</p>
                  {l.status === 'rejected' && l.reviewer_note ? (
                    <p className="mt-1 text-xs font-bold" style={{ color: 'var(--dawaa-status-danger-text)' }}>سبب الرفض: {l.reviewer_note}</p>
                  ) : null}
                  {l.status === 'approved' ? (
                    <p className="mt-1 text-xs font-black" style={{ color: 'var(--dawaa-status-success-text)' }}>+{l.points} نقطة</p>
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
