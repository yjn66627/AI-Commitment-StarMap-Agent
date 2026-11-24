import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { randomBytes, scryptSync } from 'node:crypto';

const password = randomBytes(18).toString('base64url');
const salt = randomBytes(16);
const port = 45519;
const origin = 'http://127.0.0.1:' + port;
const config = {
  PORT: String(port), REVIEW_USERNAME: 'reviewer-local',
  REVIEW_PASSWORD_SCRYPT: salt.toString('hex') + ':' + scryptSync(password, salt, 32).toString('hex'),
  REVIEW_EXPIRES_AT: new Date(Date.now() + 60_000).toISOString(),
  REVIEW_ENABLE_MODEL: '0',
};
const child = spawn(process.execPath, ['server.mjs'], { windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'], env: config });
const exit = once(child, 'exit');
try {
  await Promise.race([
    new Promise((resolve, reject) => {
      child.stdout.on('data', data => { if (data.toString().includes('Mode: disabled')) resolve(); });
      child.once('exit', () => reject(Error('STARTUP_FAILED')));
      setTimeout(() => reject(Error('STARTUP_TIMEOUT')), 5000).unref();
    }),
  ]);
  assert.equal((await fetch(origin + '/healthz')).status, 200);
  const request = (route, body, headers = {}) => fetch(origin + route, {
    method: 'POST', headers: { origin, 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const r = await request('/api/login', { username: config.REVIEW_USERNAME, password });
  assert.equal(r.status, 200);
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const denied = await request('/api/analyze', { caseId: 'prototype' }, { cookie });
  assert.equal(denied.status, 503);
  assert.deepEqual(await denied.json(), { error: 'MODEL_DISABLED' });
  console.log('LOCAL_PASS standalone production entry, synthetic reviewer login and fail-closed model off');
} finally {
  child.kill();
  await exit;
}
