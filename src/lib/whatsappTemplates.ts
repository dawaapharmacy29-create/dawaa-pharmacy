import type { Customer } from "@/types/database";

export interface WhatsAppTemplate {
  id: string;
  name: string;
  category: "followup" | "promotion" | "reminder" | "thank_you" | "re_engagement";
  template: string;
  variables: string[];
  description: string;
}

/**
 * Smart WhatsApp message templates for customer service
 */
export const whatsappTemplates: WhatsAppTemplate[] = [
  {
    id: "followup_initial",
    name: "متابعة أولية",
    category: "followup",
    template: "مرحباً {customer_name}،\n\nأنا {staff_name} من صيدلية {branch}. أردت التحقق من حالتك والاستفسار إذا كنت تحتاج أي شيء.\n\nهل هناك أي طلبات أو استفسارات يمكنني مساعدتك بها؟",
    variables: ["customer_name", "staff_name", "branch"],
    description: "رسالة متابعة أولية للعميل"
  },
  {
    id: "followup_reminder",
    name: "تذكير بمتابعة",
    category: "reminder",
    template: "مرحباً {customer_name}،\n\nتذكير بموعد متابعتنا المجددة. هل تريد تأجيلها أو إعادة جدولتها؟\n\nنحن هنا لمساعدتك بأي وقت.",
    variables: ["customer_name"],
    description: "تذكير بموعد متابعة"
  },
  {
    id: "promotion_offer",
    name: "عرض خاص",
    category: "promotion",
    template: "مرحباً {customer_name}،\n\nلدينا عرض خاص لك! خصم {discount}% على جميع المنتجات.\n\nالعرض ساري حتى {expiry_date}.\n\nاتصل بنا للحجز: {phone}",
    variables: ["customer_name", "discount", "expiry_date", "phone"],
    description: "عرض ترويجي خاص"
  },
  {
    id: "thank_you_purchase",
    name: "شكر على الشراء",
    category: "thank_you",
    template: "شكراً {customer_name} على ثقتك بنا!\n\nنأمل أن تكون راضياً عن طلبك. إذا كان لديك أي استفسارات، لا تتردد في الاتصال بنا.\n\nمع أطيب التحيات،\n{staff_name}",
    variables: ["customer_name", "staff_name"],
    description: "شكر العميل على الشراء"
  },
  {
    id: "re_engagement_inactive",
    name: "إعادة تفعيل",
    category: "re_engagement",
    template: "مرحباً {customer_name}،\n\nلقد فاتنا! نفتقدك في صيدلية {branch}.\n\nهل هناك أي سبب لعدم زيارتنا مؤخراً؟ نود سماع رأيك وتحسين خدماتنا.\n\nمع أطيب التحيات،\n{staff_name}",
    variables: ["customer_name", "branch", "staff_name"],
    description: "إعادة تفعيل عميل غير نشط"
  },
  {
    id: "followup_result_positive",
    name: "نتيجة إيجابية",
    category: "followup",
    template: "مرحباً {customer_name}،\n\nسعيد جداً بنتيجة متابعتنا الأخيرة. شكراً لتواصلك معنا.\n\nنحن دائماً هنا لمساعدتك. لا تتردد في الاتصال بنا عند الحاجة.\n\nمع أطيب التحيات،\n{staff_name}",
    variables: ["customer_name", "staff_name"],
    description: "متابعة بعد نتيجة إيجابية"
  },
  {
    id: "followup_result_negative",
    name: "نتيجة سلبية",
    category: "followup",
    template: "مرحباً {customer_name}،\n\nأسف أن نتيجة متابعتنا الأخيرة لم تكن كما تتوقع.\n\nنود فهم المزيد لتحسين خدماتنا. هل يمكنك إخبارنا بما يمكننا تحسينه؟\n\nمع أطيب التحيات،\n{staff_name}",
    variables: ["customer_name", "staff_name"],
    description: "متابعة بعد نتيجة سلبية"
  },
  {
    id: "new_product_announcement",
    name: "إعلان منتج جديد",
    category: "promotion",
    template: "مرحباً {customer_name}،\n\nيسعدنا إبلاغك بوصول منتجات جديدة إلى صيدلية {branch}!\n\n{product_description}\n\nالسعر: {price} ج\n\nاتصل بنا للحجز: {phone}",
    variables: ["customer_name", "branch", "product_description", "price", "phone"],
    description: "إعلان عن منتجات جديدة"
  },
  {
    id: "birthday_greeting",
    name: "تهنئة عيد ميلاد",
    category: "thank_you",
    template: "عيد ميلاد سعيد {customer_name}! 🎂\n\nنتمنى لك عاماً سعيداً مليئاً بالصحة والسعادة.\n\nمن صيدلية {branch}، نتمنى لك كل التوفيق.\n\nمع أطيب التحيات،\nفريق الصيدلية",
    variables: ["customer_name", "branch"],
    description: "تهنئة عيد ميلاد"
  },
  {
    id: "appointment_confirmation",
    name: "تأكيد موعد",
    category: "reminder",
    template: "مرحباً {customer_name}،\n\nتم تأكيد موعدك في {date} الساعة {time}.\n\nالموقع: {location}\n\nننتظرك هناك!",
    variables: ["customer_name", "date", "time", "location"],
    description: "تأكيد موعد"
  }
];

