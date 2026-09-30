// GENERATED FILE — do not edit. Source: server/sales-intelligence-refresh-source.ts
// Regenerate with: node scripts/build-sales-intelligence-refresh-api.cjs

// server/sales-intelligence-refresh-source.ts
import { createHash } from "node:crypto";
import { createClient as createClient2 } from "@supabase/supabase-js";

// src/lib/customers/customerIdentity.ts
var INVALID_TEXT_VALUES = /* @__PURE__ */ new Set([
  "",
  "0",
  "null",
  "undefined",
  "\u063A\u064A\u0631 \u0645\u062D\u062F\u062F",
  "\u063A\u064A\u0631 \u0645\u0639\u0631\u0648\u0641",
  "\u0639\u0645\u064A\u0644 \u063A\u064A\u0631 \u0645\u0633\u062C\u0644",
  "\u0639\u0645\u064A\u0644 \u0627\u0644\u0635\u064A\u062F\u0644\u064A\u0629"
]);
function customerIdentityText(value) {
  return String(value ?? "").trim();
}
function isMeaningfulCustomerIdentityText(value) {
  return !INVALID_TEXT_VALUES.has(customerIdentityText(value).toLowerCase());
}
function normalizeCustomerCode(value) {
  const raw = customerIdentityText(value).replace(/^code:/i, "").trim();
  return isMeaningfulCustomerIdentityText(raw) ? raw : "";
}
function normalizeEgyptianCustomerPhone(value) {
  let digits = customerIdentityText(value).replace(/[٠-٩]/g, (digit) => String("\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669".indexOf(digit))).replace(/\D/g, "");
  if (digits.startsWith("0020")) digits = `0${digits.slice(4)}`;
  else if (digits.startsWith("20") && digits.length === 12) digits = `0${digits.slice(2)}`;
  else if (digits.length === 10 && /^1[0125]\d{8}$/.test(digits)) digits = `0${digits}`;
  return digits;
}
function isValidEgyptianCustomerMobile(value) {
  return /^01[0125]\d{8}$/.test(normalizeEgyptianCustomerPhone(value));
}
function isCustomerIdentityUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    customerIdentityText(value)
  );
}
function normalizeDawaaCustomerCode(value) {
  return normalizeCustomerCode(value).replace(/\.0+$/, "");
}
function extractTrailingCustomerCodeFromDisplayName(value) {
  const raw = customerIdentityText(value).replace(/[٠-٩]/g, (digit) => String("\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669".indexOf(digit))).trim();
  const match = raw.match(/(?:^|[^0-9])(\d{2,9})\s*\)?\s*$/);
  if (!match) return "";
  const digits = match[1];
  if (digits.length >= 10 || /^01[0125]\d{8}$/.test(digits)) return "";
  return normalizeDawaaCustomerCode(digits);
}

// src/lib/branch.ts
var UNKNOWN_BRANCH = "\u063A\u064A\u0631 \u0645\u062D\u062F\u062F";
var ALL_BRANCHES = "\u0643\u0644 \u0627\u0644\u0641\u0631\u0648\u0639";
var SHOKRY_BRANCH = "\u0641\u0631\u0639 \u0634\u0643\u0631\u064A";
var SHAMY_BRANCH = "\u0641\u0631\u0639 \u0627\u0644\u0634\u0627\u0645\u064A";
function normalizeArabicText(value) {
  return String(value || "").trim().replace(/[\u064B-\u065F\u0640]/g, "").replace(/[\u0623\u0625\u0622]/g, "\u0627").replace(/\u0649/g, "\u064A").replace(/\u0629/g, "\u0647").replace(/\s+/g, " ").toLowerCase();
}
function normalizeBranchName(value) {
  const text = String(value || "").trim();
  const normalized = normalizeArabicText(text);
  if (!normalized) return UNKNOWN_BRANCH;
  if (/all|every|branches/i.test(normalized) || normalized.includes("\u0643\u0644") || normalized.includes("\u0627\u0644\u0643\u0644")) {
    return ALL_BRANCHES;
  }
  if (/shokry|shukri|shkri|shoukry|shoukri|abou\s*el\s*azm|abo\s*el\s*azm/i.test(normalized) || normalized.includes("\u0634\u0643\u0631\u064A") || normalized.includes("\u0627\u0644\u0639\u0632\u0645")) {
    return SHOKRY_BRANCH;
  }
  if (/shamy|shami|elshamy|el shamy|alshamy|al shamy|elshami|el shami/i.test(normalized) || normalized.includes("\u0627\u0644\u0634\u0627\u0645\u064A") || normalized.includes("\u0634\u0627\u0645\u064A")) {
    return SHAMY_BRANCH;
  }
  return text;
}

// src/lib/invoices/invoiceCore.ts
var EGYPTIAN_BRANCHES = [
  {
    canonical: "\u0641\u0631\u0639 \u0634\u0643\u0631\u064A",
    aliases: [/شكري/i, /شكرى/i, /shokry/i, /shoukry/i]
  },
  {
    canonical: "\u0641\u0631\u0639 \u0627\u0644\u0634\u0627\u0645\u064A",
    aliases: [/الشامي/i, /الشامى/i, /shamy/i, /shami/i]
  }
];
function cleanText(value) {
  return String(value ?? "").trim();
}
function normalizeInvoiceDigits(value) {
  return value.replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 1632)).replace(/[\u06F0-\u06F9]/g, (digit) => String(digit.charCodeAt(0) - 1776));
}
function parseInvoiceAmount(value) {
  if (value === null || value === void 0 || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const normalized = normalizeInvoiceDigits(cleanText(value)).replace(/[,،\s]/g, "").replace(/[٫]/g, ".").replace(/جنيه|ج\.م|egp/gi, "").replace(/[^0-9.-]/g, "");
  const amount = Number.parseFloat(normalized);
  return Number.isFinite(amount) ? amount : null;
}
function excelSerialToInvoiceDate(serial) {
  if (!Number.isFinite(serial) || serial <= 0) return null;
  const excelEpoch = Date.UTC(1899, 11, 30);
  const date = new Date(excelEpoch + Math.round(serial * 864e5));
  const year = date.getUTCFullYear();
  if (year < 1900 || year > 2100) return null;
  return date;
}
function parseInvoiceDateTime(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === "number") {
    return excelSerialToInvoiceDate(value)?.toISOString() ?? null;
  }
  const text = cleanText(value);
  if (!text) return null;
  if (/^\d+(\.\d+)?$/.test(text)) {
    const serial = Number.parseFloat(text);
    if (serial > 4e4 && serial < 6e4) {
      return excelSerialToInvoiceDate(serial)?.toISOString() ?? null;
    }
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) {
      const year = parsed.getUTCFullYear();
      if (year >= 2e3 && year <= 2100) return parsed.toISOString();
    }
  }
  const egyptian = text.match(
    /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/
  );
  if (egyptian) {
    const [, dayText, monthText, yearText, hourText = "0", minuteText = "0", secondText = "0"] = egyptian;
    const year = Number(yearText.length === 2 ? `20${yearText}` : yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const hour = Number(hourText);
    const minute = Number(minuteText);
    const second = Number(secondText);
    if (year < 2e3 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
      return null;
    }
    const parsed = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    if (!Number.isNaN(parsed.getTime()) && parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day) {
      return parsed.toISOString();
    }
    return null;
  }
  const fallback = new Date(text);
  if (!Number.isNaN(fallback.getTime())) {
    const year = fallback.getUTCFullYear();
    if (year >= 2e3 && year <= 2100) return fallback.toISOString();
  }
  return null;
}
function firstValue(row, keys) {
  for (const key of keys) {
    const value = row[key];
    if (value !== void 0 && value !== null && cleanText(value) !== "") return value;
  }
  return null;
}
function getInvoiceAmount(row) {
  const value = firstValue(row, [
    "net_amount",
    "net_total",
    "total_amount",
    "amount",
    "gross_amount",
    "discounted_amount"
  ]);
  return parseInvoiceAmount(value) ?? 0;
}
function getInvoiceId(row) {
  return cleanText(firstValue(row, ["invoice_number", "invoice_no", "id"]));
}
function getInvoiceBranch(row, fallback = "\u063A\u064A\u0631 \u0645\u062D\u062F\u062F") {
  const raw = cleanText(firstValue(row, ["branch_name", "branch"])) || fallback;
  const normalized = normalizeBranchName(raw);
  for (const branch of EGYPTIAN_BRANCHES) {
    if (branch.aliases.some((alias) => alias.test(raw) || alias.test(normalized))) {
      return branch.canonical;
    }
  }
  return normalized || raw || fallback;
}

// src/lib/supabase.ts
import { createClient } from "@supabase/supabase-js";
var supabaseUrl = process.env.VITE_SUPABASE_URL;
var supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
var hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey);
var AUTH_STORAGE_KEY = "dawaa_auth_user_v2";
function readStoredUserId() {
  if (typeof window === "undefined" || typeof localStorage === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const candidate = [parsed.id, parsed.staff_id, parsed.username].find((value) => typeof value === "string" && value.trim().length > 0);
    if (typeof candidate !== "string") return null;
    const normalized = candidate.trim();
    return normalized.length <= 160 ? normalized : null;
  } catch {
    return null;
  }
}
var supabaseFetch = (input, init) => {
  const headers = new Headers(init?.headers);
  const userId = readStoredUserId();
  if (userId) headers.set("x-dawaa-user-id", userId);
  return fetch(input, { ...init, headers });
};
function createStubClient() {
  const noop = () => stubQuery;
  const stubResult = { data: [], error: null };
  const stubQuery = {
    // Mirror PostgREST's chainable/awaitable query builder closely enough for dev/test paths:
    // select(...).ilike(...).limit(...) and plain await select(...) must both work.
    select: () => stubQuery,
    then: (resolve, reject) => Promise.resolve(stubResult).then(resolve, reject),
    ilike: () => stubQuery,
    insert: async () => ({ data: null, error: null }),
    update: async () => ({ data: null, error: null }),
    delete: async () => ({ data: null, error: null }),
    upsert: async () => ({ data: null, error: null }),
    eq: () => stubQuery,
    order: () => stubQuery,
    limit: () => stubQuery,
    range: () => stubQuery,
    single: async () => ({ data: null, error: null }),
    maybeSingle: async () => ({ data: null, error: null }),
    is: () => stubQuery,
    or: () => stubQuery,
    match: () => stubQuery,
    filter: () => stubQuery,
    on: () => ({ subscribe: () => ({ unsubscribe: () => null }) })
  };
  return {
    from: () => stubQuery,
    rpc: async () => ({ data: null, error: null }),
    auth: {
      signIn: async () => ({ data: null, error: null }),
      signOut: async () => ({ error: null }),
      user: () => null,
      onAuthStateChange: () => ({ data: null })
    },
    storage: {
      from: () => ({ upload: async () => ({ data: null, error: null }) })
    }
  };
}
var supabase = hasSupabaseConfig ? createClient(hasSupabaseConfig ? supabaseUrl : "https://placeholder.supabase.co", hasSupabaseConfig ? supabaseAnonKey : "placeholder-anon-key", {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  realtime: { params: { eventsPerSecond: 10 } },
  global: { fetch: supabaseFetch }
}) : createStubClient();

// src/lib/readModels/invoiceRecordReadModel.ts
var SALES_INTELLIGENCE_INVOICE_SELECT = [
  "id",
  "invoice_number",
  "invoice_no",
  "invoice_datetime",
  "close_datetime",
  "invoice_date",
  "sale_date",
  "net_total",
  "total_amount",
  "net_amount",
  "amount",
  "gross_amount",
  "discount_amount",
  "branch",
  "branch_name",
  "customer_id",
  "customer_code",
  "customer_phone",
  "whatsapp_phone",
  "customer_name",
  "seller_name",
  "normalized_seller_name",
  "staff_id",
  "staff_name",
  "delivery_staff"
].join(",");
async function readInvoiceRecordById(invoiceId2, client = supabase) {
  const { data, error } = await client.from("sales_invoices").select(SALES_INTELLIGENCE_INVOICE_SELECT).eq("id", invoiceId2).maybeSingle();
  if (error) throw error;
  return data ?? null;
}
async function readInvoiceRecordsByIdentityWindow(args) {
  const client = args.client || supabase;
  const { data, error } = await client.from("sales_invoices").select(SALES_INTELLIGENCE_INVOICE_SELECT).gte("invoice_datetime", args.windowStartIso).lte("invoice_datetime", args.windowEndIso).eq(args.column, args.value).limit(args.limit);
  if (error) throw error;
  return data || [];
}
async function readInvoiceRecordsByCustomerWindow(args) {
  const client = args.client || supabase;
  let query = client.from("sales_invoices").select(SALES_INTELLIGENCE_INVOICE_SELECT).gte("invoice_datetime", args.queryStartIso).lte("invoice_datetime", args.queryEndIso).limit(args.limit ?? 100);
  if (args.customerCode) query = query.eq("customer_code", args.customerCode);
  else if (args.customerId) query = query.eq("customer_id", args.customerId);
  else return [];
  if (args.branch) query = query.eq("branch", args.branch);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

// src/lib/salesIntelligence/invoiceCandidateRetrieval.ts
var CANDIDATE_RETRIEVAL_TIME_WINDOW = {
  beforeCaseStartHours: 24,
  afterCaseEndHours: 168
};
var CANDIDATE_RETRIEVAL_MAX_ROWS = 200;
function buildInvoiceCandidateQuery(context) {
  const startMs = new Date(context.caseStartedAt).getTime();
  const endMsRaw = context.caseEndedAt ? new Date(context.caseEndedAt).getTime() : NaN;
  const endMs = Number.isFinite(endMsRaw) ? Math.max(endMsRaw, startMs) : startMs;
  const windowStart = new Date(startMs - CANDIDATE_RETRIEVAL_TIME_WINDOW.beforeCaseStartHours * 36e5);
  const windowEnd = new Date(endMs + CANDIDATE_RETRIEVAL_TIME_WINDOW.afterCaseEndHours * 36e5);
  const normalizedPhone = context.customerPhone ? normalizeEgyptianCustomerPhone(context.customerPhone) : "";
  const customerPhoneNormalized = isValidEgyptianCustomerMobile(normalizedPhone) ? normalizedPhone : null;
  return {
    caseId: context.caseId,
    customerId: context.customerId,
    customerPhoneNormalized,
    branchNameRaw: context.branchNameRaw,
    windowStartIso: windowStart.toISOString(),
    windowEndIso: windowEnd.toISOString(),
    limit: CANDIDATE_RETRIEVAL_MAX_ROWS
  };
}
async function fetchInvoiceCandidates(supabaseClient, query) {
  if (!query.customerId && !query.customerPhoneNormalized) return [];
  async function fetchByIdentity(column, value) {
    return await readInvoiceRecordsByIdentityWindow({
      column,
      value,
      windowStartIso: query.windowStartIso,
      windowEndIso: query.windowEndIso,
      limit: query.limit,
      client: supabaseClient
    });
  }
  const lookups = [];
  if (query.customerId) {
    lookups.push(fetchByIdentity("customer_id", query.customerId));
  }
  if (query.customerPhoneNormalized) {
    lookups.push(fetchByIdentity("customer_phone", query.customerPhoneNormalized));
    lookups.push(fetchByIdentity("whatsapp_phone", query.customerPhoneNormalized));
  }
  const resultSets = await Promise.all(lookups);
  const merged = /* @__PURE__ */ new Map();
  let fallbackIndex = 0;
  for (const rows of resultSets) {
    for (const row of rows) {
      const record = row;
      const rawId = String(record.id ?? "").trim();
      const invoiceId2 = getInvoiceId(row);
      const invoiceDatetime = String(record.invoice_datetime ?? "").trim();
      const branch = String(record.branch ?? record.branch_name ?? "").trim();
      const stableKey = rawId || (invoiceId2 ? `${invoiceId2}|${invoiceDatetime}|${branch}` : "") || `fallback:${fallbackIndex++}`;
      if (!merged.has(stableKey)) merged.set(stableKey, row);
      if (merged.size >= query.limit) return Array.from(merged.values());
    }
  }
  return Array.from(merged.values());
}

// src/lib/whatsappConversationParser.ts
var STAFF_INTRO_PATTERNS = [
  /مع حضرتك\s+(?:د\.?|دكتور(?:ة)?|دكتوره)\s*([^\n،,.]+)/i,
  /معاك(?:ي)?\s+(?:د\.?|دكتور(?:ة)?|دكتوره)\s*([^\n،,.]+)/i,
  /(?:د\.?|دكتور(?:ة)?|دكتوره)\s+([^\n،,.]+)\s+من\s+(?:خدمة عملاء|صيدليات)\s+دواء/i
];
var PHARMACY_TEXT_RX = /(صيدليات دواء|مع حضرتك|تحت امر حضرتك|تحت أمر حضرتك|تم تأكيد الطلب|جاري الارسال|جاري الإرسال)/i;
var MEDIA_KIND_SET = /* @__PURE__ */ new Set(["image", "voice", "video", "document"]);
function normalizeYear(raw) {
  return raw < 100 ? 2e3 + raw : raw;
}
function normalizeMeridiem(raw) {
  const value = String(raw || "").trim().toLowerCase();
  if (value === "pm" || value === "\u0645") return "pm";
  if (value === "am" || value === "\u0635") return "am";
  return "";
}
function resolveDayMonth(a, b, year) {
  if (a > 12 && b <= 12) return { day: a, month: b };
  if (b > 12 && a <= 12) return { day: b, month: a };
  if (String(year).length === 4 && a >= 13) return { day: a, month: b };
  return { day: b, month: a };
}
function parsePrefix(line) {
  const normalized = line.replace(/^\u200e/, "");
  const patterns = [
    /^\[?(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([APap][Mm]|[صم])?\]?\s*[-–]?\s*(.*)$/,
    /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([APap][Mm]|[صم])?\s*[-–]\s*(.*)$/
  ];
  for (const rx of patterns) {
    const match = normalized.match(rx);
    if (!match) continue;
    const first = Number(match[1]);
    const second = Number(match[2]);
    const rawYear = Number(match[3]);
    const year = normalizeYear(rawYear);
    const { day, month } = resolveDayMonth(first, second, rawYear);
    return {
      day,
      month,
      year,
      hour: Number(match[4]),
      minute: Number(match[5]),
      second: Number(match[6] || 0),
      meridiem: normalizeMeridiem(match[7] || ""),
      rest: match[8] || "",
      rawTimestamp: `${match[1]}/${match[2]}/${match[3]}, ${match[4]}:${match[5]}${match[6] ? `:${match[6]}` : ""}${match[7] ? ` ${match[7]}` : ""}`
    };
  }
  return null;
}
function timestampFromPrefix(prefix) {
  let hour = prefix.hour;
  if (prefix.meridiem === "pm" && hour < 12) hour += 12;
  if (prefix.meridiem === "am" && hour === 12) hour = 0;
  const date = new Date(
    prefix.year,
    prefix.month - 1,
    prefix.day,
    hour,
    prefix.minute,
    prefix.second
  );
  return Number.isNaN(date.getTime()) ? null : date;
}
function detectKind(text) {
  const value = text.toLowerCase();
  if (/(messages and calls are end-to-end encrypted|created group|added you|changed the subject|security code changed)/i.test(text)) return "system";
  if (/<voice message omitted>|audio omitted|صوت محذوف|\[voice message\]|\.(?:opus|ogg|mp3|m4a|wav)(?:\s|$|\))/i.test(
    text
  ))
    return "voice";
  if (/<image omitted>|image omitted|صورة محذوفة|\[image\]|\.(?:jpe?g|png|webp|gif|heic)(?:\s|$|\))/i.test(
    text
  ))
    return "image";
  if (/<video omitted>|video omitted|فيديو محذوف|\[video\]|\.(?:mp4|mov)(?:\s|$|\))/i.test(text))
    return "video";
  if (/<document omitted>|document omitted|مستند محذوف|\[document\]|\[file\]|\.(?:pdf|docx?|xlsx?)(?:\s|$|\))/i.test(
    text
  ))
    return "document";
  if (/you deleted this message|this message was deleted|تم حذف هذه الرسالة/i.test(value))
    return "deleted";
  if (/omitted>|محذوف/i.test(value)) return "unknown";
  return "text";
}
function hasMediaPlaceholder(text, kind) {
  return MEDIA_KIND_SET.has(kind) && /(omitted>|\[(?:voice message|image|video|document|file)\]|<attached:|\.(?:jpe?g|png|webp|gif|heic|opus|ogg|mp3|m4a|wav|mp4|mov|pdf|docx?|xlsx?))/i.test(
    text
  );
}
function messageId(index, timestamp, sender) {
  return `${timestamp.getTime()}-${index}-${sender}`;
}
function isExplicitOutboundSender(sender) {
  const value = sender.trim().toLowerCase();
  return value === "you" || value === "me" || value === "\u0623\u0646\u062A" || value === "\u0627\u0646\u062A" || value === "\u0623\u0646\u0627" || value === "\u0627\u0646\u0627";
}
function inferPharmacySender(messages) {
  const nonSystem = messages.filter((m) => m.direction !== "system");
  const senders = Array.from(new Set(nonSystem.map((m) => m.sender)));
  let best = null;
  for (const sender of senders) {
    const owned = nonSystem.filter((m) => m.sender === sender);
    let score = 0;
    for (const message of owned) {
      if (STAFF_INTRO_PATTERNS.some((rx) => rx.test(message.text))) score += 8;
      if (PHARMACY_TEXT_RX.test(message.text)) score += 2;
    }
    if (!best || score > best.score) best = { sender, score };
  }
  return best && best.score >= 4 ? best.sender : null;
}
function finalizeDirections(messages) {
  const humans = messages.filter(
    (message) => message.kind !== "system" && message.direction !== "system"
  );
  if (!humans.some((m) => m.direction === "outbound")) {
    const pharmacySender = inferPharmacySender(humans);
    if (pharmacySender)
      humans.forEach((m) => {
        m.direction = m.sender === pharmacySender ? "outbound" : "inbound";
      });
  }
  return humans;
}
function parseTextExport(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const messages = [];
  let current = null;
  for (const line of lines) {
    const prefix = parsePrefix(line);
    if (prefix) {
      if (current) messages.push(current);
      const timestamp = timestampFromPrefix(prefix);
      if (!timestamp) {
        current = null;
        continue;
      }
      const speakerMatch = prefix.rest.match(/^([^:]{1,100}):\s?([\s\S]*)$/);
      if (!speakerMatch) {
        current = {
          id: messageId(messages.length, timestamp, "system"),
          timestamp,
          rawTimestamp: prefix.rawTimestamp,
          sender: "system",
          text: prefix.rest.trim(),
          direction: "system",
          kind: "system",
          forwarded: false,
          raw: line,
          sourceFormat: "txt",
          replyTo: null,
          mediaPlaceholder: false,
          mediaAvailable: false
        };
        continue;
      }
      const sender = speakerMatch[1].trim();
      const body = speakerMatch[2] || "";
      const kind = detectKind(body);
      current = {
        id: messageId(messages.length, timestamp, sender),
        timestamp,
        rawTimestamp: prefix.rawTimestamp,
        sender,
        text: body,
        direction: isExplicitOutboundSender(sender) ? "outbound" : "inbound",
        kind,
        forwarded: /^\[?forwarded\]?|تمت إعادة توجيه/i.test(body.trim()),
        raw: line,
        sourceFormat: "txt",
        replyTo: null,
        mediaPlaceholder: hasMediaPlaceholder(body, kind),
        mediaAvailable: false
      };
      continue;
    }
    if (current) {
      current.text += `${current.text ? "\n" : ""}${line}`;
      current.raw += `
${line}`;
      current.kind = detectKind(current.text);
      current.mediaPlaceholder = hasMediaPlaceholder(current.text, current.kind);
    }
  }
  if (current) messages.push(current);
  finalizeDirections(messages);
  return messages;
}
var MONTHS = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12
};
function parseMarkdownDateHeading(line) {
  const match = line.trim().match(/^##\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})\s*$/);
  if (!match) return null;
  const month = MONTHS[match[1].toLowerCase()];
  if (!month) return null;
  return { year: Number(match[3]), month, day: Number(match[2]) };
}
function parseMarkdownClockSeconds(raw) {
  const match = raw.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([APap][Mm])$/);
  if (!match) return null;
  let hour = Number(match[1]);
  const meridiem = match[4].toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  return hour * 3600 + Number(match[2]) * 60 + Number(match[3] || 0);
}
function parseMarkdownTime(raw, date) {
  const match = raw.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([APap][Mm])$/);
  if (!match) return null;
  let hour = Number(match[1]);
  const meridiem = match[4].toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  const timestamp = new Date(
    date.year,
    date.month - 1,
    date.day,
    hour,
    Number(match[2]),
    Number(match[3] || 0)
  );
  return Number.isNaN(timestamp.getTime()) ? null : timestamp;
}
function parseMarkdownReply(lines) {
  const quoteLines = lines.filter((line) => /^>\s?/.test(line.trim()));
  if (!quoteLines.length) return null;
  const combined = quoteLines.map((line) => line.trim().replace(/^>\s?/, "")).join("\n").trim();
  const italic = combined.match(/^_([^:]{1,100}):\s*([\s\S]*?)_$/);
  if (italic)
    return { sender: italic[1].trim(), text: italic[2].trim() };
  const plain = combined.match(/^([^:]{1,100}):\s*([\s\S]*)$/);
  if (plain)
    return {
      sender: plain[1].trim(),
      text: plain[2].trim().replace(/^_|_$/g, "")
    };
  return { sender: null, text: combined.replace(/^_|_$/g, "") };
}
function trustedDateParts(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}
function parseMarkdownExport(text, trustedConversationStartedAt) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const messages = [];
  let currentDate = trustedDateParts(trustedConversationStartedAt);
  const trustedAnchor = trustedConversationStartedAt ? trustedConversationStartedAt instanceof Date ? trustedConversationStartedAt : new Date(trustedConversationStartedAt) : null;
  let usingTrustedTimeOnlyTimeline = Boolean(trustedAnchor && !Number.isNaN(trustedAnchor.getTime()));
  let firstClockSeconds = null;
  let previousAbsoluteClockSeconds = null;
  let current = null;
  const flush = () => {
    if (!current) return;
    const allBody = [current.initialBody, ...current.bodyLines].join("\n").trim();
    const replyTo = parseMarkdownReply(current.bodyLines);
    const bodyLines = current.bodyLines.filter((line) => !/^>\s?/.test(line.trim()));
    const body = [current.initialBody, ...bodyLines].join("\n").trim();
    const kind = detectKind(body || allBody);
    const sender = current.sender.trim();
    messages.push({
      id: messageId(messages.length, current.timestamp, sender),
      timestamp: current.timestamp,
      rawTimestamp: current.rawTimestamp,
      sender,
      text: body,
      direction: isExplicitOutboundSender(sender) ? "outbound" : "inbound",
      kind,
      forwarded: /^\[forwarded\]/i.test(body),
      raw: current.rawLines.join("\n"),
      sourceFormat: "md",
      replyTo,
      mediaPlaceholder: hasMediaPlaceholder(body || allBody, kind),
      mediaAvailable: false
    });
    current = null;
  };
  for (const line of lines) {
    const dateHeading = parseMarkdownDateHeading(line);
    if (dateHeading) {
      flush();
      currentDate = dateHeading;
      usingTrustedTimeOnlyTimeline = false;
      firstClockSeconds = null;
      previousAbsoluteClockSeconds = null;
      continue;
    }
    if (!currentDate) continue;
    const header = line.match(
      /^\[(\d{1,2}:\d{2}(?::\d{2})?\s*[APap][Mm])\]\s+\*\*([^*]{1,100}):\*\*\s?(.*)$/
    );
    if (header) {
      flush();
      let timestamp = null;
      if (usingTrustedTimeOnlyTimeline && trustedAnchor) {
        const clockSeconds = parseMarkdownClockSeconds(header[1]);
        if (clockSeconds != null) {
          if (firstClockSeconds == null) {
            firstClockSeconds = clockSeconds;
            previousAbsoluteClockSeconds = clockSeconds;
            timestamp = new Date(trustedAnchor.getTime());
          } else {
            let absoluteClockSeconds = clockSeconds;
            while (previousAbsoluteClockSeconds != null && absoluteClockSeconds < previousAbsoluteClockSeconds) {
              absoluteClockSeconds += 24 * 3600;
            }
            previousAbsoluteClockSeconds = absoluteClockSeconds;
            timestamp = new Date(trustedAnchor.getTime() + (absoluteClockSeconds - firstClockSeconds) * 1e3);
          }
        }
      } else {
        timestamp = parseMarkdownTime(header[1], currentDate);
      }
      if (!timestamp) continue;
      current = {
        timestamp,
        rawTimestamp: `${currentDate.year}-${String(currentDate.month).padStart(2, "0")}-${String(currentDate.day).padStart(2, "0")} ${header[1]}`,
        sender: header[2],
        initialBody: header[3] || "",
        bodyLines: [],
        rawLines: [line]
      };
      continue;
    }
    if (current) {
      current.bodyLines.push(line);
      current.rawLines.push(line);
    }
  }
  flush();
  finalizeDirections(messages);
  return messages;
}
function detectWhatsAppExportFormat(text) {
  const head = text.slice(0, 5e3);
  if (/^# WhatsApp Chat Export:/m.test(head) || /^##\s+[A-Za-z]+\s+\d{1,2},\s+\d{4}$/m.test(head) || /^\[\d{1,2}:\d{2}(?::\d{2})?\s*[APap][Mm]\]\s+\*\*[^*]{1,100}:\*\*/m.test(head)) return "md";
  return "txt";
}
function rebaseTextTimelineToTrustedStart(messages, trustedConversationStartedAt) {
  if (!messages.length || !trustedConversationStartedAt) return messages;
  const trusted = new Date(trustedConversationStartedAt);
  if (Number.isNaN(trusted.getTime())) return messages;
  const delta = trusted.getTime() - messages[0].timestamp.getTime();
  if (!Number.isFinite(delta) || delta === 0) return messages;
  return messages.map((message, index) => {
    const timestamp = new Date(message.timestamp.getTime() + delta);
    return { ...message, timestamp, id: messageId(index, timestamp, message.sender) };
  });
}
function parseWhatsAppExport(text, options = {}) {
  if (detectWhatsAppExportFormat(text) === "md") {
    return parseMarkdownExport(text, options.trustedConversationStartedAt);
  }
  return rebaseTextTimelineToTrustedStart(parseTextExport(text), options.trustedConversationStartedAt);
}
function extractIntroducedStaffName(message) {
  if (message.direction !== "outbound") return null;
  for (const pattern of STAFF_INTRO_PATTERNS) {
    const match = message.text.match(pattern);
    if (match?.[1]) return match[1].trim().replace(/\s+/g, " ");
  }
  return null;
}
function extractStaffNames(messages) {
  const names = /* @__PURE__ */ new Set();
  for (const message of messages.filter((m) => m.direction === "outbound")) {
    const name = extractIntroducedStaffName(message);
    if (name) names.add(name);
  }
  return [...names];
}
function buildSession(messages, index) {
  const first = messages[0];
  const last = messages[messages.length - 1];
  const mediaKinds = messages.reduce(
    (acc, message) => {
      acc[message.kind] = (acc[message.kind] || 0) + 1;
      return acc;
    },
    {}
  );
  const mediaCount = messages.filter((m) => MEDIA_KIND_SET.has(m.kind)).length;
  const missingMediaCount = messages.filter(
    (m) => MEDIA_KIND_SET.has(m.kind) && !m.mediaAvailable
  ).length;
  const participants = Array.from(
    new Set(messages.filter((m) => m.direction !== "system").map((m) => m.sender))
  );
  const inboundSender = messages.find((m) => m.direction === "inbound")?.sender || null;
  return {
    id: `${first.timestamp.getTime()}-${index}`,
    startedAt: first.timestamp,
    endedAt: last.timestamp,
    messages,
    participants,
    outboundStaffNames: extractStaffNames(messages),
    customerName: inboundSender,
    mediaCount,
    mediaKinds,
    missingMediaCount,
    replyCount: messages.filter((m) => Boolean(m.replyTo?.text)).length,
    forwardedCount: messages.filter((m) => m.forwarded).length
  };
}
function splitWhatsAppSessions(messages, gapMinutes = 120) {
  const humans = messages.filter((m) => m.direction !== "system" && m.kind !== "system");
  if (!humans.length) return [];
  const sorted = humans.slice().sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const groups = [];
  let current = [];
  for (const message of sorted) {
    const previous = current[current.length - 1];
    const gap = previous ? (message.timestamp.getTime() - previous.timestamp.getTime()) / 6e4 : 0;
    if (current.length && gap > gapMinutes) {
      groups.push(current);
      current = [];
    }
    current.push(message);
  }
  if (current.length) groups.push(current);
  return groups.map((group, index) => buildSession(group, index));
}

// src/lib/whatsappSemanticSignalsV32.ts
var GREETING_ONLY_RX = /^(?:و)?(?:ال)?سلام\s*عليكم(?:\s*(?:و)?رحمة?\s*الله(?:\s*(?:و)?بركاته)?)?[!.، ]*$|^أهل[اً]?\s*(?:و\s*سهل[اً]?)?[!.، ]*$|^مرحب[اً]?[!.، ]*$|^ه?اي[!.، ]*$|^صباح\s*ال(?:خير|نور|فل|ورد)[!.، ]*$|^مساء\s*ال(?:خير|نور|فل|ورد)[!.، ]*$/i;
var AUTOMATED_REPLY_RX = /رسال[ةه]\s*(آلي[ةه]|تلقائي[ةه])|رد\s*تلقائي|هذه\s*رساله\s*تلقائيه|out\s*of\s*office|automated\s*reply|بعيد[ًا]?\s*عن\s*مكتبي|خارج\s*مواعيد\s*العمل\s*الرسمي[ةه]?\s*نرد\s*عليك/i;
var REQUEST_VERB_RX = /محتاج|عايز|عاوز|ممكن\s+(?:اطلب|اخد|احصل)|هات(?:ي)?\s|ابعت(?:لي|يلي)/i;
var CLARIFICATION_MARK_RX = /[؟?]/;
var EXPLICIT_CONFIRMATION_RX = /تم\s*تأكيد\s*الطلب|تم\s*تسجيل(?:\s*طلبك)?|تسجيل\s*طلبك|الأورد?ر\s*اتأكد|تم\s*الطلب|تمام\s*سجلت\s*لحضرتك|تم\s*ال[اإ]رسال/i;
var STRONG_IMPLICIT_CONFIRMATION_RX = /(?:من\s*)?عني?ا(؟)?\s*(?:حاضر|لحضرتك)?|حاضر\s*(?:هبعت(?:هم|ه)?|هيكون\s*عند\s*حضرتك)|تمام\s*هيتبعت|تمام\s*يا\s*فندم\s*جاري\s*(?:التجهيز|ال[اإ]رسال)|جاري\s*(?:التجهيز|ال[اإ]رسال)|هبعت(?:لك|له|لحضرتك|هم)/i;
var WEAK_IMPLICIT_RX = /^(?:تمام|حاضر|اوك|ok|ماشي|خلاص)[!.، ]*$/i;
var ACCEPTANCE_RX = /^(?:تمام|ماشي|ايوا|ايوه|اه|آه|موافق|تمام\s*كده|خلاص\s*ابعت(?:ه|هم|يه|يهم)?)[!.، ]*$|(?:تمام|ايوا|ايوه|اه|آه)[،, ]*\s*(?:هطلبه|ابعت(?:ه|هم|يه|يهم)?|يبقى\s*كده)/i;
var REJECTION_RX = /^(?:لا|لأ)[!.، ]*$|مش\s*عايز(?:ه)?|معلش\s*مش\s*هاخد(?:ه|ها)?|مش\s*محتاج(?:ه)?/i;
var THANKS_CLOSING_ONLY_RX = /^(?:شكرًا|شكرا)(?:\s*لحضرتك)?[!.، ]*$|^لا\s*شكرا[!.، ]*$|^تسلم(?:ي|لي)?[!.، ]*$|^الله\s*يسلم(?:ك|ي)?[!.، ]*$|^وصل(?:ني|تلي)?[!.، ]*$/i;
var CORRECTION_RX = /لا\s*قصدي|مش\s*ده(?:\s*اللي)?|ده\s*مش(?:\s*اللي)?|أنا\s*(?:أ|ا)قصد|لا\s*التاني\b|مش\s*كده|لا\s*حضرتك\s*فهمتني\s*غلط|أنا\s*قلت|فهمت\s*غلط/i;
var QUANTITY_RX = /(\d+|واحد[ةه]?|اتنين|تلات[ةه]?|أربع[ةه]?|خمس[ةه]?)\s*(علبة|علب|حبة|حبوب|شريط|عبوة|قطعة|كيس)/i;
var REFERENCE_QUANTITY_RX = /(?:منه|من\s*ده|من\s*دا)\s*(اتنين|تلات[ةه]?|أربع[ةه]?|خمس[ةه]?|\d+)|(\d+|اتنين|تلات[ةه]?)\s*منه/i;
var PHONE_RX = /01[0-2,5]\d{8}/;
var ADDRESS_RX = /العنوان\s*[:\-]?\s*\S+|عنوانك|هيوصل\s*ل(?:ـ|حضرتك)/i;
var PRICE_RX = /(\d+(?:\.\d+)?)\s*(جنيه|جنيها|ج\.?م\.?|le|egp)/i;
var DELIVERY_RX = /توصيل|دليفري|delivery/i;
var PROMISE_RX = /هبعت(?:لك|لحضرتك)?|هيوصل|هجهز(?:لك|لحضرتك)?|هوصلك/i;
var UNAVAILABLE_RX = /(?:مش|مو|غير)\s*(?:موجود|متوفر|متاح)[ةه]?|مفيش\s*(?:منه|منها|حاليا|حاليًا|عندنا)|مش\s*عندنا|(?:الصنف|المنتج|ده|دي|هو|هي)\s*(?:خلص|خلصان[ةه]?|نفذ|ناقص[ةه]?)|(?:خلص|نفذ|ناقص[ةه]?)\s*(?:من\s*(?:عندنا|السوق|الشركة)|حاليا|حاليًا)|ناقص\s*في\s*السوق/i;
var AVAILABLE_RX = /(?:^|[\s،,])(?:موجود|متوفر|متاح)[ةه]?(?:$|[\s،,!.])|عندنا\s*(?:منه|منها)|(?:اه|أه|آه|ايوه|أيوه|ايوا)\s*(?:موجود|متوفر)/i;
var CHECK_PENDING_RX = /(?:ثواني|ثانية|لحظ[ةه]|دقيق[ةه]|دقايق)\s*(?:و\s*)?(?:أ|ا)?(?:شوف|تأكد|اتأكد|سأل|راجع)|هشوف(?:لك|لحضرتك)?|هتأكد|هاتأكد|هسأل\s*(?:الفرع|المخزن|عن\s*(?:التوفر|توفره|توفرها))|هنشوف(?:ه|ها)?|(?:أ|ا)تأكد\s*من\s*(?:توفر|التوفر|المخزن)|هراجع\s*(?:المخزن|التوفر)/i;
var ALTERNATIVE_MARKER_RX = /بديل|بدل\s*(?:منه|منها|منهم|ده|دي|ال\S+)|المتاح\s*بدل|(?:فيه|في|عندنا)\s*نفس\s*(?:المادة|التركيب[ةه]?)|نفس\s*المادة\s*الفعال[ةه]|يقوم\s*بنفس|نبدل(?:ه|ها|هم)?\s/i;
var GENERIC_OFFER_RX = /(?:ممكن|ينفع|نقدر)\s*(?:نجيب|أجيب|اجيب|نديلك|أقدم|اقدم|نقدم|أقترح|اقترح|أرشح|ارشح)(?:لك|لحضرتك)?|(?:أرشح|ارشح|أقترح|اقترح)(?:لك|لحضرتك)/i;
var ALTERNATIVE_PHRASE_FILLER_RX = /^(?:(?:ممكن|ينفع|نقدر|نجيب|أجيب|اجيب|هنجيب|هجيب|نديلك|نديك|نقدم|أقدم|اقدم|أرشح|ارشح|نرشح|لحضرتك|ليك|لك|له|لها|منه|منها|هو|هي|وهو|اسمه|اسمها|يا\s*فندم|بـ)(?=\s|$)|[\s:\-،])+/i;
var ACCEPT_OFFER_RX = /(?:تمام|ماشي|اوك|ok|خلاص|ايوه|ايوا|اه|آه)?\s*(?:هاته|هاتها|هاتهم|هاتيه|ابعته|ابعتها|ابعتهم|خليه|خليها|هاخده|هاخدها|موافق)/i;
var CONSIDERING_RX = /هفكر|أفكر|افكر|هشوف\s*و?\s*(?:أرد|ارد|أقولك|اقولك)|هرد\s*عليك|هقولك|هبلغك|هستشير|هسأل\s*(?:الدكتور|دكتور)|بعدين\s*(?:أقولك|اقولك|أرد|ارد)/i;
var PRODUCT_REFERENCE_RX = /(?<![\p{L}\p{N}])(?:ده|دي|دول|منه|منها)(?![\p{L}\p{N}])|واحد\s*من\s*(?:ده|دا)|الاتنين|نفس\s*اللي\s*فات|اللي\s*حضرتك\s*قولت?\s*عليه|البديل\s*ده|(?<![\p{L}\p{N}])التاني(?![\p{L}\p{N}])/iu;
var STAFF_NON_PRODUCT_TEMPLATE_RX = /أهلا\s*وسهلا|نورت(?:نا|ينا)|صيدليات\s*دواء|خدمة\s*التوصيل|على\s*مدار\s*24\s*ساعة|مع\s*حضرتك|تحت\s*أمر\s*حضرتك|تشرفنا\s*بخدمت/i;
function isPlausibleStaffProductOffer(message) {
  if (message.role !== "staff" || !message.isMeaningful) return false;
  const text = message.text.trim();
  if (!text || STAFF_NON_PRODUCT_TEMPLATE_RX.test(text)) return false;
  if (WEAK_IMPLICIT_RX.test(text) || classifyConfirmationStrength(text) !== "none") return false;
  return PRICE_RX.test(text) || /متوفر|موجود|عندنا|بديل|ترشيح|أنسب|افضل|أفضل|سعر|عبوة|علبة|شريط|كبسول|قرص|جل|كريم|شامبو|غسول|سيرم|سيروم|لوشن|spray|cream|gel|shampoo|serum|lotion/i.test(text) || /[A-Za-z]{3,}/.test(text);
}
function isPlausibleCustomerProductMention(message) {
  if (message.role !== "customer" || !message.isMeaningful) return false;
  const text = message.text.trim();
  if (!text) return false;
  if (GREETING_ONLY_RX.test(text) || THANKS_CLOSING_ONLY_RX.test(text) || ACCEPTANCE_RX.test(text) || REJECTION_RX.test(text)) return false;
  const strippedForwarded = text.replace(/^\s*\[?forwarded\]?\s*/i, "").trim();
  if (!strippedForwarded) return false;
  const withoutReference = strippedForwarded.replace(PRODUCT_REFERENCE_RX, "").trim();
  if (!withoutReference || /^(?:موجود|متوفر|عندكم|عايز|عاوز|محتاج|ابعت|هات)(?:\s|$)/iu.test(withoutReference)) return false;
  return /[A-Za-z]{3,}/.test(strippedForwarded) || /\b\d+(?:\.\d+)?\s*(?:mg|mcg|gm|g|ml|%)\b/i.test(strippedForwarded) || /جل|كريم|شامبو|غسول|سيرم|سيروم|لوشن|بخاخ|قطره|قطرة|امبول|أمبول|كبسول|قرص|مرهم|spray|cream|gel|shampoo|serum|lotion|drops?|amp(?:oule)?/i.test(strippedForwarded);
}
function isGreetingOnly(text) {
  return GREETING_ONLY_RX.test((text || "").trim());
}
function isBareAcknowledgementOnly(text) {
  return WEAK_IMPLICIT_RX.test((text || "").trim());
}
function isSubstantiveConfirmationSignal(signal) {
  return signal.confidence >= 0.5;
}
function isAcceptanceOnly(text) {
  return ACCEPTANCE_RX.test((text || "").trim());
}
var COMMITMENT_ONLY_RX = /^(?:(?:تمام|ماشي|اوك|ok|خلاص|ايوه|ايوا|اه|آه|أه|طيب|حلو|موافق)[،,!.\s]*)*(?:هاته|هاتها|هاتهم|هاتيه|هاتيها|ابعته|ابعتها|ابعتهم|ابعتيه|ابعتيها|خليه|خليها|هاخده|هاخدها|هاخدهم|(?:هات|ابعت|ابعتلي|هاتلي)\s*(?:ده|دي|دا|دول|البديل))(?:[،,!.\s]*(?:لو\s*سمحت|من\s*فضلك|يا\s*(?:دكتور[ةه]?|فندم)|بسرعة|خلاص|تمام))*[!.،,\s]*$/i;
function isCommitmentOnly(text) {
  return COMMITMENT_ONLY_RX.test((text || "").trim());
}
function isRejectionOnly(text) {
  return REJECTION_RX.test((text || "").trim());
}
function isThanksOrClosingOnly(text) {
  return THANKS_CLOSING_ONLY_RX.test((text || "").trim());
}
function isRequestCandidate(message) {
  if (message.role !== "customer" || !message.isMeaningful) return false;
  const text = message.text;
  if (isGreetingOnly(text)) return false;
  if (isBareAcknowledgementOnly(text)) return false;
  if (isAcceptanceOnly(text)) return false;
  if (isCommitmentOnly(text)) return false;
  if (isRejectionOnly(text)) return false;
  if (!REQUEST_VERB_RX.test(text) && (isNonRequestIntentStatement(text) || classifyCustomerTimingRequestV32(text))) {
    return false;
  }
  if (isThanksOrClosingOnly(text)) return false;
  return true;
}
function contextWindowV32(messages, index, before = 3, after = 1) {
  const meaningfulIndices = [];
  messages.forEach((m, i) => {
    if (m.isMeaningful) meaningfulIndices.push(i);
  });
  const pos = meaningfulIndices.indexOf(index);
  if (pos === -1) return { before: [], after: [] };
  return {
    before: meaningfulIndices.slice(Math.max(0, pos - before), pos).map((i) => messages[i]),
    after: meaningfulIndices.slice(pos + 1, pos + 1 + after).map((i) => messages[i])
  };
}
function classifyConfirmationStrength(text) {
  if (EXPLICIT_CONFIRMATION_RX.test(text)) return "explicit";
  if (STRONG_IMPLICIT_CONFIRMATION_RX.test(text)) return "strong_implicit";
  if (WEAK_IMPLICIT_RX.test(text.trim())) return "weak_implicit";
  return "none";
}
function isConfirmationContextuallyLinked(messages, index) {
  const { before } = contextWindowV32(messages, index, 3, 0);
  const requestOrQuantity = before.filter((m) => m.role === "customer").reverse().find(
    (m) => REQUEST_VERB_RX.test(m.text) || QUANTITY_RX.test(m.text) || REFERENCE_QUANTITY_RX.test(m.text) || PRODUCT_REFERENCE_RX.test(m.text) || ACCEPTANCE_RX.test(m.text)
  );
  if (!requestOrQuantity) return { linked: false, relatedMessageIds: [] };
  return { linked: true, relatedMessageIds: [requestOrQuantity.id] };
}
function extractGreetingSignals(messages) {
  return messages.filter((m) => m.isMeaningful && isGreetingOnly(m.text)).map((m) => ({ type: "greeting", messageId: m.id, confidence: 0.95, ruleId: "greeting.detected" }));
}
function extractRequestSignals(messages) {
  return messages.filter((m) => isRequestCandidate(m)).map((m) => ({
    type: "request",
    messageId: m.id,
    confidence: REQUEST_VERB_RX.test(m.text) ? 0.85 : 0.6,
    ruleId: REQUEST_VERB_RX.test(m.text) ? "request.explicit_verb" : "request.implicit_meaningful_message"
  }));
}
function extractClarificationQuestionSignals(messages) {
  return messages.filter((m) => m.role === "staff" && m.isMeaningful && CLARIFICATION_MARK_RX.test(m.text)).map((m) => ({
    type: "clarification_question",
    messageId: m.id,
    confidence: 0.8,
    ruleId: "clarification_question.question_mark"
  }));
}
function extractConfirmationSignals(messages) {
  const signals = [];
  messages.forEach((m, index) => {
    if (m.role !== "staff" || !m.isMeaningful) return;
    const strength = classifyConfirmationStrength(m.text);
    if (strength === "none") return;
    if (strength === "explicit") {
      signals.push({
        type: "confirmation",
        messageId: m.id,
        confidence: 0.95,
        extractedValue: "explicit",
        ruleId: "confirmation.explicit"
      });
      return;
    }
    if (strength === "strong_implicit") {
      const { linked: linked2, relatedMessageIds: relatedMessageIds2 } = isConfirmationContextuallyLinked(messages, index);
      signals.push({
        type: "confirmation",
        messageId: m.id,
        confidence: linked2 ? 0.75 : 0.3,
        extractedValue: linked2 ? "strong_implicit" : "weak_implicit",
        relatedMessageIds: linked2 ? relatedMessageIds2 : [],
        ruleId: linked2 ? "confirmation.strong_implicit.after_request_context" : "confirmation.weak_implicit.no_context"
      });
      return;
    }
    const { linked, relatedMessageIds } = isConfirmationContextuallyLinked(messages, index);
    if (linked) {
      signals.push({
        type: "confirmation",
        messageId: m.id,
        confidence: 0.4,
        extractedValue: "weak_implicit",
        relatedMessageIds,
        ruleId: "confirmation.weak_implicit.after_request_context"
      });
    }
  });
  return signals;
}
function extractAcceptanceSignals(messages) {
  const signals = [];
  messages.forEach((m, index) => {
    if (m.role !== "customer" || !m.isMeaningful) return;
    if (!ACCEPTANCE_RX.test(m.text) && !isCommitmentOnly(m.text)) return;
    const { before } = contextWindowV32(messages, index, 2, 0);
    const offer = before.filter((prev) => prev.role === "staff").pop();
    signals.push({
      type: "acceptance",
      messageId: m.id,
      confidence: offer ? 0.85 : 0.5,
      relatedMessageIds: offer ? [offer.id] : [],
      ruleId: offer ? "acceptance.after_staff_offer" : "acceptance.no_prior_offer"
    });
  });
  return signals;
}
function extractRejectionSignals(messages) {
  return messages.filter((m) => m.role === "customer" && m.isMeaningful && REJECTION_RX.test(m.text)).map((m) => ({ type: "rejection", messageId: m.id, confidence: 0.8, ruleId: "rejection.explicit" }));
}
function extractCorrectionSignals(messages) {
  const signals = [];
  messages.forEach((m, index) => {
    if (m.role !== "customer" || !m.isMeaningful) return;
    if (!CORRECTION_RX.test(m.text)) return;
    const { before } = contextWindowV32(messages, index, 3, 0);
    const correctedMessage = before.filter((prev) => prev.role === "staff").pop();
    signals.push({
      type: "correction",
      messageId: m.id,
      confidence: correctedMessage ? 0.9 : 0.6,
      relatedMessageIds: correctedMessage ? [correctedMessage.id] : [],
      ruleId: correctedMessage ? "correction.explicit.linked_to_prior_staff_message" : "correction.explicit.no_prior_staff_message"
    });
  });
  return signals;
}
function extractQuantitySignals(messages) {
  const signals = [];
  messages.forEach((m) => {
    if (!m.isMeaningful) return;
    const directMatch = m.text.match(QUANTITY_RX);
    if (directMatch && directMatch[2]) {
      signals.push({
        type: "quantity",
        messageId: m.id,
        confidence: 0.85,
        extractedValue: directMatch[0].trim(),
        ruleId: "quantity.digit_or_word_plus_unit"
      });
      return;
    }
    const referenceMatch = m.text.match(REFERENCE_QUANTITY_RX);
    if (referenceMatch) {
      signals.push({
        type: "quantity",
        messageId: m.id,
        confidence: 0.65,
        extractedValue: referenceMatch[0].trim(),
        ruleId: "quantity.reference_attached_no_unit"
      });
    }
  });
  return signals;
}
function extractProductReferenceSignals(messages) {
  const signals = [];
  messages.forEach((m, index) => {
    if (!m.isMeaningful || !PRODUCT_REFERENCE_RX.test(m.text)) return;
    const resolved = resolveReference(messages, index);
    signals.push({
      type: "product_reference",
      messageId: m.id,
      confidence: resolved ? 0.7 : 0.3,
      extractedValue: resolved ? resolved.id : "unknown",
      relatedMessageIds: resolved ? [resolved.id] : [],
      ruleId: resolved ? "reference.resolved_to_prior_offer" : "reference.unknown"
    });
  });
  return signals;
}
function resolveReference(messages, index) {
  const { before } = contextWindowV32(messages, index, 4, 0);
  const candidates = before.filter(
    (message) => isPlausibleStaffProductOffer(message) || isPlausibleCustomerProductMention(message)
  );
  if (candidates.length === 0) return null;
  if (candidates.length >= 2) {
    const last = candidates[candidates.length - 1];
    const secondLast = candidates[candidates.length - 2];
    const gapMs = last.timestamp.getTime() - secondLast.timestamp.getTime();
    const normalizedLast = last.text.trim().toLowerCase();
    const normalizedSecond = secondLast.text.trim().toLowerCase();
    if (gapMs < 2 * 60 * 1e3 && normalizedLast !== normalizedSecond) return null;
  }
  return candidates[candidates.length - 1];
}
function extractPhoneSignals(messages) {
  return messages.filter((m) => m.isMeaningful && PHONE_RX.test(m.text)).map((m) => ({
    type: "phone",
    messageId: m.id,
    confidence: 0.95,
    extractedValue: m.text.match(PHONE_RX)?.[0] || null,
    ruleId: "phone.egyptian_mobile_pattern"
  }));
}
function extractAddressSignals(messages) {
  return messages.filter((m) => m.isMeaningful && ADDRESS_RX.test(m.text)).map((m) => ({ type: "address", messageId: m.id, confidence: 0.7, ruleId: "address.marker_phrase" }));
}
function extractPriceSignals(messages) {
  return messages.filter((m) => m.isMeaningful && PRICE_RX.test(m.text)).map((m) => ({
    type: "price",
    messageId: m.id,
    confidence: 0.8,
    extractedValue: m.text.match(PRICE_RX)?.[1] || null,
    ruleId: "price.currency_pattern"
  }));
}
function extractDeliverySignals(messages) {
  return messages.filter((m) => m.isMeaningful && DELIVERY_RX.test(m.text)).map((m) => ({ type: "delivery", messageId: m.id, confidence: 0.8, ruleId: "delivery.keyword" }));
}
function extractPromiseSignals(messages) {
  return messages.filter((m) => m.role === "staff" && m.isMeaningful && PROMISE_RX.test(m.text)).map((m) => ({ type: "promise", messageId: m.id, confidence: 0.6, ruleId: "promise.future_fulfillment_phrase" }));
}
function statementClauses(text) {
  return (text.match(/[^؟?.!\n،,]+[؟?]?/g) || []).map((clause) => clause.trim()).filter((clause) => clause.length > 0 && !/[؟?]$/.test(clause));
}
function clauseAvailabilityState(clause) {
  if (UNAVAILABLE_RX.test(clause)) return "unavailable";
  if (AVAILABLE_RX.test(clause)) return "available";
  if (CHECK_PENDING_RX.test(clause)) return "check_pending";
  return null;
}
function availabilityStatementClausesV32(text) {
  return statementClauses(text).map((clause) => ({ clause, state: clauseAvailabilityState(clause) })).filter((row) => row.state !== null);
}
function classifyAvailabilityStatementV32(text) {
  const clauses = statementClauses(text);
  if (clauses.some((clause) => UNAVAILABLE_RX.test(clause))) return "unavailable";
  if (clauses.some((clause) => AVAILABLE_RX.test(clause))) return "available";
  if (clauses.some((clause) => CHECK_PENDING_RX.test(clause))) return "check_pending";
  return null;
}
function extractAvailabilitySignals(messages) {
  const signals = [];
  for (const m of messages) {
    if (m.role !== "staff" || !m.isMeaningful) continue;
    const state = classifyAvailabilityStatementV32(m.text);
    if (!state) continue;
    signals.push({
      type: "availability",
      messageId: m.id,
      confidence: state === "unavailable" ? 0.85 : state === "available" ? 0.8 : 0.75,
      extractedValue: state,
      ruleId: `availability.staff_statement.${state}`
    });
  }
  return signals;
}
function alternativePhraseAfter(text, marker) {
  const match = text.match(marker);
  if (!match || match.index == null) return null;
  const tail = text.slice(match.index + match[0].length).split(/[؟?\n.!]/)[0].replace(ALTERNATIVE_PHRASE_FILLER_RX, "").trim();
  return tail.length >= 2 ? tail.slice(0, 80) : null;
}
function extractAlternativeOfferSignals(messages) {
  const signals = [];
  messages.forEach((m, index) => {
    if (m.role !== "staff" || !m.isMeaningful) return;
    const explicit = ALTERNATIVE_MARKER_RX.test(m.text);
    const generic = !explicit && GENERIC_OFFER_RX.test(m.text);
    if (!explicit && !generic) return;
    const { before } = contextWindowV32(messages, index, 4, 0);
    const trigger = before.filter(
      (prev) => prev.role === "staff" && classifyAvailabilityStatementV32(prev.text) === "unavailable" || prev.role === "customer" && REJECTION_RX.test(prev.text)
    ).pop();
    const selfUnavailable = classifyAvailabilityStatementV32(m.text) === "unavailable";
    if (generic && !trigger && !selfUnavailable) return;
    signals.push({
      type: "alternative_offer",
      messageId: m.id,
      confidence: explicit ? trigger || selfUnavailable ? 0.85 : 0.7 : 0.6,
      extractedValue: alternativePhraseAfter(m.text, explicit ? ALTERNATIVE_MARKER_RX : GENERIC_OFFER_RX),
      relatedMessageIds: trigger ? [trigger.id] : [],
      ruleId: explicit ? "alternative_offer.explicit_marker" : "alternative_offer.generic_offer_after_unavailable_or_rejection"
    });
  });
  return signals;
}
var BOUGHT_ELSEWHERE_RX = /(?:جبت|اشتريت|خدت|لقيت|هجيب|هشتري|هاخد)(?:ه|ها|هم)?\s*(?:من\s*)?(?:مكان\s*تاني|صيدلي[ةه]\s*تاني[ةه]|برا|بره)|من\s*(?:صيدلي[ةه]\s*تاني[ةه]|مكان\s*تاني)/i;
var FINAL_DECLINE_RX = /مش\s*(?:عايز|عاوز|محتاج)[ةه]?\s*خلاص|خلاص\s*مش\s*(?:عايز|عاوز|محتاج)|^لا\s*خلاص|لا\s*خلاص\s*مش|خلاص\s*(?:بلاش|مش\s*لازم)|(?:ا|أ|إ)لغي\s*الطلب|كنسل\s*الطلب|مبقتش\s*(?:محتاج|عايز|عاوز)/i;
var DELAY_COMPLAINT_RX = /اتأخرت(?:وا)?|متأخرين|محدش\s*(?:رد|بيرد)|ليه\s*محدش|بقالي\s*(?:ساع[ةه]|كتير|فتر[ةه])|مستني\s*من\s*بدري/i;
var WILL_WAIT_RX = /هستنا(?:ه|ها)?|هستنى|(?:ابقى|ابقي)\s*(?:بلغني|كلمني|قولي|عرفني)|لما\s*(?:\S+\s+){0,3}?(?:يوصل|يتوفر|ييجي|ينزل)|بلغني\s*لما|عرفني\s*لما/i;
function isNonRequestIntentStatement(text) {
  const intent = classifyCustomerIntentStatementV32(text);
  return intent === "considering" || intent === "will_wait" || intent === "final_decline" || intent === "bought_elsewhere";
}
function classifyCustomerIntentStatementV32(text) {
  if (BOUGHT_ELSEWHERE_RX.test(text)) return "bought_elsewhere";
  if (FINAL_DECLINE_RX.test(text)) return "final_decline";
  if (DELAY_COMPLAINT_RX.test(text)) return "delay_complaint";
  if (WILL_WAIT_RX.test(text)) return "will_wait";
  if (CONSIDERING_RX.test(text)) return "considering";
  return null;
}
var STAFF_FOLLOWUP_PROMISE_RX = /هتابع|هنتابع|ه(?:ن)?كلم\s*(?:ك|حضرتك)|ه(?:ن)?رد\s*على\s*(?:حضرتك|ك)|ه(?:ن)?بلغ\s*(?:ك|حضرتك)|ه(?:ن)?عرف\s*(?:ك|حضرتك)|هقول\s*(?:لك|لحضرتك)|هشوف\s*(?:لك|لحضرتك)|هسأل\s*(?:لك|لحضرتك)|هراجع\s*و\s*(?:أرد|ارد|أكلم|اكلم|أبلغ|ابلغ)/i;
var CUSTOMER_CALLBACK_RX = /كلمني|كلميني|كلمنى|اتصل(?:\s*(?:بي|بيا|عليا))?|رن\s*عليا|تابع\s*معايا|ابقى\s*(?:كلمني|تابع|بلغني|عرفني)|بلغني|عرفني|ابعتلي\s*لما/i;
var WHEN_IN_STOCK_RX = /لما\s*(?:\S+\s+){0,3}?(?:يوصل|يتوفر|ييجي|ينزل|تجيبه|تجيبوه|يبقى\s*موجود)/i;
var TOMORROW_RX = /بكر[ةه]|بكرا/i;
var AFTER_DAYS_RX = /بعد\s*(?:(يومين)|(\d+)\s*(?:يوم|أيام|ايام)|(اسبوع|أسبوع))/i;
var SAME_DAY_RX = /النهارد[ةه]|بالليل|كمان\s*ساع[ةه]|بعد\s*ساع[ةه]|آخر\s*النهار|اخر\s*النهار/i;
var PRESCRIPTION_REQUEST_RX = /(?:ابعت|ابعتي|ابعتلنا|محتاج(?:ين)?|لازم|ممكن)\s*(?:\S+\s*){0,2}(?:صور[ةه]\s*)?(?:ال)?(?:روشت[ةه]|وصف[ةه]\s*طبي[ةه])/i;
function isStaffFollowUpPromiseV32(text) {
  return STAFF_FOLLOWUP_PROMISE_RX.test(text);
}
function mentionsPrescriptionV32(text) {
  return /روشت[ةه]|وصف[ةه]\s*طبي[ةه]/i.test(text);
}
function isPrescriptionRequestV32(text) {
  return PRESCRIPTION_REQUEST_RX.test(text);
}
function classifyCustomerTimingRequestV32(text) {
  const callback = CUSTOMER_CALLBACK_RX.test(text);
  const waitForStock = WHEN_IN_STOCK_RX.test(text);
  if (!callback && !waitForStock) return null;
  if (waitForStock) return { when: "when_in_stock", days: null };
  const days = text.match(AFTER_DAYS_RX);
  if (days) return { when: "days", days: days[1] ? 2 : days[2] ? Number(days[2]) : 7 };
  if (TOMORROW_RX.test(text)) return { when: "days", days: 1 };
  if (SAME_DAY_RX.test(text)) return { when: "same_day", days: 0 };
  return { when: "unspecified", days: null };
}
function classifyCustomerOfferResponseV32(text) {
  if (REJECTION_RX.test(text)) return "rejected";
  if (CONSIDERING_RX.test(text)) return "considering";
  if (ACCEPTANCE_RX.test(text) || ACCEPT_OFFER_RX.test(text)) return "accepted";
  return null;
}
function buildSemanticSignalsV32(messages) {
  return [
    ...extractGreetingSignals(messages),
    ...extractRequestSignals(messages),
    ...extractClarificationQuestionSignals(messages),
    ...extractConfirmationSignals(messages),
    ...extractAcceptanceSignals(messages),
    ...extractRejectionSignals(messages),
    ...extractCorrectionSignals(messages),
    ...extractQuantitySignals(messages),
    ...extractProductReferenceSignals(messages),
    ...extractPhoneSignals(messages),
    ...extractAddressSignals(messages),
    ...extractPriceSignals(messages),
    ...extractDeliverySignals(messages),
    ...extractPromiseSignals(messages),
    ...extractAvailabilitySignals(messages),
    ...extractAlternativeOfferSignals(messages)
  ];
}
function computeRequestBurstIds(messages, gapMs = 3 * 60 * 1e3) {
  const burstIdByMessageId = /* @__PURE__ */ new Map();
  let burstIndex = 0;
  let currentBurst = [];
  const flush = () => {
    if (currentBurst.length >= 2) {
      const id = `burst:${burstIndex}`;
      currentBurst.forEach((m) => burstIdByMessageId.set(m.id, id));
      burstIndex += 1;
    }
    currentBurst = [];
  };
  messages.forEach((m) => {
    if (m.role !== "customer" || !m.isMeaningful) {
      if (m.role === "staff" && m.isMeaningful) flush();
      return;
    }
    const last = currentBurst[currentBurst.length - 1];
    if (last && m.timestamp.getTime() - last.timestamp.getTime() > gapMs) flush();
    currentBurst.push(m);
  });
  flush();
  return burstIdByMessageId;
}

// src/lib/whatsappConversationUnderstandingV32.ts
var EMOJI_RX = new RegExp("\\p{Extended_Pictographic}", "u");
var NON_EMOJI_MEANINGFUL_RX = /[\p{L}\p{N}]/u;
function isEmojiOnlyText(text) {
  const trimmed = (text || "").trim();
  if (!trimmed) return false;
  if (!EMOJI_RX.test(trimmed)) return false;
  return !NON_EMOJI_MEANINGFUL_RX.test(trimmed);
}
var PLACEHOLDER_ONLY_RX = /^<[^<>]*\bomitted>$|^\[(?:voice message|image|video|document|file|sticker)\]$|^(?:this message was deleted|you deleted this message)$/i;
var FORWARDED_PREFIX_RX = /^\[Forwarded\]\s*/i;
function isPlaceholderOnlyText(text) {
  const stripped = (text || "").trim().replace(FORWARDED_PREFIX_RX, "").trim();
  return PLACEHOLDER_ONLY_RX.test(stripped);
}
var INTERACTION_GAP_MS = 30 * 60 * 1e3;
var FALLBACK_TIME_BOUNDARY_MS = 120 * 60 * 1e3;
var SEMANTIC_CONTINUATION_MAX_GAP_MS = 6 * 60 * 60 * 1e3;
var PRIOR_ORDER_REFERENCE_MAX_GAP_MS = 24 * 60 * 60 * 1e3;
var PRIOR_ORDER_COMMITMENT_RX = /(?:اه|ايوه|تمام)?\s*(?:ابعته|ابعت(?:ه|وه|لي)?|هات(?:ه|ها)?)|من\s*عنيا.*(?:الطريق|عند\s*حضرتك)|جاري\s*(?:الارسال|الإرسال|التجهيز)|تم\s*(?:تأكيد|تاكيد).*الطلب|الطلب\s*اتأكد/i;
var FULFILLMENT_FOLLOWUP_RX = /(?:بعت|بعتوا|اتبعت|اتبعث).*?(?:الاوردر|الأوردر|الطلب)|(?:الاوردر|الأوردر|الطلب).*?(?:فين|وصل|اتبعت|اتبعث)|المندوب.*?(?:فين|وصل|الطريق)|(?:وصل|استلمت|استلمه).*?(?:الاوردر|الأوردر|الطلب)/i;
var PRIOR_ORDER_REFERENCE_RX = /(?:بخصوص|بالنسبة\s*ل).*?(?:الاوردر|الأوردر|الطلب)|(?:الاوردر|الأوردر|الطلب).*?(?:اللي\s*فات|السابق|بتاعي|بتاعتي|القديم)|المندوب.*?(?:فين|وصل|الطريق)/i;
var ORDER_DETAIL_CONTINUATION_RX = /العنوان|عنواني|اللوكيشن|الموقع|رقمي|رقم\s*(?:الموبايل|التليفون)|الموبايل|التليفون|الدور|الشقه|الشقة|العماره|العمارة/i;
var ADDITIVE_REQUEST_RX = /(?:^|\s)(?:وكمان|كمان|وزود|زود|ضيف|معاهم|معاه|مع\s*الطلب)(?:\s|$)/i;
var STAFF_PENDING_REPLY_RX = /لحظات|ثواني|دقيق[ةه]|اشوف|أشوف|هشوف|هراجع|هتأكد|هاتأكد|جاري\s*(?:المراجعه|المراجعة|البحث)/i;
var CLOSING_RX = /شكر[اً]?\s*لتواصلك|تحت\s*أمرك\s*دائم[اً]?|يومك\s*سعيد|في\s*خدمتك\s*دائم[اً]?/i;
var TOPIC_SHIFT_MARKER_RX = /بالمناسبة|كمان\s*حاجة|سؤال\s*تاني|بس\s*كمان\s*عايز|في\s*مشكلة\s*تاني[ةه]|حاجة\s*تانية\s*خالص/i;
function lastMeaningfulOfRole(current, role) {
  for (let i = current.length - 1; i >= 0; i -= 1) {
    const message = current[i];
    if (message.isMeaningful && message.role === role) return message;
  }
  return null;
}
function currentHasOrderCommitment(current) {
  return current.some(
    (message) => message.role === "staff" && message.isMeaningful && PRIOR_ORDER_COMMITMENT_RX.test(message.text)
  );
}
function currentHasMeaningfulStaff(current) {
  return current.some((message) => message.role === "staff" && message.isMeaningful);
}
function hasPendingCustomerNeed(current) {
  const customer = lastMeaningfulOfRole(current, "customer");
  if (!customer || !isRequestCandidate(customer)) return false;
  const staff = lastMeaningfulOfRole(current, "staff");
  if (!staff || customer.timestamp.getTime() > staff.timestamp.getTime()) return true;
  return STAFF_PENDING_REPLY_RX.test(staff.text);
}
function hasResolvedProductReferenceContinuation(current, next) {
  if (next.role !== "customer" || !next.isMeaningful) return false;
  const context = [...current.filter((m) => m.isMeaningful).slice(-5), next];
  return extractProductReferenceSignals(context).some(
    (signal) => signal.messageId === next.id && signal.extractedValue !== "unknown"
  );
}
function hasLinkedCorrectionContinuation(current, next) {
  if (next.role !== "customer" || !next.isMeaningful) return false;
  const context = [...current.filter((m) => m.isMeaningful).slice(-5), next];
  return extractCorrectionSignals(context).some(
    (signal) => signal.messageId === next.id && (signal.relatedMessageIds?.length ?? 0) > 0
  );
}
function isCustomerResponseContinuation(current, next) {
  if (next.role !== "customer" || !next.isMeaningful || !currentHasMeaningfulStaff(current)) return false;
  return isAcceptanceOnly(next.text) || isRejectionOnly(next.text) || isBareAcknowledgementOnly(next.text) || isThanksOrClosingOnly(next.text);
}
function isSameOrderContinuation(current, next, gapMs) {
  if (gapMs > PRIOR_ORDER_REFERENCE_MAX_GAP_MS || next.role !== "customer" || !next.isMeaningful) return false;
  if (!currentHasOrderCommitment(current)) return false;
  return FULFILLMENT_FOLLOWUP_RX.test(next.text) || PRIOR_ORDER_REFERENCE_RX.test(next.text) || ORDER_DETAIL_CONTINUATION_RX.test(next.text);
}
function shouldKeepSemanticContinuation(current, next, gapMs) {
  if (!current.length || gapMs < 0) return false;
  if (next.role === "staff" && next.isMeaningful && gapMs <= SEMANTIC_CONTINUATION_MAX_GAP_MS && hasPendingCustomerNeed(current)) {
    return true;
  }
  if (next.role !== "customer" || !next.isMeaningful) return false;
  if (isSameOrderContinuation(current, next, gapMs)) return true;
  if (gapMs <= SEMANTIC_CONTINUATION_MAX_GAP_MS) {
    if (hasResolvedProductReferenceContinuation(current, next)) return true;
    if (hasLinkedCorrectionContinuation(current, next)) return true;
    if (isCustomerResponseContinuation(current, next)) return true;
  }
  return gapMs <= INTERACTION_GAP_MS && currentHasOrderCommitment(current) && ADDITIVE_REQUEST_RX.test(next.text);
}
function normalizeMessage(message, staffNames, customerName) {
  const isSystemGenerated = message.direction === "system" || message.kind === "system";
  const isAutomated = !isSystemGenerated && AUTOMATED_REPLY_RX.test(message.text || "");
  const isEmojiOnly = !isSystemGenerated && isEmojiOnlyText(message.text || "");
  const hasText = Boolean((message.text || "").trim());
  const isMediaPlaceholder = Boolean(message.mediaPlaceholder) || isPlaceholderOnlyText(message.text);
  const hasRealContent = NON_EMOJI_MEANINGFUL_RX.test((message.text || "").trim());
  const isMeaningful = hasText && hasRealContent && !isSystemGenerated && !isAutomated && !isEmojiOnly && !isMediaPlaceholder;
  let role = "unknown";
  if (isSystemGenerated) role = "system";
  else if (message.direction === "outbound" || staffNames.has(message.sender)) role = "staff";
  else if (message.direction === "inbound") role = "customer";
  return {
    id: message.id,
    timestamp: message.timestamp,
    direction: message.direction,
    role,
    sender: message.sender,
    text: message.text || "",
    isSystemGenerated,
    isAutomated,
    isEmojiOnly,
    isMediaPlaceholder,
    isMeaningful,
    interactionId: null,
    requestBurstId: null
  };
}
function segmentInteractions(messages) {
  if (!messages.length) return [];
  const interactions = [];
  let current = [];
  let reason = "conversation_start";
  let sawClosingSinceLastMeaningfulInbound = false;
  const flush = () => {
    if (!current.length) return;
    const index = interactions.length;
    const id = `interaction:${index}`;
    const trigger = current.find((m) => m.role === "customer" && m.isMeaningful) || null;
    const staffNames = Array.from(
      new Set(current.filter((m) => m.role === "staff" && m.isMeaningful).map((m) => m.sender))
    );
    current.forEach((m) => {
      m.interactionId = id;
    });
    interactions.push({
      id,
      index,
      messageIds: current.map((m) => m.id),
      startedAt: current[0].timestamp,
      endedAt: current[current.length - 1].timestamp,
      triggerMessageId: trigger?.id || null,
      primaryStaffNames: staffNames,
      segmentationReason: reason
    });
    current = [];
    sawClosingSinceLastMeaningfulInbound = false;
  };
  messages.forEach((message, i) => {
    const prev = messages[i - 1];
    if (prev && current.length) {
      const previousMeaningful = [...current].reverse().find((candidate) => candidate.isMeaningful) || prev;
      const gapMs = message.timestamp.getTime() - previousMeaningful.timestamp.getTime();
      const semanticContinuation = shouldKeepSemanticContinuation(current, message, gapMs);
      const customerRequest = isRequestCandidate(message);
      const additiveRequest = ADDITIVE_REQUEST_RX.test(message.text);
      const fulfilledCurrentOrder = currentHasOrderCommitment(current);
      if (message.role === "customer" && message.isMeaningful && TOPIC_SHIFT_MARKER_RX.test(message.text) && !semanticContinuation) {
        flush();
        reason = "topic_shift_marker";
      } else if (customerRequest && sawClosingSinceLastMeaningfulInbound && !semanticContinuation) {
        flush();
        reason = "reopened_after_closing";
      } else if (customerRequest && fulfilledCurrentOrder && !additiveRequest && !semanticContinuation) {
        flush();
        reason = "new_commercial_need";
      } else if (gapMs > INTERACTION_GAP_MS && !semanticContinuation) {
        if (customerRequest) {
          flush();
          reason = "new_commercial_need";
        } else if (gapMs > FALLBACK_TIME_BOUNDARY_MS) {
          flush();
          reason = "time_gap";
        }
      }
    }
    if (message.role === "staff" && message.isMeaningful && CLOSING_RX.test(message.text)) {
      sawClosingSinceLastMeaningfulInbound = true;
    }
    if (message.role === "customer" && message.isMeaningful) {
      sawClosingSinceLastMeaningfulInbound = false;
    }
    current.push(message);
  });
  flush();
  return interactions;
}
function buildConversationUnderstandingV32(session) {
  const staffNames = new Set(session.outboundStaffNames || []);
  const messages = session.messages.slice().sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime()).map((message) => normalizeMessage(message, staffNames, session.customerName));
  const interactions = segmentInteractions(messages);
  const burstIdByMessageId = computeRequestBurstIds(messages);
  messages.forEach((message) => {
    message.requestBurstId = burstIdByMessageId.get(message.id) || null;
  });
  const signals = buildSemanticSignalsV32(messages);
  const participants = [];
  const seen = /* @__PURE__ */ new Set();
  messages.forEach((message) => {
    if (seen.has(message.sender)) return;
    seen.add(message.sender);
    participants.push({ name: message.sender, role: message.role });
  });
  return {
    version: "whatsapp-conversation-understanding-v32",
    conversationId: session.id,
    participants,
    customerName: session.customerName,
    staffNames: Array.from(staffNames),
    messages,
    interactions,
    signals,
    byId: new Map(messages.map((m) => [m.id, m]))
  };
}

// src/lib/salesIntelligence/conversationCaseEngine.ts
function messagesForInteraction(understanding, interaction) {
  const ids = new Set(interaction.messageIds);
  return understanding.messages.filter((m) => ids.has(m.id));
}
function evidenceRef(messages, description) {
  return {
    sourceTable: "whatsapp_review_sources",
    sourceId: "",
    messageIds: messages.map((m) => m.id),
    description
  };
}
function hasUnresolvedMultipleRequests(messages, requestMessages) {
  if (requestMessages.length < 2) return false;
  for (let i = 1; i < requestMessages.length; i += 1) {
    const prev = requestMessages[i - 1];
    const curr = requestMessages[i];
    const staffReplyBetween = messages.some(
      (m) => m.role === "staff" && m.isMeaningful && m.timestamp.getTime() > prev.timestamp.getTime() && m.timestamp.getTime() < curr.timestamp.getTime()
    );
    if (!staffReplyBetween) return true;
  }
  return false;
}
function deriveCaseForInteraction(understanding, interaction, input) {
  const messages = messagesForInteraction(understanding, interaction);
  const requestSignals = extractRequestSignals(messages);
  const requestMessages = requestSignals.map((s) => messages.find((m) => m.id === s.messageId)).filter((m) => Boolean(m));
  const confirmationSignals = extractConfirmationSignals(messages).filter(isSubstantiveConfirmationSignal);
  const quantitySignals = extractQuantitySignals(messages);
  const priceSignals = extractPriceSignals(messages);
  const productReferenceSignals = extractProductReferenceSignals(messages).filter((s) => s.extractedValue !== "unknown");
  const acceptanceSignals = extractAcceptanceSignals(messages);
  const rejectionSignals = extractRejectionSignals(messages);
  const hasRequest = requestSignals.length > 0;
  const hasCommercialSignal = quantitySignals.length > 0 || priceSignals.length > 0 || productReferenceSignals.length > 0 || confirmationSignals.length > 0;
  let caseType;
  let status;
  let score;
  const ruleIds = [];
  if (!hasRequest) {
    caseType = "information_only";
    status = "information_only";
    score = 0.9;
    ruleIds.push("case.classification.no_request_signal");
  } else if (!hasCommercialSignal) {
    caseType = "sales_opportunity";
    status = "sales_opportunity";
    score = 0.65;
    ruleIds.push("case.classification.request_without_commercial_signal");
  } else {
    caseType = "sales_opportunity";
    status = "basket_building";
    score = 0.8;
    ruleIds.push("case.classification.request_with_commercial_signal");
  }
  let needsHumanReview = false;
  const humanReviewReasons = [];
  let level = hasRequest ? hasCommercialSignal ? "strongly_inferred" : "weakly_inferred" : "proven";
  const explicitCommercialJourney = hasRequest && hasCommercialSignal && acceptanceSignals.length > 0 && confirmationSignals.length > 0 && rejectionSignals.length === 0;
  if (explicitCommercialJourney) {
    level = "proven";
    score = 1;
    ruleIds.push("case.classification.explicit_commercial_journey");
  }
  if (hasUnresolvedMultipleRequests(messages, requestMessages)) {
    needsHumanReview = true;
    humanReviewReasons.push("possible_unsegmented_multiple_requests");
    level = "weakly_inferred";
    score = Math.min(score, 0.4);
    ruleIds.push("case.ambiguity.unresolved_multiple_requests_no_staff_reply_between");
  }
  if (rejectionSignals.length > 0 && acceptanceSignals.length > 0 && confirmationSignals.length === 0) {
    needsHumanReview = true;
    humanReviewReasons.push("conflicting_acceptance_and_rejection_no_confirmation");
    level = "weakly_inferred";
    score = Math.min(score, 0.45);
    ruleIds.push("case.ambiguity.conflicting_accept_reject_signals");
  }
  const evidence = [
    evidenceRef(
      requestMessages,
      hasRequest ? `${requestMessages.length} \u0631\u0633\u0627\u0644\u0629 \u0637\u0644\u0628/\u0627\u0633\u062A\u0641\u0633\u0627\u0631 \u062D\u0642\u064A\u0642\u064A\u0629 \u0645\u0646 \u0627\u0644\u0639\u0645\u064A\u0644 \u0641\u064A \u0647\u0630\u0627 \u0627\u0644\u062A\u0641\u0627\u0639\u0644.` : "\u0644\u0627 \u062A\u0648\u062C\u062F \u0631\u0633\u0627\u0644\u0629 \u0637\u0644\u0628 \u062D\u0642\u064A\u0642\u064A\u0629 \u0645\u0646 \u0627\u0644\u0639\u0645\u064A\u0644 \u0641\u064A \u0647\u0630\u0627 \u0627\u0644\u062A\u0641\u0627\u0639\u0644 (\u062A\u062D\u064A\u0629/\u0634\u0643\u0631/\u0625\u0642\u0631\u0627\u0631 \u0641\u0642\u0637)."
    )
  ];
  if (hasCommercialSignal) {
    evidence.push(
      evidenceRef(
        messages,
        `\u0625\u0634\u0627\u0631\u0627\u062A \u062A\u062C\u0627\u0631\u064A\u0629: \u0643\u0645\u064A\u0629=${quantitySignals.length}, \u0633\u0639\u0631=${priceSignals.length}, \u0645\u0631\u062C\u0639 \u0645\u0646\u062A\u062C=${productReferenceSignals.length}, \u062A\u0623\u0643\u064A\u062F=${confirmationSignals.length}.`
      )
    );
  }
  return {
    caseId: `${input.conversationId}:${interaction.id}`,
    conversationId: input.conversationId,
    sourceCaseIdV22: input.sourceCaseIdV22 ?? null,
    customerId: input.customerIdHint ?? null,
    customerPhone: input.customerPhoneHint ?? null,
    branchId: input.branchIdHint ?? null,
    branchNameRaw: input.branchNameRawHint ?? null,
    startedAt: interaction.startedAt.toISOString(),
    endedAt: interaction.endedAt.toISOString(),
    primaryIntent: caseType,
    caseType,
    status,
    confidence: { level, score, ruleIds, evidence },
    createdFrom: input.createdFrom ?? "v32_shadow",
    needsHumanReview,
    humanReviewReasons
  };
}
function deriveConversationCases(input) {
  return input.understanding.interactions.map((interaction) => deriveCaseForInteraction(input.understanding, interaction, input));
}

// src/lib/salesIntelligence/caseBasketEngine.ts
var FINAL_BASKET_SUMMARY_MARKER_RX = /تأمر\s*ب|إجمالي\s*الحساب|هل\s*الطلب\s*كده\s*كامل|حضرتك\s*تأمر/i;
var STAFF_FINAL_CONFIRMATION_RX = /تم\s*تأكيد\s*الطلب|تم\s*تسجيل(?:\s*طلبك)?|تسجيل\s*طلبك|جاري\s*(?:التجهيز|الإرسال|الارسال)|الطلب\s*اتأكد/i;
var CUSTOMER_BASKET_CONFIRMATION_RX = /^(?:ايوا|ايوه|اه|آه)?\s*كده\s*تمام[!.، ]*$|^لا\s*كده\s*تمام[!.، ]*$|^شكرا?ً?\s*(?:يا\s*فندم\s*)?كده\s*تمام[!.، ]*$|^(?:ايوا|ايوه|اه|آه)\s*تمام[!.، ]*$/i;
var MODIFICATION_ADD_RX = /زود(?:ي)?|ضيف(?:ي)?\s|كمان\s*عايز|كمان\s*حاجة|نسيت/i;
var MODIFICATION_REMOVE_RX = /شيل(?:ي)?\s|الغ[يى](?:ي)?\s*(?!.*كل)/i;
var MODIFICATION_QTY_CHANGE_RX = /خليه?م?\s*(\d+|اتنين|تلات[ةه]?|أربع[ةه]?|خمس[ةه]?)\s*بدل\s*(\d+|اتنين|تلات[ةه]?|أربع[ةه]?|خمس[ةه]?)/i;
var SUBSTITUTION_MARKER_RX = /بدل(?:ها|منها|ه)?\s/i;
var WHOLE_BASKET_REJECTION_RX = /مش\s*عايز\s*(?:ده|حاجه|أي\s*حاجه|الطلب)(?:\s*خالص)?|الغ[يى]\s*كل\s*حاجة|كنسل\s*الطلب/i;
var QUANTITY_UNIT_ITEM_RX = /(\d+|واحد[ةه]?|اتنين|تلات[ةه]?|أربع[ةه]?|خمس[ةه]?)\s*(علبة|علب|حبة|حبوب|شريط|عبوة|قطعة|كيس)\s+([^\n,،]+)/gi;
var ANNOUNCED_TOTAL_RX = /(?:كده\s*)?(?:إجمالي\s*الحساب|الحساب\s*كل?ه|الإجمالي|المجموع|الحساب)\s*(?:كده\s*)?(\d+(?:\.\d+)?)\s*(?:جنيه|جنيها|ج\.?م\.?)?/i;
var ARABIC_NUMBER_WORDS = {
  \u0648\u0627\u062D\u062F: 1,
  \u0648\u0627\u062D\u062F\u0647: 1,
  \u0648\u0627\u062D\u062F\u0629: 1,
  \u0627\u062A\u0646\u064A\u0646: 2,
  \u062A\u0644\u0627\u062A\u0647: 3,
  \u062A\u0644\u0627\u062A\u0629: 3,
  \u0627\u0631\u0628\u0639\u0629: 4,
  \u0623\u0631\u0628\u0639\u0629: 4,
  \u062E\u0645\u0633\u0629: 5
};
function parseNumberToken(token) {
  if (/^\d+$/.test(token)) return Number(token);
  return ARABIC_NUMBER_WORDS[token.trim()] ?? null;
}
function normalizeProductKey(name) {
  return name.trim().toLowerCase().replace(/[أإآ]/g, "\u0627").replace(/ى/g, "\u064A").replace(/ة/g, "\u0647").replace(/\s+/g, " ");
}
function stripRequestPrefix(text) {
  return text.replace(/^\s*(?:عايز[هة]?|عاوز[هة]?|محتاج[هة]?|ممكن|هات[ي]?|ابعت(?:لي|يلي)?)\s*/i, "").trim().replace(/^[,،]+|[,،]+$/g, "").trim();
}
function assessment(level, score, ruleId, evidence) {
  return { level, score, ruleIds: [ruleId], evidence };
}
function refFor(message, description) {
  return {
    sourceTable: "whatsapp_review_sources",
    sourceId: "",
    messageIds: [message.id],
    description
  };
}
var NATURAL_UNIT_ITEM_RX = /(علبتين|علبة|علبه|شريطين|شريط|عبوتين|عبوة|عبوه|كيسين|كيس|حبتين|حبة|حبه)\s+(.+?)(?=(?:\s+(?:و\s*|مع\s+)(?:علبتين|علبة|علبه|شريطين|شريط|عبوتين|عبوة|عبوه|كيسين|كيس|حبتين|حبة|حبه)\s+)|[,،]|$)/gi;
var NATURAL_UNIT_QTY = {
  \u0639\u0644\u0628\u062A\u064A\u0646: { quantity: 2, unit: "\u0639\u0644\u0628\u0629" },
  \u0639\u0644\u0628\u0629: { quantity: 1, unit: "\u0639\u0644\u0628\u0629" },
  \u0639\u0644\u0628\u0647: { quantity: 1, unit: "\u0639\u0644\u0628\u0629" },
  \u0634\u0631\u064A\u0637\u064A\u0646: { quantity: 2, unit: "\u0634\u0631\u064A\u0637" },
  \u0634\u0631\u064A\u0637: { quantity: 1, unit: "\u0634\u0631\u064A\u0637" },
  \u0639\u0628\u0648\u062A\u064A\u0646: { quantity: 2, unit: "\u0639\u0628\u0648\u0629" },
  \u0639\u0628\u0648\u0629: { quantity: 1, unit: "\u0639\u0628\u0648\u0629" },
  \u0639\u0628\u0648\u0647: { quantity: 1, unit: "\u0639\u0628\u0648\u0629" },
  \u0643\u064A\u0633\u064A\u0646: { quantity: 2, unit: "\u0643\u064A\u0633" },
  \u0643\u064A\u0633: { quantity: 1, unit: "\u0643\u064A\u0633" },
  \u062D\u0628\u062A\u064A\u0646: { quantity: 2, unit: "\u062D\u0628\u0629" },
  \u062D\u0628\u0629: { quantity: 1, unit: "\u062D\u0628\u0629" },
  \u062D\u0628\u0647: { quantity: 1, unit: "\u062D\u0628\u0629" }
};
var PRICE_INQUIRY_RX = /بكام|عامل\s*كام|سعر(?:ه|ها)?|كام\s*(?:جنيه|العلبة|العلبه)|فيها\s*كام/i;
var STAFF_RECAP_CONTEXT_RX = /يعني\s*حضرتك|حضرتك\s*محتاج|تكرر|كرر|تأمر|تحت\s*امر/i;
function extractNaturalUnitItems(message) {
  if (!message.isMeaningful || /<(?:image|audio|voice message) omitted>/i.test(message.text)) return [];
  if (message.role === "customer" && PRICE_INQUIRY_RX.test(message.text)) return [];
  if (message.role === "staff" && !STAFF_RECAP_CONTEXT_RX.test(message.text)) return [];
  const items = [];
  for (const match of message.text.matchAll(NATURAL_UNIT_ITEM_RX)) {
    const quantityInfo = NATURAL_UNIT_QTY[match[1]];
    if (!quantityInfo) continue;
    const productNameRaw = match[2].trim().replace(/^(?:من\s+فضلك|لو\s*سمحت|ان\s*شاء\s*الله)\s*/i, "").replace(/\s+(?:صح|مظبوط|ان\s*شاء\s*الله)\??$/i, "").trim();
    if (!productNameRaw || productNameRaw.length < 2 || PRICE_INQUIRY_RX.test(productNameRaw)) continue;
    items.push({
      productNameRaw,
      productId: null,
      quantity: quantityInfo.quantity,
      unit: quantityInfo.unit,
      sourceMessageId: message.id,
      confidence: assessment("strongly_inferred", 0.8, "basket.item.natural_arabic_unit_form", [
        refFor(message, `\u0635\u064A\u0627\u063A\u0629 \u0637\u0644\u0628 \u0639\u0631\u0628\u064A\u0629 \u0637\u0628\u064A\u0639\u064A\u0629 \u0628\u0643\u0645\u064A\u0629 \u0636\u0645\u0646\u064A\u0629/\u0645\u062B\u0646\u0649: "${match[0].trim()}".`)
      ]),
      resolutionStatus: "proven"
    });
  }
  return items;
}
function parseSummaryItems(message) {
  const items = [];
  const matches = message.text.matchAll(QUANTITY_UNIT_ITEM_RX);
  for (const m of matches) {
    const quantity = parseNumberToken(m[1]);
    const unit = m[2];
    const productNameRaw = m[3].trim();
    items.push({
      productNameRaw,
      productId: null,
      quantity,
      unit,
      sourceMessageId: message.id,
      confidence: assessment("strongly_inferred", 0.8, "basket.item.parsed_from_staff_summary", [
        refFor(message, `\u0628\u0646\u062F \u0645\u0646 \u0645\u0644\u062E\u0635 \u0627\u0644\u0637\u0644\u0628 \u0627\u0644\u0646\u0647\u0627\u0626\u064A: "${m[0].trim()}".`)
      ]),
      resolutionStatus: "proven"
    });
  }
  const explicitKeys = new Set(items.map((item) => normalizeProductKey(item.productNameRaw)));
  for (const natural of extractNaturalUnitItems(message)) {
    const key = normalizeProductKey(natural.productNameRaw);
    if (!key || explicitKeys.has(key)) continue;
    items.push(natural);
  }
  return items;
}
function extractDraftItemsFromScope(allMessages, restrictToIds) {
  const items = [];
  const scopedMessages = restrictToIds ? allMessages.filter((message) => restrictToIds.has(message.id)) : allMessages;
  scopedMessages.forEach((message) => items.push(...extractNaturalUnitItems(message)));
  const quantitySignals = extractQuantitySignals(allMessages).filter(
    (s) => !restrictToIds || restrictToIds.has(s.messageId)
  );
  quantitySignals.forEach((signal) => {
    const message = allMessages.find((m) => m.id === signal.messageId);
    if (!message) return;
    if (signal.ruleId === "quantity.digit_or_word_plus_unit") {
      const phrase = signal.extractedValue || "";
      const [numToken, ...unitParts] = phrase.trim().split(/\s+/);
      const quantity2 = parseNumberToken(numToken);
      const unit = unitParts.join(" ") || null;
      const productNameRaw = stripRequestPrefix(message.text.replace(phrase, " ")) || message.text.trim();
      items.push({
        productNameRaw,
        productId: null,
        quantity: quantity2,
        unit,
        sourceMessageId: message.id,
        confidence: assessment("strongly_inferred", 0.75, "basket.item.quantity_unit_in_message", [
          refFor(message, `\u0627\u0644\u0639\u0645\u064A\u0644/\u0627\u0644\u0645\u0648\u0638\u0641 \u0630\u0643\u0631 \u0643\u0645\u064A\u0629 \u0648\u0648\u062D\u062F\u0629 \u0635\u0631\u064A\u062D\u0629: "${phrase}" \u0641\u064A \u0631\u0633\u0627\u0644\u0629 "${message.text.slice(0, 60)}".`)
        ]),
        resolutionStatus: "proven"
      });
      return;
    }
    const index = allMessages.indexOf(message);
    const resolved = resolveReference(allMessages, index);
    const numberMatch = (signal.extractedValue || "").match(/\d+|واحد[ةه]?|اتنين|تلات[ةه]?|أربع[ةه]?|خمس[ةه]?/);
    const quantity = numberMatch ? parseNumberToken(numberMatch[0]) : null;
    items.push({
      productNameRaw: resolved ? resolved.text.trim() : message.text.trim(),
      productId: null,
      quantity,
      unit: null,
      sourceMessageId: message.id,
      confidence: resolved ? assessment("strongly_inferred", 0.65, "basket.item.reference_resolved_to_prior_offer", [
        refFor(message, `\u0643\u0645\u064A\u0629 \u0645\u0631\u062C\u0639\u064A\u0629 "${signal.extractedValue}" \u062A\u064F\u062D\u0644 \u0625\u0644\u0649 \u0627\u0644\u0639\u0631\u0636 \u0627\u0644\u0633\u0627\u0628\u0642: "${resolved.text.slice(0, 60)}".`)
      ]) : assessment("unknown", 0.3, "basket.item.reference_unresolved", [
        refFor(message, `\u0643\u0645\u064A\u0629 \u0645\u0631\u062C\u0639\u064A\u0629 "${signal.extractedValue}" \u0628\u062F\u0648\u0646 \u0639\u0631\u0636 \u0633\u0627\u0628\u0642 \u0648\u0627\u0636\u062D \u064A\u064F\u062D\u0644 \u0625\u0644\u064A\u0647 \u0627\u0644\u0645\u0631\u062C\u0639.`)
      ]),
      resolutionStatus: resolved ? "partially_proven" : "unknown"
    });
  });
  const productRefSignals = extractProductReferenceSignals(allMessages).filter(
    (s) => !restrictToIds || restrictToIds.has(s.messageId)
  );
  productRefSignals.forEach((signal) => {
    const alreadyCaptured = quantitySignals.some((q) => q.messageId === signal.messageId);
    if (alreadyCaptured) return;
    const message = allMessages.find((m) => m.id === signal.messageId);
    if (!message) return;
    const index = allMessages.indexOf(message);
    const resolved = resolveReference(allMessages, index);
    items.push({
      productNameRaw: resolved ? resolved.text.trim() : message.text.trim(),
      productId: null,
      quantity: null,
      unit: null,
      sourceMessageId: message.id,
      confidence: resolved ? assessment("strongly_inferred", 0.6, "basket.item.product_reference_resolved_no_quantity", [
        refFor(message, `\u0625\u0634\u0627\u0631\u0629 \u0644\u0645\u0646\u062A\u062C \u0628\u062F\u0648\u0646 \u0643\u0645\u064A\u0629\u060C \u062A\u064F\u062D\u0644 \u0625\u0644\u0649 \u0627\u0644\u0639\u0631\u0636 \u0627\u0644\u0633\u0627\u0628\u0642: "${resolved.text.slice(0, 60)}".`)
      ]) : assessment("unknown", 0.3, "basket.item.product_reference_unresolved", [
        refFor(message, "\u0625\u0634\u0627\u0631\u0629 \u0644\u0645\u0646\u062A\u062C \u0628\u062F\u0648\u0646 \u0643\u0645\u064A\u0629 \u0648\u0644\u0627 \u064A\u0645\u0643\u0646 \u062A\u062D\u062F\u064A\u062F \u0627\u0644\u0639\u0631\u0636 \u0627\u0644\u0633\u0627\u0628\u0642 \u0628\u0648\u0636\u0648\u062D.")
      ]),
      resolutionStatus: resolved ? "partially_proven" : "unknown"
    });
  });
  return items;
}
function draftItemsToMap(items) {
  const map = /* @__PURE__ */ new Map();
  items.forEach((item) => map.set(normalizeProductKey(item.productNameRaw), item));
  return map;
}
function extractAnnouncedTotal(scopedMessages, summaryMessage, version) {
  const candidates = scopedMessages.filter((m) => m.timestamp.getTime() >= summaryMessage.timestamp.getTime()).sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  for (const m of candidates) {
    const match = m.text.match(ANNOUNCED_TOTAL_RX);
    if (!match) continue;
    return {
      amount: Number(match[1]),
      currency: "EGP",
      messageId: m.id,
      staffId: null,
      announcedAt: m.timestamp.toISOString(),
      basketVersion: version,
      supersededByTotalId: null
    };
  }
  return null;
}
function isFinalBasketSummary(message) {
  return message.role === "staff" && message.isMeaningful && FINAL_BASKET_SUMMARY_MARKER_RX.test(message.text);
}
function isStaffFinalConfirmation(message) {
  return message.role === "staff" && message.isMeaningful && STAFF_FINAL_CONFIRMATION_RX.test(message.text);
}
function classifyCustomerModification(text) {
  if (MODIFICATION_QTY_CHANGE_RX.test(text)) return "quantity_change";
  if (SUBSTITUTION_MARKER_RX.test(text)) return "substitute";
  if (MODIFICATION_ADD_RX.test(text)) return "add";
  if (MODIFICATION_REMOVE_RX.test(text)) return "remove";
  return null;
}
function extractSubstituteProductName(text) {
  const afterVerb = text.replace(/^.*?(?:هات[ي]?|عايز|عاوز|ابعت(?:لي|يلي)?)\s*/i, "").trim();
  return afterVerb || text.trim();
}
function extractAddedProductName(text) {
  const stripped = text.replace(/^.*?(?:زود(?:ي)?|ضيف(?:ي)?|كمان\s*عايز|كمان\s*حاجة|نسيت)\s*/i, "").trim();
  return stripped || text.trim();
}
function isLinkedToSummary(scopedMessages, candidateMessageId, summaryMessageId) {
  const index = scopedMessages.findIndex((m) => m.id === candidateMessageId);
  if (index === -1) return false;
  const { before } = contextWindowV32(scopedMessages, index, 5, 0);
  return before.some((m) => m.id === summaryMessageId) || scopedMessages[index - 1]?.id === summaryMessageId;
}
function buildCaseBaskets(caseId, scopedMessages) {
  const messages = scopedMessages.slice().sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const baskets = [];
  const itemsByBasketId = {};
  const summaryEvents = [];
  const customerConfirmationEvents = [];
  const staffFinalConfirmationEvents = [];
  let version = 0;
  let items = /* @__PURE__ */ new Map();
  let status = "draft";
  let createdAt = null;
  let sourceMessageIds = [];
  let announcedTotal = null;
  let confirmedAt = null;
  let confirmedByCustomerAt = null;
  let lastSummaryMessageId = null;
  let hasOpenBasket = false;
  const currentBasketId = () => `${caseId}:basket:${version}`;
  function flushCurrentBasket(finalStatus) {
    if (!hasOpenBasket) return;
    const basketId = currentBasketId();
    const resolvedStatus = finalStatus ?? status;
    baskets.push({
      basketId,
      caseId,
      version,
      status: resolvedStatus,
      createdAt: createdAt ?? messages[0]?.timestamp.toISOString() ?? (/* @__PURE__ */ new Date(0)).toISOString(),
      confirmedAt,
      confirmedByCustomerAt,
      staffId: null,
      announcedTotal,
      sourceMessageIds: [...sourceMessageIds],
      confidence: assessment(
        resolvedStatus === "confirmed" ? "strongly_inferred" : "weakly_inferred",
        resolvedStatus === "confirmed" ? 0.8 : 0.5,
        "basket.version.flushed",
        []
      ),
      supersededByBasketId: null
    });
    itemsByBasketId[basketId] = Array.from(items.values()).map((item, i) => ({
      itemId: `${basketId}:item:${i}`,
      basketId,
      productNameRaw: item.productNameRaw,
      productId: item.productId,
      quantity: item.quantity,
      unit: item.unit,
      unitPrice: null,
      lineTotal: null,
      sourceMessageId: item.sourceMessageId,
      confidence: item.confidence,
      resolutionStatus: item.resolutionStatus
    }));
  }
  function startNewVersion(carryForwardItems, initialStatus) {
    version += 1;
    items = new Map(carryForwardItems);
    status = initialStatus;
    createdAt = null;
    sourceMessageIds = [];
    announcedTotal = null;
    confirmedAt = null;
    confirmedByCustomerAt = null;
    hasOpenBasket = true;
  }
  messages.forEach((message) => {
    if (isFinalBasketSummary(message)) {
      if (!hasOpenBasket) startNewVersion(/* @__PURE__ */ new Map(), "draft");
      else if (status === "confirmed" || status === "awaiting_confirmation") {
      }
      const summaryItems = parseSummaryItems(message);
      if (summaryItems.length > 0) items = draftItemsToMap(summaryItems);
      status = "awaiting_confirmation";
      createdAt = createdAt ?? message.timestamp.toISOString();
      sourceMessageIds.push(message.id);
      announcedTotal = extractAnnouncedTotal(messages, message, version) ?? announcedTotal;
      lastSummaryMessageId = message.id;
      summaryEvents.push({
        eventId: `${currentBasketId()}:summary:${message.id}`,
        caseId,
        basketId: currentBasketId(),
        basketVersion: version,
        staffId: null,
        messageId: message.id,
        presentedAt: message.timestamp.toISOString(),
        evidence: [refFor(message, `\u0645\u0644\u062E\u0635 \u0637\u0644\u0628 \u0646\u0647\u0627\u0626\u064A: "${message.text.slice(0, 120)}".`)],
        ruleIds: ["commercial.final_summary.marker_matched"],
        confidence: assessment("strongly_inferred", 0.75, "commercial.final_summary.marker_matched", [
          refFor(message, `\u062A\u0637\u0627\u0628\u0642\u062A \u0627\u0644\u0631\u0633\u0627\u0644\u0629 \u0645\u0639 \u0639\u0644\u0627\u0645\u0627\u062A \u0645\u0644\u062E\u0635 \u0627\u0644\u0637\u0644\u0628 \u0627\u0644\u0646\u0647\u0627\u0626\u064A: "${message.text.slice(0, 120)}".`)
        ])
      });
      return;
    }
    if (message.role === "customer" && message.isMeaningful) {
      const modification = classifyCustomerModification(message.text);
      if (modification && hasOpenBasket && (status === "awaiting_confirmation" || status === "confirmed")) {
        flushCurrentBasket("superseded");
        const carried = new Map(items);
        if (modification === "remove") {
          const targetKey = Array.from(carried.keys()).find(
            (key) => normalizeProductKey(message.text).includes(key.split(" ")[0])
          );
          if (targetKey) carried.delete(targetKey);
        }
        startNewVersion(carried, "draft");
        sourceMessageIds.push(message.id);
        if (modification === "add") {
          const extra = extractDraftItemsFromScope(messages, /* @__PURE__ */ new Set([message.id]));
          if (extra.length > 0) {
            extra.forEach((item) => items.set(normalizeProductKey(item.productNameRaw), item));
          } else {
            const productNameRaw = extractAddedProductName(message.text);
            items.set(normalizeProductKey(productNameRaw), {
              productNameRaw,
              productId: null,
              quantity: null,
              unit: null,
              sourceMessageId: message.id,
              confidence: assessment("weakly_inferred", 0.4, "basket.item.add_fallback_from_customer_wording", [
                refFor(message, `\u0627\u0644\u0639\u0645\u064A\u0644 \u0623\u0636\u0627\u0641 \u0635\u0646\u0641\u064B\u0627 \u062C\u062F\u064A\u062F\u064B\u0627 \u0628\u0627\u0644\u0627\u0633\u0645 \u0641\u0642\u0637 \u062F\u0648\u0646 \u0643\u0645\u064A\u0629 \u0623\u0648 \u0625\u0634\u0627\u0631\u0629 \u0645\u0631\u062C\u0639\u064A\u0629: "${message.text.slice(0, 80)}".`)
              ]),
              resolutionStatus: "partially_proven"
            });
          }
        }
        if (modification === "quantity_change") {
          const match = message.text.match(MODIFICATION_QTY_CHANGE_RX);
          const newQty = match ? parseNumberToken(match[1]) : null;
          const lastKey = Array.from(items.keys())[0];
          if (lastKey && newQty != null) {
            const existing = items.get(lastKey);
            items.set(lastKey, { ...existing, quantity: newQty, sourceMessageId: message.id });
          }
        }
        if (modification === "substitute") {
          items.clear();
          const productNameRaw = extractSubstituteProductName(message.text);
          items.set(normalizeProductKey(productNameRaw), {
            productNameRaw,
            productId: null,
            quantity: null,
            unit: null,
            sourceMessageId: message.id,
            confidence: assessment("weakly_inferred", 0.4, "basket.item.substitution_from_customer_wording", [
              refFor(message, `\u0627\u0644\u0639\u0645\u064A\u0644 \u0637\u0644\u0628 \u0627\u0633\u062A\u0628\u062F\u0627\u0644 \u0627\u0644\u0635\u0646\u0641: "${message.text.slice(0, 80)}".`)
            ]),
            resolutionStatus: "partially_proven"
          });
        }
        lastSummaryMessageId = null;
        return;
      }
      if (hasOpenBasket && status === "awaiting_confirmation" && lastSummaryMessageId) {
        if (WHOLE_BASKET_REJECTION_RX.test(message.text) && isLinkedToSummary(messages, message.id, lastSummaryMessageId)) {
          status = "cancelled";
          sourceMessageIds.push(message.id);
          return;
        }
        const rejectionSignal = extractRejectionSignals([message])[0];
        const acceptanceSignal = extractAcceptanceSignals([message])[0];
        const localComboConfirmation = CUSTOMER_BASKET_CONFIRMATION_RX.test(message.text);
        const confirmationLinked = (acceptanceSignal || localComboConfirmation) && isLinkedToSummary(messages, message.id, lastSummaryMessageId) || extractConfirmationSignals(messages).filter(isSubstantiveConfirmationSignal).some((s) => s.relatedMessageIds?.includes(lastSummaryMessageId));
        if (confirmationLinked && !rejectionSignal) {
          status = "confirmed";
          confirmedByCustomerAt = message.timestamp.toISOString();
          sourceMessageIds.push(message.id);
          customerConfirmationEvents.push({
            eventId: `${currentBasketId()}:customer_confirm:${message.id}`,
            caseId,
            basketId: currentBasketId(),
            basketVersion: version,
            messageId: message.id,
            confirmedAt: message.timestamp.toISOString(),
            relatedSummaryMessageId: lastSummaryMessageId,
            evidence: [refFor(message, `\u062A\u0623\u0643\u064A\u062F \u0627\u0644\u0639\u0645\u064A\u0644: "${message.text.slice(0, 120)}", \u0645\u0631\u062A\u0628\u0637 \u0628\u0645\u0644\u062E\u0635 \u0627\u0644\u0631\u0633\u0627\u0644\u0629 ${lastSummaryMessageId}.`)],
            ruleIds: ["commercial.customer_confirmation.linked_to_summary"],
            confidence: assessment("strongly_inferred", 0.8, "commercial.customer_confirmation.linked_to_summary", [
              refFor(message, `\u062A\u0623\u0643\u064A\u062F \u0627\u0644\u0639\u0645\u064A\u0644 \u0645\u0631\u062A\u0628\u0637 \u0628\u0633\u064A\u0627\u0642 \u0645\u0644\u062E\u0635 \u0627\u0644\u0637\u0644\u0628 \u0627\u0644\u0623\u062E\u064A\u0631: "${message.text.slice(0, 120)}".`)
            ])
          });
          return;
        }
      }
      if (!hasOpenBasket) startNewVersion(/* @__PURE__ */ new Map(), "draft");
      if (status === "draft") {
        extractDraftItemsFromScope(messages, /* @__PURE__ */ new Set([message.id])).forEach((item) => {
          items.set(normalizeProductKey(item.productNameRaw), item);
          sourceMessageIds.push(message.id);
        });
      }
      return;
    }
    if (message.role === "staff" && message.isMeaningful && hasOpenBasket) {
      if (status === "confirmed" && isStaffFinalConfirmation(message)) {
        confirmedAt = message.timestamp.toISOString();
        sourceMessageIds.push(message.id);
        staffFinalConfirmationEvents.push({
          eventId: `${currentBasketId()}:staff_confirm:${message.id}`,
          caseId,
          basketId: currentBasketId(),
          basketVersion: version,
          staffId: null,
          messageId: message.id,
          confirmedAt: message.timestamp.toISOString(),
          evidence: [refFor(message, `\u062A\u0623\u0643\u064A\u062F \u0646\u0647\u0627\u0626\u064A \u0645\u0646 \u0627\u0644\u0645\u0648\u0638\u0641 \u0628\u0639\u062F \u0642\u0628\u0648\u0644 \u0627\u0644\u0639\u0645\u064A\u0644: "${message.text.slice(0, 120)}".`)],
          ruleIds: ["commercial.staff_final_confirmation.after_customer_acceptance"],
          confidence: assessment("strongly_inferred", 0.85, "commercial.staff_final_confirmation.after_customer_acceptance", [
            refFor(message, `\u0631\u0633\u0627\u0644\u0629 \u062A\u0623\u0643\u064A\u062F \u0646\u0647\u0627\u0626\u064A \u0645\u0646 \u0627\u0644\u0645\u0648\u0638\u0641: "${message.text.slice(0, 120)}".`)
          ])
        });
        return;
      }
      if (status === "draft") {
        extractDraftItemsFromScope(messages, /* @__PURE__ */ new Set([message.id])).forEach((item) => {
          items.set(normalizeProductKey(item.productNameRaw), item);
        });
      }
    }
  });
  flushCurrentBasket();
  for (let i = 0; i < baskets.length - 1; i += 1) {
    baskets[i] = { ...baskets[i], status: baskets[i].status === "cancelled" ? "cancelled" : "superseded", supersededByBasketId: baskets[i + 1].basketId };
  }
  return { baskets, itemsByBasketId, summaryEvents, customerConfirmationEvents, staffFinalConfirmationEvents };
}

// src/lib/salesIntelligence/commercialConfirmationEngine.ts
function assessment2(level, score, ruleIds, evidence) {
  return { level, score, ruleIds, evidence };
}
function deriveCommercialConfirmationState(caseId, baskets, summaryEvents, customerConfirmationEvents, staffFinalConfirmationEvents) {
  if (baskets.length === 0) {
    return {
      caseId,
      basketId: "",
      basketVersion: 0,
      summaryPresented: false,
      customerConfirmed: false,
      staffConfirmed: false,
      announcedTotalPresent: false,
      modificationAfterConfirmation: false,
      currentState: "unknown",
      primaryMessageIds: [],
      ruleIds: ["commercial.state.no_basket"],
      confidence: assessment2("unknown", 0.2, ["commercial.state.no_basket"], []),
      needsHumanReview: true,
      humanReviewReasons: ["no_basket_state_for_case"]
    };
  }
  const latest = baskets[baskets.length - 1];
  const latestSummaryEvent = summaryEvents.filter((e) => e.basketVersion === latest.version).pop() ?? null;
  const latestConfirmationEvent = customerConfirmationEvents.filter((e) => e.basketVersion === latest.version).pop() ?? null;
  const latestStaffConfirmationEvent = staffFinalConfirmationEvents.filter((e) => e.basketVersion === latest.version).pop() ?? null;
  const summaryPresented = latestSummaryEvent !== null;
  const customerConfirmed = latest.confirmedByCustomerAt !== null || latest.status === "confirmed";
  const staffConfirmed = latest.confirmedAt !== null;
  const announcedTotalPresent = latest.announcedTotal !== null;
  const modificationAfterConfirmation = baskets.some(
    (b, i) => i < baskets.length - 1 && b.confirmedByCustomerAt !== null
  );
  const ruleIds = [];
  const humanReviewReasons = [];
  let currentState;
  if (latest.status === "cancelled") {
    currentState = "rejected";
    ruleIds.push("commercial.state.rejected_whole_basket");
  } else if (staffConfirmed && customerConfirmed && summaryPresented) {
    currentState = "commercial_confirmation_complete";
    ruleIds.push("commercial.state.complete");
  } else if (customerConfirmed && !staffConfirmed) {
    currentState = "customer_confirmed";
    ruleIds.push("commercial.state.customer_confirmed_awaiting_staff");
  } else if (summaryPresented && !customerConfirmed) {
    currentState = "awaiting_customer_confirmation";
    ruleIds.push("commercial.state.awaiting_customer_confirmation");
  } else if (modificationAfterConfirmation && !customerConfirmed) {
    currentState = "modified_after_confirmation";
    ruleIds.push("commercial.state.modified_after_confirmation");
  } else if (latest.status === "draft") {
    currentState = "basket_in_progress";
    ruleIds.push("commercial.state.basket_in_progress");
  } else {
    currentState = "unknown";
    ruleIds.push("commercial.state.unresolved");
    humanReviewReasons.push("commercial_confirmation_state_unresolved");
  }
  const needsHumanReview = humanReviewReasons.length > 0;
  const primaryMessageIds = Array.from(
    new Set(
      [
        latestSummaryEvent?.messageId,
        latestConfirmationEvent?.messageId,
        latestStaffConfirmationEvent?.messageId
      ].filter((id) => Boolean(id))
    )
  );
  if (primaryMessageIds.length === 0) primaryMessageIds.push(...latest.sourceMessageIds);
  const evidence = [
    ...latestSummaryEvent ? latestSummaryEvent.evidence : [],
    ...latestConfirmationEvent ? latestConfirmationEvent.evidence : [],
    ...latestStaffConfirmationEvent ? latestStaffConfirmationEvent.evidence : []
  ];
  const level = currentState === "unknown" ? "unknown" : currentState === "commercial_confirmation_complete" ? "strongly_inferred" : "weakly_inferred";
  const score = currentState === "unknown" ? 0.3 : currentState === "commercial_confirmation_complete" ? 0.85 : 0.55;
  return {
    caseId,
    basketId: latest.basketId,
    basketVersion: latest.version,
    summaryPresented,
    customerConfirmed,
    staffConfirmed,
    announcedTotalPresent,
    modificationAfterConfirmation,
    currentState,
    primaryMessageIds,
    ruleIds,
    confidence: assessment2(level, score, ruleIds, evidence),
    needsHumanReview,
    humanReviewReasons
  };
}
function assessOrderConfirmationProtocol(commercial) {
  const summaryCompliant = commercial.summaryPresented;
  const announcedTotalCompliant = commercial.announcedTotalPresent;
  const customerConfirmationCompliant = commercial.customerConfirmed;
  const staffFinalConfirmationCompliant = commercial.staffConfirmed;
  const missingProtocolSteps = [];
  if (!summaryCompliant) missingProtocolSteps.push("final_basket_summary");
  if (!announcedTotalCompliant) missingProtocolSteps.push("announced_total");
  if (!customerConfirmationCompliant) missingProtocolSteps.push("customer_final_confirmation");
  if (!staffFinalConfirmationCompliant) missingProtocolSteps.push("staff_final_confirmation");
  return {
    caseId: commercial.caseId,
    basketId: commercial.basketId,
    basketVersion: commercial.basketVersion,
    summaryCompliant,
    announcedTotalCompliant,
    customerConfirmationCompliant,
    staffFinalConfirmationCompliant,
    protocolCompliant: missingProtocolSteps.length === 0,
    missingProtocolSteps
  };
}
function deriveOrderConfirmationProtocolApplicability(params) {
  const { caseType, commercial, hasMeaningfulBasketItems, historicalClosure } = params;
  if (caseType === "complaint" || caseType === "follow_up") return "not_applicable";
  const formalOrderClosingReached = commercial.currentState === "awaiting_customer_confirmation" || commercial.currentState === "customer_confirmed" || commercial.currentState === "modified_after_confirmation" || commercial.currentState === "commercial_confirmation_complete" || commercial.currentState === "rejected";
  if (formalOrderClosingReached) return "applicable";
  const hasRealCommercialSignal = hasMeaningfulBasketItems || historicalClosure.purchaseIntentDetected;
  switch (historicalClosure.closureLevel) {
    case "explicit":
      return "applicable";
    case "strongly_inferred":
      return historicalClosure.needsHumanReview ? "unknown" : "applicable";
    case "weakly_inferred":
      if (historicalClosure.basketReconstructable && (historicalClosure.customerAcceptanceDetected || historicalClosure.staffFulfillmentIntentDetected)) {
        return "unknown";
      }
      return hasRealCommercialSignal ? "not_reached" : "not_applicable";
    case "not_closed":
    case "unknown":
    default:
      return hasRealCommercialSignal ? "not_reached" : "not_applicable";
  }
}

// src/lib/salesIntelligence/saleAttributionEngine.ts
var TIME_MATCH_BANDS = {
  veryStrongMaxMinutes: 30,
  strongMaxMinutes: 120,
  moderateMaxMinutes: 360,
  /** "same day" ceiling — beyond this, next-day+ is `very_weak` unless direct evidence exists. */
  weakMaxMinutes: 1440,
  /** An invoice meaningfully PRE-DATING the case's own end is chronologically backwards — flagged, not silently averaged in. Small negative values are tolerated as clock-skew noise. */
  temporalInversionGraceMinutes: 10
};
var AMOUNT_MATCH_TOLERANCE = {
  absoluteEgp: 20,
  relativeFraction: 0.02
};
var ATTRIBUTION_FACTOR_WEIGHTS = {
  customerIdMatch: 0.3,
  phoneMatch: 0.2,
  branchExactCanonical: 0.1,
  branchAlias: 0.07,
  timeVeryStrong: 0.15,
  timeStrong: 0.1,
  timeModerate: 0.05,
  timeWeak: 0.02,
  announcedTotalExact: 0.15,
  announcedTotalNear: 0.1,
  basketValueExact: 0.08,
  basketValueNear: 0.05,
  staffSame: 0.05,
  staffCompatible: 0.02,
  legacyMatch: 0.08,
  productMatch: 0.05
};
var ATTRIBUTION_LEVEL_THRESHOLDS = {
  stronglyInferredMinScore: 0.55,
  weaklyInferredMinScore: 0.2
};
var AMBIGUITY_SCORE_MARGIN = 0.05;
var CANONICAL_BRANCH_LABELS = /* @__PURE__ */ new Set(["\u0641\u0631\u0639 \u0634\u0643\u0631\u064A", "\u0641\u0631\u0639 \u0627\u0644\u0634\u0627\u0645\u064A"]);
var UNKNOWN_BRANCH_LABEL = normalizeBranchName("");
var unavailableInvoiceItemEvidenceProvider = {
  getItemsForInvoice: () => "unavailable"
};
function cleanText2(value) {
  return String(value ?? "").trim();
}
function firstValue2(row, keys) {
  for (const key of keys) {
    const value = row[key];
    if (value !== void 0 && value !== null && cleanText2(value) !== "") return value;
  }
  return null;
}
function getInvoiceRowId(row) {
  return cleanText2(firstValue2(row, ["id", "invoice_number", "invoice_no"]));
}
function getInvoiceRowNumber(row) {
  return cleanText2(firstValue2(row, ["invoice_number", "invoice_no"])) || null;
}
function getInvoiceCustomerId(row) {
  return cleanText2(firstValue2(row, ["customer_id"])) || null;
}
function getInvoiceCustomerPhone(row) {
  return cleanText2(firstValue2(row, ["customer_phone", "phone", "whatsapp_phone"])) || null;
}
function getInvoiceStaffId(row) {
  return cleanText2(firstValue2(row, ["staff_id"])) || null;
}
function isDraftLikeZeroInvoice(row) {
  const explicitAmountValue = firstValue2(row, [
    "net_amount",
    "net_total",
    "total_amount",
    "amount",
    "gross_amount",
    "discounted_amount"
  ]);
  if (explicitAmountValue == null) return false;
  const amount = Number(explicitAmountValue);
  if (!Number.isFinite(amount)) return false;
  const closeValue = firstValue2(row, ["close_datetime", "close_time"]);
  return amount <= 0 && !closeValue;
}
function getInvoiceDateTimeForAttribution(row) {
  const preciseRaw = firstValue2(row, ["invoice_datetime", "close_datetime"]);
  if (preciseRaw) {
    const iso = parseInvoiceDateTime(preciseRaw);
    if (iso) return { iso, precise: true };
  }
  const dayRaw = firstValue2(row, ["sale_date", "invoice_date", "date"]);
  if (dayRaw) {
    const iso = parseInvoiceDateTime(dayRaw);
    if (iso) return { iso, precise: false };
  }
  return { iso: null, precise: false };
}
function normalizeProductNameForMatch(name) {
  return name.trim().toLowerCase().replace(/[أإآ]/g, "\u0627").replace(/ى/g, "\u064A").replace(/ة/g, "\u0647").replace(/\s+/g, " ");
}
function classifyIdentity(ctx, row) {
  const invoiceCustomerId = getInvoiceCustomerId(row);
  const customerIdMatch = Boolean(ctx.customerId && invoiceCustomerId && ctx.customerId === invoiceCustomerId);
  const casePhone = ctx.customerPhone ? normalizeEgyptianCustomerPhone(ctx.customerPhone) : "";
  const invoicePhone = getInvoiceCustomerPhone(row);
  const invoicePhoneNormalized = invoicePhone ? normalizeEgyptianCustomerPhone(invoicePhone) : "";
  const phoneMatch = Boolean(
    casePhone && invoicePhoneNormalized && isValidEgyptianCustomerMobile(casePhone) && casePhone === invoicePhoneNormalized
  );
  let identityConflict = "none";
  if (phoneMatch && ctx.customerId && invoiceCustomerId && ctx.customerId !== invoiceCustomerId) {
    identityConflict = "phone_vs_customer_id_conflict";
  }
  return { customerIdMatch, phoneMatch, identityConflict };
}
function classifyBranch(ctx, row) {
  const caseNormalized = ctx.branchNameRaw ? normalizeBranchName(ctx.branchNameRaw) : null;
  const invoiceRawText = cleanText2(firstValue2(row, ["branch_name", "branch"]));
  const invoiceNormalized = invoiceRawText ? normalizeBranchName(invoiceRawText) : null;
  if (!caseNormalized || !invoiceNormalized || caseNormalized === UNKNOWN_BRANCH_LABEL || invoiceNormalized === UNKNOWN_BRANCH_LABEL) {
    return "unknown";
  }
  if (caseNormalized !== invoiceNormalized) return "mismatch";
  return CANONICAL_BRANCH_LABELS.has(caseNormalized) ? "exact_canonical" : "normalized_alias_match";
}
function classifyTime(ctx, row) {
  const { iso: invoiceIso, precise } = getInvoiceDateTimeForAttribution(row);
  if (!invoiceIso) return { timeDistanceMinutes: null, timeMatchStrength: "unknown", temporalInversion: false };
  const invoiceMs = new Date(invoiceIso).getTime();
  const startMs = ctx.caseStartedAt ? new Date(ctx.caseStartedAt).getTime() : NaN;
  const endMsRaw = ctx.caseEndedAt ? new Date(ctx.caseEndedAt).getTime() : NaN;
  const hasStart = Number.isFinite(startMs);
  const hasEnd = Number.isFinite(endMsRaw);
  if (!Number.isFinite(invoiceMs) || !hasStart && !hasEnd) {
    return { timeDistanceMinutes: null, timeMatchStrength: "unknown", temporalInversion: false };
  }
  const effectiveStartMs = hasStart ? startMs : endMsRaw;
  const effectiveEndMs = hasEnd ? Math.max(endMsRaw, effectiveStartMs) : effectiveStartMs;
  let diffMinutes;
  if (invoiceMs < effectiveStartMs) diffMinutes = (invoiceMs - effectiveStartMs) / 6e4;
  else if (invoiceMs <= effectiveEndMs) diffMinutes = 0;
  else diffMinutes = (invoiceMs - effectiveEndMs) / 6e4;
  const absMinutes = Math.abs(diffMinutes);
  const temporalInversion = diffMinutes < -TIME_MATCH_BANDS.temporalInversionGraceMinutes;
  let strength;
  if (temporalInversion) {
    strength = "very_weak";
  } else if (!precise) {
    strength = absMinutes <= TIME_MATCH_BANDS.weakMaxMinutes ? "weak" : "very_weak";
  } else if (absMinutes <= TIME_MATCH_BANDS.veryStrongMaxMinutes) {
    strength = "very_strong";
  } else if (absMinutes <= TIME_MATCH_BANDS.strongMaxMinutes) {
    strength = "strong";
  } else if (absMinutes <= TIME_MATCH_BANDS.moderateMaxMinutes) {
    strength = "moderate";
  } else if (absMinutes <= TIME_MATCH_BANDS.weakMaxMinutes) {
    strength = "weak";
  } else {
    strength = "very_weak";
  }
  return { timeDistanceMinutes: Math.round(diffMinutes), timeMatchStrength: strength, temporalInversion };
}
function classifyAmountMatch(expected, actual) {
  if (expected == null || actual == null) return "not_available";
  const diff = Math.abs(expected - actual);
  if (diff === 0) return "exact";
  const tolerance = Math.max(AMOUNT_MATCH_TOLERANCE.absoluteEgp, expected * AMOUNT_MATCH_TOLERANCE.relativeFraction);
  return diff <= tolerance ? "near_match" : "different";
}
function classifyStaff(ctx, row) {
  const invoiceStaffId = getInvoiceStaffId(row);
  if (!invoiceStaffId || ctx.knownStaffIds.length === 0) return "unknown";
  if (ctx.knownStaffIds.includes(invoiceStaffId)) return "same";
  return ctx.knownStaffIds.length > 1 ? "compatible" : "different";
}
function classifyProductEvidence(ctx, row, provider) {
  const items = provider.getItemsForInvoice(getInvoiceRowId(row), getInvoiceRowNumber(row));
  if (items === "unavailable" || ctx.activeBasketItems.length === 0) {
    return { productMatch: "unavailable", quantityMatch: "unavailable" };
  }
  const sellableItems = items.filter(
    (item) => item.quantity != null && Number(item.quantity) > 0
  );
  const invoiceByProductId = new Map(
    sellableItems.filter((i) => i.productId).map((i) => [String(i.productId), i])
  );
  const invoiceByName = new Map(
    sellableItems.map((i) => [normalizeProductNameForMatch(i.productNameRaw), i])
  );
  const matchedPairs = ctx.activeBasketItems.map((basketItem) => {
    const canonical = basketItem.productId ? invoiceByProductId.get(String(basketItem.productId)) : null;
    const byName = canonical ?? invoiceByName.get(normalizeProductNameForMatch(basketItem.productNameRaw));
    return byName ? { basketItem, invoiceItem: byName } : null;
  }).filter(Boolean);
  const productMatch = matchedPairs.length > 0 ? "available_match" : "available_mismatch";
  let quantityMatch = "unavailable";
  if (matchedPairs.length > 0) {
    const allQuantitiesAgree = matchedPairs.every(
      ({ basketItem, invoiceItem }) => basketItem.quantity == null || invoiceItem.quantity == null || basketItem.quantity === invoiceItem.quantity
    );
    quantityMatch = allQuantitiesAgree ? "available_match" : "available_mismatch";
  }
  return { productMatch, quantityMatch };
}
function classifyLegacyMatch(ctx, row) {
  const invoiceId2 = getInvoiceRowId(row);
  const invoiceNumber2 = getInvoiceRowNumber(row);
  if (ctx.legacyMatchedInvoiceId && ctx.legacyMatchedInvoiceId === invoiceId2) return true;
  if (ctx.legacyMatchedInvoiceNumber && invoiceNumber2 && ctx.legacyMatchedInvoiceNumber === invoiceNumber2) return true;
  return false;
}
function classifyDirectLinks(ctx, row) {
  const invoiceId2 = getInvoiceRowId(row);
  const invoiceNumber2 = getInvoiceRowNumber(row);
  const directInvoiceLink = Boolean(
    ctx.trustedInvoiceId && ctx.trustedInvoiceId === invoiceId2 || ctx.trustedInvoiceNumber && invoiceNumber2 && ctx.trustedInvoiceNumber === invoiceNumber2
  );
  return { directOrderLink: false, directInvoiceLink };
}
function scoreCandidate(input) {
  const W = ATTRIBUTION_FACTOR_WEIGHTS;
  let score = 0;
  const factors = [];
  const disqualifiers = [];
  if (input.customerIdMatch) {
    score += W.customerIdMatch;
    factors.push("customer_id_match");
  }
  if (input.phoneMatch) {
    score += W.phoneMatch;
    factors.push("phone_match");
  }
  if (input.branchMatch === "exact_canonical") {
    score += W.branchExactCanonical;
    factors.push("branch_exact_canonical");
  } else if (input.branchMatch === "normalized_alias_match") {
    score += W.branchAlias;
    factors.push("branch_alias_match");
  } else if (input.branchMatch === "mismatch") {
    disqualifiers.push("branch_mismatch");
  }
  if (input.timeMatchStrength === "very_strong") {
    score += W.timeVeryStrong;
    factors.push("time_very_strong");
  } else if (input.timeMatchStrength === "strong") {
    score += W.timeStrong;
    factors.push("time_strong");
  } else if (input.timeMatchStrength === "moderate") {
    score += W.timeModerate;
    factors.push("time_moderate");
  } else if (input.timeMatchStrength === "weak") {
    score += W.timeWeak;
    factors.push("time_weak");
  }
  if (input.temporalInversion) disqualifiers.push("temporal_inversion_invoice_predates_case");
  if (input.announcedTotalMatch === "exact") {
    score += W.announcedTotalExact;
    factors.push("announced_total_exact");
  } else if (input.announcedTotalMatch === "near_match") {
    score += W.announcedTotalNear;
    factors.push("announced_total_near");
  } else if (input.announcedTotalMatch === "different") {
    disqualifiers.push("announced_total_different");
  }
  if (input.basketValueMatch === "exact") {
    score += W.basketValueExact;
    factors.push("basket_value_exact");
  } else if (input.basketValueMatch === "near_match") {
    score += W.basketValueNear;
    factors.push("basket_value_near");
  }
  if (input.staffMatch === "same") {
    score += W.staffSame;
    factors.push("staff_same");
  } else if (input.staffMatch === "compatible") {
    score += W.staffCompatible;
    factors.push("staff_compatible");
  }
  if (input.legacyEvidenceMatch) {
    score += W.legacyMatch;
    factors.push("legacy_v17_match");
  }
  if (input.productMatch === "available_match") {
    score += W.productMatch;
    factors.push("product_match");
  } else if (input.productMatch === "available_mismatch") {
    disqualifiers.push("product_mismatch");
  }
  if (input.identityConflict !== "none") disqualifiers.push("identity_conflict");
  return { score: Math.min(1, Math.max(0, score)), disqualifiers, factors };
}
function deriveLevel(score, disqualifiers, hasIdentitySignal) {
  if (disqualifiers.includes("identity_conflict")) return "weakly_inferred";
  if (score >= ATTRIBUTION_LEVEL_THRESHOLDS.stronglyInferredMinScore && hasIdentitySignal && disqualifiers.length === 0) {
    return "strongly_inferred";
  }
  if (score >= ATTRIBUTION_LEVEL_THRESHOLDS.weaklyInferredMinScore) return "weakly_inferred";
  return "unknown";
}
function buildEvidenceItems(input) {
  const W = ATTRIBUTION_FACTOR_WEIGHTS;
  const items = [
    {
      kind: "same_customer_id",
      matched: input.identity.customerIdMatch,
      detail: input.identity.customerIdMatch ? "\u062A\u0637\u0627\u0628\u0642 \u062A\u0627\u0645 \u0644\u0645\u0639\u0631\u0641 \u0627\u0644\u0639\u0645\u064A\u0644 \u0627\u0644\u0623\u0633\u0627\u0633\u064A (customer_id)." : "\u0644\u0627 \u064A\u0648\u062C\u062F \u062A\u0637\u0627\u0628\u0642 \u0644\u0645\u0639\u0631\u0641 \u0627\u0644\u0639\u0645\u064A\u0644 \u0627\u0644\u0623\u0633\u0627\u0633\u064A.",
      weight: input.identity.customerIdMatch ? W.customerIdMatch : 0
    },
    {
      kind: "same_phone",
      matched: input.identity.phoneMatch,
      detail: input.identity.phoneMatch ? "\u062A\u0637\u0627\u0628\u0642 \u062A\u0627\u0645 \u0644\u0631\u0642\u0645 \u0627\u0644\u0647\u0627\u062A\u0641 \u0628\u0639\u062F \u0627\u0644\u062A\u0637\u0628\u064A\u0639 \u0627\u0644\u0645\u0635\u0631\u064A." : "\u0644\u0627 \u064A\u0648\u062C\u062F \u062A\u0637\u0627\u0628\u0642 \u0644\u0631\u0642\u0645 \u0627\u0644\u0647\u0627\u062A\u0641.",
      weight: input.identity.phoneMatch ? W.phoneMatch : 0
    },
    {
      kind: "same_branch",
      matched: input.branchMatch === "exact_canonical" || input.branchMatch === "normalized_alias_match",
      detail: `\u062A\u0635\u0646\u064A\u0641 \u0645\u0637\u0627\u0628\u0642\u0629 \u0627\u0644\u0641\u0631\u0639: ${input.branchMatch}.`,
      weight: input.branchMatch === "exact_canonical" ? W.branchExactCanonical : input.branchMatch === "normalized_alias_match" ? W.branchAlias : 0
    },
    {
      kind: "time_proximity",
      matched: input.time.timeMatchStrength !== "unknown" && input.time.timeMatchStrength !== "very_weak",
      detail: `\u0627\u0644\u0641\u0627\u0631\u0642 \u0627\u0644\u0632\u0645\u0646\u064A \u0628\u064A\u0646 \u0646\u0647\u0627\u064A\u0629 \u0627\u0644\u0645\u062D\u0627\u062F\u062B\u0629 \u0648\u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629: ${input.time.timeDistanceMinutes ?? "\u063A\u064A\u0631 \u0645\u0639\u0631\u0648\u0641"} \u062F\u0642\u064A\u0642\u0629 (${input.time.timeMatchStrength}).`,
      weight: input.time.timeMatchStrength === "very_strong" ? W.timeVeryStrong : input.time.timeMatchStrength === "strong" ? W.timeStrong : input.time.timeMatchStrength === "moderate" ? W.timeModerate : input.time.timeMatchStrength === "weak" ? W.timeWeak : 0
    },
    {
      kind: "announced_total_match",
      matched: input.announcedTotalMatch === "exact" || input.announcedTotalMatch === "near_match",
      detail: `\u0645\u0637\u0627\u0628\u0642\u0629 \u0627\u0644\u0625\u062C\u0645\u0627\u0644\u064A \u0627\u0644\u0645\u0639\u0644\u0646 \u0645\u0642\u0627\u0628\u0644 \u0642\u064A\u0645\u0629 \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 (${input.invoiceAmount} \u062C\u0646\u064A\u0647): ${input.announcedTotalMatch}.`,
      weight: input.announcedTotalMatch === "exact" ? W.announcedTotalExact : input.announcedTotalMatch === "near_match" ? W.announcedTotalNear : 0
    },
    {
      kind: "basket_value_match",
      matched: input.basketValueMatch === "exact" || input.basketValueMatch === "near_match",
      detail: `\u0645\u0637\u0627\u0628\u0642\u0629 \u0642\u064A\u0645\u0629 \u0627\u0644\u0633\u0644\u0629 \u0627\u0644\u0645\u062D\u0633\u0648\u0628\u0629: ${input.basketValueMatch}.`,
      weight: input.basketValueMatch === "exact" ? W.basketValueExact : input.basketValueMatch === "near_match" ? W.basketValueNear : 0
    },
    {
      kind: input.staffMatch === "same" ? "same_staff" : "compatible_staff",
      matched: input.staffMatch === "same" || input.staffMatch === "compatible",
      detail: `\u062A\u0648\u0627\u0641\u0642 \u0627\u0644\u0645\u0648\u0638\u0641: ${input.staffMatch}.`,
      weight: input.staffMatch === "same" ? W.staffSame : input.staffMatch === "compatible" ? W.staffCompatible : 0
    },
    {
      kind: "product_match",
      matched: input.productMatch === "available_match",
      detail: `\u0623\u062F\u0644\u0629 \u0627\u0644\u0645\u0646\u062A\u062C \u0639\u0644\u0649 \u0645\u0633\u062A\u0648\u0649 \u0627\u0644\u0628\u0646\u062F: ${input.productMatch}.`,
      weight: input.productMatch === "available_match" ? W.productMatch : 0
    },
    {
      kind: "quantity_match",
      matched: input.quantityMatch === "available_match",
      detail: `\u0623\u062F\u0644\u0629 \u0627\u0644\u0643\u0645\u064A\u0629 \u0639\u0644\u0649 \u0645\u0633\u062A\u0648\u0649 \u0627\u0644\u0628\u0646\u062F: ${input.quantityMatch}.`,
      weight: 0
    }
  ];
  if (input.identity.identityConflict !== "none") {
    items.push({
      kind: "identity_conflict",
      matched: true,
      detail: "\u0627\u0644\u0647\u0627\u062A\u0641 \u0645\u062A\u0637\u0627\u0628\u0642 \u0644\u0643\u0646 \u0645\u0639\u0631\u0641 \u0627\u0644\u0639\u0645\u064A\u0644 \u0641\u064A \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 \u064A\u0634\u064A\u0631 \u0625\u0644\u0649 \u0639\u0645\u064A\u0644 \u0645\u062E\u062A\u0644\u0641 \u2014 \u064A\u062A\u0637\u0644\u0628 \u0645\u0631\u0627\u062C\u0639\u0629 \u0628\u0634\u0631\u064A\u0629\u060C \u0644\u0627 \u062A\u062E\u0645\u064A\u0646.",
      weight: 0
    });
  }
  if (input.branchMatch === "mismatch") {
    items.push({
      kind: "branch_mismatch",
      matched: true,
      detail: "\u0641\u0631\u0639 \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 \u064A\u062E\u062A\u0644\u0641 \u0639\u0646 \u0641\u0631\u0639 \u0627\u0644\u0645\u062D\u0627\u062F\u062B\u0629 \u0627\u0644\u0645\u0639\u0631\u0648\u0641.",
      weight: 0
    });
  }
  if (input.time.temporalInversion) {
    items.push({
      kind: "temporal_inversion",
      matched: true,
      detail: "\u062A\u0627\u0631\u064A\u062E/\u0648\u0642\u062A \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 \u064A\u0633\u0628\u0642 \u0646\u0647\u0627\u064A\u0629 \u0627\u0644\u0645\u062D\u0627\u062F\u062B\u0629 \u0632\u0645\u0646\u064A\u064B\u0627 \u2014 \u0625\u0634\u0627\u0631\u0629 \u063A\u064A\u0631 \u0637\u0628\u064A\u0639\u064A\u0629 \u062A\u0633\u062A\u062D\u0642 \u0627\u0644\u0645\u0631\u0627\u062C\u0639\u0629.",
      weight: 0
    });
  }
  if (input.legacyEvidenceMatch) {
    items.push({
      kind: "legacy_v17_match",
      matched: true,
      detail: "\u064A\u062F\u0639\u0645\u0647 \u062F\u0644\u064A\u0644 V17 (\u0631\u0642\u0645/\u0645\u0639\u0631\u0641 \u0641\u0627\u062A\u0648\u0631\u0629 \u0645\u0637\u0627\u0628\u0642 \u0645\u0646 whatsapp_sales_opportunities_v17) \u2014 \u062F\u0644\u064A\u0644 \u0645\u0633\u0627\u0639\u062F \u0641\u0642\u0637\u060C \u063A\u064A\u0631 \u0643\u0627\u0641\u064D \u0648\u062D\u062F\u0647.",
      weight: W.legacyMatch
    });
  }
  if (input.directInvoiceLink) {
    items.push({
      kind: "direct_invoice_id",
      matched: true,
      detail: "\u0631\u0627\u0628\u0637 \u0641\u0627\u062A\u0648\u0631\u0629 \u0645\u0648\u062B\u0648\u0642 \u0648\u0645\u062E\u0632\u064E\u0651\u0646 \u0645\u0633\u0628\u0642\u064B\u0627 \u0639\u0644\u0649 \u0645\u0633\u062A\u0648\u0649 \u0627\u0644\u0646\u0638\u0627\u0645 (\u0648\u0644\u064A\u0633 \u062A\u062E\u0645\u064A\u0646\u064B\u0627 \u0625\u062D\u0635\u0627\u0626\u064A\u064B\u0627).",
      weight: 1
    });
  }
  if (input.directOrderLink) {
    items.push({ kind: "direct_order_id", matched: true, detail: "\u0631\u0627\u0628\u0637 \u0637\u0644\u0628 \u0645\u0648\u062B\u0648\u0642.", weight: 1 });
  }
  return items;
}
function summarizeEvidenceRef(invoiceId2, matchedFactors) {
  return {
    sourceTable: "sales_invoices",
    sourceId: invoiceId2,
    description: matchedFactors.length > 0 ? `\u0639\u0648\u0627\u0645\u0644 \u0627\u0644\u062A\u0637\u0627\u0628\u0642 \u0627\u0644\u0645\u062A\u062D\u0642\u0642\u0629: ${matchedFactors.join(", ")}.` : "\u0644\u0627 \u062A\u0648\u062C\u062F \u0639\u0648\u0627\u0645\u0644 \u062A\u0637\u0627\u0628\u0642 \u0645\u062A\u062D\u0642\u0642\u0629 \u0644\u0647\u0630\u0647 \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 \u0627\u0644\u0645\u0631\u0634\u062D\u0629."
  };
}
function buildAttributionCandidate(ctx, row, itemEvidenceProvider = unavailableInvoiceItemEvidenceProvider) {
  const invoiceId2 = getInvoiceRowId(row);
  const invoiceNumber2 = getInvoiceRowNumber(row);
  const identity = classifyIdentity(ctx, row);
  const branchMatch = classifyBranch(ctx, row);
  const time2 = classifyTime(ctx, row);
  const invoiceAmount = getInvoiceAmount(row);
  const announcedTotalMatch = classifyAmountMatch(ctx.activeAnnouncedTotal?.amount ?? null, invoiceAmount);
  const basketValueMatch = classifyAmountMatch(ctx.activeBasketValue, invoiceAmount);
  const staffMatch = classifyStaff(ctx, row);
  const { productMatch, quantityMatch } = classifyProductEvidence(ctx, row, itemEvidenceProvider);
  const legacyEvidenceMatch = classifyLegacyMatch(ctx, row);
  const { directOrderLink, directInvoiceLink } = classifyDirectLinks(ctx, row);
  const { score, disqualifiers, factors } = scoreCandidate({
    customerIdMatch: identity.customerIdMatch,
    phoneMatch: identity.phoneMatch,
    identityConflict: identity.identityConflict,
    branchMatch,
    timeMatchStrength: time2.timeMatchStrength,
    temporalInversion: time2.temporalInversion,
    announcedTotalMatch,
    basketValueMatch,
    staffMatch,
    legacyEvidenceMatch,
    productMatch
  });
  if (isDraftLikeZeroInvoice(row)) {
    disqualifiers.push("draft_zero_invoice");
  }
  const hasIdentitySignal = identity.customerIdMatch || identity.phoneMatch;
  const level = directInvoiceLink ? "proven" : deriveLevel(score, disqualifiers, hasIdentitySignal);
  const ruleIds = [`attribution.level.${level}`, ...factors.map((f) => `attribution.factor.${f}`)];
  const evidence = buildEvidenceItems({
    identity,
    branchMatch,
    time: time2,
    announcedTotalMatch,
    basketValueMatch,
    staffMatch,
    productMatch,
    quantityMatch,
    legacyEvidenceMatch,
    directOrderLink,
    directInvoiceLink,
    invoiceAmount
  });
  const confidenceAssessment = {
    level,
    score: directInvoiceLink ? 1 : score,
    ruleIds,
    evidence: [summarizeEvidenceRef(invoiceId2, factors)]
  };
  return {
    caseId: ctx.caseId,
    invoiceId: invoiceId2,
    invoiceNumber: invoiceNumber2,
    customerIdMatch: identity.customerIdMatch,
    phoneMatch: identity.phoneMatch,
    identityConflict: identity.identityConflict,
    branchMatch,
    timeDistanceMinutes: time2.timeDistanceMinutes,
    timeMatchStrength: time2.timeMatchStrength,
    staffMatch,
    announcedTotalMatch,
    basketValueMatch,
    productMatch,
    quantityMatch,
    legacyEvidenceMatch,
    directOrderLink,
    directInvoiceLink,
    evidence,
    ruleIds,
    confidenceAssessment,
    disqualifiers
  };
}
function deriveSaleAttributionAssessment(ctx, invoiceRows, itemEvidenceProvider = unavailableInvoiceItemEvidenceProvider, competingSelections = []) {
  const commercialConfirmationState = ctx.commercialConfirmation.currentState;
  const candidates = invoiceRows.map((row) => buildAttributionCandidate(ctx, row, itemEvidenceProvider));
  candidates.sort((a, b) => b.confidenceAssessment.score - a.confidenceAssessment.score);
  if (candidates.length === 0) {
    return {
      caseId: ctx.caseId,
      commercialConfirmationState,
      candidateCount: 0,
      selectedInvoiceId: null,
      selectedInvoiceNumber: null,
      selectedCandidate: null,
      alternativeCandidates: [],
      attributionLevel: "unknown",
      confidence: { level: "unknown", score: 0, ruleIds: ["attribution.assessment.no_candidates"], evidence: [] },
      primaryEvidence: [],
      contradictions: [],
      needsHumanReview: false,
      humanReviewReasons: [],
      isOfficialForStaffEvaluation: false,
      legacyEvidenceUsed: false,
      ruleIds: ["attribution.assessment.no_candidates"],
      hasAttributedInvoice: false,
      competingCaseIds: []
    };
  }
  const legacyEvidenceUsed = candidates.some((c) => c.legacyEvidenceMatch);
  const directLinked = candidates.find((c) => c.directInvoiceLink) ?? null;
  const hasIndependentTransactionalCorroboration = (candidate) => candidate.announcedTotalMatch === "exact" || candidate.announcedTotalMatch === "near_match" || candidate.basketValueMatch === "exact" || candidate.basketValueMatch === "near_match" || candidate.productMatch === "available_match" || candidate.quantityMatch === "available_match" || candidate.staffMatch === "same";
  const isStatisticallySelectable = (candidate) => {
    if (candidate.disqualifiers.includes("temporal_inversion_invoice_predates_case")) return false;
    if (candidate.disqualifiers.includes("draft_zero_invoice")) return false;
    if (candidate.timeMatchStrength === "very_strong" || candidate.timeMatchStrength === "strong" || candidate.timeMatchStrength === "moderate") {
      return true;
    }
    return hasIndependentTransactionalCorroboration(candidate);
  };
  const selectableCandidates = directLinked ? [directLinked, ...candidates.filter((c) => c !== directLinked && isStatisticallySelectable(c))] : candidates.filter(isStatisticallySelectable);
  if (selectableCandidates.length === 0) {
    const rejectedTop = candidates[0];
    const temporalInversion = rejectedTop?.disqualifiers.includes("temporal_inversion_invoice_predates_case") ?? false;
    const draftZero = rejectedTop?.disqualifiers.includes("draft_zero_invoice") ?? false;
    const reason = temporalInversion ? "invoice_predates_case_start" : draftZero ? "draft_zero_invoice_not_transaction_truth" : "statistical_invoice_lacks_transactional_corroboration";
    const ruleId = temporalInversion ? "attribution.assessment.no_temporally_valid_candidates" : draftZero ? "attribution.assessment.draft_zero_invoice_rejected" : "attribution.assessment.no_selectable_transaction_link";
    return {
      caseId: ctx.caseId,
      commercialConfirmationState,
      candidateCount: candidates.length,
      selectedInvoiceId: null,
      selectedInvoiceNumber: null,
      selectedCandidate: null,
      alternativeCandidates: candidates,
      attributionLevel: "unknown",
      confidence: {
        level: "unknown",
        score: 0,
        ruleIds: [ruleId],
        evidence: rejectedTop?.confidenceAssessment.evidence ?? []
      },
      primaryEvidence: rejectedTop?.evidence ?? [],
      contradictions: temporalInversion ? ["temporal_inversion"] : [],
      needsHumanReview: true,
      humanReviewReasons: [reason],
      isOfficialForStaffEvaluation: false,
      legacyEvidenceUsed,
      ruleIds: [ruleId],
      hasAttributedInvoice: false,
      competingCaseIds: []
    };
  }
  const top = directLinked ?? selectableCandidates[0];
  const second = selectableCandidates.find((c) => c !== top) ?? null;
  const contradictions = [];
  const humanReviewReasons = [];
  if (top.identityConflict !== "none") {
    contradictions.push("identity_conflict");
    humanReviewReasons.push("customer_identity_conflict");
  }
  if (top.disqualifiers.includes("temporal_inversion_invoice_predates_case")) {
    contradictions.push("temporal_inversion");
    humanReviewReasons.push("invoice_predates_case_start");
  }
  let ambiguous = false;
  if (!directLinked && second && second.confidenceAssessment.level === top.confidenceAssessment.level && Math.abs(top.confidenceAssessment.score - second.confidenceAssessment.score) <= AMBIGUITY_SCORE_MARGIN) {
    ambiguous = true;
    contradictions.push("ambiguous_multiple_candidates");
    humanReviewReasons.push("ambiguous_multiple_candidates");
  }
  const competingCaseIds = Array.from(
    new Set(
      competingSelections.filter((s) => s.invoiceId === top.invoiceId && s.caseId !== ctx.caseId).map((s) => s.caseId)
    )
  );
  if (competingCaseIds.length > 0) {
    contradictions.push("competing_case_attribution");
    humanReviewReasons.push("competing_case_attribution");
  }
  let attributionLevel = top.confidenceAssessment.level;
  if (ambiguous && attributionLevel === "strongly_inferred") attributionLevel = "weakly_inferred";
  const topHasIndependentTransactionalCorroboration = hasIndependentTransactionalCorroboration(top);
  const statisticalOfficialTimingOk = top.timeMatchStrength === "very_strong" || top.timeMatchStrength === "strong" || top.timeMatchStrength === "moderate" && topHasIndependentTransactionalCorroboration;
  const isOfficialForStaffEvaluation = attributionLevel === "proven" && contradictions.length === 0 && top.disqualifiers.length === 0 || attributionLevel === "strongly_inferred" && !ambiguous && contradictions.length === 0 && top.identityConflict === "none" && competingCaseIds.length === 0 && top.disqualifiers.length === 0 && statisticalOfficialTimingOk;
  if (attributionLevel === "strongly_inferred" && !directLinked && !statisticalOfficialTimingOk && !humanReviewReasons.includes("statistical_invoice_lacks_transactional_corroboration")) {
    humanReviewReasons.push("statistical_invoice_lacks_transactional_corroboration");
  }
  const needsHumanReview = humanReviewReasons.length > 0 || attributionLevel === "unknown" && top.confidenceAssessment.score > 0;
  if (needsHumanReview && !humanReviewReasons.includes("insufficient_evidence") && attributionLevel === "unknown") {
    humanReviewReasons.push("insufficient_evidence");
  }
  return {
    caseId: ctx.caseId,
    commercialConfirmationState,
    candidateCount: candidates.length,
    selectedInvoiceId: top.invoiceId,
    selectedInvoiceNumber: top.invoiceNumber,
    selectedCandidate: top,
    alternativeCandidates: candidates.filter((c) => c !== top),
    attributionLevel,
    confidence: {
      level: attributionLevel,
      score: top.confidenceAssessment.score,
      ruleIds: top.ruleIds,
      evidence: top.confidenceAssessment.evidence
    },
    primaryEvidence: top.evidence,
    contradictions,
    needsHumanReview,
    humanReviewReasons,
    isOfficialForStaffEvaluation,
    legacyEvidenceUsed,
    ruleIds: [...top.ruleIds, ...ambiguous ? ["attribution.assessment.ambiguous"] : []],
    hasAttributedInvoice: attributionLevel === "proven" || attributionLevel === "strongly_inferred",
    competingCaseIds
  };
}

// src/lib/salesIntelligence/basketInvoiceMatchingEngine.ts
var AMOUNT_TOLERANCE = {
  /** Genuine rounding/float noise only — max observed real fractional part is 0.5 EGP. */
  technicalToleranceEgp: 1,
  /** A small, still-visible business-level gap — purely relative, no flat absolute override. */
  nearMatchRelativeFraction: 0.03
};
function assessment3(level, score, ruleIds, evidence) {
  return { level, score, ruleIds, evidence };
}
function amountRef(description) {
  return { sourceTable: "sales_invoices", sourceId: "", description };
}
function resolveActiveBasket(baskets) {
  const candidates = baskets.filter((b) => b.status !== "superseded");
  if (candidates.length === 0) return { outcome: "insufficient_data" };
  if (candidates.length === 1) return { outcome: "selected", basket: candidates[0] };
  const conflictingBaskets = [...candidates].sort((a, b) => b.version - a.version);
  return { outcome: "needs_human_review", conflictingBaskets };
}
function classifyAmountDifference(expected, actual) {
  if (expected == null || actual == null) return "not_available";
  const diff = Math.abs(expected - actual);
  if (diff <= AMOUNT_TOLERANCE.technicalToleranceEgp) return "exact";
  const nearMatchTolerance = Math.max(
    AMOUNT_TOLERANCE.technicalToleranceEgp,
    Math.abs(expected) * AMOUNT_TOLERANCE.nearMatchRelativeFraction
  );
  return diff <= nearMatchTolerance ? "near_match" : "different";
}
function mapAmountToFieldStatus(kind) {
  if (kind === "different") return "mismatch";
  if (kind === "not_available") return "insufficient_data";
  return kind;
}
function explainTotalGap(rawDiff, adjustments) {
  if (adjustments.length === 0) return { explanation: "none", evidence: [] };
  const adjustmentSum = adjustments.reduce((sum, a) => sum + a.amount, 0);
  const residual = Math.abs(rawDiff - adjustmentSum);
  if (residual > AMOUNT_TOLERANCE.technicalToleranceEgp) return { explanation: "none", evidence: [] };
  const kinds = new Set(adjustments.map((a) => a.kind));
  const explanation = kinds.size === 1 ? adjustments[0].kind : "documented_edit";
  return { explanation, evidence: adjustments.flatMap((a) => a.evidence) };
}
function classifyTotalMatch(activeBasket, invoiceRow) {
  const basketAmount = activeBasket.announcedTotal?.amount ?? null;
  const invoiceAmount = invoiceRow ? getInvoiceAmount(invoiceRow) : null;
  const status = mapAmountToFieldStatus(classifyAmountDifference(basketAmount, invoiceAmount));
  return { status, basketAmount, invoiceAmount };
}
function quantityConfidenceFor(basis) {
  if (basis === "canonical_id") return assessment3("proven", 0.95, ["matching.item.quantity_mismatch.canonical_id"], []);
  return assessment3("strongly_inferred", 0.75, ["matching.item.quantity_mismatch.normalized_name"], []);
}
function classifyItemsAndQuantities(basketItems, invoiceId2, invoiceNumber2, provider) {
  const invoiceItems = provider.getItemsForInvoice(invoiceId2, invoiceNumber2);
  if (invoiceItems === "unavailable") {
    return { itemMatch: "insufficient_data", quantityMatch: "insufficient_data", differences: [], itemEvidenceReady: false, needsHumanReview: false, humanReviewReasons: [] };
  }
  if (basketItems.length === 0) {
    return { itemMatch: "insufficient_data", quantityMatch: "insufficient_data", differences: [], itemEvidenceReady: true, needsHumanReview: false, humanReviewReasons: [] };
  }
  const sellableInvoiceItems = invoiceItems.filter(
    (item) => item.quantity != null && Number(item.quantity) > 0
  );
  const invoiceGroupsByName = /* @__PURE__ */ new Map();
  sellableInvoiceItems.forEach((i) => {
    const key = normalizeProductNameForMatch(i.productNameRaw);
    const group = invoiceGroupsByName.get(key) ?? [];
    group.push(i);
    invoiceGroupsByName.set(key, group);
  });
  const invoiceGroupsByProductId = /* @__PURE__ */ new Map();
  sellableInvoiceItems.forEach((i) => {
    if (!i.productId) return;
    const key = String(i.productId);
    const group = invoiceGroupsByProductId.get(key) ?? [];
    group.push(i);
    invoiceGroupsByProductId.set(key, group);
  });
  const differences = [];
  const matchedPairs = [];
  const claimedInvoiceKeys = /* @__PURE__ */ new Set();
  let ambiguousCount = 0;
  let unresolvedCount = 0;
  const humanReviewReasons = [];
  basketItems.forEach((item) => {
    const nameKey = normalizeProductNameForMatch(item.productNameRaw);
    if (item.resolutionStatus === "unknown") {
      const candidates = invoiceGroupsByName.get(nameKey) ?? [];
      if (candidates.length === 0) {
        differences.push({
          type: "missing_item",
          key: item.productNameRaw,
          before: item.quantity,
          after: null,
          explanation: "none",
          evidence: [amountRef(`\u0635\u0646\u0641 \u0628\u0647\u0648\u064A\u0629 \u063A\u064A\u0631 \u0645\u062D\u0644\u0648\u0644\u0629 \u0645\u0646 \u0627\u0644\u0645\u062D\u0627\u062F\u062B\u0629 ("${item.productNameRaw}") \u0644\u0627 \u064A\u0642\u0627\u0628\u0644\u0647 \u0623\u064A \u0628\u0646\u062F \u0641\u064A \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629.`)],
          confidence: assessment3("weakly_inferred", 0.4, ["matching.item.missing.unresolved_identity"], [])
        });
      } else {
        unresolvedCount += 1;
        humanReviewReasons.push("unresolved_product_identity");
      }
      return;
    }
    const canonicalCandidates = item.productId ? invoiceGroupsByProductId.get(String(item.productId)) ?? [] : [];
    if (canonicalCandidates.length === 1) {
      const invoiceItem = canonicalCandidates[0];
      matchedPairs.push({ basketItem: item, invoiceItem, basis: "canonical_id" });
      claimedInvoiceKeys.add(normalizeProductNameForMatch(invoiceItem.productNameRaw));
      return;
    }
    if (canonicalCandidates.length > 1) {
      ambiguousCount += 1;
      humanReviewReasons.push("ambiguous_product_alias");
      return;
    }
    const nameCandidates = invoiceGroupsByName.get(nameKey) ?? [];
    if (nameCandidates.length === 1) {
      matchedPairs.push({ basketItem: item, invoiceItem: nameCandidates[0], basis: "normalized_name" });
      claimedInvoiceKeys.add(nameKey);
    } else if (nameCandidates.length > 1) {
      ambiguousCount += 1;
      humanReviewReasons.push("ambiguous_product_alias");
    } else {
      differences.push({
        type: "missing_item",
        key: item.productNameRaw,
        before: item.quantity,
        after: null,
        explanation: "none",
        evidence: [amountRef(`\u0627\u0644\u0635\u0646\u0641 "${item.productNameRaw}" \u0645\u0648\u062C\u0648\u062F \u0641\u064A \u0627\u0644\u0633\u0644\u0629 \u0648\u0644\u0645 \u064A\u064F\u0639\u062B\u0631 \u0639\u0644\u064A\u0647 \u0641\u064A \u0628\u0646\u0648\u062F \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629.`)],
        confidence: assessment3("proven", 0.9, ["matching.item.missing"], [])
      });
    }
  });
  sellableInvoiceItems.forEach((invoiceItem) => {
    const key = normalizeProductNameForMatch(invoiceItem.productNameRaw);
    if (!claimedInvoiceKeys.has(key) && (invoiceGroupsByName.get(key) ?? []).length === 1) {
      const alreadyReported = differences.some((d) => d.type === "extra_item" && d.key === invoiceItem.productNameRaw);
      if (!alreadyReported) {
        differences.push({
          type: "extra_item",
          key: invoiceItem.productNameRaw,
          before: null,
          after: invoiceItem.quantity,
          explanation: "none",
          evidence: [amountRef(`\u0627\u0644\u0635\u0646\u0641 "${invoiceItem.productNameRaw}" \u0645\u0648\u062C\u0648\u062F \u0641\u064A \u0628\u0646\u0648\u062F \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 \u0648\u0644\u0645 \u064A\u064F\u0639\u062B\u0631 \u0639\u0644\u064A\u0647 \u0641\u064A \u0627\u0644\u0633\u0644\u0629.`)],
          confidence: assessment3("proven", 0.9, ["matching.item.extra"], [])
        });
      }
    }
  });
  const missingCount = differences.filter((d) => d.type === "missing_item").length;
  const extraCount = differences.filter((d) => d.type === "extra_item").length;
  let itemMatch;
  if (missingCount === 0 && extraCount === 0 && ambiguousCount === 0 && unresolvedCount === 0) itemMatch = "exact";
  else if (matchedPairs.length === 0) itemMatch = "mismatch";
  else itemMatch = "partial";
  let quantityMatch;
  if (matchedPairs.length === 0) {
    quantityMatch = "insufficient_data";
  } else {
    let agreed = 0;
    let disagreed = 0;
    matchedPairs.forEach(({ basketItem, invoiceItem, basis }) => {
      if (basketItem.quantity == null || invoiceItem.quantity == null) return;
      if (basketItem.quantity === invoiceItem.quantity) {
        agreed += 1;
      } else {
        disagreed += 1;
        differences.push({
          type: "quantity_mismatch",
          key: basketItem.productNameRaw,
          before: basketItem.quantity,
          after: invoiceItem.quantity,
          explanation: "none",
          evidence: [amountRef(`\u0627\u0644\u0643\u0645\u064A\u0629 \u0641\u064A \u0627\u0644\u0633\u0644\u0629 (${basketItem.quantity}) \u062A\u062E\u062A\u0644\u0641 \u0639\u0646 \u0627\u0644\u0643\u0645\u064A\u0629 \u0641\u064A \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 (${invoiceItem.quantity}) \u0644\u0644\u0635\u0646\u0641 "${basketItem.productNameRaw}".`)],
          confidence: quantityConfidenceFor(basis)
        });
      }
    });
    if (disagreed === 0 && agreed > 0) quantityMatch = "exact";
    else if (disagreed === 0) quantityMatch = "insufficient_data";
    else if (disagreed === matchedPairs.length) quantityMatch = "mismatch";
    else quantityMatch = "partial";
  }
  return {
    itemMatch,
    quantityMatch,
    differences,
    itemEvidenceReady: true,
    needsHumanReview: humanReviewReasons.length > 0,
    humanReviewReasons: Array.from(new Set(humanReviewReasons))
  };
}
function rollupOverallMatch(totalMatch, itemMatch, quantityMatch, itemEvidenceReady) {
  if (!itemEvidenceReady) {
    if (totalMatch === "mismatch") return "mismatch";
    if (totalMatch === "insufficient_data") return "insufficient_data";
    return "partial";
  }
  if (totalMatch === "exact" && itemMatch === "exact" && quantityMatch === "exact") return "exact";
  if (totalMatch === "mismatch" && itemMatch === "mismatch") return "mismatch";
  if (totalMatch === "insufficient_data" && itemMatch === "insufficient_data" && quantityMatch === "insufficient_data") {
    return "insufficient_data";
  }
  return "partial";
}
function resolveIntegrityScope(headerEvidenceReady, itemEvidenceReady) {
  if (!headerEvidenceReady) return "insufficient";
  return itemEvidenceReady ? "header_and_items" : "header_only";
}
function insufficientDataMatch(caseId, ruleId, needsHumanReview = false, humanReviewReasons = []) {
  return {
    matchId: `${caseId}:match:insufficient_data`,
    caseId,
    basketId: null,
    basketVersion: null,
    invoiceId: null,
    invoiceNumber: null,
    totalMatch: "insufficient_data",
    itemMatch: "insufficient_data",
    quantityMatch: "insufficient_data",
    overallMatch: "insufficient_data",
    headerEvidenceReady: false,
    itemEvidenceReady: false,
    integrityEvaluationScope: "insufficient",
    differences: [],
    confidence: assessment3("unknown", 0.2, [ruleId], []),
    needsHumanReview,
    humanReviewReasons,
    ruleIds: [ruleId]
  };
}
function deriveBasketInvoiceMatch(input) {
  const { caseId, attribution } = input;
  if (attribution.attributionLevel === "unknown" || !attribution.selectedInvoiceId) {
    return insufficientDataMatch(caseId, "matching.insufficient_attribution", attribution.needsHumanReview, attribution.humanReviewReasons);
  }
  const resolution = resolveActiveBasket(input.baskets);
  if (resolution.outcome === "insufficient_data") {
    return insufficientDataMatch(caseId, "matching.no_active_basket");
  }
  if (resolution.outcome === "needs_human_review") {
    return insufficientDataMatch(
      caseId,
      "matching.conflicting_active_basket_versions",
      true,
      ["conflicting_active_basket_versions"]
    );
  }
  const activeBasket = resolution.basket;
  if (input.invoiceCancelledOrReturned) {
    return {
      matchId: `${caseId}:match:${activeBasket.basketId}:${attribution.selectedInvoiceId}`,
      caseId,
      basketId: activeBasket.basketId,
      basketVersion: activeBasket.version,
      invoiceId: attribution.selectedInvoiceId,
      invoiceNumber: attribution.selectedInvoiceNumber,
      totalMatch: "mismatch",
      itemMatch: "mismatch",
      quantityMatch: "mismatch",
      overallMatch: "mismatch",
      headerEvidenceReady: false,
      itemEvidenceReady: false,
      integrityEvaluationScope: "insufficient",
      differences: [],
      confidence: assessment3("unknown", 0.3, ["matching.invoice_cancelled_or_returned"], []),
      needsHumanReview: true,
      humanReviewReasons: ["invoice_cancelled_or_returned"],
      ruleIds: ["matching.invoice_cancelled_or_returned"]
    };
  }
  const provider = input.itemEvidenceProvider ?? unavailableInvoiceItemEvidenceProvider;
  const basketItems = input.itemsByBasketId[activeBasket.basketId] || [];
  const adjustments = input.documentedAdjustments ?? [];
  const { status: totalMatch, basketAmount, invoiceAmount } = classifyTotalMatch(activeBasket, input.invoiceRow);
  const headerEvidenceReady = basketAmount != null && invoiceAmount != null;
  const {
    itemMatch,
    quantityMatch,
    differences: itemDifferences,
    itemEvidenceReady,
    needsHumanReview: itemsNeedHumanReview,
    humanReviewReasons: itemHumanReviewReasons
  } = classifyItemsAndQuantities(basketItems, attribution.selectedInvoiceId, attribution.selectedInvoiceNumber, provider);
  const differences = [...itemDifferences];
  if (totalMatch === "near_match") {
    differences.push({
      type: "total_mismatch",
      key: "total",
      before: basketAmount,
      after: invoiceAmount,
      explanation: "none",
      evidence: [amountRef(`\u0641\u0631\u0642 \u0628\u0633\u064A\u0637 \u0636\u0645\u0646 \u0647\u0627\u0645\u0634 \u0627\u0644\u062A\u0633\u0627\u0645\u062D \u0628\u064A\u0646 \u0625\u062C\u0645\u0627\u0644\u064A \u0627\u0644\u0633\u0644\u0629 (${basketAmount}) \u0648\u0625\u062C\u0645\u0627\u0644\u064A \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 (${invoiceAmount}).`)],
      confidence: assessment3("strongly_inferred", 0.7, ["matching.total.near_match"], [])
    });
  } else if (totalMatch === "mismatch") {
    const rawDiff = (invoiceAmount ?? 0) - (basketAmount ?? 0);
    differences.push({
      type: "total_mismatch",
      key: "total",
      before: basketAmount,
      after: invoiceAmount,
      explanation: "none",
      evidence: [amountRef(`\u0641\u0631\u0642 \u062D\u0642\u064A\u0642\u064A \u0628\u064A\u0646 \u0625\u062C\u0645\u0627\u0644\u064A \u0627\u0644\u0633\u0644\u0629 (${basketAmount}) \u0648\u0625\u062C\u0645\u0627\u0644\u064A \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 (${invoiceAmount}).`)],
      confidence: assessment3("proven", 0.9, ["matching.total.mismatch"], [])
    });
    const { explanation, evidence } = explainTotalGap(rawDiff, adjustments);
    differences.push({
      type: explanation === "none" ? "unexplained_difference" : "explained_difference",
      key: "total",
      before: basketAmount,
      after: invoiceAmount,
      explanation,
      evidence,
      confidence: assessment3(
        explanation === "none" ? "unknown" : "strongly_inferred",
        explanation === "none" ? 0.3 : 0.75,
        [explanation === "none" ? "matching.total.unexplained" : "matching.total.explained"],
        evidence
      )
    });
  }
  const overallMatch = rollupOverallMatch(totalMatch, itemMatch, quantityMatch, itemEvidenceReady);
  const integrityEvaluationScope = resolveIntegrityScope(headerEvidenceReady, itemEvidenceReady);
  const humanReviewReasons = [...attribution.humanReviewReasons, ...itemHumanReviewReasons];
  if (differences.some((d) => d.type === "unexplained_difference")) humanReviewReasons.push("unexplained_basket_invoice_difference");
  const totalGapExplained = totalMatch === "mismatch" && differences.some((d) => d.type === "explained_difference");
  const hasItemLevelIssue = itemDifferences.some((d) => d.type === "missing_item" || d.type === "extra_item" || d.type === "quantity_mismatch");
  if (overallMatch === "mismatch" && !(totalGapExplained && !hasItemLevelIssue)) {
    humanReviewReasons.push("basket_invoice_mismatch");
  }
  const dedupedHumanReviewReasons = Array.from(new Set(humanReviewReasons));
  const needsHumanReview = attribution.needsHumanReview || itemsNeedHumanReview || dedupedHumanReviewReasons.length > attribution.humanReviewReasons.length;
  const level = overallMatch === "exact" ? "strongly_inferred" : overallMatch === "insufficient_data" ? "unknown" : "weakly_inferred";
  const score = overallMatch === "exact" ? 0.85 : overallMatch === "partial" ? 0.5 : overallMatch === "mismatch" ? 0.2 : 0.1;
  const ruleIds = [
    `matching.total.${totalMatch}`,
    `matching.item.${itemMatch}`,
    `matching.quantity.${quantityMatch}`,
    `matching.overall.${overallMatch}`,
    `matching.scope.${integrityEvaluationScope}`
  ];
  return {
    matchId: `${caseId}:match:${activeBasket.basketId}:${attribution.selectedInvoiceId}`,
    caseId,
    basketId: activeBasket.basketId,
    basketVersion: activeBasket.version,
    invoiceId: attribution.selectedInvoiceId,
    invoiceNumber: attribution.selectedInvoiceNumber,
    totalMatch,
    itemMatch,
    quantityMatch,
    overallMatch,
    headerEvidenceReady,
    itemEvidenceReady,
    integrityEvaluationScope,
    differences,
    confidence: assessment3(level, score, ruleIds, []),
    needsHumanReview,
    humanReviewReasons: dedupedHumanReviewReasons,
    ruleIds
  };
}

// src/lib/salesIntelligence/salesIntegrityEngine.ts
var STAGE_ORDER = {
  conversation: 0,
  basket_confirmation: 1,
  fulfillment_handoff: 2,
  attribution: 3,
  invoice_header: 4,
  invoice_items: 5,
  delivery: 6,
  unknown: 99
};
var SEVERITY_ORDER = { info: 0, review: 1, high_priority: 2 };
function assessment4(level, score, ruleIds, evidence) {
  return { level, score, ruleIds, evidence };
}
function deriveProtocolPolicyComplianceState(params) {
  const { applicability, protocolCompliant, caseEndedAt, protocolPolicyEffectiveAt } = params;
  if (applicability === "not_applicable") return "not_applicable";
  if (applicability === "not_reached") return "not_reached";
  if (applicability === "unknown") return "unknown";
  if (protocolPolicyEffectiveAt === void 0) {
    return protocolCompliant ? "compliant" : "non_compliant";
  }
  if (protocolPolicyEffectiveAt === null) {
    return "not_enforced";
  }
  if (!caseEndedAt) return "unknown";
  const caseMs = new Date(caseEndedAt).getTime();
  const effMs = new Date(protocolPolicyEffectiveAt).getTime();
  if (!Number.isFinite(caseMs) || !Number.isFinite(effMs)) return "unknown";
  if (caseMs < effMs) return "not_enforced";
  return protocolCompliant ? "compliant" : "non_compliant";
}
function detectProtocolExceptions(input, scope, policyState) {
  const { protocolAssessment, commercialConfirmation } = input;
  const drafts = [];
  if (commercialConfirmation.modificationAfterConfirmation && commercialConfirmation.currentState !== "commercial_confirmation_complete") {
    drafts.push({
      type: "basket_modified_after_confirmation",
      stage: "basket_confirmation",
      severity: "review",
      summary: "\u062A\u0645 \u062A\u0639\u062F\u064A\u0644 \u0627\u0644\u0633\u0644\u0629 \u0628\u0639\u062F \u062A\u0623\u0643\u064A\u062F \u0633\u0627\u0628\u0642 \u0648\u0644\u0645 \u062A\u0635\u0644 \u0627\u0644\u0645\u062D\u0627\u062F\u062B\u0629 \u0644\u062A\u0623\u0643\u064A\u062F \u0643\u0627\u0645\u0644 \u062C\u062F\u064A\u062F \u0628\u0639\u062F.",
      fact: '\u0625\u0635\u062F\u0627\u0631 \u0633\u0627\u0628\u0642 \u0645\u0646 \u0627\u0644\u0633\u0644\u0629 \u0643\u0627\u0646 \u0645\u0624\u0643\u062F\u064B\u0627 \u0645\u0646 \u0627\u0644\u0639\u0645\u064A\u0644\u060C \u062B\u0645 \u062D\u062F\u062B \u062A\u0639\u062F\u064A\u0644\u060C \u0648\u0627\u0644\u062D\u0627\u0644\u0629 \u0627\u0644\u062A\u062C\u0627\u0631\u064A\u0629 \u0627\u0644\u062D\u0627\u0644\u064A\u0629 \u0644\u064A\u0633\u062A "\u0645\u0643\u062A\u0645\u0644\u0629 \u0627\u0644\u062A\u0623\u0643\u064A\u062F".',
      interpretation: "\u0642\u062F \u062A\u0643\u0648\u0646 \u0627\u0644\u0645\u062D\u0627\u062F\u062B\u0629 \u0644\u0627 \u062A\u0632\u0627\u0644 \u062C\u0627\u0631\u064A\u0629 \u0623\u0648 \u062A\u0648\u0642\u0641\u062A \u0628\u0639\u062F \u0627\u0644\u062A\u0639\u062F\u064A\u0644 \u2014 \u0644\u064A\u0633\u062A \u0628\u0627\u0644\u0636\u0631\u0648\u0631\u0629 \u0645\u0634\u0643\u0644\u0629 \u0641\u064A \u0627\u0644\u0628\u064A\u0639.",
      sourceEvidence: [],
      ruleIds: ["integrity.protocol.basket_modified_after_confirmation"],
      confidence: assessment4("strongly_inferred", 0.7, ["integrity.protocol.basket_modified_after_confirmation"], []),
      integrityEvaluationScope: scope,
      needsHumanReview: true
    });
  }
  if (policyState !== "non_compliant") return drafts;
  if (!protocolAssessment.protocolCompliant) {
    const missing = protocolAssessment.missingProtocolSteps;
    if (missing.includes("announced_total")) {
      drafts.push({
        type: "final_total_missing",
        stage: "basket_confirmation",
        severity: "review",
        summary: "\u0644\u0645 \u064A\u064F\u0639\u0644\u0646 \u0627\u0644\u0645\u0648\u0638\u0641 \u0625\u062C\u0645\u0627\u0644\u064A \u062D\u0633\u0627\u0628 \u0635\u0631\u064A\u062D \u0644\u0647\u0630\u0647 \u0627\u0644\u0633\u0644\u0629.",
        fact: "\u0644\u0627 \u064A\u0648\u062C\u062F AnnouncedTotal \u0645\u0633\u062C\u064E\u0651\u0644 \u0644\u0625\u0635\u062F\u0627\u0631 \u0627\u0644\u0633\u0644\u0629 \u0627\u0644\u062D\u0627\u0644\u064A.",
        interpretation: "\u062E\u0637\u0648\u0629 \u0625\u062C\u0631\u0627\u0626\u064A\u0629 \u0646\u0627\u0642\u0635\u0629 \u0641\u064A \u0628\u0631\u0648\u062A\u0648\u0643\u0648\u0644 \u0627\u0644\u062A\u0623\u0643\u064A\u062F \u2014 \u0644\u0627 \u062A\u0639\u0646\u064A \u0628\u0627\u0644\u0636\u0631\u0648\u0631\u0629 \u0648\u062C\u0648\u062F \u062E\u0637\u0623 \u0641\u064A \u0627\u0644\u0628\u064A\u0639 \u0646\u0641\u0633\u0647.",
        sourceEvidence: [],
        ruleIds: ["integrity.protocol.final_total_missing"],
        confidence: assessment4("proven", 0.9, ["integrity.protocol.final_total_missing"], []),
        integrityEvaluationScope: scope,
        needsHumanReview: true
      });
    }
    if (missing.includes("staff_final_confirmation")) {
      drafts.push({
        type: "staff_final_confirmation_missing",
        stage: "basket_confirmation",
        severity: "review",
        summary: "\u0644\u0627 \u064A\u0648\u062C\u062F \u062A\u0623\u0643\u064A\u062F \u0646\u0647\u0627\u0626\u064A \u0645\u0646 \u0627\u0644\u0645\u0648\u0638\u0641 \u0628\u0639\u062F \u0642\u0628\u0648\u0644 \u0627\u0644\u0639\u0645\u064A\u0644.",
        fact: "\u0644\u0627 \u064A\u0648\u062C\u062F StaffFinalConfirmationEvent \u0645\u0633\u062C\u064E\u0651\u0644 \u0644\u0625\u0635\u062F\u0627\u0631 \u0627\u0644\u0633\u0644\u0629 \u0627\u0644\u062D\u0627\u0644\u064A \u0631\u063A\u0645 \u062A\u0623\u0643\u064A\u062F \u0627\u0644\u0639\u0645\u064A\u0644.",
        interpretation: "\u062E\u0637\u0648\u0629 \u0625\u062C\u0631\u0627\u0626\u064A\u0629 \u0646\u0627\u0642\u0635\u0629 \u2014 \u0642\u062F \u064A\u0643\u0648\u0646 \u0627\u0644\u0628\u064A\u0639 \u0642\u062F \u062A\u0645 \u0641\u0639\u0644\u064A\u064B\u0627 \u062F\u0648\u0646 \u062A\u0648\u062B\u064A\u0642 \u0647\u0630\u0647 \u0627\u0644\u062E\u0637\u0648\u0629 \u062A\u062D\u062F\u064A\u062F\u064B\u0627.",
        sourceEvidence: [],
        ruleIds: ["integrity.protocol.staff_final_confirmation_missing"],
        confidence: assessment4("proven", 0.9, ["integrity.protocol.staff_final_confirmation_missing"], []),
        integrityEvaluationScope: scope,
        needsHumanReview: true
      });
    }
    const otherMissing = missing.filter((s) => s !== "announced_total" && s !== "staff_final_confirmation");
    if (otherMissing.length > 0) {
      drafts.push({
        type: "confirmation_protocol_incomplete",
        stage: "basket_confirmation",
        severity: "review",
        summary: `\u062E\u0637\u0648\u0627\u062A \u0646\u0627\u0642\u0635\u0629 \u0641\u064A \u0628\u0631\u0648\u062A\u0648\u0643\u0648\u0644 \u0627\u0644\u062A\u0623\u0643\u064A\u062F: ${otherMissing.join(", ")}.`,
        fact: `missingProtocolSteps \u062A\u062D\u062A\u0648\u064A \u0639\u0644\u0649: ${otherMissing.join(", ")}.`,
        interpretation: "\u0628\u0631\u0648\u062A\u0648\u0643\u0648\u0644 \u0627\u0644\u062A\u0623\u0643\u064A\u062F \u0644\u0645 \u064A\u0643\u062A\u0645\u0644 \u0628\u0627\u0644\u0643\u0627\u0645\u0644 \u0648\u0641\u0642 \u0627\u0644\u062E\u0637\u0648\u0627\u062A \u0627\u0644\u0645\u0639\u064A\u0627\u0631\u064A\u0629 \u0627\u0644\u0623\u0631\u0628\u0639.",
        sourceEvidence: [],
        ruleIds: ["integrity.protocol.confirmation_protocol_incomplete"],
        confidence: assessment4("proven", 0.85, ["integrity.protocol.confirmation_protocol_incomplete"], []),
        integrityEvaluationScope: scope,
        needsHumanReview: true
      });
    }
  }
  return drafts;
}
function detectAttributionExceptions(input, scope) {
  const { attribution, commercialConfirmation } = input;
  const drafts = [];
  const candidate = attribution.selectedCandidate;
  if (commercialConfirmation.currentState === "commercial_confirmation_complete") {
    if (attribution.candidateCount === 0) {
      drafts.push({
        type: "confirmed_case_without_attributed_invoice",
        stage: "attribution",
        severity: "high_priority",
        summary: "\u0645\u062D\u0627\u062F\u062B\u0629 \u0645\u0643\u062A\u0645\u0644\u0629 \u0627\u0644\u062A\u0623\u0643\u064A\u062F \u0627\u0644\u062A\u062C\u0627\u0631\u064A \u0628\u062F\u0648\u0646 \u0623\u064A \u0641\u0627\u062A\u0648\u0631\u0629 \u0645\u0631\u0634\u062D\u0629 \u0625\u0637\u0644\u0627\u0642\u064B\u0627.",
        fact: "candidateCount = 0 \u0631\u063A\u0645 \u0623\u0646 \u0627\u0644\u062D\u0627\u0644\u0629 \u0627\u0644\u062A\u062C\u0627\u0631\u064A\u0629 commercial_confirmation_complete.",
        interpretation: "\u0644\u0627 \u064A\u0648\u062C\u062F \u0633\u062C\u0644 \u062A\u062C\u0627\u0631\u064A (\u0641\u0627\u062A\u0648\u0631\u0629) \u062A\u0645 \u0627\u0644\u0639\u062B\u0648\u0631 \u0639\u0644\u064A\u0647 \u0644\u0647\u0630\u0647 \u0627\u0644\u0645\u062D\u0627\u062F\u062B\u0629 \u2014 \u0644\u0627 \u064A\u062B\u0628\u062A \u0647\u0630\u0627 \u0639\u062F\u0645 \u062D\u062F\u0648\u062B \u0627\u0644\u0628\u064A\u0639\u060C \u0641\u0642\u0637 \u0623\u0646\u0647 \u0644\u0645 \u064A\u064F\u0639\u062B\u0631 \u0639\u0644\u0649 \u062F\u0644\u064A\u0644 \u0641\u0627\u062A\u0648\u0631\u0629.",
        sourceEvidence: [],
        ruleIds: ["integrity.attribution.commercial_record_not_found"],
        confidence: assessment4("strongly_inferred", 0.75, ["integrity.attribution.commercial_record_not_found"], []),
        integrityEvaluationScope: scope,
        needsHumanReview: true
      });
    } else if (attribution.contradictions.includes("ambiguous_multiple_candidates")) {
      drafts.push({
        type: "ambiguous_invoice_attribution",
        stage: "attribution",
        severity: "review",
        summary: "\u0623\u0643\u062B\u0631 \u0645\u0646 \u0641\u0627\u062A\u0648\u0631\u0629 \u0645\u0631\u0634\u062D\u0629 \u0628\u0646\u0641\u0633 \u0627\u0644\u0642\u0648\u0629 \u0627\u0644\u062A\u0642\u0631\u064A\u0628\u064A\u0629 \u2014 \u0644\u0645 \u064A\u062A\u0645 \u0627\u0644\u062A\u0631\u062C\u064A\u062D \u062A\u0644\u0642\u0627\u0626\u064A\u064B\u0627.",
        fact: `candidateCount = ${attribution.candidateCount}\u060C \u0648\u0623\u0639\u0644\u0649 \u0645\u0631\u0634\u062D\u064A\u0646 \u0645\u062A\u0642\u0627\u0631\u0628\u0627\u0646 \u0641\u064A \u0627\u0644\u062F\u0631\u062C\u0629 \u0648\u0627\u0644\u0645\u0633\u062A\u0648\u0649.`,
        interpretation: "\u064A\u062D\u062A\u0627\u062C \u0642\u0631\u0627\u0631 \u0628\u0634\u0631\u064A \u0644\u062A\u062D\u062F\u064A\u062F \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 \u0627\u0644\u0635\u062D\u064A\u062D\u0629 \u2014 \u0644\u0627 \u064A\u0648\u062C\u062F \u062A\u0631\u062C\u064A\u062D \u0622\u0644\u064A \u0622\u0645\u0646.",
        sourceEvidence: [],
        ruleIds: ["integrity.attribution.ambiguous_invoice_attribution"],
        confidence: assessment4("weakly_inferred", 0.4, ["integrity.attribution.ambiguous_invoice_attribution"], []),
        integrityEvaluationScope: scope,
        needsHumanReview: true
      });
    } else if (attribution.attributionLevel === "weakly_inferred" || attribution.attributionLevel === "unknown") {
      drafts.push({
        type: "confirmed_case_without_attributed_invoice",
        stage: "attribution",
        severity: "review",
        summary: "\u064A\u0648\u062C\u062F \u0645\u0631\u0634\u062D \u0641\u0627\u062A\u0648\u0631\u0629\u060C \u0644\u0643\u0646 \u0627\u0644\u062B\u0642\u0629 \u0641\u064A \u0627\u0644\u0631\u0628\u0637 \u063A\u064A\u0631 \u0643\u0627\u0641\u064A\u0629 \u0644\u0627\u0639\u062A\u0645\u0627\u062F\u0647 \u0631\u0633\u0645\u064A\u064B\u0627.",
        fact: `attributionLevel = ${attribution.attributionLevel} (candidateCount = ${attribution.candidateCount}).`,
        interpretation: "\u0645\u0631\u0634\u062D \u0645\u062D\u062A\u0645\u0644 \u0645\u0648\u062C\u0648\u062F \u0644\u0643\u0646\u0647 \u063A\u064A\u0631 \u0645\u0648\u062B\u0648\u0642 \u0628\u062F\u0631\u062C\u0629 \u0643\u0627\u0641\u064A\u0629 \u2014 \u0644\u0627 \u064A\u064F\u0639\u062A\u0645\u062F \u0643\u0631\u0628\u0637 \u0631\u0633\u0645\u064A.",
        sourceEvidence: [],
        ruleIds: ["integrity.attribution.invoice_attribution_not_reliable"],
        confidence: assessment4("weakly_inferred", 0.35, ["integrity.attribution.invoice_attribution_not_reliable"], []),
        integrityEvaluationScope: scope,
        needsHumanReview: true
      });
    }
  }
  if (candidate) {
    if (candidate.identityConflict !== "none") {
      drafts.push({
        type: "identity_conflict",
        stage: "attribution",
        severity: "review",
        summary: "\u062A\u0639\u0627\u0631\u0636 \u0641\u064A \u0647\u0648\u064A\u0629 \u0627\u0644\u0639\u0645\u064A\u0644 \u0628\u064A\u0646 \u0627\u0644\u0645\u062D\u0627\u062F\u062B\u0629 \u0648\u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 \u0627\u0644\u0645\u0631\u0634\u062D\u0629.",
        fact: "\u0627\u0644\u0647\u0627\u062A\u0641 \u0645\u062A\u0637\u0627\u0628\u0642 \u0644\u0643\u0646 \u0645\u0639\u0631\u0641 \u0627\u0644\u0639\u0645\u064A\u0644 \u0627\u0644\u0623\u0633\u0627\u0633\u064A \u0645\u062E\u062A\u0644\u0641 \u0628\u064A\u0646 \u0627\u0644\u0645\u062D\u0627\u062F\u062B\u0629 \u0648\u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629.",
        interpretation: "\u064A\u062A\u0637\u0644\u0628 \u0645\u0631\u0627\u062C\u0639\u0629 \u0628\u0634\u0631\u064A\u0629 \u0644\u062A\u062D\u062F\u064A\u062F \u0623\u064A \u0647\u0648\u064A\u0629 \u0639\u0645\u064A\u0644 \u0635\u062D\u064A\u062D\u0629 \u2014 \u0644\u0627 \u062A\u062E\u0645\u064A\u0646 \u0622\u0644\u064A.",
        sourceEvidence: [],
        ruleIds: ["integrity.attribution.identity_conflict"],
        confidence: assessment4("weakly_inferred", 0.4, ["integrity.attribution.identity_conflict"], []),
        integrityEvaluationScope: scope,
        invoiceId: attribution.selectedInvoiceId,
        invoiceNumber: attribution.selectedInvoiceNumber,
        needsHumanReview: true
      });
    }
    if (candidate.branchMatch === "mismatch") {
      drafts.push({
        type: "branch_conflict",
        stage: "attribution",
        severity: "review",
        summary: "\u0641\u0631\u0639 \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 \u0627\u0644\u0645\u0631\u0634\u062D\u0629 \u064A\u062E\u062A\u0644\u0641 \u0639\u0646 \u0641\u0631\u0639 \u0627\u0644\u0645\u062D\u0627\u062F\u062B\u0629 \u0627\u0644\u0645\u0639\u0631\u0648\u0641.",
        fact: `branchMatch = mismatch \u0644\u0644\u0641\u0627\u062A\u0648\u0631\u0629 \u0627\u0644\u0645\u0631\u0634\u062D\u0629 ${attribution.selectedInvoiceNumber ?? attribution.selectedInvoiceId}.`,
        interpretation: "\u0642\u062F \u064A\u0643\u0648\u0646 \u0627\u0644\u0639\u0645\u064A\u0644 \u0627\u0634\u062A\u0631\u0649 \u0645\u0646 \u0641\u0631\u0639 \u0622\u062E\u0631\u060C \u0623\u0648 \u0623\u0646 \u0627\u0644\u0631\u0628\u0637 \u0628\u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 \u063A\u064A\u0631 \u0635\u062D\u064A\u062D.",
        sourceEvidence: [],
        ruleIds: ["integrity.attribution.branch_conflict"],
        confidence: assessment4("weakly_inferred", 0.4, ["integrity.attribution.branch_conflict"], []),
        integrityEvaluationScope: scope,
        invoiceId: attribution.selectedInvoiceId,
        invoiceNumber: attribution.selectedInvoiceNumber,
        needsHumanReview: true
      });
    }
  }
  if (attribution.competingCaseIds.length > 0) {
    drafts.push({
      type: "competing_case_attribution",
      stage: "attribution",
      severity: "review",
      summary: "\u0646\u0641\u0633 \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 \u0645\u0631\u062A\u0628\u0637\u0629 \u0628\u062D\u0627\u0644\u0629 \u0645\u062D\u0627\u062F\u062B\u0629 \u0623\u062E\u0631\u0649 \u0628\u0634\u0643\u0644 \u0645\u0633\u062A\u0642\u0644.",
      fact: `competingCaseIds: ${attribution.competingCaseIds.join(", ")}.`,
      interpretation: "\u062A\u0639\u0627\u0631\u0636 \u0639\u0644\u0649 \u0645\u0633\u062A\u0648\u0649 \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 \u0628\u064A\u0646 \u062D\u0627\u0644\u062A\u064A\u0646 \u2014 \u0644\u0645 \u064A\u062A\u0645 \u062D\u0644\u0647 \u062A\u0644\u0642\u0627\u0626\u064A\u064B\u0627\u060C \u0648\u0644\u0627 \u064A\u064F\u0641\u062A\u0631\u0636 \u062D\u0635\u0631\u064A\u0629 \u0628\u062F\u0648\u0646 \u0645\u0639\u0644\u0648\u0645\u0627\u062A \u0643\u0627\u0641\u064A\u0629.",
      sourceEvidence: [],
      ruleIds: ["integrity.attribution.competing_case_attribution"],
      confidence: assessment4("weakly_inferred", 0.4, ["integrity.attribution.competing_case_attribution"], []),
      integrityEvaluationScope: scope,
      invoiceId: attribution.selectedInvoiceId,
      invoiceNumber: attribution.selectedInvoiceNumber,
      needsHumanReview: true
    });
  }
  return drafts;
}
function detectHeaderExceptions(input, scope) {
  const { basketInvoiceMatch, invoiceStatusHint, attribution } = input;
  const drafts = [];
  if (invoiceStatusHint === "cancelled") {
    drafts.push({
      type: "cancelled_invoice_linked_to_case",
      stage: "invoice_header",
      severity: "high_priority",
      summary: "\u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 \u0627\u0644\u0645\u0631\u062A\u0628\u0637\u0629 \u0628\u0647\u0630\u0647 \u0627\u0644\u0645\u062D\u0627\u062F\u062B\u0629 \u0645\u0644\u063A\u0627\u0629.",
      fact: "invoiceStatusHint = cancelled (\u062D\u0642\u064A\u0642\u0629 \u0645\u0624\u0643\u062F\u0629 \u0645\u0646 \u0627\u0644\u0645\u0633\u062A\u062F\u0639\u064A\u060C \u0648\u0644\u064A\u0633\u062A \u062A\u062E\u0645\u064A\u0646\u064B\u0627).",
      interpretation: "\u0645\u062D\u0627\u062F\u062B\u0629 \u0645\u0624\u0643\u062F\u0629 \u062A\u062C\u0627\u0631\u064A\u064B\u0627 \u0645\u0631\u062A\u0628\u0637\u0629 \u0628\u0641\u0627\u062A\u0648\u0631\u0629 \u0645\u0644\u063A\u0627\u0629 \u2014 \u064A\u0633\u062A\u062D\u0642 \u0645\u0631\u0627\u062C\u0639\u0629 \u0639\u0627\u062C\u0644\u0629.",
      sourceEvidence: [],
      ruleIds: ["integrity.header.cancelled_invoice_linked_to_case"],
      confidence: assessment4("proven", 0.95, ["integrity.header.cancelled_invoice_linked_to_case"], []),
      integrityEvaluationScope: scope,
      invoiceId: basketInvoiceMatch.invoiceId ?? attribution.selectedInvoiceId,
      invoiceNumber: basketInvoiceMatch.invoiceNumber ?? attribution.selectedInvoiceNumber,
      needsHumanReview: true
    });
  } else if (invoiceStatusHint === "returned") {
    drafts.push({
      type: "returned_invoice_linked_to_case",
      stage: "invoice_header",
      severity: "high_priority",
      summary: "\u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 \u0627\u0644\u0645\u0631\u062A\u0628\u0637\u0629 \u0628\u0647\u0630\u0647 \u0627\u0644\u0645\u062D\u0627\u062F\u062B\u0629 \u0645\u0631\u062A\u062C\u0639\u0629.",
      fact: "invoiceStatusHint = returned (\u062D\u0642\u064A\u0642\u0629 \u0645\u0624\u0643\u062F\u0629 \u0645\u0646 \u0627\u0644\u0645\u0633\u062A\u062F\u0639\u064A\u060C \u0648\u0644\u064A\u0633\u062A \u062A\u062E\u0645\u064A\u0646\u064B\u0627).",
      interpretation: "\u0645\u062D\u0627\u062F\u062B\u0629 \u0645\u0624\u0643\u062F\u0629 \u062A\u062C\u0627\u0631\u064A\u064B\u0627 \u0645\u0631\u062A\u0628\u0637\u0629 \u0628\u0641\u0627\u062A\u0648\u0631\u0629 \u062A\u0645 \u0625\u0631\u062C\u0627\u0639\u0647\u0627 \u2014 \u064A\u0633\u062A\u062D\u0642 \u0645\u0631\u0627\u062C\u0639\u0629 \u0639\u0627\u062C\u0644\u0629.",
      sourceEvidence: [],
      ruleIds: ["integrity.header.returned_invoice_linked_to_case"],
      confidence: assessment4("proven", 0.95, ["integrity.header.returned_invoice_linked_to_case"], []),
      integrityEvaluationScope: scope,
      invoiceId: basketInvoiceMatch.invoiceId ?? attribution.selectedInvoiceId,
      invoiceNumber: basketInvoiceMatch.invoiceNumber ?? attribution.selectedInvoiceNumber,
      needsHumanReview: true
    });
  }
  if (basketInvoiceMatch.headerEvidenceReady && basketInvoiceMatch.totalMatch === "mismatch") {
    const totalFact = basketInvoiceMatch.differences.find((d) => d.type === "total_mismatch");
    const explainedDiff = basketInvoiceMatch.differences.find((d) => d.type === "explained_difference");
    const unexplainedDiff = basketInvoiceMatch.differences.find((d) => d.type === "unexplained_difference");
    const explained = Boolean(explainedDiff);
    const basketAmount = typeof totalFact?.before === "number" ? totalFact.before : null;
    const invoiceAmount = typeof totalFact?.after === "number" ? totalFact.after : null;
    const difference = basketAmount != null && invoiceAmount != null ? invoiceAmount - basketAmount : null;
    const differencePercentage = difference != null && basketAmount ? difference / basketAmount * 100 : null;
    drafts.push({
      // Rule §10/§12: ONE canonical root exception for the total gap — the raw fact and its
      // explanation status are carried as fields on it, never as separate duplicate exceptions.
      type: explained ? "confirmed_total_invoice_mismatch" : "unexplained_total_difference",
      stage: "invoice_header",
      severity: explained ? "info" : "high_priority",
      summary: explained ? "\u0625\u062C\u0645\u0627\u0644\u064A \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 \u064A\u062E\u062A\u0644\u0641 \u0639\u0646 \u0625\u062C\u0645\u0627\u0644\u064A \u0627\u0644\u0633\u0644\u0629 \u0627\u0644\u0645\u0624\u0643\u062F\u0629\u060C \u0644\u0643\u0646 \u0627\u0644\u0641\u0631\u0642 \u0645\u0648\u062B\u064E\u0651\u0642 \u0648\u0645\u064F\u0641\u0633\u064E\u0651\u0631." : "\u0625\u062C\u0645\u0627\u0644\u064A \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 \u064A\u062E\u062A\u0644\u0641 \u0639\u0646 \u0625\u062C\u0645\u0627\u0644\u064A \u0627\u0644\u0633\u0644\u0629 \u0627\u0644\u0645\u0624\u0643\u062F\u0629 \u0628\u062F\u0648\u0646 \u062A\u0641\u0633\u064A\u0631 \u0645\u0648\u062B\u064E\u0651\u0642.",
      fact: `\u0625\u062C\u0645\u0627\u0644\u064A \u0627\u0644\u0633\u0644\u0629 = ${basketAmount ?? "\u063A\u064A\u0631 \u0645\u0639\u0631\u0648\u0641"}\u060C \u0625\u062C\u0645\u0627\u0644\u064A \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 = ${invoiceAmount ?? "\u063A\u064A\u0631 \u0645\u0639\u0631\u0648\u0641"}.`,
      interpretation: explained ? "\u0627\u0644\u0641\u0631\u0642 \u0645\u0641\u0633\u064E\u0651\u0631 \u0628\u062F\u0644\u064A\u0644 \u0645\u0648\u062B\u0642 (\u0631\u0633\u0648\u0645 \u062A\u0648\u0635\u064A\u0644/\u062E\u0635\u0645/\u0643\u0627\u0634 \u0628\u0627\u0643/\u062A\u0639\u062F\u064A\u0644 \u0645\u0648\u062B\u0642) \u2014 \u0644\u0644\u062A\u062F\u0642\u064A\u0642 \u0641\u0642\u0637\u060C \u0644\u064A\u0633 \u062A\u0646\u0628\u064A\u0647\u064B\u0627 \u0639\u0627\u062C\u0644\u0627\u064B." : "\u0641\u0631\u0642 \u0645\u0627\u0644\u064A \u062D\u0642\u064A\u0642\u064A \u063A\u064A\u0631 \u0645\u0641\u0633\u064E\u0651\u0631 \u2014 \u064A\u0633\u062A\u062D\u0642 \u0645\u0631\u0627\u062C\u0639\u0629.",
      sourceEvidence: [...totalFact?.evidence ?? [], ...explainedDiff?.evidence ?? unexplainedDiff?.evidence ?? []],
      ruleIds: [explained ? "integrity.header.total_mismatch.explained" : "integrity.header.total_mismatch.unexplained"],
      confidence: assessment4(
        explained ? "strongly_inferred" : "proven",
        explained ? 0.75 : 0.85,
        [explained ? "integrity.header.total_mismatch.explained" : "integrity.header.total_mismatch.unexplained"],
        []
      ),
      integrityEvaluationScope: scope,
      basketVersion: basketInvoiceMatch.basketVersion,
      invoiceId: basketInvoiceMatch.invoiceId,
      invoiceNumber: basketInvoiceMatch.invoiceNumber,
      expectedValue: basketAmount,
      observedValue: invoiceAmount,
      difference,
      differencePercentage,
      explained,
      explanationKind: explainedDiff?.explanation ?? null,
      needsHumanReview: !explained
    });
  }
  return drafts;
}
function detectItemExceptions(input, scope) {
  const { basketInvoiceMatch } = input;
  if (scope !== "header_and_items") return [];
  const drafts = [];
  basketInvoiceMatch.differences.forEach((d) => {
    if (d.type === "missing_item") {
      drafts.push({
        type: "confirmed_item_missing_from_invoice",
        stage: "invoice_items",
        severity: "review",
        summary: `\u0627\u0644\u0635\u0646\u0641 "${d.key}" \u0645\u0624\u0643\u062F \u0641\u064A \u0627\u0644\u0633\u0644\u0629 \u0648\u0644\u0645 \u064A\u0638\u0647\u0631 \u0641\u064A \u0628\u0646\u0648\u062F \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629.`,
        fact: `before(\u0627\u0644\u0643\u0645\u064A\u0629 \u0641\u064A \u0627\u0644\u0633\u0644\u0629) = ${d.before}, after(\u0641\u064A \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629) = \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F.`,
        interpretation: "\u063A\u064A\u0627\u0628 \u0635\u0646\u0641 \u0645\u0624\u0643\u062F \u0639\u0646 \u0628\u0646\u0648\u062F \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 \u2014 \u064A\u0633\u062A\u062D\u0642 \u062A\u062F\u0642\u064A\u0642\u064B\u0627 \u062A\u0634\u063A\u064A\u0644\u064A\u064B\u0627\u060C \u0648\u0644\u064A\u0633 \u0627\u062A\u0647\u0627\u0645\u064B\u0627 \u0644\u0623\u064A \u0637\u0631\u0641.",
        sourceEvidence: d.evidence,
        ruleIds: ["integrity.items.confirmed_item_missing_from_invoice"],
        confidence: d.confidence,
        integrityEvaluationScope: scope,
        basketVersion: basketInvoiceMatch.basketVersion,
        invoiceId: basketInvoiceMatch.invoiceId,
        invoiceNumber: basketInvoiceMatch.invoiceNumber,
        expectedValue: d.before,
        observedValue: d.after,
        needsHumanReview: true
      });
    } else if (d.type === "extra_item") {
      drafts.push({
        type: "extra_invoice_item",
        stage: "invoice_items",
        severity: "review",
        summary: `\u0627\u0644\u0635\u0646\u0641 "${d.key}" \u0645\u0648\u062C\u0648\u062F \u0641\u064A \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 \u0648\u0644\u0645 \u064A\u0643\u0646 \u062C\u0632\u0621\u064B\u0627 \u0645\u0646 \u0627\u0644\u0633\u0644\u0629 \u0627\u0644\u0645\u0624\u0643\u062F\u0629.`,
        fact: `before(\u0641\u064A \u0627\u0644\u0633\u0644\u0629) = \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F, after(\u0627\u0644\u0643\u0645\u064A\u0629 \u0641\u064A \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629) = ${d.after}.`,
        interpretation: "\u0635\u0646\u0641 \u0625\u0636\u0627\u0641\u064A \u063A\u064A\u0631 \u0645\u064F\u0641\u0633\u064E\u0651\u0631 \u0628\u062A\u0639\u062F\u064A\u0644 \u0645\u0648\u062B\u064E\u0651\u0642 \u0641\u064A \u0627\u0644\u0645\u062D\u0627\u062F\u062B\u0629 \u2014 \u064A\u0633\u062A\u062D\u0642 \u062A\u062F\u0642\u064A\u0642\u064B\u0627 \u062A\u0634\u063A\u064A\u0644\u064A\u064B\u0627.",
        sourceEvidence: d.evidence,
        ruleIds: ["integrity.items.extra_invoice_item"],
        confidence: d.confidence,
        integrityEvaluationScope: scope,
        basketVersion: basketInvoiceMatch.basketVersion,
        invoiceId: basketInvoiceMatch.invoiceId,
        invoiceNumber: basketInvoiceMatch.invoiceNumber,
        expectedValue: d.before,
        observedValue: d.after,
        needsHumanReview: true
      });
    } else if (d.type === "quantity_mismatch") {
      const before = typeof d.before === "number" ? d.before : null;
      const after = typeof d.after === "number" ? d.after : null;
      drafts.push({
        type: "confirmed_quantity_mismatch",
        stage: "invoice_items",
        severity: "review",
        summary: `\u0643\u0645\u064A\u0629 \u0627\u0644\u0635\u0646\u0641 "${d.key}" \u0641\u064A \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 \u062A\u062E\u062A\u0644\u0641 \u0639\u0646 \u0627\u0644\u0643\u0645\u064A\u0629 \u0627\u0644\u0645\u0624\u0643\u062F\u0629 \u0641\u064A \u0627\u0644\u0633\u0644\u0629.`,
        fact: `\u0627\u0644\u0643\u0645\u064A\u0629 \u0641\u064A \u0627\u0644\u0633\u0644\u0629 = ${before}, \u0627\u0644\u0643\u0645\u064A\u0629 \u0641\u064A \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 = ${after}.`,
        interpretation: "\u0641\u0631\u0642 \u0641\u064A \u0627\u0644\u0643\u0645\u064A\u0629 \u0639\u0644\u0649 \u0645\u0633\u062A\u0648\u0649 \u0635\u0646\u0641 \u0645\u062D\u062F\u062F \u0627\u0644\u0647\u0648\u064A\u0629 \u2014 \u064A\u0633\u062A\u062D\u0642 \u062A\u062F\u0642\u064A\u0642\u064B\u0627 \u062A\u0634\u063A\u064A\u0644\u064A\u064B\u0627.",
        sourceEvidence: d.evidence,
        ruleIds: ["integrity.items.confirmed_quantity_mismatch"],
        confidence: d.confidence,
        integrityEvaluationScope: scope,
        basketVersion: basketInvoiceMatch.basketVersion,
        invoiceId: basketInvoiceMatch.invoiceId,
        invoiceNumber: basketInvoiceMatch.invoiceNumber,
        expectedValue: before,
        observedValue: after,
        difference: before != null && after != null ? after - before : null,
        needsHumanReview: true
      });
    }
  });
  if (basketInvoiceMatch.humanReviewReasons.includes("ambiguous_product_alias")) {
    drafts.push({
      type: "product_identity_conflict",
      stage: "invoice_items",
      severity: "review",
      summary: "\u062A\u0639\u0627\u0631\u0636 \u0641\u064A \u0647\u0648\u064A\u0629 \u0623\u062D\u062F \u0627\u0644\u0645\u0646\u062A\u062C\u0627\u062A \u0628\u064A\u0646 \u0628\u0646\u0648\u062F \u0627\u0644\u0633\u0644\u0629 \u0648\u0628\u0646\u0648\u062F \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629.",
      fact: "\u0623\u0643\u062B\u0631 \u0645\u0646 \u0628\u0646\u062F \u0641\u0627\u062A\u0648\u0631\u0629 \u064A\u062A\u0637\u0627\u0628\u0642 \u0646\u0635\u064A\u064B\u0627 \u0645\u0639 \u0646\u0641\u0633 \u0627\u0633\u0645 \u0627\u0644\u0645\u0646\u062A\u062C \u0627\u0644\u0645\u0624\u0643\u062F \u2014 \u0644\u0645 \u064A\u062A\u0645 \u0627\u062E\u062A\u064A\u0627\u0631 \u0623\u062D\u062F\u0647\u0627 \u062A\u0644\u0642\u0627\u0626\u064A\u064B\u0627.",
      interpretation: "\u064A\u062A\u0637\u0644\u0628 \u0645\u0631\u0627\u062C\u0639\u0629 \u0628\u0634\u0631\u064A\u0629 \u0644\u062A\u062D\u062F\u064A\u062F \u0627\u0644\u0628\u0646\u062F \u0627\u0644\u0635\u062D\u064A\u062D \u2014 \u0644\u0627 \u062A\u062E\u0645\u064A\u0646 \u0622\u0644\u064A.",
      sourceEvidence: [],
      ruleIds: ["integrity.items.product_identity_conflict"],
      confidence: assessment4("weakly_inferred", 0.4, ["integrity.items.product_identity_conflict"], []),
      integrityEvaluationScope: scope,
      basketVersion: basketInvoiceMatch.basketVersion,
      invoiceId: basketInvoiceMatch.invoiceId,
      invoiceNumber: basketInvoiceMatch.invoiceNumber,
      needsHumanReview: true
    });
  }
  return drafts;
}
function deriveSalesIntegrityAssessment(input) {
  const { caseId, commercialConfirmation, protocolAssessment, attribution, basketInvoiceMatch, knownStaffIds = [] } = input;
  const scope = basketInvoiceMatch.integrityEvaluationScope;
  const applicability = protocolAssessment.applicability ?? "applicable";
  const policyState = deriveProtocolPolicyComplianceState({
    applicability,
    protocolCompliant: protocolAssessment.protocolCompliant,
    caseEndedAt: input.caseEndedAt ?? null,
    protocolPolicyEffectiveAt: input.protocolPolicyEffectiveAt
  });
  const drafts = [
    ...detectProtocolExceptions(input, scope, policyState),
    ...detectAttributionExceptions(input, scope),
    ...detectHeaderExceptions(input, scope),
    ...detectItemExceptions(input, scope)
  ];
  const exceptions = drafts.map((d, index) => ({
    exceptionId: `${caseId}:exception:${index}:${d.type}`,
    caseId,
    type: d.type,
    stage: d.stage,
    severity: d.severity,
    status: "open",
    summary: d.summary,
    fact: d.fact,
    interpretation: d.interpretation,
    sourceEvidence: d.sourceEvidence,
    ruleIds: d.ruleIds,
    basketVersion: d.basketVersion ?? null,
    invoiceId: d.invoiceId ?? null,
    invoiceNumber: d.invoiceNumber ?? null,
    expectedValue: d.expectedValue ?? null,
    observedValue: d.observedValue ?? null,
    difference: d.difference ?? null,
    differencePercentage: d.differencePercentage ?? null,
    explained: d.explained ?? false,
    explanationKind: d.explanationKind ?? null,
    confidence: d.confidence,
    integrityEvaluationScope: d.integrityEvaluationScope,
    needsHumanReview: d.needsHumanReview ?? false,
    involvedStaffIds: d.involvedStaffIds ?? knownStaffIds
  }));
  const highestSeverity = exceptions.length === 0 ? null : exceptions.reduce(
    (acc, e) => SEVERITY_ORDER[e.severity] > SEVERITY_ORDER[acc] ? e.severity : acc,
    "info"
  );
  const earliestBreakStage = exceptions.length === 0 ? null : exceptions.reduce(
    (acc, e) => STAGE_ORDER[e.stage] < STAGE_ORDER[acc] ? e.stage : acc,
    exceptions[0].stage
  );
  const humanReviewReasons = Array.from(
    /* @__PURE__ */ new Set([
      ...commercialConfirmation.humanReviewReasons,
      ...attribution.humanReviewReasons,
      ...basketInvoiceMatch.humanReviewReasons,
      ...exceptions.filter((e) => e.needsHumanReview).map((e) => e.type)
    ])
  );
  const needsHumanReview = commercialConfirmation.needsHumanReview || attribution.needsHumanReview || basketInvoiceMatch.needsHumanReview || exceptions.some((e) => e.needsHumanReview);
  const primaryEvidence = exceptions.flatMap((e) => e.sourceEvidence);
  const ruleIds = exceptions.length > 0 ? exceptions.flatMap((e) => e.ruleIds) : ["integrity.assessment.clean"];
  return {
    caseId,
    integrityEvaluationScope: scope,
    commercialState: commercialConfirmation.currentState,
    protocolCompliant: protocolAssessment.protocolCompliant,
    attributionLevel: attribution.attributionLevel,
    basketInvoiceOverallMatch: basketInvoiceMatch.overallMatch,
    exceptions,
    highestSeverity,
    exceptionCount: exceptions.length,
    earliestBreakStage,
    needsHumanReview,
    humanReviewReasons,
    primaryEvidence,
    ruleIds,
    canEvaluateHeaderIntegrity: basketInvoiceMatch.headerEvidenceReady,
    canEvaluateItemIntegrity: basketInvoiceMatch.itemEvidenceReady,
    canEvaluateFulfillmentIntegrity: false,
    protocolPolicyCompliance: policyState
  };
}

// src/lib/salesIntelligence/historicalCommercialClosureEngine.ts
var HISTORICAL_BARE_SEND_ACCEPTANCE_RX = /^ابعت(?:ه|ها|هم|يه|يهم)?[!.، ]*$/i;
var HISTORICAL_STAFF_FULFILLMENT_RX = /جاري\s*(?:التجهيز|الإرسال|الارسال)|تم\s*(?:تأكيد\s*الطلب|تسجيل(?:\s*طلبك)?|الإرسال|الارسال)|من\s*عني[اى]|عني[اى]\s*حاضر|^عني[اى][!.، ]*$/i;
function assessment5(level, score, ruleIds, evidence) {
  return { level, score, ruleIds, evidence };
}
function refFor2(message, description) {
  return { sourceTable: "whatsapp_review_sources", sourceId: "", messageIds: [message.id], description };
}
function deriveHistoricalCommercialClosureAssessment(caseId, scopedMessages, commercial, activeItems, announcedValueAvailable) {
  const customerMessages = scopedMessages.filter((m) => m.role === "customer" && m.isMeaningful);
  const staffMessages = scopedMessages.filter((m) => m.role === "staff" && m.isMeaningful);
  const requestSignals = extractRequestSignals(scopedMessages);
  const productRefSignals = extractProductReferenceSignals(scopedMessages);
  const purchaseIntentDetected = requestSignals.length > 0 || productRefSignals.length > 0 || activeItems.length > 0;
  const acceptanceSignalMessages = extractAcceptanceSignals(scopedMessages).filter(isSubstantiveConfirmationSignal).map((s) => scopedMessages.find((m) => m.id === s.messageId)).filter((m) => Boolean(m));
  const bareSendMessages = customerMessages.filter((m) => HISTORICAL_BARE_SEND_ACCEPTANCE_RX.test(m.text));
  const customerAcceptanceMessages = Array.from(/* @__PURE__ */ new Set([...acceptanceSignalMessages, ...bareSendMessages]));
  const customerAcceptanceDetected = customerAcceptanceMessages.length > 0;
  const fulfillmentMessages = staffMessages.filter((m) => HISTORICAL_STAFF_FULFILLMENT_RX.test(m.text));
  const staffFulfillmentIntentDetected = fulfillmentMessages.length > 0;
  const basketReconstructable = activeItems.some(
    (item) => item.resolutionStatus === "proven" || item.resolutionStatus === "partially_proven"
  );
  const multipleUnresolvedProducts = activeItems.length > 1;
  let closureLevel;
  let needsHumanReview = false;
  const ruleIds = [];
  if (commercial.currentState === "commercial_confirmation_complete") {
    closureLevel = "explicit";
    ruleIds.push("historical_closure.explicit_via_formal_protocol");
  } else if (!purchaseIntentDetected) {
    closureLevel = "unknown";
    ruleIds.push("historical_closure.no_purchase_intent");
  } else if (customerAcceptanceDetected && staffFulfillmentIntentDetected) {
    if (multipleUnresolvedProducts) {
      closureLevel = "weakly_inferred";
      needsHumanReview = true;
      ruleIds.push("historical_closure.ambiguous_multiple_unresolved_products");
    } else {
      closureLevel = "strongly_inferred";
      ruleIds.push("historical_closure.customer_acceptance_and_staff_fulfillment_intent");
    }
  } else if (customerAcceptanceDetected || staffFulfillmentIntentDetected) {
    closureLevel = "weakly_inferred";
    ruleIds.push("historical_closure.partial_signal_only");
  } else {
    closureLevel = "not_closed";
    ruleIds.push("historical_closure.purchase_intent_without_closure");
  }
  const confidenceByLevel = {
    explicit: { level: "proven", score: 0.95 },
    strongly_inferred: { level: "strongly_inferred", score: 0.7 },
    weakly_inferred: { level: "weakly_inferred", score: 0.4 },
    not_closed: { level: "strongly_inferred", score: 0.75 },
    unknown: { level: "unknown", score: 0.2 }
  };
  const evidenceMessages = [...customerAcceptanceMessages, ...fulfillmentMessages];
  const evidence = evidenceMessages.map(
    (m) => refFor2(m, `${m.role === "customer" ? "\u0625\u0634\u0627\u0631\u0629 \u0642\u0628\u0648\u0644 \u062A\u0627\u0631\u064A\u062E\u064A\u0629 \u0645\u0646 \u0627\u0644\u0639\u0645\u064A\u0644" : "\u0625\u0634\u0627\u0631\u0629 \u0646\u064A\u0629 \u062A\u0646\u0641\u064A\u0630 \u062A\u0627\u0631\u064A\u062E\u064A\u0629 \u0645\u0646 \u0627\u0644\u0645\u0648\u0638\u0641"}: "${m.text.slice(0, 120)}".`)
  );
  const { level, score } = confidenceByLevel[closureLevel];
  return {
    caseId,
    purchaseIntentDetected,
    customerAcceptanceDetected,
    staffFulfillmentIntentDetected,
    basketReconstructable,
    announcedValueAvailable,
    closureLevel,
    primaryMessageIds: Array.from(new Set(evidenceMessages.map((m) => m.id))),
    confidence: assessment5(level, score, ruleIds, evidence),
    needsHumanReview,
    ruleIds
  };
}

// src/lib/salesIntelligence/saleProofState.ts
var UNCONDITIONAL_CONTRADICTION_EXCEPTION_TYPES = /* @__PURE__ */ new Set([
  "identity_conflict",
  "competing_case_attribution",
  "cancelled_invoice_linked_to_case",
  "returned_invoice_linked_to_case",
  "unexplained_total_difference",
  "confirmed_item_missing_from_invoice",
  "extra_invoice_item",
  "confirmed_quantity_mismatch"
]);
var TRUSTED_ONLY_CONTRADICTION_EXCEPTION_TYPES = /* @__PURE__ */ new Set([
  "branch_conflict"
]);
var CONTRADICTION_CATEGORY_BY_EXCEPTION_TYPE = {
  identity_conflict: "cross_customer_invoice_link",
  competing_case_attribution: "cross_case_invoice_collision",
  cancelled_invoice_linked_to_case: "cancelled_invoice_linked_to_case",
  returned_invoice_linked_to_case: "returned_invoice_linked_to_case",
  unexplained_total_difference: "unexplained_amount_conflict",
  confirmed_item_missing_from_invoice: "item_evidence_conflict",
  extra_invoice_item: "item_evidence_conflict",
  confirmed_quantity_mismatch: "item_evidence_conflict",
  branch_conflict: "cross_branch_invoice_link"
};
function detectContradictionCategories(input) {
  const isTrustedCandidate = input.attribution.selectedCandidate?.directInvoiceLink === true;
  const categories = /* @__PURE__ */ new Set();
  for (const exception of input.integrityAssessment.exceptions) {
    if (UNCONDITIONAL_CONTRADICTION_EXCEPTION_TYPES.has(exception.type)) {
      categories.add(CONTRADICTION_CATEGORY_BY_EXCEPTION_TYPE[exception.type]);
    } else if (isTrustedCandidate && TRUSTED_ONLY_CONTRADICTION_EXCEPTION_TYPES.has(exception.type)) {
      categories.add(CONTRADICTION_CATEGORY_BY_EXCEPTION_TYPE[exception.type]);
    }
  }
  if (isTrustedCandidate && input.attribution.selectedCandidate?.disqualifiers.includes("temporal_inversion_invoice_predates_case")) {
    categories.add("temporal_inversion_conflict");
  }
  return Array.from(categories);
}
function collectContradictionEvidence(input, categories) {
  const relevantTypes = new Set(
    Object.entries(CONTRADICTION_CATEGORY_BY_EXCEPTION_TYPE).filter(([, category]) => categories.includes(category)).map(([type]) => type)
  );
  return input.integrityAssessment.exceptions.filter((e) => relevantTypes.has(e.type)).flatMap((e) => e.sourceEvidence);
}
function mapStateToConfidenceLevel(state) {
  switch (state) {
    case "proven":
      return "proven";
    case "strongly_supported":
      return "strongly_inferred";
    case "weakly_supported":
      return "weakly_inferred";
    case "unknown":
    case "contradicted":
      return "unknown";
  }
}
function scoreForState(state) {
  switch (state) {
    case "proven":
      return 1;
    case "strongly_supported":
      return 0.75;
    case "weakly_supported":
      return 0.4;
    case "unknown":
    case "contradicted":
      return 0;
  }
}
function deriveSaleProofState(input) {
  const { attribution, basketInvoiceMatch } = input;
  const candidate = attribution.selectedCandidate;
  const isTrustedCandidate = candidate?.directInvoiceLink === true;
  const contradictions = detectContradictionCategories(input);
  const ruleIds = [];
  let state;
  let proofSource;
  if (contradictions.length > 0) {
    state = "contradicted";
    proofSource = isTrustedCandidate ? "trusted_invoice_with_contradiction" : "statistical_with_contradiction";
    ruleIds.push("sale_proof.state.contradicted", ...contradictions.map((c) => `sale_proof.contradiction.${c}`));
  } else if (isTrustedCandidate) {
    state = "proven";
    proofSource = "trusted_invoice";
    ruleIds.push("sale_proof.state.proven", "sale_proof.rule.trusted_invoice_link");
  } else if (attribution.candidateCount === 0 || !attribution.selectedInvoiceId || attribution.attributionLevel === "unknown") {
    state = "unknown";
    proofSource = "none";
    ruleIds.push("sale_proof.state.unknown");
  } else if (attribution.attributionLevel === "strongly_inferred" && attribution.isOfficialForStaffEvaluation) {
    state = "strongly_supported";
    proofSource = "statistical_strong";
    ruleIds.push("sale_proof.state.strongly_supported");
  } else {
    state = "weakly_supported";
    proofSource = "statistical_weak";
    ruleIds.push("sale_proof.state.weakly_supported");
  }
  const trustedInvoiceId = state === "proven" ? attribution.selectedInvoiceId : null;
  const evidence = state === "contradicted" ? collectContradictionEvidence(input, contradictions) : attribution.confidence.evidence;
  const needsHumanReview = state === "contradicted" || attribution.needsHumanReview || basketInvoiceMatch.needsHumanReview || input.integrityAssessment.needsHumanReview;
  return {
    caseId: attribution.caseId,
    state,
    confidence: {
      level: mapStateToConfidenceLevel(state),
      score: scoreForState(state),
      ruleIds,
      evidence
    },
    evidence,
    contradictions,
    ruleIds,
    proofSource,
    trustedInvoiceId,
    selectedInvoiceId: attribution.selectedInvoiceId,
    selectedInvoiceNumber: attribution.selectedInvoiceNumber,
    invoiceEvidenceScope: basketInvoiceMatch.integrityEvaluationScope,
    itemEvidenceReady: basketInvoiceMatch.itemEvidenceReady,
    quantityEvidenceReady: basketInvoiceMatch.itemEvidenceReady,
    needsHumanReview
  };
}

// src/lib/salesIntelligence/canonicalSalesOutcomeEngine.ts
function deriveCanonicalSalesOutcome(input) {
  const {
    caseId,
    caseType,
    commercialConfirmation,
    saleProof,
    hasMeaningfulBasketItems,
    needsHumanReview
  } = input;
  const base = {
    caseId,
    saleProofState: saleProof.state,
    needsHumanReview: needsHumanReview || saleProof.needsHumanReview
  };
  if (caseType === "information_only" && !hasMeaningfulBasketItems) {
    return {
      ...base,
      outcome: "information_only",
      isSaleCountable: false,
      isRevenueCountable: false,
      isOrderConfirmed: false,
      reasonCodes: ["outcome.information_only"]
    };
  }
  if (saleProof.state === "proven") {
    return {
      ...base,
      outcome: "sale_proven",
      isSaleCountable: true,
      isRevenueCountable: true,
      isOrderConfirmed: commercialConfirmation.currentState === "commercial_confirmation_complete",
      reasonCodes: ["outcome.sale_proven.trusted_invoice"]
    };
  }
  if (saleProof.state === "contradicted") {
    return {
      ...base,
      outcome: "needs_review",
      isSaleCountable: false,
      isRevenueCountable: false,
      isOrderConfirmed: commercialConfirmation.currentState === "commercial_confirmation_complete",
      reasonCodes: ["outcome.sale_evidence_contradicted"]
    };
  }
  if (commercialConfirmation.currentState === "rejected") {
    return {
      ...base,
      outcome: "customer_rejected",
      isSaleCountable: false,
      isRevenueCountable: false,
      isOrderConfirmed: false,
      reasonCodes: ["outcome.customer_rejected"]
    };
  }
  if (commercialConfirmation.currentState === "commercial_confirmation_complete") {
    return {
      ...base,
      outcome: "order_confirmed_unproven",
      isSaleCountable: false,
      isRevenueCountable: false,
      isOrderConfirmed: true,
      reasonCodes: ["outcome.order_confirmed_without_proven_sale"]
    };
  }
  if (commercialConfirmation.customerConfirmed) {
    return {
      ...base,
      outcome: "customer_confirmed_unproven",
      isSaleCountable: false,
      isRevenueCountable: false,
      isOrderConfirmed: false,
      reasonCodes: ["outcome.customer_confirmed_without_final_order_or_sale_proof"]
    };
  }
  if (hasMeaningfulBasketItems) {
    return {
      ...base,
      outcome: "open_opportunity",
      isSaleCountable: false,
      isRevenueCountable: false,
      isOrderConfirmed: false,
      reasonCodes: ["outcome.open_commercial_opportunity"]
    };
  }
  if (needsHumanReview) {
    return {
      ...base,
      outcome: "needs_review",
      isSaleCountable: false,
      isRevenueCountable: false,
      isOrderConfirmed: false,
      reasonCodes: ["outcome.insufficient_or_conflicting_evidence"]
    };
  }
  return {
    ...base,
    outcome: "unknown",
    isSaleCountable: false,
    isRevenueCountable: false,
    isOrderConfirmed: false,
    reasonCodes: ["outcome.unknown"]
  };
}

// src/lib/salesIntelligence/customerNeedModel.ts
var PRICE_OBJECTION_RX = /غالي|السعر\s*(?:عالي|كتير|كبير)|كتير\s*(?:عليه|عليها)|مش\s*مناسب.*(?:السعر|الثمن)|خصم\s*اكتر/i;
var AVAILABILITY_OBJECTION_RX = /مش\s*(?:موجود|متوفر)|مفيش|خلص|مش\s*لاقي|مش\s*لاقية/i;
var DELIVERY_OBJECTION_RX = /التوصيل|الدليفري|المندوب|اتأخر|متأخر|مش\s*(?:هستنى|هقدر\s*استنى)/i;
var PRODUCT_FIT_OBJECTION_RX = /مش\s*مناسب|مش\s*ده|عايز\s*غير|عاوز\s*غير|بديل|حساسي[ةه]|مش\s*نفس/i;
var TIMING_OBJECTION_RX = /مش\s*دلوقتي|بعدين|بعد\s*كده|وقت\s*تاني|لما\s*احتاج/i;
var ALTERNATIVE_RX = /بديل|بدل(?:ه|ها|هم|\s)/i;
function evidenceRef2(messageId2, description) {
  return {
    sourceTable: "whatsapp_review_sources",
    sourceId: "",
    messageIds: [messageId2],
    description
  };
}
function assessment6(level, score, ruleIds, evidence) {
  return { level, score, ruleIds, evidence };
}
function confidenceRank(level) {
  switch (level) {
    case "proven":
      return 4;
    case "strongly_inferred":
      return 3;
    case "weakly_inferred":
      return 2;
    case "unknown":
      return 1;
  }
}
function strongestConfidence(current, next) {
  if (!current) return next;
  if (confidenceRank(next.level) > confidenceRank(current.level)) return next;
  if (confidenceRank(next.level) < confidenceRank(current.level)) return current;
  return next.score > current.score ? next : current;
}
var STOCK_QUESTION_WORDS_RX = /(?<![\p{L}\p{N}])(?:هو|هي|هل|طيب|عندكم|عندكو|عندك|موجود[ةه]?|متوفر[ةه]?|متاح[ةه]?|فيه|في|لو\s*سمحت|من\s*فضلك|ممكن|يا\s*(?:دكتور[ةه]?|فندم))(?![\p{L}\p{N}])/giu;
var NON_PRODUCT_LEFTOVER_RX = /^(?:مش|لا|لأ|اه|آه|تمام|حاجة|حاجه|ده|دي|دا|منه|منها)?$/;
function productPhraseFromStockQuestion(text) {
  const phrase = stripRequestPrefix(text.replace(STOCK_QUESTION_WORDS_RX, " ")).replace(/[؟?!.،]+/g, " ").replace(/\s+/g, " ").trim();
  if (phrase.length < 3 || NON_PRODUCT_LEFTOVER_RX.test(phrase)) return null;
  return phrase;
}
function classifyObjectionCategory(text, explicitRejection, correction) {
  if (PRICE_OBJECTION_RX.test(text)) return "price";
  if (AVAILABILITY_OBJECTION_RX.test(text)) return "availability";
  if (DELIVERY_OBJECTION_RX.test(text)) return "delivery";
  if (PRODUCT_FIT_OBJECTION_RX.test(text)) return "product_fit";
  if (TIMING_OBJECTION_RX.test(text)) return "timing";
  if (explicitRejection) return "customer_declined";
  if (correction) return "unknown";
  return null;
}
function directRequestedProduct(message, quantityPhrase) {
  let text = message.text;
  if (quantityPhrase) text = text.replace(quantityPhrase, " ");
  const stripped = stripRequestPrefix(text).replace(/^(?:لو\s*سمحت|من\s*فضلك)\s*/i, "").replace(/[؟?!.،]+$/g, "").trim();
  return stripped.length >= 2 ? stripped : null;
}
function deriveCustomerNeedModel(input) {
  const messages = input.messages.slice().sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const messageById = new Map(messages.map((message) => [message.id, message]));
  const requestSignals = extractRequestSignals(messages);
  const rejectionSignals = extractRejectionSignals(messages);
  const correctionSignals = extractCorrectionSignals(messages);
  const acceptanceSignals = extractAcceptanceSignals(messages);
  const quantitySignals = extractQuantitySignals(messages);
  const referenceSignals = extractProductReferenceSignals(messages);
  const firstRequestSignal = requestSignals[0] ?? null;
  const firstRequestMessage = firstRequestSignal ? messageById.get(firstRequestSignal.messageId) ?? null : null;
  const products = /* @__PURE__ */ new Map();
  const ensureProduct = (productNameRaw, confidence3, productId = null) => {
    const key = normalizeProductKey(productNameRaw);
    if (!key) return null;
    let product = products.get(key);
    if (!product) {
      product = {
        key,
        productNameRaw,
        productId,
        requestedQuantity: null,
        offeredQuantity: null,
        finalQuantity: null,
        roles: /* @__PURE__ */ new Set(),
        evidenceMessageIds: /* @__PURE__ */ new Set(),
        confidence: confidence3,
        availabilityEvidence: [],
        alternatives: []
      };
      products.set(key, product);
    } else {
      if (!product.productId && productId) product.productId = productId;
      product.confidence = strongestConfidence(product.confidence, confidence3);
    }
    return product;
  };
  const basketIds = input.baskets.map((basket) => basket.basketId);
  for (const basketId of basketIds) {
    const basket = input.baskets.find((candidate) => candidate.basketId === basketId);
    const items = input.itemsByBasketId[basketId] ?? [];
    const isActive = input.activeBasket?.basketId === basketId;
    for (const item of items) {
      const sourceMessage = messageById.get(item.sourceMessageId) ?? null;
      const product = ensureProduct(item.productNameRaw, item.confidence, item.productId);
      if (!product) continue;
      product.evidenceMessageIds.add(item.sourceMessageId);
      if (sourceMessage?.role === "customer") {
        product.roles.add("requested");
        if (product.requestedQuantity == null && item.quantity != null) {
          product.requestedQuantity = item.quantity;
        }
      }
      if (sourceMessage?.role === "staff") {
        product.roles.add("offered");
        if (product.offeredQuantity == null && item.quantity != null) {
          product.offeredQuantity = item.quantity;
        }
      }
      if (sourceMessage && ALTERNATIVE_RX.test(sourceMessage.text)) product.roles.add("alternative");
      if (isActive) {
        product.roles.add("final_basket");
        product.finalQuantity = item.quantity;
        if (basket.status === "confirmed" || basket.confirmedByCustomerAt) {
          product.roles.add("accepted");
        }
        if (basket.status === "cancelled") product.roles.add("rejected");
      }
    }
  }
  for (const signal of quantitySignals) {
    const message = messageById.get(signal.messageId);
    if (!message || message.role !== "customer") continue;
    let productNameRaw = null;
    let quantity = null;
    if (signal.ruleId === "quantity.digit_or_word_plus_unit") {
      const phrase = signal.extractedValue || "";
      const numberToken = phrase.trim().split(/\s+/)[0] || "";
      const digit = Number(numberToken);
      quantity = Number.isFinite(digit) ? digit : { \u0648\u0627\u062D\u062F: 1, \u0648\u0627\u062D\u062F\u0647: 1, \u0648\u0627\u062D\u062F\u0629: 1, \u0627\u062A\u0646\u064A\u0646: 2, \u062A\u0644\u0627\u062A\u0647: 3, \u062A\u0644\u0627\u062A\u0629: 3, \u0627\u0631\u0628\u0639\u0629: 4, \u0623\u0631\u0628\u0639\u0629: 4, \u062E\u0645\u0633\u0629: 5 }[numberToken] ?? null;
      productNameRaw = directRequestedProduct(message, phrase);
    } else {
      const index = messages.indexOf(message);
      const resolved = resolveReference(messages, index);
      productNameRaw = resolved?.text.trim() ?? null;
      const numberMatch = (signal.extractedValue || "").match(/\d+|واحد[ةه]?|اتنين|تلات[ةه]?|أربع[ةه]?|خمس[ةه]?/);
      if (numberMatch) {
        const numeric = Number(numberMatch[0]);
        quantity = Number.isFinite(numeric) ? numeric : { \u0648\u0627\u062D\u062F: 1, \u0648\u0627\u062D\u062F\u0647: 1, \u0648\u0627\u062D\u062F\u0629: 1, \u0627\u062A\u0646\u064A\u0646: 2, \u062A\u0644\u0627\u062A\u0647: 3, \u062A\u0644\u0627\u062A\u0629: 3, \u0627\u0631\u0628\u0639\u0629: 4, \u0623\u0631\u0628\u0639\u0629: 4, \u062E\u0645\u0633\u0629: 5 }[numberMatch[0]] ?? null;
      }
    }
    if (!productNameRaw) continue;
    const ref2 = evidenceRef2(message.id, `\u0627\u0644\u0639\u0645\u064A\u0644 \u0637\u0644\u0628 \u0627\u0644\u0635\u0646\u0641 \u0628\u0643\u0645\u064A\u0629: "${message.text.slice(0, 120)}".`);
    const product = ensureProduct(
      productNameRaw,
      assessment6("strongly_inferred", 0.8, ["need.product.customer_quantity_request"], [ref2])
    );
    if (!product) continue;
    product.roles.add("requested");
    product.evidenceMessageIds.add(message.id);
    if (product.requestedQuantity == null && quantity != null) product.requestedQuantity = quantity;
  }
  for (const signal of referenceSignals) {
    if (signal.extractedValue === "unknown") continue;
    const requestMessage = messageById.get(signal.messageId);
    if (!requestMessage || requestMessage.role !== "customer") continue;
    for (const product of products.values()) {
      const itemSourceMatch = input.baskets.some(
        (basket) => (input.itemsByBasketId[basket.basketId] ?? []).some(
          (item) => normalizeProductKey(item.productNameRaw) === product.key && item.sourceMessageId === signal.extractedValue
        )
      );
      if (!itemSourceMatch) continue;
      product.roles.add("requested");
      product.evidenceMessageIds.add(requestMessage.id);
    }
  }
  for (let i = 0; i < input.baskets.length - 1; i += 1) {
    const before = input.baskets[i];
    const after = input.baskets[i + 1];
    const beforeItems = input.itemsByBasketId[before.basketId] ?? [];
    const afterKeys = new Set((input.itemsByBasketId[after.basketId] ?? []).map((item) => normalizeProductKey(item.productNameRaw)));
    const changeEvidence = after.sourceMessageIds.filter((id) => messageById.get(id)?.role === "customer");
    for (const item of beforeItems) {
      const key = normalizeProductKey(item.productNameRaw);
      if (afterKeys.has(key)) continue;
      const product = products.get(key);
      if (!product) continue;
      product.roles.add("rejected");
      changeEvidence.forEach((id) => product.evidenceMessageIds.add(id));
    }
    const substitutionEvidence = changeEvidence.some((id) => ALTERNATIVE_RX.test(messageById.get(id)?.text || ""));
    if (substitutionEvidence) {
      for (const item of input.itemsByBasketId[after.basketId] ?? []) {
        const product = products.get(normalizeProductKey(item.productNameRaw));
        if (product) product.roles.add("alternative");
      }
    }
  }
  for (const request of requestSignals) {
    const message = messageById.get(request.messageId);
    if (!message) continue;
    const normalizedRequest = normalizeProductKey(stripRequestPrefix(message.text));
    for (const product of products.values()) {
      if (normalizedRequest === product.key || normalizedRequest.includes(product.key) || product.key.includes(normalizedRequest)) {
        product.roles.add("requested");
        product.evidenceMessageIds.add(message.id);
      }
    }
  }
  const staffIdFor = (sender) => input.staffIdBySender?.[sender] ?? null;
  const indexById = new Map(messages.map((message, index) => [message.id, index]));
  const unlinkedAvailability = [];
  const unlinkedAlternatives = [];
  const linkProduct = (staffMessage, exclude = /* @__PURE__ */ new Set()) => {
    const staffText = normalizeProductKey(staffMessage.text);
    const named = Array.from(products.values()).filter(
      (product) => !exclude.has(product.key) && product.key.length >= 3 && product.key !== staffText && !product.evidenceMessageIds.has(staffMessage.id) && staffText.includes(product.key)
    );
    if (named.length === 1) return { product: named[0], basis: "product_named_in_message" };
    if (named.length > 1) return null;
    const index = indexById.get(staffMessage.id) ?? -1;
    const before = messages.slice(0, Math.max(index, 0));
    const lastStaffIndex = before.map((message) => message.role === "staff" && message.isMeaningful).lastIndexOf(true);
    const customerTurn = before.slice(lastStaffIndex + 1).filter((message) => message.role === "customer" && isRequestCandidate(message));
    const request = customerTurn.length === 1 ? customerTurn[0] : null;
    if (customerTurn.length > 1) return null;
    if (request) {
      const tied = Array.from(products.values()).filter(
        (product) => !exclude.has(product.key) && product.evidenceMessageIds.has(request.id)
      );
      if (tied.length === 1) return { product: tied[0], basis: "single_open_request" };
      if (tied.length === 0) {
        const phrase = productPhraseFromStockQuestion(request.text);
        if (phrase && !exclude.has(normalizeProductKey(phrase))) {
          const ref2 = evidenceRef2(request.id, `\u0627\u0644\u0639\u0645\u064A\u0644 \u0633\u0623\u0644 \u0639\u0646 \u0627\u0644\u0635\u0646\u0641: "${request.text.slice(0, 120)}".`);
          const created = ensureProduct(
            phrase,
            assessment6("weakly_inferred", 0.6, ["need.product.customer_stock_question"], [ref2])
          );
          if (created) {
            created.roles.add("requested");
            created.evidenceMessageIds.add(request.id);
            return { product: created, basis: "single_open_request" };
          }
        }
      }
    }
    const requested = Array.from(products.values()).filter(
      (product) => !exclude.has(product.key) && product.roles.has("requested") && Array.from(product.evidenceMessageIds).some((id) => (indexById.get(id) ?? Infinity) < index)
    );
    return requested.length === 1 ? { product: requested[0], basis: "single_open_request" } : null;
  };
  const availabilityByMessageId = /* @__PURE__ */ new Map();
  const namedInClause = (clause, message) => {
    const clauseKey = normalizeProductKey(clause);
    return Array.from(products.values()).filter(
      (product) => product.key.length >= 3 && product.key !== normalizeProductKey(message.text) && !product.evidenceMessageIds.has(message.id) && clauseKey.includes(product.key)
    );
  };
  const availabilityFact = (message, state, basis, signalConfidence, ruleId) => ({
    state,
    messageId: message.id,
    staffSender: message.sender,
    staffId: staffIdFor(message.sender),
    linkBasis: basis,
    confidence: assessment6(
      basis === "product_named_in_message" ? "strongly_inferred" : "weakly_inferred",
      basis === "product_named_in_message" ? signalConfidence : Math.min(signalConfidence, 0.7),
      [ruleId, `need.availability.link.${basis}`],
      [evidenceRef2(message.id, `\u0627\u0644\u0645\u0648\u0638\u0641 (${message.sender}) \u0642\u0627\u0644 \u0639\u0646 \u0627\u0644\u062A\u0648\u0641\u0631: "${message.text.slice(0, 120)}".`)]
    )
  });
  const attach = (product, fact) => {
    product.availabilityEvidence.push(fact);
    product.evidenceMessageIds.add(fact.messageId);
    if (fact.state === "unavailable" || !availabilityByMessageId.has(fact.messageId)) {
      availabilityByMessageId.set(fact.messageId, product);
    }
  };
  for (const signal of extractAvailabilitySignals(messages)) {
    const message = messageById.get(signal.messageId);
    if (!message) continue;
    const clauseLinks = availabilityStatementClausesV32(message.text).map((row) => ({ state: row.state, named: namedInClause(row.clause, message) })).filter((row) => row.named.length === 1);
    if (clauseLinks.length > 0) {
      const seen = /* @__PURE__ */ new Set();
      for (const row of clauseLinks) {
        const product = row.named[0];
        if (seen.has(product.key)) continue;
        seen.add(product.key);
        attach(product, availabilityFact(message, row.state, "product_named_in_message", signal.confidence, `availability.staff_statement.${row.state}`));
      }
      continue;
    }
    const state = signal.extractedValue;
    const link = linkProduct(message);
    const fact = availabilityFact(message, state, link?.basis ?? "unlinked", signal.confidence, signal.ruleId);
    if (!link) {
      unlinkedAvailability.push(fact);
      continue;
    }
    attach(link.product, fact);
  }
  const alternativeSignals = extractAlternativeOfferSignals(messages);
  const alternativeMessageIds = new Set(alternativeSignals.map((signal) => signal.messageId));
  const customerResponseTo = (offer) => {
    const start = (indexById.get(offer.id) ?? -1) + 1;
    const replies = [];
    for (const message of messages.slice(start)) {
      if (alternativeMessageIds.has(message.id)) break;
      if (message.role === "customer" && message.isMeaningful) replies.push(message);
      if (replies.length >= 3) break;
    }
    if (replies.length === 0) return { response: "no_response", messageId: null };
    for (const reply of replies) {
      const response = classifyCustomerOfferResponseV32(reply.text);
      if (response) return { response, messageId: reply.id };
    }
    return { response: "unknown", messageId: null };
  };
  const itemsSourcedFrom = (messageId2) => input.baskets.flatMap((basket) => input.itemsByBasketId[basket.basketId] ?? []).filter(
    (item) => item.sourceMessageId === messageId2
  );
  for (const signal of alternativeSignals) {
    const offer = messageById.get(signal.messageId);
    if (!offer) continue;
    const trigger = (signal.relatedMessageIds ?? [])[0];
    let original = (trigger ? availabilityByMessageId.get(trigger) : void 0) ?? availabilityByMessageId.get(offer.id) ?? null;
    const offerText = normalizeProductKey(offer.text);
    const sourcedKeys = Array.from(
      new Set(itemsSourcedFrom(offer.id).map((item) => normalizeProductKey(item.productNameRaw)))
    ).filter((key) => key && key !== original?.key && key !== offerText);
    const phraseKey = signal.extractedValue ? normalizeProductKey(signal.extractedValue) : "";
    let alternativeProduct = sourcedKeys.length === 1 ? products.get(sourcedKeys[0]) ?? null : phraseKey && phraseKey !== original?.key ? products.get(phraseKey) ?? null : null;
    if (!original) {
      const link = linkProduct(offer, new Set(alternativeProduct ? [alternativeProduct.key] : []));
      original = link?.product ?? null;
    }
    if (alternativeProduct && alternativeProduct.key === original?.key) alternativeProduct = null;
    if (alternativeProduct) {
      alternativeProduct.roles.add("alternative");
      alternativeProduct.evidenceMessageIds.add(offer.id);
    }
    const { response: textResponse, messageId: responseMessageId } = customerResponseTo(offer);
    const inFinalBasket = alternativeProduct?.roles.has("final_basket") ?? false;
    const response = textResponse === "unknown" || textResponse === "no_response" ? inFinalBasket ? "accepted" : textResponse : textResponse;
    const evidenceIds = [
      ...trigger ? [trigger] : [],
      offer.id,
      ...responseMessageId ? [responseMessageId] : []
    ];
    const named = Boolean(alternativeProduct || signal.extractedValue);
    const alternative = {
      productKey: alternativeProduct?.key ?? null,
      productNameRaw: alternativeProduct?.productNameRaw ?? signal.extractedValue ?? null,
      productId: alternativeProduct?.productId ?? null,
      offerMessageId: offer.id,
      offeredByStaffSender: offer.sender,
      offeredByStaffId: staffIdFor(offer.sender),
      response,
      responseMessageId,
      evidenceMessageIds: evidenceIds,
      confidence: assessment6(
        original && named ? "strongly_inferred" : "weakly_inferred",
        original && named ? signal.confidence : Math.min(signal.confidence, 0.6),
        [signal.ruleId, `need.alternative.response.${response}`],
        [evidenceRef2(offer.id, `\u0627\u0644\u0645\u0648\u0638\u0641 (${offer.sender}) \u0639\u0631\u0636 \u0628\u062F\u064A\u0644\u064B\u0627: "${offer.text.slice(0, 120)}".`)]
      )
    };
    if (!original) {
      unlinkedAlternatives.push(alternative);
      continue;
    }
    original.alternatives.push(alternative);
    evidenceIds.forEach((id) => original.evidenceMessageIds.add(id));
  }
  const currentAvailability = (product) => {
    const latest = product.availabilityEvidence.slice().sort((a, b) => (indexById.get(a.messageId) ?? 0) - (indexById.get(b.messageId) ?? 0)).pop();
    return latest?.state ?? "unknown";
  };
  const rejectionIds = new Set(rejectionSignals.map((signal) => signal.messageId));
  const correctionIds = new Set(correctionSignals.map((signal) => signal.messageId));
  const objections = [];
  for (const message of messages) {
    if (message.role !== "customer" || !message.isMeaningful) continue;
    const category = classifyObjectionCategory(
      message.text,
      rejectionIds.has(message.id),
      correctionIds.has(message.id)
    );
    if (!category) continue;
    const score = category === "unknown" ? 0.55 : 0.8;
    objections.push({
      category,
      text: message.text,
      messageId: message.id,
      confidence: assessment6(
        category === "unknown" ? "weakly_inferred" : "strongly_inferred",
        score,
        [`need.objection.${category}`],
        [evidenceRef2(message.id, `\u0627\u0639\u062A\u0631\u0627\u0636/\u0639\u0627\u0626\u0642 \u0635\u0631\u064A\u062D \u0645\u0646 \u0627\u0644\u0639\u0645\u064A\u0644: "${message.text.slice(0, 120)}".`)]
      )
    });
  }
  const activeItems = input.activeBasket ? input.itemsByBasketId[input.activeBasket.basketId] ?? [] : [];
  const alternativeAnswerIds = new Set(
    Array.from(products.values()).flatMap(
      (product) => product.alternatives.map((alternative) => alternative.responseMessageId).filter(Boolean)
    )
  );
  const needDeclineMessageIds = Array.from(
    /* @__PURE__ */ new Set([
      ...objections.filter((objection) => objection.category === "customer_declined" && !alternativeAnswerIds.has(objection.messageId)).map((objection) => objection.messageId),
      ...messages.filter((message) => message.role === "customer" && message.isMeaningful && classifyCustomerIntentStatementV32(message.text) === "final_decline").map((message) => message.id)
    ])
  );
  const explicitDecline = needDeclineMessageIds.length > 0;
  const structurallyIncomplete = !input.activeBasket || activeItems.length === 0 || input.activeBasket.status === "draft" || input.activeBasket.status === "awaiting_confirmation" || activeItems.some(
    (item) => item.quantity == null || item.resolutionStatus === "unknown" || item.resolutionStatus === "contradicted"
  );
  const unresolvedNeed = requestSignals.length > 0 && input.activeBasket?.status !== "cancelled" && !explicitDecline && structurallyIncomplete;
  const humanReviewReasons = [];
  if (requestSignals.length > 0 && products.size === 0) {
    humanReviewReasons.push("customer_need_without_resolved_product_context");
  }
  if (activeItems.some(
    (item) => item.resolutionStatus === "unknown" || item.resolutionStatus === "contradicted"
  )) {
    humanReviewReasons.push("customer_need_product_context_ambiguous");
  }
  const productList = Array.from(products.values()).map((product) => ({
    key: product.key,
    productNameRaw: product.productNameRaw,
    productId: product.productId,
    requestedQuantity: product.requestedQuantity,
    offeredQuantity: product.offeredQuantity,
    finalQuantity: product.finalQuantity,
    roles: Array.from(product.roles),
    availability: currentAvailability(product),
    availabilityEvidence: product.availabilityEvidence,
    alternatives: product.alternatives,
    evidenceMessageIds: Array.from(product.evidenceMessageIds),
    confidence: product.confidence ?? assessment6("unknown", 0.2, ["need.product.insufficient_evidence"], [])
  }));
  const evidenceMessageIds = Array.from(
    /* @__PURE__ */ new Set([
      ...requestSignals.map((signal) => signal.messageId),
      ...productList.flatMap((product) => product.evidenceMessageIds),
      ...objections.map((objection) => objection.messageId),
      ...acceptanceSignals.map((signal) => signal.messageId)
    ])
  );
  let confidence2;
  if (requestSignals.length > 0 && productList.length > 0) {
    confidence2 = assessment6(
      "strongly_inferred",
      0.85,
      ["need.model.request_plus_product_lifecycle"],
      firstRequestMessage ? [evidenceRef2(firstRequestMessage.id, `\u0627\u0644\u062D\u0627\u062C\u0629 \u0627\u0644\u0623\u0633\u0627\u0633\u064A\u0629 \u0643\u0645\u0627 \u0642\u0627\u0644\u0647\u0627 \u0627\u0644\u0639\u0645\u064A\u0644: "${firstRequestMessage.text.slice(0, 120)}".`)] : []
    );
  } else if (requestSignals.length > 0) {
    confidence2 = assessment6(
      "weakly_inferred",
      0.55,
      ["need.model.request_without_product_lifecycle"],
      firstRequestMessage ? [evidenceRef2(firstRequestMessage.id, `\u0637\u0644\u0628/\u0627\u062D\u062A\u064A\u0627\u062C \u062D\u0642\u064A\u0642\u064A \u0628\u062F\u0648\u0646 \u0645\u0646\u062A\u062C \u0645\u062D\u0633\u0648\u0645: "${firstRequestMessage.text.slice(0, 120)}".`)] : []
    );
  } else if (productList.length > 0) {
    confidence2 = assessment6(
      "weakly_inferred",
      0.5,
      ["need.model.product_without_explicit_customer_request"],
      []
    );
  } else {
    confidence2 = assessment6("unknown", 0.1, ["need.model.no_commercial_need_evidence"], []);
  }
  return {
    caseId: input.caseId,
    primaryNeed: firstRequestMessage?.text ?? null,
    primaryNeedMessageId: firstRequestMessage?.id ?? null,
    products: productList,
    unlinkedAvailability,
    unlinkedAlternatives,
    objections,
    unresolvedNeed,
    needDeclined: explicitDecline,
    needDeclineMessageIds,
    evidenceMessageIds,
    confidence: confidence2,
    needsHumanReview: humanReviewReasons.length > 0,
    humanReviewReasons
  };
}

// src/lib/salesIntelligence/commercialJourneyStateMachine.ts
function ref(messageId2, description) {
  return { sourceTable: "whatsapp_review_sources", sourceId: "", messageIds: [messageId2], description };
}
function assess(level, score, ruleId, evidence = []) {
  return { level, score, ruleIds: [ruleId], evidence };
}
var PROGRESSION = [
  "need_identified",
  "clarifying",
  "offer_made",
  "basket_building",
  "awaiting_customer_confirmation",
  "customer_confirmed",
  "awaiting_invoice",
  "sale_proven"
];
function deriveCommercialJourneyState(input) {
  const clarifications = extractClarificationQuestionSignals(input.messages);
  const offered = input.customerNeed.products.some((p) => p.roles.includes("offered"));
  const basketBuilt = input.customerNeed.products.some((p) => p.roles.includes("final_basket") || p.roles.includes("requested"));
  const declined = input.salesOutcome.outcome === "customer_rejected" || input.customerNeed.needDeclined;
  const reached = /* @__PURE__ */ new Set();
  const evidenceIds = /* @__PURE__ */ new Set();
  if (input.customerNeed.primaryNeedMessageId) {
    reached.add("need_identified");
    evidenceIds.add(input.customerNeed.primaryNeedMessageId);
  }
  if (clarifications.length) {
    reached.add("clarifying");
    clarifications.forEach((s) => evidenceIds.add(s.messageId));
  }
  if (offered) {
    reached.add("offer_made");
    input.customerNeed.products.filter((p) => p.roles.includes("offered")).flatMap((p) => p.evidenceMessageIds).forEach((id) => evidenceIds.add(id));
  }
  if (basketBuilt) {
    reached.add("basket_building");
    input.customerNeed.products.flatMap((p) => p.evidenceMessageIds).forEach((id) => evidenceIds.add(id));
  }
  if (input.commercialConfirmation.summaryPresented) reached.add("awaiting_customer_confirmation");
  if (input.commercialConfirmation.customerConfirmed) reached.add("customer_confirmed");
  if (input.commercialConfirmation.staffConfirmed || input.salesOutcome.outcome === "order_confirmed_unproven") {
    reached.add("awaiting_invoice");
  }
  input.commercialConfirmation.primaryMessageIds.forEach((id) => evidenceIds.add(id));
  if (input.salesOutcome.outcome === "sale_proven") reached.add("sale_proven");
  let currentState = "unknown";
  let confidence2 = assess("unknown", 0.1, "journey.no_reliable_state_evidence");
  const reasonCodes = [];
  if (input.salesOutcome.outcome === "information_only") {
    currentState = "information_only";
    reasonCodes.push("journey.information_only_from_canonical_outcome");
    confidence2 = assess("proven", 0.95, reasonCodes[0]);
  } else if (input.salesOutcome.outcome === "sale_proven") {
    currentState = "sale_proven";
    reasonCodes.push("journey.sale_proven_only_from_canonical_outcome");
    confidence2 = assess("proven", 1, reasonCodes[0]);
  } else if (declined) {
    currentState = "customer_declined";
    reasonCodes.push("journey.customer_declined_from_customer_evidence");
    const declineId = input.customerNeed.needDeclineMessageIds[0];
    const declineMessage = declineId ? input.messages.find((m) => m.id === declineId) : void 0;
    confidence2 = assess(
      "strongly_inferred",
      0.9,
      reasonCodes[0],
      declineId ? [ref(declineId, `\u0631\u0641\u0636 \u0635\u0631\u064A\u062D \u0645\u0646 \u0627\u0644\u0639\u0645\u064A\u0644: "${(declineMessage?.text ?? "").slice(0, 120)}".`)] : []
    );
  } else {
    for (const state of PROGRESSION) if (reached.has(state)) currentState = state;
    const states = {
      awaiting_invoice: ["journey.order_confirmed_sale_not_yet_proven", "strongly_inferred", 0.9],
      customer_confirmed: ["journey.customer_confirmed_waiting_staff_or_invoice", "strongly_inferred", 0.85],
      awaiting_customer_confirmation: ["journey.final_basket_presented_waiting_customer", "strongly_inferred", 0.8],
      basket_building: ["journey.basket_evidence_present", "strongly_inferred", 0.75],
      offer_made: ["journey.staff_offer_present", "strongly_inferred", 0.7],
      clarifying: ["journey.clarification_in_progress", "strongly_inferred", 0.7],
      need_identified: ["journey.customer_need_identified", "strongly_inferred", 0.7]
    };
    const row = states[currentState];
    if (row) {
      reasonCodes.push(row[0]);
      confidence2 = assess(row[1], row[2], row[0]);
    } else {
      reasonCodes.push("journey.no_reliable_state_evidence");
    }
  }
  return {
    caseId: input.caseId,
    currentState,
    reachedStates: [
      ...currentState === "information_only" ? ["information_only"] : [],
      ...PROGRESSION.filter((state) => reached.has(state)),
      ...declined ? ["customer_declined"] : []
    ],
    evidenceMessageIds: Array.from(evidenceIds),
    reasonCodes,
    confidence: confidence2,
    reviewRequired: input.salesOutcome.needsHumanReview || input.customerNeed.needsHumanReview || input.salesOutcome.outcome === "needs_review"
  };
}

// src/lib/salesIntelligence/unavailableDemandEngine.ts
var DEMAND_STATES = /* @__PURE__ */ new Set(["unavailable", "check_pending"]);
function demandKeyFor(caseId, product) {
  return product.productId ? `${caseId}:demand:product:${product.productId}` : `${caseId}:demand:raw:${product.key}`;
}
function statingFact(product, order) {
  return product.availabilityEvidence.filter((fact) => fact.state === product.availability).sort((a, b) => (order.get(a.messageId) ?? 0) - (order.get(b.messageId) ?? 0)).pop() ?? null;
}
function decisiveAlternative(alternatives, order) {
  if (alternatives.length === 0) return null;
  const accepted = alternatives.find((alternative) => alternative.response === "accepted");
  if (accepted) return accepted;
  return alternatives.slice().sort((a, b) => (order.get(a.offerMessageId) ?? 0) - (order.get(b.offerMessageId) ?? 0)).pop();
}
function lowerConfidence(a, b, ruleIds) {
  const rank = { proven: 4, strongly_inferred: 3, weakly_inferred: 2, unknown: 1 };
  const weaker = rank[b.level] < rank[a.level] || rank[b.level] === rank[a.level] && b.score < a.score ? b : a;
  return {
    level: weaker.level,
    score: Math.min(a.score, b.score),
    ruleIds: [.../* @__PURE__ */ new Set([...a.ruleIds, ...ruleIds])],
    evidence: a.evidence
  };
}
function followUpDecision(state, alternative, declinedNeed) {
  if (alternative?.response === "accepted") return { candidate: false, reason: null, suppressedBy: "alternative_accepted" };
  if (declinedNeed) return { candidate: false, reason: null, suppressedBy: "customer_declined_need" };
  if (state === "check_pending") return { candidate: true, reason: "availability_check_pending", suppressedBy: null };
  if (!alternative) return { candidate: true, reason: "original_unavailable_no_alternative", suppressedBy: null };
  if (alternative.response === "rejected") return { candidate: true, reason: "alternative_rejected", suppressedBy: null };
  return { candidate: true, reason: "alternative_undecided", suppressedBy: null };
}
function deriveUnavailableDemand(input) {
  const { conversationCase, customerNeed } = input;
  const order = new Map(input.messages.map((message, index) => [message.id, index]));
  const byId = new Map(input.messages.map((message) => [message.id, message]));
  const identityStatus = input.customerIdentityStatus ?? "not_provided";
  const customerId = identityStatus === "resolved" ? conversationCase.customerId : null;
  const declinedNeed = customerNeed.needDeclined;
  const demands = /* @__PURE__ */ new Map();
  for (const product of customerNeed.products) {
    if (!product.roles.includes("requested") || !DEMAND_STATES.has(product.availability)) continue;
    const fact = statingFact(product, order);
    if (!fact) continue;
    const state = product.availability;
    const alternative = decisiveAlternative(product.alternatives, order);
    const followUp = followUpDecision(state, alternative, declinedNeed);
    const customerRequestAt = product.evidenceMessageIds.map((id) => byId.get(id)).filter((message) => Boolean(message && message.role === "customer")).sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())[0];
    const blockers = [];
    if (!customerId) blockers.push("customer_identity_unresolved");
    if (!conversationCase.branchId && !conversationCase.branchNameRaw) blockers.push("branch_unknown");
    if (!fact.staffId) blockers.push("staff_identity_unresolved");
    if (!product.productId) blockers.push("product_identity_unresolved");
    if (product.requestedQuantity == null) blockers.push("quantity_unknown");
    const demand = {
      demandKey: demandKeyFor(conversationCase.caseId, product),
      caseId: conversationCase.caseId,
      conversationId: conversationCase.conversationId,
      sourceCaseIdV22: conversationCase.sourceCaseIdV22,
      customerId,
      customerIdentityStatus: identityStatus,
      branchId: conversationCase.branchId,
      branchNameRaw: conversationCase.branchNameRaw,
      requestedAt: customerRequestAt ? customerRequestAt.timestamp.toISOString() : null,
      productKey: product.key,
      requestedProductRaw: product.productNameRaw,
      resolvedProductId: product.productId,
      quantityRequested: product.requestedQuantity,
      availabilityState: state,
      availabilityMessageId: fact.messageId,
      statedByStaffName: fact.staffSender,
      statedByStaffId: fact.staffId,
      alternativeOffered: product.alternatives.length > 0,
      alternativeProductKey: alternative?.productKey ?? null,
      alternativeProductRaw: alternative?.productNameRaw ?? null,
      alternativeProductId: alternative?.productId ?? null,
      alternativeOfferedByStaffName: alternative?.offeredByStaffSender ?? null,
      alternativeOfferedByStaffId: alternative?.offeredByStaffId ?? null,
      alternativeResponse: alternative?.response ?? null,
      followUpCandidate: followUp.candidate,
      followUpReason: followUp.reason,
      followUpSuppressedBy: followUp.suppressedBy,
      evidenceMessageIds: [...product.evidenceMessageIds],
      confidence: lowerConfidence(fact.confidence, product.confidence, [
        `unavailable_demand.${state}`,
        ...followUp.reason ? [`unavailable_demand.follow_up.${followUp.reason}`] : [],
        ...followUp.suppressedBy ? [`unavailable_demand.no_follow_up.${followUp.suppressedBy}`] : []
      ]),
      blockers
    };
    const existing = demands.get(demand.demandKey);
    if (!existing) {
      demands.set(demand.demandKey, demand);
      continue;
    }
    existing.evidenceMessageIds = [.../* @__PURE__ */ new Set([...existing.evidenceMessageIds, ...demand.evidenceMessageIds])];
    if (existing.quantityRequested != null && demand.quantityRequested != null && existing.quantityRequested !== demand.quantityRequested) {
      existing.quantityRequested = null;
      existing.blockers = [.../* @__PURE__ */ new Set([...existing.blockers.filter((b) => b !== "quantity_unknown"), "quantity_conflict"])];
    } else if (existing.quantityRequested == null && demand.quantityRequested != null && !existing.blockers.includes("quantity_conflict")) {
      existing.quantityRequested = demand.quantityRequested;
      existing.blockers = existing.blockers.filter((b) => b !== "quantity_unknown");
    }
  }
  return [...demands.values()];
}

// src/lib/salesIntelligence/lostOpportunityEngine.ts
var REASON_PROFILE = {
  stock_unavailable: { stage: "availability", responsibility: "inventory" },
  alternative_rejected: { stage: "availability", responsibility: "inventory" },
  price: { stage: "price", responsibility: "customer" },
  customer_no_response: { stage: "response", responsibility: "customer" },
  staff_no_response: { stage: "response", responsibility: "staff" },
  slow_response: { stage: "response", responsibility: "staff" },
  delivery_issue: { stage: "fulfillment", responsibility: "delivery" },
  product_not_suitable: { stage: "offer", responsibility: "customer" },
  prescription_unclear: { stage: "need", responsibility: "unknown" },
  customer_declined: { stage: "closing", responsibility: "customer" },
  competitor: { stage: "closing", responsibility: "customer" },
  unknown: { stage: "unknown", responsibility: "unknown" }
};
var OBJECTION_REASON = {
  price: "price",
  delivery: "delivery_issue",
  product_fit: "product_not_suitable"
};
function verdict(state, reason, recoverability, waitingOn, level, score, explanation, evidence) {
  const profile = reason ? REASON_PROFILE[reason] : null;
  return {
    state,
    waitingOn,
    reason,
    stage: profile?.stage ?? "unknown",
    responsibility: profile?.responsibility ?? "unknown",
    recoverability,
    level,
    score,
    explanation,
    evidence
  };
}
function deriveLostOpportunity(input) {
  const { customerNeed, unavailableDemand, salesOutcome, commercialConfirmation, journeyState } = input;
  const messages = input.messages.slice().sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const meaningful = messages.filter((m) => m.isMeaningful && (m.role === "customer" || m.role === "staff"));
  const last = meaningful[meaningful.length - 1] ?? null;
  const intents = [];
  for (const m of meaningful) {
    if (m.role !== "customer") continue;
    const intent = classifyCustomerIntentStatementV32(m.text);
    if (intent) intents.push({ intent, messageId: m.id });
  }
  const has = (intent) => intents.filter((row) => row.intent === intent);
  const alternatives = customerNeed.products.flatMap((p) => p.alternatives);
  const objectionOf = (category) => customerNeed.objections.filter((o) => o.category === category);
  const blockingDemand = unavailableDemand.filter((d) => d.alternativeResponse !== "accepted");
  const rejectedAlternativeDemand = blockingDemand.filter((d) => d.alternativeResponse === "rejected");
  const staffFacts = [];
  for (const demand of unavailableDemand) {
    staffFacts.push({
      fact: demand.availabilityState === "unavailable" ? "stated_unavailable" : "stated_check_pending",
      messageId: demand.availabilityMessageId,
      staffSender: demand.statedByStaffName,
      staffId: demand.statedByStaffId
    });
  }
  for (const alternative of alternatives) {
    staffFacts.push({
      fact: "offered_alternative",
      messageId: alternative.offerMessageId,
      staffSender: alternative.offeredByStaffSender,
      staffId: alternative.offeredByStaffId
    });
  }
  const hasCommercialNeed = salesOutcome.outcome !== "information_only" && journeyState.currentState !== "information_only" && (customerNeed.products.length > 0 || customerNeed.primaryNeedMessageId !== null);
  let v;
  if (salesOutcome.outcome === "sale_proven") {
    v = verdict("won", null, "none", null, "proven", 1, "won.canonical_sale_proven", []);
  } else if (!hasCommercialNeed) {
    v = verdict("no_commercial_opportunity", null, "none", null, "strongly_inferred", 0.85, "no_commercial_opportunity.no_customer_need", []);
  } else if (has("bought_elsewhere").length) {
    const ids = has("bought_elsewhere").map((r) => r.messageId);
    v = verdict("lost", "competitor", "none", null, "strongly_inferred", 0.9, "lost.customer_bought_elsewhere", ids);
  } else if (customerNeed.needDeclined || salesOutcome.outcome === "customer_rejected") {
    const ids = customerNeed.needDeclineMessageIds;
    let reason = "customer_declined";
    if (objectionOf("price").length) reason = "price";
    else if (rejectedAlternativeDemand.length) reason = "alternative_rejected";
    else if (blockingDemand.some((d) => d.availabilityState === "unavailable")) reason = "stock_unavailable";
    else if (objectionOf("product_fit").length) reason = "product_not_suitable";
    else if (objectionOf("delivery").length) reason = "delivery_issue";
    else if (has("delay_complaint").length) reason = "slow_response";
    const causeIds = reason === "price" ? objectionOf("price").map((o) => o.messageId) : reason === "product_not_suitable" ? objectionOf("product_fit").map((o) => o.messageId) : reason === "delivery_issue" ? objectionOf("delivery").map((o) => o.messageId) : reason === "slow_response" ? has("delay_complaint").map((r) => r.messageId) : blockingDemand.flatMap((d) => [d.availabilityMessageId]);
    v = verdict("lost", reason, "none", null, "strongly_inferred", 0.85, `lost.explicit_customer_decline.${reason}`, [...causeIds, ...ids]);
  } else if (commercialConfirmation.currentState === "commercial_confirmation_complete" || journeyState.currentState === "awaiting_invoice") {
    v = verdict("open", null, "high", "invoice", "strongly_inferred", 0.85, "open.order_confirmed_awaiting_invoice", commercialConfirmation.primaryMessageIds);
  } else if (blockingDemand.length) {
    const pending = blockingDemand.find((d) => d.availabilityState === "check_pending");
    const rejected = rejectedAlternativeDemand[0];
    const undecided = blockingDemand.find((d) => d.alternativeOffered && d.alternativeResponse !== "rejected");
    if (pending) {
      v = verdict("open", null, "high", "staff", "strongly_inferred", 0.75, "open.staff_checking_availability", [pending.availabilityMessageId]);
    } else if (rejected) {
      v = verdict("recoverable", "alternative_rejected", "low", "stock", "strongly_inferred", 0.75, "recoverable.alternative_rejected_need_remains", rejected.evidenceMessageIds);
    } else if (undecided) {
      v = verdict("recoverable", "stock_unavailable", "high", "customer", "strongly_inferred", 0.75, "recoverable.alternative_open", undecided.evidenceMessageIds);
    } else {
      const demand = blockingDemand[0];
      v = verdict("recoverable", "stock_unavailable", "high", "stock", "strongly_inferred", 0.8, "recoverable.stock_unavailable_need_remains", [
        ...demand.evidenceMessageIds,
        ...has("will_wait").map((r) => r.messageId)
      ]);
    }
  } else if (objectionOf("price").length || objectionOf("delivery").length || objectionOf("product_fit").length) {
    const category = objectionOf("price").length ? "price" : objectionOf("delivery").length ? "delivery" : "product_fit";
    const reason = OBJECTION_REASON[category];
    const recoverability = category === "delivery" ? "high" : "medium";
    v = verdict("recoverable", reason, recoverability, "customer", "strongly_inferred", 0.75, `recoverable.open_objection.${reason}`, [
      ...objectionOf(category).map((o) => o.messageId),
      ...has("considering").map((r) => r.messageId)
    ]);
  } else if (last && last.role === "customer" && (alternatives.some((a) => a.response === "accepted" && a.responseMessageId === last.id) || extractAcceptanceSignals(messages).some((signal) => signal.messageId === last.id))) {
    v = verdict("open", null, "high", "staff", "strongly_inferred", 0.75, "open.customer_accepted_awaiting_staff", [last.id]);
  } else if (last && last.role === "customer" && isRequestCandidate(last) && customerNeed.primaryNeedMessageId) {
    v = verdict("recoverable", "staff_no_response", "high", "staff", "weakly_inferred", 0.6, "recoverable.customer_request_unanswered", [last.id]);
  } else if (last && last.role === "staff" && staffAwaitsReply(last, messages, commercialConfirmation)) {
    staffFacts.push({ fact: "awaiting_customer_reply", messageId: last.id, staffSender: last.sender, staffId: null });
    v = verdict("recoverable", "customer_no_response", "medium", "customer", "weakly_inferred", 0.55, "recoverable.customer_silent_after_real_offer", [last.id]);
  } else if (has("considering").length || objectionOf("timing").length) {
    v = verdict("open", null, "medium", "customer", "strongly_inferred", 0.7, "open.customer_considering", [
      ...has("considering").map((r) => r.messageId),
      ...objectionOf("timing").map((o) => o.messageId)
    ]);
  } else if (journeyState.currentState !== "unknown") {
    v = verdict("open", null, "unknown", null, "weakly_inferred", 0.5, `open.journey_${journeyState.currentState}`, journeyState.evidenceMessageIds);
  } else {
    v = verdict("unknown", null, "unknown", null, "unknown", 0.2, "unknown.insufficient_evidence", []);
  }
  const productLosses = deriveProductLosses(customerNeed, unavailableDemand, v.state);
  const evidenceMessageIds = [.../* @__PURE__ */ new Set([...v.evidence, ...productLosses.flatMap((p) => p.evidenceMessageIds)])];
  const confidence2 = {
    level: v.level,
    score: v.score,
    ruleIds: [v.explanation],
    evidence: v.evidence.length ? [{ sourceTable: "whatsapp_review_sources", sourceId: "", messageIds: [...new Set(v.evidence)], description: v.explanation }] : []
  };
  return {
    caseId: input.caseId,
    state: v.state,
    waitingOn: v.state === "open" || v.state === "recoverable" ? v.waitingOn : null,
    reason: v.reason,
    stage: v.stage,
    responsibility: v.responsibility,
    recoverability: v.recoverability,
    productKeys: customerNeed.products.filter((p) => p.roles.includes("requested")).map((p) => p.key),
    productLosses,
    staffFacts,
    evidenceMessageIds,
    confidence: confidence2,
    explanation: v.explanation
  };
}
function staffAwaitsReply(message, messages, confirmation) {
  if (extractClarificationQuestionSignals([message]).length) return true;
  if (extractAlternativeOfferSignals(messages).some((s) => s.messageId === message.id)) return true;
  return confirmation.currentState === "awaiting_customer_confirmation" && confirmation.primaryMessageIds.includes(message.id);
}
function deriveProductLosses(customerNeed, demands, state) {
  const losses = [];
  for (const product of customerNeed.products) {
    if (!product.roles.includes("requested") || product.roles.includes("final_basket")) continue;
    const demand = demands.find((d) => d.productKey === product.key) ?? null;
    let outcome = "unknown";
    let reason = null;
    if (demand) {
      if (demand.alternativeResponse === "accepted") {
        outcome = "replaced_by_alternative";
        reason = "stock_unavailable";
      } else {
        reason = demand.alternativeResponse === "rejected" ? "alternative_rejected" : "stock_unavailable";
        outcome = state === "lost" ? "lost" : "recoverable";
      }
    } else if (product.roles.includes("rejected")) {
      outcome = "lost";
      reason = "customer_declined";
    } else {
      continue;
    }
    losses.push({
      productKey: product.key,
      requestedProductRaw: product.productNameRaw,
      productId: product.productId,
      outcome,
      reason,
      demandKey: demand?.demandKey ?? null,
      evidenceMessageIds: demand?.evidenceMessageIds ?? product.evidenceMessageIds
    });
  }
  return losses;
}

// src/lib/whatsappFollowupIdentity.ts
var FOLLOWUP_IDENTITY_VERSION = "fu1";
function normalizeFollowupKeyPart(value) {
  return String(value ?? "").replace(/[٠-٩]/g, (digit) => String("\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669".indexOf(digit))).replace(/[أإآ]/g, "\u0627").replace(/ة/g, "\u0647").replace(/ى/g, "\u064A").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, "-");
}
function followupCustomerAnchor(identity, canonicalCaseAnchor) {
  if (identity?.status === "resolved") {
    if (identity.customerId) return `customer:${identity.customerId}`;
    if (identity.normalizedPhone) return `phone:${identity.normalizedPhone}`;
    if (identity.customerCode) return `code:${normalizeFollowupKeyPart(identity.customerCode)}`;
  }
  const caseAnchor = normalizeFollowupKeyPart(canonicalCaseAnchor || "");
  if (caseAnchor) return `case:${caseAnchor}`;
  throw new Error("followup_customer_anchor_unresolved");
}
function buildFollowupIdentity(input) {
  const episode = new Date(
    Math.floor(input.episodeStartedAt.getTime() / 6e4) * 6e4
  ).toISOString();
  return [
    FOLLOWUP_IDENTITY_VERSION,
    input.customerAnchor,
    episode,
    normalizeFollowupKeyPart(input.followupType),
    normalizeFollowupKeyPart(input.reasonKey) || "-"
  ].join("|");
}

// src/lib/salesIntelligence/followUpOpportunityEngine.ts
var PROFILE = {
  staff_no_response: { priority: "high", duePolicy: "immediate", role: "branch_staff", nextBestAction: "respond_to_customer_request", goal: "answer_open_customer_request", needsCustomerIdentity: false },
  stock_check_pending: { priority: "high", duePolicy: "same_shift", role: "branch_staff", nextBestAction: "complete_stock_check_and_reply", goal: "tell_customer_availability_result", needsCustomerIdentity: false },
  staff_promised_check: { priority: "high", duePolicy: "same_shift", role: "pharmacist", nextBestAction: "complete_promised_check", goal: "complete_promised_check", needsCustomerIdentity: false },
  delivery_unresolved: { priority: "high", duePolicy: "same_shift", role: "delivery_team", nextBestAction: "resolve_delivery_status", goal: "resolve_delivery_and_confirm_with_customer", needsCustomerIdentity: true },
  callback_requested: { priority: "high", duePolicy: "customer_requested_time", role: "customer_service", nextBestAction: "contact_customer_at_requested_time", goal: "honour_customer_callback_request", needsCustomerIdentity: true },
  customer_asked_to_wait: { priority: "medium", duePolicy: "when_in_stock", role: "branch_staff", nextBestAction: "contact_customer_when_product_available", goal: "notify_customer_when_product_available", needsCustomerIdentity: true },
  stock_unavailable: { priority: "medium", duePolicy: "when_in_stock", role: "branch_staff", nextBestAction: "contact_customer_when_product_available", goal: "offer_original_product_when_available", needsCustomerIdentity: true },
  alternative_open: { priority: "medium", duePolicy: "next_day", role: "pharmacist", nextBestAction: "confirm_alternative_decision", goal: "get_decision_on_offered_alternative", needsCustomerIdentity: true },
  customer_considering: { priority: "medium", duePolicy: "next_day", role: "pharmacist", nextBestAction: "check_customer_decision", goal: "get_customer_decision", needsCustomerIdentity: true },
  price_objection: { priority: "medium", duePolicy: "next_day", role: "pharmacist", nextBestAction: "follow_up_with_value_or_allowed_offer", goal: "address_price_objection", needsCustomerIdentity: true },
  prescription_incomplete: { priority: "medium", duePolicy: "next_day", role: "pharmacist", nextBestAction: "request_missing_prescription_details", goal: "complete_prescription_details", needsCustomerIdentity: true },
  customer_no_response: { priority: "low", duePolicy: "next_day", role: "customer_service", nextBestAction: "send_single_recovery_followup", goal: "single_recovery_attempt", needsCustomerIdentity: true }
};
var DAY_MS = 24 * 60 * 60 * 1e3;
function deriveFollowUpOpportunities(input) {
  const { conversationCase, customerNeed, unavailableDemand, lostOpportunity, salesOutcome } = input;
  const caseId = conversationCase.caseId;
  const messages = input.messages.slice().sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const meaningful = messages.filter((m) => m.isMeaningful && (m.role === "customer" || m.role === "staff"));
  const lastAt = meaningful.length ? meaningful[meaningful.length - 1].timestamp : new Date(conversationCase.endedAt ?? conversationCase.startedAt);
  const identityResolved = input.customerIdentityStatus === "resolved" && Boolean(conversationCase.customerId);
  const customerId = identityResolved ? conversationCase.customerId : null;
  if (salesOutcome.outcome === "information_only" || lostOpportunity.state === "no_commercial_opportunity") {
    return {
      caseId,
      decision: "not_needed",
      opportunities: [],
      notNeededReason: salesOutcome.outcome === "information_only" ? "information_only" : "no_customer_need"
    };
  }
  const candidates = [];
  const indexOf = new Map(messages.map((m, i) => [m.id, i]));
  const laterStaffReply = (message) => meaningful.some((m) => m.role === "staff" && (indexOf.get(m.id) ?? 0) > (indexOf.get(message.id) ?? 0));
  const customerMessages = meaningful.filter((m) => m.role === "customer");
  const waitRequests = [];
  for (const message of customerMessages) {
    const timing = classifyCustomerTimingRequestV32(message.text);
    const willWait = classifyCustomerIntentStatementV32(message.text) === "will_wait";
    if (!timing && !willWait) continue;
    waitRequests.push({
      message,
      whenInStock: willWait || timing?.when === "when_in_stock",
      days: timing?.when === "days" ? timing.days : null,
      sameDay: timing?.when === "same_day"
    });
  }
  const demandForWait = (text) => {
    const textKey = normalizeProductKey(text);
    const named = unavailableDemand.filter((d) => d.productKey.length >= 3 && textKey.includes(d.productKey));
    if (named.length) return named;
    return unavailableDemand.length === 1 ? unavailableDemand : [];
  };
  const explicitlyWaitedDemandKeys = /* @__PURE__ */ new Set();
  for (const request of waitRequests.filter((r) => r.whenInStock)) {
    for (const demand of demandForWait(request.message.text)) {
      explicitlyWaitedDemandKeys.add(demand.demandKey);
      candidates.push({
        reason: "customer_asked_to_wait",
        explicit: true,
        demand,
        evidence: [...demand.evidenceMessageIds, request.message.id],
        level: "strongly_inferred",
        score: 0.85
      });
    }
  }
  for (const demand of unavailableDemand) {
    if (explicitlyWaitedDemandKeys.has(demand.demandKey)) continue;
    if (!demand.followUpCandidate && demand.followUpSuppressedBy !== "customer_declined_need") continue;
    if (demand.availabilityState === "check_pending") {
      candidates.push({
        reason: "stock_check_pending",
        explicit: true,
        demand,
        assignedStaffName: demand.statedByStaffName,
        assignedStaffId: demand.statedByStaffId,
        evidence: demand.evidenceMessageIds,
        level: demand.confidence.level,
        score: demand.confidence.score
      });
    } else if (demand.alternativeOffered && demand.alternativeResponse !== "rejected") {
      candidates.push({ reason: "alternative_open", explicit: false, demand, evidence: demand.evidenceMessageIds, level: demand.confidence.level, score: demand.confidence.score });
    } else {
      candidates.push({
        reason: "stock_unavailable",
        explicit: false,
        demand,
        priority: demand.alternativeResponse === "rejected" ? "low" : void 0,
        evidence: demand.evidenceMessageIds,
        level: demand.confidence.level,
        score: demand.confidence.score
      });
    }
  }
  for (const request of waitRequests.filter((r) => !r.whenInStock)) {
    candidates.push({
      reason: "callback_requested",
      explicit: true,
      demand: null,
      duePolicy: request.days != null || request.sameDay ? "customer_requested_time" : "manual_schedule",
      requestedDelayDays: request.sameDay ? 0 : request.days,
      evidence: [request.message.id],
      level: "strongly_inferred",
      score: 0.85
    });
  }
  const checkPendingIds = new Set(unavailableDemand.filter((d) => d.availabilityState === "check_pending").map((d) => d.availabilityMessageId));
  for (const message of meaningful) {
    if (message.role !== "staff" || !isStaffFollowUpPromiseV32(message.text)) continue;
    if (checkPendingIds.has(message.id) || laterStaffReply(message)) continue;
    candidates.push({
      reason: "staff_promised_check",
      explicit: true,
      demand: null,
      assignedStaffName: message.sender,
      assignedStaffId: input.staffIdBySender?.[message.sender] ?? null,
      evidence: [message.id],
      level: "strongly_inferred",
      score: 0.85
    });
  }
  for (const message of meaningful) {
    if (message.role !== "staff" || !isPrescriptionRequestV32(message.text)) continue;
    const provided = messages.some(
      (m) => m.role === "customer" && (indexOf.get(m.id) ?? 0) > (indexOf.get(message.id) ?? 0) && (m.isMediaPlaceholder || mentionsPrescriptionV32(m.text))
    );
    if (!provided) {
      candidates.push({ reason: "prescription_incomplete", explicit: false, demand: null, evidence: [message.id], level: "strongly_inferred", score: 0.75 });
    }
  }
  const lostEvidence = lostOpportunity.evidenceMessageIds;
  if (lostOpportunity.reason === "staff_no_response") {
    candidates.push({ reason: "staff_no_response", explicit: false, demand: null, evidence: lostEvidence, level: lostOpportunity.confidence.level, score: lostOpportunity.confidence.score });
  } else if (lostOpportunity.state === "recoverable" && lostOpportunity.reason === "price") {
    candidates.push({ reason: "price_objection", explicit: false, demand: null, evidence: lostEvidence, level: lostOpportunity.confidence.level, score: lostOpportunity.confidence.score });
  } else if (lostOpportunity.state === "recoverable" && lostOpportunity.reason === "delivery_issue") {
    candidates.push({ reason: "delivery_unresolved", explicit: false, demand: null, evidence: lostEvidence, level: lostOpportunity.confidence.level, score: lostOpportunity.confidence.score });
  } else if (lostOpportunity.state === "recoverable" && lostOpportunity.reason === "customer_no_response") {
    candidates.push({ reason: "customer_no_response", explicit: false, demand: null, evidence: lostEvidence, level: lostOpportunity.confidence.level, score: lostOpportunity.confidence.score });
  }
  const considering = customerMessages.filter((m) => classifyCustomerIntentStatementV32(m.text) === "considering");
  if (considering.length && lostOpportunity.reason !== "price" && !candidates.some((c) => c.reason === "alternative_open")) {
    candidates.push({ reason: "customer_considering", explicit: false, demand: null, evidence: considering.map((m) => m.id), level: "strongly_inferred", score: 0.75 });
  }
  const interactionSuppression = lostOpportunity.state === "lost" && lostOpportunity.recoverability === "none" ? lostOpportunity.reason === "competitor" ? "bought_elsewhere" : "customer_final_decline" : null;
  const saleProven = salesOutcome.outcome === "sale_proven";
  const anchor = followupCustomerAnchor(
    { status: identityResolved ? "resolved" : "unresolved", customerId, normalizedPhone: null, customerCode: null },
    caseId
  );
  const byKey = /* @__PURE__ */ new Map();
  for (const candidate of candidates) {
    const profile = PROFILE[candidate.reason];
    const demand = candidate.demand;
    let suppressedBy = interactionSuppression;
    if (!suppressedBy && saleProven && !candidate.explicit) suppressedBy = "sale_proven";
    if (!suppressedBy && (candidate.evidence.length === 0 || candidate.level === "unknown")) suppressedBy = "weak_evidence";
    const blocked = !suppressedBy && profile.needsCustomerIdentity && !customerId;
    const duePolicy = candidate.duePolicy ?? profile.duePolicy;
    const requestedDelayDays = candidate.requestedDelayDays ?? null;
    const productScopeKey = demand ? demand.resolvedProductId ?? demand.productKey : null;
    const followUpKey = buildFollowupIdentity({
      customerAnchor: anchor,
      episodeStartedAt: new Date(conversationCase.startedAt),
      followupType: candidate.reason,
      reasonKey: productScopeKey
    });
    const opportunity = {
      followUpKey,
      caseId,
      customerId,
      status: suppressedBy ? "suppressed" : blocked ? "blocked" : "actionable",
      reason: candidate.reason,
      priority: candidate.priority ?? profile.priority,
      productKey: demand?.productKey ?? null,
      productId: demand?.resolvedProductId ?? null,
      productRaw: demand?.requestedProductRaw ?? null,
      quantity: demand?.quantityRequested ?? null,
      demandKey: demand?.demandKey ?? null,
      duePolicy,
      requestedDelayDays,
      dueAt: dueAtFor(duePolicy, requestedDelayDays, lastAt),
      assignedRole: profile.role,
      assignedStaffId: candidate.assignedStaffId ?? null,
      assignedStaffName: candidate.assignedStaffName ?? null,
      goal: profile.goal,
      nextBestAction: profile.nextBestAction,
      blocker: blocked ? "customer_identity_unresolved" : null,
      suppressedBy,
      evidenceMessageIds: [...new Set(candidate.evidence)],
      confidence: confidence(candidate, profile)
    };
    const existing = byKey.get(followUpKey);
    if (existing) {
      existing.evidenceMessageIds = [.../* @__PURE__ */ new Set([...existing.evidenceMessageIds, ...opportunity.evidenceMessageIds])];
      continue;
    }
    byKey.set(followUpKey, opportunity);
  }
  const opportunities = [...byKey.values()];
  const specificActive = opportunities.some((o) => o.reason !== "customer_no_response" && o.status !== "suppressed");
  for (const opportunity of opportunities) {
    if (opportunity.reason === "customer_no_response" && specificActive && opportunity.status !== "suppressed") {
      opportunity.status = "suppressed";
      opportunity.blocker = null;
      opportunity.suppressedBy = "covered_by_specific_follow_up";
    }
  }
  const decision = opportunities.some((o) => o.status === "actionable") ? "actionable" : opportunities.some((o) => o.status === "blocked") ? "blocked" : opportunities.length ? "suppressed" : "not_needed";
  return {
    caseId,
    decision,
    opportunities,
    notNeededReason: decision === "not_needed" ? saleProven ? "sale_proven" : interactionSuppression : null
  };
}
function dueAtFor(policy, days, lastAt) {
  switch (policy) {
    case "immediate":
    case "same_shift":
      return lastAt.toISOString();
    case "next_day":
      return new Date(lastAt.getTime() + DAY_MS).toISOString();
    case "customer_requested_time":
      return days == null ? null : new Date(lastAt.getTime() + days * DAY_MS).toISOString();
    default:
      return null;
  }
}
function confidence(candidate, profile) {
  return {
    level: candidate.level,
    score: candidate.score,
    ruleIds: [`follow_up.${candidate.reason}`, `next_best_action.${profile.nextBestAction}`],
    evidence: candidate.evidence.length ? [{ sourceTable: "whatsapp_review_sources", sourceId: "", messageIds: [...new Set(candidate.evidence)], description: `follow_up.${candidate.reason}` }] : []
  };
}

// src/lib/salesIntelligence/caseIntelligenceView.ts
var CASE_INTELLIGENCE_VIEW_VERSION = "case-intelligence-v1";
function buildCaseIntelligenceView(analysis, context) {
  const { conversationCase, customerNeed, commercialConfirmation, attribution, salesOutcome } = analysis;
  const messages = context.messages;
  const byId = new Map(messages.map((m) => [m.id, m]));
  const staffIdFor = (sender) => context.staffIdBySender?.[sender] ?? null;
  const identityStatus = context.customerIdentityStatus ?? "not_provided";
  const identityResolved = identityStatus === "resolved";
  const participants = /* @__PURE__ */ new Map();
  for (const message of messages) {
    if (message.role !== "staff" || !message.isMeaningful) continue;
    const row = participants.get(message.sender) ?? { sender: message.sender, staffId: staffIdFor(message.sender), messageIds: [] };
    row.messageIds.push(message.id);
    participants.set(message.sender, row);
  }
  const facts = [];
  const pushFact = (fact, messageId2, source, productKey, staffId) => {
    const message = byId.get(messageId2);
    if (!message || message.role !== "staff") return;
    facts.push({ fact, messageId: messageId2, staffSender: message.sender, staffId: staffId ?? staffIdFor(message.sender), productKey, source });
  };
  for (const product of customerNeed.products) {
    for (const evidence of product.availabilityEvidence) {
      pushFact(`stated_${evidence.state}`, evidence.messageId, "customer_need", product.key, evidence.staffId);
    }
    for (const alternative of product.alternatives) {
      pushFact("offered_alternative", alternative.offerMessageId, "customer_need", product.key, alternative.offeredByStaffId);
    }
    if (product.roles.includes("offered")) {
      for (const id of product.evidenceMessageIds) {
        if (byId.get(id)?.role === "staff" && !product.availabilityEvidence.some((e) => e.messageId === id) && !product.alternatives.some((a) => a.offerMessageId === id)) {
          pushFact("offered_product", id, "customer_need", product.key);
        }
      }
    }
  }
  if (commercialConfirmation.staffConfirmed) {
    for (const id of commercialConfirmation.primaryMessageIds) pushFact("confirmed_order", id, "commercial_confirmation", null);
  }
  for (const staffFact of analysis.lostOpportunity.staffFacts) {
    if (staffFact.fact === "awaiting_customer_reply") pushFact("awaiting_customer_reply", staffFact.messageId, "lost_opportunity", null, staffFact.staffId);
  }
  for (const opportunity of analysis.followUp.opportunities) {
    if (opportunity.reason === "staff_promised_check" || opportunity.reason === "stock_check_pending") {
      for (const id of opportunity.evidenceMessageIds) {
        if (byId.get(id)?.role === "staff") pushFact("promised_follow_up", id, "follow_up", opportunity.productKey, opportunity.assignedStaffId);
      }
    }
  }
  const uniqueFacts = dedupeFacts(facts);
  const products = customerNeed.products.map((product) => {
    const demand = analysis.unavailableDemand.find((d) => d.productKey === product.key) ?? null;
    const loss = analysis.lostOpportunity.productLosses.find((l) => l.productKey === product.key) ?? null;
    return {
      productKey: product.key,
      productNameRaw: product.productNameRaw,
      productId: product.productId,
      roles: product.roles,
      requestedQuantity: product.requestedQuantity,
      offeredQuantity: product.offeredQuantity,
      finalQuantity: product.finalQuantity,
      availability: product.availability,
      alternativeCount: product.alternatives.length,
      alternativeResponses: product.alternatives.map((a) => a.response),
      inFinalBasket: product.roles.includes("final_basket"),
      demandKey: demand?.demandKey ?? null,
      lossOutcome: loss?.outcome ?? null,
      lossReason: loss?.reason ?? null,
      followUpKeys: analysis.followUp.opportunities.filter((o) => o.productKey === product.key).map((o) => o.followUpKey)
    };
  });
  const active = analysis.activeBasket;
  const basket = {
    versions: analysis.basketHistory.map((b) => ({
      basketId: b.basketId,
      version: b.version,
      status: b.status,
      itemCount: (analysis.itemsByBasketId[b.basketId] ?? []).length,
      announcedTotal: b.announcedTotal?.amount ?? null,
      confirmedAt: b.confirmedAt,
      confirmedByCustomerAt: b.confirmedByCustomerAt
    })),
    activeBasketId: active?.basketId ?? null,
    activeItems: active ? analysis.itemsByBasketId[active.basketId] ?? [] : [],
    announcedTotal: active?.announcedTotal?.amount ?? null,
    confirmed: Boolean(active && (active.status === "confirmed" || active.confirmedByCustomerAt))
  };
  const reasons = [];
  const addReason = (code, source) => {
    if (!reasons.some((r) => r.code === code)) reasons.push({ code, source });
  };
  if (!identityResolved) addReason("customer_identity_unresolved", "customer_identity");
  analysis.humanReviewReasons.forEach((code) => addReason(code, "pipeline"));
  customerNeed.humanReviewReasons.forEach((code) => addReason(code, "customer_need"));
  if (customerNeed.unlinkedAvailability.length) addReason("need.availability_statement_unlinked", "customer_need");
  if (customerNeed.unlinkedAlternatives.length) addReason("need.alternative_offer_unlinked", "customer_need");
  attribution.contradictions.forEach((code) => addReason(`sale.${code}`, "sale_proof"));
  if (salesOutcome.saleProofState === "contradicted") addReason("sale.proof_contradicted", "sale_proof");
  if (analysis.journeyState.reviewRequired) addReason("journey.review_required", "journey");
  if (analysis.lostOpportunity.state === "unknown") addReason("lost.state_unknown", "lost_opportunity");
  analysis.followUp.opportunities.filter((o) => o.status === "blocked" && o.blocker).forEach((o) => addReason(`follow_up.blocked.${o.blocker}`, "follow_up"));
  const interaction = context.interaction;
  const allEvidence = /* @__PURE__ */ new Set([
    ...customerNeed.evidenceMessageIds,
    ...analysis.journeyState.evidenceMessageIds,
    ...commercialConfirmation.primaryMessageIds,
    ...analysis.unavailableDemand.flatMap((d) => d.evidenceMessageIds),
    ...analysis.lostOpportunity.evidenceMessageIds,
    ...analysis.followUp.opportunities.flatMap((o) => o.evidenceMessageIds)
  ]);
  return {
    version: CASE_INTELLIGENCE_VIEW_VERSION,
    caseId: analysis.caseId,
    conversationId: analysis.conversationId,
    sourceCaseIdV22: conversationCase.sourceCaseIdV22,
    interaction: {
      interactionId: interaction?.id ?? null,
      startedAt: conversationCase.startedAt,
      endedAt: conversationCase.endedAt,
      messageCount: messages.length,
      meaningfulMessageCount: messages.filter((m) => m.isMeaningful).length,
      messageIds: messages.map((m) => m.id),
      triggerMessageId: interaction?.triggerMessageId ?? null,
      segmentationReason: interaction?.segmentationReason ?? null,
      caseType: conversationCase.caseType,
      caseStatus: conversationCase.status,
      confidence: conversationCase.confidence
    },
    customer: {
      customerId: identityResolved ? conversationCase.customerId : null,
      customerPhone: identityResolved ? conversationCase.customerPhone : null,
      identityStatus,
      blockers: identityResolved ? [] : ["customer_identity_unresolved"]
    },
    branch: { branchId: conversationCase.branchId, branchNameRaw: conversationCase.branchNameRaw },
    staff: {
      participants: [...participants.values()].map((p) => ({ ...p, messageCount: p.messageIds.length })),
      facts: uniqueFacts
    },
    need: customerNeed,
    products,
    basket,
    journey: analysis.journeyState,
    sale: {
      confirmationState: commercialConfirmation.currentState,
      summaryPresented: commercialConfirmation.summaryPresented,
      customerConfirmed: commercialConfirmation.customerConfirmed,
      staffConfirmed: commercialConfirmation.staffConfirmed,
      confirmationMessageIds: commercialConfirmation.primaryMessageIds,
      invoiceCandidateIds: analysis.invoiceCandidateIds,
      selectedInvoiceId: attribution.selectedInvoiceId,
      selectedInvoiceNumber: attribution.selectedInvoiceNumber,
      attributionLevel: attribution.attributionLevel,
      proofState: salesOutcome.saleProofState,
      outcome: salesOutcome.outcome,
      isSaleCountable: salesOutcome.isSaleCountable,
      reasonCodes: salesOutcome.reasonCodes,
      contradictions: attribution.contradictions
    },
    unavailableDemand: analysis.unavailableDemand,
    lostOpportunity: analysis.lostOpportunity,
    followUp: analysis.followUp,
    coachingEvidence: {
      staffReplied: participants.size > 0,
      unansweredRequestMessageIds: analysis.lostOpportunity.reason === "staff_no_response" ? analysis.lostOpportunity.evidenceMessageIds : [],
      alternativeOfferedProductKeys: customerNeed.products.filter((p) => p.alternatives.length).map((p) => p.key),
      unavailableWithoutAlternativeProductKeys: analysis.unavailableDemand.filter((d) => !d.alternativeOffered).map((d) => d.productKey),
      delayComplaintMessageIds: analysis.lostOpportunity.reason === "slow_response" ? analysis.lostOpportunity.evidenceMessageIds : [],
      clearClosing: commercialConfirmation.currentState === "commercial_confirmation_complete",
      protocolCompliant: analysis.protocolAssessment.protocolCompliant,
      missingProtocolSteps: analysis.protocolAssessment.missingProtocolSteps
    },
    evidenceSummary: {
      evidenceMessageIds: messages.map((m) => m.id).filter((id) => allEvidence.has(id)),
      sectionConfidence: {
        interaction: conversationCase.confidence.level,
        need: customerNeed.confidence.level,
        journey: analysis.journeyState.confidence.level,
        attribution: attribution.attributionLevel,
        lostOpportunity: analysis.lostOpportunity.confidence.level
      }
    },
    review: { required: analysis.needsHumanReview || reasons.length > 0, reasons }
  };
}
function dedupeFacts(facts) {
  const seen = /* @__PURE__ */ new Set();
  return facts.filter((fact) => {
    const key = `${fact.fact}|${fact.messageId}|${fact.productKey ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// src/lib/salesIntelligence/pharmacyProducts/pharmacyNormalization.ts
var ARABIC_INDIC_DIGITS = {
  "\u0660": "0",
  "\u0661": "1",
  "\u0662": "2",
  "\u0663": "3",
  "\u0664": "4",
  "\u0665": "5",
  "\u0666": "6",
  "\u0667": "7",
  "\u0668": "8",
  "\u0669": "9"
};
var ARABIC_LETTER_VARIANTS = [
  [/[إأآا]/g, "\u0627"],
  [/ى/g, "\u064A"],
  [/ة/g, "\u0647"],
  [/ؤ/g, "\u0648"],
  [/ئ/g, "\u064A"],
  [/[ً-ْٰـ]/g, ""]
  // tashkeel + tatweel
];
function convertArabicDigits(text) {
  return text.replace(/[٠-٩]/g, (d) => ARABIC_INDIC_DIGITS[d] ?? d);
}
function unifyArabicLetters(text) {
  let result = text;
  for (const [pattern, replacement] of ARABIC_LETTER_VARIANTS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}
var UNIT_SYNONYMS = {
  mg: "mg",
  "\u0645\u062C\u0645": "mg",
  "\u0645\u062C": "mg",
  "\u0645\u0644\u063A": "mg",
  "\u0645\u0644\u062C\u0645": "mg",
  ml: "ml",
  "\u0645\u0644": "ml",
  "\u0633\u0645": "ml",
  gm: "gm",
  g: "gm",
  "\u062C\u0645": "gm",
  "\u062C\u0631\u0627\u0645": "gm",
  "\u062C\u0631\u0627": "gm",
  mcg: "mcg",
  "\u0645\u064A\u0643\u0631\u0648\u062C\u0631\u0627\u0645": "mcg",
  "\u0645\u0643\u062C\u0645": "mcg",
  iu: "iu",
  "\u0648\u062D\u062F\u0647": "iu",
  "\u0648\u062D\u062F\u0629": "iu"
};
var PACK_UNIT_WORDS = [
  "tab",
  "tabs",
  "tablet",
  "tablets",
  "cap",
  "caps",
  "capsule",
  "capsules",
  "pcs",
  "piece",
  "pieces",
  "sachet",
  "sachets",
  "amp",
  "amps",
  "ampoule",
  "ampoules",
  "\u0642\u0631\u0635",
  "\u0627\u0642\u0631\u0627\u0635",
  "\u0623\u0642\u0631\u0627\u0635",
  "\u0643\u0628\u0633\u0648\u0644\u0647",
  "\u0643\u0628\u0633\u0648\u0644\u0629",
  "\u0643\u0628\u0633\u0648\u0644",
  "\u0643\u0628\u0633\u0648\u0644\u0627\u062A",
  "\u0643\u064A\u0633",
  "\u0627\u0643\u064A\u0627\u0633",
  "\u0623\u0643\u064A\u0627\u0633",
  "\u0639\u0644\u0628\u0647",
  "\u0639\u0644\u0628\u0629",
  "\u0639\u0644\u0628",
  "\u0634\u0631\u064A\u0637",
  "\u0634\u0631\u0627\u064A\u0637",
  "\u0627\u0645\u0628\u0648\u0644",
  "\u0623\u0645\u0628\u0648\u0644",
  "\u0627\u0645\u0628\u0648\u0644\u0627\u062A"
];
var DOSAGE_FORM_KEYWORDS = [
  [/\b(tab|tabs|tablet|tablets)\b|قرص|اقراص|أقراص|برشام|حبوب|حبه|حبوه/g, "tablet"],
  [/\b(cap|caps|capsule|capsules)\b|كبسول|كبسوله|كبسولة|كبسولات/g, "capsule"],
  [/\b(syrup)\b|شراب/g, "syrup"],
  [/\b(susp|suspension)\b/g, "suspension"],
  [/\b(cream)\b|كريم/g, "cream"],
  [/\b(gel)\b|جل/g, "gel"],
  [/\b(oint|ointment)\b|مرهم/g, "ointment"],
  [/\b(lotion)\b|لوشن/g, "lotion"],
  [/\b(drop|drops)\b|نقط|قطره|قطرة/g, "drops"],
  [/\b(spray)\b|بخاخ|سبراي/g, "spray"],
  [/\b(amp|amps|ampoule|ampoules)\b|امبول|أمبول/g, "ampoule"],
  [/\b(vial)\b/g, "vial"],
  [/\b(syringe|syringes)\b|سرنج|سرنجه|سرنجة/g, "syringe"],
  [/\b(sachet|sachets)\b|كيس|اكياس|أكياس/g, "sachet"],
  [/\b(soap)\b|صابون|صابونه/g, "soap"],
  [/\b(shampoo)\b|شامبو/g, "shampoo"],
  [/\b(suppository|suppositories)\b|لبوس/g, "suppository"]
];
function normalizeBaseText(text) {
  let result = text;
  result = convertArabicDigits(result);
  result = unifyArabicLetters(result);
  result = result.toLowerCase();
  result = result.replace(/[.,;:_\-/\\()<>\x5B\x5D{}!؟?"'`~*#+=|]/g, " ");
  result = result.replace(/([a-zA-Zء-ي])([0-9])/g, "$1 $2").replace(/([0-9])([a-zA-Zء-ي])/g, "$1 $2");
  result = result.replace(/\s+/g, " ").trim();
  return result;
}
var SCRIPT_AWARE_RIGHT_BOUNDARY = "(?![a-zA-Z\u0621-\u064A])";
function extractStrengths(normalized) {
  const strengths = [];
  const unitAlternation = Object.keys(UNIT_SYNONYMS).sort((a, b) => b.length - a.length).join("|");
  const rx = new RegExp(`([0-9]+(?:\\.[0-9]+)?)\\s*(${unitAlternation})${SCRIPT_AWARE_RIGHT_BOUNDARY}`, "g");
  let match;
  while ((match = rx.exec(normalized)) !== null) {
    const unit = UNIT_SYNONYMS[match[2]];
    if (unit) strengths.push({ value: Number(match[1]), unit });
  }
  return strengths;
}
function extractPackSizes(normalized) {
  const packs = [];
  const wordAlternation = PACK_UNIT_WORDS.slice().sort((a, b) => b.length - a.length).join("|");
  const rx = new RegExp(`([0-9]+)\\s*(${wordAlternation})${SCRIPT_AWARE_RIGHT_BOUNDARY}`, "g");
  let match;
  while ((match = rx.exec(normalized)) !== null) {
    packs.push({ count: Number(match[1]), unitWord: match[2] });
  }
  return packs;
}
function extractDosageForms(normalized) {
  const forms = /* @__PURE__ */ new Set();
  for (const [pattern, form] of DOSAGE_FORM_KEYWORDS) {
    pattern.lastIndex = 0;
    if (pattern.test(normalized)) forms.add(form);
  }
  return Array.from(forms);
}
function normalizePharmacyText(raw) {
  const normalized = normalizeBaseText(raw);
  return {
    normalized,
    raw,
    strengths: extractStrengths(normalized),
    dosageForms: extractDosageForms(normalized),
    packSizes: extractPackSizes(normalized)
  };
}

// src/lib/salesIntelligence/pharmacyProducts/pharmacyProductResolverV2.ts
var FUZZY_MAX_CONFIDENCE_LEVEL = "weakly_inferred";
function buildPharmacyProductIndex(catalog) {
  const byCode = /* @__PURE__ */ new Map();
  const byNormalizedName = /* @__PURE__ */ new Map();
  for (const product of catalog) {
    byCode.set(product.productCode.trim().toLowerCase(), product);
    for (const normalizedName of product.normalizedNames) {
      const bucket = byNormalizedName.get(normalizedName);
      if (bucket) bucket.push(product);
      else byNormalizedName.set(normalizedName, [product]);
    }
  }
  return { catalog, byCode, byNormalizedName };
}
var CROSS_SCRIPT_SEED = /* @__PURE__ */ new Map([
  ["\u0632\u0648\u0631\u0643\u0627\u0644", "zurcal"],
  ["\u0627\u0646\u062A\u064A\u0646\u0627\u0644", "antinal"],
  ["\u0628\u0627\u0645\u0628\u0631\u0632", "pampers"],
  ["\u0643\u0648\u0631\u064A\u063A\u0627", "corega"],
  ["\u0643\u0648\u0631\u064A\u062C\u0627", "corega"],
  ["\u0643\u0648\u0644\u0634\u064A\u0633\u064A\u0646", "colchicine"],
  ["\u0643\u0648\u0644\u0634\u064A\u0633\u0646", "colchicine"],
  ["\u0641\u0644\u064A\u0643\u0633\u064A\u0644\u0627\u0643\u0633", "flexilax"],
  ["\u0641\u0644\u064A\u0643\u0633 \u0644\u064A\u0643\u0633", "flexilax"],
  ["\u0641\u0644\u064A\u0643\u0633 \u0644\u0627\u064A\u0643\u0633", "flexilax"],
  ["\u062C\u0627\u0633\u062A \u0631\u064A\u062C", "gast reg"],
  ["\u062C\u0627\u0633\u062A \u0631\u064A\u062C \u0627\u0645\u0628\u0648\u0644", "gast reg"],
  ["\u0633\u0648\u0644\u0648 \u0641\u0631\u064A\u0634", "solofresh"],
  ["\u0633\u0648\u0644\u0648\u0641\u0631\u064A\u0634", "solofresh"],
  ["\u0643\u0648\u062C\u064A \u0633\u0627\u0646", "koji san"],
  ["\u0645\u064A\u0646\u0648\u0643\u0633\u062F\u064A\u0644", "minoxidil"],
  ["\u0627\u0644\u0645\u064A\u0646\u0648\u0643\u0633\u062F\u064A\u0644", "minoxidil"],
  ["\u0641\u064A\u062A\u0634\u064A", "vichy"],
  ["\u0633\u0646\u062A\u0631\u0645", "centrum"],
  ["\u0627\u0644\u0633\u0646\u062A\u0631\u0645", "centrum"],
  ["\u0641\u0648\u0644\u064A\u0643", "folic"],
  ["\u0646\u064A\u0631\u0648\u0641\u064A\u062A", "neurovit"],
  ["\u0646\u064A\u0648\u0631\u0641\u064A\u062A", "neurovit"],
  ["\u062F\u0648\u0644\u064A\u0628\u0631\u0627\u0646", "doliprane"],
  ["\u062F\u0644\u064A\u0628\u0631\u0627\u0646", "doliprane"],
  ["\u062F\u064A\u0641\u0627\u0631\u0648\u0644", "devarol"],
  ["\u0645\u0627\u0631\u0646\u064A\u0632", "marnys"],
  ["\u0627\u0648\u0631\u0644\u064A", "orly"],
  ["\u0623\u0648\u0631\u0644\u064A", "orly"],
  ["\u062D\u064A\u0627\u0629", "hayah"],
  ["\u062D\u064A\u0627\u0647", "hayah"],
  ["\u062F\u064A\u0631\u0645\u0627 \u0631\u0648\u0644", "derma roller"],
  ["\u0627\u0644\u062F\u064A\u0631\u0645\u0627 \u0631\u0648\u0644", "derma roller"],
  ["\u0644\u0628\u0646 \u0647\u064A\u0631\u0648 \u0628\u064A\u0628\u064A", "hero baby milk"],
  ["\u0647\u064A\u0631\u0648 \u0628\u064A\u0628\u064A", "hero baby"],
  ["\u0646\u064A\u0648\u062A\u0631\u0648\u0646\u064A \u062F\u0641\u0646\u0633", "nutradefense"],
  ["\u0646\u064A\u0648\u062A\u0631\u0627 \u062F\u0641\u0646\u0633", "nutradefense"],
  ["\u0643\u0648\u0644\u0648\u0646\u0627", "colona"],
  ["\u062C\u0627\u0633\u062A\u0631\u0648 \u0628\u064A\u0648\u062A\u064A\u0643", "gastrobiotic"],
  ["\u062C\u0627\u0633\u062A\u0631\u0648\u0628\u064A\u0648\u062A\u0643", "gastrobiotic"]
]);
function confidenceForBasis(basis) {
  switch (basis) {
    case "exact_code":
    case "exact_barcode":
      return "proven";
    case "exact_canonical_name":
      return "strongly_inferred";
    case "approved_alias":
      return "strongly_inferred";
    // gated on human approval already having happened — see productAliasCandidate.ts
    case "dominant_name_token_match":
      return "strongly_inferred";
    case "cross_script_equivalent":
      return "weakly_inferred";
    // seed table is unvetted heuristic, not a proven identity link
    case "strength_form_token_match":
      return "weakly_inferred";
    case "cautious_fuzzy":
      return FUZZY_MAX_CONFIDENCE_LEVEL;
    case "unresolved":
      return "unknown";
  }
}
function isSafeSelection(candidates) {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  const topLevel = candidates[0].confidence;
  const tiedAtTop = candidates.filter((c) => c.confidence === topLevel);
  return tiedAtTop.length === 1 ? candidates[0] : null;
}
function strengthsCompatible(a, b) {
  if (a.length === 0 || b.length === 0) return true;
  return a.some((sa) => b.some((sb) => sa.unit === sb.unit && Math.abs(sa.value - sb.value) < 1e-3));
}
function dosageFormsCompatible(a, b) {
  if (a.length === 0 || b.length === 0) return true;
  return a.some((fa) => b.includes(fa));
}
function extractBareNumbers(normalized) {
  const numbers = [];
  const rx = /[0-9]+(?:\.[0-9]+)?/g;
  let match;
  while ((match = rx.exec(normalized)) !== null) numbers.push(Number(match[0]));
  return numbers;
}
function productNumericTokens(product) {
  return [...product.strengths.map((s) => s.value), ...product.packSizes.map((p) => p.count)];
}
function bareNumbersCompatible(phraseNumbers, product) {
  if (phraseNumbers.length === 0) return true;
  const productNumbers = productNumericTokens(product);
  if (productNumbers.length === 0) return true;
  return phraseNumbers.some((n) => productNumbers.includes(n));
}
function tokenOverlapScore(a, b) {
  const tokensA = new Set(a.split(" ").filter((t) => t.length > 1));
  const tokensB = new Set(b.split(" ").filter((t) => t.length > 1));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let overlap = 0;
  for (const token of tokensA) if (tokensB.has(token)) overlap += 1;
  return overlap / Math.max(tokensA.size, tokensB.size);
}
var NAME_MATCH_STOPWORDS = /* @__PURE__ */ new Set([
  "a",
  "an",
  "the",
  "for",
  "of",
  "with",
  "to",
  "by",
  "and",
  "forwarded",
  "\u0645\u0646",
  "\u0641\u064A",
  "\u0645\u0639",
  "\u0639\u0644\u0649",
  "\u0627\u0644\u064A",
  "\u0627\u0644\u0649",
  "\u0628\u062F\u064A\u0644",
  "\u063A\u0633\u0648\u0644",
  "\u0627\u0644\u063A\u0633\u0648\u0644"
]);
var NAME_QUANTITY_TOKENS = /* @__PURE__ */ new Set([
  "mg",
  "ml",
  "gm",
  "g",
  "mcg",
  "iu",
  "tab",
  "tabs",
  "tablet",
  "tablets",
  "cap",
  "caps",
  "capsule",
  "capsules",
  "pcs",
  "piece",
  "pieces"
]);
function meaningfulNameTokens(normalized) {
  return normalized.split(" ").map((token) => token.trim()).filter(
    (token) => token.length > 1 && !/^[0-9]+(?:\.[0-9]+)?$/.test(token) && !NAME_MATCH_STOPWORDS.has(token) && !NAME_QUANTITY_TOKENS.has(token)
  );
}
function expandJoinedPhraseTokens(phraseTokens, productTokens) {
  const productSet = new Set(productTokens);
  const expanded = [];
  for (const token of phraseTokens) {
    if (productSet.has(token)) {
      expanded.push(token);
      continue;
    }
    let split = null;
    for (let i = 0; i < productTokens.length - 1; i += 1) {
      const left = productTokens[i];
      const right = productTokens[i + 1];
      if (left.length < 3 || right.length < 3) continue;
      if (left + right === token) {
        split = [left, right];
        break;
      }
    }
    if (split) expanded.push(...split);
    else expanded.push(token);
  }
  return expanded;
}
function dominantNameTokenScore(phraseNormalized, productNormalized) {
  const productTokens = meaningfulNameTokens(productNormalized);
  if (productTokens.length < 3) return 0;
  const phraseTokens = expandJoinedPhraseTokens(
    meaningfulNameTokens(phraseNormalized),
    productTokens
  );
  if (phraseTokens.length < 3) return 0;
  const productSet = new Set(productTokens);
  const phraseUnique = Array.from(new Set(phraseTokens));
  const productUnique = Array.from(new Set(productTokens));
  const matched = phraseUnique.filter((token) => productSet.has(token)).length;
  if (matched < 3) return 0;
  const phraseCoverage = matched / phraseUnique.length;
  const productCoverage = matched / productUnique.length;
  if (phraseCoverage < 0.75 || productCoverage < 0.8) return 0;
  return Math.min(phraseCoverage, productCoverage);
}
function resolveProductMention(phrase, index, options = {}) {
  const normalized = normalizePharmacyText(phrase);
  const reasons = [];
  const candidateMap = /* @__PURE__ */ new Map();
  const restrictTo = options.knownCandidateProductIds ? new Set(options.knownCandidateProductIds) : null;
  const allowed = (product) => !restrictTo || restrictTo.has(product.productId);
  function addCandidate(product, basis, score, reason) {
    if (!allowed(product)) return;
    const existing = candidateMap.get(product.productId);
    if (existing && confidenceRank2(existing.confidence) >= confidenceRank2(confidenceForBasis(basis))) {
      existing.reasons.push(reason);
      return;
    }
    candidateMap.set(product.productId, { product, basis, confidence: confidenceForBasis(basis), score, reasons: [reason] });
  }
  const codeMatch = index.byCode.get(normalized.raw.trim().toLowerCase());
  if (codeMatch) addCandidate(codeMatch, "exact_code", 1, `\u0627\u0644\u0645\u062F\u062E\u0644 \u064A\u0637\u0627\u0628\u0642 \u0643\u0648\u062F \u0627\u0644\u0645\u0646\u062A\u062C ${codeMatch.productCode} \u062A\u0645\u0627\u0645\u064B\u0627`);
  const nameMatches = index.byNormalizedName.get(normalized.normalized) ?? [];
  for (const product of nameMatches) {
    addCandidate(product, "exact_canonical_name", 1, `\u0627\u0644\u0627\u0633\u0645 \u0627\u0644\u0645\u064F\u0637\u0628\u064E\u0651\u0639 "${normalized.normalized}" \u064A\u0637\u0627\u0628\u0642 \u0627\u0633\u0645 \u0627\u0644\u0645\u0646\u062A\u062C \u062A\u0645\u0627\u0645\u064B\u0627`);
  }
  const aliasProductId = options.approvedAliases?.get(normalized.raw.trim().toLowerCase());
  if (aliasProductId) {
    const product = index.catalog.find((p) => p.productId === aliasProductId);
    if (product) addCandidate(product, "approved_alias", 0.9, `\u0645\u0631\u0627\u062F\u0641 \u0645\u0639\u062A\u0645\u062F \u064A\u0634\u064A\u0631 \u0625\u0644\u0649 \u0647\u0630\u0627 \u0627\u0644\u0645\u0646\u062A\u062C`);
  }
  const phraseBareNumbers = extractBareNumbers(normalized.normalized);
  const seed = options.crossScriptSeed ?? CROSS_SCRIPT_SEED;
  for (const [arabicKey, latinToken] of seed) {
    if (normalized.normalized.includes(arabicKey) || normalized.raw.includes(arabicKey)) {
      const latinNormalized = normalizePharmacyText(latinToken).normalized;
      for (const [candidateNormalizedName, products] of index.byNormalizedName) {
        if (candidateNormalizedName.includes(latinNormalized)) {
          for (const product of products) {
            if (!strengthsCompatible(normalized.strengths, product.strengths)) continue;
            if (!dosageFormsCompatible(normalized.dosageForms, product.dosageForms)) continue;
            if (!bareNumbersCompatible(phraseBareNumbers, product)) continue;
            addCandidate(product, "cross_script_equivalent", 0.6, `"${arabicKey}" \u0645\u0631\u062A\u0628\u0637 \u0641\u064A \u062C\u062F\u0648\u0644 \u0627\u0644\u0645\u0631\u0627\u062F\u0641\u0627\u062A \u0627\u0644\u0644\u063A\u0648\u064A\u0629 \u0628\u0640 "${latinToken}"`);
          }
        }
      }
    }
  }
  for (const product of index.catalog) {
    if (!allowed(product)) continue;
    if (!strengthsCompatible(normalized.strengths, product.strengths)) continue;
    if (!dosageFormsCompatible(normalized.dosageForms, product.dosageForms)) continue;
    if (!bareNumbersCompatible(phraseBareNumbers, product)) continue;
    const score = Math.max(
      0,
      ...product.normalizedNames.map((name) => dominantNameTokenScore(normalized.normalized, name))
    );
    if (score >= 0.75) {
      addCandidate(
        product,
        "dominant_name_token_match",
        score,
        `\u062A\u063A\u0637\u064A\u0629 \u0642\u0648\u064A\u0629 \u0644\u0627\u0633\u0645 \u0627\u0644\u0645\u0646\u062A\u062C (${(score * 100).toFixed(0)}%) \u0645\u0639 \u062A\u0648\u0627\u0641\u0642 \u0627\u0644\u0634\u0643\u0644/\u0627\u0644\u0642\u0648\u0629/\u0627\u0644\u0623\u0631\u0642\u0627\u0645`
      );
    }
  }
  if (normalized.strengths.length > 0 || normalized.dosageForms.length > 0 || phraseBareNumbers.length > 0) {
    const phraseTokens = normalized.normalized.split(" ").filter((t) => t.length > 2 && !/^[0-9.]+$/.test(t));
    for (const product of index.catalog) {
      if (!allowed(product)) continue;
      if (candidateMap.has(product.productId)) continue;
      const sharesToken = product.normalizedNames.some((n) => phraseTokens.some((t) => n.includes(t)));
      if (!sharesToken) continue;
      if (!strengthsCompatible(normalized.strengths, product.strengths)) continue;
      if (!dosageFormsCompatible(normalized.dosageForms, product.dosageForms)) continue;
      if (!bareNumbersCompatible(phraseBareNumbers, product)) continue;
      addCandidate(product, "strength_form_token_match", 0.5, "\u062A\u0637\u0627\u0628\u0642 \u0641\u064A \u0627\u0644\u0642\u0648\u0629/\u0627\u0644\u0634\u0643\u0644 \u0627\u0644\u0635\u064A\u062F\u0644\u0627\u0646\u064A/\u0627\u0644\u0631\u0642\u0645 \u0645\u0639 \u0631\u0645\u0632 \u0645\u0634\u062A\u0631\u0643 \u0641\u064A \u0627\u0644\u0627\u0633\u0645");
    }
  }
  if (candidateMap.size === 0) {
    for (const product of index.catalog) {
      if (!allowed(product)) continue;
      if (!strengthsCompatible(normalized.strengths, product.strengths)) continue;
      if (!dosageFormsCompatible(normalized.dosageForms, product.dosageForms)) continue;
      if (!bareNumbersCompatible(phraseBareNumbers, product)) continue;
      const bestOverlap = Math.max(0, ...product.normalizedNames.map((n) => tokenOverlapScore(normalized.normalized, n)));
      if (bestOverlap >= 0.4) {
        addCandidate(product, "cautious_fuzzy", bestOverlap, `\u062A\u062F\u0627\u062E\u0644 \u062C\u0632\u0626\u064A \u0641\u064A \u0627\u0644\u0643\u0644\u0645\u0627\u062A (\u0646\u0633\u0628\u0629 ${(bestOverlap * 100).toFixed(0)}%)`);
      }
    }
  }
  const candidates = Array.from(candidateMap.values()).sort(
    (a, b) => confidenceRank2(b.confidence) - confidenceRank2(a.confidence) || b.score - a.score
  );
  if (candidates.length === 0) reasons.push("unresolved: \u0644\u0627 \u064A\u0648\u062C\u062F \u0623\u064A \u0645\u0631\u0634\u062D \u0645\u0646 \u0623\u064A \u0645\u0633\u062A\u0648\u0649 \u0641\u064A \u0627\u0644\u062A\u0633\u0644\u0633\u0644 \u0627\u0644\u0647\u0631\u0645\u064A");
  const selected = isSafeSelection(candidates);
  const ambiguous = candidates.length > 1 && !selected;
  if (ambiguous) reasons.push(`ambiguous: ${candidates.length} \u0645\u0631\u0634\u062D\u064A\u0646 \u0628\u062F\u0648\u0646 \u062A\u0631\u062C\u064A\u062D \u0622\u0645\u0646`);
  return { phrase, normalized, candidates, selected, ambiguous, reasons };
}
function confidenceRank2(level) {
  switch (level) {
    case "proven":
      return 3;
    case "strongly_inferred":
      return 2;
    case "weakly_inferred":
      return 1;
    case "unknown":
      return 0;
  }
}

// src/lib/salesIntelligence/salesIntelligencePipeline.ts
function messagesForMessageIds(understanding, messageIds) {
  const ids = new Set(messageIds);
  return understanding.messages.filter((m) => ids.has(m.id));
}
function computeActiveBasketValue(items) {
  let sum = 0;
  let any = false;
  for (const item of items) {
    if (item.lineTotal != null) {
      sum += item.lineTotal;
      any = true;
    }
  }
  return any ? sum : null;
}
function invoiceRowLookupId(row) {
  const value = row.id ?? row.invoice_number ?? row.invoice_no;
  return String(value ?? "").trim();
}
function computeOverallEvidenceLevel(completeness) {
  if (!completeness.conversationAvailable) return "insufficient";
  if (!completeness.basketDetected) {
    return completeness.customerIdentityResolved ? "low" : "insufficient";
  }
  const coreSignals = [
    completeness.customerIdentityResolved,
    completeness.caseSegmentationConfident,
    completeness.finalBasketDetected,
    completeness.announcedTotalAvailable,
    completeness.customerConfirmationDetected,
    completeness.staffConfirmationDetected,
    completeness.invoiceCandidatesAvailable,
    completeness.invoiceAttributed
  ];
  const ratio = coreSignals.filter(Boolean).length / coreSignals.length;
  if (ratio >= 0.85) return "high";
  if (ratio >= 0.55) return "medium";
  if (ratio >= 0.25) return "low";
  return "insufficient";
}
function enrichBasketProductIdentities(itemsByBasketId, productIndex) {
  if (!productIndex) return itemsByBasketId;
  return Object.fromEntries(
    Object.entries(itemsByBasketId).map(([basketId, items]) => [
      basketId,
      items.map((item) => {
        if (item.productId || item.resolutionStatus === "contradicted" || item.resolutionStatus === "missing") {
          return item;
        }
        const resolution = resolveProductMention(item.productNameRaw, productIndex);
        const selected = resolution.selected;
        if (!selected || !["proven", "strongly_inferred"].includes(selected.confidence)) {
          return item;
        }
        return {
          ...item,
          productId: selected.product.productId,
          // Exact code is canonical proof. Exact canonical name / approved alias remains
          // partially proven even though we can safely carry the canonical id forward.
          resolutionStatus: selected.confidence === "proven" ? "proven" : "partially_proven"
        };
      })
    ])
  );
}
function analyzeOneCase(conversationCase, scopedMessages, input, interaction = null) {
  const pipelineWarnings = [];
  const {
    baskets,
    itemsByBasketId: rawItemsByBasketId,
    summaryEvents,
    customerConfirmationEvents,
    staffFinalConfirmationEvents
  } = buildCaseBaskets(conversationCase.caseId, scopedMessages);
  const itemsByBasketId = enrichBasketProductIdentities(rawItemsByBasketId, input.productIndex);
  const activeBasketResolution = resolveActiveBasket(baskets);
  const activeBasket = activeBasketResolution.outcome === "selected" ? activeBasketResolution.basket : null;
  if (activeBasketResolution.outcome === "needs_human_review") {
    pipelineWarnings.push("active_basket_conflict_multiple_non_superseded_versions");
  }
  const commercialConfirmation = deriveCommercialConfirmationState(
    conversationCase.caseId,
    baskets,
    summaryEvents,
    customerConfirmationEvents,
    staffFinalConfirmationEvents
  );
  const hasMeaningfulBasketItems = baskets.some((basket) => (itemsByBasketId[basket.basketId] ?? []).length > 0);
  const activeItems = activeBasket ? itemsByBasketId[activeBasket.basketId] ?? [] : [];
  const customerNeed = deriveCustomerNeedModel({
    caseId: conversationCase.caseId,
    messages: scopedMessages,
    baskets,
    itemsByBasketId,
    activeBasket,
    staffIdBySender: input.staffIdBySender
  });
  const unavailableDemand = deriveUnavailableDemand({
    conversationCase,
    customerNeed,
    messages: scopedMessages,
    customerIdentityStatus: input.customerIdentityStatus
  });
  const activeBasketValue = computeActiveBasketValue(activeItems);
  const historicalClosure = deriveHistoricalCommercialClosureAssessment(
    conversationCase.caseId,
    scopedMessages,
    commercialConfirmation,
    activeItems,
    activeBasket?.announcedTotal != null
  );
  const applicability = deriveOrderConfirmationProtocolApplicability({
    caseType: conversationCase.caseType,
    commercial: commercialConfirmation,
    hasMeaningfulBasketItems,
    historicalClosure
  });
  const protocolAssessment = { ...assessOrderConfirmationProtocol(commercialConfirmation), applicability };
  const candidateContext = {
    caseId: conversationCase.caseId,
    customerId: conversationCase.customerId,
    customerPhone: conversationCase.customerPhone,
    branchNameRaw: conversationCase.branchNameRaw,
    caseStartedAt: conversationCase.startedAt,
    caseEndedAt: conversationCase.endedAt
  };
  const invoiceCandidates = input.resolveInvoiceCandidates(candidateContext);
  const attributionCtx = {
    caseId: conversationCase.caseId,
    customerId: conversationCase.customerId,
    customerPhone: conversationCase.customerPhone,
    branchNameRaw: conversationCase.branchNameRaw,
    // Same rule as candidateContext above — this exact segmented case interval, never coarse
    // whole-thread timestamps.
    caseStartedAt: conversationCase.startedAt,
    caseEndedAt: conversationCase.endedAt,
    commercialConfirmation,
    activeAnnouncedTotal: activeBasket?.announcedTotal ?? null,
    activeBasketValue,
    activeBasketItems: activeItems.map((item) => ({
      productNameRaw: item.productNameRaw,
      productId: item.productId,
      quantity: item.quantity
    })),
    knownStaffIds: input.knownStaffIds ?? [],
    legacyMatchedInvoiceId: input.legacyMatchedInvoiceId ?? null,
    legacyMatchedInvoiceNumber: input.legacyMatchedInvoiceNumber ?? null,
    trustedInvoiceId: input.trustedInvoiceId ?? null,
    trustedInvoiceNumber: input.trustedInvoiceNumber ?? null
  };
  const itemEvidenceProvider = input.itemEvidenceProvider ?? unavailableInvoiceItemEvidenceProvider;
  const rawAttribution = deriveSaleAttributionAssessment(
    attributionCtx,
    invoiceCandidates,
    itemEvidenceProvider,
    input.competingSelections ?? []
  );
  const invoiceRow = rawAttribution.selectedInvoiceId ? invoiceCandidates.find((row) => invoiceRowLookupId(row) === rawAttribution.selectedInvoiceId) ?? null : null;
  if (rawAttribution.selectedInvoiceId && !invoiceRow) {
    pipelineWarnings.push("selected_invoice_row_not_found_in_candidate_pool");
  }
  const basketInvoiceMatch = deriveBasketInvoiceMatch({
    caseId: conversationCase.caseId,
    baskets,
    itemsByBasketId,
    attribution: rawAttribution,
    invoiceRow,
    itemEvidenceProvider,
    documentedAdjustments: input.documentedAdjustments,
    invoiceCancelledOrReturned: input.invoiceCancelledOrReturned
  });
  const integrityAssessment = deriveSalesIntegrityAssessment({
    caseId: conversationCase.caseId,
    commercialConfirmation,
    protocolAssessment,
    attribution: rawAttribution,
    basketInvoiceMatch,
    invoiceStatusHint: input.invoiceStatusHint ?? null,
    knownStaffIds: input.knownStaffIds,
    caseEndedAt: conversationCase.endedAt,
    protocolPolicyEffectiveAt: input.protocolPolicyEffectiveAt
  });
  const evidenceCompletenessBase = {
    conversationAvailable: scopedMessages.length > 0,
    customerIdentityResolved: Boolean(conversationCase.customerId) || Boolean(conversationCase.customerPhone),
    caseSegmentationConfident: !conversationCase.needsHumanReview,
    // A meaningful customer message alone can produce an empty 'draft' CaseBasket record with no
    // items (see buildCaseBaskets's own ongoing-basket-building fallback in caseBasketEngine.ts) —
    // that artifact is not real evidence of commercial intent, so this requires at least one item.
    basketDetected: hasMeaningfulBasketItems,
    finalBasketDetected: activeBasket !== null && activeBasket.status !== "draft",
    announcedTotalAvailable: activeBasket?.announcedTotal != null,
    customerConfirmationDetected: commercialConfirmation.customerConfirmed,
    staffConfirmationDetected: commercialConfirmation.staffConfirmed,
    invoiceCandidatesAvailable: invoiceCandidates.length > 0,
    invoiceAttributed: rawAttribution.hasAttributedInvoice,
    invoiceItemsAvailable: basketInvoiceMatch.itemEvidenceReady,
    // Always false today — no fulfillment/delivery evidence source exists yet. A staff message
    // like "جاري الإرسال" is staff INTENT/confirmation (already captured as staffConfirmationDetected
    // via caseBasketEngine's STAFF_FINAL_CONFIRMATION_RX), never actual delivery fulfillment.
    fulfillmentEvidenceAvailable: false
  };
  const evidenceCompleteness = {
    ...evidenceCompletenessBase,
    overallEvidenceLevel: computeOverallEvidenceLevel(evidenceCompletenessBase)
  };
  const failureReasons = [];
  if (conversationCase.needsHumanReview) failureReasons.push("case_segmentation_uncertain");
  if (!conversationCase.customerId && !conversationCase.customerPhone) failureReasons.push("customer_identity_unresolved");
  if (!evidenceCompleteness.basketDetected) failureReasons.push("basket_not_detected");
  if (activeItems.some(
    (item) => item.resolutionStatus === "unknown" || item.resolutionStatus === "contradicted" || Boolean(input.productIndex) && !item.productId
  )) {
    failureReasons.push("product_identity_unresolved");
  }
  if (activeItems.some((item) => item.quantity == null)) failureReasons.push("quantity_unknown");
  if (evidenceCompleteness.basketDetected && !commercialConfirmation.summaryPresented) failureReasons.push("final_summary_missing");
  if (evidenceCompleteness.basketDetected && !commercialConfirmation.announcedTotalPresent) failureReasons.push("announced_total_missing");
  if (evidenceCompleteness.basketDetected && !commercialConfirmation.customerConfirmed && commercialConfirmation.currentState !== "unknown" && commercialConfirmation.currentState !== "rejected") {
    failureReasons.push("customer_confirmation_uncertain");
  }
  if (commercialConfirmation.currentState === "commercial_confirmation_complete" && invoiceCandidates.length === 0) {
    failureReasons.push("invoice_candidate_missing");
  }
  if (rawAttribution.contradictions.includes("ambiguous_multiple_candidates")) failureReasons.push("invoice_candidates_ambiguous");
  if (rawAttribution.hasAttributedInvoice && !basketInvoiceMatch.itemEvidenceReady) failureReasons.push("invoice_items_unavailable");
  if (commercialConfirmation.staffConfirmed && (input.knownStaffIds ?? []).length === 0) failureReasons.push("staff_identity_unresolved");
  if (!conversationCase.endedAt) failureReasons.push("conversation_timestamp_quality_issue");
  const isGenuinelyInformationOnly = conversationCase.caseType === "information_only" && !evidenceCompleteness.basketDetected;
  const needsHumanReview = conversationCase.needsHumanReview || commercialConfirmation.needsHumanReview || rawAttribution.needsHumanReview || basketInvoiceMatch.needsHumanReview || !isGenuinelyInformationOnly && integrityAssessment.needsHumanReview || activeBasketResolution.outcome === "needs_human_review";
  const humanReviewReasons = Array.from(
    /* @__PURE__ */ new Set([
      ...conversationCase.humanReviewReasons,
      ...commercialConfirmation.humanReviewReasons,
      ...rawAttribution.humanReviewReasons,
      ...basketInvoiceMatch.humanReviewReasons,
      ...isGenuinelyInformationOnly ? [] : integrityAssessment.humanReviewReasons,
      ...activeBasketResolution.outcome === "needs_human_review" ? ["active_basket_conflict"] : []
    ])
  );
  const derivedSaleProof = deriveSaleProofState({
    attribution: rawAttribution,
    basketInvoiceMatch,
    integrityAssessment
  });
  const identityStatus = input.customerIdentityStatus;
  const identityBlocked = identityStatus !== void 0 && identityStatus !== "resolved";
  const identityReason = `customer_identity_${identityStatus}`;
  const attribution = identityBlocked ? {
    ...rawAttribution,
    isOfficialForStaffEvaluation: false,
    humanReviewReasons: Array.from(/* @__PURE__ */ new Set([...rawAttribution.humanReviewReasons, identityReason]))
  } : rawAttribution;
  const saleProof = identityBlocked && derivedSaleProof.state === "proven" ? {
    ...derivedSaleProof,
    state: identityStatus === "contradicted" ? "contradicted" : "strongly_supported",
    trustedInvoiceId: null,
    contradictions: identityStatus === "contradicted" ? Array.from(/* @__PURE__ */ new Set([...derivedSaleProof.contradictions, "customer_identity_contradicted"])) : derivedSaleProof.contradictions,
    ruleIds: Array.from(/* @__PURE__ */ new Set([...derivedSaleProof.ruleIds, "sale_proof.customer_identity_not_resolved"])),
    needsHumanReview: true
  } : derivedSaleProof;
  if (identityBlocked && !humanReviewReasons.includes(identityReason)) humanReviewReasons.push(identityReason);
  const salesOutcome = deriveCanonicalSalesOutcome({
    caseId: conversationCase.caseId,
    caseType: conversationCase.caseType,
    commercialConfirmation,
    saleProof,
    hasMeaningfulBasketItems,
    needsHumanReview
  });
  const journeyState = deriveCommercialJourneyState({
    caseId: conversationCase.caseId,
    messages: scopedMessages,
    customerNeed,
    commercialConfirmation,
    salesOutcome
  });
  const lostOpportunity = deriveLostOpportunity({
    caseId: conversationCase.caseId,
    messages: scopedMessages,
    customerNeed,
    unavailableDemand,
    commercialConfirmation,
    journeyState,
    salesOutcome
  });
  const followUp = deriveFollowUpOpportunities({
    conversationCase,
    messages: scopedMessages,
    customerNeed,
    unavailableDemand,
    lostOpportunity,
    salesOutcome,
    customerIdentityStatus: input.customerIdentityStatus,
    staffIdBySender: input.staffIdBySender
  });
  let status;
  if (isGenuinelyInformationOnly) {
    status = "analyzed";
  } else if (needsHumanReview) {
    status = "needs_human_review";
  } else if (evidenceCompleteness.overallEvidenceLevel === "insufficient") {
    status = "insufficient_data";
  } else if (evidenceCompleteness.overallEvidenceLevel === "low" || evidenceCompleteness.overallEvidenceLevel === "medium") {
    status = "partial";
  } else {
    status = "analyzed";
  }
  const analysis = {
    caseId: conversationCase.caseId,
    conversationId: input.conversationId,
    conversationCase,
    customerNeed,
    unavailableDemand,
    basketHistory: baskets,
    itemsByBasketId,
    activeBasket,
    commercialConfirmation,
    protocolAssessment,
    historicalClosure,
    invoiceCandidateIds: invoiceCandidates.map(invoiceRowLookupId),
    attribution,
    basketInvoiceMatch,
    integrityAssessment,
    salesOutcome,
    journeyState,
    lostOpportunity,
    followUp,
    evidenceCompleteness,
    status,
    pipelineWarnings,
    needsHumanReview,
    humanReviewReasons,
    failureReasons
  };
  return {
    ...analysis,
    caseIntelligence: buildCaseIntelligenceView(analysis, {
      messages: scopedMessages,
      interaction,
      customerIdentityStatus: input.customerIdentityStatus,
      staffIdBySender: input.staffIdBySender
    })
  };
}
function deriveSegmentedCases(input) {
  const pipelineWarnings = [];
  const cases = [];
  const parsedMessages = parseWhatsAppExport(input.rawWhatsAppExportText, {
    trustedConversationStartedAt: input.trustedConversationStartedAt ?? null
  });
  if (parsedMessages.length === 0) {
    pipelineWarnings.push("raw_text_produced_no_parsed_messages");
    return { sessionsProcessed: 0, cases: [], pipelineWarnings };
  }
  const coarseSessions = splitWhatsAppSessions(parsedMessages, input.sessionSplitGapMinutes ?? 120);
  if (coarseSessions.length === 0) {
    pipelineWarnings.push("no_sessions_derived_from_raw_text");
    return { sessionsProcessed: 0, cases: [], pipelineWarnings };
  }
  const semanticSession = splitWhatsAppSessions(parsedMessages, Number.MAX_SAFE_INTEGER)[0];
  if (!semanticSession) {
    pipelineWarnings.push("no_semantic_session_derived_from_raw_text");
    return { sessionsProcessed: coarseSessions.length, cases: [], pipelineWarnings };
  }
  const understanding = buildConversationUnderstandingV32(semanticSession);
  const rawCases = deriveConversationCases({
    understanding,
    conversationId: input.conversationId,
    sourceCaseIdV22: input.sourceCaseIdV22 ?? null,
    customerIdHint: input.customerIdHint ?? null,
    customerPhoneHint: input.customerPhoneHint ?? null,
    branchIdHint: input.branchIdHint ?? null,
    branchNameRawHint: input.branchNameRawHint ?? null
  });
  const coarseSessionIndexByMessageId = /* @__PURE__ */ new Map();
  coarseSessions.forEach((session, sessionIndex) => {
    session.messages.forEach((message) => coarseSessionIndexByMessageId.set(message.id, sessionIndex));
  });
  const localInteractionCountBySession = /* @__PURE__ */ new Map();
  let crossedCoarseBoundary = false;
  understanding.interactions.forEach((interaction, index) => {
    const rawCase = rawCases[index];
    const coarseSessionIndexes = Array.from(
      new Set(
        interaction.messageIds.map((messageId2) => coarseSessionIndexByMessageId.get(messageId2)).filter((value) => typeof value === "number")
      )
    ).sort((a, b) => a - b);
    const anchorSessionIndex = coarseSessionIndexes[0] ?? 0;
    const localInteractionIndex = localInteractionCountBySession.get(anchorSessionIndex) ?? 0;
    localInteractionCountBySession.set(anchorSessionIndex, localInteractionIndex + 1);
    if (coarseSessionIndexes.length > 1) crossedCoarseBoundary = true;
    const conversationCase = coarseSessions.length > 1 ? {
      ...rawCase,
      caseId: `${input.conversationId}:interaction:${localInteractionIndex}:session:${anchorSessionIndex}`
    } : rawCase;
    const scopedMessages = messagesForMessageIds(understanding, interaction.messageIds);
    cases.push({ conversationCase, scopedMessages, interaction });
  });
  if (crossedCoarseBoundary) {
    pipelineWarnings.push("semantic_interaction_crossed_coarse_session_boundary");
  }
  return { sessionsProcessed: coarseSessions.length, cases, pipelineWarnings };
}
function deriveCasesOnly(input) {
  const result = deriveSegmentedCases(input);
  return {
    sessionsProcessed: result.sessionsProcessed,
    cases: result.cases.map((c) => c.conversationCase),
    pipelineWarnings: result.pipelineWarnings
  };
}
function runSalesIntelligencePipeline(input) {
  const segmented = deriveSegmentedCases(input);
  const caseAnalyses = segmented.cases.map(
    ({ conversationCase, scopedMessages, interaction }) => analyzeOneCase(conversationCase, scopedMessages, input, interaction)
  );
  return {
    conversationId: input.conversationId,
    sessionsProcessed: segmented.sessionsProcessed,
    caseAnalyses,
    pipelineWarnings: segmented.pipelineWarnings
  };
}

// src/lib/salesIntelligence/persistence/caseWriter.ts
async function upsertSalesIntelligenceCase(supabaseClient, caseId, content) {
  const { data: existing, error: readError } = await supabaseClient.from("sales_intelligence_cases").select("case_id, conversation_id, source_case_id_v22, customer_id, customer_phone, branch_id, branch_name_raw").eq("case_id", caseId).maybeSingle();
  if (readError) throw readError;
  const canonicalIdentityChanged = !existing || existing.conversation_id !== content.conversationId || existing.source_case_id_v22 !== content.sourceCaseIdV22 || existing.customer_id !== content.customerId || existing.customer_phone !== content.customerPhone || existing.branch_id !== content.branchId || existing.branch_name_raw !== content.branchNameRaw;
  const { error: upsertError } = await supabaseClient.from("sales_intelligence_cases").upsert(
    {
      case_id: caseId,
      conversation_id: content.conversationId,
      source_case_id_v22: content.sourceCaseIdV22,
      customer_id: content.customerId,
      customer_phone: content.customerPhone,
      branch_id: content.branchId,
      branch_name_raw: content.branchNameRaw,
      case_started_at: content.caseStartedAt,
      case_ended_at: content.caseEndedAt,
      last_seen_at: (/* @__PURE__ */ new Date()).toISOString()
    },
    { onConflict: "case_id" }
  );
  if (upsertError) throw upsertError;
  return { caseId, wasCreated: !existing, canonicalIdentityChanged };
}

// src/lib/salesIntelligence/persistence/hashing.ts
function canonicalize(value) {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (value !== null && typeof value === "object") {
    const source = value;
    const sorted = {};
    for (const key of Object.keys(source).sort()) {
      sorted[key] = canonicalize(source[key]);
    }
    return sorted;
  }
  return value;
}
function canonicalJsonStringify(value) {
  return JSON.stringify(canonicalize(value));
}
function fallbackDeterministicHash(input) {
  let h1 = 3735928559 ^ input.length;
  let h2 = 1103547991 ^ input.length;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ h1 >>> 16, 2246822507) ^ Math.imul(h2 ^ h2 >>> 13, 3266489909);
  h2 = Math.imul(h2 ^ h2 >>> 16, 2246822507) ^ Math.imul(h1 ^ h1 >>> 13, 3266489909);
  return `fallback-${(h2 >>> 0).toString(16).padStart(8, "0")}${(h1 >>> 0).toString(16).padStart(8, "0")}`;
}
async function sha256Hex(input) {
  if (typeof crypto !== "undefined" && crypto.subtle && typeof TextEncoder !== "undefined") {
    const bytes = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return fallbackDeterministicHash(input);
}
async function hashCanonical(value) {
  return sha256Hex(canonicalJsonStringify(value));
}
function normalizeRawExportTextForHashing(rawWhatsAppExportText) {
  return rawWhatsAppExportText.replace(/\r\n?/g, "\n").replace(/^\n+/, "").replace(/\n+$/, "");
}
async function computeSemanticSourceHash(input) {
  return hashCanonical({
    rawWhatsAppExportText: normalizeRawExportTextForHashing(input.rawWhatsAppExportText),
    trustedConversationStartedAt: input.trustedConversationStartedAt ?? null,
    branchIdentityMappingVersion: input.branchIdentityMappingVersion
  });
}
async function computeAttributionInputHash(input) {
  return hashCanonical({
    customerId: input.customerId,
    customerPhone: input.customerPhone,
    candidateInvoiceIds: [...input.candidateInvoiceIds].sort(),
    branchNameRaw: input.branchNameRaw,
    activeBasketItems: input.activeBasketItems ?? [],
    invoiceItemEvidenceSnapshot: input.invoiceItemEvidenceSnapshot ?? null
  });
}
async function computePolicyInputHash(input) {
  return hashCanonical({
    protocolApplicability: input.protocolApplicability,
    caseEndedAt: input.caseEndedAt,
    policyConfigId: input.policyConfigId
  });
}
async function computeMatchingInputHash(input) {
  return hashCanonical({
    basketId: input.basketId,
    basketVersion: input.basketVersion,
    activeItems: [...input.activeItems].map((item) => ({ productNameRaw: item.productNameRaw, productId: item.productId ?? null, quantity: item.quantity })).sort((a, b) => a.productNameRaw.localeCompare(b.productNameRaw)),
    selectedInvoiceId: input.selectedInvoiceId,
    selectedInvoiceNumber: input.selectedInvoiceNumber,
    matchingEngineVersion: input.matchingEngineVersion,
    invoiceItemEvidenceSnapshot: input.invoiceItemEvidenceSnapshot ?? null
  });
}

// src/lib/salesIntelligence/persistence/versions.ts
var PIPELINE_VERSION = "sales-intelligence-v5";
var ENGINE_VERSIONS = {
  caseSegmentation: "case-segmentation-v6-semantic-boundaries",
  historicalClosure: "historical-closure-v1",
  commercialConfirmation: "commercial-confirmation-v4-natural-arabic-basket-quantities",
  protocolApplicability: "protocol-applicability-v1",
  attribution: "attribution-v6-truth-v2-draft-product-evidence",
  matching: "matching-v2-line-item-evidence",
  policyEvaluation: "policy-evaluation-v1"
};
var BRANCH_IDENTITY_MAPPING_VERSION = "branch-identity-mapping-v2";

// src/lib/salesIntelligence/persistence/analysisWriter.ts
async function persistCaseAnalysis(supabaseClient, caseId, rawWhatsAppExportText, content, trustedConversationStartedAt) {
  const semanticSourceHash = await computeSemanticSourceHash({
    rawWhatsAppExportText,
    trustedConversationStartedAt: trustedConversationStartedAt ?? null,
    branchIdentityMappingVersion: BRANCH_IDENTITY_MAPPING_VERSION
  });
  const { data, error } = await supabaseClient.rpc("sales_intelligence_write_case_analysis", {
    p_case_id: caseId,
    p_row: {
      pipeline_version: PIPELINE_VERSION,
      engine_version_case_segmentation: ENGINE_VERSIONS.caseSegmentation,
      engine_version_historical_closure: ENGINE_VERSIONS.historicalClosure,
      engine_version_commercial_confirmation: ENGINE_VERSIONS.commercialConfirmation,
      engine_version_protocol_applicability: ENGINE_VERSIONS.protocolApplicability,
      semantic_source_hash: semanticSourceHash,
      case_type: content.caseType,
      case_status: content.caseStatus,
      pipeline_status: content.pipelineStatus,
      overall_evidence_level: content.overallEvidenceLevel,
      identity_customer_id: content.identityAtAnalysis.customerId,
      identity_customer_phone: content.identityAtAnalysis.customerPhone,
      identity_branch_id: content.identityAtAnalysis.branchId,
      identity_branch_name_raw: content.identityAtAnalysis.branchNameRaw,
      case_started_at: content.caseStartedAt,
      case_ended_at: content.caseEndedAt,
      historical_closure_level: content.historicalClosureLevel,
      commercial_confirmation_state: content.commercialConfirmationState,
      protocol_applicability: content.protocolApplicability,
      attribution_level: content.attributionLevel,
      integrity_evaluation_scope: content.integrityEvaluationScope,
      needs_human_review: content.needsHumanReview,
      human_review_reasons: content.humanReviewReasons,
      failure_reasons: content.failureReasons,
      pipeline_warnings: content.pipelineWarnings,
      evidence_snapshot: content.evidenceSnapshot
    }
  });
  if (error) throw error;
  return {
    analysisId: data.analysis_id,
    analysisVersion: data.analysis_version,
    isCurrent: data.is_current,
    isNew: data.is_new,
    semanticSourceHash
  };
}

// src/lib/salesIntelligence/persistence/mappers.ts
function mapCaseRowContent(analysis, conversationRowId) {
  const cc = analysis.conversationCase;
  return {
    conversationId: conversationRowId,
    sourceCaseIdV22: cc.sourceCaseIdV22,
    customerId: cc.customerId,
    customerPhone: cc.customerPhone,
    branchId: cc.branchId,
    branchNameRaw: cc.branchNameRaw,
    caseStartedAt: cc.startedAt,
    caseEndedAt: cc.endedAt
  };
}
function mapCaseAnalysisRowContent(analysis) {
  const cc = analysis.conversationCase;
  return {
    caseType: cc.caseType,
    caseStatus: cc.status,
    pipelineStatus: analysis.status,
    overallEvidenceLevel: analysis.evidenceCompleteness.overallEvidenceLevel,
    identityAtAnalysis: {
      customerId: cc.customerId,
      customerPhone: cc.customerPhone,
      branchId: cc.branchId,
      branchNameRaw: cc.branchNameRaw
    },
    caseStartedAt: cc.startedAt,
    caseEndedAt: cc.endedAt,
    historicalClosureLevel: analysis.historicalClosure.closureLevel,
    commercialConfirmationState: analysis.commercialConfirmation.currentState,
    protocolApplicability: analysis.protocolAssessment.applicability ?? "applicable",
    attributionLevel: analysis.attribution.attributionLevel,
    integrityEvaluationScope: analysis.basketInvoiceMatch.integrityEvaluationScope,
    needsHumanReview: analysis.needsHumanReview,
    humanReviewReasons: analysis.humanReviewReasons,
    failureReasons: analysis.failureReasons,
    pipelineWarnings: analysis.pipelineWarnings,
    evidenceSnapshot: {
      conversationCaseConfidence: {
        level: cc.confidence.level,
        score: cc.confidence.score,
        ruleIds: cc.confidence.ruleIds
      },
      evidenceCompleteness: analysis.evidenceCompleteness,
      // v5+: one consolidated read model instead of separate need/demand/lost/follow-up/journey keys.
      caseIntelligence: analysis.caseIntelligence,
      historicalClosureEvidence: analysis.historicalClosure.confidence.evidence,
      // No dedicated applicability-rule-id field exists on OrderConfirmationProtocolAssessment —
      // applicability is DERIVED from historicalClosure + commercialConfirmation (see
      // salesIntelligencePipeline.ts's own data-flow comment: "historicalClosure is computed
      // BEFORE applicability and consumed BY it as one evidence source"), so the rule ids that
      // actually explain an applicability verdict are historicalClosure's own ruleIds. Documented
      // choice, not a guess.
      protocolApplicabilityRuleIds: analysis.historicalClosure.ruleIds,
      canonicalSalesOutcome: analysis.salesOutcome
    }
  };
}
function mapAttributionRowContent(analysis) {
  const attribution = analysis.attribution;
  const selected = attribution.selectedCandidate;
  return {
    identityAtEvaluation: {
      customerId: analysis.conversationCase.customerId,
      customerPhone: analysis.conversationCase.customerPhone
    },
    selectedInvoiceId: attribution.selectedInvoiceId,
    selectedInvoiceNumber: attribution.selectedInvoiceNumber,
    attributionLevel: attribution.attributionLevel,
    confidenceScore: attribution.confidence.score,
    isOfficialForStaffEvaluation: attribution.isOfficialForStaffEvaluation,
    competingCaseIds: attribution.competingCaseIds,
    ambiguityStatus: attribution.contradictions.includes("ambiguous_multiple_candidates") ? "ambiguous_multiple_candidates" : "none",
    identityConflict: selected?.identityConflict ?? "none",
    branchConflict: selected?.branchMatch === "mismatch",
    candidateCount: attribution.candidateCount,
    primaryEvidence: attribution.primaryEvidence,
    contradictions: attribution.contradictions,
    ruleIds: attribution.ruleIds,
    legacyEvidenceUsed: attribution.legacyEvidenceUsed
  };
}
function mapBasketInvoiceMatchRowContent(analysis) {
  const match = analysis.basketInvoiceMatch;
  return {
    basketId: match.basketId,
    basketVersion: match.basketVersion,
    invoiceId: match.invoiceId,
    invoiceNumber: match.invoiceNumber,
    totalMatch: match.totalMatch,
    itemMatch: match.itemMatch,
    quantityMatch: match.quantityMatch,
    overallMatch: match.overallMatch,
    headerEvidenceReady: match.headerEvidenceReady,
    itemEvidenceReady: match.itemEvidenceReady,
    // Never upgraded here (H.1B instruction #11) — this is exactly what basketInvoiceMatchingEngine
    // itself returned; the writer/mapper layer has no opinion and applies no promotion logic.
    integrityEvaluationScope: match.integrityEvaluationScope,
    differences: match.differences.map((difference) => ({
      type: difference.type,
      key: difference.key,
      before: difference.before,
      after: difference.after,
      explanation: difference.explanation
    })),
    needsHumanReview: match.needsHumanReview,
    humanReviewReasons: match.humanReviewReasons
  };
}
function mapPolicyEvaluationRowContent(analysis, protocolPolicyEffectiveAt) {
  return {
    protocolPolicyEffectiveAt,
    protocolApplicability: analysis.protocolAssessment.applicability ?? "applicable",
    protocolPolicyCompliance: analysis.integrityAssessment.protocolPolicyCompliance
  };
}
function invoiceRowLookupId2(row) {
  const value = row.id ?? row.invoice_number ?? row.invoice_no;
  return String(value ?? "").trim();
}

// src/lib/salesIntelligence/persistence/policyEvaluationWriter.ts
async function fetchCurrentPolicyConfig(supabaseClient) {
  const { data, error } = await supabaseClient.from("sales_intelligence_policy_config").select("policy_config_id, policy_config_version, protocol_policy_effective_at").eq("is_current", true).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    policyConfigId: data.policy_config_id,
    policyConfigVersion: data.policy_config_version,
    protocolPolicyEffectiveAt: data.protocol_policy_effective_at
  };
}
async function persistPolicyEvaluation(supabaseClient, analysisId, caseId, analysis, currentPolicyConfig) {
  if (!currentPolicyConfig) return { skipped: true, reason: "no_current_policy_config" };
  const content = mapPolicyEvaluationRowContent(analysis, currentPolicyConfig.protocolPolicyEffectiveAt);
  const policyInputHash = await computePolicyInputHash({
    protocolApplicability: content.protocolApplicability,
    caseEndedAt: analysis.conversationCase.endedAt,
    policyConfigId: currentPolicyConfig.policyConfigId
  });
  const { data, error } = await supabaseClient.rpc("sales_intelligence_write_policy_evaluation", {
    p_analysis_id: analysisId,
    p_row: {
      case_id: caseId,
      policy_config_id: currentPolicyConfig.policyConfigId,
      policy_config_version: currentPolicyConfig.policyConfigVersion,
      protocol_policy_effective_at: content.protocolPolicyEffectiveAt,
      protocol_applicability: content.protocolApplicability,
      protocol_policy_compliance: content.protocolPolicyCompliance,
      policy_input_hash: policyInputHash
    }
  });
  if (error) throw error;
  return {
    skipped: false,
    policyEvaluationId: data.policy_evaluation_id,
    evaluationVersion: data.evaluation_version,
    isCurrent: data.is_current,
    isNew: data.is_new,
    policyInputHash
  };
}

// src/lib/salesIntelligence/persistence/attributionWriter.ts
async function persistAttribution(supabaseClient, analysisId, caseId, inputContext, content) {
  const attributionInputHash = await computeAttributionInputHash(inputContext);
  const { data, error } = await supabaseClient.rpc("sales_intelligence_write_attribution", {
    p_analysis_id: analysisId,
    p_row: {
      case_id: caseId,
      attribution_engine_version: ENGINE_VERSIONS.attribution,
      attribution_input_hash: attributionInputHash,
      identity_customer_id: content.identityAtEvaluation.customerId,
      identity_customer_phone: content.identityAtEvaluation.customerPhone,
      selected_invoice_id: content.selectedInvoiceId,
      selected_invoice_number: content.selectedInvoiceNumber,
      attribution_level: content.attributionLevel,
      confidence_score: content.confidenceScore,
      is_official_for_staff_evaluation: content.isOfficialForStaffEvaluation,
      competing_case_ids: content.competingCaseIds,
      ambiguity_status: content.ambiguityStatus,
      identity_conflict: content.identityConflict,
      branch_conflict: content.branchConflict,
      candidate_count: content.candidateCount,
      primary_evidence: content.primaryEvidence,
      contradictions: content.contradictions,
      rule_ids: content.ruleIds,
      legacy_evidence_used: content.legacyEvidenceUsed
    }
  });
  if (error) throw error;
  return {
    attributionRowId: data.id,
    evaluationVersion: data.evaluation_version,
    isCurrentEvaluation: data.is_current_evaluation,
    isNew: data.is_new,
    attributionInputHash
  };
}

// src/lib/salesIntelligence/persistence/basketInvoiceMatchWriter.ts
async function persistBasketInvoiceMatch(supabaseClient, analysisId, caseId, attributionRowId, activeItems, content, invoiceItemEvidenceSnapshot = null) {
  const matchingInputHash = await computeMatchingInputHash({
    basketId: content.basketId,
    basketVersion: content.basketVersion,
    activeItems,
    selectedInvoiceId: content.invoiceId,
    selectedInvoiceNumber: content.invoiceNumber,
    matchingEngineVersion: ENGINE_VERSIONS.matching,
    invoiceItemEvidenceSnapshot
  });
  const { data, error } = await supabaseClient.rpc("sales_intelligence_write_basket_invoice_match", {
    p_analysis_id: analysisId,
    p_row: {
      case_id: caseId,
      attribution_row_id: attributionRowId,
      matching_engine_version: ENGINE_VERSIONS.matching,
      matching_input_hash: matchingInputHash,
      basket_id: content.basketId,
      basket_version: content.basketVersion,
      invoice_id: content.invoiceId,
      invoice_number: content.invoiceNumber,
      total_match: content.totalMatch,
      item_match: content.itemMatch,
      quantity_match: content.quantityMatch,
      overall_match: content.overallMatch,
      header_evidence_ready: content.headerEvidenceReady,
      item_evidence_ready: content.itemEvidenceReady,
      integrity_evaluation_scope: content.integrityEvaluationScope,
      differences: content.differences,
      needs_human_review: content.needsHumanReview,
      human_review_reasons: content.humanReviewReasons
    }
  });
  if (error) throw error;
  return {
    matchRowId: data.id,
    evaluationVersion: data.evaluation_version,
    isCurrentEvaluation: data.is_current_evaluation,
    isNew: data.is_new,
    matchingInputHash
  };
}

// src/lib/salesIntelligence/invoiceClaimResolution.ts
var SCORE_MARGIN = 0.05;
function corroborationCount(candidate) {
  let count = 0;
  if (candidate.announcedTotalMatch === "exact" || candidate.announcedTotalMatch === "near_match") count += 1;
  if (candidate.basketValueMatch === "exact" || candidate.basketValueMatch === "near_match") count += 1;
  if (candidate.productMatch === "available_match") count += 1;
  if (candidate.quantityMatch === "available_match") count += 1;
  if (candidate.staffMatch === "same") count += 1;
  return count;
}
function timeRank(candidate) {
  switch (candidate.timeMatchStrength) {
    case "very_strong":
      return 5;
    case "strong":
      return 4;
    case "moderate":
      return 3;
    case "weak":
      return 2;
    case "very_weak":
      return 1;
    default:
      return 0;
  }
}
function compareClaimStrength(a, b) {
  const directDiff = Number(a.candidate.directInvoiceLink) - Number(b.candidate.directInvoiceLink);
  if (directDiff !== 0) return directDiff;
  const corroborationDiff = corroborationCount(a.candidate) - corroborationCount(b.candidate);
  if (corroborationDiff !== 0) return corroborationDiff;
  const timeDiff = timeRank(a.candidate) - timeRank(b.candidate);
  if (timeDiff !== 0) return timeDiff;
  const scoreDiff = a.candidate.confidenceAssessment.score - b.candidate.confidenceAssessment.score;
  if (Math.abs(scoreDiff) > SCORE_MARGIN) return scoreDiff;
  return 0;
}
function addDenied(map, caseId, invoiceId2) {
  const bucket = map.get(caseId) ?? /* @__PURE__ */ new Set();
  bucket.add(invoiceId2);
  map.set(caseId, bucket);
}
function resolveExclusiveInvoiceClaims(analyses) {
  const claimsByInvoice = /* @__PURE__ */ new Map();
  for (const analysis of analyses) {
    const invoiceId2 = analysis.attribution.selectedInvoiceId;
    const candidate = analysis.attribution.selectedCandidate;
    if (!invoiceId2 || !candidate) continue;
    const bucket = claimsByInvoice.get(invoiceId2) ?? [];
    bucket.push({ caseId: analysis.caseId, invoiceId: invoiceId2, candidate });
    claimsByInvoice.set(invoiceId2, bucket);
  }
  const deniedInvoiceIdsByCase = /* @__PURE__ */ new Map();
  const unresolvedCompetingSelections = [];
  const resolvedWinners = [];
  for (const [invoiceId2, claims] of claimsByInvoice.entries()) {
    if (claims.length <= 1) continue;
    const sorted = [...claims].sort((a, b) => {
      const strength = compareClaimStrength(b, a);
      return strength !== 0 ? strength : a.caseId.localeCompare(b.caseId);
    });
    const top = sorted[0];
    const second = sorted[1];
    if (compareClaimStrength(top, second) <= 0) {
      for (const claim of claims) unresolvedCompetingSelections.push({ caseId: claim.caseId, invoiceId: invoiceId2 });
      continue;
    }
    const losers = claims.filter((claim) => claim.caseId !== top.caseId);
    for (const loser of losers) addDenied(deniedInvoiceIdsByCase, loser.caseId, invoiceId2);
    resolvedWinners.push({ invoiceId: invoiceId2, winnerCaseId: top.caseId, loserCaseIds: losers.map((x) => x.caseId).sort() });
  }
  return { deniedInvoiceIdsByCase, unresolvedCompetingSelections, resolvedWinners };
}
function mergeDeniedInvoiceMaps(target, incoming) {
  let added = 0;
  for (const [caseId, invoiceIds] of incoming.entries()) {
    const bucket = target.get(caseId) ?? /* @__PURE__ */ new Set();
    for (const invoiceId2 of invoiceIds) {
      if (!bucket.has(invoiceId2)) {
        bucket.add(invoiceId2);
        added += 1;
      }
    }
    target.set(caseId, bucket);
  }
  return added;
}

// src/lib/salesIntelligence/invoiceItemEvidenceRepository.ts
function clean(value) {
  return String(value ?? "").trim();
}
function numberOrNull(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function invoiceId(row) {
  return clean(row.id ?? row.invoice_number ?? row.invoice_no);
}
function invoiceNumber(row) {
  return clean(row.invoice_number ?? row.invoice_no);
}
function candidateKey(number, branch) {
  return `${number}|${normalizeBranchName(branch || "")}`;
}
function sameOrNull(values) {
  const present = values.filter((value) => value != null);
  if (!present.length) return null;
  return present.every((value) => value === present[0]) ? present[0] : null;
}
function sumNullable(values) {
  const present = values.filter((value) => value != null && Number.isFinite(value));
  return present.length ? present.reduce((sum, value) => sum + value, 0) : null;
}
function aggregateInvoiceItems(items) {
  const grouped = /* @__PURE__ */ new Map();
  const passthrough = [];
  for (const item of items) {
    const key = item.productId ? `id:${item.productId}` : item.productCode ? `code:${item.productCode}` : "";
    if (!key) {
      passthrough.push(item);
      continue;
    }
    const bucket = grouped.get(key) ?? [];
    bucket.push(item);
    grouped.set(key, bucket);
  }
  const aggregated = Array.from(grouped.values()).map((bucket) => {
    if (bucket.length === 1) return bucket[0];
    return {
      productNameRaw: bucket[0].productNameRaw,
      productId: sameOrNull(bucket.map((item) => item.productId ?? null)),
      productCode: sameOrNull(bucket.map((item) => item.productCode ?? null)),
      quantity: sumNullable(bucket.map((item) => item.quantity)),
      unitName: sameOrNull(bucket.map((item) => item.unitName ?? null)),
      expiryRaw: sameOrNull(bucket.map((item) => item.expiryRaw ?? null)),
      returnedQuantity: sumNullable(bucket.map((item) => item.returnedQuantity)),
      unitPrice: sameOrNull(bucket.map((item) => item.unitPrice ?? null)),
      itemDiscountAmount: sumNullable(bucket.map((item) => item.itemDiscountAmount)),
      itemDiscountPercent: sameOrNull(bucket.map((item) => item.itemDiscountPercent ?? null)),
      grossLineAmount: sumNullable(bucket.map((item) => item.grossLineAmount)),
      netLineAmount: sumNullable(bucket.map((item) => item.netLineAmount)),
      lineTotal: sumNullable(bucket.map((item) => item.lineTotal))
    };
  });
  return [...aggregated, ...passthrough];
}
function chunks(rows, size) {
  const out = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}
function buildInvoiceItemEvidenceProvider(invoiceRows, itemRows) {
  const candidateIds = new Set(invoiceRows.map(invoiceId).filter(Boolean));
  const candidateIdsByNumberBranch = /* @__PURE__ */ new Map();
  for (const invoice of invoiceRows) {
    const id = invoiceId(invoice);
    const number = invoiceNumber(invoice);
    if (!id || !number) continue;
    const key = candidateKey(number, getInvoiceBranch(invoice));
    const ids = candidateIdsByNumberBranch.get(key) ?? [];
    if (!ids.includes(id)) ids.push(id);
    candidateIdsByNumberBranch.set(key, ids);
  }
  const itemsByInvoiceId = /* @__PURE__ */ new Map();
  for (const row of itemRows) {
    const directId = clean(row.invoice_id);
    let resolvedId = directId && candidateIds.has(directId) ? directId : "";
    if (!resolvedId) {
      const number = clean(row.invoice_number);
      if (!number) continue;
      const ids = candidateIdsByNumberBranch.get(candidateKey(number, row.branch)) ?? [];
      if (ids.length !== 1) continue;
      resolvedId = ids[0];
    }
    const productName = clean(row.product_name);
    if (!productName) continue;
    const bucket = itemsByInvoiceId.get(resolvedId) ?? [];
    const meta = row.raw_data?.__dawaa_commercial ?? {};
    bucket.push({
      productNameRaw: productName,
      productId: clean(row.product_id) || null,
      productCode: clean(row.product_code) || null,
      quantity: numberOrNull(meta.effective_quantity) ?? (() => {
        const quantity = numberOrNull(row.quantity);
        const returned = numberOrNull(meta.returned_quantity) ?? 0;
        return quantity == null ? null : Math.max(0, quantity - Math.max(0, returned));
      })(),
      unitName: clean(meta.unit_name) || null,
      expiryRaw: clean(meta.expiry_raw) || null,
      returnedQuantity: numberOrNull(meta.returned_quantity),
      unitPrice: numberOrNull(row.unit_price),
      itemDiscountAmount: numberOrNull(meta.item_discount_amount),
      itemDiscountPercent: numberOrNull(meta.item_discount_percent),
      grossLineAmount: numberOrNull(meta.gross_line_amount),
      netLineAmount: numberOrNull(meta.net_line_amount) ?? numberOrNull(row.line_total),
      lineTotal: numberOrNull(row.line_total)
    });
    itemsByInvoiceId.set(resolvedId, bucket);
  }
  return {
    getItemsForInvoice(id) {
      const rows = itemsByInvoiceId.get(clean(id));
      return rows && rows.length ? aggregateInvoiceItems(rows) : "unavailable";
    }
  };
}
async function fetchInvoiceItemEvidenceProvider(supabaseClient, invoiceRows) {
  const uniqueInvoices = /* @__PURE__ */ new Map();
  for (const row of invoiceRows) {
    const id = invoiceId(row);
    if (id) uniqueInvoices.set(id, row);
  }
  const candidates = Array.from(uniqueInvoices.values());
  if (!candidates.length) return buildInvoiceItemEvidenceProvider([], []);
  const ids = Array.from(new Set(candidates.map(invoiceId).filter(Boolean)));
  const numbers = Array.from(new Set(candidates.map(invoiceNumber).filter(Boolean)));
  const itemMap = /* @__PURE__ */ new Map();
  for (const group of chunks(ids, 100)) {
    const { data, error } = await supabaseClient.from("sales_invoice_items_v21").select("id,invoice_id,invoice_number,branch,product_id,product_code,product_name,quantity,unit_price,line_total,raw_data").in("invoice_id", group).limit(5e3);
    if (error) throw error;
    for (const row of data ?? []) itemMap.set(String(row.id), row);
  }
  for (const group of chunks(numbers, 100)) {
    const { data, error } = await supabaseClient.from("sales_invoice_items_v21").select("id,invoice_id,invoice_number,branch,product_id,product_code,product_name,quantity,unit_price,line_total,raw_data").in("invoice_number", group).limit(5e3);
    if (error) throw error;
    for (const row of data ?? []) itemMap.set(String(row.id), row);
  }
  return buildInvoiceItemEvidenceProvider(candidates, Array.from(itemMap.values()));
}
function snapshotInvoiceItemEvidence(provider, invoiceIds) {
  return Array.from(new Set(invoiceIds.filter(Boolean))).sort().map((invoiceId2) => {
    const items = provider.getItemsForInvoice(invoiceId2, null);
    if (items === "unavailable") return { invoiceId: invoiceId2, items: "unavailable" };
    const normalized = [...items].map((item) => ({
      productNameRaw: item.productNameRaw,
      productId: item.productId ?? null,
      productCode: item.productCode ?? null,
      quantity: item.quantity,
      unitName: item.unitName ?? null,
      expiryRaw: item.expiryRaw ?? null,
      returnedQuantity: item.returnedQuantity ?? null,
      unitPrice: item.unitPrice ?? null,
      itemDiscountAmount: item.itemDiscountAmount ?? null,
      itemDiscountPercent: item.itemDiscountPercent ?? null,
      grossLineAmount: item.grossLineAmount ?? null,
      netLineAmount: item.netLineAmount ?? null,
      lineTotal: item.lineTotal
    })).sort(
      (a, b) => String(a.productId ?? a.productCode ?? a.productNameRaw).localeCompare(
        String(b.productId ?? b.productCode ?? b.productNameRaw)
      )
    );
    return { invoiceId: invoiceId2, items: normalized };
  });
}

// src/lib/salesIntelligence/pharmacyProducts/canonicalProduct.ts
var ARABIC_CHAR_RX = /[ء-ي]/;
var LATIN_CHAR_RX = /[A-Za-z]/;
function splitScriptName(name) {
  const hasArabic = ARABIC_CHAR_RX.test(name);
  const hasLatin = LATIN_CHAR_RX.test(name);
  if (hasArabic && !hasLatin) return { arabicName: name, englishName: null };
  if (hasLatin && !hasArabic) return { arabicName: null, englishName: name };
  return { arabicName: null, englishName: null };
}
function buildCanonicalProduct(row, normalizedNameCounts, normalizeFn) {
  const { arabicName, englishName } = splitScriptName(row.name);
  const normalizedFromName = normalizeFn(row.name);
  const normalizedFromColumn = normalizeFn(row.normalized_name);
  const normalizedNames = Array.from(new Set([normalizedFromName.normalized, normalizedFromColumn.normalized].filter(Boolean)));
  const price = row.price === null ? null : Number(row.price);
  const collisionCount = normalizedNameCounts.get(normalizedFromColumn.normalized) ?? 1;
  return {
    productId: row.id,
    productCode: row.product_code,
    barcode: null,
    canonicalName: row.name,
    arabicName,
    englishName,
    normalizedNames,
    strengths: normalizedFromName.strengths,
    dosageForms: normalizedFromName.dosageForms,
    packSizes: normalizedFromName.packSizes,
    category: row.category,
    manufacturer: null,
    price: price !== null && Number.isFinite(price) ? price : null,
    sourceTable: row.source,
    qualityFlags: {
      hasNormalizedNameCollision: collisionCount > 1,
      missingStrength: normalizedFromName.strengths.length === 0,
      missingDosageForm: normalizedFromName.dosageForms.length === 0,
      missingAnyQuantitySignal: !/[0-9]/.test(normalizedFromName.normalized)
    }
  };
}
function countNormalizedNames(rows) {
  const counts = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const key = row.normalized_name.trim().toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

// src/lib/salesIntelligence/pharmacyProductCatalogRepository.ts
var catalogCache = /* @__PURE__ */ new WeakMap();
async function fetchAllProductRows(supabaseClient) {
  const rows = [];
  const pageSize = 1e3;
  let from = 0;
  for (; ; ) {
    const { data, error } = await supabaseClient.from("products").select("id,name,product_code,normalized_name,category,price,source").order("id", { ascending: true }).range(from, from + pageSize - 1);
    if (error) throw error;
    const page = (data ?? []).filter((row) => row?.id && row?.name && row?.product_code).map((row) => ({
      id: String(row.id),
      name: String(row.name),
      product_code: String(row.product_code),
      normalized_name: String(row.normalized_name ?? row.name),
      category: row.category == null ? null : String(row.category),
      price: row.price,
      source: String(row.source ?? "products")
    }));
    rows.push(...page);
    if ((data ?? []).length < pageSize) break;
    from += pageSize;
  }
  return rows;
}
async function fetchPharmacyProductIndex(supabaseClient, options = {}) {
  if (!options.forceRefresh && supabaseClient && typeof supabaseClient === "object" && catalogCache.has(supabaseClient)) {
    return catalogCache.get(supabaseClient);
  }
  const promise = (async () => {
    const rows = await fetchAllProductRows(supabaseClient);
    const counts = countNormalizedNames(rows);
    const catalog = rows.map(
      (row) => buildCanonicalProduct(row, counts, normalizePharmacyText)
    );
    return buildPharmacyProductIndex(catalog);
  })();
  if (supabaseClient && typeof supabaseClient === "object") {
    catalogCache.set(supabaseClient, promise);
  }
  try {
    return await promise;
  } catch (error) {
    if (supabaseClient && typeof supabaseClient === "object") {
      catalogCache.delete(supabaseClient);
    }
    throw error;
  }
}

// src/lib/customers/canonicalCustomerIdentityResolver.ts
var EVIDENCE_CONFIDENCE = {
  customer_id: 1,
  customer_code: 0.99,
  contact_phone: 0.97,
  mentioned_phone: 0.9,
  historical_link: 0.95
};
function uniq(values) {
  return Array.from(new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean)));
}
function validPhones(values) {
  return uniq(values.map((value) => normalizeEgyptianCustomerPhone(value))).filter(
    (phone) => isValidEgyptianCustomerMobile(phone)
  );
}
function canonicalId(id, candidates) {
  const row = candidates.byId.get(id);
  const alias = candidates.aliasToCanonical.get(id);
  if (alias) return alias;
  if (!row || row.isDuplicate) return null;
  return row.id;
}
function matchIds(kind, value, rows, candidates) {
  const ids = uniq(rows.map((row) => canonicalId(row.id, candidates)));
  return {
    kind,
    value,
    customerIds: ids,
    result: ids.length === 1 ? "match" : ids.length > 1 ? "ambiguous" : "none"
  };
}
function resolveCanonicalCustomerIdentity(evidence, candidates) {
  const rows = [...candidates.byId.values()];
  const results = [];
  if (evidence.customerId && isCustomerIdentityUuid(evidence.customerId)) {
    results.push(
      matchIds(
        "customer_id",
        evidence.customerId,
        rows.filter((row) => row.id === evidence.customerId),
        candidates
      )
    );
  }
  const codes = uniq(evidence.customerCodes.map((code) => normalizeDawaaCustomerCode(code)));
  for (const code of codes) {
    results.push(
      matchIds(
        "customer_code",
        code,
        rows.filter((row) => row.customerCode === code),
        candidates
      )
    );
  }
  const phoneKind = evidence.contactPhones.length ? "contact_phone" : "mentioned_phone";
  const phones = evidence.contactPhones.length ? evidence.contactPhones : evidence.mentionedPhones;
  for (const phone of phones) {
    results.push(
      matchIds(
        phoneKind,
        phone,
        rows.filter((row) => row.phones.includes(phone)),
        candidates
      )
    );
  }
  if (evidence.trustedHistoricalCustomerId && isCustomerIdentityUuid(evidence.trustedHistoricalCustomerId)) {
    results.push(
      matchIds(
        "historical_link",
        evidence.trustedHistoricalCustomerId,
        rows.filter((row) => row.id === evidence.trustedHistoricalCustomerId),
        candidates
      )
    );
  }
  const contactPhone = evidence.contactPhones[0] ?? null;
  const unresolvedBase = (status, reason, candidateIds) => ({
    status,
    customerId: null,
    customerCode: codes.length === 1 ? codes[0] : null,
    normalizedPhone: contactPhone,
    customerName: evidence.displayName ?? null,
    branch: null,
    resolvedBy: null,
    reason,
    confidence: 0,
    evidence: results,
    candidates: candidateIds.map((id) => {
      const row = candidates.byId.get(id);
      return { id, customerCode: row?.customerCode ?? null, name: row?.name ?? null };
    })
  });
  if (codes.length > 1) {
    return unresolvedBase(
      "contradicted",
      `customer_code_conflict:${codes.join("|")}`,
      uniq(results.flatMap((r) => r.customerIds))
    );
  }
  const matched = results.filter((row) => row.result === "match");
  const matchedIds = uniq(matched.flatMap((row) => row.customerIds));
  if (matchedIds.length > 1) {
    return unresolvedBase(
      "contradicted",
      `identity_evidence_conflict:${matched.map((row) => `${row.kind}=${row.customerIds[0]}`).join("|")}`,
      matchedIds
    );
  }
  if (matchedIds.length === 1) {
    const id = matchedIds[0];
    const conflicting = results.find(
      (row2) => row2.result === "ambiguous" && !row2.customerIds.includes(id)
    );
    if (conflicting) {
      return unresolvedBase(
        "contradicted",
        `${conflicting.kind}_points_to_other_customers:${conflicting.value}`,
        uniq([id, ...conflicting.customerIds])
      );
    }
    const by = matched[0];
    const row = candidates.byId.get(id);
    return {
      status: "resolved",
      customerId: id,
      customerCode: row?.customerCode ?? (codes[0] || null),
      normalizedPhone: row?.phones[0] ?? contactPhone,
      customerName: row?.name ?? evidence.displayName ?? null,
      branch: row?.branch ?? null,
      resolvedBy: by.kind,
      reason: `unique_${by.kind}_match`,
      confidence: EVIDENCE_CONFIDENCE[by.kind],
      evidence: results,
      candidates: [{ id, customerCode: row?.customerCode ?? null, name: row?.name ?? null }]
    };
  }
  const ambiguous = results.filter((row) => row.result === "ambiguous");
  if (ambiguous.length) {
    return unresolvedBase(
      "ambiguous",
      `identity_ambiguous:${ambiguous.map((row) => `${row.kind}=${row.value}`).join("|")}`,
      uniq(ambiguous.flatMap((row) => row.customerIds))
    );
  }
  return unresolvedBase(
    "unresolved",
    results.length ? "no_matching_customer" : "no_identity_evidence",
    []
  );
}
var CHUNK = 40;
var CUSTOMER_COLUMNS = "id,customer_code,effective_customer_code,code,name,display_name,customer_name,branch,effective_branch,is_duplicate,normalized_phone,phone,customer_phone,mobile,whatsapp_phone,whatsapp,phone_alt";
function toCandidate(row) {
  return {
    id: String(row.id),
    customerCode: normalizeDawaaCustomerCode(row.effective_customer_code) || normalizeDawaaCustomerCode(row.customer_code) || normalizeDawaaCustomerCode(row.code) || null,
    phones: validPhones([
      row.normalized_phone,
      row.phone,
      row.customer_phone,
      row.mobile,
      row.whatsapp_phone,
      row.whatsapp,
      row.phone_alt
    ]),
    name: String(row.display_name || row.name || row.customer_name || "").trim() || null,
    branch: String(row.effective_branch || row.branch || "").trim() || null,
    isDuplicate: Boolean(row.is_duplicate)
  };
}
function chunks2(values) {
  const out = [];
  for (let index = 0; index < values.length; index += CHUNK)
    out.push(values.slice(index, index + CHUNK));
  return out;
}
async function loadCustomerIdentityCandidates(client, evidences) {
  const ids = uniq(
    evidences.flatMap((e) => [e.customerId, e.trustedHistoricalCustomerId]).filter((id) => isCustomerIdentityUuid(id))
  );
  const codes = uniq(
    evidences.flatMap((e) => e.customerCodes.map((code) => normalizeDawaaCustomerCode(code)))
  );
  const phones = uniq(evidences.flatMap((e) => [...e.contactPhones, ...e.mentionedPhones]));
  const byId = /* @__PURE__ */ new Map();
  const add = (rows) => {
    for (const row of rows || []) byId.set(String(row.id), toCandidate(row));
  };
  const run = async (label, query) => {
    const { data, error } = await query;
    if (error) throw new Error(`customer_identity_${label}_lookup_failed: ${error.message}`);
    add(data);
  };
  for (const chunk of chunks2(ids)) {
    await run("id", client.from("customers").select(CUSTOMER_COLUMNS).in("id", chunk));
  }
  for (const chunk of chunks2(codes)) {
    const list = chunk.join(",");
    await run(
      "code",
      client.from("customers").select(CUSTOMER_COLUMNS).or(`effective_customer_code.in.(${list}),customer_code.in.(${list}),code.in.(${list})`).limit(500)
    );
  }
  for (const chunk of chunks2(phones)) {
    const list = chunk.join(",");
    await run(
      "phone",
      client.from("customers").select(CUSTOMER_COLUMNS).or(
        [
          "normalized_phone",
          "phone",
          "customer_phone",
          "mobile",
          "whatsapp_phone",
          "whatsapp",
          "phone_alt"
        ].map((column) => `${column}.in.(${list})`).join(",")
      ).limit(500)
    );
  }
  const aliasToCanonical = /* @__PURE__ */ new Map();
  const duplicateIds = [...byId.values()].filter((row) => row.isDuplicate).map((row) => row.id);
  for (const chunk of chunks2(duplicateIds)) {
    const { data, error } = await client.from("customer_aliases").select("alias_customer_id,canonical_customer_id").in("alias_customer_id", chunk);
    if (error) throw new Error(`customer_identity_alias_lookup_failed: ${error.message}`);
    for (const row of data || []) {
      if (row.alias_customer_id && row.canonical_customer_id) {
        aliasToCanonical.set(String(row.alias_customer_id), String(row.canonical_customer_id));
      }
    }
  }
  const missingCanonical = uniq([...aliasToCanonical.values()]).filter((id) => !byId.has(id));
  for (const chunk of chunks2(missingCanonical)) {
    await run("alias_canonical", client.from("customers").select(CUSTOMER_COLUMNS).in("id", chunk));
  }
  return { byId, aliasToCanonical };
}
async function resolveCanonicalCustomerIdentities(client, evidences) {
  const candidates = await loadCustomerIdentityCandidates(client, evidences);
  return evidences.map((evidence) => resolveCanonicalCustomerIdentity(evidence, candidates));
}

// src/lib/salesIntelligence/persistence/batchPersistenceService.ts
function canonicalCustomerKey(conversationCase) {
  if (conversationCase.customerId) return { key: `id:${conversationCase.customerId}`, customerId: conversationCase.customerId, phone: null };
  const normalized = conversationCase.customerPhone ? normalizeEgyptianCustomerPhone(conversationCase.customerPhone) : "";
  if (isValidEgyptianCustomerMobile(normalized)) return { key: `phone:${normalized}`, customerId: null, phone: normalized };
  return { key: null, customerId: null, phone: null };
}
function groupCasesByCustomer(segmented) {
  const groups = /* @__PURE__ */ new Map();
  let ungroupedCounter = 0;
  for (const entry of segmented) {
    const { key, customerId, phone } = canonicalCustomerKey(entry.conversationCase);
    const effectiveKey = key ?? `case:${entry.conversationCase.caseId}:${ungroupedCounter++}`;
    let group = groups.get(effectiveKey);
    if (!group) {
      group = { key: effectiveKey, customerId, customerPhoneNormalized: phone, cases: [] };
      groups.set(effectiveKey, group);
    }
    group.cases.push(entry);
  }
  return Array.from(groups.values());
}
function groupTimeWindow(group) {
  let minStart = Infinity;
  let maxEnd = -Infinity;
  for (const { conversationCase } of group.cases) {
    const startMs = new Date(conversationCase.startedAt).getTime();
    const endMsRaw = conversationCase.endedAt ? new Date(conversationCase.endedAt).getTime() : NaN;
    const endMs = Number.isFinite(endMsRaw) ? Math.max(endMsRaw, startMs) : startMs;
    minStart = Math.min(minStart, startMs);
    maxEnd = Math.max(maxEnd, endMs);
  }
  const windowStart = new Date(minStart - CANDIDATE_RETRIEVAL_TIME_WINDOW.beforeCaseStartHours * 36e5);
  const windowEnd = new Date(maxEnd + CANDIDATE_RETRIEVAL_TIME_WINDOW.afterCaseEndHours * 36e5);
  return { windowStartIso: windowStart.toISOString(), windowEndIso: windowEnd.toISOString() };
}
async function fetchCandidatesForGroup(supabaseClient, group) {
  if (!group.customerId && !group.customerPhoneNormalized) return [];
  const { windowStartIso, windowEndIso } = groupTimeWindow(group);
  const query = {
    caseId: group.key,
    customerId: group.customerId,
    customerPhoneNormalized: group.customerPhoneNormalized,
    branchNameRaw: null,
    windowStartIso,
    windowEndIso,
    limit: CANDIDATE_RETRIEVAL_MAX_ROWS
  };
  return fetchInvoiceCandidates(supabaseClient, query);
}
function filterCandidatesToCaseWindow(candidates, context) {
  const { windowStartIso, windowEndIso } = buildInvoiceCandidateQuery(context);
  const windowStartMs = new Date(windowStartIso).getTime();
  const windowEndMs = new Date(windowEndIso).getTime();
  return candidates.filter((row) => {
    const iso = parseInvoiceDateTime(row.invoice_datetime);
    if (!iso) return false;
    const ms = new Date(iso).getTime();
    return ms >= windowStartMs && ms <= windowEndMs;
  });
}
async function planCase(supabaseClient, caseId) {
  const { data, error } = await supabaseClient.from("sales_intelligence_cases").select("case_id, conversation_id, source_case_id_v22, customer_id, customer_phone, branch_id, branch_name_raw").eq("case_id", caseId).maybeSingle();
  if (error) throw error;
  return { exists: Boolean(data), identityChanged: !data, existingRow: data ?? null };
}
async function planAnalysis(supabaseClient, caseId, semanticSourceHash) {
  const { data, error } = await supabaseClient.from("sales_intelligence_case_analyses").select(
    "analysis_id, analysis_version, semantic_source_hash, pipeline_version, engine_version_case_segmentation, engine_version_historical_closure, engine_version_commercial_confirmation, engine_version_protocol_applicability"
  ).eq("case_id", caseId).eq("is_current", true).maybeSingle();
  if (error) throw error;
  const isNoOp = Boolean(data) && data.semantic_source_hash === semanticSourceHash && data.engine_version_case_segmentation === ENGINE_VERSIONS.caseSegmentation && data.engine_version_historical_closure === ENGINE_VERSIONS.historicalClosure && data.engine_version_commercial_confirmation === ENGINE_VERSIONS.commercialConfirmation && data.engine_version_protocol_applicability === ENGINE_VERSIONS.protocolApplicability;
  return {
    caseId,
    semanticSourceHash,
    currentAnalysisId: data?.analysis_id ?? null,
    currentAnalysisVersion: data?.analysis_version ?? null,
    nextAnalysisVersion: isNoOp ? data.analysis_version : (data?.analysis_version ?? 0) + 1,
    isNoOp
  };
}
async function resolveConversationCustomerIdentities(supabaseClient, conversations) {
  const evidences = conversations.map((conversation) => {
    const phone = normalizeEgyptianCustomerPhone(conversation.customerPhoneHint ?? "");
    const code = normalizeDawaaCustomerCode(conversation.customerCodeHint);
    return {
      customerId: conversation.customerIdHint ?? null,
      customerCodes: code ? [code] : [],
      contactPhones: isValidEgyptianCustomerMobile(phone) ? [phone] : [],
      mentionedPhones: [],
      displayName: conversation.customerNameHint ?? null
    };
  });
  const identities = await resolveCanonicalCustomerIdentities(supabaseClient, evidences);
  return conversations.map((conversation, index) => {
    const identity = identities[index];
    const resolved = identity.status === "resolved";
    return {
      ...conversation,
      customerIdHint: resolved ? identity.customerId : null,
      customerPhoneHint: resolved ? identity.normalizedPhone ?? conversation.customerPhoneHint ?? null : conversation.customerPhoneHint ?? null,
      customerIdentityStatus: identity.status
    };
  });
}
async function runBatchPersistence(supabaseClient, input) {
  const pureComputeStart = Date.now();
  const effectiveConversations = await resolveConversationCustomerIdentities(supabaseClient, input.conversations);
  const segmented = [];
  let previousTheoreticalFetchCount = 0;
  for (const conversation of effectiveConversations) {
    const result = deriveCasesOnly({
      conversationId: conversation.conversationId,
      rawWhatsAppExportText: conversation.rawWhatsAppExportText,
      trustedConversationStartedAt: conversation.trustedConversationStartedAt ?? null,
      sourceCaseIdV22: conversation.sourceCaseIdV22,
      customerIdHint: conversation.customerIdHint,
      customerPhoneHint: conversation.customerPhoneHint,
      branchIdHint: conversation.branchIdHint,
      branchNameRawHint: conversation.branchNameRawHint,
      sessionSplitGapMinutes: conversation.sessionSplitGapMinutes
    });
    for (const conversationCase of result.cases) {
      segmented.push({ conversationCase, conversation });
      previousTheoreticalFetchCount += 1;
    }
  }
  const groups = groupCasesByCustomer(segmented);
  const candidatesByGroupKey = /* @__PURE__ */ new Map();
  for (const group of groups) {
    candidatesByGroupKey.set(group.key, await fetchCandidatesForGroup(supabaseClient, group));
  }
  const candidateInvoiceFetches = groups.length;
  const candidateInvoicesEvaluated = Array.from(candidatesByGroupKey.values()).reduce((sum, rows) => sum + rows.length, 0);
  const allCandidateInvoices = Array.from(candidatesByGroupKey.values()).flat();
  const itemEvidenceProvider = await fetchInvoiceItemEvidenceProvider(supabaseClient, allCandidateInvoices);
  const productIndex = await fetchPharmacyProductIndex(supabaseClient);
  const pass1ByConversation = /* @__PURE__ */ new Map();
  const groupKeyByCaseId = /* @__PURE__ */ new Map();
  for (const group of groups) {
    for (const { conversationCase } of group.cases) groupKeyByCaseId.set(conversationCase.caseId, group.key);
  }
  const conversationToGroupCandidates = (_conversation, context) => {
    const groupKey = groupKeyByCaseId.get(context.caseId);
    const groupCandidates = groupKey ? candidatesByGroupKey.get(groupKey) ?? [] : [];
    return filterCandidatesToCaseWindow(groupCandidates, context);
  };
  for (const conversation of effectiveConversations) {
    const pipelineInput = {
      conversationId: conversation.conversationId,
      rawWhatsAppExportText: conversation.rawWhatsAppExportText,
      trustedConversationStartedAt: conversation.trustedConversationStartedAt ?? null,
      sourceCaseIdV22: conversation.sourceCaseIdV22,
      customerIdHint: conversation.customerIdHint,
      customerPhoneHint: conversation.customerPhoneHint,
      customerIdentityStatus: conversation.customerIdentityStatus,
      branchIdHint: conversation.branchIdHint,
      branchNameRawHint: conversation.branchNameRawHint,
      knownStaffIds: conversation.knownStaffIds,
      legacyMatchedInvoiceId: conversation.legacyMatchedInvoiceId,
      legacyMatchedInvoiceNumber: conversation.legacyMatchedInvoiceNumber,
      trustedInvoiceId: conversation.trustedInvoiceId,
      trustedInvoiceNumber: conversation.trustedInvoiceNumber,
      invoiceCancelledOrReturned: conversation.invoiceCancelledOrReturned,
      invoiceStatusHint: conversation.invoiceStatusHint,
      sessionSplitGapMinutes: conversation.sessionSplitGapMinutes,
      protocolPolicyEffectiveAt: conversation.protocolPolicyEffectiveAt,
      competingSelections: [],
      resolveInvoiceCandidates: (context) => conversationToGroupCandidates(conversation, context),
      itemEvidenceProvider,
      productIndex
    };
    const result = runSalesIntelligencePipeline(pipelineInput);
    pass1ByConversation.set(conversation.conversationId, result.caseAnalyses);
  }
  const deniedInvoiceIdsByCase = /* @__PURE__ */ new Map();
  const resolvedInvoiceIds = /* @__PURE__ */ new Set();
  let invoiceResolutionIterations = 0;
  let workingAnalyses = Array.from(pass1ByConversation.values()).flat();
  const rerunForResolution = (competingSelections2 = []) => {
    const analyses = [];
    for (const conversation of effectiveConversations) {
      const pipelineInput = {
        conversationId: conversation.conversationId,
        rawWhatsAppExportText: conversation.rawWhatsAppExportText,
        trustedConversationStartedAt: conversation.trustedConversationStartedAt ?? null,
        sourceCaseIdV22: conversation.sourceCaseIdV22,
        customerIdHint: conversation.customerIdHint,
        customerPhoneHint: conversation.customerPhoneHint,
        customerIdentityStatus: conversation.customerIdentityStatus,
        branchIdHint: conversation.branchIdHint,
        branchNameRawHint: conversation.branchNameRawHint,
        knownStaffIds: conversation.knownStaffIds,
        legacyMatchedInvoiceId: conversation.legacyMatchedInvoiceId,
        legacyMatchedInvoiceNumber: conversation.legacyMatchedInvoiceNumber,
        trustedInvoiceId: conversation.trustedInvoiceId,
        trustedInvoiceNumber: conversation.trustedInvoiceNumber,
        invoiceCancelledOrReturned: conversation.invoiceCancelledOrReturned,
        invoiceStatusHint: conversation.invoiceStatusHint,
        sessionSplitGapMinutes: conversation.sessionSplitGapMinutes,
        protocolPolicyEffectiveAt: conversation.protocolPolicyEffectiveAt,
        competingSelections: competingSelections2,
        resolveInvoiceCandidates: (context) => {
          const denied = deniedInvoiceIdsByCase.get(context.caseId);
          const rows = conversationToGroupCandidates(conversation, context);
          return denied?.size ? rows.filter((row) => !denied.has(invoiceRowLookupId2(row))) : rows;
        },
        itemEvidenceProvider,
        productIndex
      };
      analyses.push(...runSalesIntelligencePipeline(pipelineInput).caseAnalyses);
    }
    return analyses;
  };
  for (let iteration = 0; iteration < 5; iteration += 1) {
    const resolution = resolveExclusiveInvoiceClaims(workingAnalyses);
    for (const winner of resolution.resolvedWinners) resolvedInvoiceIds.add(winner.invoiceId);
    const addedDenials = mergeDeniedInvoiceMaps(deniedInvoiceIdsByCase, resolution.deniedInvoiceIdsByCase);
    if (addedDenials === 0) break;
    invoiceResolutionIterations += 1;
    workingAnalyses = rerunForResolution([]);
  }
  const finalResolution = resolveExclusiveInvoiceClaims(workingAnalyses);
  const competingSelections = finalResolution.unresolvedCompetingSelections;
  const caseAnalyses = rerunForResolution(competingSelections);
  const purePipelineComputeMs = Date.now() - pureComputeStart;
  const planningStart = Date.now();
  const plan = {
    casesToInsert: [],
    casesToUpdateCanonicalIdentity: [],
    casesUnchanged: [],
    analysesToInsert: [],
    analysesNoOp: [],
    analysesToSupersede: [],
    policyEvaluationsToInsert: [],
    policyEvaluationsNoOp: [],
    policyEvaluationsSkippedNoConfig: [],
    attributionsToInsert: [],
    attributionsNoOp: [],
    matchesToInsert: [],
    matchesNoOp: [],
    conflicts: [],
    warnings: []
  };
  const caseOutcomes = [];
  const currentPolicyConfig = await fetchCurrentPolicyConfig(supabaseClient);
  if (!currentPolicyConfig) {
    plan.warnings.push({
      caseId: null,
      kind: "no_current_policy_config",
      detail: "No current sales_intelligence_policy_config row exists \u2014 every case will skip policy-evaluation persistence (see policyEvaluationWriter.ts)."
    });
  }
  for (const analysis of caseAnalyses) {
    const conversationCase = analysis.conversationCase;
    const groupKey = groupKeyByCaseId.get(analysis.caseId) ?? null;
    const conversationInput = effectiveConversations.find((c) => c.conversationId === analysis.conversationId);
    const conversationRowId = conversationInput?.conversationId ?? analysis.conversationId;
    const caseContent = mapCaseRowContent(analysis, conversationRowId);
    const caseAnalysisContent = mapCaseAnalysisRowContent(analysis);
    const semanticSourceHash = await computeSemanticSourceHash({
      rawWhatsAppExportText: conversationInput?.rawWhatsAppExportText ?? "",
      trustedConversationStartedAt: conversationInput?.trustedConversationStartedAt ?? null,
      branchIdentityMappingVersion: BRANCH_IDENTITY_MAPPING_VERSION
    });
    const casePlan = await planCase(supabaseClient, analysis.caseId);
    const planCaseEntry = { caseId: analysis.caseId, conversationId: analysis.conversationId, customerGroupKey: groupKey };
    if (!casePlan.exists) plan.casesToInsert.push(planCaseEntry);
    else if (casePlan.identityChanged) plan.casesToUpdateCanonicalIdentity.push(planCaseEntry);
    else plan.casesUnchanged.push(planCaseEntry);
    const analysisPlan = await planAnalysis(supabaseClient, analysis.caseId, semanticSourceHash);
    const planAnalysisEntry = {
      caseId: analysis.caseId,
      semanticSourceHash,
      currentAnalysisId: analysisPlan.currentAnalysisId,
      currentAnalysisVersion: analysisPlan.currentAnalysisVersion,
      nextAnalysisVersion: analysisPlan.nextAnalysisVersion
    };
    if (analysisPlan.isNoOp) plan.analysesNoOp.push(planAnalysisEntry);
    else {
      plan.analysesToInsert.push(planAnalysisEntry);
      if (analysisPlan.currentAnalysisId) plan.analysesToSupersede.push(planAnalysisEntry);
    }
    const effectiveAnalysisId = analysisPlan.currentAnalysisId;
    const activeItems = analysis.activeBasket ? analysis.itemsByBasketId[analysis.activeBasket.basketId] ?? [] : [];
    const attributionItemSnapshot = snapshotInvoiceItemEvidence(
      itemEvidenceProvider,
      analysis.invoiceCandidateIds
    );
    const attributionInputHash = await computeAttributionInputHash({
      customerId: conversationCase.customerId,
      customerPhone: conversationCase.customerPhone,
      candidateInvoiceIds: analysis.invoiceCandidateIds,
      branchNameRaw: conversationCase.branchNameRaw,
      activeBasketItems: activeItems.map((item) => ({
        productNameRaw: item.productNameRaw,
        productId: item.productId,
        quantity: item.quantity
      })),
      invoiceItemEvidenceSnapshot: attributionItemSnapshot
    });
    let currentAttributionRowId = null;
    if (effectiveAnalysisId) {
      const { data } = await supabaseClient.from("sales_intelligence_attributions").select("id, attribution_input_hash, attribution_engine_version").eq("analysis_id", effectiveAnalysisId).eq("is_current_evaluation", true).maybeSingle();
      if (data && data.attribution_input_hash === attributionInputHash && data.attribution_engine_version === ENGINE_VERSIONS.attribution) {
        currentAttributionRowId = data.id;
      }
    }
    const planAttributionEntry = {
      caseId: analysis.caseId,
      analysisId: effectiveAnalysisId,
      attributionInputHash,
      currentAttributionRowId,
      competingCaseIds: analysis.attribution.competingCaseIds
    };
    if (currentAttributionRowId) plan.attributionsNoOp.push(planAttributionEntry);
    else plan.attributionsToInsert.push(planAttributionEntry);
    const selectedInvoiceItemSnapshot = analysis.basketInvoiceMatch.invoiceId ? snapshotInvoiceItemEvidence(itemEvidenceProvider, [analysis.basketInvoiceMatch.invoiceId]) : [];
    const matchingInputHash = await computeMatchingInputHash({
      basketId: analysis.basketInvoiceMatch.basketId,
      basketVersion: analysis.basketInvoiceMatch.basketVersion,
      activeItems: activeItems.map((item) => ({
        productNameRaw: item.productNameRaw,
        productId: item.productId,
        quantity: item.quantity
      })),
      selectedInvoiceId: analysis.basketInvoiceMatch.invoiceId,
      selectedInvoiceNumber: analysis.basketInvoiceMatch.invoiceNumber,
      matchingEngineVersion: ENGINE_VERSIONS.matching,
      invoiceItemEvidenceSnapshot: selectedInvoiceItemSnapshot
    });
    let currentMatchRowId = null;
    if (effectiveAnalysisId) {
      const { data } = await supabaseClient.from("sales_intelligence_basket_invoice_matches").select("id, matching_input_hash, matching_engine_version").eq("analysis_id", effectiveAnalysisId).eq("is_current_evaluation", true).maybeSingle();
      if (data && data.matching_input_hash === matchingInputHash && data.matching_engine_version === ENGINE_VERSIONS.matching) {
        currentMatchRowId = data.id;
      }
    }
    const planMatchEntry = { caseId: analysis.caseId, analysisId: effectiveAnalysisId, matchingInputHash, currentMatchRowId };
    if (currentMatchRowId) plan.matchesNoOp.push(planMatchEntry);
    else plan.matchesToInsert.push(planMatchEntry);
    if (!currentPolicyConfig) {
      plan.policyEvaluationsSkippedNoConfig.push({ caseId: analysis.caseId, analysisId: effectiveAnalysisId, policyInputHash: null, currentPolicyEvaluationId: null });
    } else {
      const policyContent = mapPolicyEvaluationRowContent(analysis, currentPolicyConfig.protocolPolicyEffectiveAt);
      const policyInputHash = await computePolicyInputHash({
        protocolApplicability: policyContent.protocolApplicability,
        caseEndedAt: conversationCase.endedAt,
        policyConfigId: currentPolicyConfig.policyConfigId
      });
      let currentPolicyEvaluationId = null;
      if (effectiveAnalysisId) {
        const { data } = await supabaseClient.from("sales_intelligence_policy_evaluations").select("policy_evaluation_id, policy_input_hash, policy_config_id").eq("analysis_id", effectiveAnalysisId).eq("is_current", true).maybeSingle();
        if (data && data.policy_input_hash === policyInputHash && data.policy_config_id === currentPolicyConfig.policyConfigId) {
          currentPolicyEvaluationId = data.policy_evaluation_id;
        }
      }
      const planPolicyEvaluationEntry = {
        caseId: analysis.caseId,
        analysisId: effectiveAnalysisId,
        policyInputHash,
        currentPolicyEvaluationId
      };
      if (currentPolicyEvaluationId) plan.policyEvaluationsNoOp.push(planPolicyEvaluationEntry);
      else plan.policyEvaluationsToInsert.push(planPolicyEvaluationEntry);
    }
    if (analysis.attribution.contradictions.includes("ambiguous_multiple_candidates")) {
      plan.conflicts.push({ caseId: analysis.caseId, kind: "ambiguous_attribution", detail: "Multiple invoice candidates scored ambiguously \u2014 see attribution.contradictions." });
    }
    if (analysis.attribution.competingCaseIds.length > 0) {
      plan.conflicts.push({
        caseId: analysis.caseId,
        kind: "competing_case_attribution",
        detail: `Competing with case(s): ${analysis.attribution.competingCaseIds.join(", ")}`
      });
    }
    for (const warning of analysis.pipelineWarnings) {
      plan.warnings.push({ caseId: analysis.caseId, kind: "pipeline_warning", detail: warning });
    }
    if (!input.dryRun) {
      const outcome = {
        caseId: analysis.caseId,
        success: false,
        error: null,
        caseUpsert: null,
        analysis: null,
        policyEvaluation: null,
        attribution: null,
        match: null
      };
      try {
        outcome.caseUpsert = await upsertSalesIntelligenceCase(supabaseClient, analysis.caseId, caseContent);
        outcome.analysis = await persistCaseAnalysis(
          supabaseClient,
          analysis.caseId,
          conversationInput?.rawWhatsAppExportText ?? "",
          caseAnalysisContent,
          conversationInput?.trustedConversationStartedAt ?? null
        );
        outcome.attribution = await persistAttribution(
          supabaseClient,
          outcome.analysis.analysisId,
          analysis.caseId,
          {
            customerId: conversationCase.customerId,
            customerPhone: conversationCase.customerPhone,
            candidateInvoiceIds: analysis.invoiceCandidateIds,
            branchNameRaw: conversationCase.branchNameRaw,
            activeBasketItems: activeItems.map((item) => ({
              productNameRaw: item.productNameRaw,
              productId: item.productId,
              quantity: item.quantity
            })),
            invoiceItemEvidenceSnapshot: attributionItemSnapshot
          },
          mapAttributionRowContent(analysis)
        );
        outcome.match = await persistBasketInvoiceMatch(
          supabaseClient,
          outcome.analysis.analysisId,
          analysis.caseId,
          outcome.attribution.attributionRowId,
          activeItems.map((item) => ({
            productNameRaw: item.productNameRaw,
            productId: item.productId,
            quantity: item.quantity
          })),
          mapBasketInvoiceMatchRowContent(analysis),
          selectedInvoiceItemSnapshot
        );
        outcome.policyEvaluation = await persistPolicyEvaluation(
          supabaseClient,
          outcome.analysis.analysisId,
          analysis.caseId,
          analysis,
          currentPolicyConfig
        );
        outcome.success = true;
      } catch (err) {
        outcome.success = false;
        outcome.error = err instanceof Error ? err.message : String(err);
      }
      caseOutcomes.push(outcome);
    }
  }
  if (!input.dryRun) {
    const derivedCaseIdsByConversation = /* @__PURE__ */ new Map();
    for (const analysis of caseAnalyses) {
      const set = derivedCaseIdsByConversation.get(analysis.conversationId) ?? /* @__PURE__ */ new Set();
      set.add(analysis.caseId);
      derivedCaseIdsByConversation.set(analysis.conversationId, set);
    }
    const outcomeByCaseId = new Map(caseOutcomes.map((outcome) => [outcome.caseId, outcome]));
    for (const conversation of effectiveConversations) {
      const derivedCaseIds = derivedCaseIdsByConversation.get(conversation.conversationId) ?? /* @__PURE__ */ new Set();
      const allDerivedCasesSucceeded = Array.from(derivedCaseIds).every(
        (caseId) => outcomeByCaseId.get(caseId)?.success === true
      );
      if (!allDerivedCasesSucceeded) continue;
      const { data: existingCases, error: existingCasesError } = await supabaseClient.from("sales_intelligence_cases").select("case_id").eq("conversation_id", conversation.conversationId);
      if (existingCasesError) throw existingCasesError;
      const staleCaseIds = (existingCases ?? []).map((row) => String(row.case_id ?? "").trim()).filter((caseId) => caseId && !derivedCaseIds.has(caseId));
      if (!staleCaseIds.length) continue;
      const { error: retireError } = await supabaseClient.from("sales_intelligence_case_analyses").update({
        is_current: false,
        superseded_at: (/* @__PURE__ */ new Date()).toISOString(),
        superseded_by_analysis_id: null
      }).in("case_id", staleCaseIds).eq("is_current", true);
      if (retireError) throw retireError;
    }
  }
  const persistencePlanningMs = Date.now() - planningStart;
  return {
    dryRun: input.dryRun,
    plan,
    caseOutcomes: input.dryRun ? null : caseOutcomes,
    caseAnalyses,
    performance: {
      conversations: effectiveConversations.length,
      cases: caseAnalyses.length,
      customerGroups: groups.length,
      candidateInvoiceFetches,
      previousTheoreticalFetchCount,
      candidateInvoicesEvaluated,
      exclusiveInvoicesResolved: resolvedInvoiceIds.size,
      invoiceClaimsDenied: Array.from(deniedInvoiceIdsByCase.values()).reduce((sum, ids) => sum + ids.size, 0),
      unresolvedInvoiceCompetitions: new Set(finalResolution.unresolvedCompetingSelections.map((item) => item.invoiceId)).size,
      invoiceResolutionIterations,
      purePipelineComputeMs,
      persistencePlanningMs
    }
  };
}

// src/lib/salesIntelligence/trustedInvoiceEvidenceBridge.ts
function resolveTrustedInvoiceEvidenceFromReviewSource(input) {
  const reviewerConfirmed = input.reviewerConfirmed === true;
  const invoiceLinkConfirmed = input.invoiceLinkConfirmed === true;
  const confirmedInvoiceId = String(input.confirmedInvoiceId || "").trim();
  const confirmedBy = String(input.confirmedBy || "").trim();
  const confirmedAt = String(input.confirmedAt || "").trim();
  const confirmedInvoiceNumber = String(input.confirmedInvoiceNumber || "").trim() || null;
  const matchedInvoiceId = String(input.matchedInvoiceId || "").trim();
  if (invoiceLinkConfirmed && confirmedInvoiceId && confirmedBy && confirmedAt && (!matchedInvoiceId || matchedInvoiceId === confirmedInvoiceId)) {
    const ruleIds2 = [
      "trusted_invoice.eligible.manual_invoice_link_confirmation",
      "trusted_invoice.rule.exact_invoice_id_confirmed",
      "trusted_invoice.rule.confirmed_by_present",
      "trusted_invoice.rule.confirmed_at_present"
    ];
    return {
      trustedInvoiceId: confirmedInvoiceId,
      trustedInvoiceNumber: confirmedInvoiceNumber,
      trustedInvoiceBranch: input.branch || null,
      source: "whatsapp_review_sources",
      evidenceType: "manual_invoice_link_confirmation",
      reviewerConfirmed,
      ruleIds: ruleIds2,
      confidence: { level: "proven", score: 1, ruleIds: ruleIds2, evidence: [] }
    };
  }
  const ruleIds = [
    "trusted_invoice.ineligible.no_invoice_specific_confirmation_source"
  ];
  if (!input.matchedInvoiceId) ruleIds.push("trusted_invoice.ineligible.no_matched_invoice");
  if (!invoiceLinkConfirmed) ruleIds.push("trusted_invoice.ineligible.invoice_link_not_confirmed");
  if (invoiceLinkConfirmed && !confirmedInvoiceId) ruleIds.push("trusted_invoice.ineligible.confirmed_invoice_id_missing");
  if (invoiceLinkConfirmed && !confirmedBy) ruleIds.push("trusted_invoice.ineligible.confirmed_by_missing");
  if (invoiceLinkConfirmed && !confirmedAt) ruleIds.push("trusted_invoice.ineligible.confirmed_at_missing");
  if (invoiceLinkConfirmed && confirmedInvoiceId && matchedInvoiceId && confirmedInvoiceId !== matchedInvoiceId) {
    ruleIds.push("trusted_invoice.ineligible.confirmed_invoice_differs_from_current_match");
  }
  if (input.invoiceMatchStatus !== "verified") ruleIds.push("trusted_invoice.ineligible.match_status_not_verified");
  if (!reviewerConfirmed) {
    ruleIds.push("trusted_invoice.ineligible.reviewer_not_confirmed");
  } else {
    ruleIds.push("trusted_invoice.ineligible.overall_review_confirmation_not_invoice_confirmation");
  }
  if (reviewerConfirmed && !input.reviewerId) {
    ruleIds.push("trusted_invoice.ineligible.reviewer_id_missing");
  }
  return {
    trustedInvoiceId: null,
    trustedInvoiceNumber: null,
    trustedInvoiceBranch: null,
    source: "none",
    evidenceType: "none",
    reviewerConfirmed,
    ruleIds,
    confidence: { level: "unknown", score: 0, ruleIds, evidence: [] }
  };
}

// src/lib/salesIntelligence/persistence/reviewSourceBatchAdapter.ts
function reviewSourceRowToBatchConversation(row) {
  const trustedEvidence = resolveTrustedInvoiceEvidenceFromReviewSource({
    sourceId: row.id,
    matchedInvoiceId: row.matched_invoice_id ?? null,
    matchedInvoiceNumber: row.matched_invoice_number ?? null,
    invoiceMatchStatus: row.invoice_match_status ?? null,
    reviewerConfirmed: row.reviewer_confirmed ?? null,
    reviewerId: row.reviewer_id ?? null,
    branch: row.branch ?? null,
    invoiceLinkConfirmed: row.invoice_link_confirmed ?? null,
    confirmedInvoiceId: row.invoice_link_confirmed_invoice_id ?? null,
    confirmedInvoiceNumber: row.invoice_link_confirmed_invoice_number ?? null,
    confirmedBy: row.invoice_link_confirmed_by ?? null,
    confirmedAt: row.invoice_link_confirmed_at ?? null
  });
  return {
    conversationId: row.id,
    sourceCaseIdV22: row.source_case_id_v22 ?? null,
    rawWhatsAppExportText: row.raw_text ?? "",
    trustedConversationStartedAt: row.conversation_started_at ?? null,
    customerIdHint: row.customer_id ?? null,
    customerPhoneHint: row.customer_phone ?? null,
    customerNameHint: row.customer_name ?? null,
    customerCodeHint: normalizeDawaaCustomerCode(row.customer_code) || extractTrailingCustomerCodeFromDisplayName(row.customer_name) || null,
    branchNameRawHint: row.branch ?? null,
    legacyMatchedInvoiceId: row.matched_invoice_id ?? null,
    legacyMatchedInvoiceNumber: row.matched_invoice_number ?? null,
    trustedInvoiceId: trustedEvidence.trustedInvoiceId,
    trustedInvoiceNumber: trustedEvidence.trustedInvoiceNumber
  };
}

// src/lib/salesIntelligence/persistence/canonicalSourceGate.ts
var CANONICAL_SOURCE_GATE_CODES = {
  nonCanonical: "blocked_non_canonical_source",
  missingCase: "blocked_missing_canonical_case",
  ambiguousCase: "blocked_ambiguous_canonical_case"
};
var SIBLING_LIMIT = 1e3;
var V22_ID_CHUNK = 40;
function time(value) {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}
function containedSiblingIds(source, siblings) {
  const fileName = String(source.source_filename || "");
  const rawText = String(source.raw_text || "");
  const start = time(source.conversation_started_at);
  const end = time(source.conversation_ended_at);
  if (!fileName || !rawText || start === null || end === null) return [];
  return siblings.filter((row) => {
    if (row.id === source.id || row.source_filename !== fileName) return false;
    if (String(row.review_status || "") === "archived") return false;
    const siblingText = String(row.raw_text || "");
    const siblingStart = time(row.conversation_started_at);
    const siblingEnd = time(row.conversation_ended_at);
    if (!siblingText || siblingStart === null || siblingEnd === null) return false;
    return siblingStart >= start && siblingEnd <= end && rawText.includes(siblingText);
  }).map((row) => row.id);
}
function evaluateCanonicalSourceGate(source, context) {
  const sourceId = String(source.id);
  const ownCaseIds = context.v22CaseIdsBySource.get(sourceId) || [];
  if (String(source.review_status || "") === "archived") {
    return {
      allowed: false,
      sourceId,
      code: CANONICAL_SOURCE_GATE_CODES.nonCanonical,
      reason: "source_archived",
      v22CaseIds: ownCaseIds,
      supersedingSourceIds: []
    };
  }
  const supersedingSourceIds = containedSiblingIds(source, context.siblings).filter(
    (id) => (context.v22CaseIdsBySource.get(id) || []).length > 0
  );
  if (supersedingSourceIds.length) {
    const supersedingCaseIds = Array.from(
      new Set(supersedingSourceIds.flatMap((id) => context.v22CaseIdsBySource.get(id) || []))
    ).sort();
    return {
      allowed: false,
      sourceId,
      code: CANONICAL_SOURCE_GATE_CODES.nonCanonical,
      reason: "superseded_by_finer_canonical_sources",
      v22CaseIds: supersedingCaseIds,
      supersedingSourceIds: supersedingSourceIds.sort()
    };
  }
  if (ownCaseIds.length === 0) {
    return {
      allowed: false,
      sourceId,
      code: CANONICAL_SOURCE_GATE_CODES.missingCase,
      reason: "no_customer_case_v22",
      v22CaseIds: [],
      supersedingSourceIds: []
    };
  }
  if (ownCaseIds.length > 1) {
    return {
      allowed: false,
      sourceId,
      code: CANONICAL_SOURCE_GATE_CODES.ambiguousCase,
      reason: "multiple_customer_cases_v22",
      v22CaseIds: [...ownCaseIds].sort(),
      supersedingSourceIds: []
    };
  }
  return { allowed: true, sourceId, v22CaseId: ownCaseIds[0] };
}
async function loadCanonicalSourceGateContext(service, sources) {
  const fileNames = Array.from(
    new Set(sources.map((row) => String(row.source_filename || "")).filter(Boolean))
  );
  let siblings = [];
  for (const fileName of fileNames) {
    const fileRows = sources.filter((row) => String(row.source_filename || "") === fileName);
    const fileStarts = fileRows.map((row) => time(row.conversation_started_at)).filter((x) => x !== null);
    const fileEnds = fileRows.map((row) => time(row.conversation_ended_at)).filter((x) => x !== null);
    if (!fileStarts.length || !fileEnds.length) continue;
    const { data, error } = await service.from("whatsapp_review_sources").select(
      "id,review_status,source_filename,conversation_started_at,conversation_ended_at,raw_text"
    ).eq("source_filename", fileName).gte("conversation_started_at", new Date(Math.min(...fileStarts)).toISOString()).lte("conversation_ended_at", new Date(Math.max(...fileEnds)).toISOString()).or("review_status.is.null,review_status.neq.archived").limit(SIBLING_LIMIT);
    if (error) throw new Error(`canonical_source_gate_sibling_lookup_failed: ${error.message}`);
    if ((data || []).length >= SIBLING_LIMIT)
      throw new Error("canonical_source_gate_sibling_lookup_unbounded");
    siblings = siblings.concat((data || []).map((row) => ({ ...row, id: String(row.id) })));
  }
  const lookupIds = new Set(sources.map((row) => String(row.id)));
  for (const source of sources) {
    for (const id of containedSiblingIds(source, siblings)) lookupIds.add(id);
  }
  const v22CaseIdsBySource = await loadV22CaseOwnership(service, Array.from(lookupIds));
  return { siblings, v22CaseIdsBySource };
}
async function loadV22CaseOwnership(service, sourceIds) {
  const v22CaseIdsBySource = /* @__PURE__ */ new Map();
  const ids = Array.from(new Set(sourceIds.map(String).filter(Boolean)));
  for (let index = 0; index < ids.length; index += V22_ID_CHUNK) {
    const chunk = ids.slice(index, index + V22_ID_CHUNK);
    const { data, error } = await service.from("whatsapp_customer_cases_v22").select("id,root_source_id,source_ids").or(
      `root_source_id.in.(${chunk.join(",")}),source_ids.ov.{${chunk.join(",")}}`
    );
    if (error) throw new Error(`canonical_source_gate_case_lookup_failed: ${error.message}`);
    const wanted = new Set(chunk);
    for (const row of data || []) {
      const owners = /* @__PURE__ */ new Set([
        String(row.root_source_id || ""),
        ...(row.source_ids || []).map(String)
      ]);
      for (const owner of owners) {
        if (!wanted.has(owner)) continue;
        const current = v22CaseIdsBySource.get(owner) || [];
        if (!current.includes(String(row.id)))
          v22CaseIdsBySource.set(owner, [...current, String(row.id)]);
      }
    }
  }
  return v22CaseIdsBySource;
}

// src/lib/salesIntelligence/refresh/canonicalRefreshService.ts
var CANONICAL_PROOF_WRITER_RPC = "dawaa_reconcile_sales_intelligence_case_v22_v1";
var CANONICAL_REFRESH_SOURCE_COLUMNS = [
  "id",
  "raw_text",
  "source_filename",
  "conversation_started_at",
  "conversation_ended_at",
  "message_count",
  "created_at",
  "customer_id",
  "customer_phone",
  "customer_name",
  "customer_code",
  "branch",
  "matched_invoice_id",
  "matched_invoice_number",
  "invoice_match_status",
  "reviewer_confirmed",
  "reviewer_id",
  "invoice_link_confirmed",
  "invoice_link_confirmed_invoice_id",
  "invoice_link_confirmed_invoice_number",
  "invoice_link_confirmed_by",
  "invoice_link_confirmed_at",
  "review_status"
].join(",");
function toBlocked(decision) {
  return {
    sourceId: decision.sourceId,
    error: decision.code,
    reason: decision.reason,
    v22CaseIds: decision.v22CaseIds,
    supersedingSourceIds: decision.supersedingSourceIds
  };
}
async function runCanonicalSalesIntelligenceRefresh(service, input) {
  const sources = input.sources.filter(
    (row) => typeof row.raw_text === "string" && String(row.raw_text).trim().length > 0
  );
  const empty = {
    dryRun: input.dryRun,
    batch: null,
    persistenceFailures: [],
    canonicalReconciliation: [],
    actionReconciliation: { reconciledActions: 0 },
    complaintEnrichment: { enrichedComplaintActions: 0 }
  };
  const gateContext = await loadCanonicalSourceGateContext(service, sources);
  const decisions = sources.map(
    (source) => evaluateCanonicalSourceGate(source, gateContext)
  );
  const blockedSources = decisions.filter(
    (decision) => !decision.allowed
  ).map(toBlocked);
  const v22CaseIdBySource = new Map(
    decisions.filter(
      (decision) => decision.allowed
    ).map((decision) => [decision.sourceId, decision.v22CaseId])
  );
  const admitted = sources.filter((source) => v22CaseIdBySource.has(String(source.id || "")));
  const admittedSourceIds = admitted.map((source) => String(source.id));
  if (!admitted.length)
    return { ...empty, status: "nothing_admitted", admittedSourceIds, blockedSources };
  const conversations = admitted.map(
    (source) => reviewSourceRowToBatchConversation({
      ...source,
      source_case_id_v22: v22CaseIdBySource.get(String(source.id)) || null
    })
  );
  const batch = await runBatchPersistence(service, { conversations, dryRun: input.dryRun });
  if (input.dryRun) return { ...empty, status: "ok", admittedSourceIds, blockedSources, batch };
  const outcomes = batch.caseOutcomes || [];
  const persistenceFailures = outcomes.filter((row) => !row.success).map((row) => ({ caseId: row.caseId, error: row.error }));
  if (persistenceFailures.length) {
    return {
      ...empty,
      status: "persistence_partial_failure",
      admittedSourceIds,
      blockedSources,
      batch,
      persistenceFailures
    };
  }
  const persisted = new Set(outcomes.filter((row) => row.success).map((row) => row.caseId));
  const reconcileCandidates = batch.caseAnalyses.filter((row) => persisted.has(row.caseId));
  const canonicalReconciliation = [];
  for (const analysis of reconcileCandidates) {
    const { data, error } = await service.rpc(CANONICAL_PROOF_WRITER_RPC, {
      p_sales_case_id: analysis.caseId
    });
    canonicalReconciliation.push({
      caseId: analysis.caseId,
      ...error ? { ok: false, status: "rpc_error", error: error.message } : data || { ok: false, status: "empty_reconcile_result" }
    });
  }
  if (canonicalReconciliation.some((row) => row.status === "rpc_error")) {
    return {
      ...empty,
      status: "proof_bridge_transport_failure",
      admittedSourceIds,
      blockedSources,
      batch,
      canonicalReconciliation
    };
  }
  const reconciledCaseIds = new Set(
    canonicalReconciliation.filter((row) => row.ok && ["reconciled", "already_reconciled"].includes(String(row.status))).map((row) => row.caseId)
  );
  let reconciledActions = 0;
  let enrichedComplaintActions = 0;
  for (const source of admitted) {
    const sourceId = String(source.id);
    const sourceAnalyses = batch.caseAnalyses.filter((row) => row.conversationId === sourceId);
    const provenAnalyses = sourceAnalyses.filter((row) => reconciledCaseIds.has(row.caseId));
    if (provenAnalyses.length) {
      reconciledActions += (await reconcileSoldCustomerRequestActions(service, sourceId, provenAnalyses)).reconciledActions;
    }
    enrichedComplaintActions += (await enrichComplaintFollowupContext(service, source, sourceAnalyses)).enrichedComplaintActions;
  }
  return {
    ...empty,
    status: "ok",
    admittedSourceIds,
    blockedSources,
    batch,
    canonicalReconciliation,
    actionReconciliation: { reconciledActions },
    complaintEnrichment: { enrichedComplaintActions }
  };
}
async function reconcileSoldCustomerRequestActions(service, sourceId, caseAnalyses) {
  const { data: actions, error: actionsError } = await service.from("whatsapp_conversation_actions").select(
    "id,action_key,action_type,status,work_status,product_id,product_code,product_name,quantity,payload,confidence"
  ).eq("source_id", sourceId).eq("action_type", "customer_request").in("status", ["proposed", "ready", "created"]);
  if (actionsError) throw actionsError;
  if (!actions?.length) return { reconciledActions: 0 };
  let reconciledActions = 0;
  const reconciledIds = /* @__PURE__ */ new Set();
  for (const analysis of caseAnalyses) {
    const attribution = analysis?.attribution;
    const match = analysis?.basketInvoiceMatch;
    const invoiceId2 = String(attribution?.selectedInvoiceId || "").trim();
    const invoiceNumber2 = String(attribution?.selectedInvoiceNumber || "").trim();
    const attributionLevel = String(attribution?.attributionLevel || "");
    const contradictions = Array.isArray(attribution?.contradictions) ? attribution.contradictions : [];
    if (!invoiceId2 || !invoiceNumber2) continue;
    if (attributionLevel !== "proven") continue;
    if (contradictions.length > 0) continue;
    if (match?.itemMatch !== "exact" || match?.itemEvidenceReady !== true) continue;
    const { data: invoiceItems, error: invoiceItemsError } = await service.from("sales_invoice_items_v21").select("invoice_id,invoice_number,product_id,product_code,product_name,quantity,line_total").eq("invoice_id", invoiceId2);
    if (invoiceItemsError) throw invoiceItemsError;
    if (!invoiceItems?.length) continue;
    const invoiceValue = invoiceItems.reduce(
      (sum, row) => sum + (Number(row.line_total) || 0),
      0
    );
    for (const action of actions) {
      if (reconciledIds.has(String(action.id))) continue;
      if (!action.product_id) continue;
      const matchingLines = invoiceItems.filter(
        (row) => String(row.product_id || "") === String(action.product_id)
      );
      if (!matchingLines.length) continue;
      const soldQuantity = matchingLines.reduce(
        (sum, row) => sum + (Number(row.quantity) || 0),
        0
      );
      const primaryLine = matchingLines[0];
      const requestPrefix = String(action.action_key || "").match(/^(request:\d+:)/)?.[1] || null;
      const relatedActions = actions.filter((candidate) => {
        if (reconciledIds.has(String(candidate.id))) return false;
        if (String(candidate.id) === String(action.id)) return true;
        if (!requestPrefix) return false;
        return String(candidate.action_key || "").startsWith(requestPrefix) && !candidate.product_id;
      });
      for (const related of relatedActions) {
        const nowIso = (/* @__PURE__ */ new Date()).toISOString();
        const payload = related.payload && typeof related.payload === "object" && !Array.isArray(related.payload) ? related.payload : {};
        const canonicalSale = {
          case_id: analysis.caseId,
          invoice_id: invoiceId2,
          invoice_number: invoiceNumber2,
          product_id: String(primaryLine.product_id || action.product_id || ""),
          product_code: String(primaryLine.product_code || action.product_code || ""),
          product_name: String(primaryLine.product_name || action.product_name || ""),
          sold_quantity: soldQuantity,
          invoice_value: invoiceValue,
          attribution_level: attributionLevel,
          item_match: match.itemMatch,
          verified_at: nowIso
        };
        const { error: updateError } = await service.from("whatsapp_conversation_actions").update({
          status: "dismissed",
          work_status: "completed",
          outcome: "sold",
          outcome_note: "\u062A\u0645 \u0625\u063A\u0644\u0627\u0642 \u0637\u0644\u0628 \u0627\u0644\u0639\u0645\u064A\u0644 \u062A\u0644\u0642\u0627\u0626\u064A\u064B\u0627 \u0628\u0639\u062F \u0625\u062B\u0628\u0627\u062A \u0627\u0644\u0628\u064A\u0639 \u0648\u0631\u0628\u0637\u0647 \u0628\u0641\u0627\u062A\u0648\u0631\u0629 \u0641\u0639\u0644\u064A\u0629.",
          completed_at: nowIso,
          target_table: "sales_invoices",
          target_id: invoiceId2,
          reason: "\u062A\u0645 \u0625\u062B\u0628\u0627\u062A \u0628\u064A\u0639 \u0627\u0644\u0637\u0644\u0628 \u0648\u0631\u0628\u0637\u0647 \u0628\u0641\u0627\u062A\u0648\u0631\u0629 \u0641\u0639\u0644\u064A\u0629\u061B \u0644\u0627 \u064A\u062D\u062A\u0627\u062C \u0645\u062A\u0627\u0628\u0639\u0629 \u0643\u0637\u0644\u0628 \u063A\u064A\u0631 \u0645\u063A\u0644\u0642.",
          payload: { ...payload, canonical_sale: canonicalSale },
          updated_at: nowIso
        }).eq("id", related.id);
        if (updateError) throw updateError;
        reconciledIds.add(String(related.id));
        reconciledActions += 1;
      }
    }
  }
  return { reconciledActions };
}
async function enrichComplaintFollowupContext(service, source, caseAnalyses) {
  const sourceId = String(source.id || "");
  if (!sourceId) return { enrichedComplaintActions: 0 };
  const { data: actions, error: actionError } = await service.from("whatsapp_conversation_actions").select("id,status,action_type,payload").eq("source_id", sourceId).eq("action_type", "complaint_followup").in("status", ["proposed", "ready", "created"]);
  if (actionError) throw actionError;
  if (!actions?.length) return { enrichedComplaintActions: 0 };
  let invoiceId2 = "";
  let linkageBasis = "";
  for (const analysis of caseAnalyses) {
    const attribution = analysis?.attribution;
    const level = String(attribution?.attributionLevel || "");
    const selected = String(attribution?.selectedInvoiceId || "").trim();
    if (selected && ["proven", "strongly_inferred"].includes(level)) {
      invoiceId2 = selected;
      linkageBasis = `canonical_${level}`;
      break;
    }
  }
  let invoice = null;
  if (invoiceId2) {
    invoice = await readInvoiceRecordById(invoiceId2, service);
  }
  if (!invoice) {
    const customerId = String(source.customer_id || "").trim();
    const customerCode = String(source.customer_code || "").trim();
    const startedAt = source.conversation_started_at ? new Date(String(source.conversation_started_at)) : null;
    const endedAt = source.conversation_ended_at ? new Date(String(source.conversation_ended_at)) : startedAt;
    if ((customerId || customerCode) && startedAt && !Number.isNaN(startedAt.getTime())) {
      const from = new Date(startedAt.getTime() - 2 * 36e5).toISOString();
      const to = new Date(
        (endedAt && !Number.isNaN(endedAt.getTime()) ? endedAt.getTime() : startedAt.getTime()) + 6 * 36e5
      ).toISOString();
      const rows = await readInvoiceRecordsByCustomerWindow({
        queryStartIso: from,
        queryEndIso: to,
        ...customerId ? { customerId } : { customerCode },
        limit: 20,
        client: service
      });
      if (rows.length) {
        const anchor = startedAt.getTime();
        invoice = [...rows].sort((a, b) => {
          const ad = Math.abs(new Date(String(a.invoice_datetime || 0)).getTime() - anchor);
          const bd = Math.abs(new Date(String(b.invoice_datetime || 0)).getTime() - anchor);
          return ad - bd;
        })[0];
        linkageBasis = "customer_time_match";
      }
    }
  }
  if (!invoice) return { enrichedComplaintActions: 0 };
  let updated = 0;
  for (const action of actions) {
    const existingPayload = action.payload && typeof action.payload === "object" && !Array.isArray(action.payload) ? action.payload : {};
    const deliveryContext = {
      invoice_id: String(invoice.id || ""),
      invoice_number: String(invoice.invoice_number || ""),
      invoice_datetime: invoice.invoice_datetime || null,
      branch: invoice.branch || null,
      delivery_staff: invoice.delivery_staff || null,
      sale_staff: invoice.staff_name || invoice.seller_name || null,
      linkage_basis: linkageBasis,
      review_required: true,
      responsibility_status: "context_only_not_fault_assignment",
      linked_at: (/* @__PURE__ */ new Date()).toISOString()
    };
    const { error } = await service.from("whatsapp_conversation_actions").update({
      payload: { ...existingPayload, delivery_context: deliveryContext },
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    }).eq("id", action.id);
    if (error) throw error;
    updated += 1;
  }
  return { enrichedComplaintActions: updated };
}

// server/sales-intelligence-refresh-source.ts
var ALLOWED_ROLES = /* @__PURE__ */ new Set([
  "general_manager",
  "admin",
  "executive_manager",
  "branches_manager"
]);
function json(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}
async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { error: "method_not_allowed" });
  }
  const supabaseUrl2 = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "https://jkjqeqkshllustwlzzbf.supabase.co";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    return json(res, 503, { error: "missing_service_role_key" });
  }
  const authHeader = String(req.headers.authorization || "");
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) return json(res, 401, { error: "missing_user_token" });
  const service = createClient2(supabaseUrl2, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const { data: loginSession, error: sessionLookupError } = await service.from("staff_login_sessions").select("id,staff_account_id,expires_at,revoked_at").eq("token_hash", tokenHash).maybeSingle();
  if (sessionLookupError) return json(res, 500, { error: "staff_session_lookup_failed" });
  if (!loginSession || loginSession.revoked_at || new Date(loginSession.expires_at).getTime() <= Date.now()) {
    return json(res, 401, { error: "invalid_or_expired_staff_session" });
  }
  const { data: staff, error: staffError } = await service.from("staff_accounts").select("id,role,active,is_active,status,can_login").eq("id", loginSession.staff_account_id).maybeSingle();
  if (staffError) return json(res, 500, { error: "staff_lookup_failed" });
  const active = Boolean(staff?.active) && Boolean(staff?.is_active) && staff?.status === "active" && staff?.can_login !== false;
  if (!staff || !active || !ALLOWED_ROLES.has(String(staff.role || ""))) {
    return json(res, 403, { error: "not_authorized_for_sales_intelligence_refresh" });
  }
  const sessionRefreshAt = /* @__PURE__ */ new Date();
  const sessionRefreshExpiry = new Date(sessionRefreshAt.getTime() + 12 * 60 * 60 * 1e3);
  const { error: sessionRefreshError } = await service.from("staff_login_sessions").update({
    last_used_at: sessionRefreshAt.toISOString(),
    expires_at: sessionRefreshExpiry.toISOString()
  }).eq("id", loginSession.id);
  if (sessionRefreshError) {
    console.warn(
      "[sales-intelligence-refresh-source] staff session sliding refresh failed",
      sessionRefreshError.message
    );
  }
  let body = req.body || {};
  if (typeof body === "string") {
    try {
      body = JSON.parse(body || "{}");
    } catch {
      return json(res, 400, { error: "invalid_json_body" });
    }
  }
  const sourceId = String(body.sourceId || "").trim();
  const sourceFileName = String(body.sourceFileName || "").trim();
  const sourceOffset = Math.max(0, Number(body.sourceOffset) || 0);
  const requestedSourceLimit = Math.max(1, Math.min(10, Number(body.sourceLimit) || 10));
  const validSourceId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sourceId);
  if (!validSourceId && !sourceFileName) {
    return json(res, 400, { error: "source_id_or_file_name_required" });
  }
  if (sourceFileName.length > 240) {
    return json(res, 400, { error: "source_file_name_too_long" });
  }
  let sourceRows = [];
  let totalSourceCount = null;
  if (sourceFileName) {
    const { count, error: countError } = await service.from("whatsapp_review_sources").select("id", { count: "exact", head: true }).eq("source_filename", sourceFileName);
    if (countError)
      return json(res, 500, { error: "source_count_failed", detail: countError.message });
    totalSourceCount = Number(count || 0);
    const { data, error } = await service.from("whatsapp_review_sources").select(CANONICAL_REFRESH_SOURCE_COLUMNS).eq("source_filename", sourceFileName).order("conversation_started_at", { ascending: true, nullsFirst: true }).order("id", { ascending: true }).range(sourceOffset, sourceOffset + requestedSourceLimit - 1);
    if (error) return json(res, 500, { error: "source_lookup_failed", detail: error.message });
    sourceRows = data || [];
  } else {
    const { data, error } = await service.from("whatsapp_review_sources").select(CANONICAL_REFRESH_SOURCE_COLUMNS).eq("id", sourceId).maybeSingle();
    if (error) return json(res, 500, { error: "source_lookup_failed", detail: error.message });
    sourceRows = data ? [data] : [];
  }
  if (!sourceRows.some(
    (row) => typeof row.raw_text === "string" && String(row.raw_text).trim().length > 0
  )) {
    return json(res, 404, { error: "source_not_found_or_empty" });
  }
  const page = {
    sourceId: validSourceId ? sourceId : null,
    sourceFileName: sourceFileName || null,
    totalSourceCount,
    sourceOffset: sourceFileName ? sourceOffset : null,
    sourceLimit: sourceFileName ? requestedSourceLimit : null,
    nextOffset: sourceFileName ? sourceOffset + sourceRows.length : null,
    hasMore: sourceFileName ? sourceOffset + sourceRows.length < Number(totalSourceCount || 0) : false
  };
  let refresh;
  try {
    refresh = await runCanonicalSalesIntelligenceRefresh(service, {
      sources: sourceRows,
      dryRun: false
    });
  } catch (error) {
    console.error("[sales-intelligence-refresh-source] canonical refresh failed", {
      ...page,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null
    });
    const message = error instanceof Error ? error.message : String(error);
    return json(res, 500, {
      error: message.startsWith("canonical_source_gate_") ? "canonical_source_gate_lookup_failed" : "canonical_refresh_failed",
      detail: message
    });
  }
  if (!sourceFileName && refresh.blockedSources.length) {
    return json(res, 409, { ...refresh.blockedSources[0], sourceId });
  }
  if (refresh.status === "persistence_partial_failure" || refresh.status === "proof_bridge_transport_failure") {
    return json(res, 500, {
      error: refresh.status === "persistence_partial_failure" ? "canonical_refresh_partial_failure" : "canonical_reconciliation_failure",
      ...page,
      sourceCount: refresh.admittedSourceIds.length,
      blockedSources: refresh.blockedSources,
      failures: refresh.persistenceFailures,
      canonicalReconciliation: refresh.canonicalReconciliation
    });
  }
  const batch = refresh.batch;
  return json(res, 200, {
    ok: true,
    ...page,
    sourceCount: refresh.admittedSourceIds.length,
    blockedSources: refresh.blockedSources,
    canonicalReconciliation: refresh.canonicalReconciliation,
    actionReconciliation: refresh.actionReconciliation,
    complaintEnrichment: refresh.complaintEnrichment,
    derivedCases: (batch?.caseAnalyses || []).map((row) => ({
      conversationId: row.conversationId,
      caseId: row.caseId,
      status: row.status,
      sourceCaseIdV22: row.conversationCase?.sourceCaseIdV22 ?? null,
      customerId: row.conversationCase.customerId,
      customerPhone: row.conversationCase.customerPhone,
      selectedInvoiceNumber: row.attribution.selectedInvoiceNumber,
      attributionLevel: row.attribution.attributionLevel,
      salesOutcome: row.salesOutcome?.outcome ?? null,
      saleProofState: row.salesOutcome?.saleProofState ?? null,
      failureReasons: row.failureReasons
    })),
    plan: batch ? {
      casesToInsert: batch.plan.casesToInsert.length,
      casesToUpdateCanonicalIdentity: batch.plan.casesToUpdateCanonicalIdentity.length,
      casesUnchanged: batch.plan.casesUnchanged.length,
      analysesToInsert: batch.plan.analysesToInsert.length,
      analysesToSupersede: batch.plan.analysesToSupersede.length,
      attributionsToInsert: batch.plan.attributionsToInsert.length,
      matchesToInsert: batch.plan.matchesToInsert.length,
      conflicts: batch.plan.conflicts,
      warnings: batch.plan.warnings
    } : null
  });
}
export {
  handler as default
};
