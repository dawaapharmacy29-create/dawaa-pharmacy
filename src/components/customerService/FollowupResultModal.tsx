import { useState } from 'react';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import {
  X,
  Star,
  CheckCircle2,
  AlertTriangle,
  PhoneCall,
  MessageSquare,
  ShoppingBag,
  UserCheck,
} from 'lucide-react';
import { toast } from 'sonner';
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
  needsNextFollowup: boolean;
  nextFollowupDate: string;
  invoiceNumber: string;
  purchaseAmount: number;
  problemSolved: boolean;
  customerSatisfied: boolean;
}

const RESULT_OPTIONS = [
  {
    value: 'تم الرد والعميل راضي',
    label: 'تم الرد والعميل راضي',
    icon: CheckCircle2,
    color: 'text-green-400',
  },
  {
    value: 'تم الرد ولا يحتاج الآن',
    label: 'تم الرد ولا يحتاج الآن',
    icon: CheckCircle2,
    color: 'text-teal-400',
  },
  {
    value: 'تم الرد ويحتاج طلب',
    label: 'تم الرد ويحتاج طلب',
    icon: ShoppingBag,
    color: 'text-cyan-400',
  },
  {
    value: 'تم الرد ويوجد شكوى',
    label: 'تم الرد ويوجد شكوى',
    icon: AlertTriangle,
    color: 'text-red-400',
  },
  { value: 'لم يرد', label: 'لم يرد', icon: PhoneCall, color: 'text-amber-400' },
  { value: 'الرقم غير صحيح', label: 'الرقم غير صحيح', icon: AlertTriangle, color: 'text-red-300' },
  { value: 'طلب صنف', label: 'طلب صنف', icon: ShoppingBag, color: 'text-purple-400' },
  { value: 'طلب توصيل', label: 'طلب توصيل', icon: ShoppingBag, color: 'text-blue-400' },
  {
    value: 'يحتاج متابعة مدير',
    label: 'يحتاج متابعة مدير',
    icon: UserCheck,
    color: 'text-orange-400',
  },
  {
    value: 'تم الشراء بعد المتابعة',
    label: 'تم الشراء بعد المتابعة',
    icon: CheckCircle2,
    color: 'text-green-300',
  },
];

export default function FollowupResultModal({
  followup,
  onClose,
  onSave,
}: FollowupResultModalProps) {
  useEscapeKey(onClose, true);
  const [result, setResult] = useState('');
  const [notes, setNotes] = useState('');
  const [qualityRating, setQualityRating] = useState(5);
  const [needsNextFollowup, setNeedsNextFollowup] = useState(false);
  const [nextFollowupDate, setNextFollowupDate] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [purchaseAmount, setPurchaseAmount] = useState('');
  const [problemSolved, setProblemSolved] = useState(false);
  const [customerSatisfied, setCustomerSatisfied] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!result) {
      toast.error('اختر نتيجة المتابعة');
      return;
    }

    setSaving(true);
    try {
      await onSave({
        result,
        notes,
        qualityRating,
        needsNextFollowup,
        nextFollowupDate,
        invoiceNumber,
        purchaseAmount: Number(purchaseAmount) || 0,
        problemSolved,
        customerSatisfied,
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
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-[#1B2B4B] border border-[#2d4063] rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-[#1B2B4B] border-b border-[#2d4063] p-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-white">تسجيل نتيجة المتابعة</h2>
            <p className="text-slate-400 text-sm mt-1">{followup.customer_name}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={24} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Result Options */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-3">نتيجة التواصل</label>
            <div className="grid grid-cols-2 gap-2">
              {RESULT_OPTIONS.map((option) => {
                const Icon = option.icon;
                return (
                  <button
                    key={option.value}
                    onClick={() => setResult(option.value)}
                    className={`p-3 rounded-xl border text-right transition-all ${
                      result === option.value
                        ? 'bg-teal-500/20 border-teal-400/50'
                        : 'bg-white/5 border-white/10 hover:bg-white/10'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Icon size={18} className={option.color} />
                      <span className="text-sm">{option.label}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              ملاحظات المتابعة
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="اكتب تفاصيل المتابعة هنا..."
              className="input-dark resize-none"
              rows={3}
            />
          </div>

          {/* Quality Rating */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              تقييم جودة المتابعة
            </label>
            <div className="flex items-center gap-2">
              {[1, 2, 3, 4, 5].map((rating) => (
                <button
                  key={rating}
                  onClick={() => setQualityRating(rating)}
                  className={`p-2 rounded-lg transition-all ${
                    qualityRating >= rating ? 'text-yellow-400' : 'text-slate-600'
                  }`}
                >
                  <Star size={24} fill={qualityRating >= rating ? 'currentColor' : 'none'} />
                </button>
              ))}
              <span className="text-slate-400 text-sm mr-2">{qualityRating} / 5</span>
            </div>
          </div>

          {/* Next Followup */}
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={needsNextFollowup}
                onChange={(e) => setNeedsNextFollowup(e.target.checked)}
                className="w-4 h-4 rounded"
              />
              يحتاج متابعة قادمة
            </label>
            {needsNextFollowup && (
              <input
                type="date"
                value={nextFollowupDate}
                onChange={(e) => setNextFollowupDate(e.target.value)}
                className="input-dark"
              />
            )}
          </div>

          {/* Purchase After Followup */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                رقم الفاتورة (اختياري)
              </label>
              <input
                type="text"
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                placeholder="رقم الفاتورة"
                className="input-dark"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                قيمة الشراء بعد المتابعة (اختياري)
              </label>
              <input
                type="number"
                value={purchaseAmount}
                onChange={(e) => setPurchaseAmount(e.target.value)}
                placeholder="0"
                className="input-dark"
              />
            </div>
          </div>

          {/* Problem Resolution */}
          <div className="grid grid-cols-2 gap-4">
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={problemSolved}
                onChange={(e) => setProblemSolved(e.target.checked)}
                className="w-4 h-4 rounded"
              />
              تم حل المشكلة
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={customerSatisfied}
                onChange={(e) => setCustomerSatisfied(e.target.checked)}
                className="w-4 h-4 rounded"
              />
              العميل راضي
            </label>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4 border-t border-white/10">
            <button
              onClick={handleSubmit}
              disabled={saving}
              className="btn-primary flex-1 flex items-center justify-center gap-2"
            >
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
