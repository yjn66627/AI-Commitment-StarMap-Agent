'use strict';
const electron=require('electron');
if (!electron || !electron.app) throw Error('ELECTRON_RUNTIME_REQUIRED');
// V2.0 reuses the frozen V1.5 NSIS identity for in-place upgrades. Never invoke legacy Squirrel startup hooks.
// Persist across V1.5 and future versions under this constant per-user directory.
const path=require('node:path');
const fs=require('node:fs');
const app=electron.app;
const profile=path.join(app.getPath('appData'),'AICommitmentStarMap-Production');
fs.mkdirSync(profile,{recursive:true});
app.setPath('userData',profile);
if(process.platform==='win32')app.setAppUserModelId('com.yjn.aicommitmentstarmap.desktop');
import('./launcher.mjs').then(({launchDesktop})=>launchDesktop(electron))
 .catch(error=>{console.error('Desktop startup failed:',error.code||error.message);app.quit();});
