export interface SupabaseErrorLike {
  message?: string | null;
  details?: string | null;
  hint?: string | null;
  code?: string | null;
}

export function logSupabaseError(context: string, error: SupabaseErrorLike) {
  console.error("Supabase error:", {
    context,
    message: error.message,
    details: error.details,
    hint: error.hint,
    code: error.code,
  });
}

export function friendlySupabaseError(error: SupabaseErrorLike | string): string {
  const message = typeof error === "string" ? error : error.message || "";
  const lower = message.toLowerCase();

  if (lower.includes("row-level security") || lower.includes("permission denied")) {
    return "صلاحيات قاعدة البيانات لا تسمح بهذه العملية. راجع صلاحيات المستخدم أو إعدادات RLS في Supabase.";
  }

  if (lower.includes("does not exist") || lower.includes("schema cache") || lower.includes("could not find")) {
    return "جدول أو عمود غير موجود في Supabase. راجع هيكل قاعدة البيانات واسم الجدول أو العمود.";
  }

  if (lower.includes("failed to fetch") || lower.includes("network")) {
    return "تعذر الاتصال بقاعدة البيانات. راجع الاتصال بالإنترنت وإعدادات Supabase.";
  }

  return message || "حدث خطأ غير متوقع في Supabase.";
}
