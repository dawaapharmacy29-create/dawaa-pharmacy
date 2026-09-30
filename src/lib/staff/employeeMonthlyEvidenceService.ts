import { supabase } from '@/lib/supabase';
import { readAttendanceRange } from '@/lib/readModels/attendanceReadModel';
import { listAttendanceImpactLedger, type AttendanceImpactRow } from '@/lib/attendance/attendanceResolutionService';

export type EmployeeMonthlyEvidenceMetrics = {
  review_count: number;
  review_average: number;
  completed_followups: number;
  followup_count: number;
  conversation_positive_points: number;
  conversation_negative_points: number;
  attendance_days: number;
  present_days: number;
  engine_version: number;
};

export type ConversationDimensionKey =
  | 'response_speed'
  | 'greeting'
  | 'tone_language'
  | 'understanding'
  | 'follow_up'
  | 'consultation_quality'
  | 'dosage_explanation'
  | 'alternative_handling'
  | 'sales_quality'
  | 'upsell_cross_sell'
  | 'complaint_handling'
  | 'order_confirmation'
  | 'closing_message';

export type ConversationDimensionEvidence = {
  key: ConversationDimensionKey;
  label: string;
  average: number;
  samples: number;
};

export type ConversationEvidenceExample = {
  id: string;
  date: string;
  score: number;
  positiveReason: string;
  negativeReason: string;
  trainingRecommendation: string;
};

export type MonthlyConversationCoaching = {
  reviewCount: number;
  sampleSufficient: boolean;
  minSamples: number;
  dimensions: ConversationDimensionEvidence[];
  strengths: ConversationDimensionEvidence[];
  weaknesses: ConversationDimensionEvidence[];
  positiveReasons: string[];
  negativeReasons: string[];
  trainingRecommendations: string[];
  flags: {
    complaints: number;
    medicalErrors: number;
    badAlternativeCases: number;
    badTone: number;
    severeBadTone: number;
    missedSales: number;
    excellentCases: number;
    criticalErrors: number;
  };
  examples: ConversationEvidenceExample[];
  drafts: {
    strength: string;
    development: string;
    actionPlan: string;
    measurement: string;
  };
};

export type MonthlyAttendanceCoaching = {
  approvedEvents: number;
  onTimeDays: number;
  lateCases: number;
  veryLateCases: number;
  lateMinutes: number;
  earlyLeaveCases: number;
  earlyLeaveMinutes: number;
  absenceCases: number;
  approvedTimeOffCases: number;
  workedOnOffCases: number;
  manualResolutionCases: number;
  drafts: {
    strength: string;
    development: string;
    actionPlan: string;
  };
};

export type MonthlyFollowupCoaching = {
  total: number;
  completed: number;
  open: number;
  completionPct: number;
  documented: number;
  documentedPct: number;
  purchaseAfterFollowup: number;
  needsNextFollowup: number;
  drafts: {
    strength: string;
    development: string;
    actionPlan: string;
  };
};

export type EmployeeMonthlyEvidence = {
  metrics: EmployeeMonthlyEvidenceMetrics;
  coaching: {
    conversation: MonthlyConversationCoaching;
    attendance: MonthlyAttendanceCoaching;
    followups: MonthlyFollowupCoaching;
  };
  health: {
    reviews: 'available' | 'unavailable';
    followups: 'available' | 'unavailable';
    attendance: 'available' | 'unavailable';
  };
  ready: boolean;
  errors: Record<string, string>;
};

const DIMENSIONS: Array<{
  key: ConversationDimensionKey;
  label: string;
  column: string;
}> = [
  { key: 'response_speed', label: 'سرعة الرد', column: 'response_speed_score' },
  { key: 'greeting', label: 'الترحيب', column: 'greeting_score' },
  { key: 'tone_language', label: 'نبرة ولغة التعامل', column: 'tone_language_score' },
  { key: 'understanding', label: 'فهم احتياج العميل', column: 'understanding_score' },
  { key: 'follow_up', label: 'المتابعة', column: 'follow_up_score' },
  { key: 'consultation_quality', label: 'جودة الاستشارة', column: 'consultation_quality_score' },
  { key: 'dosage_explanation', label: 'شرح الجرعة والاستخدام', column: 'dosage_explanation_score' },
  { key: 'alternative_handling', label: 'التعامل مع البدائل', column: 'alternative_handling_score' },
  { key: 'sales_quality', label: 'جودة البيع', column: 'sales_quality_score' },
  { key: 'upsell_cross_sell', label: 'البيع التكميلي', column: 'upsell_cross_sell_score' },
  { key: 'complaint_handling', label: 'التعامل مع الشكاوى', column: 'complaint_handling_score' },
  { key: 'order_confirmation', label: 'تأكيد الطلب', column: 'order_confirmation_score' },
  { key: 'closing_message', label: 'رسالة الختام', column: 'closing_message_score' },
];

