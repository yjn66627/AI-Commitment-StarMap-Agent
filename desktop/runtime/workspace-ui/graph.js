// V1.5 real-project relationship star map. Constellation background, spatial
// coordinate HUD, and orbit rings are DECORATION, never evidence or claims.
// All business nodes and edges originate from validated local project records.
const COLOR={source:'#cdb68d',evidence:'#6ccbd2',commitment:'#a7c7f0',risk:'#e0a18c',note:'#ad9dc9'};
export const STATE_LABEL={unassessed:'未评估',planned:'待执行',in_progress:'进行中',awaiting_acceptance:'待验收',fulfilled:'已兑现',cancelled:'已取消',superseded:'已替代',open:'待处理',mitigating:'处理中',resolved:'已解决',accepted:'已接受风险',pending:'待复核'};
const STATE_COLOR={unassessed:'#9aabc0',planned:'#e4b86e',in_progress:'#68bce9',awaiting_acceptance:'#bca2eb',fulfilled:'#61d3a3',cancelled:'#8898a5',superseded:'#8898a5',open:'#ed9088',mitigating:'#e2ab73',resolved:'#61d3a3',accepted:'#a7a0b3',pending:'#d8bc8f'};
export function graphState(c){return c.review==='confirmed'?(c.lifecycle?.status||'unassessed'):'pending';}
export function matchesState(n,filter){if(filter==='all')return true;if(!n.state)return false;switch(filter){case 'unfinished':return n.type==='commitment'&&['unassessed','planned','in_progress','awaiting_acceptance'].includes(n.state);case 'risk':return n.type==='risk'&&['unassessed','open','mitigating'].includes(n.state);case 'completed':return ['fulfilled','resolved'].includes(n.state);case 'inactive':return ['cancelled','superseded','accepted'].includes(n.state);case 'pending':return n.state==='pending';default:return n.state===filter;}}
export function visibleNetwork(model,types,showPending,filter='all'){
 const available=model.nodes.filter(n=>types.has(n.type)&&(showPending||n.review!=='pending'));
 if(filter==='all')return available;
 const ids=new Set(available.filter(n=>matchesState(n,filter)).map(n=>n.id));
 for(const e of model.edges)if(ids.has(e.from)&&['evidenced','status-change'].includes(e.type))ids.add(e.to);
 for(const e of model.edges)if(ids.has(e.from)&&e.type==='located')ids.add(e.to);
 return available.filter(n=>ids.has(n.id));
}
export function projectNetwork(project){
  if(!project)return {nodes:[],edges:[]};
  const nodes=[],edges=[];
  for(const [i,s] of project.sources.entries()){if(s.archivedAt&&!project.evidence.some(e=>e.sourceId===s.id))continue;nodes.push({id:s.id,type:'source',label:s.name+(s.archivedAt?'（历史）':''),detail:s.content,raw:s,index:i});}
  for(const [i,e] of project.evidence.entries()){
    nodes.push({id:e.id,type:'evidence',label:'证据 '+(i+1),detail:e.quote,raw:e,index:i});
    if(project.sources.some(s=>s.id===e.sourceId))edges.push({from:e.id,to:e.sourceId,type:'located',review:'confirmed'});
  }
  for(const [i,c] of project.claims.entries()){
    if(c.review==='rejected')continue;
    nodes.push({id:c.id,type:c.kind,label:c.text,detail:c.text,review:c.review,state:graphState(c),raw:c,index:i});
    for(const ref of c.evidenceIds)if(project.evidence.some(e=>e.id===ref))edges.push({from:c.id,to:ref,type:'evidenced',review:c.review});
    for(const ref of c.lifecycle?.evidenceIds||[])if(!c.evidenceIds.includes(ref)&&project.evidence.some(e=>e.id===ref))edges.push({from:c.id,to:ref,type:'status-change',review:c.review});
  }
  for(const l of project.links){if(l.retiredAt||l.review==='rejected'||!nodes.some(n=>n.id===l.from)||!nodes.some(n=>n.id===l.to))continue;edges.push({from:l.from,to:l.to,type:l.kind,review:l.review,raw:l});}
  return {nodes,edges};
}
const text=(tag,value,cls)=>{const el=document.createElement(tag);el.textContent=value;if(cls)el.className=cls;return el;};
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
function hash(s){let n=2166136261;for(const ch of s)n=Math.imul(n^ch.charCodeAt(0),16777619);return n>>>0;}
export class GraphView{
  constructor(canvas,inspector){
    this.canvas=canvas;this.inspector=inspector;this.ctx=canvas.getContext('2d');this.model={nodes:[],edges:[]};
    this.mode='3d';this.yaw=-.27;this.pitch=.19;this.zoom=1;this.pan={x:0,y:0};this.hit=[];this.drag=null;this.selected=null;this.gestureHover=null;this.gestureRadius=56;
    this.w=700;this.h=480;this.pixelRatio=1;this.visibleTypes=new Set(['source','evidence','commitment','risk','note']);this.showPending=true;this.showAmbient=true;this.statusFilter='all';this.historical=false;
    canvas.addEventListener('pointerdown',e=>{this.drag={x:e.clientX,y:e.clientY,lastX:e.clientX,lastY:e.clientY,moved:false};canvas.setPointerCapture(e.pointerId);});
    canvas.addEventListener('pointermove',e=>{const d=this.drag;if(!d)return;const dx=e.clientX-d.lastX,dy=e.clientY-d.lastY;d.lastX=e.clientX;d.lastY=e.clientY;if(Math.abs(e.clientX-d.x)+Math.abs(e.clientY-d.y)>5)d.moved=true;if(!d.moved)return;if(this.mode==='3d'){this.yaw+=dx*.008;this.pitch=clamp(this.pitch+dy*.008,-1.21,1.21);}else{this.pan.x+=dx;this.pan.y+=dy;}this.draw();});
    canvas.addEventListener('pointerup',e=>{const d=this.drag;this.drag=null;if(!d||d.moved)return;const r=canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;let picked=null,dist=24;for(const hit of this.hit){const near=Math.hypot(x-hit.x,y-hit.y);if(near<dist){dist=near;picked=hit.node;}}if(picked){this.selected=picked.id;this.inspect(picked);this.draw();}});
    canvas.addEventListener('pointercancel',()=>{this.drag=null;});
    canvas.addEventListener('wheel',e=>{e.preventDefault();this.zoom=clamp(this.zoom*(e.deltaY>0?.91:1.1),.45,3.2);this.draw();},{passive:false});
    if(window.ResizeObserver)new ResizeObserver(()=>this.resize()).observe(canvas);
  }
  rotateByGesture(dx,dy){
    if(this.mode!=='3d'||!Number.isFinite(dx)||!Number.isFinite(dy))return;
    this.yaw+=Math.max(-.08,Math.min(.08,dx));
    this.pitch=clamp(this.pitch+Math.max(-.07,Math.min(.07,dy)),-1.21,1.21);this.draw();
  }
  zoomByGesture(factor){
    if(this.mode!=='3d'||!Number.isFinite(factor))return;
    this.zoom=clamp(this.zoom*clamp(factor,.84,1.16),.45,3.2);this.draw();
  }
  gestureHit(x,y,radius=this.gestureRadius){
    if(this.mode!=='3d'||!Number.isFinite(x)||!Number.isFinite(y))return null;
    const px=x*this.w,py=y*this.h;let closest=null,dist=clamp(Number.isFinite(radius)?radius:56,24,90);
    for(const h of this.hit){const delta=Math.hypot(px-h.x,py-h.y);if(delta<=dist){dist=delta;closest=h.node;}}
    return closest;
  }
  previewByGesture(x,y,radius){
    this.gestureRadius=clamp(radius||56,24,90);
    const target=this.gestureHit(x,y,this.gestureRadius);
    const id=target?.id||null;
    if(this.gestureHover!==id){this.gestureHover=id;this.draw();}
    return target;
  }
  clearGesturePreview(){if(this.gestureHover!==null){this.gestureHover=null;this.draw();}}
  selectByGesture(x,y,radius){
    // Selection is read only, and must match the visible preview target.
    const target=this.gestureHit(x,y,radius||this.gestureRadius);
    if(!target)return false;
    this.selected=target.id;this.gestureHover=target.id;this.inspect(target);this.draw();return true;
  }
  setMode(mode){this.mode=mode==='2d'?'2d':'3d';this.gestureHover=null;this.reset();}
  setFilter(type,enabled){if(type==='pending'){this.showPending=!!enabled;}else if(type==='ambient'){this.showAmbient=!!enabled;}else if(COLOR[type]){if(enabled)this.visibleTypes.add(type);else this.visibleTypes.delete(type);}this.reconcileSelection();this.draw();}
  setStatusFilter(filter){this.statusFilter=filter;this.reconcileSelection();this.draw();}
  reconcileSelection(){const shown=this.visible();if(!shown.some(n=>n.id===this.selected)){this.selected=null;this.inspect(null);}if(!shown.some(n=>n.id===this.gestureHover))this.gestureHover=null;}
  reset(){this.yaw=-.27;this.pitch=.19;this.zoom=1;this.pan={x:0,y:0};this.draw();}
  render(project,{preserveView=false,historical=false}={}){this.project=project;this.historical=historical;this.model=projectNetwork(project);this.gestureHover=null;if(!preserveView){this.selected=null;this.reset();}this.reconcileSelection();this.inspect(this.model.nodes.find(n=>n.id===this.selected)||null);this.resize();}
  resize(){const r=this.canvas.getBoundingClientRect();if(r.width<10||r.height<10)return;this.w=r.width;this.h=r.height;this.pixelRatio=Math.min(2,window.devicePixelRatio||1);this.canvas.width=Math.round(this.w*this.pixelRatio);this.canvas.height=Math.round(this.h*this.pixelRatio);this.draw();}
  visible(){return visibleNetwork(this.model,this.visibleTypes,this.showPending,this.statusFilter);}
  position(n){
    const h=hash(n.id),i=n.index||0;
    // Stable type-based spatial strata. No links or claims are invented here.
    const [r,origin,rotation]=n.type==='source'?[245,-105,-2.3]:n.type==='evidence'?[135,0,-1.35]:[265,100,-.35];
    const angle=rotation+i*2.399963+(h%73)/240;
    return {x:Math.cos(angle)*r+origin,y:Math.sin(angle)*r*.80,z:((h%255)-127)*.85};
  }
  orient(p){if(this.mode==='2d')return {...p,depth:0};const cy=Math.cos(this.yaw),sy=Math.sin(this.yaw),cp=Math.cos(this.pitch),sp=Math.sin(this.pitch);const x=p.x*cy-p.z*sy,z=p.x*sy+p.z*cy;return {x,y:p.y*cp-z*sp,depth:p.y*sp+z*cp};}
  positions(nodes){
    const raw=nodes.map(n=>({node:n,...this.orient(this.position(n))}));
    const perspective=this.mode==='3d';
    const scaled=raw.map(p=>({...p,x:p.x*(perspective?920/(920-p.depth):1),y:p.y*(perspective?920/(920-p.depth):1)}));
    const maxX=Math.max(280,...scaled.map(p=>Math.abs(p.x))),maxY=Math.max(200,...scaled.map(p=>Math.abs(p.y)));
    const fit=Math.min((this.w-150)/(2*maxX),(this.h-104)/(2*maxY),1.5)*this.zoom;
    return new Map(scaled.map(p=>[p.node.id,{x:this.w/2+this.pan.x+p.x*fit,y:this.h/2+this.pan.y+p.y*fit,depth:p.depth} ]));
  }
  background(ctx,w,h){
    const bg=ctx.createLinearGradient(0,0,w,h);bg.addColorStop(0,'#050b13');bg.addColorStop(.65,'#071a27');bg.addColorStop(1,'#0c1c2a');ctx.fillStyle=bg;ctx.fillRect(0,0,w,h);
    const nebula=ctx.createRadialGradient(w*.48,h*.44,20,w*.48,h*.44,Math.max(w,h)*.65);nebula.addColorStop(0,'#1b536126');nebula.addColorStop(.65,'#12304a11');nebula.addColorStop(1,'#07111b00');ctx.fillStyle=nebula;ctx.fillRect(0,0,w,h);
    if(this.showAmbient){
      // A deterministic, purely decorative starfield.
      for(let i=0;i<92;i++){const x=((i*173+43)%997)/997*w,y=((i*397+17)%991)/991*h,r=i%11===0?1.3:.7;ctx.fillStyle=i%7===0?'#c4a77783':'#a1cada50';ctx.fillRect(x,y,r,r);}
      ctx.strokeStyle='#47718b1b';ctx.lineWidth=.7;
      for(let r=90;r<Math.max(w,h);r+=110){ctx.beginPath();ctx.ellipse(w/2,h/2,r,r*.55,-.27,0,Math.PI*2);ctx.stroke();}
      const cx=w/2,cy=h/2;
      for(let a=0;a<Math.PI*2;a+=Math.PI/6){ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx+Math.cos(a)*w,cy+Math.sin(a)*h);ctx.stroke();}
    }
    ctx.strokeStyle='#7794a344';ctx.lineWidth=.75;ctx.beginPath();ctx.moveTo(24,20);ctx.lineTo(24,43);ctx.moveTo(24,20);ctx.lineTo(47,20);ctx.moveTo(w-24,h-44);ctx.lineTo(w-24,h-20);ctx.lineTo(w-47,h-20);ctx.stroke();
    ctx.fillStyle='#a6bfd18d';ctx.font='10px Consolas,monospace';ctx.fillText('TRACEABLE EVIDENCE / '+this.mode.toUpperCase()+(this.historical?'  •  HISTORY / READ ONLY':'  •  LOCAL PROJECT'),28,35);
    ctx.fillStyle='#7c97a8a1';ctx.fillText('DECORATIVE STARFIELD ≠ PROJECT DATA',28,h-27);
    // Three-axis locator conveys camera orientation, never implies physical coordinates.
    const hx=w-69,hy=53,coords=this.mode==='3d'?[['X',56,0,'#c4ad83'],['Y',0,-34,'#7dd6db'],['Z',-30,19,'#8ba9d7']]:[['X',39,0,'#c4ad83'],['Y',0,-35,'#7dd6db']];
    ctx.font='10px Consolas,monospace';for(const [t,dx,dy,color] of coords){ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=1.3;ctx.beginPath();ctx.moveTo(hx,hy);ctx.lineTo(hx+dx*.72,hy+dy*.72);ctx.stroke();ctx.fillText(t,hx+dx*.81-3,hy+dy*.81+3);}
  }
  draw(){const ctx=this.ctx,w=this.w,h=this.h,pr=this.pixelRatio;if(!ctx||!w||!h)return;ctx.setTransform(pr,0,0,pr,0,0);ctx.clearRect(0,0,w,h);this.background(ctx,w,h);
    const nodes=this.visible(),ids=new Set(nodes.map(n=>n.id));if(!nodes.length){ctx.fillStyle='#b5c8d0';ctx.textAlign='center';ctx.font='14px "Microsoft YaHei",sans-serif';ctx.fillText(this.model.nodes.length?'当前筛选下没有可显示节点':'请导入材料、标注证据和结论以生成真实星图',w/2,h/2);ctx.textAlign='left';this.hit=[];return;}
    const pos=this.positions(nodes);
    // Relationship layers: pending links are dashed; confirmed links solid.
    for(const e of this.model.edges){if(!ids.has(e.from)||!ids.has(e.to)||(e.review==='pending'&&!this.showPending))continue;const a=pos.get(e.from),b=pos.get(e.to);ctx.save();ctx.strokeStyle=e.review==='pending'?'#b79a6e7f':e.type==='contradicts'?'#c5867887':e.type==='status-change'?'#7cc9a7a6':'#72a4ac6b';ctx.lineWidth=e.review==='pending'?1:1.2;ctx.setLineDash(e.review==='pending'?[5,5]:[]);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.restore();}
    this.hit=[];const ordered=[...nodes].sort((a,b)=>pos.get(a.id).depth-pos.get(b.id).depth);
    let drawn=0;
    for(const n of ordered){const p=pos.get(n.id),active=n.id===this.selected,hover=n.id===this.gestureHover,col=STATE_COLOR[n.state]||COLOR[n.type]||'#acb5c1';if(p.x<0||p.x>w||p.y<0||p.y>h)continue;
      const radius=active?9.5:hover?9:n.type==='evidence'?4.8:6.5;
      ctx.save();ctx.shadowColor=col;ctx.shadowBlur=active?16:hover?21:6;ctx.lineWidth=active||hover?2.2:1.3;ctx.strokeStyle=col;ctx.fillStyle=active?'#293a42':'#091a27';ctx.beginPath();
      if(n.type==='commitment'){ctx.moveTo(p.x,p.y-radius);ctx.lineTo(p.x+radius,p.y);ctx.lineTo(p.x,p.y+radius);ctx.lineTo(p.x-radius,p.y);ctx.closePath();}
      else if(n.type==='risk'){ctx.moveTo(p.x,p.y-radius);ctx.lineTo(p.x+radius,p.y+radius);ctx.lineTo(p.x-radius,p.y+radius);ctx.closePath();}
      else if(n.type==='evidence'){ctx.rect(p.x-radius,p.y-radius,radius*2,radius*2);}
      else{ctx.arc(p.x,p.y,radius,0,Math.PI*2);}ctx.fill();ctx.stroke();ctx.restore();
      if(active||hover){ctx.beginPath();ctx.arc(p.x,p.y,hover?19:15,0,Math.PI*2);ctx.strokeStyle=hover?'#8de9d8':'#e0bc7992';ctx.lineWidth=hover?2:1;ctx.stroke();}
      const showLabel=active||hover||nodes.length<55||drawn++%Math.ceil(nodes.length/42)===0;
      if(showLabel){const maxWidth=Math.min(130,Math.max(56,w*.23));ctx.font='11px "Microsoft YaHei",sans-serif';const fullLabel=n.state&&n.state!=='unassessed'?'['+STATE_LABEL[n.state]+'] '+n.label:n.label;let label=fullLabel;while(label.length>1&&ctx.measureText(label).width>maxWidth)label=label.slice(0,-1);if(label!==fullLabel)label+='…';const tw=ctx.measureText(label).width;const tx=clamp(p.x+12,8,w-tw-12),ty=clamp(p.y-7,52,h-42);ctx.fillStyle='#071926e3';ctx.fillRect(tx-4,ty-13,tw+9,19);ctx.fillStyle=STATE_COLOR[n.state]||'#d0e5eb';ctx.textAlign='left';ctx.fillText(label,tx,ty);}
      this.hit.push({node:n,x:p.x,y:p.y});
    }
  }
  inspect(node){const host=this.inspector;host.replaceChildren();if(this.historical)host.append(text('p','历史快照 · 只读','lifecycle-state'));if(!node){host.append(text('p','点击任一节点查看原文、来源与复核状态。'));return;}const names={source:'原始材料',evidence:'可定位证据',commitment:'承诺',risk:'风险',note:'其他事项'};
    host.append(text('div',(names[node.type]||'节点')+' / '+node.id,'eyebrow'),text('h3',node.label));const p=this.project;
    if(node.type==='source'){host.append(text('p','材料原文：'),text('div',node.detail.slice(0,3500),'quote'));return;}
    if(node.type==='evidence'){const src=p.sources.find(s=>s.id===node.raw.sourceId);host.append(text('p','来源：'+(src?.name||'未找到')),text('div','“'+node.detail+'”','quote'));return;}
    host.append(text('p','复核状态：'+(node.review==='confirmed'?'已人工确认':'待人工复核')),text('p','业务状态：'+STATE_LABEL[node.state],'lifecycle-state'));
    const life=node.raw.lifecycle;if(life){host.append(text('p','负责人：'+(life.owner||'未设置')+' / 截止：'+(life.due||'未设置')),text('p','变更原因：'+(life.reason||'无')));}
    host.append(text('p','证据引用：'));
    for(const ref of node.raw.evidenceIds||[]){const e=p.evidence.find(e=>e.id===ref),src=p.sources.find(s=>s.id===e?.sourceId);if(e)host.append(text('div',(src?.name||'材料')+'\n“'+e.quote+'”','quote'));}
    if(life?.evidenceIds.length){host.append(text('p','状态变更依据：'));for(const ref of life.evidenceIds){const e=p.evidence.find(e=>e.id===ref),src=p.sources.find(s=>s.id===e?.sourceId);if(e)host.append(text('div',(src?.name||'材料')+'\n“'+e.quote+'”','quote'));}}
    for(const l of p.links.filter(l=>!l.retiredAt&&l.review!=='rejected'&&(l.from===node.id||l.to===node.id))){const other=p.claims.find(c=>c.id===(l.from===node.id?l.to:l.from));if(!other||other.review==='rejected')continue;host.append(text('p','关系：'+({related:'相关',supports:'支持',contradicts:'反驳'}[l.kind])+' / '+other.text+'（'+(l.review==='confirmed'?'已确认':'待复核')+'）'));if(l.change)host.append(text('p','变更：'+l.change.reason));for(const ref of new Set([...l.evidenceIds,...(l.change?.evidenceIds||[])])){const e=p.evidence.find(e=>e.id===ref),src=p.sources.find(s=>s.id===e?.sourceId);if(e)host.append(text('div',(src?.name||'材料')+'\n“'+e.quote+'”','quote'));}}
  }
}
