import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createDesktopWindow, isAllowedNavigation} from '../electron/launcher.mjs';

class FakeWebContents extends EventEmitter {
  constructor() { super(); this.openHandler=()=>({action:'allow'}); this.navigated=[]; }
  setWindowOpenHandler(handler) { this.openHandler=handler; }
  isLoading() { return false; }
}
class FakeWindow extends EventEmitter {
  constructor(options) { super(); this.options=options; this.webContents=new FakeWebContents(); this.urls=[]; this.shown=false; this.destroyed=false; }
  async loadURL(url) { this.urls.push(url); }
  isDestroyed() {return this.destroyed;}
  isVisible() {return this.shown;}
  show() {this.shown=true;}
  destroy(){this.destroyed=true; this.emit('closed');}
  reload(){this.reloaded=true;}
}
function fakeElectron() {
  const state={cookies:[],menu:null,permissionHandler:null,windows:[]};
  const e={
    BrowserWindow:class extends FakeWindow {constructor(o){super(o);state.windows.push(this)}},
    Menu:{buildFromTemplate:items=>items,setApplicationMenu:m=>{state.menu=m}},
    session:{fromPartition:p=>{state.partition=p; return {
      cookies:{set:async item=>state.cookies.push(item)},
      setPermissionRequestHandler:f=>{state.permissionHandler=f},
      setPermissionCheckHandler:f=>{state.permissionCheckHandler=f},
      webRequest:{onBeforeRequest:f=>{state.webRequest=f}},
    }}},
    dialog:{showMessageBox:async()=>{}},
    app:{getPath:()=>'/tmp/starmap-test-appdata'},
    safeStorage:{isEncryptionAvailable:()=>true,encryptString:x=>Buffer.from(x),decryptString:x=>x.toString()},
  };
  return {e,state};
}

const ORIGIN='http://127.0.0.1:41273';
test('navigation guard blocks remote, credentials, fragments and unexpected routes',()=>{
  for(const p of ['/','/graph/','/graph/3d.html','/graph/index.html']) assert.equal(isAllowedNavigation(ORIGIN+p,ORIGIN),true);
  for(const u of ['https://evil.test/','http://localhost:41273/graph/3d.html',
    `${ORIGIN}/graph/admin`,`${ORIGIN}/graph/3d.html#x`, `${ORIGIN}/?secret=1`,
    `file:///etc/passwd`,`${ORIGIN.replace('127.0.0.1','malicious:pwd@127.0.0.1')}/`]){
    assert.equal(isAllowedNavigation(u,ORIGIN),false, u);
  }
});

test('desktop window enforces sandbox and isolated session with local authenticated API',async()=>{
  const {e,state}=fakeElectron();
  let stopped=0, signIns=0;
  const serviceFactory=async()=>({
    origin:ORIGIN,
    signIn:async()=>({name:'pcca-review',value:'session'+(++signIns),path:'/',httpOnly:true,sameSite:'strict'}),
    stop:async()=>{stopped++},
  });
  const WORKSPACE='http://127.0.0.1:42374';
  let workspaceStopped=0;
  const workspaceFactory=async()=>({origin:WORKSPACE,cookie:{name:'starmap-workspace',value:'test-token',path:'/',httpOnly:true,sameSite:'strict'},stop:async()=>{workspaceStopped++}});
  const {window,restoreSession,navigate}=await createDesktopWindow(e,{serviceFactory,workspaceFactory,showWindow:true});
  assert.equal(state.partition,'audit-desktop-temporary');
  assert.equal(state.cookies.length,2);
  assert.equal(state.cookies[0].url,ORIGIN);
  assert.equal(state.cookies[0].httpOnly,true);
  assert.equal(state.permissionCheckHandler(),false);
  state.permissionHandler(null,'geolocation',allowed=>assert.equal(allowed,false));
  assert.equal(window.options.webPreferences.nodeIntegration,false);
  assert.equal(window.options.webPreferences.contextIsolation,true);
  assert.equal(window.options.webPreferences.sandbox,true);
  assert.equal(window.options.webPreferences.webSecurity,true);
  assert.equal(window.options.webPreferences.devTools,false);
  assert.equal(window.options.webPreferences.webviewTag,false);
  assert.equal(window.urls[0],WORKSPACE+'/app/');
  assert.equal(window.shown,true);
  let denied=false;window.webContents.emit('will-navigate',{preventDefault(){denied=true}},'https://evil.test');assert.equal(denied,true);
  assert.equal(window.webContents.openHandler({url:'https://evil.test'}).action,'deny');
  await navigate('/graph/','legacy'); assert.equal(window.urls.at(-1),ORIGIN+'/graph/');
  await restoreSession();assert.equal(state.cookies.length,3);
  assert.equal(window.urls.at(-1),ORIGIN+'/graph/3d.html');
  assert.ok(state.menu.some(i=>i.label==='工作区'));
  assert.equal(isAllowedNavigation(WORKSPACE+'/app/',{workspace:WORKSPACE,legacy:ORIGIN}),true);
  assert.equal(isAllowedNavigation('https://evil.test/',{workspace:WORKSPACE,legacy:ORIGIN}),false);
  window.destroy(); await new Promise(r=>setImmediate(r)); assert.equal(stopped,1); assert.equal(workspaceStopped,1);
});
