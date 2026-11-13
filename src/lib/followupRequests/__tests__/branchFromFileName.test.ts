import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import { branchFromFileName } from '../followupRequestService';

const branches = ['فرع شكري', 'فرع الشامي'];

describe('branchFromFileName', () => {
  it.each([
    ['Customer Service shamy branch.zip', 'فرع الشامي'],
    ['متابعات الشامي.txt', 'فرع الشامي'],
    ['Shokry follow up.zip', 'فرع شكري'],
    ['Classification, customer service.zip', ''],
  ])('reads %s', (fileName, expected) => {
    expect(branchFromFileName(fileName, branches)).toBe(expected);
  });
  it('does not return a branch the page does not know', () => {
    expect(branchFromFileName('shamy.zip', ['فرع شكري'])).toBe('');
  });
});
