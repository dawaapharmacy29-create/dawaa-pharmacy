import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  MessageSquare,
  PhoneCall,
  ShoppingBag,
  Star,
  UserCheck,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import type { DailyFollowup } from '@/types/database';

interface FollowupResultModalProps {
  followup: DailyFollowup;
  onClose: () => void;
  onSave: (result: FollowupResultData) => Promise<void>;
  mode?: 'create' | 'edit';
}

export interface FollowupResultData {
  result: string;
  notes: string;
  qualityRating: number;
  internalRating: number;
  needsNextFollowup: boolean;
  nextFollowupDate: string;
  invoiceNumber: string;
  purchaseAmount: number;
  problemSolved: boolean;
  customerSatisfied: boolean;
  customerSatisfaction: string;
  needUnderstood: boolean | null;
  crossSellOffered: boolean;
  upSellOffered: boolean;
  noPurchaseReason: string;
  doctorInternalNote: string;
}

type SelectOption = { value: string; label: string };

const RESULT_OPTIONS = [
  { value: 'تم الرد والعميل راضي', icon: CheckCircle2 },
  { value: 'تم الرد ولا يحتاج الآن', icon: CheckCircle2 },
  { value: 'تم الرد ويحتاج طلب', icon: ShoppingBag },
  { value: 'تم التواصل ولم يشتر', icon: MessageSquare },
  { value: 'تم الرد ويوجد شكوى', icon: AlertTriangle },
  { value: 'لم يرد', icon: PhoneCall },
  { value: 'الرقم غير صحيح', icon: AlertTriangle },
  { value: 'طلب صنف', icon: ShoppingBag },
  { value: 'طلب توصيل', icon: ShoppingBag },
  { value: 'يحتاج متابعة مدير', icon: UserCheck },
  { value: 'تم الشراء بعد المتابعة', icon: CheckCircle2 },
] as const;

const NO_PURCHASE_OPTIONS: SelectOption[] = [
  { value: '', label: 'اختر السبب' },
  ...['السعر', 'غير محتاج الآن', 'اشترى من مكان آخر', 'لم يرد', 'يحتاج مدير', 'شكوى', 'سبب آخر'].map(
    (value): SelectOption => ({ value, label: value })
  ),
];

function valueOf(record: Record<string, unknown>, keys: string[], fallback = '') {
  for (const key of keys) {
    const value = record[key];
    if (value != null && String(value).trim()) return String(value);
  }
  return fallback;
}

