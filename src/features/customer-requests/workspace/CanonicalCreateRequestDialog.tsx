import { FormEvent, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, PackagePlus, ShieldCheck, UserRound, UsersRound, X } from 'lucide-react';
import { toast } from 'sonner';
import CustomerSmartSearch, { type CustomerSearchResult } from '@/components/CustomerSmartSearch';
import ProductSmartSearch from '@/components/ProductSmartSearch';
import ImageUploadBox from '@/components/ImageUploadBox';
import { useAuth } from '@/hooks/useAuth';
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery';
import { isDoctorRole } from '@/lib/security/userDataScope';
import { isActiveStaffFilter } from '@/lib/staffActiveFilter';
import type { CatalogProduct } from '@/lib/api/productsCatalog';
import type { CustomerRequest } from '@/lib/api/customerRequests';
import {
  createCanonicalCustomerRequest,
  getCanonicalCustomerRequestDoctorIncentivePreview,
  type CanonicalCustomerRequestIncentivePreview,
} from '../create';
import { customerRequestBranchKey, customerRequestBranchLabel, customerRequestSourceBranch } from '../domain/branch';

type StaffOption = { id: string; name: string; role: string | null; branch: string | null };

function doctorLike(item: StaffOption) {
  return [item.name, item.role]
    .filter(Boolean)
    .some((value) => /د\/|دكتور|صيدلي|صيدلاني|doctor|pharmacist/i.test(String(value)));
}

function pointsText(preview: CanonicalCustomerRequestIncentivePreview | null) {
  if (!preview) return 'اختر الدكتور لعرض نقاط الطلب';
  if (!preview.pointsEligible) return 'الفئة أو سياسة النقاط تحتاج مراجعة قبل احتساب النقاط';
  return `تسجيل +${preview.registrationPoints} · تحقيق +${preview.achievementPoints}`;
}

