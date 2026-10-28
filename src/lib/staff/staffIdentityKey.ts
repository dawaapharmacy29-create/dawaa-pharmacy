import { normalizeArabicName } from '@/lib/security/userDataScope';

/**
 * The single employee identity key: the resolver's name normalization with all
 * whitespace removed. Stored aliases (`staff_identity_aliases.normalized_alias`) and the
 * database ownership key (`dawaa_normalize_staff_alias_v1`) must produce exactly this
 * value. Titles are stripped only with an explicit separator, so a first letter is never
 * dropped (محمد and أحمد stay distinct; دنيا keeps its د).
 */
export function staffIdentityKey(value: unknown): string {
  return normalizeArabicName(String(value ?? '').trim()).replace(/\s+/g, '');
}
