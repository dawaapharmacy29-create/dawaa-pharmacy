import type { LabAttendanceSummary, LabPersonScore } from '@/lib/evaluationLab/buildCycleScores';
import type { AxisResult } from '@/lib/evaluationLab/scoring';

// The "smart" layer over a monthly evaluation card: what each axis costs in the total, what to do
// per day for the rest of the cycle, and what looks unusual. Pure functions over the engine output.

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** Numbers in an axis basis, in order ("١٬٦٤٩٬٦٦٧ من ١٬٧٥٠٬٠٠٠ ج" → [1649667, 1750000]). */
export function basisNumbers(basis: string): number[] {
  const western = String(basis || '')
    .replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)))
    .replace(/[٬,](?=\d{3})/g, '')
    .replace(/٫/g, '.');
  return (western.match(/\d+(?:\.\d+)?/g) || []).map(Number);
}

const fmt = (n: number) => Math.round(n).toLocaleString('ar-EG');
const round1 = (n: number) => Math.round(n * 10) / 10;

const measured = (axis: AxisResult) =>
  axis.status === 'measured' && axis.score !== null && axis.weight > 0;

export interface AxisImpact {
  key: string;
  /** Points of the 100 this axis is worth after unmeasured weight is spread. */
  share: number;
  /** Points of the total this axis loses today (share × (100 − score)). */
  lost: number;
  /** Points the total gains if this axis reaches 80 (0 when already there). */
  gainTo80: number;
}

/** What every measured axis costs in the total. Matches the engine: Σ score·w / Σ measured w. */
export function axisImpacts(axes: AxisResult[]): Record<string, AxisImpact> {
  const list = axes.filter(measured);
  const weight = list.reduce((sum, axis) => sum + axis.weight, 0);
  const out: Record<string, AxisImpact> = {};
  if (!weight) return out;
  for (const axis of list) {
    const share = (axis.weight / weight) * 100;
    const score = axis.score as number;
    out[axis.key] = {
      key: axis.key,
      share: round1(share),
      lost: round1((share * (100 - score)) / 100),
      gainTo80: round1(Math.max(0, (share * (80 - score)) / 100)),
    };
  }
  return out;
}

export interface CycleDays {
  kind: 'running' | 'closed';
  elapsedDays: number;
  totalDays: number;
}

const remainingOf = (cycle: CycleDays) => Math.max(0, cycle.totalDays - cycle.elapsedDays);

/**
 * One concrete, per-day action for an axis, built from its own numbers. Null when the axis is fine
 * (≥ 90) or there is nothing specific to say.
 */
