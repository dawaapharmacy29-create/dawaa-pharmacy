// الجداول الرسمية للتطبيق — استخدم دايماً TABLES بدل كتابة اسم الجدول مباشرة
export const TABLES = {
  // الفريق والحسابات
  staff: "staff",
  staffAccounts: "staff_accounts",
  userProfiles: "user_profiles",
  userPermissions: "user_permissions",
  userPermissionOverrides: "user_permission_overrides",
  permissions: "permissions",
  permissionDefinitions: "permission_definitions",
  roles: "roles",
  rolePermissions: "role_permissions",

  // الجداول والمناوبات
  shiftSchedules: "shift_schedules",
  shiftPerformanceReviews: "shift_performance_reviews",
  shiftPerformanceReviewMembers: "shift_performance_review_members",
  shiftExceptions: "shift_exceptions",
  shiftNotes: "shift_notes",
  shiftNoteOccurrences: "shift_note_occurrences",
  shiftNoteLogs: "shift_note_logs",

  // المعاملات والنقاط
  employeeTransactions: "employee_transactions",
  rewardRules: "reward_rules",
  deductionRules: "deduction_rules",
  evaluationRules: "evaluation_rules",

  // العملاء
  customers: "customers",
  customerAnalysis: "customer_analysis",
  customerRequests: "customer_requests",
  dailyFollowups: "daily_followups",

  // المبيعات والفواتير
  salesInvoices: "sales_invoices",
  branchSalesTargets: "branch_sales_targets",
  conversationSalesReviews: "conversation_sales_reviews",

  // التوصيل
  deliveryOrders: "delivery_orders",
  deliveryEvaluations: "delivery_evaluations",

  // الأدوية والمخزون
  stagnantMedicines: "stagnant_medicines",
  stagnantMedicineDispenses: "stagnant_medicine_dispenses",
  incentiveMedicines: "incentive_medicines",
  incentiveMedicineSales: "incentive_medicine_sales",
  doctorIncentiveSales: "doctor_incentive_sales",
  doctorIncentiveTargets: "doctor_incentive_targets",
  doctorMetrics: "doctor_metrics",
  doctorPermissions: "doctor_permissions",

  // العمليات التشغيلية
  shortageItems: "shortage_items",
  suppliesItems: "supplies_items",
  accessoryItems: "accessory_items",
  shelfTasks: "shelf_tasks",
  branchCleaningTasks: "branch_cleaning_tasks",
  inventoryCountSessions: "inventory_count_sessions",
  inventoryCountItems: "inventory_count_items",

  // التدريب
  trainingModules: "training_modules",
  trainingAssignments: "training_assignments",

  // التسويق والعروض
  offers: "offers",
  offerDispenses: "offer_dispenses",
  whatsappStories: "whatsapp_stories",
  storySales: "story_sales",
  storyPerformanceReports: "story_performance_reports",

  // النظام
  activityLog: "activity_log",
  notifications: "notifications",
  tasks: "tasks",
  branches: "branches",
  settings: "settings",
  attendance: "attendance",
} as const;

export type SupabaseTableName = (typeof TABLES)[keyof typeof TABLES];
