import { DatabaseSync } from 'node:sqlite';
import { closeSync, openSync, lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('./', import.meta.url));
export const MAX_CALLS = 100;
export const COOLDOWN_MS = 12_000;
export function ledgerLocation(env = process.env) {
  const file = env.REVIEW_LEDGER_PATH;
  const run = env.REVIEW_RUN_ID;
  if (!file || !path.isAbsolute(file) || path.basename(file) !== 'review-quota.sqlite' ||
      !/^[a-z0-9-]{8,40}$/.test(run ?? '')) throw Error('LEDGER_CONFIG_REQUIRED');
  const parent = path.dirname(file);
  const resolved = realpathSync(parent);
  const rel = path.relative(project, resolved);
  if (!path.isAbsolute(rel) && !rel.startsWith('..' + path.sep) && rel !== '..') {
    throw Error('LEDGER_OUTSIDE_PROJECT_REQUIRED');
  }
  return { file: path.join(resolved, path.basename(file)), run };
}

export function initializeLedger(file, run) {
  // An explicit, exclusive provisioning step. Normal startup never creates a quota file.
  closeSync(openSync(file, 'wx', 0o600));
  const db = new DatabaseSync(file);
  try {
    db.exec('PRAGMA synchronous=FULL; CREATE TABLE review_meta (run TEXT NOT NULL); CREATE TABLE review_attempt (id INTEGER PRIMARY KEY, ts INTEGER NOT NULL) STRICT;');
    db.prepare('INSERT INTO review_meta VALUES (?)').run(run);
  } finally {
    db.close();
  }
}

export function openLedger(file, run) {
  if (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()) throw Error('LEDGER_NOT_REGULAR_FILE');
  const db = new DatabaseSync(file);
  try {
    db.exec('PRAGMA busy_timeout=1500; PRAGMA synchronous=FULL;');
    const metadata = db.prepare('SELECT run FROM review_meta').all();
    if (metadata.length !== 1 || metadata[0].run !== run) throw Error('LEDGER_RUN_MISMATCH');
    const totals = db.prepare('SELECT count(*) AS n, max(ts) AS last FROM review_attempt');
    totals.get();
    const insert = db.prepare('INSERT INTO review_attempt(ts) VALUES (?)');
    return {
      claim(now) {
        db.exec('BEGIN IMMEDIATE');
        try {
          const { n, last } = totals.get();
          if (n >= MAX_CALLS) { db.exec('ROLLBACK'); return 'BUDGET_EXHAUSTED'; }
          if (last !== null && now - last < COOLDOWN_MS) { db.exec('ROLLBACK'); return 'RATE_LIMITED'; }
          insert.run(now);
          db.exec('COMMIT');
          return 'OK';
        } catch (error) {
          if (db.isTransaction) db.exec('ROLLBACK');
          throw error;
        }
      },
      close() { db.close(); },
    };
  } catch (error) {
    db.close();
    throw error;
  }
}
