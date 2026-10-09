// Current canonical identity of a review's customer and responsible staff, shown next to the
// snapshot the review recorded. The snapshot is history (kept for audit); the canonical record is
// read by id, so a renamed customer/staff never shows an old name as the current one.
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { readStaffIdentityById } from '@/lib/readModels/staffDirectoryReadModel';
import { reviewCustomerLookup, reviewResponsibleStaffId } from '@/lib/reviews/reviewIdentity';

interface IdentityRow {
  staff_id?: string | null;
  doctor_id?: string | null;
  staff_name?: string | null;
  doctor_name?: string | null;
  customer_id?: string | null;
  customer_name?: string | null;
  customer_code?: string | null;
  customer_phone?: string | null;
}

interface CanonicalIdentityState {
  loading: boolean;
  customer: { name: string | null; code: string | null; phone: string | null } | null | 'missing';
  staff: { name: string | null; role: string | null } | null | 'missing';
}

const text = (value: unknown) => String(value ?? '').trim();

export function useReviewCanonicalIdentity(row: IdentityRow | null | undefined): CanonicalIdentityState {
  const customerKey = text(row?.customer_id);
  const staffId = reviewResponsibleStaffId(row);
  const [state, setState] = useState<CanonicalIdentityState>({ loading: false, customer: null, staff: null });

  useEffect(() => {
    // A response for a previous review never overwrites the identity of the one on screen.
    let cancelled = false;
    const lookup = reviewCustomerLookup(customerKey);
    if (!lookup && !staffId) {
      setState({ loading: false, customer: null, staff: null });
      return;
    }
    setState({ loading: true, customer: null, staff: null });
    void Promise.all([
      lookup
        ? Promise.resolve(
            supabase.from('customers').select('name,customer_code,phone').eq(lookup.column, lookup.value).maybeSingle()
          )
        : Promise.resolve(null),
      staffId
        ? readStaffIdentityById(staffId).then((data) => ({ data }))
        : Promise.resolve(null),
    ]).then(([customerResult, staffResult]) => {
      if (cancelled) return;
      const customerData = customerResult?.data as { name?: string; customer_code?: string; phone?: string } | null | undefined;
      const staffData = staffResult?.data as { name?: string; role?: string } | null | undefined;
      setState({
        loading: false,
        customer: !lookup
          ? null
          : customerData
            ? { name: customerData.name ?? null, code: customerData.customer_code ?? null, phone: customerData.phone ?? null }
            : 'missing',
        staff: !staffId ? null : staffData ? { name: staffData.name ?? null, role: staffData.role ?? null } : 'missing',
      });
    }).catch(() => {
      if (!cancelled) setState({ loading: false, customer: lookup ? 'missing' : null, staff: staffId ? 'missing' : null });
    });
    return () => {
      cancelled = true;
    };
  }, [customerKey, staffId]);

  return state;
}

/** Canonical identity block: current identity from the id; the review's own snapshot labelled as history. */
export function ReviewCanonicalIdentity({ row }: { row: IdentityRow }) {
  const identity = useReviewCanonicalIdentity(row);
  const snapshotCustomer = text(row.customer_name);
  const snapshotStaff = text(row.staff_name) || text(row.doctor_name);

  const customerLine = (() => {
    if (!text(row.customer_id)) {
      return `عميل غير محسوم — اسم مسجل وقت التقييم فقط: ${snapshotCustomer || 'غير محدد'}`;
    }
    if (identity.loading) return 'جاري تحميل الهوية المعتمدة للعميل...';
    if (identity.customer === 'missing' || !identity.customer)
      return `هوية العميل (${text(row.customer_id)}) غير موجودة في سجل العملاء — المعروض لقطة وقت التقييم.`;
    const current = identity.customer;
    const parts = [current.name || 'بدون اسم', current.code || 'بدون كود', current.phone || 'بدون هاتف'];
    return `العميل المعتمد حاليًا: ${parts.join(' · ')}`;
  })();

  const staffLine = (() => {
    if (!reviewResponsibleStaffId(row)) return `موظف غير محسوم — اسم مسجل وقت التقييم فقط: ${snapshotStaff || 'غير محدد'}`;
    if (identity.loading) return 'جاري تحميل الهوية المعتمدة للموظف...';
    if (identity.staff === 'missing' || !identity.staff) return 'الموظف المسؤول غير موجود في سجل الموظفين — المعروض لقطة وقت التقييم.';
    return `الموظف المسؤول حاليًا: ${identity.staff.name || '-'}${identity.staff.role ? ` (${identity.staff.role})` : ''}`;
  })();

  const customerChanged =
    identity.customer && identity.customer !== 'missing' && snapshotCustomer && identity.customer.name && identity.customer.name !== snapshotCustomer;
  const staffChanged =
    identity.staff && identity.staff !== 'missing' && snapshotStaff && identity.staff.name && identity.staff.name !== snapshotStaff;

  return (
    <div className="rounded-xl border border-slate-600/40 bg-slate-900/40 p-3 text-xs leading-6 text-slate-200" data-testid="review-canonical-identity">
      <div>{customerLine}</div>
      {customerChanged ? <div className="text-slate-400">اسم العميل وقت التقييم (لقطة تاريخية): {snapshotCustomer}</div> : null}
      <div>{staffLine}</div>
      {staffChanged ? <div className="text-slate-400">اسم الموظف وقت التقييم (لقطة تاريخية): {snapshotStaff}</div> : null}
    </div>
  );
}
