import { supabase } from '@/lib/supabase';

export interface WhatsAppResolvedStaffV6 {
  staff: { id: string; name: string; branch: string | null; role: string | null } | null;
  confidence: number;
  strategy: 'exact_name_branch' | 'exact_alias_branch' | 'exact_name' | 'exact_alias' | 'ambiguous' | 'none';
  reason: string;
  candidates: Array<{ id: string; name: string; branch: string | null; role: string | null }>;
}

const normalize = (value: unknown) => String(value ?? '')
  .trim().toLowerCase()
  .replace(/^(?:د\.?|دكتور(?:ه|ة)?)\s*/i, '')
  .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
  .replace(/[\u064B-\u065F]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ')
  .replace(/\s+/g, ' ').trim();

const branchKey = (value: unknown) => normalize(String(value || '').replace(/^فرع\s+/i, ''));

const STAFF_RESOLVER_CACHE_TTL_MS = 5 * 60_000;
let directoryCache: {
  staffRows: Array<{ id: string; name: string; branch: string | null; role: string | null }>;
  aliases: any[];
  expiresAt: number;
} | null = null;
let directoryRequest: Promise<NonNullable<typeof directoryCache>> | null = null;

async function getResolverDirectories() {
  const now = Date.now();
  if (directoryCache && directoryCache.expiresAt > now) return directoryCache;
  if (directoryRequest) return directoryRequest;

  directoryRequest = (async () => {
    const [staffResult, aliasResult] = await Promise.all([
      supabase
        .from('staff')
        .select('id,name,branch,role,is_active,active')
        .or('is_active.eq.true,active.eq.true')
        .limit(500),
      supabase
        .from('staff_identity_aliases')
        .select('staff_id,alias_name,normalized_alias,confidence,active')
        .eq('active', true)
        .limit(1000),
    ]);

    if (staffResult.error) throw staffResult.error;
    const staffRows = (staffResult.data || []).map((row: any) => ({
      id: String(row.id),
      name: String(row.name || ''),
      branch: row.branch || null,
      role: row.role || null,
    }));
    const value = {
      staffRows,
      aliases: aliasResult.error ? [] : (aliasResult.data || []),
      expiresAt: Date.now() + STAFF_RESOLVER_CACHE_TTL_MS,
    };
    directoryCache = value;
    return value;
  })();

  try {
    return await directoryRequest;
  } finally {
    directoryRequest = null;
  }
}

export async function resolveWhatsAppStaffV6(rawNames: string[], branch?: string | null): Promise<WhatsAppResolvedStaffV6> {
  const names = [...new Set(rawNames.map(normalize).filter((x) => x.length >= 2))];
  if (!names.length) return { staff: null, confidence: 0, strategy: 'none', reason: 'لم يظهر اسم دكتور صريح داخل الجزء المصدر.', candidates: [] };

  let directories: Awaited<ReturnType<typeof getResolverDirectories>>;
  try {
    directories = await getResolverDirectories();
  } catch (error) {
    return {
      staff: null,
      confidence: 0,
      strategy: 'none',
      reason: `تعذر قراءة دليل الموظفين: ${error instanceof Error ? error.message : 'خطأ غير معروف'}`,
      candidates: [],
    };
  }

  const active = directories.staffRows;
  const exact = active.filter((row) => names.includes(normalize(row.name)));
  const wantedBranch = branchKey(branch);
  const sameBranch = wantedBranch ? exact.filter((row) => branchKey(row.branch) === wantedBranch) : [];
  if (sameBranch.length === 1) return { staff: sameBranch[0], confidence: 0.99, strategy: 'exact_name_branch', reason: 'تطابق اسم الدكتور بالكامل داخل نفس الفرع.', candidates: exact };
  if (exact.length === 1) return { staff: exact[0], confidence: 0.94, strategy: 'exact_name', reason: 'تطابق اسم الدكتور بالكامل مع موظف نشط واحد.', candidates: exact };
  if (sameBranch.length > 1 || exact.length > 1) return { staff: null, confidence: 0.55, strategy: 'ambiguous', reason: 'الاسم يطابق أكثر من موظف؛ لن يتم التخمين.', candidates: sameBranch.length ? sameBranch : exact };

  const aliasMatches = directories.aliases.filter((row: any) => names.includes(normalize(row.normalized_alias || row.alias_name)));
  const aliasStaffIds = [...new Set(aliasMatches.map((row: any) => String(row.staff_id || '')).filter(Boolean))];
  const aliasCandidates = active.filter((row) => aliasStaffIds.includes(row.id));
  const aliasSameBranch = wantedBranch ? aliasCandidates.filter((row) => branchKey(row.branch) === wantedBranch) : [];
  if (aliasSameBranch.length === 1) return { staff: aliasSameBranch[0], confidence: 0.96, strategy: 'exact_alias_branch', reason: 'تطابق اسم/اختصار الدكتور من قاموس الأسماء داخل نفس الفرع.', candidates: aliasCandidates };
  if (aliasCandidates.length === 1) return { staff: aliasCandidates[0], confidence: 0.9, strategy: 'exact_alias', reason: 'تطابق اسم/اختصار الدكتور مع موظف نشط واحد.', candidates: aliasCandidates };
  if (aliasCandidates.length > 1) return { staff: null, confidence: 0.5, strategy: 'ambiguous', reason: 'اختصار الاسم يطابق أكثر من موظف؛ يحتاج مراجعة.', candidates: aliasCandidates };

  return { staff: null, confidence: 0.25, strategy: 'none', reason: 'لم نجد تطابقًا دقيقًا وآمنًا لاسم الدكتور.', candidates: [] };
}
