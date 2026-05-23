import type { Employee, Customer, PointRecord, PointRule, DeliveryOrder, Notification, ActivityLog, ScheduleShift } from "@/types";

// ── EMPLOYEES ──────────────────────────────────────────────
export const MOCK_EMPLOYEES: Employee[] = [
  { id: "e1", name: "د. أحمد محمود", username: "ahmed.mahmoud", phone: "01001234567", role: "صيدلاني", branch: "فرع شكري", shiftStart: "09:00", shiftEnd: "17:00", holidayDay: "الجمعة", points: 285, maxPoints: 300, status: "نشط", joinDate: "2023-03-15" },
  { id: "e2", name: "د. سارة خالد", username: "sara.khaled", phone: "01112345678", role: "صيدلاني", branch: "فرع شكري", shiftStart: "14:00", shiftEnd: "22:00", holidayDay: "السبت", points: 310, maxPoints: 300, status: "نشط", joinDate: "2022-08-01" },
  { id: "e3", name: "محمد عبدالله", username: "mohamed.abdallah", phone: "01223456789", role: "مساعد", branch: "فرع شكري", shiftStart: "09:00", shiftEnd: "17:00", holidayDay: "الجمعة", points: 265, maxPoints: 300, status: "نشط", joinDate: "2024-01-10" },
  { id: "e4", name: "علي حسن", username: "ali.hassan", phone: "01034567890", role: "توصيل", branch: "فرع شكري", shiftStart: "10:00", shiftEnd: "20:00", holidayDay: "الأحد", points: 295, maxPoints: 300, status: "نشط", joinDate: "2023-06-20" },
  { id: "e5", name: "د. مريم سالم", username: "mariam.salem", phone: "01145678901", role: "صيدلاني", branch: "فرع الشامي", shiftStart: "08:00", shiftEnd: "16:00", holidayDay: "الجمعة", points: 300, maxPoints: 300, status: "نشط", joinDate: "2022-11-05" },
  { id: "e6", name: "د. كريم إبراهيم", username: "karim.ibrahim", phone: "01256789012", role: "صيدلاني", branch: "فرع الشامي", shiftStart: "16:00", shiftEnd: "00:00", holidayDay: "السبت", points: 278, maxPoints: 300, status: "نشط", joinDate: "2023-01-22" },
  { id: "e7", name: "نور عمر", username: "nour.omar", phone: "01067890123", role: "مساعد", branch: "فرع الشامي", shiftStart: "09:00", shiftEnd: "18:00", holidayDay: "الجمعة", points: 240, maxPoints: 300, status: "نشط", joinDate: "2024-03-01" },
  { id: "e8", name: "حسام طارق", username: "hossam.tarek", phone: "01178901234", role: "توصيل", branch: "فرع الشامي", shiftStart: "11:00", shiftEnd: "21:00", holidayDay: "الأحد", points: 255, maxPoints: 300, status: "نشط", joinDate: "2023-09-14" },
  { id: "e9", name: "منى رمضان", username: "mona.ramadan", phone: "01289012345", role: "خدمة عملاء", branch: "فرع شكري", shiftStart: "09:00", shiftEnd: "17:00", holidayDay: "الجمعة", points: 320, maxPoints: 300, status: "نشط", joinDate: "2022-05-30" },
  { id: "e10", name: "ياسمين فاروق", username: "yasmine.farouk", phone: "01090123456", role: "مدير فرع", branch: "فرع شكري", shiftStart: "09:00", shiftEnd: "18:00", holidayDay: "الجمعة", points: 298, maxPoints: 300, status: "نشط", joinDate: "2021-12-01" },
  { id: "e11", name: "عمر الشريف", username: "omar.sherif", phone: "01101234567", role: "مدير فرع", branch: "فرع الشامي", shiftStart: "09:00", shiftEnd: "18:00", holidayDay: "الجمعة", points: 290, maxPoints: 300, status: "نشط", joinDate: "2022-02-14" },
];

// ── AUTH USERS ────────────────────────────────────────────
export const AUTH_USERS = [
  { username: "admin", password: "admin123", role: "أدمن", name: "المدير العام", branch: "الكل", id: "u0" },
  { username: "yasmine.farouk", password: "pass123", role: "مدير فرع", name: "ياسمين فاروق", branch: "فرع شكري", id: "e10" },
  { username: "omar.sherif", password: "pass123", role: "مدير فرع", name: "عمر الشريف", branch: "فرع الشامي", id: "e11" },
  { username: "ahmed.mahmoud", password: "pass123", role: "صيدلاني", name: "د. أحمد محمود", branch: "فرع شكري", id: "e1" },
  { username: "sara.khaled", password: "pass123", role: "صيدلاني", name: "د. سارة خالد", branch: "فرع شكري", id: "e2" },
];

