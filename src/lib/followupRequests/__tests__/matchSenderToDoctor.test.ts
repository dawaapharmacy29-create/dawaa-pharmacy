import { describe, expect, it } from 'vitest';
import { matchSenderToDoctor } from '../matchSenderToDoctor';

// The eligible doctors on 2026-11-09.
const names = ['د اميرة ', 'د دنيا', 'د رضا', 'د محمد شبل', 'د محمد وليد', 'د وائل', 'د/ أحمد عاطف', 'د/ علا', 'د/ علياء', 'د/ عمر', 'د/ عمرو صلاح', 'د/ مغازي'];
const doctors = names.map((name, index) => ({ staffId: String(index), name }));
const match = (sender: string) => matchSenderToDoctor(sender, doctors)?.name.trim() ?? null;

describe('matchSenderToDoctor', () => {
  it.each([
    ['Dr Donia El Kholy', 'د دنيا'],
    ['Dr Amira', 'د اميرة'],
    ['Amira Ahmed', 'د اميرة'],
    ['Dr Reda', 'د رضا'],
    ['Dr Wael', 'د وائل'],
    ['Dr Mohamed Shebl', 'د محمد شبل'],
    ['Mohammed Walid', 'د محمد وليد'],
    ['Dr Ahmed Atef', 'د/ أحمد عاطف'],
    ['Ola Samy', 'د/ علا'],
    ['Dr Aliaa Samy', 'د/ علياء'],
    ['Dr Omar', 'د/ عمر'],
    ['Dr Amr Salah', 'د/ عمرو صلاح'],
    ['Dr Amr', 'د/ عمرو صلاح'],
    ['Dr Maghazy', 'د/ مغازي'],
    ['د دنيا الخولي', 'د دنيا'],
  ])('reads %s', (sender, expected) => {
    expect(match(sender)).toBe(expected);
  });

  it('leaves a shared first name for the manager to choose', () => {
    expect(match('Dr Mohamed')).toBeNull();
  });
  it('does not credit a different person with the same first name', () => {
    expect(match('Ahmed Hafez')).toBeNull();
  });
  it('does not guess an unknown name', () => {
    expect(match('Dr Karim')).toBeNull();
    expect(match('Mina Pharmacy')).toBeNull();
  });
  it('ignores a sender that is only a title', () => {
    expect(match('Dr')).toBeNull();
  });
});
