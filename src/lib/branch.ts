const UNKNOWN_BRANCH = "\u063A\u064A\u0631 \u0645\u062D\u062F\u062F";
const ALL_BRANCHES = "\u0643\u0644 \u0627\u0644\u0641\u0631\u0648\u0639";
const SHOKRY_BRANCH = "\u0641\u0631\u0639 \u0634\u0643\u0631\u064A";
const SHAMY_BRANCH = "\u0641\u0631\u0639 \u0627\u0644\u0634\u0627\u0645\u064A";

function normalizeArabicText(value: unknown): string {
  return String(value || "")
    .trim()
    .replace(/[\u064B-\u065F\u0640]/g, "")
    .replace(/[\u0623\u0625\u0622]/g, "\u0627")
    .replace(/\u0649/g, "\u064A")
    .replace(/\u0629/g, "\u0647")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function normalizeBranchName(value: unknown): string {
  const text = String(value || "").trim();
  const normalized = normalizeArabicText(text);
  if (!normalized) return UNKNOWN_BRANCH;

  if (
    /all|every|branches/i.test(normalized) ||
    normalized.includes("\u0643\u0644") ||
    normalized.includes("\u0627\u0644\u0643\u0644")
  ) {
    return ALL_BRANCHES;
  }

  if (
    /shokry|shukri|shkri|shoukry|shoukri|abou\s*el\s*azm|abo\s*el\s*azm/i.test(normalized) ||
    normalized.includes("\u0634\u0643\u0631\u064A") ||
    normalized.includes("\u0627\u0644\u0639\u0632\u0645")
  ) {
    return SHOKRY_BRANCH;
  }

  if (
    /shamy|shami|elshamy|el shamy|alshamy|al shamy|elshami|el shami/i.test(normalized) ||
    normalized.includes("\u0627\u0644\u0634\u0627\u0645\u064A") ||
    normalized.includes("\u0634\u0627\u0645\u064A")
  ) {
    return SHAMY_BRANCH;
  }

  return text;
}

export function branchMatches(selected: string, rowBranch: unknown): boolean {
  const normalizedSelected = normalizeBranchName(selected);
  if (
    !selected ||
    normalizedSelected === ALL_BRANCHES ||
    normalizedSelected === UNKNOWN_BRANCH ||
    String(selected).trim().toLowerCase() === "all"
  ) {
    return true;
  }

  return normalizeBranchName(rowBranch) === normalizedSelected;
}