const DIMENSION_ACTIONS: Record<ConversationDimensionKey, string> = {
  response_speed: 'تقليل زمن أول رد ومراجعة الحالات التي تأخر فيها الرد.',
  greeting: 'تثبيت ترحيب واضح واستخدام اسم العميل عندما يكون متاحًا.',
  tone_language: 'الحفاظ على نبرة مهنية ودافئة حتى في حالات الضغط أو الاعتراض.',
  understanding: 'طرح أسئلة قصيرة لتأكيد احتياج العميل قبل الترشيح أو الإغلاق.',
  follow_up: 'تحديد خطوة متابعة واضحة وموعدها وتسجيل النتيجة بعد التنفيذ.',
  consultation_quality: 'ربط الترشيح باحتياج العميل وشرح سبب الاختيار باختصار.',
  dosage_explanation: 'توضيح الجرعة وطريقة الاستخدام والنقاط الأساسية قبل إنهاء المحادثة.',
  alternative_handling: 'عرض بديل مناسب مع توضيح الفرق العملي بدون ضغط على العميل.',
  sales_quality: 'جعل كل اقتراح بيعي مرتبطًا باحتياج واضح للعميل.',
  upsell_cross_sell: 'اقتراح منتج مكمل فقط عندما توجد فائدة واضحة مرتبطة بالطلب.',
  complaint_handling: 'تقدير شكوى العميل ثم تقديم حل محدد ومتابعة النتيجة حتى الإغلاق.',
  order_confirmation: 'تأكيد تفاصيل الطلب الأساسية قبل إنهاء المحادثة.',
  closing_message: 'إغلاق المحادثة برسالة واضحة تؤكد الخطوة التالية والاستعداد للمتابعة.',
};

const REVIEW_SELECT = [
  'id',
  'staff_id',
  'doctor_id',
  'conversation_date',
  'created_at',
  'final_score',
  'total_score',
  'doctor_points_impact',
  'point_impact',
  'main_positive_reason',
  'main_negative_reason',
  'training_recommendation',
  'reviewer_notes',
  'has_complaint',
  'has_medical_error',
  'bad_alternative_flag',
  'bad_tone_flag',
  'severe_bad_tone_flag',
  'missed_sales_opportunity',
  'missed_sale_opportunity',
  'excellent_case',
  'has_critical_error',
  ...DIMENSIONS.map((item) => item.column),
].join(',');

function safeNumber(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function nullableNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function text(value: unknown) {
  return String(value ?? '').trim();
}

function bool(value: unknown) {
  return value === true || value === 1 || String(value).toLowerCase() === 'true';
}

function repeatedText(values: unknown[], limit = 3) {
  const counts = new Map<string, number>();
  values
    .flatMap((value) => text(value).split(/[،,؛\n]+/))
    .map((value) => value.replace(/\s+/g, ' ').trim())
    .filter((value) => value.length >= 4)
    .forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, limit)
    .map(([value]) => value);
}

function dimensionEvidence(rows: Record<string, unknown>[], minSamples: number) {
  return DIMENSIONS.map((dimension) => {
    const values = rows
      .map((row) => nullableNumber(row[dimension.column]))
      .filter((value): value is number => value !== null);

    if (!values.length) return null;
    const average = Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
    return {
      key: dimension.key,
      label: dimension.label,
      average,
      samples: values.length,
    } satisfies ConversationDimensionEvidence;
  })
    .filter((item): item is ConversationDimensionEvidence => item !== null)
    .filter((item) => item.samples >= minSamples);
}

