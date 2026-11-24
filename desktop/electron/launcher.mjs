// V1.4 launcher retains V1.3's visible-window timing fix and untouched legacy service.
import {startDesktopService} from './desktop-service.mjs';
import {startWorkspaceService} from './workspace/workspace-service.mjs';
import {KeyVault} from './workspace/key-vault.mjs';
import path from 'node:path';
import {ensureProfileAndMigrate} from './update/data-migration.mjs';
import {createReleaseManager} from './update/release-check.mjs';

const ALLOWED_LEGACY=new Set(['/', '/graph/', '/graph/index.html', '/graph/3d.html']);
const ALLOWED_LOCAL=new Set(['/app/', '/app/app.css', '/app/app.js', '/app/graph.js']); // Gesture assets load as subresources only.
export function isAllowedNavigation(url,origins){
  try{const parsed=new URL(url);if(parsed.username||parsed.password||parsed.search||parsed.hash)return false;
    const legacy=typeof origins==='string'?origins:origins.legacy;
    const workspace=typeof origins==='string'?null:origins.workspace;
    return (parsed.origin===legacy&&ALLOWED_LEGACY.has(parsed.pathname))||(parsed.origin===workspace&&ALLOWED_LOCAL.has(parsed.pathname));
  }catch{return false;}
}
export async function createDesktopWindow(electron,{serviceFactory=startDesktopService,workspaceFactory=startWorkspaceService,showWindow=true,migrationStatus=null}={}){
  const {BrowserWindow,Menu,session,dialog,app,safeStorage}=electron;
  const releases=createReleaseManager({currentVersion:app.getVersion?.()||'2.0.0',openExternal:async url=>{if(!electron.shell?.openExternal)throw Error('EXTERNAL_OPEN_UNAVAILABLE');await electron.shell.openExternal(url);}});
  const legacy=await serviceFactory();let workspace,window;
  const partition='audit-desktop-temporary';const localSession=session.fromPartition(partition);
  let cameraGranted=false;
  let windowOrigin=null;
  const isAuthorizedCameraRequest=(webContents,permission,url,details={})=>{
    let origin;try{origin=new URL(url).origin;}catch{return false;}
    return permission==='media'&&origin===windowOrigin&&webContents===window?.webContents&&
      (details.mediaTypes?.length===1&&details.mediaTypes[0]==='video');
  };
  localSession.setPermissionRequestHandler((wc,permission,callback,details={})=>{
    if(!isAuthorizedCameraRequest(wc,permission,details.requestingUrl||'',details))return callback(false);
    void dialog.showMessageBox(window,{type:'question',buttons:['允许本次使用','拒绝'],defaultId:1,cancelId:1,
      title:'摄像头手势控制',message:'允许本次使用摄像头识别手势吗？',
      detail:'仅本机分析手部关键点，不上传画面。关闭手势或离开星图后摄像头会停止。'}).then(result=>{
      cameraGranted=result.response===0;callback(cameraGranted);
    }).catch(()=>callback(false));
  });
  if(typeof localSession.setPermissionCheckHandler==='function')localSession.setPermissionCheckHandler((wc,permission,origin,details={})=>
    permission==='media'&&cameraGranted&&wc===window?.webContents&&origin===windowOrigin&&
    (!details.mediaType||details.mediaType==='video'));

  let closed=false;
  try{
    const dataDir=path.join(app.getPath('userData'),'local');
    const vault=new KeyVault(dataDir,safeStorage);
    workspace=await workspaceFactory({dataDir,vault,releases,migrationStatus});
    const legacyCookie=await legacy.signIn();
    await localSession.cookies.set({url:legacy.origin,...legacyCookie});
    await localSession.cookies.set({url:workspace.origin,...workspace.cookie});
    window=new BrowserWindow({
      title:'AI承诺审计星图-智能体 · V2.0.0',width:1600,height:900,minWidth:1100,minHeight:700,
      show:false,autoHideMenuBar:true,backgroundColor:'#07111b',
      icon:path.resolve(import.meta.dirname||path.dirname(new URL(import.meta.url).pathname),'../assets/icon.ico'),
      webPreferences:{preload:path.resolve(import.meta.dirname||path.dirname(new URL(import.meta.url).pathname),'preload.cjs'),partition,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,webviewTag:false,allowRunningInsecureContent:false,devTools:false},
    });
    const origins={workspace:workspace.origin,legacy:legacy.origin};windowOrigin=workspace.origin;
    const revokeCamera=()=>{cameraGranted=false;};
    if(electron.ipcMain?.on)electron.ipcMain.on('starmap-camera-stopped',(event)=>{if(event.sender===window.webContents)revokeCamera();});
    window.webContents.on('will-navigate',(event,url)=>{revokeCamera();if(!isAllowedNavigation(url,origins))event.preventDefault();});
    window.webContents.on('will-redirect',(event,url)=>{if(!isAllowedNavigation(url,origins))event.preventDefault();});
    window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    // Harden network access: page may only load its app/legacy server; AI calls happen only in main process.
    localSession.webRequest.onBeforeRequest((details,callback)=>{
      const approved=details.url.startsWith(workspace.origin+'/')||details.url.startsWith(legacy.origin+'/')||
        details.url.startsWith('blob:'+workspace.origin+'/'); // local generated project exports only
      callback({cancel:!approved});
    });
    const navigate=async(route,area='workspace')=>{revokeCamera();if(!closed&&!window.isDestroyed())await window.loadURL((area==='legacy'?legacy.origin:workspace.origin)+route);};
    const restoreSession=async()=>{const cookie=await legacy.signIn();await localSession.cookies.set({url:legacy.origin,...cookie});await navigate('/graph/3d.html','legacy');};
    const menu=Menu.buildFromTemplate([
      {label:'工作区',submenu:[
        {label:'本地项目与多模型工作台',click:()=>void navigate('/app/')},
        {type:'separator'},
        {label:'原V1.3三维合成星图',click:()=>void navigate('/graph/3d.html','legacy')},
        {label:'原V1.3二维合成图谱',click:()=>void navigate('/graph/','legacy')},
        {label:'原V1.3合成案例',click:()=>void navigate('/','legacy')},
        {type:'separator'},
        {label:'恢复合成演示会话',click:()=>void restoreSession().catch(()=>void dialog.showMessageBox(window,{type:'error',message:'演示会话恢复失败，请重启软件。'}))},
        {label:'重新载入当前页面',accelerator:'CmdOrCtrl+R',click:()=>window.reload()},
      ]},
      {label:'帮助',submenu:[
        {label:'检查软件更新',click:()=>void releases.check().then(async r=>{if(window.isDestroyed())return;const text=r.status==='error'?'检查失败：'+r.errorCode:r.available?'有新版 '+r.version+' 可下载，是否打开官方GitHub发布页？':'当前版本已是最新，或尚未发布更高版本。';const result=await dialog.showMessageBox(window,{type:r.available?'question':'info',buttons:r.available?['打开官方发布页','取消']:['知道了'],defaultId:0,cancelId:r.available?1:0,message:text,detail:'未签名发行包不会被后台静默下载安装。'});if(r.available&&result.response===0)await releases.open();}).catch(()=>{})},
        {label:'数据与AI使用边界',click:()=>void dialog.showMessageBox(window,{type:'info',title:'本地数据与AI边界',message:'V2.0项目存储在本机用户目录；在线AI只在主动选择并调用时发送当前项目已定位证据。模型结论必须人工复核。旧版3D合成演示保留原GraphContract，不能当成真实业务审计结果。'})},
        {label:'退出',role:'quit'},
      ]},
    ]);
    Menu.setApplicationMenu(menu);
    // MUST register before loadURL; preserves prior Windows visible-window fix.
    let visible=false;
    const ensureVisible=()=>{if(showWindow&&!visible&&!window.isDestroyed()){visible=true;window.show();}};
    window.once('ready-to-show',ensureVisible);
    window.webContents.once('did-finish-load',ensureVisible);
    await navigate('/app/');
    if(showWindow&&window.isVisible?.()===false&&window.webContents.isLoading?.()===false)ensureVisible();
    window.on('closed',()=>{revokeCamera();closed=true;void Promise.allSettled([legacy.stop(),workspace.stop()]);});
    return {window,legacy,workspace,menu,navigate,restoreSession,releases};
  }catch(error){if(window&&!window.isDestroyed())window.destroy();await Promise.allSettled([legacy.stop(),workspace?.stop?.()]);throw error;}
}
export async function launchDesktop(electron,options={}){
  if(process.platform==='win32'&&process.argv.some(x=>x.startsWith('--squirrel-'))){electron.app.quit();return null;}
  await electron.app.whenReady();
  if(!electron.app.requestSingleInstanceLock?.()){electron.app.quit();return null;}
  electron.app.on?.('second-instance',()=>{const w=electron.BrowserWindow.getAllWindows()[0];if(w?.isMinimized?.())w.restore();w?.focus?.();});
  const migration=await ensureProfileAndMigrate({appData:electron.app.getPath('appData'),userData:electron.app.getPath('userData')});
  const desktopOptions={...options,migrationStatus:migration.status};
  let current=await createDesktopWindow(electron,desktopOptions);
  electron.app.on('activate',async()=>{if(electron.BrowserWindow.getAllWindows().length===0)current=await createDesktopWindow(electron,desktopOptions);});
  electron.app.on('window-all-closed',()=>electron.app.quit());return current;
}
