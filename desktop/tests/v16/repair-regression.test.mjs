import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateAssets,REQUIRED,MANIFEST_SCHEMA,MEDIAPIPE_VERSION,MODEL_URL,digest} from '../../scripts/gesture-assets.mjs';
import {gestureResourceReady} from '../../electron/workspace/workspace-service.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
test('manifest guards complete matched JS/WASM/model/license (not only file size)',async()=>{
 const tmp=await mkdtemp(path.join(os.tmpdir(),'starmap-v16-repair-'));
 const vendor=path.join(tmp,'gesture','vendor');
 try{
  assert.equal((await validateAssets(vendor)).ok,false);
  const files=[];for(const file of REQUIRED){
   const bytes=Buffer.alloc(file.endsWith('hand_landmarker.task')?1_200_000:3000,file.endsWith('hand_landmarker.task')?6:3);
   await mkdir(path.dirname(path.join(vendor,file)),{recursive:true});await writeFile(path.join(vendor,file),bytes);
   files.push({file,size:bytes.length,sha256:digest(bytes)});
  }
  const modelSHA=files.find(f=>f.file.endsWith('hand_landmarker.task')).sha256;
  const manifest={schema:MANIFEST_SCHEMA,package:'@mediapipe/tasks-vision',version:MEDIAPIPE_VERSION,modelSource:MODEL_URL,files};
  await writeFile(path.join(vendor,'ASSET_MANIFEST.json'),JSON.stringify(manifest));
  assert.equal((await validateAssets(vendor,{modelSHA})).ok,true);
  assert.equal(await gestureResourceReady(tmp),false,'release runtime always requires the genuine official pinned model');
  await writeFile(path.join(vendor,'vision_bundle.mjs'),'TAMPERED');
  assert.equal((await validateAssets(vendor,{modelSHA})).reason,'TOO_SMALL');
  await writeFile(path.join(vendor,'vision_bundle.mjs'),Buffer.alloc(3000,7));
  assert.equal((await validateAssets(vendor,{modelSHA})).reason,'ASSET_HASH_MISMATCH');
 }finally{await rm(tmp,{recursive:true,force:true});}
});
test('packaged UI and version no longer claim V1.5',async()=>{
 const html=await readFile(path.join(root,'runtime/workspace-ui/index.html'),'utf8');
 const manifest=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
 assert.equal(manifest.version,'2.0.0');assert.match(html,/当前版本 V2\.0\.0/);
 assert.doesNotMatch(html,/当前版本 V1\.5\.0/);
 assert.doesNotMatch(html,/WORKSPACE <span>·<\/span> V1\.5/);
});
test('windows build cannot release without validated freeze, lockfile, resources and app.asar contents',async()=>{
 const ps=await readFile(path.join(root,'Windows_V2.0_构建并复验.ps1'),'utf8');
 for(const term of ['FINAL_V15_DESKTOP_REQUIRED','npm.cmd ci','prepare:gestures','verify:winpackage','RELEASE_ROOT_NOT_CLEAN','D:\\E盘下载中转区'])
 assert.ok(ps.includes(term),'missing: '+term);
});
test('camera UI preserves camera errors and explains absent resources',async()=>{
 const src=await readFile(path.join(root,'runtime/workspace-ui/gesture/gesture-controller.mjs'),'utf8');
 assert.match(src,/本机识别模型未就绪/);assert.match(src,/this.stop\(\);this.setStatus\(message,'error'\)/);
});
