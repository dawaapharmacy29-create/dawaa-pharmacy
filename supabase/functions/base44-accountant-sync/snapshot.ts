// Parity with Dawaa Bills components/accountant/treasuryMath.js.
type Row = Record<string, unknown>;
const normalize = (value: unknown) =>
  String(value ?? '')
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ');
const legacy: Record<string, string> = {
  نقدية: 'مبيعات',
  تحصيل: 'تحصيل الكتروني',
  'تحصيل إلكتروني': 'تحصيل الكتروني',
  'تحصيل الكترونى': 'تحصيل الكتروني',
  رواتب: 'مرتبات',
  'مصروفات إدارية': 'مصروفات ادارية',
  أرباح: 'ارباح',
  'أرباح مسحوبة': 'ارباح',
};
const groups: Record<string, string[]> = {
  in: ['مبيعات', 'تحصيل الكتروني', 'سيولة'],
  out: ['مخازن', 'شركات', 'مرتبات', 'مصروفات ادارية', 'جمعيات', 'ارباح', 'مصروفات شخصية'],
};
export function resolveAccountantSnapshot(
  transactions: Row[],
  categories: Row[],
  aliases: Row[]
): Row[] {
  const directory = new Map<string, Row>();
  for (const a of [...aliases].sort(
    (a, b) =>
      String(a.updated_date || a.created_date || '').localeCompare(
        String(b.updated_date || b.created_date || '')
      ) || String(a.id).localeCompare(String(b.id))
  ))
    directory.set(String(a.source_key), a);
  const catalog = new Map(categories.map((c) => [String(c.id), c]));
  return transactions.map((t) => {
    const source =
      normalize(t.original_description ?? t.description) ||
      normalize(t.category_name) ||
      'بدون بيان';
    const alias =
      directory.get(t.direction + '|' + source) ||
      directory.get(t.direction + '|' + normalize(t.category_name));
    const category = catalog.get(String(t.category_id));
    const rawGroup = normalize(
      t.classification_override || alias?.group || category?.group || t.category_group
    );
    const group = legacy[rawGroup] || rawGroup;
    return {
      ...t,
      category_name: alias?.target_name || category?.name || t.category_name,
      category_group: groups[String(t.direction)]?.includes(group) ? group : 'غير مصنف',
      classification_override: null,
      source_classification_override: t.classification_override,
      alias_applied: !!alias,
    };
  });
}
