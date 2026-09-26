export type PriorCanonicalProductRowV22 = {
  product_code?: string | null;
  product_id?: string | null;
};

function normalizeProductCodeV22(value: unknown): string {
  return String(value ?? '').trim();
}

export function collectPriorCanonicalProductCodesV22(
  rows: PriorCanonicalProductRowV22[]
): string[] {
  return Array.from(
    new Set(
      rows
        .filter((row) => Boolean(row?.product_id))
        .map((row) => normalizeProductCodeV22(row?.product_code))
        .filter(Boolean)
    )
  );
}

export function findDroppedPriorCanonicalCodesV22(
  priorCodes: Array<string | null | undefined>,
  currentCodes: Array<string | null | undefined>
): string[] {
  const current = new Set(
    currentCodes.map(normalizeProductCodeV22).filter(Boolean)
  );

  return Array.from(
    new Set(priorCodes.map(normalizeProductCodeV22).filter(Boolean))
  ).filter((code) => !current.has(code));
}
