import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixture.mjs';
import { config } from '../server.mjs';
import { MAX_CALLS, openLedger } from '../budget.mjs';

async function local(t, opts) {
  const f = await fixture(opts);
  t.after(() => f.close());
  return f;
}
function post(f, route, body, cookie, origin = f.origin) {
  return fetch(f.origin + route, {
    method: 'POST', headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}
async function login(f) {
  const res = await post(f, '/api/login', { username: f.user, password: f.password });
  assert.equal(res.status, 200);
  const cookie = res.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly; SameSite=Strict/);
  assert.equal((await res.json()).ok, true);
  return cookie.split(';')[0];
}
test('login, protected assets, case selection and session invalidation', async t => {
  const f = await local(t);
  assert.equal((await fetch(f.origin + '/api/cases')).status, 401);
  assert.equal((await fetch(f.origin + '/graph/')).status, 401);
  assert.equal((await fetch(f.origin + '/server.mjs')).status, 404);
  assert.equal((await fetch(f.origin + '/.env')).status, 404);
  assert.equal((await post(f, '/api/login', { username: f.user, password: 'wrong' })).status, 401);
  const cookie = await login(f);
  const res = await fetch(f.origin + '/api/cases', { headers: { cookie } });
  const data = await res.json();
  assert.equal(data.mode, 'controlled');
  assert.deepEqual(data.cases.map(c => c.id), ['prototype','handoff']);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const graph = await fetch(f.origin + '/graph/', { headers: { cookie } });
  assert.equal(graph.status, 200);
  assert.match(graph.headers.get('content-security-policy'), /connect-src 'none'/);
  assert.equal((await post(f, '/api/logout', {}, cookie)).status, 200);
  assert.equal((await fetch(f.origin + '/api/cases', { headers: { cookie } })).status, 401);
});
test('strict request allowlist, cross-origin rejection and default model disabled', async t => {
  const f = await local(t, { mode: 'disabled' });
  assert.equal((await post(f, '/api/analyze', { caseId: 'prototype' })).status, 401);
  const cookie = await login(f);
  assert.equal((await post(f, '/api/analyze', { caseId: 'prototype' }, cookie, 'https://example.invalid')).status, 403);
  assert.equal((await post(f, '/api/analyze', { caseId: 'prototype', prompt: 'foreign' }, cookie)).status, 400);
  assert.equal((await post(f, '/api/analyze', { caseId: 'bad' }, cookie)).status, 400);
  assert.equal((await post(f, '/api/analyze', { caseId: 'A'.repeat(1400) }, cookie)).status, 413);
  const res = await post(f, '/api/analyze', { caseId: 'prototype' }, cookie);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'MODEL_DISABLED');
  assert.equal(f.calls(), 0);
});
test('controlled provider request, authoritative evidence text and no credential leaks', async t => {
  const lines = [];
  const f = await local(t, { log: line => lines.push(line) });
  const cookie = await login(f);
  const res = await post(f, '/api/analyze', { caseId: 'handoff' }, cookie);
  const text = await res.text();
  assert.equal(res.status, 200);
  assert(!text.includes(f.fakeKey));
  assert(!lines.join('').includes(f.fakeKey));
  const payload = JSON.parse(text);
  assert.equal(payload.mode, 'controlled');
  assert.equal(payload.model, null);
  assert.equal(payload.result.commitments[0].evidence[0].id, 'H01');
  assert.match(payload.result.commitments[0].evidence[0].text, /周三提交/);
  const outbound = JSON.parse(f.last().body);
  assert.equal(f.last().url, 'https://api.deepseek.com/chat/completions');
  assert.equal(f.last().redirect, 'error');
  assert.equal(outbound.max_tokens, 600);
  assert.equal(outbound.model, 'deepseek-flash');
  assert.equal(outbound.stream, false);
  assert.equal(outbound.thinking.type, 'disabled');
  assert.equal(f.calls(), 1);
});
test('reject unknown evidence, markup, unexpected fields, secret, truncation and upstream failures', async t => {
  let kind;
  const f = await local(t, { variant: () => kind });
  const cookie = await login(f);
  for (kind of ['unknown','html','extra','secret','truncated','upstream_error','timeout']) {
    f.advance();
    const res = await post(f, '/api/analyze', { caseId: 'prototype' }, cookie);
    assert.equal(res.status, 502, kind);
    assert.deepEqual(await res.json(), { error: 'ANALYSIS_FAILED' });
  }
  assert.equal(f.calls(), 7);
});
test('concurrent requests, durable cooldown and hard 100-attempt cap across reopen', async t => {
  const f = await local(t);
  const cookie = await login(f);
  const outcomes = await Promise.all(Array.from({ length: 4 },
    () => post(f, '/api/analyze', { caseId: 'prototype' }, cookie)));
  assert.deepEqual(outcomes.map(x => x.status).sort(), [200,429,429,429]);
  const second = openLedger(f.dbPath, 'controlled-test');
  assert.equal(second.claim(f.readTime()), 'RATE_LIMITED');
  for (let i = 1; i < MAX_CALLS; i++) {
    f.advance();
    assert.equal(second.claim(f.readTime()), 'OK');
  }
  second.close();
  const reopened = openLedger(f.dbPath, 'controlled-test');
  try { assert.equal(reopened.claim(f.readTime() + 25_000), 'BUDGET_EXHAUSTED'); }
  finally { reopened.close(); }
  f.advance();
  const blocked = await post(f, '/api/analyze', { caseId: 'prototype' }, cookie);
  assert.equal((await blocked.json()).error, 'BUDGET_EXHAUSTED');
  assert.equal(f.calls(), 1);
});
test('review cutoff, brute-force guard and cloud configuration closed by default', async t => {
  const f = await local(t, { closeAfterMs: 100_000 });
  for (let i = 0; i < 8; i++) {
    assert.equal((await post(f, '/api/login', { username: f.user, password: 'wrong' })).status, 401);
  }
  assert.equal((await post(f, '/api/login', { username: f.user, password: f.password })).status, 429);
  f.advance(65_000);
  await login(f);
  f.advance(40_000);
  assert.equal((await fetch(f.origin + '/')).status, 503);
  assert.equal((await fetch(f.origin + '/healthz')).status, 200);
  const env = { REVIEW_MODE:'cloud', REVIEW_USERNAME:'reviewer', REVIEW_ORIGIN:'https://example.invalid',
    REVIEW_PASSWORD_SCRYPT:'a'.repeat(32) + ':' + 'b'.repeat(64),
    REVIEW_EXPIRES_AT:new Date(Date.now() + 60_000).toISOString() };
  assert.throws(() => config(env), /CLOUD_GATE_NOT_CONFIGURED/);
  assert.throws(() => config({ ...env, REVIEW_VOLUME_VERIFIED:'1', REVIEW_ENABLE_MODEL:'1' }), /MODEL_KEY_REQUIRED/);
  assert.equal(config({ ...env, REVIEW_VOLUME_VERIFIED:'1' }).secure, true);
});