export default function CanonicalCreateRequestDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (request: CustomerRequest) => void | Promise<void>;
}) {
  const { user } = useAuth();
  const { data: staff } = useSupabaseQuery<StaffOption>({
    table: 'staff',
    filters: isActiveStaffFilter(),
    realtimeEnabled: false,
  });
  const doctors = useMemo(() => (staff || []).filter(doctorLike), [staff]);
  // Never fall back to the account id here. customer_requests.doctor_id must be staff.id.
  const selfDoctorId = isDoctorRole(user) && user?.staffId ? String(user.staffId) : '';

  const [customer, setCustomer] = useState<CustomerSearchResult | null>(null);
  const [product, setProduct] = useState<CatalogProduct | null>(null);
  const [doctorId, setDoctorId] = useState(selfDoctorId);
  const [quantity, setQuantity] = useState(1);
  const [urgency, setUrgency] = useState('normal');
  const [requestType, setRequestType] = useState('missing_medicine');
  const [channel, setChannel] = useState('داخل الصيدلية');
  const [neededBy, setNeededBy] = useState('');
  const [expectedDays, setExpectedDays] = useState(1);
  const [supplierHint, setSupplierHint] = useState('');
  const [notes, setNotes] = useState('');
  const [image, setImage] = useState({ publicUrl: '', path: '' });
  const [saving, setSaving] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [incentivePreview, setIncentivePreview] = useState<CanonicalCustomerRequestIncentivePreview | null>(null);

  const selectedDoctor = doctors.find((doctor) => doctor.id === doctorId) || null;
  const doctorBranchKey = customerRequestBranchKey(selectedDoctor?.branch);
  const customerBranchKey = customerRequestBranchKey(customer?.branch);
  const resolvedBranch = customerRequestSourceBranch(doctorBranchKey ? selectedDoctor?.branch : customer?.branch) || '';
  const branchMismatch = Boolean(doctorBranchKey && customerBranchKey && doctorBranchKey !== customerBranchKey);

  useEffect(() => {
    if (!doctorId) {
      setIncentivePreview(null);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    void getCanonicalCustomerRequestDoctorIncentivePreview(doctorId)
      .then((preview) => { if (!cancelled) setIncentivePreview(preview); })
      .catch(() => { if (!cancelled) setIncentivePreview(null); })
      .finally(() => { if (!cancelled) setPreviewLoading(false); });
    return () => { cancelled = true; };
  }, [doctorId]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!customer?.id || !customer.code) return toast.error('اختر عميلًا مربوطًا وله كود عميل');
    if (!product?.id || !product.code) return toast.error('اختر صنفًا مربوطًا بكود الصنف');
    if (!selectedDoctor?.id) return toast.error('اختر الدكتور المسجل للطلب من سجل الموظفين');
    if (!resolvedBranch) return toast.error('تعذر تحديد الفرع التشغيلي من الدكتور أو العميل');

    setSaving(true);
    try {
      const result = await createCanonicalCustomerRequest({
        customer,
        product,
        doctor: { id: selectedDoctor.id, name: selectedDoctor.name },
        branch: resolvedBranch,
        quantity,
        urgency,
        requestType,
        channel,
        neededBy: neededBy || null,
        expectedFulfillmentDays: expectedDays,
        supplierHint: supplierHint || null,
        notes: notes || null,
        imageUrl: image.publicUrl || null,
        imagePath: image.path || null,
        createdBy: { id: user?.id, name: user?.name },
      });

      if (result.duplicateRequest) {
        toast.warning('يوجد طلب مفتوح لنفس العميل والصنف خلال آخر 24 ساعة — تم فتح الطلب الموجود بدل إنشاء نسخة مكررة');
      } else if (result.incentive.pointsEligible) {
        toast.success(`تم تسجيل الطلب وربطه بالبيانات المعتمدة · نقاط التسجيل +${result.incentive.registrationPoints}`);
      } else {
        toast.success('تم تسجيل الطلب وربطه بالبيانات المعتمدة، والنقاط ستظل معلقة حتى اكتمال فئة الدكتور');
      }

      await onCreated(result.request);
      onClose();
    } catch (error) {
      toast.error(`تعذر تسجيل الطلب: ${(error as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const validIdentity = Boolean(customer?.id && customer?.code && product?.id && product?.code && selectedDoctor?.id && resolvedBranch);

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/35 p-2 backdrop-blur-sm md:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <section className="flex max-h-[95vh] w-full max-w-6xl flex-col overflow-hidden rounded-[28px] border border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-surface)] shadow-2xl" dir="rtl">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] px-4 py-4 md:px-6">
          <div>
            <div className="flex items-center gap-2 text-xl font-black text-[var(--dawaa-theme-heading)]"><PackagePlus size={21} className="text-[var(--dawaa-theme-primary)]" /> تسجيل طلب عميل</div>
            <p className="mt-1 text-xs font-bold text-[var(--dawaa-theme-muted)]">العميل والصنف والدكتور مرتبطون مباشرة ببيانات التطبيق؛ لا يعتمد التسجيل الجديد على أسماء نصية منفصلة.</p>
          </div>
          <button type="button" className="rounded-xl border border-[var(--dawaa-theme-border)] p-2 text-[var(--dawaa-theme-muted)]" onClick={onClose} disabled={saving} aria-label="إغلاق"><X size={18} /></button>
        </header>

        <form onSubmit={submit} className="overflow-y-auto p-3 md:p-5">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_310px]">
            <div className="space-y-4">
              <section className="rounded-2xl border border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-surface)] p-4">
                <div className="mb-3 flex items-center gap-2 font-black text-[var(--dawaa-theme-heading)]"><UsersRound size={18} className="text-[var(--dawaa-theme-primary)]" /> 1. العميل المعتمد</div>
                <CustomerSmartSearch value={customer} onSelect={setCustomer} placeholder="اسم العميل أو الكود أو الهاتف" disabled={saving} allowCreate />
                {customer ? <div className="mt-3 grid grid-cols-2 gap-2 text-xs md:grid-cols-4"><div className="rounded-xl bg-[var(--dawaa-theme-surface-2)] p-2"><span className="text-[var(--dawaa-theme-muted)]">الاسم</span><strong className="mt-1 block">{customer.name}</strong></div><div className="rounded-xl bg-[var(--dawaa-theme-surface-2)] p-2"><span className="text-[var(--dawaa-theme-muted)]">الكود</span><strong className="mt-1 block">{customer.code || 'غير موجود'}</strong></div><div className="rounded-xl bg-[var(--dawaa-theme-surface-2)] p-2"><span className="text-[var(--dawaa-theme-muted)]">الهاتف</span><strong className="mt-1 block">{customer.phone || '—'}</strong></div><div className="rounded-xl bg-[var(--dawaa-theme-surface-2)] p-2"><span className="text-[var(--dawaa-theme-muted)]">الفرع المرجعي للعميل</span><strong className="mt-1 block">{customerRequestBranchLabel(customer.branch)}</strong></div></div> : null}
              </section>

              <section className="rounded-2xl border border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-theme-surface)] p-4">
                <div className="mb-3 flex items-center gap-2 font-black text-[var(--dawaa-theme-heading)]"><ShieldCheck size={18} className="text-[var(--dawaa-status-success-text)]" /> 2. الصنف المعتمد</div>
                <ProductSmartSearch value={product} onSelect={setProduct} disabled={saving} />
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <label className="text-xs font-black text-[var(--dawaa-theme-text)]">الكمية<input className="input-dark mt-1" type="number" min={1} value={quantity} onChange={(event) => setQuantity(Number(event.target.value || 1))} /></label>
                  <label className="text-xs font-black text-[var(--dawaa-theme-text)]">الأولوية<select className="input-dark mt-1" value={urgency} onChange={(event) => setUrgency(event.target.value)}><option value="normal">عادي</option><option value="high">مهم</option><option value="urgent">عاجل</option></select></label>
                  <label className="text-xs font-black text-[var(--dawaa-theme-text)]">التصنيف<select className="input-dark mt-1" value={requestType} onChange={(event) => setRequestType(event.target.value)}><option value="missing_medicine">صنف ناقص</option><option value="normal_request">طلب عادي</option><option value="urgent_request">طلب عاجل</option><option value="inquiry">استفسار</option></select></label>
                </div>
              </section>

              <section className="rounded-2xl border border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-theme-surface)] p-4">
                <div className="mb-3 flex items-center gap-2 font-black text-[var(--dawaa-theme-heading)]"><UserRound size={18} className="text-[var(--dawaa-status-info-text)]" /> 3. الدكتور والموعد</div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <label className="text-xs font-black text-[var(--dawaa-theme-text)]">الدكتور المسجل{selfDoctorId ? <div className="input-dark mt-1 flex items-center gap-2"><ShieldCheck size={14} /> {user?.name || selectedDoctor?.name || 'محدد تلقائيًا'}</div> : <select className="input-dark mt-1" value={doctorId} onChange={(event) => setDoctorId(event.target.value)}><option value="">اختر الدكتور من سجل الموظفين</option>{doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.name} — {customerRequestBranchLabel(doctor.branch)}</option>)}</select>}</label>
                  <label className="text-xs font-black text-[var(--dawaa-theme-text)]">قناة الطلب<select className="input-dark mt-1" value={channel} onChange={(event) => setChannel(event.target.value)}><option value="داخل الصيدلية">داخل الصيدلية</option><option value="واتساب">واتساب</option><option value="مكالمة هاتفية">مكالمة هاتفية</option></select></label>
                  <div className="rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] p-3"><span className="text-[10px] font-bold text-[var(--dawaa-theme-muted)]">الفرع التشغيلي للطلب</span><strong className="mt-1 block text-sm text-[var(--dawaa-theme-primary)]">{customerRequestBranchLabel(resolvedBranch)}</strong><span className="mt-1 block text-[9px] font-bold text-[var(--dawaa-theme-muted)]">يُؤخذ من فرع الدكتور عندما يكون محددًا، ثم من العميل كخيار احتياطي.</span></div>
                  <label className="text-xs font-black text-[var(--dawaa-theme-text)]">مطلوب قبل<input type="date" className="input-dark mt-1" value={neededBy} onChange={(event) => setNeededBy(event.target.value)} /></label>
                  <label className="text-xs font-black text-[var(--dawaa-theme-text)]">مدة التوفير المتوقعة<input type="number" min={0} className="input-dark mt-1" value={expectedDays} onChange={(event) => setExpectedDays(Number(event.target.value || 0))} /></label>
                  <label className="text-xs font-black text-[var(--dawaa-theme-text)]">مصدر محتمل<input className="input-dark mt-1" value={supplierHint} onChange={(event) => setSupplierHint(event.target.value)} placeholder="اختياري" /></label>
                </div>
                {branchMismatch ? <div className="mt-3 flex items-start gap-2 rounded-xl border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] p-3 text-[11px] font-bold leading-6 text-[var(--dawaa-status-warning-text)]"><AlertTriangle size={15} className="mt-0.5 shrink-0" />العميل مرتبط مرجعيًا بـ{customerRequestBranchLabel(customer?.branch)} بينما الدكتور يعمل في {customerRequestBranchLabel(selectedDoctor?.branch)}. سيُحفظ الطلب في فرع الدكتور لأنه مكان التنفيذ الحالي، بدون تغيير فرع العميل الأصلي.</div> : null}
                <div className={`mt-3 rounded-xl border p-3 text-xs font-black ${incentivePreview?.pointsEligible ? 'border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)] text-[var(--dawaa-status-success-text)]' : 'border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] text-[var(--dawaa-status-warning-text)]'}`}>
                  {previewLoading ? <span className="flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> جاري مراجعة فئة الدكتور والنقاط...</span> : pointsText(incentivePreview)}
                </div>
              </section>

              <section className="rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] p-4">
                <div className="mb-3 text-sm font-black text-[var(--dawaa-theme-heading)]">4. تفاصيل مساعدة للتنفيذ</div>
                <textarea className="input-dark min-h-24" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="ملاحظات الدكتور، البدائل المقبولة، التركيز أو الموعد..." />
                <div className="mt-3"><ImageUploadBox bucket="customer-request-images" folder="customer-requests" label="صورة الصنف أو الروشتة (اختياري)" valueUrl={image.publicUrl} valuePath={image.path} onUploaded={setImage} disabled={saving} /></div>
              </section>
            </div>

            <aside className="h-fit rounded-2xl border border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-surface-2)] p-4 xl:sticky xl:top-0">
              <div className="flex items-center gap-2 text-sm font-black text-[var(--dawaa-theme-heading)]"><CheckCircle2 size={18} className="text-[var(--dawaa-theme-primary)]" /> مراجعة الربط</div>
              <div className="mt-4 space-y-2 text-xs">
                <ReviewLine label="العميل" value={customer ? `${customer.name} · ${customer.code || 'بدون كود'}` : 'غير محدد'} valid={Boolean(customer?.id && customer?.code)} />
                <ReviewLine label="الصنف" value={product ? `${product.name} · ${product.code}` : 'غير محدد'} valid={Boolean(product?.id && product?.code)} />
                <ReviewLine label="الدكتور" value={selectedDoctor?.name || 'غير محدد'} valid={Boolean(selectedDoctor?.id)} />
                <ReviewLine label="الفرع التشغيلي" value={customerRequestBranchLabel(resolvedBranch)} valid={Boolean(resolvedBranch)} />
                <ReviewLine label="النقاط" value={pointsText(incentivePreview)} valid={Boolean(incentivePreview?.pointsEligible)} />
              </div>
              <div className="mt-4 rounded-xl border border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-accent-soft)] p-3 text-[11px] font-bold leading-6 text-[var(--dawaa-theme-primary)]">قبل الإنشاء يفحص النظام طلبًا مفتوحًا لنفس العميل والصنف والفرع خلال 24 ساعة لمنع التكرار.</div>
            </aside>
          </div>

          <footer className="sticky bottom-0 mt-4 flex flex-col-reverse gap-2 rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)]/95 p-3 shadow-xl backdrop-blur sm:flex-row sm:items-center sm:justify-between">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>إلغاء</button>
            <button className="btn-primary flex min-w-48 items-center justify-center gap-2" disabled={saving || !validIdentity}>{saving ? <Loader2 size={16} className="animate-spin" /> : <PackagePlus size={16} />} حفظ الطلب المربوط</button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function ReviewLine({ label, value, valid }: { label: string; value: string; valid: boolean }) {
  return <div className="flex items-start justify-between gap-3 rounded-xl bg-[var(--dawaa-theme-surface)] p-2"><span className="text-[var(--dawaa-theme-muted)]">{label}</span><strong className={valid ? 'text-[var(--dawaa-status-success-text)]' : 'text-[var(--dawaa-status-warning-text)]'}>{value}</strong></div>;
}
