import { getEvaluationCycle } from '@/lib/evaluationCycle';
import { calculatePillarScores, type PillarInput, type PillarScore } from './pillarScoreCalculator';
import { calculateOverallScore, mapRoleToCategory, type OverallScoreResult } from './overallScoreCalculator';
import { supabase } from '@/lib/supabase';
import { format, subMonths } from 'date-fns';

export interface UnifiedMonthlyReport {
  staffId: string;
  staffName: string;
  role: string;
  cycleStart: Date;
  cycleEnd: Date;
  cycleLabel: string;
  
  overallScore: OverallScoreResult;
  pillarScores: PillarScore[];
  
  // Historical context
  historicalTrend: {
    cycleLabel: string;
    score: number;
  }[];
  
  // Raw Data fetched (optional but useful for debugging/display)
  rawData?: any;
}

async function withSectionTimeout<T>(promise: Promise<T>, ms = 10000): Promise<T | null> {
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
    ]);
  } catch (error) {
    console.warn('Section timed out or failed:', error);
    return null;
  }
}

export async function generateUnifiedMonthlyReport(
  staffId: string, 
  cycleDate?: Date
): Promise<UnifiedMonthlyReport> {
  const cycle = getEvaluationCycle(cycleDate);
  const cycleStartStr = cycle.start.toISOString();
  const cycleEndStr = cycle.end.toISOString();
  
  // 1. Fetch Staff info
  const staffRes = await supabase.from('staff').select('id, name, role').eq('id', staffId).single();
  if (staffRes.error) {
    throw new Error(`Failed to load staff details: ${staffRes.error.message}`);
  }
  const staff = staffRes.data;
  const staffCategory = mapRoleToCategory(staff.role);

  // 2. Fetch parallel datasets with timeout
  const [
    salesData,
    attendanceData,
    tasksData,
    shiftReviewsData,
    convReviewsData,
    followupsData,
    stagnantData,
    managerEvalData,
    historicalData
  ] = await Promise.allSettled([
    // Sales Invoices
    withSectionTimeout(
      supabase.from('sales_invoices')
        .select('id, total_amount, seller_name, customer_code, items_count, created_at')
        .eq('seller_name', staff.name)
        .gte('created_at', cycleStartStr)
        .lte('created_at', cycleEndStr)
    ),
    // Attendance
    withSectionTimeout(
      supabase.from('attendance')
        .select('id, status, shift_date')
        .eq('staff_id', staffId)
        .gte('shift_date', cycleStartStr)
        .lte('shift_date', cycleEndStr)
    ),
    // Tasks
    withSectionTimeout(
      supabase.from('employee_daily_tasks')
        .select('id, is_completed, created_at')
        .eq('staff_id', staffId)
        .gte('created_at', cycleStartStr)
        .lte('created_at', cycleEndStr)
    ),
    // Shift Reviews (Leader or Member)
    withSectionTimeout(
      Promise.all([
        supabase.from('shift_performance_reviews').select('id, issues_noted').eq('leader_id', staffId).gte('created_at', cycleStartStr).lte('created_at', cycleEndStr),
        supabase.from('shift_performance_review_members').select('id, shift_review_id').eq('staff_id', staffId)
      ])
    ),
    // Conversation Reviews
    withSectionTimeout(
      supabase.from('conversation_sales_reviews')
        .select('id, score, review_date')
        .eq('staff_id', staffId)
        .gte('review_date', cycleStartStr)
        .lte('review_date', cycleEndStr)
    ),
    // Followups
    withSectionTimeout(
      supabase.from('daily_followups')
        .select('id, status, follow_up_date')
        .eq('staff_id', staffId)
        .gte('follow_up_date', cycleStartStr)
        .lte('follow_up_date', cycleEndStr)
    ),
    // Stagnant Meds
    withSectionTimeout(
      supabase.from('stagnant_medicine_dispenses')
        .select('id, medicine_name, quantity, status')
        .eq('staff_id', staffId)
        .gte('dispense_date', cycleStartStr)
        .lte('dispense_date', cycleEndStr)
    ),
    // Manager Eval
    withSectionTimeout(
      supabase.from('staff_monthly_manager_evaluations')
        .select('id, evaluation_score')
        .eq('staff_id', staffId)
        .gte('evaluation_month', format(cycle.start, 'yyyy-MM-01'))
        .limit(1)
        .single()
    ),
    // Historical
    loadHistoricalTrend(staffId, cycle.start)
  ]);

  const extractData = <T,>(result: PromiseSettledResult<T | null>): any[] => 
    result.status === 'fulfilled' && result.value && (result.value as any).data ? (result.value as any).data : [];

  const sales = extractData(salesData);
  const attendance = extractData(attendanceData);
  const tasks = extractData(tasksData);
  const convReviews = extractData(convReviewsData);
  const followups = extractData(followupsData);
  const stagnant = extractData(stagnantData);

  const totalInvoices = sales.length;
  const invoicesWithCustomerCode = sales.filter((s: any) => s.customer_code).length;
  const totalSales = sales.reduce((sum: number, s: any) => sum + (Number(s.total_amount) || 0), 0);
  const avgInvoice = totalInvoices > 0 ? totalSales / totalInvoices : 0;
  
  const avgBasketSize = totalInvoices > 0 ? sales.reduce((sum: number, s: any) => sum + (Number(s.items_count) || 0), 0) / totalInvoices : 0;

  const avgConvScore = convReviews.length > 0 
    ? convReviews.reduce((sum: number, r: any) => sum + (Number(r.score) || 0), 0) / convReviews.length 
    : 0;

  const scheduledDays = attendance.length;
  const presentDays = attendance.filter((a: any) => a.status === 'present').length;

  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((t: any) => t.is_completed).length;

  const totalFollowups = followups.length;
  const completedFollowups = followups.filter((f: any) => f.status === 'completed' || f.status === 'done').length;

  const stagnantAssigned = stagnant.length;
  const stagnantSold = stagnant.filter((s: any) => s.status === 'sold').length;

  const pillarInput: PillarInput = {
    invoicesWithCustomerCode,
    totalInvoices,
    avgInvoice,
    branchAvgInvoice: 150,
    invoiceCountCurrentCycle: totalInvoices,
    invoiceCountPreviousCycle: 0,
    avgBasketSize,
    totalLinkedCustomers: invoicesWithCustomerCode,
    customersWithoutPhone: 0,
    avgConversationReviewScore: avgConvScore,
    totalReviews: convReviews.length,
    completedFollowups,
    totalFollowups,
    presentDays,
    scheduledDays,
    completedTasks,
    totalTasks,
    shiftIssuesAsLeader: 0,
    shiftIssuesAsMember: 0,
    totalShiftReviews: 0,
    stagnantSold,
    stagnantAssigned,
    listSold: 0,
    listAssigned: 0,
    nearExpiryHandled: 0,
    nearExpiryTotal: 0,
    followupSystemUsageRate: totalFollowups > 0 ? 1 : 0
  };

  const pillarScores = calculatePillarScores(pillarInput);

  const getPillarScore = (name: string) => pillarScores.find(p => p.pillar.includes(name))?.score || 0;

  const teamScore = managerEvalData.status === 'fulfilled' && managerEvalData.value && (managerEvalData.value as any).data 
    ? Number((managerEvalData.value as any).data.evaluation_score) 
    : 0;

  const overallInput = {
    role: staffCategory,
    salesScore: getPillarScore('البيع'),
    customersScore: getPillarScore('العملاء'),
    qualityScore: avgConvScore > 0 ? (avgConvScore / 5) * 100 : 0,
    attendanceScore: getPillarScore('الالتزام'),
    tasksScore: getPillarScore('الالتزام'),
    inventoryScore: getPillarScore('المخزون'),
    serviceScore: getPillarScore('استخدام'),
    teamScore,
    pillarScores
  };

  const overallScore = calculateOverallScore(overallInput);

  const trend = historicalData.status === 'fulfilled' && historicalData.value ? historicalData.value : [];

  return {
    staffId,
    staffName: staff.name,
    role: staff.role,
    cycleStart: cycle.start,
    cycleEnd: cycle.end,
    cycleLabel: cycle.label,
    overallScore,
    pillarScores,
    historicalTrend: trend,
    rawData: {
      salesCount: totalInvoices,
      attendanceCount: presentDays,
      tasksCount: completedTasks
    }
  };
}

async function loadHistoricalTrend(staffId: string, currentCycleStart: Date) {
  const trend = [];
  
  for (let i = 1; i <= 2; i++) {
    const prevDate = subMonths(currentCycleStart, i);
    const cycle = getEvaluationCycle(prevDate);
    
    const { data } = await supabase
      .from('monthly_evaluations')
      .select('final_score')
      .eq('staff_id', staffId)
      .eq('evaluation_month', format(cycle.start, 'yyyy-MM-01'))
      .maybeSingle();
      
    trend.push({
      cycleLabel: cycle.label,
      score: data?.final_score || 0
    });
  }
  
  return trend.reverse();
}
