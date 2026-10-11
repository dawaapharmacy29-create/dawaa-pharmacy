import { describe,expect,it } from 'vitest';
import { cairoDateBoundaryIso } from '../cairoDateBoundary';

describe('Cairo date boundaries',()=>{
 it('uses standard-time offset in January',()=>{
  expect(cairoDateBoundaryIso('2026-01-10')).toBe('2026-01-09T22:00:00.000Z');
 });
 it('uses daylight-saving offset in July',()=>{
  expect(cairoDateBoundaryIso('2026-07-10')).toBe('2026-07-09T21:00:00.000Z');
  expect(cairoDateBoundaryIso('2026-07-10',true)).toBe('2026-07-10T20:59:59.999Z');
 });
});
