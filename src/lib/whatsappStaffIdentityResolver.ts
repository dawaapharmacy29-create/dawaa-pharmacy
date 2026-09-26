// حل هوية الموظف الحقيقية (staff_id) لصاحب محادثة واتساب — بترتيب أمان صارم، من غير أي
// resolver جديد. المشكلة اللي بيحلها الملف ده: whatsappSmartReviewOwnership.ts بيستخرج
// اسم العميل من نص المحادثة (مثلًا "اسلام") لكن معندوش أي فكرة عن staff_id الحقيقي؛ وفي
// نفس الوقت whatsappParticipantRoleResolverV15.ts بيحل نفس النوع من الأسماء لـstaff_id
// حقيقي (بمطابقة جزئية زي "اسلام" → "اسلام محمد") لكنه كان بيتشغل في مسار منفصل تمامًا
// وما بيوصلش لصفحة التقييم الرسمي خالص. النتيجة: Reviews.tsx كانت بتحاول تطابق
// "اسلام" == "د اسلام محمد" حرفيًا (بعد تطبيع بسيط) وده بيفشل غالبًا لأي اسم غير كامل.
//
// الحل هنا: ترتيب أمان صارم — من أقوى إشارة (staff_id متحقق منه فعليًا) لأضعف إشارة
// (مطابقة تقريبية للاسم)، وأي غموض (أكتر من مرشح محتمل) بيوقف السلسلة فورًا ويترجع
// ambiguous:true بدل ما يكمل لمرحلة أضعف عشان "يكسر التعادل" — ده بالظبط اللي ممنوع.
import { supabase } from '@/lib/supabase';
import type { WhatsAppParticipantRoleModelV15 } from '@/lib/whatsappParticipantRoleResolverV15';
import { resolveWhatsAppStaffV6 } from '@/lib/whatsappStaffResolverV6';
import { resolveStaffNameToStaffId } from '@/lib/staffIdentityMapping';

export type StaffIdentitySource =
  | 'v15_resolved_id'
  | 'staff_resolver_branch_aware'
  | 'account_staff_mapping'
  | 'staff_resolver_no_branch'
  | 'fuzzy_name_fallback'
  | 'none';

export interface StaffIdentityCandidate {
  staffId: string;
  canonicalStaffName: string;
  role: string | null;
  branch: string | null;
  confidence: number;
}

export interface ResolvedStaffIdentity {
  staffId: string | null;
  accountId: string | null;
  canonicalStaffName: string | null;
  displayName: string;
  role: string | null;
  branch: string | null;
  identityConfidence: number;
  identitySource: StaffIdentitySource;
  ambiguous: boolean;
  candidates: StaffIdentityCandidate[];
}

function unresolved(displayName: string, candidates: StaffIdentityCandidate[] = [], ambiguous = false): ResolvedStaffIdentity {
  return {
    staffId: null, accountId: null, canonicalStaffName: null, displayName,
    role: null, branch: null, identityConfidence: 0, identitySource: 'none',
    ambiguous, candidates,
  };
}

// Tier 1: V15 already resolved a real staff_id for messages inside this owner's episode
// (per-message, grounded in staff_accounts matching that already happened for real).
function fromV15(displayName: string, roles: WhatsAppParticipantRoleModelV15, ownerMessageIds: string[]): ResolvedStaffIdentity | null {
  const ids = new Set(ownerMessageIds);
  const resolved = roles.messages.filter(
    (m) => ids.has(m.messageId) && m.staffId && !['customer', 'system'].includes(m.role)
  );
  if (!resolved.length) return null;

  const byStaffId = new Map<string, typeof resolved>();
  for (const m of resolved) {
    const key = m.staffId!;
    byStaffId.set(key, [...(byStaffId.get(key) || []), m]);
  }
  if (byStaffId.size > 1) {
    // V15 نفسه اتلخبط بين أكتر من staff_id لنفس صاحب المحادثة — ده أخطر حالة، لازم توقّف هنا.
    const candidates: StaffIdentityCandidate[] = [...byStaffId.entries()].map(([staffId, msgs]) => ({
      staffId,
      canonicalStaffName: msgs[0].staffName || displayName,
      role: msgs[0].role,
      branch: msgs[0].branch,
      confidence: Math.max(...msgs.map((m) => m.confidence)),
    }));
    return unresolved(displayName, candidates, true);
  }

  const [staffId, msgs] = [...byStaffId.entries()][0];
  const best = msgs.reduce((a, b) => (b.confidence > a.confidence ? b : a));
  return {
    staffId,
    accountId: best.accountId,
    canonicalStaffName: best.staffName || displayName,
    displayName,
    role: best.role,
    branch: best.branch,
    identityConfidence: best.confidence,
    identitySource: 'v15_resolved_id',
    ambiguous: false,
    candidates: [],
  };
}

