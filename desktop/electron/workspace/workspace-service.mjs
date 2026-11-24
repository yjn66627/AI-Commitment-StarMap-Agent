import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
import {readFile,writeFile,rename} from 'node:fs/promises';
import {randomBytes as newBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {ProjectStore} from './data-store.mjs';
import {normalizeGestureSettings,DEFAULT_GESTURE_SETTINGS} from '../../runtime/workspace-ui/gesture/gesture-math.mjs';
import {validateAssets} from '../../runtime/gesture-asset-validator.mjs';
import {publicProviders,callModel,makePrompt,parseProposals} from './model-providers.mjs';
import {activeEvidence,selectIncremental,makeIncrementalPrompt,parseIncrementalOutput} from './incremental.mjs';
import {revision} from './journal.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const frontend=path.resolve(here,'../../runtime/workspace-ui');
const allowStatic=new Map([['/app/',['index.html','text/html; charset=utf-8']],['/app/app.css',['app.css','text/css; charset=utf-8']],['/app/app.js',['app.js','application/javascript; charset=utf-8']],['/app/graph.js',['graph.js','application/javascript; charset=utf-8']]]);
// Exact static route map. No arbitrary file reads or filesystem path parameters.
const gesturePaths=new Map([
  ['/app/gesture/gesture-math.mjs',['gesture/gesture-math.mjs','text/javascript; charset=utf-8']],
  ['/app/gesture/gesture-controller.mjs',['gesture/gesture-controller.mjs','text/javascript; charset=utf-8']],
  ['/app/gesture/vision-adapter.mjs',['gesture/vision-adapter.mjs','text/javascript; charset=utf-8']],
  ['/app/gesture/gesture-guide.mjs',['gesture/gesture-guide.mjs','text/javascript; charset=utf-8']],
  ['/app/gesture/vendor/vision_bundle.mjs',['gesture/vendor/vision_bundle.mjs','text/javascript; charset=utf-8']],
  ['/app/gesture/vendor/models/hand_landmarker.task',['gesture/vendor/models/hand_landmarker.task','application/octet-stream']],
  ...['vision_wasm_internal.js','vision_wasm_internal.wasm','vision_wasm_nosimd_internal.js','vision_wasm_nosimd_internal.wasm']
    .map(name=>['/app/gesture/vendor/wasm/'+name,['gesture/vendor/wasm/'+name,name.endsWith('.wasm')?'application/wasm':'text/javascript; charset=utf-8']]),
]);
export async function gestureResourceReady(frontendDir=frontend){
  const result=await validateAssets(path.join(frontendDir,'gesture','vendor'));
  return result.ok;
}

const visibleCode=new Set(['STORE_TOO_LARGE','HISTORY_PHYSICAL_DELETE_DENIED','UPGRADE_BACKUP_CONFLICT','PROJECT_NOT_FOUND','TITLE_REQUIRED','SOURCE_INVALID','HISTORY_INVALID','HISTORY_LIMIT','MODEL_CHANGE_INVALID','INCREMENTAL_STATE_INVALID','INCREMENTAL_STALE','CHANGE_LIMIT','CHANGE_NOT_PENDING','PROPOSAL_STALE','HISTORY_POSITION_INVALID','LINK_REVISION_INVALID','LINK_RETIRED','LINK_NOT_FOUND','CLAIM_NOT_FOUND','CONFIRMED_CLAIM_REQUIRED','LIFECYCLE_INVALID','CHANGE_EVIDENCE_REQUIRED','SOURCE_NOT_FOUND','SOURCE_IMPACT_CHANGED','SOURCE_NOT_ARCHIVED','QUOTE_INVALID','QUOTE_NOT_IN_SOURCE','CLAIM_INVALID','MODEL_NOT_CONFIGURED','API_KEY_REQUIRED','SECURE_STORAGE_UNAVAILABLE','MODEL_CONFIG_INVALID','PROVIDER_UNSUPPORTED','MODEL_ID_INVALID','HTTPS_PUBLIC_ENDPOINT_REQUIRED','MODEL_HTTP_401','MODEL_HTTP_403','MODEL_HTTP_404','MODEL_HTTP_429','MODEL_TIMEOUT','EVIDENCE_REQUIRED','MODEL_EVIDENCE_VALIDATION_FAILED','MODEL_JSON_INVALID','MODEL_SCHEMA_INVALID','MODEL_RESPONSE_INVALID','MODEL_DISABLED','IMPORT_FORMAT_UNSUPPORTED','PROJECT_LIMIT','SOURCE_LIMIT','EVIDENCE_LIMIT','CLAIM_LIMIT','LINK_LIMIT','LINK_REFERENCES_INVALID','DECISION_INVALID','OUTBOUND_PRIVATE_ADDRESS_DENIED','GESTURE_PREFS_INVALID']);
const fail=(c,s=400)=>{const e=new Error(c);e.status=s;throw e;};
function send(res,code,value,extra={}){res.writeHead(code,{'content-type':'application/json; charset=utf-8',...extra});res.end(JSON.stringify(value));}
async function bodyJSON(req,max=230000){if(!/^application\/json(?:;\s*charset=utf-8)?$/i.test(req.headers['content-type']||'')||req.headers['content-encoding'])fail('JSON_REQUIRED',415);const chunks=[];let count=0;for await(const b of req){count+=b.length;if(count>max)fail('BODY_TOO_LARGE',413);chunks.push(b);}try{const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!data||typeof data!=='object'||Array.isArray(data))fail('JSON_OBJECT_REQUIRED');return data;}catch(e){if(e.status)throw e;fail('INVALID_JSON');}}
function requireFields(body,allowed){if(Object.keys(body).some(k=>!allowed.includes(k)))fail('UNEXPECTED_FIELDS');}
export async function startWorkspaceService({dataDir,vault,releases=null,migrationStatus=null,runModel=callModel,log=()=>{}}){
  const store=new ProjectStore(path.join(dataDir,'workspace'));await store.init();
  const prefsFile=path.join(dataDir,'update-preferences.json');
  const readPrefs=async()=>{try{const p=JSON.parse(await readFile(prefsFile,'utf8'));return {autoCheck:p.autoCheck===true};}catch(e){if(e.code==='ENOENT')return {autoCheck:false};throw e;}};
  const updatePrefs=async(autoCheck)=>{if(typeof autoCheck!=='boolean')fail('UPDATE_PREFERENCES_INVALID');const temp=prefsFile+'.'+newBytes(4).toString('hex')+'.tmp';await writeFile(temp,JSON.stringify({autoCheck}),{flag:'wx',mode:0o600});await rename(temp,prefsFile);return {autoCheck};};
  // Camera tuning is purely local and non-secret. Store it outside the app install tree.
  const gesturePrefsFile=path.join(dataDir,'gesture-preferences.json');
  const readGesturePrefs=async()=>{
    try{return normalizeGestureSettings(JSON.parse(await readFile(gesturePrefsFile,'utf8')));}
    catch(e){if(e.code==='ENOENT')return {...DEFAULT_GESTURE_SETTINGS};throw e;}
  };
  const saveGesturePrefs=async(prefs)=>{
    const normalized=normalizeGestureSettings(prefs);
    const temp=gesturePrefsFile+'.'+newBytes(5).toString('hex')+'.tmp';
    try{await writeFile(temp,JSON.stringify(normalized,null,2),{flag:'wx',mode:0o600});await rename(temp,gesturePrefsFile);}
    finally{try{await import('node:fs/promises').then(fs=>fs.unlink(temp));}catch(e){if(e.code!=='ENOENT')throw e;}}
    return normalized;
  };
  const initialPrefs=await readPrefs();
  const session=randomBytes(32).toString('base64url');
  let origin,closed=false,modelBusy=false;
  const server=createServer({maxHeaderSize:8192,headersTimeout:10000,requestTimeout:60000},async(req,res)=>{
    const requestOrigin=req.headers.origin;
    res.setHeader('cache-control','no-store');res.setHeader('x-content-type-options','nosniff');res.setHeader('referrer-policy','no-referrer');res.setHeader('x-frame-options','DENY');
    res.setHeader('content-security-policy',"default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; connect-src 'self'; img-src 'self' data:; media-src 'self' blob:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    try{
      // Loopback addresses are still exposed to other processes. Demand our session cookie for every resource.
      if(req.headers.host!==new URL(origin).host)fail('HOST_DENIED',403);
      const cookie=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('starmap-workspace='))?.slice('starmap-workspace='.length);
      if(cookie!==session)fail('SESSION_REQUIRED',401);
      if(!['GET','POST'].includes(req.method))fail('METHOD_DENIED',405);
      if(req.method==='POST'&&(requestOrigin!==origin||req.headers['x-starmap-desktop']!=='1'))fail('ORIGIN_DENIED',403);
      const rawUrl=new URL(req.url,origin),route=rawUrl.pathname;
      if(req.url.length>512)fail('ROUTE_INVALID');
      if(rawUrl.searchParams.size>1)fail('ROUTE_INVALID');
      if(req.method==='GET'&&allowStatic.has(route)&&!rawUrl.search){const [file,mime]=allowStatic.get(route);res.writeHead(200,{'content-type':mime});return res.end(await readFile(path.join(frontend,file)));}
      if(req.method==='GET'&&route==='/app/gesture/status.json'&&!rawUrl.search){return send(res,200,{ready:await gestureResourceReady(),source:'bundled-local-only'});}
      if(req.method==='GET'&&gesturePaths.has(route)&&!rawUrl.search){
        const [file,mime]=gesturePaths.get(route);
        try{const bytes=await readFile(path.join(frontend,file));res.writeHead(200,{'content-type':mime});return res.end(bytes);}
        catch(error){if(error.code==='ENOENT')fail('HAND_ASSET_NOT_INSTALLED',404);throw error;}
      }

      if(!route.startsWith('/api/workspace/'))fail('NOT_FOUND',404);
      const key=route.slice('/api/workspace/'.length);
      if(req.method==='GET'){
        if(key==='bootstrap'){if(rawUrl.search)fail('ROUTE_INVALID');return send(res,200,{projects:await store.list(),providers:publicProviders(),settings:await vault.publicSettings(),migrationStatus});}
        if(key==='history'){if(rawUrl.searchParams.size!==1)fail('PROJECT_ID_REQUIRED');return send(res,200,{history:await store.history(rawUrl.searchParams.get('id'))});}
        if(key==='project'){if(rawUrl.searchParams.size!==1)fail('PROJECT_ID_REQUIRED');return send(res,200,{project:await store.get(rawUrl.searchParams.get('id'))});}
        if(key==='export'){if(rawUrl.searchParams.size!==1)fail('PROJECT_ID_REQUIRED');const output=await store.exportProject(rawUrl.searchParams.get('id'));return send(res,200,output,{'content-disposition':'attachment; filename="starmap-project.json"'});}
        if(key==='gesture/preferences'){if(rawUrl.search)fail('ROUTE_INVALID');return send(res,200,{preferences:await readGesturePrefs()});}
        if(key==='update/status'){if(rawUrl.search)fail('ROUTE_INVALID');return send(res,200,{update:releases?.status()||{status:'unavailable'},preferences:await readPrefs()});}
        if(key==='settings'){if(rawUrl.search)fail('ROUTE_INVALID');return send(res,200,{settings:await vault.publicSettings(),providers:publicProviders()});}
        fail('NOT_FOUND',404);
      }
      if(rawUrl.search)fail('ROUTE_INVALID');
      const body=await bodyJSON(req,key==='import'?7*1024*1024:230000);
      switch(key){
        case 'gesture/preferences':{requireFields(body,Object.keys(DEFAULT_GESTURE_SETTINGS));return send(res,200,{preferences:await saveGesturePrefs(body)});}
        case 'update/preferences':{requireFields(body,['autoCheck']);return send(res,200,{preferences:await updatePrefs(body.autoCheck)});}
        case 'update/check':{requireFields(body,[]);if(!releases)fail('UPDATES_UNAVAILABLE',503);return send(res,200,{update:await releases.check()});}
        case 'update/open':{requireFields(body,[]);if(!releases)fail('UPDATES_UNAVAILABLE',503);return send(res,200,await releases.open());}
        case 'project/create':requireFields(body,['title']);return send(res,200,{project:await store.create(body.title)});
        case 'project/remove':requireFields(body,['projectId']);return send(res,200,await store.remove(body.projectId));
        case 'import':requireFields(body,['payload']);return send(res,200,{project:await store.importProject(body.payload)});
        case 'source/add':requireFields(body,['projectId','name','content']);return send(res,200,{source:await store.addSource(body.projectId,body.name,body.content)});
        case 'source/impact':requireFields(body,['projectId','sourceId']);return send(res,200,{impact:await store.sourceImpact(body.projectId,body.sourceId)});
        case 'source/archive':requireFields(body,['projectId','sourceId','token']);return send(res,200,{source:await store.archiveSource(body.projectId,body.sourceId,body.token)});
        case 'source/restore':requireFields(body,['projectId','sourceId']);return send(res,200,{source:await store.restoreSource(body.projectId,body.sourceId)});
        case 'source/rename':requireFields(body,['projectId','sourceId','name']);return send(res,200,{source:await store.renameSource(body.projectId,body.sourceId,body.name)});
        case 'evidence/add':requireFields(body,['projectId','sourceId','quote']);return send(res,200,{evidence:await store.addEvidence(body.projectId,body.sourceId,body.quote)});
        case 'claim/add':requireFields(body,['projectId','kind','text','evidenceIds']);return send(res,200,{claim:await store.addClaim(body.projectId,body)});
        case 'claim/review':requireFields(body,['projectId','claimId','decision']);return send(res,200,{claim:await store.reviewClaim(body.projectId,body.claimId,body.decision)});
        case 'claim/lifecycle':requireFields(body,['projectId','claimId','status','owner','due','evidenceIds','reason']);return send(res,200,{claim:await store.updateClaimLifecycle(body.projectId,body.claimId,body)});
        case 'link/add':requireFields(body,['projectId','from','to','kind','evidenceIds']);return send(res,200,{link:await store.addLink(body.projectId,body)});
        case 'link/revise':requireFields(body,['projectId','linkId','from','to','kind','active','evidenceIds','reason']);return send(res,200,{link:await store.reviseLink(body.projectId,body.linkId,body)});
        case 'history/snapshot':requireFields(body,['projectId','seq']);return send(res,200,{project:await store.snapshot(body.projectId,body.seq)});
        case 'link/review':requireFields(body,['projectId','linkId','decision']);return send(res,200,{link:await store.reviewLink(body.projectId,body.linkId,body.decision)});
        case 'settings/save':requireFields(body,['provider','model','endpoint','apiKey']);return send(res,200,{settings:await vault.save(body)});
        case 'settings/delete-key':requireFields(body,['provider']);return send(res,200,{settings:await vault.deleteKey(body.provider)});
        case 'ai/test':{
          requireFields(body,[]);
          if(modelBusy)fail('MODEL_BUSY',429);modelBusy=true;
          try{const {config,key:apiKey}=await vault.active();const text=await runModel(config,apiKey,'请只用中文回复：连接正常。');return send(res,200,{ok:true,provider:config.provider,model:config.model,response:text.slice(0,300)});}finally{modelBusy=false;}
        }
        case 'ai/incremental':{
          requireFields(body,['projectId']);if(modelBusy)fail('MODEL_BUSY',429);modelBusy=true;
          try{const p=await store.get(body.projectId),plan=selectIncremental(p);if(!plan.batch.length)return send(res,200,{added:0,changes:0,processed:0,remaining:0,coverage:plan.coverage,noNewEvidence:true});const {config,key:apiKey}=await vault.active();const text=await runModel(config,apiKey,makeIncrementalPrompt(plan));const parsed=parseIncrementalOutput(text,p,plan);return send(res,200,await store.addIncrementalResults(body.projectId,plan,parsed,config.provider));}finally{modelBusy=false;}
        }
        case 'ai/change/review':requireFields(body,['projectId','changeId','decision']);return send(res,200,{change:await store.reviewChange(body.projectId,body.changeId,body.decision)});
        case 'ai/analyze':{
          requireFields(body,['projectId']);
          if(modelBusy)fail('MODEL_BUSY',429);modelBusy=true;
          try{
            const project=await store.get(body.projectId);
            const evidence=activeEvidence(project).slice(0,30);
            if(!evidence.length)fail('EVIDENCE_REQUIRED');
            const {config,key:apiKey}=await vault.active();const text=await runModel(config,apiKey,makePrompt(evidence));
            const candidates=parseProposals(text,evidence);
            const saved=await store.addAIClaims(body.projectId,candidates,config.provider,revision(project));
            return send(res,200,{added:saved.length,ids:saved.map(x=>x.id),provider:config.provider,review:'pending'});
          }finally{modelBusy=false;}
        }
        default:fail('NOT_FOUND',404);
      }
    }catch(e){if(!res.headersSent){const code=e.status||(/_LIMIT|TOO_LARGE/.test(e.message)?413:400);const msg=visibleCode.has(e.message)?e.message:e.status?e.message:'OPERATION_FAILED';send(res,code,{error:msg});}log({event:'request_failed',route:req.url?.split('?')[0],error:e.code||e.message?.replace(/sk-[A-Za-z0-9_-]+/g,'[redacted]').slice(0,70)});}
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');origin='http://127.0.0.1:'+server.address().port;
  if(initialPrefs.autoCheck&&releases){void releases.check().catch(()=>{});}
  return {origin,store,cookie:{name:'starmap-workspace',value:session,path:'/',httpOnly:true,sameSite:'strict'},stop:async()=>{if(closed)return;closed=true;await new Promise(r=>server.close(r));}};
}
