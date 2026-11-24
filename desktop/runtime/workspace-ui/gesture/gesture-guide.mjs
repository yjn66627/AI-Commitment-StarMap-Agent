import {DEFAULT_GESTURE_SETTINGS,normalizeGestureSettings} from './gesture-math.mjs';

const LESSONS=[
  {symbol:'✋',name:'左右旋转',direction:'←  手掌平移  →',text:'张开一只手，五指伸展。手掌缓慢水平移动，星图绕竖直轴旋转。',tip:'方向模糊时，单独调节「左右旋转灵敏度」，再尝试反向开关。',pose:'open'},
  {symbol:'✋',name:'上下旋转',direction:'↑  手掌上移 / 下移  ↓',text:'保持张开手掌，缓慢向上或向下移动；观察星图俯仰角变化。',tip:'上下感觉迟钝可提高「上下旋转灵敏度」，不影响左右旋转。',pose:'open'},
  {symbol:'👐',name:'双手缩放',direction:'← 手  手 →　放大  /  靠近缩小',text:'让两只张开的手都完整进入画面。双手分开会放大；双手靠近会缩小。',tip:'缩放过猛或不足时，调整「缩放灵敏度」。',pose:'two'},
  {symbol:'☝️',name:'指向并预高亮',direction:'☝️ 移动食指 → 绿色光标 → 节点高亮',text:'仅伸出食指，其余手指自然收拢。看星图中的绿色虚拟光标，移动它对准目标节点。',tip:'请先看到目标节点出现亮色高亮，再进行捏合；不必盲猜摄像头位置。',pose:'point'},
  {symbol:'🤏',name:'捏合确认',direction:'☝️ 瞄准 A → 🤏 保持 → 确认',text:'先对准高亮节点，再将拇指和食指捏合并保持至确认。',tip:'捏合过程中锁定上一次指向的位置。',pose:'pinch'},
  {symbol:'☝️',name:'切换节点',direction:'松开 → 瞄准 B → 再捏合确认',text:'完全松开两指，移动食指让新节点预高亮，再捏合确认。',tip:'捏合选中与切换均需等待目标高亮；不要始终捏住。',pose:'switch'},
  {symbol:'✊',name:'暂停与退出',direction:'✊ 暂停 → ✋ 恢复  /  点击「关闭手势」',text:'握拳暂停操控；重新张掌恢复。要彻底停止摄像头，点击星图上方「关闭手势」。',tip:'关闭后摄像头预览消失，仍可用鼠标正常操作星图。',pose:'fist'},
];
// Deterministic, local, continuous animation. The synthetic drawing never touches the live graph.
const mix=(a,b,t)=>a+(b-a)*t;
const ease=t=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
const step=(t,a,b)=>ease((t-a)/(b-a));
function guideHand(ctx,x,y,scale,pose='open',amount=0,mirror=false){
 ctx.save();ctx.translate(x,y);ctx.scale(mirror?-scale:scale,scale);ctx.lineCap='round';ctx.lineJoin='round';
 // Five articulated fingers, drawn from palm joints; index and thumb close continuously during pinch.
 const base=[[-26,4],[-17,-20],[-4,-23],[10,-20],[22,-13]],tips=[[-43,-24],[-19,-65],[-4,-77],[12,-67],[29,-49]];
 const point=[[-36,-6],[-19,-69],[-3,-14],[12,-10],[24,-4]],fist=[[-26,0],[-16,-14],[-3,-17],[10,-15],[21,-10]],pinch=[[-13,-42],[-13,-42],[-3,-14],[12,-10],[24,-4]];
 const target=pose==='point'?point:pose==='pinch'?pinch:pose==='fist'?fist:tips,from=pose==='pinch'?point:tips;
 const blend=pose==='pinch'||pose==='fist'?amount:1;
 const end=tips.map((_,i)=>[mix(from[i][0],target[i][0],blend),mix(from[i][1],target[i][1],blend)]);
 const stroke=(pts,width,color)=>{ctx.beginPath();ctx.moveTo(...pts[0]);for(const pt of pts.slice(1))ctx.lineTo(...pt);ctx.lineWidth=width;ctx.strokeStyle=color;ctx.stroke();};
 ctx.fillStyle='#b48d5d';ctx.strokeStyle='#f4d8a4';ctx.lineWidth=2;ctx.beginPath();ctx.roundRect(-25,-23,50,56,16);ctx.fill();ctx.stroke();
 for(let i=0;i<5;i++){const a=base[i],b=end[i],mid=[mix(a[0],b[0],.55),mix(a[1],b[1],.55)];stroke([a,mid,b],13,'#b48d5d');stroke([a,mid,b],2,'#f4d8a4');ctx.beginPath();ctx.arc(b[0],b[1],3,0,Math.PI*2);ctx.fillStyle=i===1||i===0?'#fff0cb':'#e1b780';ctx.fill();}
 stroke([[0,33],[0,49]],20,'#b48d5d');ctx.restore();
}
function drawGuideFrame(canvas,lesson,t){
 const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;ctx.clearRect(0,0,w,h);ctx.fillStyle='#0a1723';ctx.fillRect(0,0,w,h);ctx.strokeStyle='#293e4a';ctx.strokeRect(8,8,w/2-16,h-16);ctx.strokeRect(w/2+8,8,w/2-16,h-16);
 const label=(text,x,y,col='#b9cdd8',size=13)=>{ctx.font=`${size}px "Microsoft YaHei",sans-serif`;ctx.fillStyle=col;ctx.textAlign='center';ctx.fillText(text,x,y);};
 label('手部动作',w*.25,28);label('星图响应（示范）',w*.75,28);
 const a=Math.sin(t*Math.PI*2),cx=w*.75,cy=h*.56;let yaw=0,pitch=0,zoom=1,phase='',hover=-1,selected=-1,cursor=null;
 if(lesson===0){guideHand(ctx,w*.25+a*65,h*.55,.72);yaw=a*.95;phase=a>=0?'向右移动 → 水平旋转':'向左移动 → 水平旋转';}
 else if(lesson===1){guideHand(ctx,w*.25,h*.56+a*35,.66);pitch=a*.8;phase=a>=0?'向下移动 → 向下俯仰':'向上移动 → 向上俯仰';}
 else if(lesson===2){const gap=52+a*23;guideHand(ctx,w*.25-gap,h*.55,.58,'open',0);guideHand(ctx,w*.25+gap,h*.55,.58,'open',0,true);zoom=1+a*.32;phase='双手间距变化 → 星图缩放';}
 else if(lesson===3){const u=step(t,.04,.42),v=step(t,.56,.94);const px=mix(-50,48,u)-v*98;guideHand(ctx,w*.25+px,h*.56,.70,'point');cursor=[cx+px,cy-12];hover=t>.3&&t<.7?1:0;phase='移动食指 → 光标跟随 → 预高亮';}
 else if(lesson===4||lesson===5){const switching=lesson===5,move=switching?step(t,.38,.63):0,first=step(t,.16,.32)-step(t,.37,.45),second=switching?step(t,.73,.86):0;const px=mix(-48,48,move),close=switching?Math.max(first,second):step(t,.35,.55);guideHand(ctx,w*.25+px,h*.56,.70,'pinch',close);cursor=[cx+px,cy-12];hover=move>.7?1:0;selected=switching?(t>.87?1:t>.32?0:-1):t>.56?0:-1;phase=switching?(t<.35?'先选中 A':t<.64?'松开并移向 B':t<.86?'瞄准 B 后捏合':'B 已确认'):(t<.35?'先预高亮 A':t<.56?'捏合保持':'A 已确认');}
 else{const grip=step(t,.28,.44)-step(t,.68,.85);guideHand(ctx,w*.25+Math.sin(t*10)*22,h*.56,.70,'fist',grip);yaw=t<.28?t*2:t<.85?.56:.56+(t-.85)*2;phase=grip>.85?'握拳：冻结旋转':'张掌：恢复移动控制';}
 const pts=[[-48,-12,18],[48,-12,-14],[-27,43,-25],[28,43,28],[0,-52,10]].map(([x,y,z])=>{let X=x*Math.cos(yaw)+z*Math.sin(yaw),Z=-x*Math.sin(yaw)+z*Math.cos(yaw),Y=y*Math.cos(pitch)-Z*Math.sin(pitch);return[cx+X*zoom,cy+Y*zoom];});
 ctx.strokeStyle='#528493';ctx.lineWidth=1.5;for(const [i,j] of [[0,2],[1,3],[0,4],[1,4],[2,3],[0,1]]){ctx.beginPath();ctx.moveTo(...pts[i]);ctx.lineTo(...pts[j]);ctx.stroke();}
 pts.forEach(([x,y],i)=>{ctx.beginPath();ctx.arc(x,y,i===hover||i===selected?10:5,0,Math.PI*2);ctx.fillStyle=i===selected?'#e5bd78':i===hover?'#71e7b9':'#8bd1dc';ctx.fill();if(i<2)label(i?'B':'A',x,y-16,'#e2eaf0',12);});if(cursor){ctx.strokeStyle='#7ff2be';ctx.beginPath();ctx.arc(...cursor,13,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.moveTo(cursor[0]-17,cursor[1]);ctx.lineTo(cursor[0]+17,cursor[1]);ctx.moveTo(cursor[0],cursor[1]-17);ctx.lineTo(cursor[0],cursor[1]+17);ctx.stroke();}
 label(phase,w/2,h-12,'#ecd099',12);return phase;
}

const SLIDERS=[
  ['horizontal','左右旋转灵敏度',.3,3,.1],['vertical','上下旋转灵敏度',.3,3,.1],
  ['zoom','缩放灵敏度',.4,2.5,.1],['pointer','光标移动范围',.6,1.7,.05],
  ['smoothing','动作平滑程度',.08,.85,.05],['holdMs','捏合确认时长（毫秒）',280,1300,20],
  ['hitRadius','节点预高亮范围（像素）',24,90,2]
];
export class GestureGuide {
  constructor({button,settingsButton,controller}){
    this.controller=controller;this.index=0;this.settings={...DEFAULT_GESTURE_SETTINGS};
    this.dialog=document.createElement('dialog');this.dialog.className='gesture-guide-dialog';
    this.dialog.setAttribute('aria-label','手势操作教学与校准');
    this.dialog.innerHTML=`<div class="guide-top"><div><small>HAND TRACKING / 操作教学</small><h2>手势教学与校准</h2></div><button class="guide-close" type="button" aria-label="关闭教学">✕</button></div>
      <div class="guide-tabs"><button type="button" data-guide-tab="lesson" class="active">逐步教学</button><button type="button" data-guide-tab="settings">灵敏度校准</button></div>
      <div data-guide-panel="lesson"><div class="guide-step-count"></div><div class="guide-demo"><canvas class="guide-animation" width="600" height="210" aria-label="连续手势和星图响应演示"></canvas><div class="guide-direction"></div><div class="guide-playback"><button type="button" class="guide-play">暂停</button><button type="button" class="guide-replay">重播</button><input class="guide-progress" type="range" min="0" max="1000" value="0" aria-label="动画进度"></div><div class="guide-phase" aria-live="off"></div></div><h3 class="guide-name"></h3><p class="guide-description"></p><p class="guide-tip"></p><div class="guide-live">实时识别：未开启摄像头</div><div class="guide-actions"><button type="button" class="guide-prev">上一个动作</button><button type="button" class="guide-next">下一个动作</button></div></div>
      <div data-guide-panel="settings" hidden><p class="guide-setting-help">分别调整方向、缩放、光标以及判定阈值。设置保存在本机，重新启动仍生效。</p><div class="guide-sliders"></div><div class="guide-checkboxes"><label><input type="checkbox" data-setting="invertX">反转左右旋转方向</label><label><input type="checkbox" data-setting="invertY">反转上下旋转方向</label></div><div class="guide-actions"><button type="button" class="guide-reset">恢复默认</button><button type="button" class="guide-save">保存校准设置</button></div><p class="guide-save-status" role="status" aria-live="polite"></p></div>`;
    document.body.append(this.dialog);
    this.dialog.querySelector('.guide-close').addEventListener('click',()=>this.dialog.close());
    this.dialog.querySelector('.guide-prev').addEventListener('click',()=>this.renderLesson(Math.max(0,this.index-1)));
    this.dialog.querySelector('.guide-next').addEventListener('click',()=>this.renderLesson(Math.min(LESSONS.length-1,this.index+1)));
    this.dialog.querySelector('.guide-reset').addEventListener('click',()=>this.renderSettings({...DEFAULT_GESTURE_SETTINGS}));
    this.dialog.querySelector('.guide-save').addEventListener('click',()=>this.save());
    this.dialog.querySelectorAll('[data-guide-tab]').forEach(btn=>btn.addEventListener('click',()=>this.switchTab(btn.dataset.guideTab)));
    button?.addEventListener('click',()=>this.open('lesson'));
    settingsButton?.addEventListener('click',()=>this.open('settings'));
    this.progress=0;this.playing=!window.matchMedia('(prefers-reduced-motion: reduce)').matches;this.animationId=0;this.lastFrame=0;
    this.dialog.querySelector('.guide-play').onclick=()=>{this.playing=!this.playing;this.lastFrame=0;this.drawAnimation();this.startAnimation();};
    this.dialog.querySelector('.guide-replay').onclick=()=>{this.progress=0;this.playing=true;this.lastFrame=0;this.drawAnimation();this.startAnimation();};
    this.dialog.querySelector('.guide-progress').oninput=e=>{this.progress=Number(e.target.value)/1000;this.playing=false;this.drawAnimation();};
    this.dialog.addEventListener('close',()=>{cancelAnimationFrame(this.animationId);this.animationId=0;this.lastFrame=0;});
    this.renderLesson(0);this.renderSettings(this.settings);
  }
  setSettings(settings){this.settings=normalizeGestureSettings(settings);this.renderSettings(this.settings);}
  open(tab='lesson'){if(!this.dialog.open)this.dialog.showModal();this.switchTab(tab);this.startAnimation();}
  switchTab(tab){this.dialog.querySelectorAll('[data-guide-tab]').forEach(el=>el.classList.toggle('active',el.dataset.guideTab===tab));this.dialog.querySelectorAll('[data-guide-panel]').forEach(el=>el.hidden=el.dataset.guidePanel!==tab);this.lastFrame=0;this.startAnimation();}
  renderLesson(index){this.index=index;const l=LESSONS[index];const q=s=>this.dialog.querySelector(s);
    q('.guide-step-count').textContent=`动作 ${index+1} / ${LESSONS.length}`;
    this.progress=0;this.lastFrame=0;this.drawAnimation();q('.guide-direction').textContent=l.direction;q('.guide-name').textContent=l.name;
    q('.guide-description').textContent=l.text;q('.guide-tip').textContent='使用提示：'+l.tip;
    q('.guide-prev').disabled=index===0;q('.guide-next').disabled=index===LESSONS.length-1;
  }
  drawAnimation(){const q=s=>this.dialog.querySelector(s);const canvas=q('.guide-animation');q('.guide-phase').textContent=drawGuideFrame(canvas,this.index,this.progress);q('.guide-progress').value=String(Math.round(this.progress*1000));q('.guide-play').textContent=this.playing?'暂停':'播放';}
  startAnimation(){if(this.animationId||!this.dialog.open||this.dialog.querySelector('[data-guide-panel="lesson"]').hidden||!this.playing)return;const tick=now=>{this.animationId=0;if(!this.dialog.open||this.dialog.querySelector('[data-guide-panel="lesson"]').hidden||!this.playing){this.lastFrame=0;return;}if(this.lastFrame)this.progress=(this.progress+Math.min(80,now-this.lastFrame)/5200)%1;this.lastFrame=now;this.drawAnimation();this.animationId=requestAnimationFrame(tick);};this.animationId=requestAnimationFrame(tick);}
  renderSettings(value){const host=this.dialog.querySelector('.guide-sliders');host.replaceChildren();
    for(const [key,label,min,max,step] of SLIDERS){const group=document.createElement('label');group.className='guide-slider';
      const title=document.createElement('span');title.textContent=label;
      const number=document.createElement('output');number.textContent=String(value[key]);
      const input=document.createElement('input');input.type='range';input.dataset.setting=key;input.min=String(min);input.max=String(max);input.step=String(step);input.value=String(value[key]);
      input.addEventListener('input',()=>{number.textContent=input.value;});group.append(title,number,input);host.append(group);
    }
    for(const k of ['invertX','invertY'])this.dialog.querySelector(`[data-setting="${k}"]`).checked=value[k];
    this.dialog.querySelector('.guide-save-status').textContent='';
  }
  async save(){const data={};for(const input of this.dialog.querySelectorAll('[data-setting]'))data[input.dataset.setting]=input.type==='checkbox'?input.checked:Number(input.value);
    const host=this.dialog.querySelector('.guide-save-status');host.textContent='正在保存…';
    try{const result=await this.controller.saveSettings(normalizeGestureSettings(data));this.setSettings(result);host.textContent='✓ 已保存，马上生效，重启仍保留。';}
    catch(e){host.textContent='保存失败：'+String(e.message||e).slice(0,100);}
  }
  updateLive(status,pose,target){const host=this.dialog.querySelector('.guide-live');host.textContent='实时识别：'+(status||'未开启摄像头')+(target?' · 当前目标：'+target.label.slice(0,24):'');
    host.dataset.pose=pose||'none';
  }
}
