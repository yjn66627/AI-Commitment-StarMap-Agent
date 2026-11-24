import { createServer } from 'node:http';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { cases } from './cases.mjs';
import { createProvider, MODEL } from './provider.mjs';
import { ledgerLocation, openLedger } from './budget.mjs';

const verifyPassword = promisify(scrypt);
const HALF_HOUR = 30 * 60_000;
const cookieName = 'pcca-review';
const publicFiles = new Set(['/', '/style.css', '/client.js']);
const graphFiles = new Set(['/graph/', '/graph/index.html', '/graph/3d.html', '/graph/src/galaxy-3d.js', '/graph/src/galaxy-3d.css',
  '/graph/src/styles.css', '/graph/src/app.js', '/graph/src/competition-flow.js',
  '/graph/src/graph-contract.browser.js', '/graph/src/report-adapter.js',
  '/graph/src/report-input.browser.js', '/graph/src/stage-b-config.js', '/graph/src/validator.js',
  '/graph/fixtures/competition-synthetic-report.browser.js', '/graph/fixtures/synthetic-valid.browser.js',
  '/graph/vendor/cytoscape.local-3.33.1.js', '/graph/vendor/CYTOSCAPE_LICENSE_MIT.txt']);
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.txt': 'text/plain' };
const root = fileURLToPath(new URL('./public/', import.meta.url));
const basicPolicy = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'";

class RequestError extends Error {
  constructor(status, code) { super(code); this.status = status; }
}
function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}
async function readBody(req, keys) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? '') ||
      req.headers['content-encoding']) throw new RequestError(415, 'JSON_REQUIRED');
  const chunks = [];
  let bytes = 0;
  for await (const part of req.iterator({ destroyOnReturn: false })) {
    bytes += part.length;
    if (bytes > 1024) throw new RequestError(413, 'BODY_TOO_LARGE');
    chunks.push(part);
  }
  let body;
  try {
    body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } catch { throw new RequestError(400, 'BAD_JSON'); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).sort().join(',') !== keys) {
    throw new RequestError(400, 'INVALID_FIELDS');
  }
  return body;
}

