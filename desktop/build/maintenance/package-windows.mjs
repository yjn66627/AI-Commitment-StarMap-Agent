import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { UUID } from 'builder-util-runtime';

if (process.platform !== 'win32') throw Error('Windows x64 build required');
const tool = process.env.STARMAP_MAKENSIS;
if (!tool || !path.isAbsolute(tool)) throw Error('Set STARMAP_MAKENSIS to an absolute makensis.exe path');
const output = path.resolve('release/installer-support');
const payload = path.resolve('release/win-unpacked');
mkdirSync(output, { recursive: true });

function list(current) {
  return readdirSync(current, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(current, entry.name);
    if (entry.isDirectory()) return list(file);
    if (entry.isFile()) return [file];
    throw Error('Unexpected nonregular build file');
  });
}

const manifest = path.join(output, 'payload.sha256');
const entries = list(payload).sort().map(file => {
  const hash = createHash('sha256').update(readFileSync(file)).digest('hex').toUpperCase();
  return hash + ' ' + path.relative(payload, file);
});
writeFileSync(manifest, entries.join('\n') + '\n');
const helper = path.join(output, 'InstallGuard.exe');
const legacy = path.join(output, 'LegacyInstaller.cs');
const guid = UUID.v5('com.yjn.aicommitmentstarmap.desktop', UUID.parse('50e065bc-3134-11e6-9bab-38c9862bdaf3'));
writeFileSync(legacy, 'internal static class LegacyInstaller { internal const string Guid = "' + guid + '"; }\n');
const csc = path.join(process.env.SystemRoot, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
execFileSync(csc, ['/nologo', '/platform:x64', '/optimize+', '/out:' + helper,
  '/resource:' + manifest + ',Payload', path.resolve('build/maintenance/InstallGuard.cs'), legacy], { stdio: 'inherit' });
const compilerLog = execFileSync(tool, ['/V4','/NOCD','build/installer.nsh'], { encoding: 'utf8' });
process.stdout.write(compilerLog);
if (!/^Install:.*\b1 section\b/m.test(compilerLog) || !/^Uninstall:.*\b1 section\b/m.test(compilerLog))
  throw Error('Expected exactly one compiled install section and one compiled uninstall section');



