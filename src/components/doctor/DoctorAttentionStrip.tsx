import { useEffect, useState } from 'react';
import { AlertTriangle, CalendarClock, FileWarning, Fingerprint } from 'lucide-react';
import { listStaffMissingPunchHistoryV1 } from '@/lib/attendance/attendanceResolutionService';
import { readLatestBranchInvoiceAt } from '@/lib/readModels/invoiceRecordReadModel';

// Awareness only: nothing here is an action the doctor must take in the app. The missing-punch
// allowance (2 per cycle, then a fixed EGP 50 each) is the existing attendance policy; the numbers
// come from attendance_missing_punch_incidents through its domain service.

const MISSING_PUNCH_ALLOWANCE = 2;
const MISSING_PUNCH_PENALTY_EGP = 50;
const STALE_INVOICE_HOURS = 36;

const cairoDay = (iso: string) =>
  new Intl.DateTimeFormat('ar-EG', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'long' }).format(new Date(iso));

function Item({ icon: Icon, tone, title, detail }: { icon: typeof AlertTriangle; tone: 'ok' | 'warn' | 'danger'; title: string; detail: string }) {
  const toneClass = tone === 'danger'
    ? 'dawaa-status-danger-text dawaa-status-danger-bg dawaa-status-danger-border'
    : tone === 'warn'
      ? 'dawaa-status-warning-text dawaa-status-warning-bg dawaa-status-warning-border'
      : 'dawaa-status-success-text dawaa-status-success-bg dawaa-status-success-border';
  return (
    <div className={`flex min-w-[220px] flex-1 items-start gap-2 rounded-2xl border px-3 py-2 ${toneClass}`}>
      <Icon size={16} className="mt-0.5 shrink-0" />
      <div>
        <div className="text-sm font-black">{title}</div>
        <div className="text-xs font-bold opacity-80">{detail}</div>
      </div>
    </div>
  );
}

export default function DoctorAttentionStrip({
  staffId,
  branch,
  cycleStart,
  uncodedInvoices,
  invoicesCount,
}: {
  staffId: string;
  branch: string;
  /** YYYY-MM-DD, first day of the 26→25 cycle. */
  cycleStart: string;
  uncodedInvoices: number | null;
  invoicesCount: number | null;
}) {
  const [latestInvoiceAt, setLatestInvoiceAt] = useState<string | null | undefined>(undefined);
  const [punchesUsed, setPunchesUsed] = useState<number | null | undefined>(undefined);

  useEffect(() => {
    if (!branch) return;
    readLatestBranchInvoiceAt(branch).then(setLatestInvoiceAt).catch(() => setLatestInvoiceAt(null));
  }, [branch]);

  useEffect(() => {
    if (!staffId) return;
    listStaffMissingPunchHistoryV1(staffId, 50)
      .then((rows) => setPunchesUsed(rows.filter((row) => String(row.attendance_date) >= cycleStart).length))
      .catch(() => setPunchesUsed(null));
  }, [cycleStart, staffId]);

  const items = [];

  if (latestInvoiceAt !== undefined) {
    const hours = latestInvoiceAt ? (Date.now() - Date.parse(latestInvoiceAt)) / 36e5 : null;
    items.push(
      <Item
        key="invoices"
        icon={CalendarClock}
        tone={latestInvoiceAt && hours !== null && hours <= STALE_INVOICE_HOURS ? 'ok' : 'warn'}
        title={latestInvoiceAt ? `آخر فواتير مسجلة: ${cairoDay(latestInvoiceAt)}` : 'تعذر معرفة آخر تحديث للفواتير'}
        detail={latestInvoiceAt && hours !== null && hours > STALE_INVOICE_HOURS
          ? 'أرقام المبيعات هتتحدث بعد استيراد الفواتير الجديدة'
          : 'أرقام المبيعات محدثة حتى هذا التاريخ'}
      />,
    );
  }

  if (punchesUsed !== undefined) {
    const over = punchesUsed === null ? 0 : Math.max(0, punchesUsed - MISSING_PUNCH_ALLOWANCE);
    items.push(
      <Item
        key="punches"
        icon={Fingerprint}
        tone={punchesUsed === null ? 'warn' : over ? 'danger' : punchesUsed ? 'warn' : 'ok'}
        title={punchesUsed === null
          ? 'تعذر تحميل البصمات الناقصة'
          : `بصمات ناقصة في الدورة: ${punchesUsed} من ${MISSING_PUNCH_ALLOWANCE} مسموح`}
        detail={punchesUsed === null
          ? 'أعد المحاولة بعد قليل'
          : over
            ? `تجاوزت السماح بـ ${over} — خصم ${MISSING_PUNCH_PENALTY_EGP} ج عن كل مرة`
            : `بعد ${MISSING_PUNCH_ALLOWANCE} مرات يتخصم ${MISSING_PUNCH_PENALTY_EGP} ج عن كل بصمة ناقصة`}
      />,
    );
  }

  if (uncodedInvoices !== null && invoicesCount) {
    items.push(
      <Item
        key="coding"
        icon={FileWarning}
        tone={uncodedInvoices ? 'warn' : 'ok'}
        title={uncodedInvoices ? `${uncodedInvoices} فاتورة من غير كود عميل في الدورة` : 'كل فواتيرك في الدورة مكوّدة'}
        detail={uncodedInvoices ? 'خلي بالك تكوّد العميل في الفواتير الجديدة' : `${invoicesCount} فاتورة`}
      />,
    );
  }

  if (!items.length) return null;
  return <section className="flex flex-wrap gap-2" aria-label="تنبيهات">{items}</section>;
}
