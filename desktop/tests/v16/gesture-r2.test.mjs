import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {DEFAULT_GESTURE_SETTINGS,normalizeGestureSettings,GestureInterpreter} from '../../runtime/workspace-ui/gesture/gesture-math.mjs';
import {startWorkspaceService} from '../../electron/workspace/workspace-service.mjs';
import {KeyVault} from '../../electron/workspace/key-vault.mjs';

const control={...DEFAULT_GESTURE_SETTINGS,horizontal:1.9,vertical:2.3,hitRadius:63,pointer:1.2};
test('R2 settings are bounded, finite, boolean only, independent per axis',()=>{
 assert.equal(normalizeGestureSettings(control).horizontal,1.9);
 for(const bad of [{horizontal:99},{vertical:NaN},{holdMs:0},{hitRadius:-8},{invertX:'false'},{unexpected:true},null,[]]){
   assert.throws(()=>normalizeGestureSettings(bad));
 }
 const p=new GestureInterpreter(control);assert.equal(p.settings.vertical,2.3);
 p.configure({...control,vertical:1});assert.equal(p.settings.vertical,1);
});
test('R2 preference endpoints require authenticated session and origin; saved data survive restart',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'starmap-r2-prefs-'));
 let svc;try{
   svc=await startWorkspaceService({dataDir:dir,vault:new KeyVault(dir,{isEncryptionAvailable:()=>false})});
   const url=svc.origin,headers={cookie:`starmap-workspace=${svc.cookie.value}`,'content-type':'application/json','x-starmap-desktop':'1',origin:url};
   const route='/api/workspace/gesture/preferences';
   assert.equal((await fetch(url+route)).status,401);
   assert.equal((await fetch(url+route,{headers:{cookie:headers.cookie}})).status,200);
   assert.equal((await fetch(url+route,{method:'POST',headers:{...headers,origin:'http://attacker.invalid'},body:JSON.stringify(control)})).status,403);
   assert.equal((await fetch(url+route,{method:'POST',headers,body:JSON.stringify({...control,hitRadius:10000})})).status,400);
   let saved=await fetch(url+route,{method:'POST',headers,body:JSON.stringify(control)});
   assert.equal(saved.status,200);assert.deepEqual((await saved.json()).preferences,control);
   let get=await fetch(url+route,{headers:{cookie:headers.cookie}});
   assert.deepEqual((await get.json()).preferences,control);
   await svc.stop();svc=null;
   svc=await startWorkspaceService({dataDir:dir,vault:new KeyVault(dir,{isEncryptionAvailable:()=>false})});
   get=await fetch(svc.origin+route,{headers:{cookie:`starmap-workspace=${svc.cookie.value}`}});
   assert.deepEqual((await get.json()).preferences,control);
   assert.deepEqual(JSON.parse(await readFile(path.join(dir,'gesture-preferences.json'),'utf8')),control);
 }finally{await svc?.stop();await rm(dir,{recursive:true,force:true});}
});
test('R2 lesson controls and cursor have real UI wiring without uploading frames',async()=>{
 const root=new URL('../../runtime/workspace-ui/',import.meta.url);
 const html=await readFile(new URL('index.html',root),'utf8');
 const script=await readFile(new URL('gesture/gesture-controller.mjs',root),'utf8');
 const guide=await readFile(new URL('gesture/gesture-guide.mjs',root),'utf8');
 const css=await readFile(new URL('app.css',root),'utf8');
 for(const id of ['gesture-guide','gesture-settings','gesture-cursor','gesture-status','gesture-toggle']) assert.ok(html.includes(`id="${id}"`));
 assert.match(script,/this\.graph\.previewByGesture/);assert.match(script,/saveSettings/);
 for(const word of ['左右旋转','上下旋转','双手缩放','捏合选中与切换','反转上下旋转方向','捏合确认时长'])assert.ok(guide.includes(word));
 assert.match(css,/\.gesture-cursor\[hidden\]/);
 assert.doesNotMatch(script,/fetch\([^\n]*api\/(?:upload|camera)/);
});