function buildConversationCoaching(rows: Record<string, unknown>[]): MonthlyConversationCoaching {
  const minSamples = 3;
  const sampleSufficient = rows.length >= minSamples;
  const dimensions = sampleSufficient ? dimensionEvidence(rows, minSamples) : [];
  const strengths = sampleSufficient
    ? [...dimensions].filter((item) => item.average >= 7).sort((a, b) => b.average - a.average).slice(0, 3)
    : [];
  const weaknesses = sampleSufficient
    ? [...dimensions].filter((item) => item.average <= 7.5).sort((a, b) => a.average - b.average).slice(0, 3)
    : [];

  const positiveReasons = repeatedText(rows.map((row) => row.main_positive_reason));
  const negativeReasons = repeatedText(rows.map((row) => row.main_negative_reason));
  const trainingRecommendations = repeatedText(rows.map((row) => row.training_recommendation), 4);

  const weakestRows = [...rows]
    .filter((row) => text(row.id))
    .sort((a, b) => safeNumber(a.final_score ?? a.total_score) - safeNumber(b.final_score ?? b.total_score))
    .filter((row) =>
      safeNumber(row.final_score ?? row.total_score) < 85
      || text(row.main_negative_reason)
      || text(row.training_recommendation)
    )
    .slice(0, 3);

  const examples = weakestRows.map((row) => ({
    id: text(row.id),
    date: text(row.conversation_date || row.created_at).slice(0, 10),
    score: safeNumber(row.final_score ?? row.total_score),
    positiveReason: text(row.main_positive_reason),
    negativeReason: text(row.main_negative_reason),
    trainingRecommendation: text(row.training_recommendation),
  }));

  const strengthBits = [
    strengths.length
      ? `أقوى الأبعاد: ${strengths.map((item) => `${item.label} ${item.average}/10`).join('، ')}`
      : '',
    positiveReasons.length ? `وتكررت ملاحظات إيجابية مثل: ${positiveReasons.join(' · ')}` : '',
  ].filter(Boolean);

  const developmentBits = [
    weaknesses.length
      ? `أولوية التطوير: ${weaknesses.map((item) => `${item.label} ${item.average}/10`).join('، ')}`
      : '',
    negativeReasons.length ? `وتكررت ملاحظات تحتاج تحسين مثل: ${negativeReasons.join(' · ')}` : '',
  ].filter(Boolean);

  const fallbackActions = weaknesses.map((item) => DIMENSION_ACTIONS[item.key]).slice(0, 3);
  const actionItems = trainingRecommendations.length ? trainingRecommendations : fallbackActions;

  return {
    reviewCount: rows.length,
    sampleSufficient,
    minSamples,
    dimensions,
    strengths,
    weaknesses,
    positiveReasons,
    negativeReasons,
    trainingRecommendations,
    flags: {
      complaints: rows.filter((row) => bool(row.has_complaint)).length,
      medicalErrors: rows.filter((row) => bool(row.has_medical_error)).length,
      badAlternativeCases: rows.filter((row) => bool(row.bad_alternative_flag)).length,
      badTone: rows.filter((row) => bool(row.bad_tone_flag)).length,
      severeBadTone: rows.filter((row) => bool(row.severe_bad_tone_flag)).length,
      missedSales: rows.filter((row) => bool(row.missed_sales_opportunity) || bool(row.missed_sale_opportunity)).length,
      excellentCases: rows.filter((row) => bool(row.excellent_case)).length,
      criticalErrors: rows.filter((row) => bool(row.has_critical_error)).length,
    },
    examples,
    drafts: {
      strength: sampleSufficient && strengthBits.length
        ? `من واقع ${rows.length} محادثة مراجعة خلال الدورة، ${strengthBits.join('، ')}.`
        : '',
      development: sampleSufficient && developmentBits.length
        ? `من واقع ${rows.length} محادثة مراجعة خلال الدورة، ${developmentBits.join('، ')}.`
        : '',
      actionPlan: sampleSufficient && actionItems.length
        ? `خطة العمل المقترحة: ${actionItems.join(' • ')}`
        : '',
      measurement: sampleSufficient && weaknesses.length
        ? `في الدورة القادمة تتم إعادة قياس ${weaknesses.map((item) => item.label).join('، ')} على عينة لا تقل عن ${minSamples} محادثات ومقارنة المتوسط بهذه الدورة.`
        : '',
    },
  };
}

