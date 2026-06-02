import { cleanPhone, cleanPhoneForWhatsapp } from "@/lib/phone";

export function cleanEgyptianPhone(phone?: string | number | null) {
  return cleanPhoneForWhatsapp(phone);
}

export function displayEgyptianPhone(phone?: string | number | null) {
  return cleanPhone(phone) || "بدون رقم";
}

export function generateWhatsAppLink(phone?: string | number | null, message = "") {
  const clean = cleanPhoneForWhatsapp(phone);
  if (!clean) return "";
  return `https://wa.me/${clean}${message ? `?text=${encodeURIComponent(message)}` : ""}`;
}

export function generateFollowupMessage(
  customer: {
    customer_name?: string | null;
    name?: string | null;
    category?: string | null;
    customer_status?: string | null;
  },
  staff?: { name?: string | null } | string | null,
) {
  const customerName = customer.customer_name || customer.name || "حضرتك";
  const staffName = typeof staff === "string" ? staff : staff?.name || "فريق صيدليات دواء";
  const category = `${customer.category || ""} ${customer.customer_status || ""}`;
  const isVip = /vip|مهم جدًا|مهم جدا/i.test(category);

  if (isVip) {
    return `أهلاً أ/ ${customerName}، مع حضرتك ${staffName} من صيدليات دواء.
حضرتك من عملائنا المهمين، وبنطمن عليك ونتأكد إن احتياجاتك الشهرية متوفرة.
لو في أي أصناف محتاجها، نقدر نجهزها لحضرتك فورًا.
تحت أمرك في أي وقت.`;
  }

  return `أهلاً أ/ ${customerName}، مع حضرتك ${staffName} من صيدليات دواء.
بنطمن على حضرتك ونتأكد إن احتياجاتك الشهرية متوفرة.
لو محتاج أي أدوية أو مستلزمات، نقدر نجهزها لحضرتك في الوقت المناسب.
تحت أمرك يا فندم.`;
}

export function whatsappLink(phone?: string | number | null, message = "") {
  return generateWhatsAppLink(phone, message);
}

export async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  return false;
}
