// Electron independent adapter to the original review-service business API.
// The imported makeReviewServer(), provider and quota ledger remain unmodified.
import { randomBytes, scryptSync } from 'node:crypto';
import { once } from 'node:events';
import { makeReviewServer } from '../runtime/review-service/server.mjs';
import { createProvider } from '../runtime/review-service/provider.mjs';
import { ledgerLocation, openLedger } from '../runtime/review-service/budget.mjs';

const SESSION_HOURS = 12;

function makeVerifier(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

function requireLiveSettings(env) {
  if (env.STARMAP_ENABLE_MODEL !== '1') return { live: false, ledger: null, analyze: null };
  if (!/^sk-[A-Za-z0-9_-]{16,256}$/.test(env.DEEPSEEK_API_KEY || '')) throw Error('MODEL_KEY_REQUIRED');
  // Safeguard: original quota ledger must already exist and pass the original validation.
  const {file, run} = ledgerLocation(env);
  const ledger = openLedger(file, run);
  return { live: true, ledger, analyze: createProvider(env.DEEPSEEK_API_KEY) };
}

export async function startDesktopService({env = process.env, enableModel = false, log = () => {}} = {}) {
  // Deliberately inert unless an operator explicitly opts in AND supplies the
  // existing validated DeepSeek quota ledger. No credentials ship with this app.
  const config = requireLiveSettings(enableModel ? env : {});
  const password = randomBytes(32).toString('base64url');
  const user = 'local-' + randomBytes(6).toString('hex');
  let origin;
  const server = makeReviewServer({
    origin: () => origin,
    secure: false,
    user,
    verifier: makeVerifier(password),
    expires: Date.now() + SESSION_HOURS * 3600_000,
    ledger: config.ledger,
    analyze: config.analyze,
    mode: config.live ? 'live' : 'disabled',
    log,
  });
  server.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
  } catch (error) {
    config.ledger?.close();
    throw error;
  }
  const socket = server.address();
  if (!socket || typeof socket === 'string' || !Number.isInteger(socket.port)) {
    server.close();
    config.ledger?.close();
    throw Error('LOCAL_SERVER_ADDRESS_FAILED');
  }
  origin = `http://127.0.0.1:${socket.port}`;
  let closed = false;
  async function signIn() {
    if (closed) throw Error('SERVICE_CLOSED');
    const response = await fetch(`${origin}/api/login`, {
      method: 'POST',
      redirect: 'error',
      headers: {'Origin': origin, 'Content-Type': 'application/json'},
      body: JSON.stringify({username:user,password}),
      signal: AbortSignal.timeout(4500),
    });
    if (!response.ok) throw Error('LOCAL_SESSION_LOGIN_FAILED');
    const header = response.headers.get('set-cookie') || '';
    const match = /^pcca-review=([^;]+);/.exec(header);
    if (!match || !/^[A-Za-z0-9_-]+$/.test(match[1])) throw Error('LOCAL_SESSION_COOKIE_MISSING');
    return { name:'pcca-review', value:match[1], path:'/', httpOnly:true, sameSite:'strict' };
  }
  async function stop() {
    if (closed) return;
    closed = true;
    await new Promise(resolve => server.close(() => resolve()));
    config.ledger?.close();
  }
  return {origin, server, signIn, stop, live:config.live};
}
