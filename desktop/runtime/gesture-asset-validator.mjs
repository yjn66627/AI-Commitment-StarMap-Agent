// Node-side verifier, shipped inside the Electron runtime.
// Every released artifact must carry the official pinned model + matched MediaPipe JS/WASM pair.
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'workspace-ui/gesture/vendor');
export const MODEL_URL='https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
export const MODEL_SHA='fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1';
export const MEDIAPIPE_VERSION='0.10.35';
export const MANIFEST_SCHEMA='starmap-gesture-assets/v2';
export const REQUIRED=Object.freeze([
  'vision_bundle.mjs',
  'models/hand_landmarker.task',
  'wasm/vision_wasm_internal.js',
  'wasm/vision_wasm_internal.wasm',
  'wasm/vision_wasm_nosimd_internal.js',
  'wasm/vision_wasm_nosimd_internal.wasm',
  'MediaPipe_LICENSE.txt',
]);
export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function validateAssets(root=ROOT,{modelSHA=MODEL_SHA}={}){
  let manifest;
  try{manifest=JSON.parse(await readFile(path.join(root,'ASSET_MANIFEST.json'),'utf8'));}
  catch{return {ok:false,reason:'MANIFEST_MISSING_OR_INVALID',file:'ASSET_MANIFEST.json'};}
  if(manifest?.schema!==MANIFEST_SCHEMA||manifest.package!=='@mediapipe/tasks-vision'||manifest.version!==MEDIAPIPE_VERSION||
     manifest.modelSource!==MODEL_URL||!Array.isArray(manifest.files)||manifest.files.length!==REQUIRED.length)
    return {ok:false,reason:'MANIFEST_SCHEMA_INVALID'};
  const actualNames=manifest.files.map(x=>x?.file);
  if(JSON.stringify(actualNames)!==JSON.stringify(REQUIRED))return {ok:false,reason:'ASSET_LIST_MISMATCH'};
  const details=[];
  for(let i=0;i<REQUIRED.length;i++){
    const file=REQUIRED[i],record=manifest.files[i];let bytes;
    try{bytes=await readFile(path.join(root,...file.split('/')));}catch{return {ok:false,reason:'MISSING',file};}
    if(bytes.length<(file==='MediaPipe_LICENSE.txt'?50:1000))return {ok:false,reason:'TOO_SMALL',file};
    const sha256=digest(bytes);if(record?.size!==bytes.length||record?.sha256!==sha256)return {ok:false,reason:'ASSET_HASH_MISMATCH',file};
    if(file.endsWith('hand_landmarker.task')&&(sha256!==modelSHA||bytes.length<1_000_000))return {ok:false,reason:'MODEL_HASH_MISMATCH',file};
    details.push({file,size:bytes.length,sha256});
  }
  return {ok:true,details};
}
