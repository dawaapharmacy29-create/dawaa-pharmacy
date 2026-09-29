// Branch-hint hierarchy لمحادثة واتساب — قراءة فقط، بدون أي resolver جديد.
// بيعيد استخدام 3 محركات موجودة بالترتيب:
//   1) source branch: الفرع المُسجَّل فعليًا على مصدر الاستيراد (whatsapp_review_sources.branch)
//      لو موجود — أقوى إشارة لأنه مش تخمين، ده سياق حقيقي من لحظة الاستيراد.
//   2) active owner branch: أول موظف "متحقق منه" (verified_intro) في ownership timeline
//      (whatsappSmartReviewOwnership.ts) — يعني صاحب المحادثة من بدايتها، مش أي حد اشترك
//      فيها لاحقًا (زي دكتور استشارة من فرع تاني). بيتحل عن طريق whatsappStaffResolverV6.
//   3) staff resolver branch: لو مفيش owner واضح، بنجرب كل الأسماء المتحقق منها/الظاهرة في
//      الجلسة مع نفس whatsappStaffResolverV6 — أوسع من (2) بس أقل دقة (مش واعي بتوقيت الـhandoff).
//   4) majority fallback: تصويت الأغلبية على فرع الرسائل الصادرة المُطابَقة عبر
//      whatsappParticipantRoleResolverV15 (بعد إضافة حقل branch) — أضعف إشارة، آخر حل.
// ده بالظبط الـhierarchy المطلوب في مراجعة التكامل: source > active owner > staff resolver >
// majority fallback — بدل الاعتماد على الأغلبية فقط، اللي كانت بتخلط فروع مختلفة في حالة
// handoff بين فرعين.
import type { WhatsAppConversationSession } from '@/lib/whatsappConversationParser';
import type { WhatsAppParticipantRoleModelV15 } from '@/lib/whatsappParticipantRoleResolverV15';
import { buildSmartOwnershipTimeline } from '@/lib/whatsappSmartReviewOwnership';
import { resolveWhatsAppStaffV6 } from '@/lib/whatsappStaffResolverV6';

export type BranchHintSource = 'source' | 'active_owner' | 'staff_resolver' | 'majority_fallback' | 'none';

export interface BranchHintResult {
  value: string | null;
  source: BranchHintSource;
  reason: string;
}

function majorityFallback(roles: WhatsAppParticipantRoleModelV15): BranchHintResult {
  const branches = roles.staff.map((s) => s.branch).filter((b): b is string => Boolean(b && b.trim()));
  if (!branches.length) return { value: null, source: 'none', reason: 'لا توجد أي إشارة فرع من أي مصدر.' };
  const counts = new Map<string, number>();
  for (const b of branches) counts.set(b, (counts.get(b) || 0) + 1);
  const [value] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return { value, source: 'majority_fallback', reason: 'أضعف إشارة — تصويت أغلبية على فروع الرسائل الصادرة، لا يُستخدم إلا لما كل المصادر الأقوى تفشل.' };
}

export async function resolveConversationBranchHint(
  session: WhatsAppConversationSession,
  roles: WhatsAppParticipantRoleModelV15,
  sourceBranch?: string | null
): Promise<BranchHintResult> {
  const trimmedSource = (sourceBranch || '').trim();
  if (trimmedSource) {
    return { value: trimmedSource, source: 'source', reason: 'الفرع مُسجَّل فعليًا على مصدر الاستيراد (whatsapp_review_sources.branch).' };
  }

  const timeline = buildSmartOwnershipTimeline(session);
  const firstOwner = timeline.episodes.find((e) => e.eligibleForScoring)?.ownerName || null;
  if (firstOwner) {
    const resolved = await resolveWhatsAppStaffV6([firstOwner], null);
    if (resolved.staff?.branch) {
      return { value: resolved.staff.branch, source: 'active_owner', reason: `فرع أول موظف متحقق منه بدأ ملكية المحادثة (${firstOwner}) — قبل أي handoff محتمل لاحقًا.` };
    }
  }

  const candidateNames = [...new Set([...timeline.verifiedStaff.map((s) => s.name), ...session.outboundStaffNames])];
  if (candidateNames.length) {
    const resolved = await resolveWhatsAppStaffV6(candidateNames, null);
    if (resolved.staff?.branch) {
      return { value: resolved.staff.branch, source: 'staff_resolver', reason: 'فرع أقرب موظف تم التعرف عليه من كل أسماء الموظفين الظاهرة في الجلسة (بدون وعي بتوقيت الـhandoff).' };
    }
  }

  return majorityFallback(roles);
}
