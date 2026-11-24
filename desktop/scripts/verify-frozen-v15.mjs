// Windows build gate. Read-only inspection of the FINAL frozen V1.5 desktop source.
// Does not mutate frozen source. When a final hotfix differs, stop instead of guessing.
import {readFile,writeFile,stat,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const input=process.argv[2];if(!input)throw Error('FINAL_FROZEN_V15_SOURCE_NOT_PROVIDED');
const frozen=path.resolve(input);
const localPkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
const frozenPkg=JSON.parse(await readFile(path.join(frozen,'package.json'),'utf8').catch(()=>{throw Error('V15_DESKTOP_PACKAGE_NOT_FOUND');}));
if(localPkg.version!=='2.0.0'||frozenPkg.version!=='1.5.0')throw Error('SOURCE_VERSION_MISMATCH');
const rel=[
 'runtime/review-service/server.mjs','runtime/review-service/provider.mjs',
 'runtime/review-service/cases.mjs','runtime/review-service/budget.mjs',
 'runtime/review-service/public/client.js',
 'runtime/review-service/public/graph/src/validator.js',
 'runtime/review-service/public/graph/src/graph-contract.browser.js',
 'runtime/review-service/public/graph/src/report-adapter.js',
 'runtime/review-service/public/graph/src/report-input.browser.js',
 'runtime/review-service/public/graph/src/galaxy-3d.js',
 'runtime/review-service/public/graph/src/galaxy-3d.css',
 'runtime/review-service/public/graph/vendor/cytoscape.local-3.33.1.js',
 'runtime/review-service/public/graph/fixtures/competition-synthetic-report.browser.js',
 'electron/workspace/data-store.mjs','electron/workspace/key-vault.mjs',
 'electron/workspace/model-providers.mjs','electron/update/data-migration.mjs',
];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const report={frozen,checked:[],authorizedChanges:[],unreconciled:[]};
for(const p of rel){
 const [left,right]=await Promise.all([readFile(path.join(root,p)),readFile(path.join(frozen,p))]);
 const item={file:p,v20:hash(left),frozenV15:hash(right),equal:hash(left)===hash(right)};
 report.checked.push(item);if(!item.equal){
  if(p==='electron/workspace/data-store.mjs'&&hash(right)==='4ad85dd631332a0cad3e786c36ecfcaac96bee14c93711941549cf6259317080'){report.authorizedChanges.push({...item,reason:'V1.9 authorized lifecycle/history/material archive/incremental state; original V1.8 reference matches V1.5 frozen file'});}
  else report.unreconciled.push(p);
 }
}
const text=await readFile(path.join(root,'runtime/workspace-ui/app.js'),'utf8');
if(!text.includes("from:f.get('from'),to:f.get('to')"))report.unreconciled.push('V1.4_RELATION_FORM_FIX_MISSING');
const launch=await readFile(path.join(root,'electron/launcher.mjs'),'utf8');
if(!launch.includes("window.once('ready-to-show',ensureVisible)")||!launch.includes("window.webContents.once('did-finish-load',ensureVisible)"))
 report.unreconciled.push('V1.3_WINDOW_VISIBLE_FIX_MISSING');
const uninstall=await readFile(path.join(root,'build/installer.nsh'),'utf8');
const cleanup=await readFile(path.join(root,'build/SafeRemoveAppData.ps1'),'utf8');
if(!uninstall.includes('SafeRemoveAppData.ps1')||!cleanup.includes('ReparsePoint')||!cleanup.includes('TARGET_NOT_OWNED_APPDATA'))
 report.unreconciled.push('V1.5_UNINSTALL_REPARSE_GUARD_MISSING');
// Additional Windows-only hotfix files are NOT silently assumed equal.
const sensitive=['electron/main.cjs','electron/launcher.mjs','runtime/workspace-ui/app.js','build/installer.nsh'];
report.hotfixReview=[];
for(const p of sensitive){const before=await readFile(path.join(frozen,p)).catch(()=>null);
 report.hotfixReview.push({file:p,finalV15SHA:before?hash(before):null,v20SHA:hash(await readFile(path.join(root,p)))});
}
const output=path.join(root,'release-audit','V1.5冻结基线只读对照.json');
await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2));
console.log('Provided V1.5 source (read-only) comparison:',report.checked.length,'protected files, changed:',report.unreconciled.length);
if(report.unreconciled.length){console.error('Unreconciled:',report.unreconciled);process.exitCode=1;}
else console.log('Protected business/data comparison passed, except explicitly authorized V1.9 data-store evolution. Final freeze provenance must ALSO be checked against the archived app.asar hash.');