function numberOf(record: Record<string, unknown>, keys: string[], fallback = 0) {
  for (const key of keys) {
    const value = Number(record[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return fallback;
}

function boolOf(record: Record<string, unknown>, keys: string[], fallback = false) {
  for (const key of keys) {
    if (record[key] === true) return true;
    if (record[key] === false) return false;
  }
  return fallback;
}

function localDateInput(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export default function FollowupResultModal({ followup, onClose, onSave, mode = 'create' }: FollowupResultModalProps) {
  useEscapeKey(onClose, true);
  const source = followup as unknown as Record<string, unknown>;
  const [result, setResult] = useState(() => valueOf(source, ['followup_result', 'contact_result', 'followup_status', 'status']));
  const [notes, setNotes] = useState(() => valueOf(source, ['evaluation_summary', 'followup_notes', 'notes']));
  const [qualityRating, setQualityRating] = useState(() => numberOf(source, ['quality_rating'], 5));
  const [internalRating, setInternalRating] = useState(() => numberOf(source, ['internal_rating'], 0));
  const [needsNextFollowup, setNeedsNextFollowup] = useState(() => boolOf(source, ['needs_next_followup'], false));
  const [nextFollowupDate, setNextFollowupDate] = useState(() => valueOf(source, ['next_followup_date']).slice(0, 10));
  const [invoiceNumber, setInvoiceNumber] = useState(() => valueOf(source, ['purchase_invoice_no', 'invoice_number']));
  const [purchaseAmount, setPurchaseAmount] = useState(() => String(numberOf(source, ['purchase_amount'], 0) || ''));
  const [problemSolved, setProblemSolved] = useState(() => boolOf(source, ['problem_solved'], false));
  const [customerSatisfied, setCustomerSatisfied] = useState(() => boolOf(source, ['customer_satisfied'], false));
  const [customerSatisfaction, setCustomerSatisfaction] = useState(() => valueOf(source, ['customer_satisfaction'], 'غير واضح'));
  const [needUnderstood, setNeedUnderstood] = useState<boolean | null>(() => source.need_understood === true ? true : source.need_understood === false ? false : null);
  const [crossSellOffered, setCrossSellOffered] = useState(() => boolOf(source, ['cross_sell_offered'], false));
  const [upSellOffered, setUpSellOffered] = useState(() => boolOf(source, ['up_sell_offered'], false));
  const [noPurchaseReason, setNoPurchaseReason] = useState(() => valueOf(source, ['no_purchase_reason']));
  const [doctorInternalNote, setDoctorInternalNote] = useState(() => valueOf(source, ['doctor_internal_note']));
  const [saving, setSaving] = useState(false);

  const purchaseResult = result === 'تم الشراء بعد المتابعة';
  const noPurchaseResult = result === 'تم التواصل ولم يشتر';
  const contactHappened = Boolean(result) && !['لم يرد', 'الرقم غير صحيح'].includes(result);
  const completion = useMemo(() => {
    const checks = [Boolean(result), notes.trim().length >= 10, internalRating > 0, !contactHappened || customerSatisfaction !== 'غير واضح', !contactHappened || needUnderstood !== null, !needsNextFollowup || Boolean(nextFollowupDate), !purchaseResult || (Boolean(invoiceNumber.trim()) && Number(purchaseAmount) > 0), !noPurchaseResult || Boolean(noPurchaseReason)];
    return Math.round((checks.filter(Boolean).length / checks.length) * 100);
  }, [contactHappened, customerSatisfaction, internalRating, invoiceNumber, needUnderstood, needsNextFollowup, nextFollowupDate, noPurchaseReason, noPurchaseResult, notes, purchaseAmount, purchaseResult, result]);

  const submit = async () => {
    if (!result) return toast.error('اختر نتيجة المتابعة');
    if (notes.trim().length < 10) return toast.error('اكتب ملخصًا واضحًا للمتابعة لا يقل عن 10 أحرف');
    if (!internalRating) return toast.error('تقييم جودة التواصل الداخلي مطلوب');
    if (contactHappened && customerSatisfaction === 'غير واضح') return toast.error('حدد رضا العميل');
    if (contactHappened && needUnderstood === null) return toast.error('حدد هل تم فهم احتياج العميل');
    if (needsNextFollowup) {
      if (!nextFollowupDate) return toast.error('حدد تاريخ المتابعة القادمة');
      const date = new Date(`${nextFollowupDate}T12:00:00`);
      if (Number.isNaN(date.getTime())) return toast.error('تاريخ المتابعة القادمة غير صحيح');
      if (nextFollowupDate < localDateInput()) return toast.error('تاريخ المتابعة القادمة لا يمكن أن يكون في الماضي');
    }
    if (purchaseResult && (!invoiceNumber.trim() || Number(purchaseAmount) <= 0)) return toast.error('رقم الفاتورة وقيمة الشراء مطلوبان');
    if (noPurchaseResult && !noPurchaseReason) return toast.error('سبب عدم الشراء مطلوب');

    setSaving(true);
    try {
      await onSave({
        result,
        notes: notes.trim(),
        qualityRating,
        internalRating,
        needsNextFollowup,
        nextFollowupDate: needsNextFollowup ? nextFollowupDate : '',
        invoiceNumber: invoiceNumber.trim(),
        purchaseAmount: Number(purchaseAmount) || 0,
        problemSolved,
        customerSatisfied,
        customerSatisfaction,
        needUnderstood,
        crossSellOffered,
        upSellOffered,
        noPurchaseReason,
        doctorInternalNote: doctorInternalNote.trim(),
      });
      toast.success(mode === 'edit' ? 'تم تعديل نتيجة المتابعة' : 'تم تسجيل نتيجة المتابعة');
      onClose();
    } catch (error) {
      toast.error(`تعذر حفظ النتيجة: ${error instanceof Error ? error.message : 'خطأ غير متوقع'}`);
    } finally {
      setSaving(false);
    }
  };

  const customerName = valueOf(source, ['customer_name', 'name'], 'عميل بدون اسم');
  const customerCode = valueOf(source, ['customer_code'], 'بدون كود');
  const branch = valueOf(source, ['branch'], 'فرع غير محدد');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm" dir="rtl">
      <div className="max-h-[94vh] w-full max-w-5xl overflow-y-auto rounded-3xl border border-slate-700 bg-[#101b31] shadow-2xl">
        <header className="sticky top-0 z-10 flex items-start justify-between border-b border-slate-700 bg-[#101b31]/95 p-5 backdrop-blur">
          <div><h2 className="text-xl font-black text-white">{mode === 'edit' ? 'تعديل نتيجة المتابعة' : 'تسجيل نتيجة المتابعة'}</h2><p className="mt-1 text-sm font-bold text-slate-300">{customerName} · {customerCode} · {branch}</p><div className="mt-3 h-2 w-56 overflow-hidden rounded-full bg-slate-800"><div className="h-full bg-teal-400 transition-all" style={{ width: `${completion}%` }} /></div><p className="mt-1 text-xs text-slate-400">اكتمال النموذج: {completion}%</p></div>
          <button type="button" onClick={onClose} disabled={saving} className="rounded-xl p-2 text-slate-400 hover:bg-white/10 hover:text-white"><X size={22} /></button>
        </header>

        <div className="grid gap-5 p-5 lg:grid-cols-[1.55fr_1fr]">
          <main className="space-y-5">
            <section><h3 className="mb-3 font-black text-white">نتيجة التواصل *</h3><div className="grid gap-2 sm:grid-cols-2">{RESULT_OPTIONS.map(({ value, icon: Icon }) => <button key={value} type="button" onClick={() => setResult(value)} className={`flex items-center gap-2 rounded-2xl border p-3 text-right text-sm font-bold transition ${result === value ? 'border-teal-400 bg-teal-500/20 text-white' : 'border-slate-700 bg-slate-900/45 text-slate-200 hover:border-slate-500'}`}><Icon size={18} />{value}</button>)}</div></section>
            <label className="block space-y-2 text-sm font-bold text-slate-200"><span>ملخص المتابعة والنتيجة الفعلية *</span><textarea className="input-dark min-h-32 resize-y" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="اكتب ما تم مع العميل، وما المشكلة، وما النتيجة، والخطوة القادمة..." /></label>
            <section className="rounded-2xl border border-cyan-500/25 bg-cyan-500/10 p-4"><h3 className="mb-4 font-black text-cyan-100">تقييم جودة المتابعة</h3><div className="grid gap-5 md:grid-cols-2"><RatingControl label="جودة المتابعة" value={qualityRating} onChange={setQualityRating} /><RatingControl label="جودة التواصل الداخلي *" value={internalRating} onChange={setInternalRating} /></div><div className="mt-4 grid gap-3 md:grid-cols-2"><SelectField label="رضا العميل" value={customerSatisfaction} onChange={setCustomerSatisfaction} options={[{ value: 'غير واضح', label: 'غير واضح' }, { value: 'نعم', label: 'نعم' }, { value: 'لا', label: 'لا' }]} /><SelectField label="هل تم فهم احتياج العميل؟" value={needUnderstood === null ? '' : needUnderstood ? 'yes' : 'no'} onChange={(value) => setNeedUnderstood(value === '' ? null : value === 'yes')} options={[{ value: '', label: 'غير محدد' }, { value: 'yes', label: 'نعم' }, { value: 'no', label: 'لا' }]} /></div><div className="mt-4 grid gap-3 sm:grid-cols-3"><CheckBox label="تم عرض Cross Sell" checked={crossSellOffered} onChange={setCrossSellOffered} /><CheckBox label="تم عرض Up Sell" checked={upSellOffered} onChange={setUpSellOffered} /><CheckBox label="يحتاج متابعة لاحقة" checked={needsNextFollowup} onChange={setNeedsNextFollowup} /></div></section>
          </main>

          <aside className="space-y-4">
            {needsNextFollowup && <section className="rounded-2xl border border-blue-500/30 bg-blue-500/10 p-4"><div className="mb-2 flex items-center gap-2 font-black text-blue-100"><CalendarClock size={18} /> المتابعة القادمة</div><input type="date" min={localDateInput()} value={nextFollowupDate} onChange={(event) => setNextFollowupDate(event.target.value)} className="input-dark" /><div className="mt-2 flex gap-2"><button type="button" className="btn-secondary flex-1 text-xs" onClick={() => { const d = new Date(); d.setDate(d.getDate() + 1); setNextFollowupDate(localDateInput(d)); }}>بكرة</button><button type="button" className="btn-secondary flex-1 text-xs" onClick={() => { const d = new Date(); d.setDate(d.getDate() + 2); setNextFollowupDate(localDateInput(d)); }}>بعد يومين</button></div></section>}
            {(purchaseResult || invoiceNumber || purchaseAmount) && <section className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-4"><h3 className="mb-3 font-black text-emerald-100">الشراء بعد المتابعة</h3><div className="space-y-3"><InputField label="رقم الفاتورة" value={invoiceNumber} onChange={setInvoiceNumber} /><InputField label="قيمة الشراء" type="number" value={purchaseAmount} onChange={setPurchaseAmount} /></div></section>}
            {noPurchaseResult && <SelectField label="سبب عدم الشراء *" value={noPurchaseReason} onChange={setNoPurchaseReason} options={NO_PURCHASE_OPTIONS} />}
            <section className="rounded-2xl border border-slate-700 bg-slate-900/45 p-4"><h3 className="mb-3 font-black text-white">قرارات المتابعة</h3><div className="space-y-2"><CheckBox label="تم حل المشكلة" checked={problemSolved} onChange={setProblemSolved} /><CheckBox label="العميل راضي" checked={customerSatisfied} onChange={setCustomerSatisfied} /></div></section>
            <label className="block space-y-2 text-sm font-bold text-slate-200"><span>ملاحظة داخلية للدكتور</span><textarea className="input-dark min-h-24 resize-y" value={doctorInternalNote} onChange={(event) => setDoctorInternalNote(event.target.value)} placeholder="ملاحظات داخلية لا تُرسل للعميل" /></label>
          </aside>
        </div>

        <footer className="sticky bottom-0 flex gap-3 border-t border-slate-700 bg-[#101b31]/95 p-4 backdrop-blur"><button type="button" onClick={submit} disabled={saving} className="btn-primary flex-1">{saving ? 'جاري الحفظ...' : mode === 'edit' ? 'حفظ تعديل النتيجة' : 'حفظ النتيجة الكاملة'}</button><button type="button" onClick={onClose} disabled={saving} className="btn-secondary flex-1">إلغاء</button></footer>
      </div>
    </div>
  );
}

function RatingControl({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <div><label className="mb-2 block text-sm font-bold text-slate-200">{label}</label><div className="flex items-center gap-1">{[1, 2, 3, 4, 5].map((rating) => <button key={rating} type="button" onClick={() => onChange(rating)} className={value >= rating ? 'p-1 text-yellow-300' : 'p-1 text-slate-600'}><Star size={22} fill={value >= rating ? 'currentColor' : 'none'} /></button>)}<span className="mr-2 text-xs text-slate-400">{value || 0}/5</span></div></div>;
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: SelectOption[] }) {
  return <label className="block space-y-2 text-sm font-bold text-slate-200"><span>{label}</span><select className="input-dark" value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={`${option.value}-${option.label}`} value={option.value}>{option.label}</option>)}</select></label>;
}

function InputField({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return <label className="block space-y-2 text-sm font-bold text-slate-200"><span>{label}</span><input className="input-dark" type={type} value={value} min={type === 'number' ? '0' : undefined} onChange={(event) => onChange(event.target.value)} /></label>;
}

function CheckBox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950/35 p-3 text-sm font-bold text-slate-200"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 rounded" />{label}</label>;
}
