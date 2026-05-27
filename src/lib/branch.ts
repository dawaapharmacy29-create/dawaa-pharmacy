export function normalizeBranchName(value: unknown): string {
  const text = String(value || "").trim();
  if (!text) return "غير محدد";
  if (/أبو العزم|ابو العزم|العزم|شكري|shokry|shukri|shkri/i.test(text)) return "فرع شكري";
  if (/الشامي|شامي|shamy|shami/i.test(text)) return "فرع الشامي";
  if (/all|كل الفروع/i.test(text)) return "كل الفروع";
  return text;
}

export function branchMatches(selected: string, rowBranch: unknown): boolean {
  if (!selected || selected === "الكل" || selected === "all" || selected === "كل الفروع") return true;
  return normalizeBranchName(rowBranch) === normalizeBranchName(selected);
}
