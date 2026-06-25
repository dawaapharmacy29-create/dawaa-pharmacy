import { useState } from 'react';
import {
  AlertTriangle,
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

const RESULT_OPTIONS = [
  { value: 'تم الرد والعميل راضي', icon: CheckCircle2, color: 'text-green-400' },
  { value: 'تم الرد ولا يحتاج الآن', icon: CheckCircle2, color: 'text-teal-400' },
  { value: 'تم الرد ويحتاج طلب', icon: ShoppingBag, color: 'text-cyan-400' },
  { value: 'تم التواصل ولم يشتر', icon: MessageSquare, color: 'text-amber-300' },
  { value: 'تم الرد ويوجد شكوى', icon: AlertTriangle, color: 'text-red-400' },
  { value: 'لم يرد', icon: PhoneCall, color: 'text-amber-400' },
  { value: 'الرقم غير صحيح', icon: AlertTriangle, color: 'text-red-300' },
  { value: 'طلب صنف', icon: ShoppingBag, color: 'text-purple-400' },
  { value: 'طلب توصيل', icon: ShoppingBag, color: 'text-blue-400' },
  { value: 'يحتاج متابعة مدير', icon: UserCheck, color: 'text-orange-400' },
  { value: 'تم الشراء بعد المتابعة', icon: CheckCircle2, color: 'text-green-300' },
];

const NO_PURCHASE_REASONS = [
  'السعر',
  'غير محتاج الآن',
  'اشترى من مكان آخر',
  'لم يرد',
  'يحتاج مدير',
  'شكوى',
  'سبب آخر',
];

export default function FollowupResultModal({ followup, onClose, onSave }: FollowupResultModalProps) {
  useEscapeKey(onClose, true);
  const [result, setResult] = useState('');
  const [notes, setNotes] = useState('');
  const [qualityRating, setQualityRating] = useState(5);
  const [internalRating, setInternalRating] = useState(0);
  const [needsNextFollowup, setNeedsNextFollowup] = useState(false);
  const [nextFollowupDate, setNextFollowupDate] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [purchaseAmount, setPurchaseAmount] = useState('');
  const [problemSolved, setProblemSolved] = useState(false);
  const [customerSatisfied, setCustomerSatisfied] = useState(false);
  const [customerSatisfaction, setCustomerSatisfaction] = useState('غير واضح');
  const [needUnderstood, setNeedUnderstood] = useState<boolean | null>(null);
  const [crossSellOffered, setCrossSellOffered] = useState(false);
  const [upSellOffered, setUpSellOffered] = useState(false);
  const [noPurchaseReason, setNoPurchaseReason] = useState('');
  const [doctorInternalNote, setDoctorInternalNote] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!result) {
      toast.error('اختر نتيجة المتابعة');
      return;
    }
    if (result === 'تم التواصل ولم يشتر' && (!internalRating || !noPurchaseReason)) {
      toast.error('التقييم الداخلي وسبب عدم الشراء مطلوبان عند اختيار تواصل ولم يشتر');
      return;
    }

    setSaving(true);
    try {
      await onSave({
        result,
        notes,
        qualityRating,
        internalRating: internalRating || qualityRating,
        needsNextFollowup,
        nextFollowupDate,
        invoiceNumber,
        purchaseAmount: Number(purchaseAmount) || 0,
        problemSolved,
        customerSatisfied,
        customerSatisfaction,
        needUnderstood,
        crossSellOffered,
        upSellOffered,
        noPurchaseReason,
        doctorInternalNote,
      });
      toast.success('تم تسجيل نتيجة المتابعة بنجاح');
      onClose();
    } catch (error) {
      toast.error(`تعذر حفظ النتيجة: ${(error as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" dir="rtl">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-[#2d4063] bg-[#1B2B4B]">
        <div className="sticky top-0 flex items-center justify-between border-b border-[#2d4063] bg-[#1B2B4B] p-4">
          <div>
            <h2 className="text-xl font-bold text-white">تسجيل نتيجة المتابعة</h2>
            <p className="mt-1 text-sm text-slate-400">
              {String(
                (followup as unknown as Record<string, unknown>).customer_name ||
                  (followup as unknown as Record<string, unknown>).name ||
                  'عميل بدون اسم'
              )}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={24} />
          </button>
        </div>

        <div className="space-y-6 p-6">
          <div>
            <label className="mb-3 block text-sm font-medium text-slate-300">نتيجة التواصل</label>
            <div className="grid gap-2 sm:grid-cols-2">
              {RESULT_OPTIONS.map((option) => {
                const Icon = option.icon;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setResult(option.value)}
                    className={`rounded-xl border p-3 text-right transition-all ${
                      result === option.value
                        ? 'border-teal-400/50 bg-teal-500/20'
                        : 'border-white/10 bg-white/5 hover:bg-white/10'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Icon size={18} className={option.color} />
                      <span className="text-sm text-white">{option.value}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-300">ملاحظات المتابعة</label>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="اكتب تفاصيل المتابعة هنا..."
              className="input-dark resize-none"
              rows={3}
            />
          </div>

          <RatingControl label="تقييم جودة المتابعة" value={qualityRating} onChange={setQualityRating} tone="text-yellow-400" />

          <div className="space-y-4 rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-4">
            <h3 className="font-bold text-cyan-100">تقييم داخلي للمتابعة</h3>
            <RatingControl
              label="جودة التواصل مع العميل"
              value={internalRating}
              onChange={setInternalRating}
              tone="text-cyan-300"
              optional
            />

            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-2 text-sm text-slate-300">
                <span>هل العميل كان راضي؟</span>
                <select className="input-dark" value={customerSatisfaction} onChange={(event) => setCustomerSatisfaction(event.target.value)}>
                  <option>نعم</option>
                  <option>لا</option>
                  <option>غير واضح</option>
                </select>
              </label>
              <label className="space-y-2 text-sm text-slate-300">
                <span>هل تم فهم احتياج العميل؟</span>
                <select
                  className="input-dark"
                  value={needUnderstood === null ? '' : needUnderstood ? 'yes' : 'no'}
                  onChange={(event) => setNeedUnderstood(event.target.value === '' ? null : event.target.value === 'yes')}
                >
                  <option value="">غير محدد</option>
                  <option value="yes">نعم</option>
                  <option value="no">لا</option>
                </select>
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <CheckBox label="تم عرض Cross Sell" checked={crossSellOffered} onChange={setCrossSellOffered} />
              <CheckBox label="تم عرض Up Sell" checked={upSellOffered} onChange={setUpSellOffered} />
              <CheckBox label="محتاج متابعة لاحقة" checked={needsNextFollowup} onChange={setNeedsNextFollowup} />
            </div>

            <label className="block space-y-2 text-sm text-slate-300">
              <span>سبب عدم الشراء إن وجد</span>
              <select className="input-dark" value={noPurchaseReason} onChange={(event) => setNoPurchaseReason(event.target.value)}>
                <option value="">غير محدد</option>
                {NO_PURCHASE_REASONS.map((reason) => (
                  <option key={reason}>{reason}</option>
                ))}
              </select>
            </label>

            <label className="block space-y-2 text-sm text-slate-300">
              <span>ملاحظة داخلية للدكتور</span>
              <textarea
                className="input-dark resize-none"
                rows={3}
                value={doctorInternalNote}
                onChange={(event) => setDoctorInternalNote(event.target.value)}
                placeholder="ملاحظات داخلية لا تُرسل للعميل"
              />
            </label>
          </div>

          {needsNextFollowup && (
            <label className="block space-y-2 text-sm text-slate-300">
              <span>تاريخ المتابعة القادمة</span>
              <input type="date" value={nextFollowupDate} onChange={(event) => setNextFollowupDate(event.target.value)} className="input-dark" />
            </label>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-2 text-sm text-slate-300">
              <span>رقم الفاتورة (اختياري)</span>
              <input type="text" value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} className="input-dark" />
            </label>
            <label className="space-y-2 text-sm text-slate-300">
              <span>قيمة الشراء بعد المتابعة (اختياري)</span>
              <input type="number" value={purchaseAmount} onChange={(event) => setPurchaseAmount(event.target.value)} className="input-dark" />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <CheckBox label="تم حل المشكلة" checked={problemSolved} onChange={setProblemSolved} />
            <CheckBox label="العميل راضي" checked={customerSatisfied} onChange={setCustomerSatisfied} />
          </div>

          <div className="flex gap-3 border-t border-white/10 pt-4">
            <button onClick={handleSubmit} disabled={saving} className="btn-primary flex-1">
              {saving ? 'جاري الحفظ...' : 'حفظ النتيجة'}
            </button>
            <button onClick={onClose} disabled={saving} className="btn-secondary flex-1">
              إلغاء
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RatingControl({
  label,
  value,
  onChange,
  tone,
  optional = false,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  tone: string;
  optional?: boolean;
}) {
  return (
    <div>
      <label className="mb-2 block text-sm font-medium text-slate-300">{label}</label>
      <div className="flex items-center gap-2">
        {[1, 2, 3, 4, 5].map((rating) => (
          <button
            key={rating}
            type="button"
            onClick={() => onChange(rating)}
            className={`rounded-lg p-2 transition-all ${value >= rating ? tone : 'text-slate-600'}`}
          >
            <Star size={24} fill={value >= rating ? 'currentColor' : 'none'} />
          </button>
        ))}
        <span className="mr-2 text-sm text-slate-400">{value || (optional ? 'غير محدد' : 0)} / 5</span>
      </div>
    </div>
  );
}

function CheckBox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 rounded-2xl border border-slate-700 bg-slate-950/30 p-3 text-sm text-slate-300">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 rounded" />
      {label}
    </label>
  );
}