function snapshotNumber(row: AttendanceImpactRow, key: string) {
  return safeNumber(row.evidence_snapshot?.[key]);
}

function buildAttendanceCoaching(rows: AttendanceImpactRow[]): MonthlyAttendanceCoaching {
  const currentRows = rows.filter((row) => !row.reversal_of && row.impact_status !== 'reversed');
  const byType = (type: string) => currentRows.filter((row) => row.event_type === type);

  const lateRows = [
    ...byType('attendance_late'),
    ...byType('attendance_very_late'),
  ];
  const earlyRows = byType('attendance_early_leave_confirmed');

  const lateMinutes = lateRows.reduce((sum, row) => sum + snapshotNumber(row, 'late_minutes'), 0);
  const earlyLeaveMinutes = earlyRows.reduce((sum, row) => sum + snapshotNumber(row, 'early_leave_minutes'), 0);

  const onTimeDays = byType('attendance_on_time').length + byType('attendance_on_time_with_permission').length;
  const lateCases = byType('attendance_late').length;
  const veryLateCases = byType('attendance_very_late').length;
  const earlyLeaveCases = earlyRows.length;
  const absenceCases = byType('attendance_absence_confirmed').length;
  const approvedTimeOffCases = byType('attendance_approved_time_off').length;
  const workedOnOffCases = byType('attendance_worked_on_off_confirmed').length;
  const manualResolutionCases = byType('attendance_manual_resolution').length;

  const strengthBits = [
    onTimeDays > 0 ? `${onTimeDays} يوم حضور معتمد في الموعد` : '',
    workedOnOffCases > 0 ? `${workedOnOffCases} يوم عمل معتمد في يوم راحة` : '',
  ].filter(Boolean);

  const developmentBits = [
    lateCases + veryLateCases > 0
      ? `${lateCases + veryLateCases} حالة تأخير معتمدة بإجمالي ${lateMinutes} دقيقة`
      : '',
    earlyLeaveCases > 0
      ? `${earlyLeaveCases} حالة خروج مبكر معتمدة بإجمالي ${earlyLeaveMinutes} دقيقة`
      : '',
    absenceCases > 0 ? `${absenceCases} حالة غياب مؤكدة` : '',
  ].filter(Boolean);

  const actions = [
    lateCases + veryLateCases > 0 ? 'مراجعة أسباب التأخير المعتمد ووضع إجراء يمنع تكراره في الدورة القادمة.' : '',
    earlyLeaveCases > 0 ? 'مراجعة حالات الخروج المبكر المعتمدة والتأكد من وجود إذن أو تصحيح الإجراء.' : '',
    absenceCases > 0 ? 'مراجعة حالات الغياب المؤكدة مع المدير وتوثيق الإجراء المتفق عليه.' : '',
  ].filter(Boolean);

  return {
    approvedEvents: currentRows.length,
    onTimeDays,
    lateCases,
    veryLateCases,
    lateMinutes,
    earlyLeaveCases,
    earlyLeaveMinutes,
    absenceCases,
    approvedTimeOffCases,
    workedOnOffCases,
    manualResolutionCases,
    drafts: {
      strength: strengthBits.length ? `الحضور المعتمد: ${strengthBits.join('، ')}.` : '',
      development: developmentBits.length ? `ملاحظات الحضور المعتمدة: ${developmentBits.join('، ')}.` : '',
      actionPlan: actions.length ? `خطة الحضور: ${actions.join(' • ')}` : '',
    },
  };
}

function followupExecuted(row: Record<string, unknown>) {
  const status = `${text(row.status)} ${text(row.followup_status)}`.toLowerCase();
  return Boolean(row.completed_at || row.closed_at || /completed|done|closed|مكتمل|تم|اغلاق|إغلاق/.test(status));
}

