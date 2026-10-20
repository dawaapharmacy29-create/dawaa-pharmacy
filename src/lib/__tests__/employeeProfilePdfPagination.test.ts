import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { paginateEmployeeProfileBitmap } from '@/lib/attendance/pdfPageLayout';

const source = readFileSync(resolve(process.cwd(),
  'src/lib/attendance/employeeProfilePdf.ts'), 'utf8');

describe('employee attendance PDF pagination', () => {
  it('keeps one sheet when source already fits A4', () => {
    const pages = paginateEmployeeProfileBitmap(1560, 2100);
    expect(pages).toHaveLength(1);
    expect(pages[0].heightMm).toBeLessThanOrEqual(277);
    expect(pages[0].widthMm).toBe(190);
  });
  it('prevents a second almost empty sheet for a 5-35mm spill', () => {
    const a = paginateEmployeeProfileBitmap(1560, 1560 * 286 / 190);
    expect(a).toHaveLength(1);
    expect(a[0].heightMm).toBeCloseTo(277);
    expect(a[0].widthMm).toBeLessThan(190);
    expect(a[0].leftMm).toBeGreaterThan(10);
    const edge = paginateEmployeeProfileBitmap(1560, 1560 * 310 / 190);
    expect(edge).toHaveLength(1);
  });
  it('splits truly long evidence across real pages without data loss', () => {
    const height = 7200;
    const parts = paginateEmployeeProfileBitmap(1560, height);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0].topPx).toBe(0);
    for (let i=1;i<parts.length;i++) {
      expect(parts[i].topPx).toBe(parts[i-1].topPx + parts[i-1].heightPx);
    }
    expect(parts.reduce((sum, page) => sum + page.heightPx, 0)).toBe(height);
    expect(parts.every(x=>x.heightPx>0 && x.heightMm<=277.01)).toBe(true);
  });
  it('fails closed on invalid bitmap sizes',()=>{
    expect(() => paginateEmployeeProfileBitmap(0,100)).toThrow();
    expect(() => paginateEmployeeProfileBitmap(200,Number.NaN)).toThrow();
  });
  it('pdf generator uses unique sliced source rows and still removes temporary DOM',()=>{
    expect(source).toContain('paginateEmployeeProfileBitmap(canvas.width, canvas.height)');
    expect(source).toContain('ctx.drawImage(canvas, 0, slice.topPx, canvas.width, slice.heightPx');
    expect(source).toContain('pdf.addPage()');
    expect(source).toContain('host.remove()');
    expect(source).not.toContain('while (heightLeft > 0)');
    expect(source).not.toContain('position = 10 - (imgHeight - heightLeft)');
  });
});