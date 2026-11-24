// Run AFTER electron-builder, BEFORE any public handoff. It inspects bytes in packaged app.asar.
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {extractFile} from '@electron/asar';
import {digest,MODEL_SHA,REQUIRED,MANIFEST_SCHEMA,MEDIAPIPE_VERSION} from './gesture-assets.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../release');
const appAsar=process.env.STARMAP_APP_ASAR||path.join(root,'win-unpacked','resources','app.asar');
await stat(appAsar).catch(()=>{throw Error('PACKAGED_APP_ASAR_NOT_FOUND: '+appAsar);});
const get=file=>extractFile(appAsar,path.normalize(file));
const prefix='runtime/workspace-ui/gesture/vendor/';
const manifest=JSON.parse(get(prefix+'ASSET_MANIFEST.json').toString('utf8'));
if(manifest.schema!==MANIFEST_SCHEMA||manifest.version!==MEDIAPIPE_VERSION||manifest.files.length!==REQUIRED.length)throw Error('PACKAGED_MANIFEST_INVALID');
for(const [i,file] of REQUIRED.entries()){
  const b=get(prefix+file),declared=manifest.files[i];
  if(declared.file!==file||declared.size!==b.length||declared.sha256!==digest(b))throw Error('PACKAGED_ASSET_MISMATCH: '+file);
  if(file.endsWith('hand_landmarker.task')&&digest(b)!==MODEL_SHA)throw Error('PACKAGED_MODEL_HASH_INVALID');
}
const pkg=JSON.parse(get('package.json').toString('utf8'));
if(pkg.version!=='2.0.0')throw Error('PACKAGED_VERSION_WRONG');
const ui=get('runtime/workspace-ui/index.html').toString('utf8');
const labels=['本地工作区 V2.0.0','WORKSPACE <span>V2.0.0</span>','WIN DESKTOP / 2.0.0','当前版本 V2.0.0','· LOCAL-FIRST WORKSPACE'];
if(labels.slice(0,4).some(label=>!ui.includes(label))||!ui.includes('LOCAL-FIRST WORKSPACE <span>·</span> V2.0.0'))throw Error('PACKAGED_STALE_VERSION_TEXT');
const expectedIcon=await readFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../assets/icon.ico'));
if(digest(get('assets/icon.ico'))!==digest(expectedIcon))throw Error('PACKAGED_ICON_HASH_MISMATCH');
console.log('Packaged Windows app.asar verified: version, model, JS/WASM, license, manifest.');