function buildFollowupCoaching(rows: Record<string, unknown>[]): MonthlyFollowupCoaching {
  const total = rows.length;
  const completed = rows.filter(followupExecuted).length;
  const open = Math.max(0, total - completed);
  const completionPct = total ? Math.round((completed / total) * 1000) / 10 : 0;
  const documented = rows.filter((row) =>
    [row.followup_result, row.followup_summary, row.notes]
      .some((value) => text(value).length >= 12)
  ).length;
  const documentedPct = total ? Math.round((documented / total) * 1000) / 10 : 0;
  const purchaseAfterFollowup = rows.filter((row) => bool(row.purchase_after_followup)).length;
  const needsNextFollowup = rows.filter((row) => bool(row.needs_next_followup)).length;

  const strengthBits = [
    total > 0 && completed === total ? `تم إغلاق كل المتابعات المسجلة (${completed}/${total})` : '',
    documented > 0 && documented === total ? 'كل المتابعات تحتوي نتيجة أو توثيقًا واضحًا' : '',
    purchaseAfterFollowup > 0 ? `${purchaseAfterFollowup} متابعة موثقة نتج عنها شراء` : '',
  ].filter(Boolean);

  const developmentBits = [
    open > 0 ? `${open} متابعة من أصل ${total} ما زالت غير مكتملة` : '',
    total > 0 && documented < total ? `${total - documented} متابعة تحتاج توثيق نتيجة أوضح` : '',
    needsNextFollowup > 0 ? `${needsNextFollowup} حالة مسجلة تحتاج متابعة لاحقة` : '',
  ].filter(Boolean);

  const actionBits = [
    open > 0 ? 'إغلاق المتابعات المفتوحة أو توثيق سبب بقائها مفتوحة قبل نهاية الدورة.' : '',
    total > 0 && documented < total ? 'تسجيل نتيجة واضحة وخطوة تالية لكل متابعة بدل الاكتفاء بتغيير الحالة.' : '',
    needsNextFollowup > 0 ? 'تحديد موعد المتابعة التالية بوضوح للحالات التي تحتاج استمرارًا.' : '',
  ].filter(Boolean);

  return {
    total,
    completed,
    open,
    completionPct,
    documented,
    documentedPct,
    purchaseAfterFollowup,
    needsNextFollowup,
    drafts: {
      strength: strengthBits.length ? `المتابعات: ${strengthBits.join('، ')}.` : '',
      development: developmentBits.length ? `ملاحظات المتابعات: ${developmentBits.join('، ')}.` : '',
      actionPlan: actionBits.length ? `خطة المتابعات: ${actionBits.join(' • ')}` : '',
    },
  };
}

async function loadConversationReviews(args: {
  staffId: string;
  startDate: string;
  endDateExclusive: string;
}) {
  const dateFilter =
    `and(conversation_date.gte.${args.startDate},conversation_date.lt.${args.endDateExclusive}),`
    + `and(conversation_date.is.null,created_at.gte.${args.startDate},created_at.lt.${args.endDateExclusive})`;

  const makeQuery = (column: 'staff_id' | 'doctor_id') =>
    supabase
      .from('conversation_sales_reviews')
      .select(REVIEW_SELECT)
      .eq(column, args.staffId)
      .or(dateFilter)
      .order('created_at', { ascending: false })
      .limit(500);

  const [byStaff, byDoctor] = await Promise.all([
    makeQuery('staff_id'),
    makeQuery('doctor_id'),
  ]);

  if (byStaff.error && byDoctor.error) {
    return {
      rows: [] as Record<string, unknown>[],
      error: [byStaff.error.message, byDoctor.error.message].filter(Boolean).join(' | '),
    };
  }

  const unique = new Map<string, Record<string, unknown>>();
  [...(byStaff.data || []), ...(byDoctor.data || [])].forEach((row) => {
    const record = row as Record<string, unknown>;
    const key = text(record.id) || `${text(record.created_at)}:${unique.size}`;
    unique.set(key, record);
  });

  return {
    rows: [...unique.values()],
    error: byStaff.error?.message || byDoctor.error?.message || '',
  };
}

/**
 * Canonical evidence reader for the monthly staff evaluation.
 *
 * Important: an unavailable source is NOT the same as a genuine zero. Callers
 * must check the ready flag before finalizing an evaluation so a transient query
 * failure cannot silently become a bad monthly score/evidence snapshot.
 */
