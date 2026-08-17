import { useEffect, useState } from 'react';
import { MessageSquareHeart, ThumbsUp, AlertTriangle, Info } from 'lucide-react';
import {
  acknowledgeCoachingNote,
  fetchNotesForBranch,
  fetchNotesForStaff,
  fetchAllNotes,
  type CoachingNote,
} from '@/lib/coachingNotes';

const TONE_STYLE: Record<CoachingNote['tone'], string> = {
  praise: 'border-emerald-400/25 bg-emerald-500/10 text-emerald-100',
  coaching: 'border-sky-400/25 bg-sky-500/10 text-sky-100',
  warning: 'border-amber-400/25 bg-amber-500/10 text-amber-100',
};

const TONE_ICON: Record<CoachingNote['tone'], typeof ThumbsUp> = {
  praise: ThumbsUp,
  coaching: Info,
  warning: AlertTriangle,
};

const CATEGORY_LABEL: Record<CoachingNote['category'], string> = {
  conversation_quality: 'جودة المحادثات',
  followups: 'المتابعات',
  sales_quality: 'جودة البيع',
  discipline: 'الالتزام',
  data_quality: 'جودة البيانات',
  general: 'عام',
};

type Scope =
  | { mode: 'staff'; staffId: string }
  | { mode: 'branch'; branch: string }
  | { mode: 'all' };

/**
 * تعرض ملاحظات التوجيه الموجّهة لموظف معيّن، أو لفرع كامل (لمدير الفرع/الفروع)،
 * أو كل الملاحظات بدون فلترة (للمدير العام فقط). نفس المكوّن يُستخدم في كل
 * لوحة عشان الملاحظة اللي بتتكتب من أي مستوى توصل فعليًا للشخص المعني.
 */
export default function CoachingNotesFeed({ scope, limit = 20 }: { scope: Scope; limit?: number }) {
  const [notes, setNotes] = useState<CoachingNote[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const result =
      scope.mode === 'staff'
        ? await fetchNotesForStaff(scope.staffId, limit)
        : scope.mode === 'branch'
          ? await fetchNotesForBranch(scope.branch, limit)
          : await fetchAllNotes(limit);
    setNotes(result);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.mode, scope.mode === 'staff' ? scope.staffId : scope.mode === 'branch' ? scope.branch : 'all']);

  if (loading) {
    return <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-400">جارٍ تحميل الملاحظات...</div>;
  }

  if (!notes.length) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-400">
        <MessageSquareHeart size={16} /> لا توجد ملاحظات موجّهة حتى الآن.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {notes.map((n) => {
        const Icon = TONE_ICON[n.tone];
        return (
          <div key={n.id} className={`rounded-2xl border p-3 text-sm ${TONE_STYLE[n.tone]}`}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-bold">
                <Icon size={16} />
                <span>{CATEGORY_LABEL[n.category]}</span>
              </div>
              <span className="text-xs opacity-70">{new Date(n.created_at).toLocaleDateString('ar-EG')}</span>
            </div>
            <p className="mt-1 leading-relaxed">{n.note}</p>
            <div className="mt-1 flex items-center justify-between text-xs opacity-70">
              <span>من: {n.from_staff_name}{n.to_staff_name ? ` → ${n.to_staff_name}` : ''}</span>
              {!n.acknowledged_at ? (
                <button
                  type="button"
                  className="underline"
                  onClick={() => void acknowledgeCoachingNote(n.id).then(load)}
                >
                  تم الاطلاع
                </button>
              ) : (
                <span>تم الاطلاع ✓</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
