import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, Link2, Loader2, RefreshCw, UserRoundCheck } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { exportToExcel } from '@/lib/exportExcel';

type AuditSummary = {
  total: number;
  product_linked: number;
  product_code_ready: number;
  product_price_ready: number;
  product_unlinked: number;
  source_employee_named: number;
  source_employee_linked: number;
  source_recorded_named: number;
  source_recorded_linked: number;
  no_branch: number;
  sync_conflicts: number;
};

type SupplierRow = {
  product_id: string | null;
  product_code: string | null;
  product_name: string;
  reference_price: number | string | null;
  total_quantity: number | string;
  requests_count: number | string;
  branches: string;
  linkage_status: 'verified' | 'needs_link';
};

const EMPTY: AuditSummary = {
  total: 0,
  product_linked: 0,
  product_code_ready: 0,
  product_price_ready: 0,
  product_unlinked: 0,
  source_employee_named: 0,
  source_employee_linked: 0,
  source_recorded_named: 0,
  source_recorded_linked: 0,
  no_branch: 0,
  sync_conflicts: 0,
};

export default function CustomerRequestProcurementExportPanel({ branch }: { branch: string }) {
  const [loading, setLoading] = useState(true);
  const [audit, setAudit] = useState<AuditSummary>(EMPTY);
  const [rows, setRows] = useState<SupplierRow[]>([]);

  const load = async () => {
    setLoading(true);
    try {
      const branchArg = branch === 'all' ? null : branch;
      const [{ data: auditData, error: auditError }, { data: supplierData, error: supplierError }] = await Promise.all([
        supabase.rpc('get_customer_request_product_staff_audit_v1', { p_branch: branchArg }),
        supabase.rpc('get_customer_request_supplier_export_v1', { p_branch: branchArg }),
      ]);
      if (auditError) throw new Error(auditError.message);
      if (supplierError) throw new Error(supplierError.message);
      setAudit(((auditData as { summary?: AuditSummary } | null)?.summary || EMPTY));
      setRows((supplierData || []) as SupplierRow[]);
    } catch (error) {
      toast.error(`تعذر فحص ربط الأصناف والموظفين: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branch]);

  const verifiedRows = useMemo(
    () => rows.filter((row) => row.linkage_status === 'verified' && row.product_code && row.reference_price !== null),
    [rows]
  );
  const reviewRows = useMemo(() => rows.filter((row) => row.linkage_status !== 'verified'), [rows]);
  const employeeRate = audit.source_employee_named ? Math.round((audit.source_employee_linked / audit.source_employee_named) * 100) : 100;
  const productRate = audit.total ? Math.round((audit.product_linked / audit.total) * 100) : 0;

  const exportSupplierFile = async () => {
    if (!verifiedRows.length) return toast.error('لا توجد أصناف مرتبطة بكود وسعر جاهزة للإرسال للمورد الآن.');
    const today = new Date().toISOString().slice(0, 10);
    await exportToExcel(
      verifiedRows.map((row, index) => ({
        م: index + 1,
        'كود الصنف': row.product_code || '',
        'اسم الصنف': row.product_name,
        السعر: Number(row.reference_price || 0),
        'الكمية المطلوبة': Number(row.total_quantity || 0),
        'عدد طلبات العملاء': Number(row.requests_count || 0),
        الفرع: row.branches || '',
      })),
      `طلبات_العملاء_للمورد_${branch === 'all' ? 'كل_الفروع' : branch}_${today}`,
      'طلبية المورد'
    );
    toast.success(`تم تجهيز ${verifiedRows.length.toLocaleString('ar-EG')} صنف مؤكد بالكود والسعر.`);
  };

  const exportReviewFile = async () => {
    if (!rows.length) return toast.error('لا توجد طلبات مفتوحة للتصدير.');
    const today = new Date().toISOString().slice(0, 10);
    await exportToExcel(
      rows.map((row, index) => ({
        م: index + 1,
        'كود الصنف': row.product_code || '',
        'اسم الصنف': row.product_name,
        السعر: row.reference_price === null ? '' : Number(row.reference_price),
        'الكمية المطلوبة': Number(row.total_quantity || 0),
        'عدد الطلبات': Number(row.requests_count || 0),
        الفرع: row.branches || '',
        'دقة الربط': row.linkage_status === 'verified' ? 'مؤكد' : 'يحتاج ربط بالكود',
      })),
      `مراجعة_طلبات_العملاء_${branch === 'all' ? 'كل_الفروع' : branch}_${today}`,
      'مراجعة الربط'
    );
  };

  return (
    <section className="rounded-2xl border border-emerald-400/20 bg-emerald-500/[0.045] p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 font-black text-white"><Link2 size={18} className="text-emerald-300" /> ربط الأصناف والموظفين + ملف المورد</div>
          <div className="mt-1 text-xs leading-6 text-slate-400">الملف المباشر للمورد لا يدخل فيه صنف إلا لو تم ربطه بكتالوج الأصناف وأصبح له كود وسعر مؤكد. الطلبات غير المربوطة تظل ظاهرة للمراجعة ولا يتم تخمين كود لها.</div>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="h-9 rounded-xl border border-slate-700 px-3 text-xs font-black text-slate-200 hover:bg-slate-900">
          <span className="inline-flex items-center gap-2"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> تحديث الربط</span>
        </button>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="طلبات Base44" value={audit.total} />
        <Metric label="مرتبطة بصنف" value={audit.product_linked} hint={`${productRate}%`} tone={audit.product_unlinked ? 'amber' : 'green'} />
        <Metric label="كود + سعر جاهز" value={audit.product_price_ready} tone={audit.product_price_ready === audit.product_linked ? 'green' : 'amber'} />
        <Metric label="الموظف مربوط" value={audit.source_employee_linked} hint={`${employeeRate}% من المسجل بالاسم`} tone={employeeRate >= 95 ? 'green' : 'amber'} />
        <Metric label="تحتاج ربط صنف" value={audit.product_unlinked} tone={audit.product_unlinked ? 'red' : 'green'} />
      </div>

      {loading ? (
        <div className="mt-4 flex h-20 items-center justify-center"><Loader2 className="animate-spin text-emerald-300" /></div>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => void exportSupplierFile()} className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-500/15 px-4 text-xs font-black text-emerald-100 ring-1 ring-emerald-400/25 hover:bg-emerald-500/25">
              <Download size={15} /> Excel جاهز للمورد ({verifiedRows.length.toLocaleString('ar-EG')} صنف)
            </button>
            <button type="button" onClick={() => void exportReviewFile()} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-700 px-4 text-xs font-black text-slate-200 hover:bg-slate-900">
              <Download size={15} /> ملف مراجعة شامل
            </button>
          </div>

          <div className="mt-3 grid gap-2 lg:grid-cols-2">
            <div className={`rounded-xl border p-3 ${verifiedRows.length ? 'border-emerald-400/20 bg-emerald-500/[0.055]' : 'border-slate-700 bg-slate-950/40'}`}>
              <div className="flex items-center gap-2 text-xs font-black text-emerald-200"><CheckCircle2 size={14} /> جاهز للإرسال للمورد</div>
              <div className="mt-1 text-[11px] leading-5 text-slate-400">{verifiedRows.length.toLocaleString('ar-EG')} صنف مفتوح له كود وسعر وكمية مجمعة. الملف يجمع تكرار نفس الصنف بدل تكرار الصفوف.</div>
            </div>
            <div className={`rounded-xl border p-3 ${reviewRows.length ? 'border-amber-400/20 bg-amber-500/[0.055]' : 'border-emerald-400/20 bg-emerald-500/[0.055]'}`}>
              <div className="flex items-center gap-2 text-xs font-black text-amber-200"><AlertTriangle size={14} /> مستبعد من الملف المباشر لحماية الدقة</div>
              <div className="mt-1 text-[11px] leading-5 text-slate-400">{reviewRows.length.toLocaleString('ar-EG')} اسم صنف مفتوح يحتاج ربطًا مؤكدًا بالكتالوج قبل إدخاله في ملف المورد.</div>
            </div>
          </div>

          <div className="mt-3 flex items-start gap-2 rounded-xl bg-slate-950/35 p-3 text-[11px] leading-5 text-slate-400">
            <UserRoundCheck size={14} className="mt-0.5 shrink-0 text-cyan-300" />
            <span>ربط الموظف يتم فقط عند تطابق فريد مع موظف نشط أو Alias معتمد. الأسماء الملتبسة لا يتم ربطها تلقائيًا حتى لا يُنسب طلب لموظف غير صحيح.</span>
          </div>
        </>
      )}
    </section>
  );
}

function Metric({ label, value, hint, tone = 'slate' }: { label: string; value: number; hint?: string; tone?: 'slate' | 'green' | 'amber' | 'red' }) {
  const tones = {
    slate: 'border-slate-700 bg-slate-950/45 text-slate-200',
    green: 'border-emerald-400/20 bg-emerald-500/[0.06] text-emerald-200',
    amber: 'border-amber-400/20 bg-amber-500/[0.06] text-amber-200',
    red: 'border-red-400/20 bg-red-500/[0.06] text-red-200',
  };
  return <div className={`rounded-xl border p-3 ${tones[tone]}`}><div className="text-[10px] font-black opacity-80">{label}</div><div className="mt-1 text-2xl font-black">{value.toLocaleString('ar-EG')}</div>{hint && <div className="mt-0.5 text-[9px] font-bold opacity-70">{hint}</div>}</div>;
}
