import { cleanPhoneForWhatsapp } from "@/lib/phone";

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

function normalizeDigits(value: string) {
  return value.replace(/[٠-٩۰-۹]/g, (digit) => {
    const arabicIndex = ARABIC_DIGITS.indexOf(digit);
    if (arabicIndex >= 0) return String(arabicIndex);

    const persianIndex = PERSIAN_DIGITS.indexOf(digit);
    return persianIndex >= 0 ? String(persianIndex) : digit;
  });
}

export function cleanEgyptianPhone(phone?: string | number | null) {
  let value = normalizeDigits(String(phone ?? "").trim());
  value = value.replace(/[^\d+]/g, "");

  if (value.startsWith("+20")) value = `20${value.slice(3)}`;
  else if (value.startsWith("0020")) value = `20${value.slice(4)}`;
  else if (value.startsWith("01")) value = `20${value.slice(1)}`;
  else if (value.startsWith("1") && value.length === 10) value = `20${value}`;

  return /^201[0125]\d{8}$/.test(value) ? value : "";
}

export function displayEgyptianPhone(phone?: string | number | null) {
  const clean = cleanEgyptianPhone(phone);
  return clean ? `+${clean}` : "بدون رقم";
}

export function generateWhatsAppLink(phone?: string | number | null, message = "") {
  const clean = cleanEgyptianPhone(phone);
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
    return `أهلًا أ/ ${customerName}، مع حضرتك ${staffName} من صيدليات دواء.
حضرتك من عملائنا المهمين، وبنطمن عليك ونتأكد إن احتياجاتك الشهرية متوفرة.
لو في أي أصناف محتاجها، نقدر نجهزها لحضرتك فورًا ونوفرلك التوصيل.
تحت أمرك في أي وقت.`;
  }

  return `أهلًا أ/ ${customerName}، مع حضرتك ${staffName} من صيدليات دواء.
بنطمن على حضرتك ونتأكد إن احتياجاتك الشهرية متوفرة.
لو محتاج أي أدوية أو مستلزمات، نقدر نجهزها لحضرتك ونوفرلك التوصيل في الوقت المناسب.
تحت أمرك يا فندم.`;
}

export function whatsappLink(phone?: string | number | null, message = "") {
  const clean = cleanEgyptianPhone(phone) || cleanPhoneForWhatsapp(phone);
  if (!clean) return "";
  return `https://wa.me/${clean}${message ? `?text=${encodeURIComponent(message)}` : ""}`;
}

export async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  return false;
}