/**
 * Generate a WhatsApp message from a template
 */
export function generateWhatsAppMessage(
  templateId: string,
  variables: Record<string, string>
): string {
  const template = whatsappTemplates.find((t) => t.id === templateId);
  
  if (!template) {
    throw new Error(`Template with id ${templateId} not found`);
  }

  let message = template.template;
  
  for (const [key, value] of Object.entries(variables)) {
    message = message.replace(new RegExp(`{${key}}`, "g"), value);
  }

  return message;
}

/**
 * Get recommended template based on customer context
 */
export function getRecommendedTemplate(
  customer: Customer,
  context: "initial" | "followup" | "inactive" | "purchase" | "promotion"
): WhatsAppTemplate {
  switch (context) {
    case "initial":
      return whatsappTemplates.find((t) => t.id === "followup_initial")!;
    case "followup":
      if (customer.retention_status === "at_risk" || customer.retention_status === "threatened") {
        return whatsappTemplates.find((t) => t.id === "re_engagement_inactive")!;
      }
      return whatsappTemplates.find((t) => t.id === "followup_reminder")!;
    case "inactive":
      return whatsappTemplates.find((t) => t.id === "re_engagement_inactive")!;
    case "purchase":
      return whatsappTemplates.find((t) => t.id === "thank_you_purchase")!;
    case "promotion":
      return whatsappTemplates.find((t) => t.id === "promotion_offer")!;
    default:
      return whatsappTemplates.find((t) => t.id === "followup_initial")!;
  }
}

/**
 * Get templates by category
 */
export function getTemplatesByCategory(category: WhatsAppTemplate["category"]): WhatsAppTemplate[] {
  return whatsappTemplates.filter((t) => t.category === category);
}

/**
 * Get all template categories
 */
export function getTemplateCategories(): WhatsAppTemplate["category"][] {
  return Array.from(new Set(whatsappTemplates.map((t) => t.category)));
}

export function buildCustomerServiceWhatsAppMessage(input: {
  customerName?: string | null;
  staffName?: string | null;
  branch?: string | null;
  reason?: string | null;
  flags?: string[];
  purchaseFrequencyStatus?: string | null;
}) {
  const customerName = input.customerName || "حضرتك";
  const staffName = input.staffName || "فريق خدمة العملاء";
  const branch = input.branch || "دواaa Pharmacy";
  const reason = input.reason || "الاطمئنان عليك ومتابعة احتياجاتك";
  const flags = input.flags || [];
  const frequencyStatus = input.purchaseFrequencyStatus || "";

  const lines = [
    `مرحبًا ${customerName}`,
    `معك ${staffName} من ${branch}.`,
    `نتواصل معك بخصوص ${reason}.`,
  ];

  if (frequencyStatus === "توقف عن الشراء") {
    lines.push("لاحظنا توقفًا في مشترياتك مؤخراً، نود التأكد من توافر احتياجاتك في أسرع وقت.");
  } else if (frequencyStatus === "انخفض الشراء") {
    lines.push("لاحظنا انخفاضًا في زياراتك، هل هناك أي خدمات أو عروض خاصة نقدر نساعدك بها؟");
  }

  if (flags.includes("لا توصيل")) {
    lines.push("إذا كنت تفضل عدم التوصيل، نقدر نتعامل معك عبر الاستلام من الصيدلية.");
  }
  if (flags.includes("حساس للسعر")) {
    lines.push("يمكننا تقديم عروض خاصة تناسب ميزانيتك عند الطلب.");
  }
  if (flags.includes("يحتاج تعامل خاص")) {
    lines.push("نحن هنا لتقديم خدمة مميزة تناسب احتياجاتك الخاصة.");
  }

  lines.push("هل يوجد أي طلب أو استفسار نقدر نساعدك فيه؟");
  return lines.join("\n");
}
