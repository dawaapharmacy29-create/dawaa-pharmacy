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
import { extractIntroducedStaffName } from '@/lib/whatsappConversationParser';
import { isOperatingBranch, normalizeBranchName } from '@/lib/branch';

export type BranchHintSource = 'source' | 'explicit_introduction' | 'active_owner' | 'staff_resolver' | 'majority_fallback' | 'none';

export interface BranchHintResult {
  value: string | null;
  source: BranchHintSource;
  reason: string;
}

function majorityFallback(roles: WhatsAppParticipantRoleModelV15): BranchHintResult {
  const branches = roles.staff.map((s) => operationalBranch(s.branch)).filter((b): b is string => Boolean(b));
  if (!branches.length) return { value: null, source: 'none', reason: 'لا توجد أي إشارة فرع من أي مصدر.' };
  const counts = new Map<string, number>();
  for (const b of branches) counts.set(b, (counts.get(b) || 0) + 1);
  const [value] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return { value, source: 'majority_fallback', reason: 'أضعف إشارة — تصويت أغلبية على فروع الرسائل الصادرة، لا يُستخدم إلا لما كل المصادر الأقوى تفشل.' };
}

// Account-wide access, an unknown marker or a non-selling home branch (e.g. a customer-service
// employee assigned to «المخزن») is not evidence of a conversation's transaction branch.
function operationalBranch(value: string | null | undefined): string | null {
  if (!value?.trim() || !isOperatingBranch(value)) return null;
  return normalizeBranchName(value);
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

  // Only an outbound self-introduction can provide explicit branch evidence. Never infer
  // a transaction branch from a customer's mention or overwrite stored source provenance.
  const explicitBranches = new Set<string>();
  for (const message of session.messages) {
    if (!extractIntroducedStaffName(message)) continue;
    const match = message.text.match(/(?:مع\s+حضرتك|معاك(?:ي)?)\s+[^\n،,.!?؟]+?\s+من\s+فرع\s+(شكري|الشامي)(?=[\s،,.!?؟]|$)/i);
    if (match) explicitBranches.add(normalizeBranchName(match[1]));
  }
  if (explicitBranches.size > 1) {
    return { value: null, source: 'none', reason: 'تعارض صريح بين فروع تعريف الموظفين؛ يلزم تحديد فرع المصدر.' };
  }
  if (explicitBranches.size === 1) {
    return { value: [...explicitBranches][0], source: 'explicit_introduction', reason: 'فرع صريح في تعريف الموظف بنفسه في رسالة صادرة.' };
  }

  const timeline = buildSmartOwnershipTimeline(session);
  const firstOwner = timeline.episodes.find((e) => e.eligibleForScoring)?.ownerName || null;
  if (firstOwner) {
    const resolved = await resolveWhatsAppStaffV6([firstOwner], null);
    const branch = operationalBranch(resolved.staff?.branch);
    if (branch) {
      return { value: branch, source: 'active_owner', reason: `فرع أول موظف متحقق منه بدأ ملكية المحادثة (${firstOwner}) — قبل أي handoff محتمل لاحقًا.` };
    }
  }

  const candidateNames = [...new Set([...timeline.verifiedStaff.map((s) => s.name), ...session.outboundStaffNames])];
  if (candidateNames.length) {
    const resolved = await resolveWhatsAppStaffV6(candidateNames, null);
    const branch = operationalBranch(resolved.staff?.branch);
    if (branch) {
      return { value: branch, source: 'staff_resolver', reason: 'فرع أقرب موظف تم التعرف عليه من كل أسماء الموظفين الظاهرة في الجلسة (بدون وعي بتوقيت الـhandoff).' };
    }
  }

  return majorityFallback(roles);
}

