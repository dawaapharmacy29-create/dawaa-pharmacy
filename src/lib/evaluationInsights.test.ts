import { describe, expect, it } from 'vitest';
import { axisImpacts, axisTip, basisNumbers, evaluationSignals } from './evaluationInsights';
import type { AxisResult } from './evaluationLab/scoring';
import type { LabPersonScore } from './evaluationLab/buildCycleScores';

const axis = (key: string, weight: number, score: number | null, basis = ''): AxisResult =>
  ({
    key,
    label: key,
    weight,
    status: score === null ? 'not_measurable' : 'measured',
    value: score,
    score,
    basis,
  }) as AxisResult;

const person = (axes: AxisResult[], total: number | null, extra: Partial<LabPersonScore> = {}) =>
  ({
    staffId: 's',
    name: 'x',
    branch: null,
    family: 'doctor',
    total,
    baseTotal: total,
    adjustments: [],
    coverage: 1,
    readiness: 'ready',
    axes,
    ...extra,
  }) as LabPersonScore;

describe('basisNumbers', () => {
  it('reads Arabic digits and thousands separators', () => {
    expect(basisNumbers('١٬٦٤٩٬٦٦٧ من ١٬٧٥٠٬٠٠٠ ج')).toEqual([1649667, 1750000]);
    expect(basisNumbers('45/165 تم تنفيذه · 120 مفتوح · وسيط 43.6 ساعة')).toEqual([
      45, 165, 120, 43.6,
    ]);
  });
});

describe('axisImpacts', () => {
  it('spreads unmeasured weight and sums to the base total gap', () => {
    const impacts = axisImpacts([axis('a', 30, 50), axis('b', 10, 100), axis('c', 60, null)]);
    expect(impacts.a.share).toBe(75);
    expect(impacts.a.lost).toBe(37.5);
    expect(impacts.a.gainTo80).toBe(22.5);
    expect(impacts.b.lost).toBe(0);
    expect(impacts.c).toBeUndefined();
  });
});

describe('axisTip', () => {
  const running = { kind: 'running' as const, elapsedDays: 10, totalDays: 30 };
  it('gives the extra daily sales that close the target gap', () => {
    const tip = axisTip(axis('branch_target', 15, 60, '١٬٠٠٠٬٠٠٠ من ١٬٢٠٠٬٠٠٠ ج'), running);
    // gap 200k over 10 days → 20k/day behind; to finish at 100% over 20 days: 200k×30/(10×20) = 30k/day.
    expect(tip).toContain('٣٠٬٠٠٠');
    expect(tip).toContain('20 يوم');
  });
  it('splits open requests over the remaining days', () => {
    expect(
      axisTip(axis('requests_closure', 5, 10, '9/57 تم تنفيذه · 48 مفتوح'), running)
    ).toContain('٣');
  });
  it('says nothing for a strong axis', () => {
    expect(axisTip(axis('discipline', 10, 95), running)).toBeNull();
  });
});

describe('evaluationSignals', () => {
  const cycle = { kind: 'running' as const, elapsedDays: 10, totalDays: 30 };
  it('flags a drop vs the last cycle and the axis that fell', () => {
    const now = person([axis('avg_invoice', 10, 40)], 60);
    const before = person([axis('avg_invoice', 10, 85)], 75);
    const texts = evaluationSignals(now, before, cycle).map((s) => s.text);
    expect(texts[0]).toContain('−15');
    expect(texts.some((t) => t.includes('85') && t.includes('40'))).toBe(true);
  });
  it('flags invoices under the name without a punch', () => {
    const now = person(
      [axis('shift_target', 20, 90, 'باع ... · 137 فاتورة باسمه وهو مش باصم')],
      90
    );
    expect(evaluationSignals(now, null, cycle)[0].text).toContain('١٣٧');
  });
  it('flags a manager purchase review at zero', () => {
    const now = person([axis('purchase_review', 5, 0, 'اتراجع 0 من ١٬٦٦٨')], 60, {
      family: 'branch_manager',
    } as Partial<LabPersonScore>);
    expect(evaluationSignals(now, null, cycle).some((s) => s.tone === 'danger')).toBe(true);
  });
});
