/*
 * Runtime safety layer for legacy data coming from Supabase/localStorage.
 * It prevents old rows with object/number values from crashing pages that still call .trim().
 */
export function installRuntimeSafetyGuards() {
  const prototypes: Array<{ proto: object; name: string; fn: () => string }> = [
    { proto: Object.prototype, name: "trim", fn: function trimObject(this: unknown) { return safeString(this).trim(); } },
    { proto: Number.prototype, name: "trim", fn: function trimNumber(this: unknown) { return safeString(this).trim(); } },
    { proto: Boolean.prototype, name: "trim", fn: function trimBoolean(this: unknown) { return safeString(this).trim(); } },
    { proto: Array.prototype, name: "trim", fn: function trimArray(this: unknown) { return safeString(this).trim(); } },
    { proto: Object.prototype, name: "toLowerCase", fn: function lowerObject(this: unknown) { return safeString(this).toLowerCase(); } },
    { proto: Number.prototype, name: "toLowerCase", fn: function lowerNumber(this: unknown) { return safeString(this).toLowerCase(); } },
    { proto: Boolean.prototype, name: "toLowerCase", fn: function lowerBoolean(this: unknown) { return safeString(this).toLowerCase(); } },
    { proto: Array.prototype, name: "toLowerCase", fn: function lowerArray(this: unknown) { return safeString(this).toLowerCase(); } },
  ];

  for (const item of prototypes) {
    const descriptor = Object.getOwnPropertyDescriptor(item.proto, item.name);
    if (!descriptor) {
      Object.defineProperty(item.proto, item.name, {
        value: item.fn,
        writable: true,
        configurable: true,
        enumerable: false,
      });
    }
  }
}

export function safeString(value: unknown, fallback = ""): string {
  if (value == null) return fallback;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  if (Array.isArray(value)) return value.map((v) => safeString(v)).filter(Boolean).join(" ");
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const preferred = record.key ?? record.role ?? record.name ?? record.label ?? record.labelAr ?? record.value ?? record.title ?? record.branch;
    if (preferred != null && preferred !== value) return safeString(preferred, fallback);
    try { return JSON.stringify(value); } catch { return fallback; }
  }
  return fallback;
}

export function safeRecord<T extends Record<string, unknown>>(value: unknown): T {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as T) : ({} as T);
}
