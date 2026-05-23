export type CustomerClassKey = "vip" | "important" | "medium" | "normal" | "unknown";
export type CustomerStatusKey = "new" | "active" | "at_risk" | "stopped" | "unknown";

export function calcCLV(totalPurchases?: number | null, monthlyAvg?: number | null) {
  const total = Number(totalPurchases || 0);
  const monthly = Number(monthlyAvg || 0);

  if (total <= 0 && monthly <= 0) {
    return {
      value: null,
      label: "غير كافٍ لحساب القيمة العمرية",
      note: "لا توجد مشتريات أو متوسط شهري كافٍ.",
    };
  }

  if (monthly <= 0) {
    return {
      value: total || null,
      label: total ? `${Math.round(total).toLocaleString("ar-EG")} ج.م` : "غير كافٍ لحساب القيمة العمرية",
      note: "بدون متوسط شهري موثوق.",
    };
  }

  const value = total + monthly * 12;
  return { value, label: `${Math.round(value).toLocaleString("ar-EG")} ج.م`, note: null };
}

export function classifyCustomer(monthlyAvg?: number | null) {
  const avg = Number(monthlyAvg || 0);
  if (avg >= 8000) return { key: "vip" as CustomerClassKey, label: "مهم جدًا", color: "text-purple-400", bg: "bg-purple-500/15 border-purple-500/25" };
  if (avg >= 4000) return { key: "important" as CustomerClassKey, label: "مهم", color: "text-amber-400", bg: "bg-amber-500/15 border-amber-500/25" };
  if (avg >= 1500) return { key: "medium" as CustomerClassKey, label: "متوسط", color: "text-blue-400", bg: "bg-blue-500/15 border-blue-500/25" };
  if (avg > 0) return { key: "normal" as CustomerClassKey, label: "عادي", color: "text-slate-400", bg: "bg-slate-500/15 border-slate-500/25" };
  return { key: "unknown" as CustomerClassKey, label: "غير محدد", color: "text-slate-400", bg: "bg-slate-500/15 border-slate-500/25" };
}

export function customerStatus(lastPurchaseDate?: string | null) {
  if (!lastPurchaseDate) return { key: "unknown" as CustomerStatusKey, label: "غير معروف", days: null, color: "text-slate-400" };

  const date = new Date(lastPurchaseDate);
  if (Number.isNaN(date.getTime())) return { key: "unknown" as CustomerStatusKey, label: "غير معروف", days: null, color: "text-slate-400" };

  const days = Math.floor((Date.now() - date.getTime()) / 86400000);
  if (days <= 14) return { key: "new" as CustomerStatusKey, label: "حديث", days, color: "text-green-400" };
  if (days <= 30) return { key: "active" as CustomerStatusKey, label: "نشط", days, color: "text-teal-400" };
  if (days <= 60) return { key: "at_risk" as CustomerStatusKey, label: "مهدد بالتوقف", days, color: "text-amber-400" };
  return { key: "stopped" as CustomerStatusKey, label: "متوقف", days, color: "text-red-400" };
}