// ── CUSTOMERS ─────────────────────────────────────────────
export const MOCK_CUSTOMERS: Customer[] = [
  { id: "c1", name: "أم محمد الغامدي", phone: "01001111111", branch: "فرع شكري", type: "مهم جداً", avgMonthly: 12000, totalPurchases: 144000, totalInvoices: 48, avgInvoice: 3000, clv: 288000, riskScore: 10, retentionStatus: "محتفظ", lastPurchase: "2026-05-13", firstPurchase: "2024-01-15", notes: "عميلة VIP، تحتاج متابعة أسبوعية", whatsappNotes: "رسالة مرسلة 10 مايو", followups: [], createdAt: "2024-01-15" },
  { id: "c2", name: "حسين عبدالرحمن", phone: "01002222222", branch: "فرع شكري", type: "مهم", avgMonthly: 5500, totalPurchases: 33000, totalInvoices: 18, avgInvoice: 1833, clv: 66000, riskScore: 25, retentionStatus: "محتفظ", lastPurchase: "2026-05-10", firstPurchase: "2025-06-01", notes: "", whatsappNotes: "", followups: [], createdAt: "2025-06-01" },
  { id: "c3", name: "فاطمة إبراهيم", phone: "01003333333", branch: "فرع الشامي", type: "متوسط", avgMonthly: 2500, totalPurchases: 15000, totalInvoices: 12, avgInvoice: 1250, clv: 30000, riskScore: 40, retentionStatus: "محتفظ", lastPurchase: "2026-04-28", firstPurchase: "2025-09-10", notes: "", whatsappNotes: "", followups: [], createdAt: "2025-09-10" },
  { id: "c4", name: "محمود صالح", phone: "01004444444", branch: "فرع الشامي", type: "عادي", avgMonthly: 800, totalPurchases: 4800, totalInvoices: 8, avgInvoice: 600, clv: 9600, riskScore: 65, retentionStatus: "معرض للفقدان", lastPurchase: "2026-03-15", firstPurchase: "2025-11-01", notes: "", whatsappNotes: "", followups: [], createdAt: "2025-11-01" },
  { id: "c5", name: "نجوى الحسن", phone: "01005555555", branch: "فرع شكري", type: "مهم جداً", avgMonthly: 9500, totalPurchases: 114000, totalInvoices: 36, avgInvoice: 3167, clv: 228000, riskScore: 15, retentionStatus: "محتفظ", lastPurchase: "2026-05-12", firstPurchase: "2023-12-01", notes: "تفضل التواصل عبر واتساب", whatsappNotes: "رسالة عيد مرسلة", followups: [], createdAt: "2023-12-01" },
  { id: "c6", name: "خالد أبو زيد", phone: "01006666666", branch: "فرع شكري", type: "متوسط", avgMonthly: 3200, totalPurchases: 9600, totalInvoices: 6, avgInvoice: 1600, clv: 19200, riskScore: 35, retentionStatus: "محتفظ", lastPurchase: "2026-05-08", firstPurchase: "2026-02-01", notes: "", whatsappNotes: "", followups: [], createdAt: "2026-02-01" },
  { id: "c7", name: "سامية ناصر", phone: "01007777777", branch: "فرع الشامي", type: "مهم", avgMonthly: 6200, totalPurchases: 74400, totalInvoices: 30, avgInvoice: 2480, clv: 148800, riskScore: 20, retentionStatus: "محتفظ", lastPurchase: "2026-05-11", firstPurchase: "2024-04-15", notes: "", whatsappNotes: "", followups: [], createdAt: "2024-04-15" },
  { id: "c8", name: "وليد منصور", phone: "01008888888", branch: "فرع الشامي", type: "عادي", avgMonthly: 500, totalPurchases: 1500, totalInvoices: 3, avgInvoice: 500, clv: 3000, riskScore: 80, retentionStatus: "مفقود", lastPurchase: "2026-01-20", firstPurchase: "2025-10-05", notes: "", whatsappNotes: "", followups: [], createdAt: "2025-10-05" },
  { id: "c9", name: "رانيا السيد", phone: "01009999999", branch: "فرع شكري", type: "مهم جداً", avgMonthly: 11000, totalPurchases: 88000, totalInvoices: 28, avgInvoice: 3143, clv: 176000, riskScore: 12, retentionStatus: "محتفظ", lastPurchase: "2026-05-13", firstPurchase: "2024-06-20", notes: "عميلة محتاجة أدوية مزمنة شهرية", whatsappNotes: "", followups: [], createdAt: "2024-06-20" },
  { id: "c10", name: "طارق الجمال", phone: "01010101010", branch: "فرع شكري", type: "متوسط", avgMonthly: 1800, totalPurchases: 5400, totalInvoices: 6, avgInvoice: 900, clv: 10800, riskScore: 50, retentionStatus: "معرض للفقدان", lastPurchase: "2026-03-30", firstPurchase: "2025-12-01", notes: "", whatsappNotes: "", followups: [], createdAt: "2025-12-01" },
];

