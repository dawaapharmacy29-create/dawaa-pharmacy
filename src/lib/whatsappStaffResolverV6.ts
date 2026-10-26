import { readStaffDirectory } from '@/lib/readModels/staffDirectoryReadModel';
import { resolveStaffDirectoryName } from '@/lib/staff/staffIdentityResolver';

export interface WhatsAppResolvedStaffV6 {
  staff: { id: string; name: string; branch: string | null; role: string | null } | null;
  confidence: number;
  strategy: 'exact_name_branch' | 'exact_alias_branch' | 'exact_name' | 'exact_alias' | 'ambiguous' | 'none' | 'unavailable' | 'retired';
  reason: string;
  candidates: Array<{ id: string; name: string; branch: string | null; role: string | null }>;
}

export async function resolveWhatsAppStaffV6(rawNames: string[], _branch?: string | null): Promise<WhatsAppResolvedStaffV6> {
  const empty = { staff: null, confidence: 0, candidates: [] };
  const names = [...new Set(rawNames.map(name => name.trim()).filter(Boolean))];
  if (!names.length) return { ...empty, strategy: 'none', reason: 'لم يظهر اسم موظف صريح.' };
  let directory;
  try { directory = await readStaffDirectory({ requireComplete: true }); }
  catch { return { ...empty, strategy: 'unavailable', reason: 'دليل الهوية غير متاح بالكامل؛ يلزم إعادة المحاولة.' }; }
  const decisions = names.map(name => resolveStaffDirectoryName(name, directory));
  const candidates = [...new Map(decisions.flatMap(d => d.candidates).filter(row => row.id).map(row => [row.id, {
    id: row.id!, name: row.name || '', role: row.role, branch: row.branch,
  }])).values()];
  if (decisions.some(d => d.status === 'conflict') || candidates.length > 1) {
    return { ...empty, candidates, strategy: 'ambiguous', reason: 'أكثر من هوية تطالب بالاسم؛ الفرع والدور لا يحسمان التعارض.' };
  }
  if (decisions.some(d => d.status === 'retired')) return { ...empty, candidates, strategy: 'retired', reason: 'الاسم مرتبط بهوية مؤرشفة أو غير موجودة؛ يحتاج مراجعة.' };
  const matched = decisions.find(d => d.status === 'resolved');
  if (!matched?.staff?.id) return { ...empty, strategy: 'none', reason: 'الاسم غير محسوم؛ لا توجد مطابقة تقريبية تلقائية.' };
  return { staff: { id: matched.staff.id, name: matched.staff.name || '', role: matched.staff.role, branch: matched.staff.branch },
    confidence: 0.94, strategy: matched.source === 'name' ? 'exact_name' : 'exact_alias', candidates,
    reason: 'هوية ثابتة واحدة في الدليل الكامل دون استبعاد أصحاب الأسماء المتعارضة.' };
}
