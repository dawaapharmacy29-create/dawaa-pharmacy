// ============================================================================
// Customer Flags System
// Dawaa Pharmacy 2027
// ============================================================================

export type CustomerFlagSeverity = 'danger' | 'warning' | 'info' | 'success';

export type CustomerFlagCategory = 
  | 'pricing'
  | 'delivery'
  | 'sales'
  | 'service'
  | 'communication'
  | 'importance'
  | 'behavior'
  | 'followup';

export interface CustomerFlag {
  key: string;
  label: string;
  category: CustomerFlagCategory;
  severity: CustomerFlagSeverity;
}

export interface CustomerFlagsObject {
  [key: string]: boolean;
}

// ============================================================================
// 20 Customer Flags Definition
// ============================================================================

export const CUSTOMER_FLAGS: CustomerFlag[] = [
  {
    key: 'price_sensitive',
    label: 'حساس للسعر',
    category: 'pricing',
    severity: 'warning'
  },
  {
    key: 'no_delivery',
    label: 'لا يضاف له توصيل',
    category: 'delivery',
    severity: 'danger'
  },
  {
    key: 'no_substitutes',
    label: 'لا يفضل البدائل',
    category: 'sales',
    severity: 'warning'
  },
  {
    key: 'needs_special_handling',
    label: 'يحتاج تعامل خاص',
    category: 'service',
    severity: 'danger'
  },
  {
    key: 'complains_often',
    label: 'كثير الشكاوى',
    category: 'service',
    severity: 'danger'
  },
  {
    key: 'prefers_whatsapp',
    label: 'يفضل التواصل واتساب',
    category: 'communication',
    severity: 'info'
  },
  {
    key: 'prefers_call',
    label: 'يفضل الاتصال الهاتفي',
    category: 'communication',
    severity: 'info'
  },
  {
    key: 'vip',
    label: 'عميل VIP',
    category: 'importance',
    severity: 'success'
  },
  {
    key: 'needs_manager',
    label: 'يحتاج متابعة مدير',
    category: 'service',
    severity: 'danger'
  },
  {
    key: 'slow_response',
    label: 'يتأخر في الرد',
    category: 'communication',
    severity: 'warning'
  },
  {
    key: 'repeats_same_items',
    label: 'يطلب نفس الأصناف غالبًا',
    category: 'behavior',
    severity: 'info'
  },
  {
    key: 'delivery_speed_sensitive',
    label: 'يهتم بسرعة التوصيل',
    category: 'delivery',
    severity: 'warning'
  },
  {
    key: 'needs_price_explanation',
    label: 'يرفض زيادة السعر بدون توضيح',
    category: 'pricing',
    severity: 'warning'
  },
  {
    key: 'needs_usage_explanation',
    label: 'يحتاج شرح طريقة الاستخدام',
    category: 'service',
    severity: 'info'
  },
  {
    key: 'family_buyer',
    label: 'يشتري لأكثر من شخص في البيت',
    category: 'behavior',
    severity: 'info'
  },
  {
    key: 'needs_periodic_reminder',
    label: 'يحتاج تذكير دوري',
    category: 'followup',
    severity: 'info'
  },
  {
    key: 'dislikes_pressure',
    label: 'لا يحب الإلحاح',
    category: 'communication',
    severity: 'warning'
  },
  {
    key: 'offers_sensitive',
    label: 'يهتم بالعروض',
    category: 'pricing',
    severity: 'success'
  },
  {
    key: 'confirm_before_delivery',
    label: 'يحتاج تأكيد قبل إرسال الطلب',
    category: 'delivery',
    severity: 'warning'
  },
  {
    key: 'address_needs_review',
    label: 'عنوانه يحتاج مراجعة قبل التوصيل',
    category: 'delivery',
    severity: 'danger'
  }
];

// ============================================================================
// Flag Priority Order (for display)
// ============================================================================

export const FLAG_PRIORITY: string[] = [
  'no_delivery',
  'needs_manager',
  'needs_special_handling',
  'complains_often',
  'price_sensitive',
  'no_substitutes',
  'vip',
  'address_needs_review',
  'needs_price_explanation',
  'delivery_speed_sensitive',
  'confirm_before_delivery',
  'dislikes_pressure',
  'slow_response',
  'offers_sensitive',
  'prefers_whatsapp',
  'prefers_call',
  'needs_usage_explanation',
  'repeats_same_items',
  'family_buyer',
  'needs_periodic_reminder'
];

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Safely parse customer_flags from database (may be null, object, string, or unexpected)
 */