// ── POINT RULES ───────────────────────────────────────────
export const MOCK_POINT_RULES: PointRule[] = [
  { id: "r1", name: "تأخر في الحضور", type: "خصم", points: 10, description: "تأخر أكثر من 15 دقيقة عن بداية الشيفت", active: true },
  { id: "r2", name: "دواء خاطئ", type: "خصم", points: 30, description: "صرف دواء خاطئ للعميل", active: true },
  { id: "r3", name: "شكوى عميل", type: "خصم", points: 20, description: "شكوى موثقة من عميل", active: true },
  { id: "r4", name: "خطأ في الفاتورة", type: "خصم", points: 15, description: "خطأ في تسجيل فاتورة", active: true },
  { id: "r5", name: "بيع ممتاز", type: "مكافأة", points: 15, description: "تحقيق مبيعات استثنائية", active: true },
  { id: "r6", name: "تعاون الفريق", type: "مكافأة", points: 10, description: "مساعدة زملاء الفريق", active: true },
  { id: "r7", name: "تقييم إيجابي", type: "مكافأة", points: 20, description: "حصول على تقييم 5 نجوم من عميل", active: true },
  { id: "r8", name: "مبادرة شخصية", type: "مكافأة", points: 25, description: "مبادرة إيجابية تفيد الصيدلية", active: true },
  { id: "r9", name: "حضور مبكر", type: "مكافأة", points: 5, description: "الحضور قبل الموعد بـ 10 دقائق", active: true },
];

// ── POINT RECORDS ─────────────────────────────────────────
export const MOCK_POINT_RECORDS: PointRecord[] = [
  { id: "pr1", employeeId: "e1", employeeName: "د. أحمد محمود", type: "خصم", points: 15, reason: "تأخر في الحضور", managerNote: "تأخر 20 دقيقة يوم الأحد", createdBy: "ياسمين فاروق", createdAt: "2026-05-10T09:30:00", branch: "فرع شكري" },
  { id: "pr2", employeeId: "e2", employeeName: "د. سارة خالد", type: "مكافأة", points: 20, reason: "تقييم إيجابي", managerNote: "حصلت على 3 تقييمات 5 نجوم هذا الأسبوع", createdBy: "ياسمين فاروق", createdAt: "2026-05-11T14:00:00", branch: "فرع شكري" },
  { id: "pr3", employeeId: "e3", employeeName: "محمد عبدالله", type: "خصم", points: 20, reason: "شكوى عميل", managerNote: "شكوى من عميل بسبب تأخير في الخدمة", createdBy: "ياسمين فاروق", createdAt: "2026-05-08T11:15:00", branch: "فرع شكري" },
  { id: "pr4", employeeId: "e5", employeeName: "د. مريم سالم", type: "مكافأة", points: 25, reason: "مبادرة شخصية", managerNote: "نظمت قاعدة البيانات وحسّنت الترتيب", createdBy: "عمر الشريف", createdAt: "2026-05-09T10:00:00", branch: "فرع الشامي" },
  { id: "pr5", employeeId: "e7", employeeName: "نور عمر", type: "خصم", points: 30, reason: "دواء خاطئ", managerNote: "خطأ في صرف دواء ضغط، تم التدارك", createdBy: "عمر الشريف", createdAt: "2026-05-12T15:30:00", branch: "فرع الشامي" },
  { id: "pr6", employeeId: "e4", employeeName: "علي حسن", type: "مكافأة", points: 15, reason: "بيع ممتاز", managerNote: "أعلى مبيعات توصيل في اليوم", createdBy: "ياسمين فاروق", createdAt: "2026-05-13T18:00:00", branch: "فرع شكري" },
  { id: "pr7", employeeId: "e9", employeeName: "منى رمضان", type: "مكافأة", points: 20, reason: "تقييم إيجابي", managerNote: "شكر من عميل VIP", createdBy: "ياسمين فاروق", createdAt: "2026-05-07T09:00:00", branch: "فرع شكري" },
];

