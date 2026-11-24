import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createDesktopWindow} from '../../electron/launcher.mjs';

class FakeContents extends EventEmitter { setWindowOpenHandler(){} isLoading(){return false;} }
class FakeWindow extends EventEmitter {
  constructor(opts){super();this.options=opts;this.webContents=new FakeContents();this.destroyed=false;this.shown=false;}
  async loadURL(url){this.url=url;}
  isDestroyed(){return this.destroyed;}
  isVisible(){return this.shown;}
  show(){this.shown=true;}
  destroy(){this.destroyed=true;this.emit('closed');}
}
function fixture(){
  const flags={permission:null,check:null,stopEvents:new Map(),dialogs:[],view:null};
  const e={
    BrowserWindow:class extends FakeWindow{constructor(opts){super(opts);flags.view=this;}},
    Menu:{buildFromTemplate:x=>x,setApplicationMenu:()=>{}},
    ipcMain:{on:(name,fn)=>flags.stopEvents.set(name,fn)},
    session:{fromPartition:()=>({cookies:{set:async()=>{}},setPermissionRequestHandler:x=>flags.permission=x,setPermissionCheckHandler:x=>flags.check=x,webRequest:{onBeforeRequest:()=>{}}})},
    dialog:{showMessageBox:async(_win,opts)=>{flags.dialogs.push(opts);return {response:0};}},
    safeStorage:{isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()},
    app:{getPath:()=>'/tmp/v16-camera-security',getVersion:()=> '1.6.0'},
  };
  return {flags,e};
}
test('electron permits only user-approved local camera, never microphone/screen/remote',async()=>{
 const {flags,e}=fixture();let stopped=0;
 const fake=(origin)=>async()=>({origin,cookie:{name:'cookie',value:'A'},signIn:async()=>({name:'demo',value:'secret'}),stop:async()=>{stopped++}});
 const current=await createDesktopWindow(e,{serviceFactory:fake('http://127.0.0.1:4555'),workspaceFactory:fake('http://127.0.0.1:5444'),showWindow:false});
 const wc=flags.view.webContents,req=(type,url,mediaTypes)=>new Promise(resolve=>flags.permission(wc,type,resolve,{requestingUrl:url,mediaTypes}));
 assert.equal(await req('media','http://127.0.0.1:5444/app/',['audio']),false);
 assert.equal(await req('media','https://evil.example/app/',['video']),false);
 assert.equal(await req('display-capture','http://127.0.0.1:5444/app/',['video']),false);
 assert.equal(flags.dialogs.length,0);
 assert.equal(await req('media','http://127.0.0.1:5444/app/',['video']),true);
 assert.equal(flags.dialogs.length,1);
 assert.match(flags.dialogs[0].message,/摄像头/);
 assert.equal(flags.check(wc,'media','http://127.0.0.1:5444',{mediaType:'video'}),true);
 assert.equal(flags.check(wc,'media','http://127.0.0.1:5444',{mediaType:'audio'}),false);
 flags.stopEvents.get('starmap-camera-stopped')({sender:wc});
 assert.equal(flags.check(wc,'media','http://127.0.0.1:5444',{mediaType:'video'}),false);
 await req('media','http://127.0.0.1:5444/app/',['video']);
 wc.emit('will-navigate',{preventDefault:()=>{}},'https://evil.example/');
 assert.equal(flags.check(wc,'media','http://127.0.0.1:5444',{mediaType:'video'}),false);
 flags.view.destroy();assert.equal(stopped,2);
});
