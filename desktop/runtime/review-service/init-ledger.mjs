import { initializeLedger, ledgerLocation } from './budget.mjs';
try {
  const { file, run } = ledgerLocation();
  initializeLedger(file, run);
  console.log('Review quota ledger initialized');
} catch {
  console.error('Ledger provisioning denied. Use a new dedicated directory and file.');
  process.exitCode = 1;
}
