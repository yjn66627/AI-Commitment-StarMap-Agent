import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fixture } from './fixture.mjs';
import { config } from '../server.mjs';
import { MAX_CALLS, COOLDOWN_MS, openLedger } from '../budget.mjs';

async function post(f, route, body, cookie) {
  return fetch(f.origin + route, {
    method: 'POST',
    headers: { origin: f.origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

async function login(f) {
  const response = await post(f, '/api/login', { username: f.user, password: f.password });
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie').split(';')[0];
}

test('request 100 reaches Mock Provider, request 101 is refused across sessions and reopen', async t => {
  assert.equal(MAX_CALLS, 100);
  const f = await fixture();
  t.after(() => f.close());
  for (let i = 0; i < 98; i++) {
    f.advance();
    assert.equal(f.ledger.claim(f.readTime()), 'OK');
  }
  f.advance();
  const cookie1 = await login(f);
  const cookie2 = await login(f);
  const send = cookie => post(f, '/api/analyze', { caseId: 'prototype' }, cookie);
  assert.equal((await send(cookie1)).status, 200);
  const rateLimited = await send(cookie2);
  assert.equal(rateLimited.status, 429);
  assert.deepEqual(await rateLimited.json(), { error: 'RATE_LIMITED' });
  f.advance(COOLDOWN_MS);
  assert.equal((await send(cookie2)).status, 200);
  f.advance();
  const blocked = await send(cookie1);
  assert.equal(blocked.status, 429);
  assert.deepEqual(await blocked.json(), { error: 'BUDGET_EXHAUSTED' });
  assert.equal(f.calls(), 2);
  const reopened = openLedger(f.dbPath, 'controlled-test');
  try { assert.equal(reopened.claim(f.readTime()), 'BUDGET_EXHAUSTED'); }
  finally { reopened.close(); }
  const db = new DatabaseSync(f.dbPath, { readOnly: true });
  try { assert.equal(db.prepare('SELECT count(*) AS n FROM review_attempt').get().n, 100); }
  finally { db.close(); }
});

test('Windows tunnel accepts the three-month cutoff and rejects requests at the cutoff', async t => {
  const oldStart = Date.parse('2026-11-10T10:40:03.691Z');
  const expiry = '2027-02-10T10:40:03.691Z';
  const env = {
    PORT:'45529', REVIEW_MODE:'windows-tunnel', REVIEW_ORIGIN:'https://review-handoff.example.invalid',
    REVIEW_USERNAME:'reviewer', REVIEW_PASSWORD_SCRYPT:'a'.repeat(32) + ':' + 'b'.repeat(64),
    REVIEW_EXPIRES_AT:expiry,
  };
  const c = config(env, oldStart);
  assert.equal(c.expires, Date.parse(expiry));
  assert.equal(c.host, '127.0.0.1');
  assert.equal(c.secure, true);
  assert.throws(() => config(env, c.expires), /REVIEW_CONFIG_INVALID/);
  assert.throws(() => config({...env, REVIEW_EXPIRES_AT:'2027-02-11T10:40:03.691Z'}, oldStart), /REVIEW_CONFIG_INVALID/);
  assert.throws(() => config({...env, REVIEW_ORIGIN:'https://other.invalid'}, oldStart), /TUNNEL_ORIGIN_DENIED/);
  assert.throws(() => config({...env, REVIEW_MODE:'cloud'}, oldStart), /REVIEW_CONFIG_INVALID/);

  const windowMs = 120_000;
  const f = await fixture({ closeAfterMs:windowMs });
  t.after(() => f.close());
  const cookie = await login(f);
  f.advance(windowMs - 1);
  assert.equal((await fetch(f.origin + '/api/cases', { headers:{cookie} })).status, 200);
  f.advance(1);
  for (const route of ['/', '/api/cases', '/graph/']) {
    const response = await fetch(f.origin + route, { headers:{cookie} });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {error:'REVIEW_CLOSED'});
  }
  assert.equal((await post(f, '/api/login', {username:f.user, password:f.password})).status, 503);
  assert.equal((await post(f, '/api/analyze', {caseId:'prototype'}, cookie)).status, 503);
  assert.equal(f.calls(), 0);
});