export function parseCustomerFlags(value: any): CustomerFlagsObject {
  if (!value) return {};
  
  // If it's already an object, validate and return
  if (typeof value === 'object' && !Array.isArray(value)) {
    if (isValidCustomerFlagsObject(value)) {
      return value;
    }
    // If invalid, try to extract boolean values
    const result: CustomerFlagsObject = {};
    for (const flag of CUSTOMER_FLAGS) {
      if (typeof value[flag.key] === 'boolean') {
        result[flag.key] = value[flag.key];
      }
    }
    return result;
  }
  
  // If it's a string, try to parse as JSON
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parseCustomerFlags(parsed);
      }
    } catch {
      // Not valid JSON, return empty object
    }
  }
  
  return {};
}

/**
 * Get active customer flags (flags that are true)
 */
export function getActiveCustomerFlags(customer_flags: any): CustomerFlag[] {
  const parsed = parseCustomerFlags(customer_flags);
  return CUSTOMER_FLAGS.filter(flag => parsed[flag.key] === true);
}

/**
 * Check if a specific flag is active
 */
export function hasCustomerFlag(customer_flags: any, key: string): boolean {
  const parsed = parseCustomerFlags(customer_flags);
  return parsed[key] === true;
}

/**
 * Toggle a specific flag
 */
export function toggleCustomerFlag(existingFlags: any, key: string, value?: boolean): CustomerFlagsObject {
  const parsed = parseCustomerFlags(existingFlags);
  const newValue = value !== undefined ? value : !parsed[key];
  
  return {
    ...parsed,
    [key]: newValue
  };
}

/**
 * Merge new flags into existing flags without removing unknown keys
 */
export function mergeCustomerFlags(existingFlags: any, newFlags: Partial<CustomerFlagsObject>): CustomerFlagsObject {
  const parsed = parseCustomerFlags(existingFlags);
  
  return {
    ...parsed,
    ...newFlags
  };
}

/**
 * Validate if value is a valid customer flags object
 */
export function isValidCustomerFlagsObject(value: any): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  
  // Check if at least one key matches a known flag
  const hasKnownKey = Object.keys(value).some(key => 
    CUSTOMER_FLAGS.some(flag => flag.key === key)
  );
  
  return hasKnownKey;
}

/**
 * Get flag by key
 */
export function getFlagByKey(key: string): CustomerFlag | undefined {
  return CUSTOMER_FLAGS.find(flag => flag.key === key);
}

/**
 * Get flags by category
 */
export function getFlagsByCategory(category: CustomerFlagCategory): CustomerFlag[] {
  return CUSTOMER_FLAGS.filter(flag => flag.category === category);
}

/**
 * Get flags by severity
 */
export function getFlagsBySeverity(severity: CustomerFlagSeverity): CustomerFlag[] {
  return CUSTOMER_FLAGS.filter(flag => flag.severity === severity);
}

/**
 * Sort flags by priority
 */
export function sortFlagsByPriority(flags: CustomerFlag[]): CustomerFlag[] {
  return flags.sort((a, b) => {
    const indexA = FLAG_PRIORITY.indexOf(a.key);
    const indexB = FLAG_PRIORITY.indexOf(b.key);
    return (indexA === -1 ? 999 : indexA) - (indexB === -1 ? 999 : indexB);
  });
}

/**
 * Get top N flags by priority
 */
export function getTopFlags(flags: CustomerFlag[], limit: number = 3): CustomerFlag[] {
  const sorted = sortFlagsByPriority(flags);
  return sorted.slice(0, limit);
}

/**
 * Get severity color class for UI
 */
export function getSeverityColorClass(severity: CustomerFlagSeverity): string {
  switch (severity) {
    case 'danger':
      return 'bg-red-100 text-red-800 border-red-200';
    case 'warning':
      return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    case 'info':
      return 'bg-blue-100 text-blue-800 border-blue-200';
    case 'success':
      return 'bg-green-100 text-green-800 border-green-200';
    default:
      return 'bg-gray-100 text-gray-800 border-gray-200';
  }
}

/**
 * Get severity badge style for UI
 */
export function getSeverityBadgeStyle(severity: CustomerFlagSeverity): string {
  switch (severity) {
    case 'danger':
      return 'text-red-700 bg-red-50 border-red-200';
    case 'warning':
      return 'text-yellow-700 bg-yellow-50 border-yellow-200';
    case 'info':
      return 'text-blue-700 bg-blue-50 border-blue-200';
    case 'success':
      return 'text-green-700 bg-green-50 border-green-200';
    default:
      return 'text-gray-700 bg-gray-50 border-gray-200';
  }
}
