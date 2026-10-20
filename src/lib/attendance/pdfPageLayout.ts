/**
 * Layout for a captured employee profile PDF. Avoid a virtually blank trailing
 * page if a brief footer or extra whitespace spills just beyond printable A4.
 * When content is genuinely longer, retain every source pixel in successive
 * cropped page images. Pure geometry; no access to HR or payroll data.
 */
export type EmployeePdfSlice = {
  topPx: number;
  heightPx: number;
  leftMm: number;
  widthMm: number;
  heightMm: number;
};
export function paginateEmployeeProfileBitmap(
  canvasWidth: number,
  canvasHeight: number,
  printableWidthMm = 190,
  printableHeightMm = 277,
): EmployeePdfSlice[] {
  if (!Number.isFinite(canvasWidth) || !Number.isFinite(canvasHeight) ||
    canvasWidth <= 0 || canvasHeight <= 0) throw new Error('Invalid profile PDF bitmap size');

  const nativeHeightMm = canvasHeight * printableWidthMm / canvasWidth;
  // A 35mm overflow represents a mostly empty accidental second page.
  // Reduce *both* dimensions proportionally (at most 11%) and center it.
  if (nativeHeightMm <= printableHeightMm + 35) {
    const shrink = Math.min(1, printableHeightMm / nativeHeightMm);
    const widthMm = printableWidthMm * shrink;
    return [{
      topPx: 0, heightPx: canvasHeight,
      leftMm: 10 + (printableWidthMm - widthMm) / 2,
      widthMm,
      heightMm: nativeHeightMm * shrink,
    }];
  }

  const pagePixels = Math.max(1, Math.floor(canvasWidth * printableHeightMm / printableWidthMm));
  const result: EmployeePdfSlice[] = [];
  for (let start = 0; start < canvasHeight; start += pagePixels) {
    const heightPx = Math.min(pagePixels, canvasHeight - start);
    result.push({
      topPx: start,
      heightPx,
      leftMm: 10,
      widthMm: printableWidthMm,
      heightMm: heightPx * printableWidthMm / canvasWidth,
    });
  }
  return result;
}
