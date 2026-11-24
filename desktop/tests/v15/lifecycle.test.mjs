import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {newerThan,parseRelease,queryRelease,verifiedReleaseUrl,createReleaseManager} from '../../electron/update/release-check.mjs';
import {ensureProfileAndMigrate,DATA_ROOT_NAME,DATA_MARKER} from '../../electron/update/data-migration.mjs';
import {ProjectStore} from '../../electron/workspace/data-store.mjs';
import {KeyVault} from '../../electron/workspace/key-vault.mjs';
import {startWorkspaceService} from '../../electron/workspace/workspace-service.mjs';
const temp=()=>mkdtemp(path.join(os.tmpdir(),'starmap-v15-'));
const release={tag_name:'v1.6.0',html_url:'https://github.com/yjn66627/AI-Commitment-StarMap/releases/tag/v1.6.0',draft:false,prerelease:false,body:'版本更新说明'};
test('release comparator is strictly newer, stable, and bound to our repo',()=>{
 assert.equal(newerThan('v1.6.0','1.5.0'),true);assert.equal(newerThan('1.4.0','1.5.0'),false);
 assert.equal(newerThan('v1.5.0','1.5.0'),false);assert.equal(newerThan('1.3.99','1.4.0'),false);
 assert.equal(parseRelease(release,'1.5.0').available,true);
 for(const obj of [{...release,draft:true},{...release,prerelease:true},{...release,html_url:'https://evil.test/v1.6.0'},{...release,tag_name:'../foo'}])assert.throws(()=>parseRelease(obj,'1.5.0'));
 for(const url of ['https://github.com/yjn66627/AI-Commitment-StarMap/releases/tag/v1.6.0','https://github.com/yjn66627/AI-Commitment-StarMap/releases/tag/1.6.0'])assert.equal(verifiedReleaseUrl(url),true);
 for(const url of ['http://github.com/yjn66627/AI-Commitment-StarMap/releases/tag/v1.6.0','https://github.com/other/repo/releases/tag/v1.6.0','https://github.com/yjn66627/AI-Commitment-StarMap/releases/tag/v1.6.0?redirect=https://evil.test','https://github.com.evil.test/yjn66627/AI-Commitment-StarMap/releases/tag/v1.6.0'])assert.equal(verifiedReleaseUrl(url),false);
});
test('release check is opt-in, restricts redirects, and never downloads/executes binaries',async()=>{
 let opened=null,requested=0;
 const fetchImpl=async(url,opts)=>{requested++;assert.equal(opts.redirect,'error');assert.match(url,/api.github.com/);return {ok:true,headers:{get:()=> 'application/json'},text:async()=>JSON.stringify(release)};};
 const m=createReleaseManager({fetchImpl,currentVersion:'1.5.0',openExternal:async u=>{opened=u;}});
 assert.equal(m.status().status,'idle');assert.equal(requested,0);await assert.rejects(()=>m.open(),/UNVERIFIED/);
 const response=await m.check();assert.equal(requested,1);assert.equal(response.available,true);await m.open();assert.equal(opened,release.html_url);
 const fetchResult=await queryRelease({fetchImpl,currentVersion:'1.7.0'});assert.equal(fetchResult.available,false);
});
test('failed release check does not leave previously discovered URL actionable',async()=>{
 let nth=0,opened=0;
 const m=createReleaseManager({fetchImpl:async()=>{nth++;if(nth===1)return {ok:true,headers:{get:()=>''},text:async()=>JSON.stringify(release)};throw Error('NETWORK_FAIL');},openExternal:async()=>opened++});
 await m.check();await m.check();assert.equal(m.status().status,'error');await assert.rejects(()=>m.open(),/UNVERIFIED/);assert.equal(opened,0);
});
test('migration copies V1.4 data without changing source, and is idempotent',async()=>{
 const root=await temp();try{
 const legacy=path.join(root,'AI承诺审计星图-智能体','v14-local'),dest=path.join(root,DATA_ROOT_NAME);
 const db=new ProjectStore(path.join(legacy,'workspace'));await db.init();const p=await db.create('老项目');const s=await db.addSource(p.id,'会议纪要','周五交付原型并验收');await db.addEvidence(p.id,s.id,'周五交付原型');
 const encrypted={version:1,selected:'deepseek',profiles:{deepseek:{provider:'deepseek',model:'deepseek-chat',secret:Buffer.from('ENCRYPTED-DPAPI-STUB').toString('base64')}}};
 await writeFile(path.join(legacy,'ai-profiles.json'),JSON.stringify(encrypted));
 const before=await readFile(db.file);const keyBefore=await readFile(path.join(legacy,'ai-profiles.json'));
 const result=await ensureProfileAndMigrate({appData:root,userData:dest});assert.equal(result.status,'migrated');assert.equal(result.projectCount,1);
 assert.deepEqual(await readFile(db.file),before);assert.deepEqual(await readFile(path.join(legacy,'ai-profiles.json')),keyBefore);
 const migrated=new ProjectStore(path.join(dest,'local','workspace'));assert.equal((await migrated.list())[0].title,'老项目');
 assert.deepEqual(await readFile(path.join(dest,'local','ai-profiles.json')),keyBefore);
 await migrated.create('V1.5新增项目');assert.equal((await migrated.list()).length,2);
 assert.equal((await ensureProfileAndMigrate({appData:root,userData:dest})).status,'already-initialized');assert.equal((await migrated.list()).length,2);
 assert.match((await readFile(path.join(dest,DATA_MARKER),'utf8')),/OWNED_PROFILE_V15/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('migration rejects tampered provenance; leaves V1.4 intact and never imports plaintext secrets',async()=>{
 const root=await temp();try{
 const old=path.join(root,'AI承诺审计星图-智能体','v14-local');const db=new ProjectStore(path.join(old,'workspace'));await db.init();const p=await db.create('old');const s=await db.addSource(p.id,'source','原文证据');await db.addEvidence(p.id,s.id,'原文证据');
 const data=JSON.parse(await readFile(db.file,'utf8'));data.projects[0].sources[0].content='篡改';await writeFile(db.file,JSON.stringify(data));
 const dest=path.join(root,DATA_ROOT_NAME);await assert.rejects(()=>ensureProfileAndMigrate({appData:root,userData:dest}),/EVIDENCE_UNLOCATED/);
 await assert.rejects(()=>readFile(path.join(dest,'local','workspace','workspace.json')),/ENOENT/);
 assert.equal((await readFile(db.file,'utf8')).includes('篡改'),true);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('authenticated local update endpoints demand same cookie and CSRF, do not run installer',async()=>{
 const root=await temp();let service;try{
 const releases=createReleaseManager({fetchImpl:async()=>({ok:true,headers:{get:()=> 'application/json'},text:async()=>JSON.stringify(release)}),openExternal:async()=>{}});
 const vault=new KeyVault(root,{isEncryptionAvailable:()=>false});service=await startWorkspaceService({dataDir:root,vault,releases});
 const origin=service.origin,cookie='starmap-workspace='+service.cookie.value;
 const options={method:'POST',headers:{'origin':origin,'content-type':'application/json','x-starmap-desktop':'1','cookie':cookie},body:'{}'};
 const status=await fetch(origin+'/api/workspace/update/status',{headers:{cookie}});assert.equal(status.status,200);assert.equal((await status.json()).update.status,'idle');
 const denied=await fetch(origin+'/api/workspace/update/check',{...options,headers:{...options.headers,origin:'https://evil.test'}});assert.equal(denied.status,403);
 const result=await fetch(origin+'/api/workspace/update/check',options);assert.equal(result.status,200);assert.equal((await result.json()).update.available,true);
 const open=await fetch(origin+'/api/workspace/update/open',options);assert.equal(open.status,200);assert.deepEqual(await open.json(),{opened:true});
 }finally{await service?.stop();await rm(root,{recursive:true,force:true});}
});
test('NSIS installer mandates non-destructive default and double confirmation for deep purge',async()=>{
 const base=path.resolve(import.meta.dirname,'../..');const cfg=JSON.parse(await readFile(path.join(base,'electron-builder.json')));const nsis=await readFile(path.join(base,'build','installer.nsh'),'utf8');
 assert.equal(cfg.nsis.oneClick,false);assert.equal(cfg.nsis.deleteAppDataOnUninstall,false);assert.equal(cfg.nsis.allowToChangeInstallationDirectory,true);
 assert.equal(cfg.nsis.perMachine,false);assert.deepEqual(cfg.win.target[0].target,'nsis');assert.equal(cfg.win.verifyUpdateCodeSignature,true);
 assert.match(nsis,/IfSilent v16_no_data_cleanup/);assert.equal((nsis.match(/MessageBox MB_YESNO/g)||[]).length,2);
 assert.match(nsis,/\.starmap-owner-v15/);assert.match(nsis,/SafeRemoveAppData\.ps1/);assert.doesNotMatch(nsis,/RMDir \/r/);
 assert.doesNotMatch(nsis,/v14-local|v13-local|\$APPDATA\\AI承诺/);
 const main=await readFile(path.join(base,'electron','main.cjs'),'utf8');assert.match(main,/setPath\('userData',profile\)/);
});
test('update opt-in preference survives restart, default never phones home',async()=>{
 const root=await temp();let service,checks=0;
 try{
  const makeManager=()=>createReleaseManager({fetchImpl:async()=>{checks++;return {ok:true,headers:{get:()=> 'application/json'},text:async()=>JSON.stringify(release)};}});
  const vault=new KeyVault(root,{isEncryptionAvailable:()=>false});const firstManager=makeManager();
  service=await startWorkspaceService({dataDir:root,vault,releases:firstManager});assert.equal(checks,0);
  const origin=service.origin,cookie='starmap-workspace='+service.cookie.value;
  let result=await fetch(origin+'/api/workspace/update/status',{headers:{cookie}});assert.equal((await result.json()).preferences.autoCheck,false);
  result=await fetch(origin+'/api/workspace/update/preferences',{method:'POST',headers:{'origin':origin,'content-type':'application/json','x-starmap-desktop':'1','cookie':cookie},body:JSON.stringify({autoCheck:true})});assert.equal(result.status,200);
  await service.stop();service=null;
  const secondManager=makeManager();service=await startWorkspaceService({dataDir:root,vault,releases:secondManager});
  await new Promise(r=>setTimeout(r,40));assert.ok(checks>=1);
  const rest=await fetch(service.origin+'/api/workspace/update/status',{headers:{cookie:'starmap-workspace='+service.cookie.value}});
  assert.equal((await rest.json()).preferences.autoCheck,true);
 }finally{await service?.stop();await rm(root,{recursive:true,force:true});}
});
