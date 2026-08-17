import { useState } from 'react';
import { Send } from 'lucide-react';
import { toast } from 'sonner';
import { addCoachingNote, type CoachingCategory, type CoachingRecipientRole, type CoachingRole, type CoachingTone } from '@/lib/coachingNotes';

const CATEGORIES: { value: CoachingCategory; label: string }[] = [
  { value: 'conversation_quality', label: 'جودة المحادثات' },
  { value: 'followups', label: 'المتابعات' },
  { value: 'sales_quality', label: 'جودة البيع' },
  { value: 'discipline', label: 'الالتزام' },
  { value: 'data_quality', label: 'جودة البيانات' },
  { value: 'general', label: 'عام' },
];

const TONES: { value: CoachingTone; label: string }[] = [
  { value: 'praise', label: 'إشادة' },
  { value: 'coaching', label: 'توجيه' },
  { value: 'warning', label: 'تنبيه' },
];

/**
 * فورم صغير قابل للدمج في أي شاشة إدارية (مراجعة محادثة، تقييم أسبوعي، لوحة
 * فرع) عشان أي ملاحظة تكتب توصل فورًا لصاحبها في لوحته الشخصية. مايستبدلش
 * حقول reviewer_notes / reviewer_message الموجودة أصلًا لكل محادثة — ده
 * للملاحظات العامة أو اللي مش مربوطة بمحادثة واحدة بعينها.
 */
export default function CoachingNoteComposer({
  fromStaffId,
  fromStaffName,
  fromRole,
  toStaffId,
  toStaffName,
  toRole,
  branch,
  linkedTable,
  linkedRecordId,
  onSent,
}: {
  fromStaffId?: string | null;
  fromStaffName: string;
  fromRole: CoachingRole;
  toStaffId: string;
  toStaffName: string;
  toRole: CoachingRecipientRole;
  branch?: string | null;
  linkedTable?: string;
  linkedRecordId?: string;
  onSent?: () => void;
}) {
  const [category, setCategory] = useState<CoachingCategory>('general');
  const [tone, setTone] = useState<CoachingTone>('coaching');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (!note.trim()) return toast.error('اكتب نص الملاحظة أولًا');
    if (!toStaffId) return toast.error('لازم تحديد الموظف المُوجَّهة له الملاحظة');
    setSending(true);
    const { error } = await addCoachingNote({
      from_staff_id: fromStaffId,
      from_staff_name: fromStaffName,
      from_role: fromRole,
      to_staff_id: toStaffId,
      to_staff_name: toStaffName,
      to_role: toRole,
      branch,
      category,
      tone,
      note,
      linked_table: linkedTable,
      linked_record_id: linkedRecordId,
    });
    setSending(false);
    if (error) return toast.error(error);
    toast.success(`اتبعتت الملاحظة لـ ${toStaffName}`);
    setNote('');
    onSent?.();
  };

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <select className="input-dark" value={category} onChange={(e) => setCategory(e.target.value as CoachingCategory)}>
          {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <select className="input-dark" value={tone} onChange={(e) => setTone(e.target.value as CoachingTone)}>
          {TONES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </div>
      <textarea
        className="input-dark w-full"
        rows={3}
        placeholder={`اكتب ملاحظة موجّهة لـ ${toStaffName || 'الموظف'}...`}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <button type="button" onClick={() => void send()} disabled={sending} className="btn-primary inline-flex items-center gap-2 disabled:opacity-50">
        <Send size={16} /> {sending ? 'جارٍ الإرسال...' : 'إرسال الملاحظة'}
      </button>
    </div>
  );
}
