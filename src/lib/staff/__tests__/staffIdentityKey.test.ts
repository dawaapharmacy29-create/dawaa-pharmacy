import { describe, expect, it } from 'vitest';
import { staffIdentityKey } from '@/lib/staff/staffIdentityKey';
import { normalizeStaffName as duplicateAuditKey } from '@/lib/staffDuplicateAudit';

// Production names that the former first-letter rule collapsed (محمد/أحمد -> حمد, دعاء -> عاء).
describe('single staff identity key', () => {
  it('never drops the first letter of a name', () => {
    expect(staffIdentityKey('محمد علي')).toBe('محمدعلي');
    expect(staffIdentityKey('أحمد علي')).toBe('احمدعلي');
    expect(staffIdentityKey('محمد علي')).not.toBe(staffIdentityKey('أحمد علي'));
    expect(staffIdentityKey('مصطفي')).toBe('مصطفي');
    expect(staffIdentityKey('دعاء ابراهيم')).toBe('دعاءابراهيم');
    expect(staffIdentityKey('دنيا')).toBe('دنيا');
    expect(staffIdentityKey('مدحت')).toBe('مدحت');
  });

  it('strips doctor titles only when separated, so spellings of one person share a key', () => {
    for (const spelling of ['د/ دنيا', 'د دنيا', 'د.دنيا', 'دكتور دنيا', 'دكتورة دنيا', 'الدكتور دنيا', 'دنيا']) {
      expect(staffIdentityKey(spelling)).toBe('دنيا');
    }
    expect(staffIdentityKey('د اسلام')).toBe(staffIdentityKey('اسلام'));
  });

  it('is the key used by duplicate detection (no second normalizer)', () => {
    for (const name of ['محمد خالد', 'أحمد خالد', 'د/ علا', 'دعاء', 'ضحى']) {
      expect(duplicateAuditKey(name)).toBe(staffIdentityKey(name));
    }
  });
});
