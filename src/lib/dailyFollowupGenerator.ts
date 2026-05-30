import type { Customer, DailyFollowup } from "@/types/database";

interface DailyFollowupGenerationOptions {
  branch?: string;
  maxFollowups?: number;
  priority?: "high" | "medium" | "low";
  includeInactive?: boolean;
  excludeRecentFollowups?: boolean;
  daysSinceLastFollowup?: number;
}

interface CustomerPriorityScore {
  customer: Customer;
  score: number;
  reasons: string[];
}

/**
 * Generates a daily follow-up list based on customer analytics and priority scoring
 */
export async function generateDailyFollowupList(
  customers: Customer[],
  existingFollowups: DailyFollowup[],
  options: DailyFollowupGenerationOptions = {}
): Promise<DailyFollowup[]> {
  const {
    branch,
    maxFollowups = 50,
    priority = "medium",
    includeInactive = false,
    excludeRecentFollowups = true,
    daysSinceLastFollowup = 7,
  } = options;

  // Filter customers by branch if specified
  let filteredCustomers = customers;
  if (branch) {
    filteredCustomers = customers.filter((c) => 
      c.branch === branch || (c.type && c.type.includes(branch))
    );
  }

  // Filter inactive customers unless explicitly included
  if (!includeInactive) {
    filteredCustomers = filteredCustomers.filter((c) => 
      c.retention_status !== "inactive" && c.retention_status !== "churned"
    );
  }

  // Calculate priority scores for each customer
  const scoredCustomers = await calculateCustomerPriorityScores(
    filteredCustomers,
    existingFollowups,
    {
      excludeRecentFollowups,
      daysSinceLastFollowup,
    }
  );

  // Filter by priority threshold
  const priorityThresholds = {
    high: 70,
    medium: 50,
    low: 30,
  };

  const threshold = priorityThresholds[priority];
  const qualifiedCustomers = scoredCustomers.filter((c) => c.score >= threshold);

  // Sort by score (highest first)
  qualifiedCustomers.sort((a, b) => b.score - a.score);

  // Take top N customers
  const selectedCustomers = qualifiedCustomers.slice(0, maxFollowups);

  // Generate follow-up records
  const followups: DailyFollowup[] = selectedCustomers.map((scored, index) => {
    const customer = scored.customer;
    const reasons = scored.reasons;

    // Determine follow-up category based on reasons
    const category = determineFollowupCategory(reasons, customer);

    // Determine suggested action
    const suggestedAction = determineSuggestedAction(category, customer);

    // Determine priority
    const followupPriority = scored.score >= 80 ? "high" : scored.score >= 60 ? "medium" : "low";

    return {
      id: crypto.randomUUID(),
      customer_id: customer.id,
      customer_name: customer.name,
      customer_code: customer.customer_code || "",
      customer_phone: customer.phone || "",
      branch: customer.branch || "غير محدد",
      category,
      priority: followupPriority,
      suggested_action: suggestedAction,
      status: "معلق",
      followup_date: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      notes: reasons.join("; "),
      assigned_to: "", // Will be assigned by the system
      responsible_name: "",
      contact_method: "phone",
      followup_status: "pending",
      last_purchase_date: customer.last_purchase,
      purchase_count_current_month: 0,
      average_monthly_purchase_count: customer.total_purchases ? Math.round(customer.total_purchases / 12) : 0,
      retention_status: customer.retention_status,
      type: customer.type,
    } as DailyFollowup;
  });

  return followups;
}

/**
 * Calculates priority scores for customers based on multiple factors
 */
