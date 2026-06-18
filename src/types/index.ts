export interface User {
  id: string;
  staffId?: string;
  name: string;
  username: string;
  role: string;
  branch: string;
  avatar?: string;
  phone?: string;
  email?: string;
  active: boolean;
  permissions?: Record<string, boolean>;
}

export interface Employee {
  id: string;
  name: string;
  username: string;
  phone: string;
  role: string;
  branch: string;
  shiftStart: string;
  shiftEnd: string;
  holidayDay: string;
  notes?: string;
  points: number;
  maxPoints: number;
  status: "نشط" | "إجازة" | "معطل";
  joinDate: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  branch: string;
  type: string;
  notes?: string | null;
  lastPurchase: string | null;
  firstPurchase: string | null;
  totalPurchases: number | null;
  totalInvoices?: number | null;
  avgInvoice?: number | null;
  avgMonthly?: number | null;
  clv?: number | null;
  riskScore?: number | null;
  retentionStatus?: "محتفظ" | "معرض للفقدان" | "مفقود" | "جديد" | string | null;
  followups?: Followup[];
  whatsappNotes?: string | null;
  customer_code?: string | null;
  customer_phone?: string | null;
  final_customer_key?: string | null;
  invoices_count?: number | null;
  total_spent?: number | null;
  customer_notes?: string | null;
  displayPhone?: string;
  createdAt?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface Followup {
  id: string;
  customerId: string;
  status: string;
  note: string;
  assignedTo: string;
  createdAt: string;
  updatedAt: string;
}

export interface PointRecord {
  id: string;
  employeeId: string;
  employeeName: string;
  type: "مكافأة" | "خصم";
  points: number;
  reason: string;
  managerNote?: string;
  createdBy: string;
  createdAt: string;
  branch: string;
}

export interface PointRule {
  id: string;
  name: string;
  type: "مكافأة" | "خصم";
  points: number;
  description?: string;
  active: boolean;
}

export interface DeliveryOrder {
  id: string;
  customerName: string;
  customerPhone: string;
  branch: string;
  deliveryId: string;
  deliveryName: string;
  status: string;
  address: string;
  items: string;
  total: number;
  createdAt: string;
  deliveredAt?: string;
  rating?: number;
}

export interface Notification {
  id: string;
  userId: string;
  title: string;
  body: string;
  type: "مكافأة" | "خصم" | "مهمة" | "شكوى" | "تذكير" | "عام";
  read: boolean;
  createdAt: string;
}

export interface ActivityLog {
  id: string;
  userId: string;
  userName: string;
  action: string;
  module: string;
  details: string;
  createdAt: string;
  branch: string;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  customerName: string;
  customerPhone: string;
  branch: string;
  total: number;
  date: string;
  items?: string;
}

export interface ScheduleShift {
  id: string;
  employeeId: string;
  employeeName: string;
  role: string;
  branch: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isHoliday: boolean;
  is_day_off?: boolean;
}