export function axisTip(axis: AxisResult, cycle: CycleDays): string | null {
  if (!measured(axis) || (axis.score as number) >= 90) return null;
  const remaining = remainingOf(cycle);
  const running = cycle.kind === 'running' && remaining > 0;
  const n = basisNumbers(axis.basis);
  const perDay = (amount: number) => (running ? Math.ceil(amount / remaining) : 0);

  switch (axis.key) {
    case 'shift_target':
    case 'branch_target': {
      const [sold, target] = n;
      if (!sold || !target || sold >= target) return null;
      if (running && cycle.elapsedDays > 0) {
        // Keep the current daily pace and add the daily amount that closes the gap by cycle end.
        const extra = ((target - sold) * cycle.totalDays) / (cycle.elapsedDays * remaining);
        return `ناقص ${fmt(target - sold)} ج عن التارجت لحد النهارده: زوّد حوالي ${fmt(extra)} ج في اليوم في الـ ${remaining} يوم الباقيين علشان تقفل الدورة على 100٪.`;
      }
      return `الدورة قفلت على ${fmt(sold)} من ${fmt(target)} ج — الفرق ${fmt(target - sold)} ج.`;
    }
    case 'avg_invoice':
      return 'متوسط فاتورتك أقل من الفرع في نفس الساعة: اقترح صنف مكمّل أو العبوة الأكبر مع كل روشتة.';
    case 'avg_invoice_growth':
      return 'متوسط فاتورة الفرع نزل عن الدورة اللي فاتت: تابع مع الفريق البيع المكمّل والعروض.';
    case 'basket_items':
      return 'عدد الأصناف في الفاتورة أقل من الفرع: اسأل العميل عن احتياجاته التانية (فيتامينات، عناية، مستلزمات).';
    case 'customers_growth':
      return 'عدد فواتير الفرع أقل من نفس الأيام في الدورة اللي فاتت: راجع تغطية الشيفتات في وقت الذروة وتابع العملاء اللي بطّلوا ييجوا.';
    case 'invoice_share':
      return 'عدد الفواتير أقل من المتوقع في ساعاتك: خلّيك على الكاونتر في وقت الذروة وخلّص العميل بسرعة.';
    case 'requests_closure': {
      const open = n[2];
      if (!open) return null;
      return running
        ? `فيه ${fmt(open)} طلب عميل مفتوح: اقفل حوالي ${fmt(perDay(open))} طلب في اليوم لحد آخر الدورة.`
        : `قفلت الدورة وفيه ${fmt(open)} طلب عميل مفتوح.`;
    }
    case 'requests_fulfilled':
      return 'أغلب الطلبات اللي اتسجلت العميل ما اشتراش الصنف: اتصل بالعميل أول ما الصنف يوصل وسجّل كوده على الطلب.';
    case 'purchase_review': {
      const pending = n[n.length - 1];
      if (!pending) return null;
      return running
        ? `${fmt(pending)} فاتورة شراء مستنية مراجعة: راجع حوالي ${fmt(perDay(pending))} فاتورة في اليوم.`
        : `قفلت الدورة و${fmt(pending)} فاتورة شراء ما اتراجعتش.`;
    }
    case 'branch_coding':
    case 'coding_quality':
      return 'كوّد العميل على كل فاتورة (رقم الموبايل) — كل فاتورة من غير كود بتنزّل النسبة.';
    case 'team_followup': {
      const missing = n[0];
      return missing
        ? `${fmt(missing)} بصمة ناقصة للفريق ما اتصلحتش: افتح صفحة البصمات وخلّص قراراتها أول بأول.`
        : null;
    }
    case 'team_discipline':
      return 'انضباط الفريق أقل من المطلوب: راجع التأخيرات المتكررة مع أصحابها أول الأسبوع.';
    case 'team_violations':
      return 'فيه موظفين عدّوا سماح البصمات الناقصة: نبّههم، وكل بصمة ناقصة بعد كده بتتخصم.';
    case 'discipline':
      return 'التزم بميعاد الحضور، وابصم حضور وانصراف كل يوم — البصمة الناقصة بتتحسب عليك لو ما اتصلحتش.';
    case 'conversation_quality':
    case 'team_conversations':
      return 'جودة المحادثات أقل من المطلوب: رد بسرعة، وسلّم على العميل باسمه، واقفل كل محادثة بخطوة واضحة.';
    case 'customer_requests':
    case 'request_capture':
    case 'team_capture':
      return 'سجّل أي صنف العميل سأل عليه ومش موجود، من غير ما تستنى.';
    case 'followups':
      return 'تابع عملاء الأمراض المزمنة قبل ما الدوا يخلص عندهم.';
    case 'deliveries_per_day':
      return 'عدد التوصيلات أقل من زمايلك في أيام العمل: خلّيك متاح في أوقات الطلبات.';
    default:
      return null;
  }
}

export interface EvaluationSignal {
  tone: 'danger' | 'warning' | 'info' | 'success';
  text: string;
}

const pick = (score: LabPersonScore | null | undefined, key: string) =>
  score?.axes.find((axis) => axis.key === key && measured(axis)) || null;

