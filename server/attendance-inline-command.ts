// Restricted HTTP transport. SQL owns verified session identity, scope and all domain rules.
import { createClient } from '@supabase/supabase-js';
import { evaluateDeployEnvironment } from '../src/lib/deployEnvironmentGuard';

export function createAttendanceInlineHandler(dependencies: {
  env?: Record<string, string | undefined>;
  clientFactory?: typeof createClient;
} = {}) {
  return async function handler(req: any, res: any) {
    const reply = (status: number, body: unknown) => {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.status(status).end(JSON.stringify(body));
    };
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return reply(405, { error: 'method_not_allowed' }); }
    const token = /^Bearer ([^\s]{32,512})$/.exec(String(req.headers.authorization || ''))?.[1];
    if (!token) return reply(401, { error: 'invalid_or_expired_staff_session' });
    let body: any;
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
    catch { return reply(400, { error: 'invalid_json_body' }); }
    if (!body || Array.isArray(body) || typeof body !== 'object' || JSON.stringify(body).length > 8192
      || !['shift', 'permission', 'approve', 'punch'].includes(body.action)
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.staffId || '')
      || !/^\d{4}-\d{2}-\d{2}$/.test(body.date || '')
      || !body.payload || Array.isArray(body.payload) || typeof body.payload !== 'object') {
      return reply(400, { error: 'attendance_inline_invalid_command' });
    }
    const env = dependencies.env || process.env;
    const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
    if (!evaluateDeployEnvironment(env).ok || !url || !env.SUPABASE_SERVICE_ROLE_KEY) {
      return reply(503, { error: 'attendance_transport_not_configured' });
    }
    try {
      const client = (dependencies.clientFactory || createClient)(url, env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { 'x-dawaa-session-token': token } },
      });
      // No generic RPC proxy, actor parameter, browser service key or anon fallback.
      const { data, error } = await client.rpc('attendance_inline_command_v1', {
        p_action: body.action, p_staff_id: body.staffId, p_date: body.date, p_payload: body.payload,
      }).abortSignal(AbortSignal.timeout(20_000));
      if (error) {
        const sessionInvalid = error.message === 'invalid_or_expired_staff_session';
        const status = sessionInvalid ? 401 : error.code === '42501' ? 403
          : ['23505', '55000'].includes(error.code) ? 409 : ['22023', '22007', '22008'].includes(error.code) ? 400 : 503;
        const safeMessage = /^[a-z][a-z0-9_]+$/.test(error.message) ? error.message : 'attendance_inline_command_failed';
        return reply(status, { error: safeMessage });
      }
      if (!data || typeof data !== 'object') return reply(502, { error: 'attendance_inline_empty_response' });
      return reply(200, { data });
    } catch { return reply(503, { error: 'attendance_inline_transport_unavailable' }); }
  };
}

export default createAttendanceInlineHandler();