export function makeReviewServer({ origin, secure, user, verifier, expires, ledger, analyze, mode,
                                   now = Date.now, log = console.log }) {
  const sessions = new Map();
  const [salt, expected] = verifier.split(':').map(x => Buffer.from(x, 'hex'));
  let attempts = [];
  let busy = false;
  const setSession = (res, id, maxAge) => res.setHeader('set-cookie',
    `${cookieName}=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`);
  const server = createServer({ maxHeaderSize: 8 * 1024, headersTimeout: 10_000, requestTimeout: 15_000 }, async (req, res) => {
    const route = req.url;
    const graph = graphFiles.has(route);
    const time = now();
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('x-frame-options', 'DENY');
    res.setHeader('content-security-policy', basicPolicy + (graph ? "; connect-src 'none'" : "; connect-src 'self'"));
    if (secure) res.setHeader('strict-transport-security', 'max-age=86400');
    try {
      if (route === '/healthz' && req.method === 'GET') return send(res, 200, { status: 'up' });
      if (time >= expires) throw new RequestError(503, 'REVIEW_CLOSED');
      const token = (req.headers.cookie ?? '').split(';').map(x => x.trim())
        .find(x => x.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
      for (const [id, end] of sessions) if (end <= time) sessions.delete(id);
      const signedIn = token && sessions.has(token);
      if (req.method === 'GET' && (publicFiles.has(route) || graph)) {
        if (graph && !signedIn) throw new RequestError(401, 'LOGIN_REQUIRED');
        const file = route === '/' ? 'index.html' : route === '/graph/' ? 'graph/index.html' : route.slice(1);
        const data = await readFile(path.join(root, file));
        res.writeHead(200, { 'content-type': types[path.extname(file)] + '; charset=utf-8' });
        return res.end(data);
      }
      if (req.method === 'POST' && req.headers.origin !== (typeof origin === 'function' ? origin() : origin)) throw new RequestError(403, 'ORIGIN_DENIED');
      if (req.method === 'POST' && route === '/api/login') {
        attempts = attempts.filter(t => time - t < 60_000);
        if (attempts.length >= 8) throw new RequestError(429, 'LOGIN_LIMIT');
        attempts.push(time);
        const body = await readBody(req, 'password,username');
        if (typeof body.password !== 'string' || body.password.length > 128 ||
            typeof body.username !== 'string' || body.username.length > 40) throw new RequestError(400, 'INVALID_FIELDS');
        const derived = await verifyPassword(body.password, salt, 32);
        if (!timingSafeEqual(derived, expected) || body.username !== user) throw new RequestError(401, 'LOGIN_FAILED');
        if (sessions.size >= 32) throw new RequestError(429, 'SESSION_LIMIT');
        if (signedIn) sessions.delete(token);
        const id = randomBytes(32).toString('base64url');
        sessions.set(id, Math.min(time + HALF_HOUR, expires));
        setSession(res, id, Math.floor((Math.min(time + HALF_HOUR, expires) - time) / 1000));
        return send(res, 200, { ok: true });
      }
      if (!route?.startsWith('/api/')) throw new RequestError(404, 'NOT_FOUND');
      if (!signedIn) throw new RequestError(401, 'LOGIN_REQUIRED');
      if (req.method === 'GET' && route === '/api/cases') return send(res, 200, { mode, cases });
      if (req.method === 'POST' && route === '/api/logout') {
        await readBody(req, '');
        sessions.delete(token);
        setSession(res, '', 0);
        return send(res, 200, { ok: true });
      }
      if (req.method !== 'POST' || route !== '/api/analyze') throw new RequestError(404, 'NOT_FOUND');
      const body = await readBody(req, 'caseId');
      const example = cases.find(item => item.id === body.caseId);
      if (!example) throw new RequestError(400, 'INVALID_CASE');
      if (!analyze) throw new RequestError(503, 'MODEL_DISABLED');
      if (busy) throw new RequestError(429, 'RATE_LIMITED');
      busy = true;
      try {
        const claimedAt = now();
        if (claimedAt >= expires) throw new RequestError(503, 'REVIEW_CLOSED');
        let budget;
        try { budget = ledger.claim(claimedAt); }
        catch { throw new RequestError(503, 'LEDGER_UNAVAILABLE'); }
        if (budget !== 'OK') throw new RequestError(429, budget);
        try {
          const result = await analyze(example);
          log(JSON.stringify({ event: 'analysis', mode, caseId: example.id, status: 'ok' }));
          return send(res, 200, { result, caseId: example.id, mode, model: mode === 'live' ? MODEL : null });
        } catch {
          log(JSON.stringify({ event: 'analysis', mode, caseId: example.id, status: 'failed' }));
          throw new RequestError(502, 'ANALYSIS_FAILED');
        }
      } finally { busy = false; }
    } catch (err) {
      if (!res.headersSent) {
        if (!req.complete) res.setHeader('connection', 'close');
        if (!(err instanceof RequestError)) log(JSON.stringify({ event: 'internal_error' }));
        send(res, err instanceof RequestError ? err.status : 500,
          { error: err instanceof RequestError ? err.message : 'INTERNAL_ERROR' });
      } else { res.end(); }
    }
  });
  return server;
}

export function config(env, now = Date.now()) {
  const port = Number(env.PORT ?? 45519);
  const user = env.REVIEW_USERNAME;
  const verifier = env.REVIEW_PASSWORD_SCRYPT;
  const cloud = env.REVIEW_MODE === 'cloud';
  const windowsTunnel = env.REVIEW_MODE === 'windows-tunnel';
  const origin = env.REVIEW_ORIGIN ?? 'http://127.0.0.1:' + port;
  const expires = Date.parse(env.REVIEW_EXPIRES_AT);
  const maxWindow = (windowsTunnel ? 92 : 7) * 86400_000;
  if (!Number.isInteger(port) || port < 1 || port > 65535 ||
      !/^[a-z0-9_-]{3,40}$/.test(user ?? '') || !/^[0-9a-f]{32}:[0-9a-f]{64}$/.test(verifier ?? '') ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(env.REVIEW_EXPIRES_AT ?? '') ||
      !Number.isFinite(expires) || expires <= now || expires - now > maxWindow) throw Error('REVIEW_CONFIG_INVALID');
  if (cloud) {
    const url = new URL(origin);
    if (url.origin !== origin || url.protocol !== 'https:' || !url.hostname.includes('.') ||
        env.REVIEW_VOLUME_VERIFIED !== '1') throw Error('CLOUD_GATE_NOT_CONFIGURED');
  } else if (windowsTunnel) {
    if (origin !== 'https://review-handoff.example.invalid') throw Error('TUNNEL_ORIGIN_DENIED');
  } else if (origin !== 'http://127.0.0.1:' + port) throw Error('LOOPBACK_REQUIRED');
  const live = env.REVIEW_ENABLE_MODEL === '1';
  if (live && !/^sk-[A-Za-z0-9_-]{16,256}$/.test(env.DEEPSEEK_API_KEY ?? '')) throw Error('MODEL_KEY_REQUIRED');
  return { origin, user, verifier, expires, port, secure: cloud || windowsTunnel, live, host: cloud ? '0.0.0.0' : '127.0.0.1' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = config(process.env);
    const ledger = options.live ? (() => {
      const { file, run } = ledgerLocation();
      return openLedger(file, run);
    })() : null;
    const server = makeReviewServer({ ...options, ledger, mode: options.live ? 'live' : 'disabled',
      analyze: options.live ? createProvider(process.env.DEEPSEEK_API_KEY) : null });
    server.on('error', () => { console.error('Review listener failed'); process.exitCode = 1; ledger?.close(); });
    server.listen(options.port, options.host, () => console.log('Review listener ready. Mode: ' + (options.live ? 'live' : 'disabled')));
    const shutdown = () => server.close(() => ledger?.close());
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  } catch {
    console.error('Review startup denied. Check explicit settings and the dedicated quota ledger.');
    process.exitCode = 1;
  }
}
