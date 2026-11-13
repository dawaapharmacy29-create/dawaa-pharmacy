import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw, UserRoundCheck } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { getCurrentUserProfile } from '@/hooks/useAuth';
import { hasPermission } from '@/lib/core/permissionSystem';
import { parseWhatsAppExport, extractIntroducedStaffName } from '@/lib/whatsappConversationParser';
import { confirmStaffAlias, suggestStaffAliases, type StaffIdentityMatch } from '@/lib/staffIdentityMapping';
import { getStaffSessionToken } from '@/lib/auth/staffSession';
import { requestCanonicalSalesIntelligenceRefresh } from '@/lib/salesIntelligence/refresh/refreshClient';

type Source = { id: string; source_filename: string | null; raw_text: string | null };
type Proposal = {
  name: string;
  sourceIds: string[];
  sourceLabels: string[];
  candidates: StaffIdentityMatch[];
};

/**
 * Staff identity repair deliberately never guesses a doctor from a short introduction.
 * An authorized manager must explicitly approve an alias in the canonical staff directory.
 * The existing database guard owns uniqueness, permission verification and append-only audit.
 * Only then may the existing authenticated V51+ canonical refresh regenerate case-level reviews.
 */
export default function WhatsAppStaffIdentityReview() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [result, setResult] = useState<string | null>(null);
  const canManage = useMemo(() => {
    try { return hasPermission(getCurrentUserProfile(), 'manage_staff_accounts'); }
    catch { return false; }
  }, []);

  const load = useCallback(async () => {
    if (!canManage) { setLoading(false); return; }
    setLoading(true);
    try {
      const { data, error } = await supabase.from('whatsapp_review_sources')
        .select('id,source_filename,raw_text')
        .is('deleted_at', null)
        .is('staff_id', null)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      const byName = new Map<string, {sourceIds: Set<string>; sourceLabels: Set<string>}>();
      for (const source of (data || []) as Source[]) {
        if (!source.raw_text) continue;
        // Use only real pharmacy introductions, not a customer name or filename.
        const names = new Set(parseWhatsAppExport(source.raw_text)
          .filter((message) => message.direction === 'outbound')
          .map(extractIntroducedStaffName)
          .filter((name): name is string => Boolean(name)));
        for (const name of names) {
          const key = name.trim();
          if (!key) continue;
          const prior = byName.get(key) || {sourceIds: new Set<string>(),sourceLabels: new Set<string>()};
          prior.sourceIds.add(source.id);
          prior.sourceLabels.add(source.source_filename || 'مصدر بدون اسم');
          byName.set(key,prior);
        }
      }
      const suggestions = await suggestStaffAliases([...byName.keys()]);
      setProposals([...byName].map(([name, value]) => ({
        name,
        sourceIds: [...value.sourceIds],
        sourceLabels: [...value.sourceLabels],
        candidates: suggestions.get(name) || [],
      })));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر فحص أسماء الدكاترة في المحادثات');
    } finally {
      setLoading(false);
    }
  }, [canManage]);

  useEffect(() => { void load(); }, [load]);

  const approve = async (proposal: Proposal, staff: StaffIdentityMatch) => {
    if (busy) return;
    const accessToken = getStaffSessionToken();
    if (!accessToken) {
      toast.error('يلزم تسجيل الدخول بجلسة مدير موثقة');
      return;
    }
    const approved = window.confirm(
      `اعتماد أن الاسم «${proposal.name}» في رسائل واتساب يعود إلى «${staff.staff_name}»؟\n` +
      'الاسم البديل عالمي وقد يؤثر على ربط بيانات قديمة؛ لا تعتمده إلا بعد التحقق من هوية الموظف. ' +
      'سيتم تحديث الحالات المعنية فقط، ولن تُعتمد درجات أو حوافز آليًا.'
    );
    if (!approved) return;
    setBusy(proposal.name);
    try {
      const actor = String(getCurrentUserProfile()?.id || '');
      const linked = await confirmStaffAlias(staff.staff_id, proposal.name, actor);
      if (!linked) {
        toast.error('لم يُقبل الربط؛ راجع صلاحية إدارة الموظفين وتعارض الاسم في سجل الهويات');
        return;
      }
      const refresh = await requestCanonicalSalesIntelligenceRefresh({
        sourceIds: proposal.sourceIds,
        accessToken,
        concurrency: 1,
      });
      const successful = proposal.sourceIds.filter((id) => refresh.bySource[id]?.status === 'allowed').length;
      setResult(`تم اعتماد اسم «${proposal.name}» في دليل الموظفين؛ تحديث التحليل: ${successful} من ${proposal.sourceIds.length} مصدر. ${refresh.errors.length ? 'راجع الأخطاء في مركز Sales Intelligence.' : ''}`);
      if (refresh.authInvalid) toast.error('تم حفظ الربط لكن انتهت جلسة الموظف أثناء تحديث التحليل');
      else if (successful < proposal.sourceIds.length) toast.warning('تم حفظ الربط، لكن بعض المحادثات تحتاج إعادة تحليل');
      else toast.success('تم اعتماد ربط الدكتور وإعادة تحليل المصادر المعنية');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر استكمال ربط الدكتور');
    } finally {
      setBusy(null);
    }
  };

  if (!canManage) return null;

  return (
    <section className="dawaa-card overflow-hidden" dir="rtl" data-testid="whatsapp-staff-identity-review">
      <div className="flex flex-wrap items-start justify-between gap-3 p-4">
        <div>
          <h2 className="text-sm font-black text-white">مراجعة الدكاترة غير المرتبطين في الواتساب</h2>
          <p className="mt-1 max-w-3xl text-xs leading-6 text-slate-400">
            يعرض تعريفات الدكتور الموجودة في الرسائل نفسها، ويقترح أسماء من دليل الموظفين.
            اختيار المدير شرط لاعتماد الاسم المختصر؛ فرع الموظف الأساسي ليس دليلًا كافيًا على فرع البيع.
            التقييمات الناتجة تظل آلية لحين مراجعتها، بلا نقاط أو خصومات.
          </p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading || Boolean(busy)}
          className="rounded-lg border border-slate-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
          <span className="inline-flex items-center gap-2"><RefreshCw size={14} /> مراجعة الأسماء</span>
        </button>
      </div>
      {loading && <div className="flex items-center gap-2 px-4 pb-4 text-xs text-slate-400"><Loader2 size={14} className="animate-spin" /> جارٍ تحميل المصادر</div>}
      {result && <p className="px-4 pb-3 text-xs text-cyan-200" role="status">{result}</p>}
      {!loading && proposals.length === 0 && <p className="px-4 pb-4 text-xs text-slate-400">لا توجد تعريفات دكاترة معلّقة في المصادر المتاحة.</p>}
      {!loading && proposals.map((proposal) => (
        <div key={proposal.name} className="border-t border-slate-800 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-bold text-white">
            <UserRoundCheck size={16} className="text-cyan-400" />
            «{proposal.name}»
            <span className="text-xs font-normal text-slate-400">— {proposal.sourceIds.length} مصدر</span>
          </div>
          <p className="mt-1 text-xs text-slate-500">{proposal.sourceLabels.join('، ')}</p>
          {proposal.candidates.length === 0 ? (
            <p className="mt-2 flex items-center gap-2 text-xs text-amber-300"><AlertTriangle size={14} /> لا يوجد تطابق في دليل الموظفين؛ لا يمكن الربط بالتخمين.</p>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              {proposal.candidates.map((candidate) => (
                <button type="button" key={candidate.staff_id}
                  disabled={Boolean(busy)}
                  onClick={() => void approve(proposal,candidate)}
                  className="rounded-lg border border-cyan-700/70 px-3 py-2 text-xs text-cyan-200 disabled:opacity-50">
                  {busy === proposal.name ? 'جارٍ اعتماد الربط...' : `اعتماد: ${candidate.staff_name}`}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