export async function loadEmployeeMonthlyEvidence(args: {
  staffId: string;
  startDate: string;
  endDateExclusive: string;
}): Promise<EmployeeMonthlyEvidence> {
  const errors: Record<string, string> = {};

  const [reviewResult, followupResult, attendanceResult, attendanceImpactResult] = await Promise.all([
    loadConversationReviews(args),
    supabase
      .from('daily_followups')
      .select('id,status,followup_status,followup_result,followup_summary,notes,completed_at,closed_at,needs_next_followup,next_followup_date,purchase_after_followup,created_at,assigned_staff_id,requested_by_staff_id')
      .or(`assigned_staff_id.eq.${args.staffId},requested_by_staff_id.eq.${args.staffId}`)
      .gte('created_at', args.startDate)
      .lt('created_at', args.endDateExclusive)
      .limit(1000),
    readAttendanceRange({
      staffId: args.staffId,
      startDate: args.startDate,
      endDateExclusive: args.endDateExclusive,
      limit: 400,
    }),
    listAttendanceImpactLedger({
      staffId: args.staffId,
      start: args.startDate,
      end: new Date(new Date(args.endDateExclusive).getTime() - 86400000).toISOString().slice(0, 10),
      limit: 300,
    }).then((rows) => ({ rows, error: '' })).catch((cause) => ({
      rows: [] as AttendanceImpactRow[],
      error: cause instanceof Error ? cause.message : String(cause),
    })),
  ]);

  const reviewRows = reviewResult.rows;
  if (reviewResult.error && !reviewRows.length) errors.reviews = reviewResult.error;

  const followupRows = followupResult.error ? [] : followupResult.data || [];
  if (followupResult.error) errors.followups = followupResult.error.message;

  const attendanceRows = attendanceResult.status === 'available' ? attendanceResult.rows : [];
  if (attendanceResult.status === 'unavailable') errors.attendance = attendanceResult.error;
  if (attendanceImpactResult.error && attendanceResult.status === 'unavailable') {
    errors.attendance = [errors.attendance, attendanceImpactResult.error].filter(Boolean).join(' | ');
  }

  const reviewAverage = reviewRows.length
    ? reviewRows.reduce((sum, row) => sum + safeNumber(row.final_score ?? row.total_score), 0) / reviewRows.length
    : 0;

  const completedFollowups = followupRows.filter(
    (row) =>
      row.completed_at ||
      /completed|مكتمل|تم/i.test(String(row.status || row.followup_status || ''))
  ).length;

  const reviewImpacts = reviewRows.map((row) =>
    safeNumber(row.doctor_points_impact ?? row.point_impact)
  );
  const positivePoints = reviewImpacts
    .filter((value) => value > 0)
    .reduce((sum, value) => sum + value, 0);
  const negativePoints = reviewImpacts
    .filter((value) => value < 0)
    .reduce((sum, value) => sum + Math.abs(value), 0);

  const presentDays = attendanceRows.filter((row) =>
    /present|حاضر|late|متأخر/i.test(String(row.status || ''))
  ).length;

  const reviewAvailable = !errors.reviews;
  const health = {
    reviews: reviewAvailable ? 'available' as const : 'unavailable' as const,
    followups: followupResult.error ? 'unavailable' as const : 'available' as const,
    attendance: attendanceResult.status,
  };

  return {
    metrics: {
      review_count: reviewRows.length,
      review_average: Math.round(reviewAverage * 10) / 10,
      completed_followups: completedFollowups,
      followup_count: followupRows.length,
      conversation_positive_points: positivePoints,
      conversation_negative_points: negativePoints,
      attendance_days: attendanceRows.length,
      present_days: presentDays,
      engine_version: 5,
    },
    coaching: {
      conversation: buildConversationCoaching(reviewRows),
      attendance: buildAttendanceCoaching(attendanceImpactResult.rows),
      followups: buildFollowupCoaching((followupRows || []) as Record<string, unknown>[]),
    },
    health,
    ready:
      health.reviews === 'available' &&
      health.followups === 'available' &&
      health.attendance === 'available',
    errors,
  };
}
