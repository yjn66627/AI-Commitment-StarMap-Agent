import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {startWorkspaceService} from '../../electron/workspace/workspace-service.mjs';
import {KeyVault} from '../../electron/workspace/key-vault.mjs';
test('V1.8 deletion route selects exact project ID even for duplicate titles, rejects unauthenticated requests, persists only intended deletion',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'starmap-v18-delete-'));let svc;
 try{
  const start=()=>startWorkspaceService({dataDir:dir,vault:new KeyVault(dir,{isEncryptionAvailable:()=>false})});svc=await start();
  const req=async(route,body,overrides={})=>fetch(svc.origin+'/api/workspace/'+route,{method:body?'POST':'GET',headers:{cookie:`${svc.cookie.name}=${svc.cookie.value}`,origin:svc.origin,'x-starmap-desktop':'1','content-type':'application/json',...overrides},body:body?JSON.stringify(body):undefined});
  const a=(await (await req('project/create',{title:'同名测试项目'})).json()).project;const b=(await (await req('project/create',{title:'同名测试项目'})).json()).project;
  await req('source/add',{projectId:a.id,name:'A',content:'保留原文'});await req('source/add',{projectId:b.id,name:'B',content:'独立删除原文'});
  assert.equal((await req('project/remove',{projectId:b.id},{cookie:''})).status,401);
  assert.equal((await req('project/remove',{projectId:b.id},{origin:'http://attacker.invalid'})).status,403);
  assert.equal((await (await req('bootstrap')).json()).projects.length,2);
  assert.equal((await req('project/remove',{projectId:b.id})).status,200);
  assert.equal((await (await req('project?id='+a.id)).json()).project.sources[0].content,'保留原文');
  await svc.stop();svc=await start();assert.deepEqual((await (await req('bootstrap')).json()).projects.map(p=>p.id),[a.id]);
 }finally{await svc?.stop();await rm(dir,{recursive:true,force:true});}
});
