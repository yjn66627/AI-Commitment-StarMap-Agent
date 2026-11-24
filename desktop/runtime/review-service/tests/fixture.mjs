import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, scryptSync } from 'node:crypto';
import { once } from 'node:events';
import { makeReviewServer } from '../server.mjs';
import { initializeLedger, openLedger } from '../budget.mjs';
import { createProvider } from '../provider.mjs';

export async function fixture({ variant = () => 'valid', mode = 'controlled', log = () => {},
                                closeAfterMs = 3_600_000 } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'pcca-dr-test-'));
  const dbPath = join(dir, 'review-quota.sqlite');
  initializeLedger(dbPath, 'controlled-test');
  const ledger = openLedger(dbPath, 'controlled-test');
  const user = 'reviewer-local';
  const password = randomBytes(18).toString('base64url');
  const fakeKey = 'sk-controlled-' + randomBytes(14).toString('hex');
  const salt = randomBytes(16);
  const verifier = salt.toString('hex') + ':' + scryptSync(password, salt, 32).toString('hex');
  let current = Date.now();
  let called = 0;
  let last;
  const analyze = createProvider(fakeKey, async (url, init) => {
    called++;
    last = { url, ...init };
    const records = JSON.parse(JSON.parse(init.body).messages[1].content);
    const kind = variant();
    const result = {
      commitments: [{ summary: '角色承诺提交指定成果。', evidenceIds: [records[0].id] }],
      risks: [{ summary: '仍有事项需要进一步核验。', evidenceIds: [records[1].id] }],
    };
    if (kind === 'unknown') result.risks[0].evidenceIds = ['OTHER_CASE'];
    if (kind === 'html') result.risks[0].summary = '<img src=x onerror=alert(1)>';
    if (kind === 'extra') result.risks[0].confidence = 99;
    if (kind === 'secret') result.risks[0].summary = fakeKey;
    if (kind === 'timeout') await new Promise((_, reject) =>
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }));
    if (kind === 'upstream_error') return new Response('upstream detail ' + fakeKey, { status: 503 });
    return Response.json({
      choices: [{ finish_reason: kind === 'truncated' ? 'length' : 'stop', message: { content: JSON.stringify(result) } }],
      usage: { completion_tokens: 75 },
    });
  }, 400);
  // Origin only affects POST authorization. Set it to the actual port after binding.
  const opts = {
    origin: null, user, verifier, secure: false, expires: current + closeAfterMs, ledger,
    analyze: mode === 'disabled' ? null : analyze, mode, now: () => current, log,
  };
  const server = makeReviewServer({
    ...opts,
    origin: () => 'http://127.0.0.1:' + server.address().port,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = 'http://127.0.0.1:' + server.address().port;
  return { server, origin, user, password, fakeKey, dbPath, ledger, readTime: () => current,
    advance(ms = 12_001) { current += ms; }, calls: () => called, last: () => last,
    async close() {
      server.close();
      server.closeAllConnections();
      await once(server, 'close');
      ledger.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
