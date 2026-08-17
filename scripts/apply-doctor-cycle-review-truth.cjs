const fs = require('node:fs');

const dashboardPath = 'src/pages/DoctorDashboardStable.tsx';
let source = fs.readFileSync(dashboardPath, 'utf8');

const startMarker = `  const loadReviews = useCallback(async () => {`;
const endMarker = `\n\n  const loadNotifications = useCallback`;
const newRpcMarker = `get_doctor_cycle_reviews_v1`;

const replacement = `  const loadReviews = useCallback(async () => {\n    setPart('reviews', 'loading');\n    try {\n      const { data, error: reviewError } = await supabase.rpc('get_doctor_cycle_reviews_v1', {\n        p_staff_id: staffId || '',\n        p_doctor_name: doctorName,\n        p_start: formatCycleDate(cycle.start),\n        p_end: formatCycleDate(cycle.end),\n      });\n      if (reviewError) throw reviewError;\n      const rows = Array.isArray(data) ? (data as Row[]) : [];\n      setReviews(rows.map((row) => ({\n        id: text(row.id),\n        createdAt: text(row.conversation_date || row.created_at),\n        kind: text(row.evaluation_kind || row.conversation_type || 'تقييم محادثة'),\n        score: number(row.final_score ?? row.total_score),\n        impact: number(row.doctor_points_impact ?? row.point_impact),\n        positive: text(row.main_positive_reason),\n        negative: text(row.main_negative_reason),\n        notes: text(row.reviewer_notes),\n        training: text(row.training_recommendation),\n        reviewer: text(row.reviewer_name || 'مراجع خدمة العملاء'),\n      })));\n      setPart('reviews', 'success');\n    } catch (reviewError) {\n      console.error('[DoctorDashboardStable] cycle reviews failed', reviewError);\n      setReviews([]);\n      setPart('reviews', 'error');\n    }\n  }, [staffId, doctorName, cycle.start, cycle.end]);`;

if (!source.includes(newRpcMarker)) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error('DoctorDashboardStable loadReviews block not found. Refusing unsafe cycle-review patch.');
  }
  source = source.slice(0, start) + replacement + source.slice(end);
  console.log('Doctor dashboard reviews now use current-cycle canonical RPC.');
} else {
  console.log('Doctor dashboard current-cycle review RPC already wired.');
}

source = source.replace(' متوسط تقييماتي</div>', ' متوسط تقييماتي في الدورة</div>');
source = source.replace('كل تقييم مرتبط بحسابك فقط.', 'تقييمات الدورة الحالية فقط، مرتبطة بحسابك وهويتك.');
source = source.replace('لا توجد تقييمات مرتبطة بحسابك حتى الآن.', 'لا توجد تقييمات مرتبطة بحسابك في الدورة الحالية حتى الآن.');

if (!source.includes(newRpcMarker) || !source.includes('متوسط تقييماتي في الدورة')) {
  throw new Error('Doctor cycle review patch verification failed.');
}

fs.writeFileSync(dashboardPath, source);
console.log('Doctor dashboard cycle-review truth verified.');
