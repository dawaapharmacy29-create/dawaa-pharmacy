import { describe, expect, it } from 'vitest';
import { buildFollowupExportRows } from '@/lib/customerFollowupExport';
import {
  completedToday,
  isArchivedHistoryFollowup,
  isCancelledHistoryFollowup,
  isCompletedHistoryFollowup,
  isOpenFollowup,
} from '@/lib/customerServiceFollowupStatus';

describe('customer followup status and export', () => {
  it('separates open, completed, cancelled and archived rows', () => {
    expect(isOpenFollowup({ status: 'not_started' })).toBe(true);
    expect(isCompletedHistoryFollowup({ followup_result: 'تم الرد والعميل راضي', completed_at: '2026-07-20T09:00:00Z' })).toBe(true);
    expect(isCancelledHistoryFollowup({ cancelled_at: '2026-07-20T09:00:00Z' })).toBe(true);
    expect(isArchivedHistoryFollowup({ archived_at: '2026-07-20T09:00:00Z' })).toBe(true);
  });

  it('uses completed_at to calculate completed today', () => {
    expect(
      completedToday(
        {
          followup_date: '2026-07-18',
          followup_result: 'تم الرد والعميل راضي',
          completed_at: '2026-07-20T09:00:00Z',
        },
        '2026-07-20'
      )
    ).toBe(true);
  });

  it('exports only open rows when openOnly is enabled', () => {
    const exported = buildFollowupExportRows(
      [
        {
          id: 'open-1',
          customer_id: 'customer-1',
          customer_code: '8661',
          customer_name: 'ش ++اسلام محمد',
          customer_phone: '01',
          branch: 'فرع الشامي',
          status: 'not_started',
          followup_reason: 'متابعة اهتمام',
          next_followup_date: null,
          created_by_name: 'د/ ضحى',
        },
        {
          id: 'completed-1',
          customer_id: 'customer-2',
          customer_name: 'عميل مكتمل',
          followup_result: 'تم الرد والعميل راضي',
          completed_at: '2026-07-20T09:00:00Z',
        },
      ],
      { openOnly: true }
    );

    expect(exported.length).toBe(1);
    expect(exported[0]['معرف المتابعة']).toBe('open-1');
    expect(exported[0]['مفتاح هوية العميل']).toBe('id:customer-1');
    expect(exported[0]['مشكلات البيانات']).toContain('رقم الهاتف غير صالح');
    expect(exported[0]['مشكلات البيانات']).toContain('متابعة مفتوحة بدون موعد قادم');
  });
});
