import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const component = readFileSync(resolve(process.cwd(),
  'src/components/attendance/EmployeeProfileDrawer.tsx'), 'utf8');
const header = readFileSync(resolve(process.cwd(),
  'src/components/layout/Header.tsx'), 'utf8');

describe('employee attendance profile drawer layout', () => {
  it('uses a document portal and starts below the 56px global header', () => {
    expect(header).toContain('sticky top-0 z-[220]');
    expect(header).toContain('h-14');
    expect(component).toContain("import { createPortal } from 'react-dom'");
    expect(component).toContain('return createPortal(');
    expect(component).toContain('document.body');
    expect(component).toContain('top-14 z-[240]');
    expect(component).not.toContain('fixed inset-0 z-50 flex justify-end');
  });
  it('pins complete staff identity and actions while scroll stays inside the body', () => {
    expect(component).toContain('max-w-[640px]');
    expect(component).toContain('shrink-0 items-start');
    expect(component).toContain('break-words text-lg');
    expect(component).toContain('min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain');
    expect(component).toContain('إغلاق ملف الموظف');
    expect(component).toContain('تصدير ملف الحضور PDF');
    expect(component).toContain("event.key === 'Escape'");
    expect(component).toContain('aria-modal="true"');
  });
  it('simplifies coverage copy and separates different kinds of attendance evidence', () => {
    expect(component).toContain('ملخص الحضور غير مكتمل');
    expect(component).toContain('أيام بصمات بلا ملخص حضور');
    expect(component).toContain('البصمات للمتابعة فقط وليست اعتمادًا');
    expect(component).toContain('معدلات الحضور');
    expect(component).toContain('تغطية الحضور غير مكتملة');
    expect(component).toContain('الشيفت الأسبوعي');
    expect(component).toContain('currentCairoDay');
    expect(component).toContain('آخر أيام الحضور');
    expect(component).toContain('ساعات المرتب المحفوظة');
    expect(component).toContain('دليل البصمات');
    expect(component).toContain('لا يوجد ملخص حضور لهذه الفترة');
  });
  it('preserves the same secured profile RPC and PDF without payroll writes', () => {
    expect(component).toContain("supabase.rpc('attendance_employee_profile_evidence_v1'");
    expect(component).toContain('buildEmployeeAttendanceProfilePdf({');
    expect(component).not.toMatch(/supabase\.(?:from\(|rpc\('(?:approve|upsert|reopen|delete))/);
    expect(component).not.toContain('applyConfirmedBiometricBatch');
    expect(component).not.toContain('previewProfile');
    expect(component).not.toContain('VisualPreview');
  });
});