// ── DELIVERY ORDERS ───────────────────────────────────────
export const MOCK_ORDERS: DeliveryOrder[] = [
  { id: "o1", customerName: "أم محمد الغامدي", customerPhone: "01001111111", branch: "فرع شكري", deliveryId: "e4", deliveryName: "علي حسن", status: "في الطريق", address: "المقطم، شارع 9", items: "أموكسيسيلين، أسبرين", total: 350, createdAt: "2026-05-14T10:30:00" },
  { id: "o2", customerName: "حسين عبدالرحمن", customerPhone: "01002222222", branch: "فرع شكري", deliveryId: "e4", deliveryName: "علي حسن", status: "تم التسليم", address: "المعادي، شارع الحرية", items: "أنسولين نوفو", total: 1200, createdAt: "2026-05-14T09:00:00", deliveredAt: "2026-05-14T09:45:00", rating: 5 },
  { id: "o3", customerName: "نجوى الحسن", customerPhone: "01005555555", branch: "فرع شكري", deliveryId: "e4", deliveryName: "علي حسن", status: "قيد التحضير", address: "المهندسين، شارع السودان", items: "أدوية ضغط، فيتامينات", total: 800, createdAt: "2026-05-14T11:00:00" },
  { id: "o4", customerName: "سامية ناصر", customerPhone: "01007777777", branch: "فرع الشامي", deliveryId: "e8", deliveryName: "حسام طارق", status: "في الطريق", address: "الشامي، شارع الملك", items: "أدوية سكر", total: 650, createdAt: "2026-05-14T10:00:00" },
  { id: "o5", customerName: "فاطمة إبراهيم", customerPhone: "01003333333", branch: "فرع الشامي", deliveryId: "e8", deliveryName: "حسام طارق", status: "تم التسليم", address: "الدقي، شارع النيل", items: "مضادات حيوية", total: 280, createdAt: "2026-05-14T08:30:00", deliveredAt: "2026-05-14T09:15:00", rating: 4 },
  { id: "o6", customerName: "رانيا السيد", customerPhone: "01009999999", branch: "فرع شكري", deliveryId: "e4", deliveryName: "علي حسن", status: "مرتجع", address: "الزمالك، شارع 26 يوليو", items: "دواء منتهي الصلاحية", total: 450, createdAt: "2026-05-13T15:00:00" },
];

// ── NOTIFICATIONS ─────────────────────────────────────────
export const MOCK_NOTIFICATIONS: Notification[] = [
  { id: "n1", userId: "e1", title: "تم خصم نقاط", body: "تم خصم 15 نقطة بسبب التأخر في الحضور", type: "خصم", read: false, createdAt: "2026-05-10T09:30:00" },
  { id: "n2", userId: "e2", title: "مكافأة جديدة!", body: "تم إضافة 20 نقطة - تقييم إيجابي ممتاز", type: "مكافأة", read: false, createdAt: "2026-05-11T14:00:00" },
  { id: "n3", userId: "e4", title: "مكافأة بيع ممتاز", body: "تم إضافة 15 نقطة - أعلى مبيعات توصيل اليوم", type: "مكافأة", read: true, createdAt: "2026-05-13T18:00:00" },
  { id: "n4", userId: "u0", title: "شكوى عميل جديدة", body: "شكوى مسجلة من عميل في فرع شكري", type: "شكوى", read: false, createdAt: "2026-05-08T11:15:00" },
  { id: "n5", userId: "u0", title: "تذكير متابعة VIP", body: "أم محمد الغامدي لم تتسوق منذ 3 أيام", type: "تذكير", read: false, createdAt: "2026-05-14T08:00:00" },
];

