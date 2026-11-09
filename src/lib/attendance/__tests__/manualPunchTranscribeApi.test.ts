import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error plain JS serverless handler
import { createManualPunchTranscribeHandler } from '../../../../api/manual-punch-transcribe.js';

const token = 'x'.repeat(40);
const env = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service', OPENAI_API_KEY: 'key' };
const audioBase64 = Buffer.from('audio').toString('base64');

function call(handler: (req: unknown, res: unknown) => Promise<void>, req: Record<string, unknown>) {
  const out: { status?: number; body?: { error?: string; text?: string } } = {};
  const res = {
    setHeader: () => undefined,
    status(code: number) { out.status = code; return this; },
    end(text: string) { out.body = JSON.parse(text); },
  };
  return handler({ method: 'POST', headers: { authorization: `Bearer ${token}` }, ...req }, res).then(() => out);
}

function clientWith(error: { code: string } | null) {
  const abortSignal = vi.fn().mockResolvedValue({ error });
  const rpc = vi.fn(() => ({ abortSignal }));
  return { factory: vi.fn(() => ({ rpc })), rpc };
}

describe('manual punch transcribe API', () => {
  it('rejects a missing session', async () => {
    const out = await call(createManualPunchTranscribeHandler({ env }), { headers: {}, body: { audioBase64 } });
    expect(out.status).toBe(401);
  });
  it('never calls the paid service for someone outside the fingerprints page', async () => {
    const { factory } = clientWith({ code: '42501' });
    const fetchImpl = vi.fn();
    const out = await call(createManualPunchTranscribeHandler({ env, clientFactory: factory, fetchImpl }), { body: { audioBase64 } });
    expect(out.status).toBe(403);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('says clearly when the speech key is not set', async () => {
    const out = await call(createManualPunchTranscribeHandler({ env: { ...env, OPENAI_API_KEY: '' } }), { body: { audioBase64 } });
    expect(out).toMatchObject({ status: 503, body: { error: 'voice_not_configured' } });
  });
  it('rejects an oversized file', async () => {
    const big = Buffer.alloc(3 * 1024 * 1024 + 1).toString('base64');
    const out = await call(createManualPunchTranscribeHandler({ env }), { body: { audioBase64: big } });
    expect(out.status).toBe(413);
  });
  it('returns the transcript and forwards the staff session', async () => {
    const { factory } = clientWith(null);
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ text: ' حضرت 9 ' }) });
    const out = await call(createManualPunchTranscribeHandler({ env, clientFactory: factory, fetchImpl }), { body: { audioBase64, fileName: 'a.opus' } });
    expect(out).toMatchObject({ status: 200, body: { text: 'حضرت 9' } });
    expect(factory.mock.calls[0]).toBeDefined();
  });
});
