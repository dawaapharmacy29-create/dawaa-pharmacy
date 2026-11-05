import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey);
// Owned here (not in auth/staffSession) so the fetch wrapper has no circular import.
export const STAFF_SESSION_STORAGE_KEY = 'dawaa_staff_session_token_v1';

export function readStoredStaffSessionToken(): string | null {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return null;
  try {
    const token = (window.localStorage.getItem(STAFF_SESSION_STORAGE_KEY) || '').trim();
    return token.length >= 32 && token.length <= 512 ? token : null;
  } catch {
    return null;
  }
}

// Identity contract: the only identity the browser sends is the opaque `x-dawaa-session-token`,
// verified by the database against staff_login_sessions. No client-chosen identity header is sent
// (20261017090000/090100 removed the last database readers of the former user-id hint header).
export function buildDawaaRequestHeaders(initHeaders?: HeadersInit): Headers {
  const headers = new Headers(initHeaders);
  const sessionToken = readStoredStaffSessionToken();
  if (sessionToken) headers.set('x-dawaa-session-token', sessionToken);
  return headers;
}

const supabaseFetch: typeof fetch = (input, init?: RequestInit) =>
  fetch(input, {
    ...init,
    headers: buildDawaaRequestHeaders(init?.headers as HeadersInit | undefined),
  });

// When Supabase is not configured, export a lightweight stub client to avoid noisy network failures in dev.
function createStubClient() {
  const noop = () => stubQuery;
  const stubQuery: any = {
    select: async () => ({ data: [], error: null }),
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
    on: () => ({ subscribe: () => ({ unsubscribe: () => null }) }),
  };
  return {
    from: () => stubQuery,
    rpc: async () => ({ data: null, error: null }),
    auth: {
      signIn: async () => ({ data: null, error: null }),
      signOut: async () => ({ error: null }),
      user: () => null,
      onAuthStateChange: () => ({ data: null }),
    },
    storage: {
      from: () => ({ upload: async () => ({ data: null, error: null }) }),
    },
  } as any;
}

export const supabase = hasSupabaseConfig
  ? createClient(
      hasSupabaseConfig ? supabaseUrl : 'https://placeholder.supabase.co',
      hasSupabaseConfig ? supabaseAnonKey : 'placeholder-anon-key',
      {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
        realtime: { params: { eventsPerSecond: 10 } },
        global: { fetch: supabaseFetch },
      }
    )
  : createStubClient();

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
