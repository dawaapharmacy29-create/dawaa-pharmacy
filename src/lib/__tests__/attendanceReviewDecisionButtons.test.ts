import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(resolve(process.cwd(), 'src/components/attendance/AttendanceResolutionCenter.tsx'),'utf8');

describe('individual staff decision buttons', () => {
  it('renders the context-appropriate actions as adjacent, selectable buttons, not a select', () => {
    expect(src).toContain('اختر القرار المناسب بعد مراجعة الحالة');
    expect(src).toContain('className="flex flex-wrap gap-2"');
    expect(src).toContain('role="group" aria-label="نوع قرار الحضور"');
    expect(src).toContain('type="button" aria-pressed={active}');
    expect(src).toContain('setReason(item.id)');
    expect(src).toContain('✓ ');
    expect(src).not.toContain('<select value={reason} onChange={(e) => setReason(e.target.value)}');
    expect(src).toContain('decisionsFor(selected)');
  });
  it('never runs save merely by picking a decision button', () => {
    const from = src.indexOf('role="group" aria-label="نوع قرار الحضور"');
    const to = src.indexOf('</fieldset>', from);
    const picker = src.slice(from,to);
    expect(picker).toContain('onClick={() => {');
    expect(picker).not.toContain('approveSelected()');
    expect(picker).not.toContain('resolveMissingPunchIncidentV1(');
    expect(picker).toContain('لم يُعتمد بعد');
    expect(src).toContain('onClick={() => void approveSelected()}');
    expect(src).toContain("|| !reason || approving");
    expect(src).toContain("'اختر القرار أولًا'");
  });
  it('retains documented validation, optional note, and independent security routes', () => {
    expect(src).toContain("['custom', 'outside_work'].includes(decision.id) && !note.trim()");
    expect(src).toContain('ملاحظة القرار');
    expect(src).toContain('اختياري: تفاصيل إضافية توثق القرار');
    expect(src).toContain('resolveAnnualLeaveFromAttendanceV1({');
    expect(src).toContain('resolveMissingPunchIncidentV1({');
    expect(src).toContain('approveAttendanceFullDayTimeOffV1({');
    expect(src).toContain("selected.queue_lane !== 'manager'");
    expect(src).toContain('permissionStart');
    expect(src).toContain('missingPunchContext');
  });
});