function fromV6Result(displayName: string, result: Awaited<ReturnType<typeof resolveWhatsAppStaffV6>>, source: StaffIdentitySource): ResolvedStaffIdentity {
  if (result.strategy === 'ambiguous') {
    return unresolved(displayName, result.candidates.map((c) => ({ staffId: c.id, canonicalStaffName: c.name, role: c.role, branch: c.branch, confidence: Math.round(result.confidence * 100) })), true);
  }
  if (!result.staff) return unresolved(displayName);
  return {
    staffId: result.staff.id,
    accountId: null,
    canonicalStaffName: result.staff.name,
    displayName,
    role: result.staff.role,
    branch: result.staff.branch,
    identityConfidence: Math.round(result.confidence * 100),
    identitySource: source,
    ambiguous: false,
    candidates: [],
  };
}

async function fromAccountStaffMapping(displayName: string): Promise<ResolvedStaffIdentity | null> {
  const staffId = await resolveStaffNameToStaffId(displayName);
  if (!staffId) return null;
  const { data } = await supabase.from('staff').select('id,name,branch,role').eq('id', staffId).maybeSingle();
  if (!data) return null;
  return {
    staffId: data.id,
    accountId: null,
    canonicalStaffName: data.name,
    displayName,
    role: data.role || null,
    branch: data.branch || null,
    identityConfidence: 90, // نفس ثقة resolveStaffNameToStaffId الداخلية لمطابقة alias/اسم مضبوطة
    identitySource: 'account_staff_mapping',
    ambiguous: false,
    candidates: [],
  };
}

/**
 * آخر حل فقط: مطابقة تقريبية (substring/prefix) للاسم مباشرة ضد staff_accounts، بعتبة أضعف
 * من V15/V6. أي أكتر من نتيجة معقولة = ambiguous فورًا، مفيش اختيار تلقائي.
 */
async function fuzzyNameFallback(displayName: string): Promise<ResolvedStaffIdentity> {
  const target = displayName.trim().toLowerCase();
  if (target.length < 2) return unresolved(displayName);
  const { data } = await supabase.from('staff_accounts').select('id,staff_id,staff_name,name,branch,role,active,is_active').limit(800);
  const rows = (data || []).filter((r: any) => r.active !== false && r.is_active !== false);
  const matches = rows.filter((r: any) => {
    const name = String(r.staff_name || r.name || '').trim().toLowerCase();
    return name && (name.startsWith(`${target} `) || target.startsWith(`${name} `) || name === target);
  });
  if (!matches.length) return unresolved(displayName);
  if (matches.length > 1) {
    return unresolved(displayName, matches.map((r: any) => ({
      staffId: String(r.staff_id || r.id), canonicalStaffName: r.staff_name || r.name, role: r.role || null, branch: r.branch || null, confidence: 55,
    })), true);
  }
  const r: any = matches[0];
  return {
    staffId: String(r.staff_id || r.id),
    accountId: String(r.id),
    canonicalStaffName: r.staff_name || r.name,
    displayName,
    role: r.role || null,
    branch: r.branch || null,
    identityConfidence: 55,
    identitySource: 'fuzzy_name_fallback',
    ambiguous: false,
    candidates: [],
  };
}

export async function resolveStaffIdentity(
  displayName: string,
  roles: WhatsAppParticipantRoleModelV15,
  ownerMessageIds: string[],
  branchHint: string | null
): Promise<ResolvedStaffIdentity> {
  const tier1 = fromV15(displayName, roles, ownerMessageIds);
  if (tier1) return tier1;

  if (branchHint) {
    const v6WithBranch = await resolveWhatsAppStaffV6([displayName], branchHint);
    const result = fromV6Result(displayName, v6WithBranch, 'staff_resolver_branch_aware');
    if (result.staffId || result.ambiguous) return result;
  }

  const mapped = await fromAccountStaffMapping(displayName);
  if (mapped) return mapped;

  const v6NoBranch = await resolveWhatsAppStaffV6([displayName], null);
  const resultNoBranch = fromV6Result(displayName, v6NoBranch, 'staff_resolver_no_branch');
  if (resultNoBranch.staffId || resultNoBranch.ambiguous) return resultNoBranch;

  return fuzzyNameFallback(displayName);
}
