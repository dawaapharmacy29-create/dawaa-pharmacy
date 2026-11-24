// المساعد اللي معاه شيت مهام اليوم بيبدأ يومه منه؛ غير كده من سجل المشتريات وخدمة العملاء.
export function assistantHomePath(checkPermission: (permission: string) => boolean) {
  return checkPermission('customer_service_daily_tasks') ? '/customer-service-tasks' : '/assistant-operational-log';
}
