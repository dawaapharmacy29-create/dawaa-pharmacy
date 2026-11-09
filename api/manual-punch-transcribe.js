// Turns an employee's voice note into text for the manual-punch screen. It records nothing and
// keeps no audio: the manager reads the text and saves the punch through the normal SQL command.
import { createClient } from '@supabase/supabase-js';

const MAX_AUDIO_BYTES = 3 * 1024 * 1024;
const VOCABULARY = 'بصمة حضور انصراف حضرت مشيت وصلت روحت قفلت الساعة ونص وربع الصبح بليل امبارح النهارده';

export function createManualPunchTranscribeHandler(dependencies = {}) {
  return async function handler(req, res) {
    const reply = (status, body) => {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.status(status).end(JSON.stringify(body));
    };
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return reply(405, { error: 'method_not_allowed' });
    }
    const token = /^Bearer ([^\s]{32,512})$/.exec(String(req.headers.authorization || ''))?.[1];
    if (!token) return reply(401, { error: 'invalid_or_expired_staff_session' });

    let body;
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    } catch {
      return reply(400, { error: 'invalid_json_body' });
    }
    if (!body || typeof body.audioBase64 !== 'string' || !body.audioBase64) {
      return reply(400, { error: 'voice_missing' });
    }
    const audio = Buffer.from(body.audioBase64, 'base64');
    if (!audio.length) return reply(400, { error: 'voice_missing' });
    if (audio.length > MAX_AUDIO_BYTES) return reply(413, { error: 'voice_too_large' });

    const env = dependencies.env || process.env;
    const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
    if (!url || !env.SUPABASE_SERVICE_ROLE_KEY) return reply(503, { error: 'voice_transport_not_configured' });
    if (!env.OPENAI_API_KEY) return reply(503, { error: 'voice_not_configured' });

    try {
      const client = (dependencies.clientFactory || createClient)(url, env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { 'x-dawaa-session-token': token } },
      });
      // The same SQL gate as the fingerprints page: only its viewers reach paid transcription.
      const { error } = await client
        .rpc('get_dr_wael_manual_punches_v1', { p_month_cycle: null })
        .abortSignal(AbortSignal.timeout(15_000));
      if (error) {
        return reply(error.code === '42501' ? 403 : 503, {
          error: error.code === '42501' ? 'not_authorized' : 'voice_authorization_unavailable',
        });
      }

      const form = new FormData();
      // WhatsApp's .opus files are Ogg Opus; the speech API accepts them under the .ogg name.
      const isOgg = /ogg|opus/i.test(String(body.mimeType || '')) || /\.(ogg|opus)$/i.test(String(body.fileName || ''));
      const name = isOgg ? 'voice.ogg' : String(body.fileName || 'voice.m4a').replace(/[^\w.-]/g, '_');
      form.append('file', new Blob([audio], { type: isOgg ? 'audio/ogg' : String(body.mimeType || 'audio/mp4') }), name);
      form.append('model', 'gpt-4o-transcribe');
      form.append('language', 'ar');
      form.append('prompt', VOCABULARY);

      const response = await (dependencies.fetchImpl || fetch)('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
        body: form,
        signal: AbortSignal.timeout(45_000),
      });
      if (!response.ok) return reply(502, { error: 'voice_transcription_failed' });
      const result = await response.json();
      const text = String(result?.text || '').trim();
      if (!text) return reply(422, { error: 'voice_empty' });
      return reply(200, { text });
    } catch {
      return reply(503, { error: 'voice_transcription_unavailable' });
    }
  };
}

export default createManualPunchTranscribeHandler();