async function calculateCustomerPriorityScores(
  customers: Customer[],
  existingFollowups: DailyFollowup[],
  options: { excludeRecentFollowups: boolean; daysSinceLastFollowup: number }
): Promise<CustomerPriorityScore[]> {
  const { excludeRecentFollowups, daysSinceLastFollowup } = options;

  const now = new Date();
  const cutoffDate = new Date(now.getTime() - daysSinceLastFollowup * 24 * 60 * 60 * 1000);

  return customers.map((customer) => {
    let score = 0;
    const reasons: string[] = [];

    // 1. Customer value (avg monthly spend)
    if (customer.avg_monthly) {
      if (customer.avg_monthly >= 5000) {
        score += 30;
        reasons.push("قيمة عالية");
      } else if (customer.avg_monthly >= 2000) {
        score += 20;
        reasons.push("قيمة متوسطة");
      } else if (customer.avg_monthly >= 1000) {
        score += 10;
        reasons.push("قيمة منخفضة");
      }
    }

    // 2. Retention status
    if (customer.retention_status === "at_risk") {
      score += 25;
      reasons.push("في خطر");
    } else if (customer.retention_status === "threatened") {
      score += 20;
      reasons.push("مهدد");
    } else if (customer.retention_status === "inactive") {
      score += 15;
      reasons.push("غير نشط");
    } else if (customer.retention_status === "loyal") {
      score += 5;
      reasons.push("عميل مخلص");
    }

    // 3. Last purchase date
    if (customer.last_purchase) {
      const lastPurchase = new Date(customer.last_purchase);
      const daysSincePurchase = Math.floor((now.getTime() - lastPurchase.getTime()) / (1000 * 60 * 60 * 24));
      
      if (daysSincePurchase > 90) {
        score += 25;
        reasons.push(`لم يشتري منذ ${daysSincePurchase} يوم`);
      } else if (daysSincePurchase > 60) {
        score += 20;
        reasons.push(`لم يشتري منذ ${daysSincePurchase} يوم`);
      } else if (daysSincePurchase > 30) {
        score += 15;
        reasons.push(`لم يشتري منذ ${daysSincePurchase} يوم`);
      }
    }

    // 4. Purchase frequency (based on total_purchases and avg_monthly)
    if (customer.total_purchases && customer.avg_monthly) {
      const expectedMonthlyPurchases = customer.total_purchases / 12; // Rough estimate
      const currentPurchaseRate = customer.avg_monthly / (customer.avg_invoice || 1);
      
      if (currentPurchaseRate < expectedMonthlyPurchases * 0.5) {
        score += 20;
        reasons.push("انخفاض في تكرار الشراء");
      }
    }

    // 5. Customer type
    if (customer.type === "VIP") {
      score += 15;
      reasons.push("عميل VIP");
    } else if (customer.type === "important") {
      score += 10;
      reasons.push("عميل مهم");
    }

    // 6. Check for recent follow-ups (to avoid duplicates)
    if (excludeRecentFollowups) {
      const recentFollowup = existingFollowups.find((f) => {
        if (f.customer_id !== customer.id) return false;
        const followupDate = new Date(f.created_at);
        return followupDate >= cutoffDate;
      });

      if (recentFollowup) {
        score -= 30;
        reasons.push("تمت متابعته مؤخراً");
      }
    }

    // 7. Check for pending follow-ups
    const pendingFollowup = existingFollowups.find((f) => 
      f.customer_id === customer.id && f.status === "معلق"
    );

    if (pendingFollowup) {
      score -= 20;
      reasons.push("متابعة معلقة موجودة");
    }

    // Ensure score doesn't go below 0
    score = Math.max(0, score);

    return {
      customer,
      score,
      reasons,
    };
  });
}

/**
 * Determines the follow-up category based on reasons and customer data
 */
function determineFollowupCategory(reasons: string[], customer: Customer): string {
  if (reasons.includes("في خطر") || reasons.includes("توقف عن الشراء")) {
    return "حرج";
  }
  
  if (reasons.includes("مهدد") || reasons.includes("انخفاض في تكرار الشراء")) {
    return "تحفيز";
  }
  
  if (reasons.includes("قيمة عالية") || customer.type === "VIP") {
    return "علاقة";
  }
  
  if (reasons.includes("لم يشتري منذ")) {
    return "إعادة تفعيل";
  }
  
  return "متابعة دورية";
}

/**
 * Determines the suggested action based on category and customer data
 */
function determineSuggestedAction(category: string, customer: Customer): string {
  const actions: Record<string, string> = {
    "حرج": "اتصال عاجل لفهم سبب التوقف وتقديم حوافز",
    "تحفيز": "اتصال لعرض عروض خاصة وتذكير بالفوائد",
    "علاقة": "اتصال لبناء العلاقة والاستفسار عن الاحتياجات",
    "إعادة تفعيل": "اتصال للاستفسار عن سبب الغياب وعرض منتجات جديدة",
    "متابعة دورية": "اتصال للمتابعة والاستفسار عن الرضا",
  };

  return actions[category] || "اتصال للمتابعة";
}

/**
 * Prevents duplicate follow-ups by checking existing records
 */
export function preventDuplicateFollowups(
  newFollowups: DailyFollowup[],
  existingFollowups: DailyFollowup[],
  daysWindow: number = 7
): DailyFollowup[] {
  const now = new Date();
  const cutoffDate = new Date(now.getTime() - daysWindow * 24 * 60 * 60 * 1000);

  const filteredFollowups = newFollowups.filter((newFollowup) => {
    // Check if there's a recent follow-up for this customer
    const recentFollowup = existingFollowups.find((existing) => {
      if (existing.customer_id !== newFollowup.customer_id) return false;
      const followupDate = new Date(existing.created_at);
      return followupDate >= cutoffDate;
    });

    // Also check within the new batch
    const duplicateInBatch = newFollowups.find((other, index) => {
      if (other.customer_id === newFollowup.customer_id && other !== newFollowup) {
        return true;
      }
      return false;
    });

    return !recentFollowup && !duplicateInBatch;
  });

  return filteredFollowups;
}