/** Unusual things worth a look: drops vs last cycle, punches, invoices without a punch, backlogs. */
export function evaluationSignals(
  current: LabPersonScore,
  previous: LabPersonScore | null | undefined,
  cycle: CycleDays
): EvaluationSignal[] {
  const out: EvaluationSignal[] = [];

  if (previous && previous.total !== null && current.total !== null) {
    const diff = current.total - previous.total;
    if (diff <= -5) {
      out.push({
        tone: 'danger',
        text: `درجتك ${Math.round(current.total)} مقابل ${Math.round(previous.total)} في الدورة اللي فاتت (−${Math.round(-diff)})${cycle.kind === 'running' ? ' — لسه فيه وقت تعوّض' : ''}.`,
      });
    } else if (diff >= 5) {
      out.push({
        tone: 'success',
        text: `درجتك طالعة ${Math.round(diff)} عن الدورة اللي فاتت (${Math.round(previous.total)} → ${Math.round(current.total)}) 👏`,
      });
    }
    const drops = current.axes
      .filter(measured)
      .map((axis) => ({ axis, before: pick(previous, axis.key) }))
      .filter(
        ({ axis, before }) => before && (before.score as number) - (axis.score as number) >= 20
      )
      .sort(
        (a, b) =>
          (b.before!.score as number) -
          (b.axis.score as number) -
          ((a.before!.score as number) - (a.axis.score as number))
      )
      .slice(0, 2);
    for (const { axis, before } of drops) {
      out.push({
        tone: 'warning',
        text: `«${axis.label}» نزل من ${Math.round(before!.score as number)} لـ ${Math.round(axis.score as number)} عن الدورة اللي فاتت.`,
      });
    }
  }

  // Invoices under the person's name while they were not punched in (from the shift target basis).
  const shift = pick(current, 'shift_target');
  const unpunched = shift?.basis.match(/([\d٠-٩٬,]+)\s*فاتورة باسمه وهو مش باصم/);
  if (unpunched) {
    const count = basisNumbers(unpunched[1])[0] || 0;
    if (count >= 10)
      out.push({
        tone: 'warning',
        text: `${fmt(count)} فاتورة اتسجلت باسمك وانت مش باصم — يا إما نسيت تبصم، يا إما حد بيبيع على حسابك.`,
      });
  }

  const attendance: LabAttendanceSummary | null | undefined = current.attendance;
  if (attendance) {
    if (attendance.missingPunchDays > 0) {
      out.push({
        tone: 'warning',
        text: `${attendance.missingPunchDays} يوم فيه بصمة ناقصة ما اتصلحتش — بتتحسب عليك في الانضباط.`,
      });
    }
    if (attendance.avgLateMinutes >= 10) {
      out.push({
        tone: 'warning',
        text: `متوسط تأخيرك ${Math.round(attendance.avgLateMinutes)} دقيقة في اليوم.`,
      });
    }
    if (attendance.pendingDays >= 3) {
      out.push({
        tone: 'info',
        text: `${attendance.pendingDays} يوم حضور لسه مستنيين قرار — مش محسوبين عليك، بس اسأل مديرك يقفلهم.`,
      });
    }
  }

  // Branch manager backlogs that the manager controls directly.
  const review = pick(current, 'purchase_review');
  if (review && (review.score as number) === 0) {
    out.push({ tone: 'danger', text: 'ولا فاتورة شراء اتراجعت في الدورة دي.' });
  }
  const closure = pick(current, 'requests_closure');
  const open = closure ? basisNumbers(closure.basis)[2] : 0;
  if (open >= 20) out.push({ tone: 'warning', text: `${fmt(open)} طلب عميل مفتوح في الفرع.` });

  for (const adjustment of current.adjustments) {
    out.push({
      tone: 'danger',
      text: `${adjustment.label}: ${adjustment.points} درجة (${adjustment.reason}).`,
    });
  }
  return out;
}

/** "Doctors' median" etc., by role family. */
export function familyLabel(family: string): string {
  switch (family) {
    case 'branch_manager':
      return 'مديري الفروع';
    case 'branches_manager':
      return 'مديري الفروع';
    case 'assistant':
      return 'المساعدين';
    case 'delivery':
      return 'الدليفري';
    default:
      return 'الصيادلة';
  }
}
