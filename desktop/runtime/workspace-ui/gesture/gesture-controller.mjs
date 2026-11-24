import {GestureInterpreter,DEFAULT_GESTURE_SETTINGS} from './gesture-math.mjs';
import {loadLocalHandLandmarker} from './vision-adapter.mjs';
import {GestureGuide} from './gesture-guide.mjs';
const errorText=e=>{
  if(e?.name==='NotAllowedError'||e?.name==='SecurityError')return '摄像头权限被拒绝，请检查Windows隐私设置。';
  if(e?.name==='NotFoundError')return '未检测到可用摄像头。';
  if(e?.name==='NotReadableError')return '摄像头被其他程序占用。';
  if(String(e?.message||'').includes('本机识别模型尚未打包'))return '本机识别模型未就绪，请使用带完整手势资源的安装版。';
  if(String(e?.message||'').includes('ASSET_STATUS_UNAVAILABLE'))return '无法核对本机手势资源，请重新启动软件。';
  return '手势识别启动失败：'+String(e?.message||e).slice(0,100);
};
export class GestureController{
  constructor({button,status,video,overlay,graph,graphPage,guideButton,settingsButton,cursor,loadDetector=loadLocalHandLandmarker,getMedia=constraints=>navigator.mediaDevices.getUserMedia(constraints)}={}){
    Object.assign(this,{button,status,video,overlay,graph,graphPage,loadDetector,getMedia,cursor});
    this.settings={...DEFAULT_GESTURE_SETTINGS};this.interpreter=new GestureInterpreter(this.settings);
    this.active=false;this.starting=false;this.detector=null;this.stream=null;this.raf=0;this.lastInference=0;this.generation=0;this.target=null;
    this.guide=new GestureGuide({button:guideButton,settingsButton,controller:this});
    this.prefsReady=this.loadSettings();
    button?.addEventListener('click',()=>this.active||this.starting?this.stop():this.start());
    document.addEventListener('visibilitychange',()=>{if(document.hidden)this.stop();});
    window.addEventListener('pagehide',()=>this.stop());
    window.addEventListener('blur',()=>{if(this.active)this.stop();});
  }
  async loadSettings(){try{const r=await fetch('/api/workspace/gesture/preferences',{credentials:'same-origin'});if(!r.ok)throw Error('CONFIG_UNAVAILABLE');
    const j=await r.json();this.settings=j.preferences;this.interpreter.configure(this.settings);this.guide.setSettings(this.settings);
  }catch(e){this.guide.setSettings(this.settings);}}
  async saveSettings(settings){const r=await fetch('/api/workspace/gesture/preferences',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json','x-starmap-desktop':'1'},body:JSON.stringify(settings)});
    if(!r.ok)throw Error('配置未能保存到本机');const j=await r.json();this.settings=j.preferences;this.interpreter.configure(this.settings);this.graph.gestureRadius=this.settings.hitRadius;this.clearAim();return this.settings;
  }
  setStatus(message,state='off'){
    if(this.status){this.status.textContent=message;this.status.dataset.state=state;}
    if(this.button){this.button.disabled=this.starting;this.button.textContent=this.active?'■ 关闭手势':'✋ 开启手势';this.button.setAttribute('aria-pressed',String(this.active));}
  }
  clearAim(){this.target=null;if(this.cursor){this.cursor.hidden=true;this.cursor.classList.remove('locked','on-target');}
    this.graph?.clearGesturePreview?.();}
  moveCursor(action){
    if(!this.cursor||!this.graph?.canvas)return;
    const target=this.graph.previewByGesture(action.x,action.y,this.settings.hitRadius);
    this.target=target;
    const scene=this.graph.canvas.getBoundingClientRect(),stage=this.cursor.parentElement.getBoundingClientRect();
    this.cursor.style.left=(scene.left-stage.left+action.x*scene.width)+'px';
    this.cursor.style.top=(scene.top-stage.top+action.y*scene.height)+'px';
    this.cursor.hidden=false;
    this.cursor.classList.toggle('locked',!!action.locked);this.cursor.classList.toggle('on-target',!!target);
    this.cursor.setAttribute('aria-label',target?'瞄准：'+target.label:'光标未对准节点');
  }
  async start(){
    if(this.active||this.starting||this.graph.mode!=='3d')return;
    if(!this.graphPage?.classList.contains('active'))return;
    this.starting=true;const generation=++this.generation;await this.prefsReady;
this.setStatus('正在检查本机手势识别资源…','loading');let detector,stream;
    const checkActive=()=>{if(generation!==this.generation||!this.graphPage.classList.contains('active'))throw Error('GESTURE_START_CANCELLED');};
    try{
      const readiness=await fetch('/app/gesture/status.json',{credentials:'same-origin',cache:'no-store'}).then(r=>r.ok?r.json():Promise.reject(Error('ASSET_STATUS_UNAVAILABLE')));
      checkActive();if(!readiness.ready)throw Error('本机识别模型尚未打包：请使用完整离线资源版本。');
      detector=await this.loadDetector();checkActive();
      this.setStatus('等待摄像头授权…','loading');
      stream=await this.getMedia({video:{facingMode:'user',width:{ideal:640},height:{ideal:480},frameRate:{ideal:24,max:30}},audio:false});checkActive();
      this.detector=detector;this.stream=stream;this.video.srcObject=stream;this.video.hidden=false;this.overlay.hidden=false;
      await this.video.play();checkActive();
      this.active=true;this.interpreter.configure(this.settings);this.graph.gestureRadius=this.settings.hitRadius;
      this.starting=false;this.setStatus('摄像头运行中 · 仅本机识别','on');this.frame();
    }catch(e){try{stream?.getTracks()?.forEach(track=>track.stop());}catch{}try{detector?.close?.();}catch{}
      this.active=false;this.starting=false;this.detector=null;this.stream=null;this.video.hidden=true;this.overlay.hidden=true;this.clearAim();
      window.StarmapCameraControl?.stop?.();this.setStatus(e?.message==='GESTURE_START_CANCELLED'?'手势模式已关闭':errorText(e),e?.message==='GESTURE_START_CANCELLED'?'off':'error');
    }
  }
  stop(){
    ++this.generation;this.active=false;this.starting=false;
    if(this.raf)cancelAnimationFrame(this.raf);this.raf=0;
    try{this.stream?.getTracks()?.forEach(track=>track.stop());}catch{}
    try{this.detector?.close?.();}catch{}
    this.detector=null;this.stream=null;this.video.pause();this.video.srcObject=null;this.video.hidden=true;this.overlay.hidden=true;
    const ctx=this.overlay.getContext('2d');ctx?.clearRect(0,0,this.overlay.width,this.overlay.height);
    this.interpreter.reset();this.clearAim();this.guide.updateLive('手势模式已关闭');window.StarmapCameraControl?.stop?.();this.setStatus('手势模式已关闭','off');
  }
  frame(){
    if(!this.active)return;
    this.raf=requestAnimationFrame(()=>this.frame());
    if(!this.video.videoWidth||this.video.readyState<2)return;
    const now=performance.now();if(now-this.lastInference<65)return;this.lastInference=now;
    try{
      const result=this.detector.detectForVideo(this.video,now);const landmarks=result?.landmarks||[];
      const interpreted=this.interpreter.consume(landmarks,now);
      let status=interpreted.status;
      for(const action of interpreted.actions){
        if(action.type==='rotate')this.graph.rotateByGesture(action.dx,action.dy);
        else if(action.type==='zoom')this.graph.zoomByGesture(action.factor);
        else if(action.type==='aim'){
          this.moveCursor(action);
          if(this.target){status+=(action.locked?' · 已锁定：':' · 已对准：')+this.target.label.slice(0,16);}
          else status+=' · 未对准节点';
        }
        else if(action.type==='cursor-hide')this.clearAim();
        else if(action.type==='select'){
          const ok=this.graph.selectByGesture(action.x,action.y,this.settings.hitRadius);
          status=ok?'✅ 已选中节点；松开再指向另一个':'⚠️ 还未对准节点；松开并重新指向';
        }
      }
      this.setStatus(status,'on');this.guide.updateLive(status,interpreted.pose,this.target);
      this.drawLandmarks(landmarks);
    }catch(e){const message='识别已停止：'+String(e.message||e).slice(0,65);this.stop();this.setStatus(message,'error');}
  }
  drawLandmarks(hands){
    const c=this.overlay,ctx=c.getContext('2d');const w=c.width=240,h=c.height=160;ctx.clearRect(0,0,w,h);
    ctx.strokeStyle='#bda174';ctx.lineWidth=1.2;ctx.fillStyle='#e6c998';
    const edges=[[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
    for(const hand of hands){for(const [a,b] of edges){ctx.beginPath();ctx.moveTo((1-hand[a].x)*w,hand[a].y*h);ctx.lineTo((1-hand[b].x)*w,hand[b].y*h);ctx.stroke();}}
  }
}