// ── ACTIVITY LOGS ─────────────────────────────────────────
export const MOCK_ACTIVITY_LOGS: ActivityLog[] = [
  { id: "al1", userId: "u0", userName: "المدير العام", action: "تسجيل دخول", module: "النظام", details: "تسجيل دخول ناجح", createdAt: "2026-05-14T08:00:00", branch: "الكل" },
  { id: "al2", userId: "e10", userName: "ياسمين فاروق", action: "إضافة خصم", module: "النقاط", details: "خصم 15 نقطة من د. أحمد محمود - تأخر في الحضور", createdAt: "2026-05-10T09:30:00", branch: "فرع شكري" },
  { id: "al3", userId: "e10", userName: "ياسمين فاروق", action: "إضافة مكافأة", module: "النقاط", details: "إضافة 20 نقطة لد. سارة خالد - تقييم إيجابي", createdAt: "2026-05-11T14:00:00", branch: "فرع شكري" },
  { id: "al4", userId: "e11", userName: "عمر الشريف", action: "إضافة مكافأة", module: "النقاط", details: "إضافة 25 نقطة لد. مريم سالم - مبادرة شخصية", createdAt: "2026-05-09T10:00:00", branch: "فرع الشامي" },
  { id: "al5", userId: "u0", userName: "المدير العام", action: "استيراد فواتير", module: "الفواتير", details: "استيراد 45 فاتورة بنجاح - فرع شكري", createdAt: "2026-05-08T12:00:00", branch: "فرع شكري" },
  { id: "al6", userId: "e10", userName: "ياسمين فاروق", action: "تعديل عميل", module: "العملاء", details: "تحديث بيانات أم محمد الغامدي", createdAt: "2026-05-07T10:30:00", branch: "فرع شكري" },
  { id: "al7", userId: "e11", userName: "عمر الشريف", action: "إضافة خصم", module: "النقاط", details: "خصم 30 نقطة من نور عمر - دواء خاطئ", createdAt: "2026-05-12T15:30:00", branch: "فرع الشامي" },
  { id: "al8", userId: "u0", userName: "المدير العام", action: "تسجيل دخول", module: "النظام", details: "تسجيل دخول ناجح", createdAt: "2026-05-13T07:55:00", branch: "الكل" },
];

// ── SCHEDULE ──────────────────────────────────────────────
export const MOCK_SCHEDULE: ScheduleShift[] = [
  { id: "s1", employeeId: "e1", employeeName: "د. أحمد محمود", role: "صيدلاني", branch: "فرع شكري", dayOfWeek: 0, startTime: "09:00", endTime: "17:00", isHoliday: false },
  { id: "s2", employeeId: "e1", employeeName: "د. أحمد محمود", role: "صيدلاني", branch: "فرع شكري", dayOfWeek: 5, startTime: "09:00", endTime: "17:00", isHoliday: true },
  { id: "s3", employeeId: "e2", employeeName: "د. سارة خالد", role: "صيدلاني", branch: "فرع شكري", dayOfWeek: 1, startTime: "14:00", endTime: "22:00", isHoliday: false },
  { id: "s4", employeeId: "e3", employeeName: "محمد عبدالله", role: "مساعد", branch: "فرع شكري", dayOfWeek: 2, startTime: "09:00", endTime: "17:00", isHoliday: false },
  { id: "s5", employeeId: "e4", employeeName: "علي حسن", role: "توصيل", branch: "فرع شكري", dayOfWeek: 3, startTime: "10:00", endTime: "20:00", isHoliday: false },
  { id: "s6", employeeId: "e5", employeeName: "د. مريم سالم", role: "صيدلاني", branch: "فرع الشامي", dayOfWeek: 0, startTime: "08:00", endTime: "16:00", isHoliday: false },
  { id: "s7", employeeId: "e6", employeeName: "د. كريم إبراهيم", role: "صيدلاني", branch: "فرع الشامي", dayOfWeek: 4, startTime: "16:00", endTime: "00:00", isHoliday: false },
  { id: "s8", employeeId: "e7", employeeName: "نور عمر", role: "مساعد", branch: "فرع الشامي", dayOfWeek: 1, startTime: "09:00", endTime: "18:00", isHoliday: false },
  { id: "s9", employeeId: "e8", employeeName: "حسام طارق", role: "توصيل", branch: "فرع الشامي", dayOfWeek: 2, startTime: "11:00", endTime: "21:00", isHoliday: false },
];

// ── MONTHLY SALES DATA ────────────────────────────────────
export const MOCK_MONTHLY_SALES = [
  { month: "يناير", shokri: 85000, shami: 72000, total: 157000 },
  { month: "فبراير", shokri: 92000, shami: 78000, total: 170000 },
  { month: "مارس", shokri: 88000, shami: 81000, total: 169000 },
  { month: "إبريل", shokri: 105000, shami: 89000, total: 194000 },
  { month: "مايو", shokri: 98000, shami: 85000, total: 183000 },
];

export const MOCK_CUSTOMER_GROWTH = [
  { month: "يناير", جديد: 12, مفقود: 3, إجمالي: 82 },
  { month: "فبراير", جديد: 8, مفقود: 2, إجمالي: 88 },
  { month: "مارس", جديد: 15, مفقود: 4, إجمالي: 99 },
  { month: "إبريل", جديد: 11, مفقود: 5, إجمالي: 105 },
  { month: "مايو", جديد: 7, مفقود: 2, إجمالي: 110 },
];
