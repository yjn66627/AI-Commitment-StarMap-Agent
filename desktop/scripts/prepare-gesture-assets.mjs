// Build-time only. Entire asset set is staged, SHA-256 checked, and atomically swapped.
// Previously validated assets are reusable without network or node_modules access.
import {copyFile,mkdir,readFile,readdir,writeFile,rename,rm,stat} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {request} from 'node:https';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ROOT,MODEL_SHA,MODEL_URL,MEDIAPIPE_VERSION,MANIFEST_SCHEMA,REQUIRED,digest,validateAssets} from './gesture-assets.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const moduleRoot=path.resolve(here,'../node_modules/@mediapipe/tasks-vision');
async function downloadModel(){
  if(process.env.GESTURE_MODEL_FILE)return readFile(process.env.GESTURE_MODEL_FILE);
  return new Promise((resolve,reject)=>{
    const chunks=[];let size=0;
    const req=request(MODEL_URL,{timeout:25000,headers:{'User-Agent':'StarMap-OfflineModelAssetBuilder/1.6'}},response=>{
      if(response.statusCode!==200){response.resume();reject(Error('MODEL_DOWNLOAD_HTTP_'+response.statusCode));return;}
      response.on('data',b=>{size+=b.length;if(size>12*1024*1024){req.destroy(Error('MODEL_TOO_LARGE'));return;}chunks.push(b);});
      response.once('end',()=>resolve(Buffer.concat(chunks)));response.once('error',reject);
    });req.once('timeout',()=>req.destroy(Error('MODEL_DOWNLOAD_TIMEOUT')));req.once('error',reject);req.end();
  });
}
const existing=await validateAssets();
if(existing.ok){console.log('Gesture assets already verified; reusing complete offline bundle.');process.exit(0);}
const packageInfo=JSON.parse(await readFile(path.join(moduleRoot,'package.json'),'utf8').catch(()=>{throw Error('MEDIAPIPE_NPM_NOT_INSTALLED: run npm ci');}));
if(packageInfo.name!=='@mediapipe/tasks-vision'||packageInfo.version!==MEDIAPIPE_VERSION)throw Error('MEDIAPIPE_NPM_VERSION_MISMATCH');
const packageFile=path.join(moduleRoot,'vision_bundle.mjs');await stat(packageFile);
const wasmRoot=path.join(moduleRoot,'wasm');
const wasmNames=REQUIRED.filter(x=>x.startsWith('wasm/')).map(x=>x.slice(5));
const available=await readdir(wasmRoot);
for(const name of wasmNames)if(!available.includes(name))throw Error('MEDIAPIPE_WASM_INCOMPLETE: '+name);
const model=await downloadModel();
if(model.length<1_000_000||digest(model)!==MODEL_SHA)throw Error('MODEL_SHA256_INVALID');
const rootParent=path.dirname(ROOT),suffix=randomBytes(6).toString('hex');
const stage=path.join(rootParent,'vendor-stage-'+suffix),backup=path.join(rootParent,'vendor-backup-'+suffix);
let oldMoved=false,newMoved=false;
try{
  await mkdir(path.join(stage,'models'),{recursive:true});await mkdir(path.join(stage,'wasm'),{recursive:true});
  await copyFile(packageFile,path.join(stage,'vision_bundle.mjs'));
  for(const name of wasmNames)await copyFile(path.join(wasmRoot,name),path.join(stage,'wasm',name));
  let hasLicense=false;
  for(const name of ['LICENSE','LICENSE.txt']){
    try{await copyFile(path.join(moduleRoot,name),path.join(stage,'MediaPipe_LICENSE.txt'));hasLicense=true;break;}
    catch(e){if(e.code!=='ENOENT')throw e;}
  }
  if(!hasLicense)throw Error('MEDIAPIPE_LICENSE_MISSING');
  await writeFile(path.join(stage,'models','hand_landmarker.task'),model,{flag:'wx'});
  const files=[];
  for(const file of REQUIRED){const bytes=await readFile(path.join(stage,...file.split('/')));files.push({file,size:bytes.length,sha256:digest(bytes)});}
  await writeFile(path.join(stage,'ASSET_MANIFEST.json'),JSON.stringify({schema:MANIFEST_SCHEMA,package:'@mediapipe/tasks-vision',version:MEDIAPIPE_VERSION,modelSource:MODEL_URL,files},null,2));
  const verified=await validateAssets(stage);if(!verified.ok)throw Error('STAGED_ASSET_FAILED: '+verified.reason);
  // Preserve original README in the vendor folder, but do not treat it as a runtime dependency.
  try{await copyFile(path.join(ROOT,'README_识别模型构建说明.txt'),path.join(stage,'README_识别模型构建说明.txt'));}catch(e){if(e.code!=='ENOENT')throw e;}
  try{await rename(ROOT,backup);oldMoved=true;}catch(e){if(e.code!=='ENOENT')throw e;}
  try{await rename(stage,ROOT);newMoved=true;}
  catch(e){if(oldMoved){await rename(backup,ROOT);oldMoved=false;}throw e;}
  const final=await validateAssets();if(!final.ok)throw Error('PUBLISHED_ASSET_FAILED: '+final.reason);
  if(oldMoved){await rm(backup,{recursive:true,force:true});oldMoved=false;}
  console.log('Pinned MediaPipe model, JS, WASM and license staged, manifest verified.');
}catch(e){
  if(newMoved&&oldMoved){await rm(ROOT,{recursive:true,force:true});await rename(backup,ROOT);oldMoved=false;}
  throw e;
}finally{
  await rm(stage,{recursive:true,force:true});
  // On failure, never erase an existing vendor backup that might be needed for manual recovery.
}
