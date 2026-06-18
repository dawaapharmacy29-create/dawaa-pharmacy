import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey);
const AUTH_STORAGE_KEY = "dawaa_auth_user_v2";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readStoredUserId(): string | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { id?: unknown };
    return typeof parsed.id === "string" && UUID_PATTERN.test(parsed.id)
      ? parsed.id
      : null;
  } catch {
    return null;
  }
}

const supabaseFetch: typeof fetch = (input, init?: RequestInit) => {
  const headers = new Headers(init?.headers as HeadersInit | undefined);
  const userId = readStoredUserId();
  if (userId) headers.set("x-dawaa-user-id", userId);
  return fetch(input, { ...init, headers });
};

export const supabase = createClient(
  hasSupabaseConfig ? supabaseUrl : "https://placeholder.supabase.co",
  hasSupabaseConfig ? supabaseAnonKey : "placeholder-anon-key",
  {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  realtime: {
    params: { eventsPerSecond: 10 },
  },
  global: {
    fetch: supabaseFetch,
  },
});

export const isSupabaseConfigured = hasSupabaseConfig;

export type Tables = {
  employees: {
    Row: {
      id: string;
      name: string;
      username: string;
      phone: string | null;
      role: string;
      branch: string;
      shift_start: string;
      shift_end: string;
      holiday_day: string | null;
      points: number;
      max_points: number;
      status: string;
      join_date: string | null;
      notes: string | null;
      user_id: string | null;
      created_at: string;
      updated_at: string;
    };
  };
  customers: {
    Row: {
      id: string;
      name: string;
      phone: string;
      branch: string;
      type: string;
      avg_monthly: number;
      total_purchases: number;
      total_invoices: number;
      avg_invoice: number;
      clv: number;
      risk_score: number;
      retention_status: string;
      last_purchase: string | null;
      first_purchase: string | null;
      notes: string | null;
      whatsapp_notes: string | null;
      created_at: string;
      updated_at: string;
    };
  };
};
