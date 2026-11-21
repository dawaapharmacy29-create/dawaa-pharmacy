// Sidebar page search: finds a page by any word of its name or its group, the way people type Arabic quickly
// (أ/إ/آ = ا, ة = ه, ى = ي, no diacritics or tatweel, Arabic or Latin digits, any order of words).

export type SearchableGroup<T extends { path: string; label: string }> = { title: string; items: T[] };
export type NavSearchHit<T> = { item: T; group: string };

export function normalizeArabic(text: string): string {
  return text
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Pages whose label (or group title) contains every word of the query. Each page appears once, even when it sits
 * in two groups; matches at the start of the label come first, then the menu order.
 */
export function searchNavItems<T extends { path: string; label: string }>(
  groups: SearchableGroup<T>[],
  query: string,
  limit = 12,
): NavSearchHit<T>[] {
  const words = normalizeArabic(query).split(' ').filter(Boolean);
  if (!words.length) return [];
  const seen = new Set<string>();
  const hits: Array<NavSearchHit<T> & { rank: number; order: number }> = [];
  let order = 0;
  for (const group of groups) {
    const title = normalizeArabic(group.title);
    for (const item of group.items) {
      order += 1;
      const key = `${item.path}|${item.label}`;
      if (seen.has(key)) continue;
      const label = normalizeArabic(item.label);
      const haystack = `${label} ${title}`;
      if (!words.every((word) => haystack.includes(word))) continue;
      seen.add(key);
      const rank = label.startsWith(words[0]) ? 0 : label.split(' ').some((part) => part.startsWith(words[0])) ? 1 : 2;
      hits.push({ item, group: group.title, rank, order });
    }
  }
  return hits
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .slice(0, limit)
    .map(({ item, group }) => ({ item, group }));
}
