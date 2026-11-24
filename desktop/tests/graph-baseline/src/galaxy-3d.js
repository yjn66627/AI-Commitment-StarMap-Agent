/* 3D visual branch: local canvas perspective renderer, zero network/API and zero auto-rotation.
 * It consumes ONLY GraphContract data after the original ReportGraphAdapter + GraphValidation.
 * Business edges and node counts come solely from validated renderable records.
 */
(function () {
  'use strict';
  const $=id=>document.getElementById(id);
  const TYPES=Object.freeze({person:['责任人','#7dabbf'],commitment:['承诺','#55bccc'],evidence:['证据','#879eb2'],deadline:['期限','#b69c76'],risk:['风险','#c98277'],review:['复核','#77b0a5']});
  const REL=Object.freeze({assigned_to:'负责',evidenced_by:'证据支持',due_on:'约定期限',may_expose_to:'潜在风险',reviewed_by:'复核记录',supports:'支持',contradicts:'反驳',unknown:'未知'});
  const REV=Object.freeze({not_required:'无需复核',not_reviewed:'尚未复核',pending:'待人工复核',confirmed:'有记录的已确认',rejected:'已驳回'});
  const canvas=$('galaxy'),ctx=canvas.getContext('2d',{alpha:false});
  const st={graph:null,renderable:null,points:[],edges:[],selected:null,hover:null,viewport:{w:0,h:0,dpr:1},camera:{yaw:-.22,pitch:.16,zoom:.95,panX:0,panY:0},projected:[],pointer:null,dragged:false,ambient:true,lastError:null};
  const starRng=(seed)=>()=>((seed=(Math.imul(seed,1664525)+1013904223)|0)>>>0)/4294967296;
  const rng=starRng(20261122);
  const backgroundStars=Array.from({length:380},(_,i)=>({x:rng(),y:rng(),r:.35+rng()*1.25,alpha:.12+rng()*.52,layer:rng(),hue:rng()>.93?'181,155,255':'146,203,250'}));
  // No decorative network lines: every displayed graph edge must be validated.
  function clamp(v,min,max){return Math.max(min,Math.min(max,v));}
  function alphaColor(hex,a){const h=hex.replace('#','');return `rgba(${parseInt(h.slice(0,2),16)},${parseInt(h.slice(2,4),16)},${parseInt(h.slice(4,6),16)},${a})`;}
  function newEl(tag,text,klass){const e=document.createElement(tag);if(klass)e.className=klass;if(text!==undefined)e.textContent=String(text);return e;}
  function add(parent,tag,text,klass){const e=newEl(tag,text,klass);parent.appendChild(e);return e;}
  function resize(){const r=canvas.getBoundingClientRect();if(!r.width||!r.height)return;const dpr=Math.min(window.devicePixelRatio||1,2);canvas.width=Math.max(1,Math.round(r.width*dpr));canvas.height=Math.max(1,Math.round(r.height*dpr));st.viewport={w:r.width,h:r.height,dpr};if(st.points.length)containAfterRotation();draw();}
  function point3d(node,index){
    const p=node.position||{x:(index%5)*190,y:Math.floor(index/5)*240};
    // Existing GraphContract x/y positions are retained as spatial anchors.
    // The third axis is purely deterministic view geometry; it is NOT business data.
    const zValues={P_A:-20,P_B:-95,C_A:115,C_B:-80,D_A:-25,D_UNKNOWN:-130,R_A:155,N_EV_MEET:80,N_EV_EMAIL:-30,N_EV_CHECK:5};
    const deterministic=(Array.from(node.id).reduce((v,c)=>v+c.codePointAt(0),0)%151)-75;
    return {id:node.id,node,x:(p.x-640)*.70,y:(p.y-345)*.72,z:zValues[node.id]??deterministic,color:(TYPES[node.type]||TYPES.person)[1]};
  }
  function rotate(p){const c=st.camera,cy=Math.cos(c.yaw),sy=Math.sin(c.yaw),cp=Math.cos(c.pitch),sp=Math.sin(c.pitch);
    const x=p.x*cy-p.z*sy,zi=p.x*sy+p.z*cy;
    return {x,y:p.y*cp-zi*sp,z:p.y*sp+zi*cp};
  }
  function project(p){const a=rotate(p),v=st.viewport;const perspective=950/(950-a.z);const scale=Math.min(v.w/880,v.h/570)*st.camera.zoom;return {x:v.w*.51+st.camera.panX+a.x*perspective*scale,y:v.h*.53+st.camera.panY+a.y*perspective*scale,z:a.z,depth:perspective,scale:scale*perspective};}
  // Rotation-only view containment: keep VALIDATED entity anchors inside a usable viewport.
  // This never modifies graph coordinates, edges, or the user's explicit pan/zoom operations.
  // Labels are independently edge-aware in drawNode().
  function containAfterRotation(){
    const {w,h}=st.viewport;if(!st.points.length||w<180||h<180)return;
    const bounds={left:27,right:w-28,top:80,bottom:h-37};
    function projectedBounds(){
      const p=visibleData().points;
      if(!p.length)return null;
      const screens=p.map(project);
      return {minX:Math.min(...screens.map(s=>s.x)),maxX:Math.max(...screens.map(s=>s.x)),minY:Math.min(...screens.map(s=>s.y)),maxY:Math.max(...screens.map(s=>s.y))};
    }
    // Do not undo a deliberate close-up. Only shrink if rotation would lose anchors,
    // and only when the current zoom is around the overview camera range.
    let bb=projectedBounds();if(!bb)return;
    const availW=bounds.right-bounds.left,availH=bounds.bottom-bounds.top;
    const contentW=bb.maxX-bb.minX,contentH=bb.maxY-bb.minY;
    if(contentW>availW||contentH>availH){
      const fit=Math.min(1,availW/Math.max(contentW,1),availH/Math.max(contentH,1))*.97;
      st.camera.zoom=clamp(st.camera.zoom*fit,.27,3.2);
      bb=projectedBounds();
    }
    if(bb.minX<bounds.left)st.camera.panX+=bounds.left-bb.minX;
    if(bb.maxX>bounds.right)st.camera.panX+=bounds.right-bb.maxX;
    if(bb.minY<bounds.top)st.camera.panY+=bounds.top-bb.minY;
    if(bb.maxY>bounds.bottom)st.camera.panY+=bounds.bottom-bb.maxY;
  }
  function visibleData(){const enabled=new Set(Array.from(document.querySelectorAll('input[data-type]:checked')).map(e=>e.dataset.type));const search=$('search-nodes').value.trim().toLowerCase();const direct=$('show-direct').checked,inferred=$('show-inferred').checked;
    const points=st.points.filter(p=>enabled.has(p.node.type)&&(!search||p.node.id.toLowerCase().includes(search)||p.node.label.toLowerCase().includes(search)));
    const ids=new Set(points.map(x=>x.id));const edges=st.edges.filter(e=>ids.has(e.from)&&ids.has(e.to)&&((e.status.assertion_kind==='source_direct'&&direct)||(e.status.assertion_kind==='ai_inference'&&inferred)));
    return {points,edges};
  }
  function setCounts(){const v=visibleData();$('metric-nodes').textContent=String(v.points.length);$('metric-edges').textContent=String(v.edges.length);$('metric-hidden').textContent=st.renderable?String(st.renderable.withheld):'0';$('metric-evidence').textContent=st.graph?String(st.graph.evidence.length):'0';}
  function fail(message){st.graph=null;st.renderable=null;st.points=[];st.edges=[];st.selected=null;st.hover=null;st.lastError=message;$('status').textContent=message;$('status-led').className='ok-led error-led';$('canvas-error').hidden=false;$('camera-state').textContent='已安全停止';setCounts();resetInspector();draw();}
  function loadReport(report){let result;
    try {result=window.ReportGraphAdapter.adaptReport(report,window.REPORT_INPUT_SCHEMA,window.GRAPH_SCHEMA);}catch(e){fail('数据适配未完成 · 已拒绝绘制');return false;}
    if(!result||!result.ok){fail('合成报告结构或证据引用验证失败 · 已清空图谱');return false;}
    const validated=window.GraphValidation.validateGraph(result.graph,window.GRAPH_SCHEMA);
    if(!validated.ok){fail('图谱跨引用校验失败 · 已清空图谱');return false;}
    st.graph=result.graph;st.renderable=validated.renderable;
    st.points=validated.renderable.nodes.map(point3d);
    st.edges=validated.renderable.edges;
    st.selected=null;st.lastError=null;st.hover=null;$('canvas-error').hidden=true;$('status-led').className='ok-led';
    $('status').textContent=`GraphContract & CrossRefValidator PASS · ${st.points.length} 节点 / ${st.edges.length} 条可见关系 · 完全合成`;
    $('camera-state').textContent='手动控制 · 无自动旋转';
    for(const key of Object.keys(TYPES)){const e=$('count-'+key);if(e)e.textContent=String(st.points.filter(p=>p.node.type===key).length);}
    resetInspector();fillQuickNodes();setCounts();containAfterRotation();draw();return true;
  }
  // Visual-only precision theme. Validated nodes/edges and interaction contracts are unchanged.
  // Decorative guide grids and specks have no IDs, provenance or data edges.
  function drawBackdrop(w,h){
    const g=ctx.createLinearGradient(0,0,w,h);g.addColorStop(0,'#030b13');g.addColorStop(.44,'#071321');g.addColorStop(1,'#030910');ctx.fillStyle=g;ctx.fillRect(0,0,w,h);
    const glow=ctx.createRadialGradient(w*.52,h*.48,12,w*.52,h*.48,Math.max(w,h)*.66);glow.addColorStop(0,'rgba(30,81,111,.20)');glow.addColorStop(.48,'rgba(18,48,71,.085)');glow.addColorStop(1,'rgba(3,9,17,0)');ctx.fillStyle=glow;ctx.fillRect(0,0,w,h);
    if(st.ambient){
      // Very small, low-key background points, never connected or counted as entities.
      for(let i=0;i<backgroundStars.length;i++){
        const s=backgroundStars[i];if(i%3===0)continue;
        const x=s.x*w,y=s.y*h;const a=.045+s.alpha*.19;
        ctx.fillStyle=`rgba(140,190,213,${a.toFixed(3)})`;ctx.fillRect(x,y,Math.max(.5,s.r*.48),Math.max(.5,s.r*.48));
      }
    }
    // Angular console grid. Decorative screen-space measurement, not an entity graph.
    ctx.save();ctx.strokeStyle='rgba(83,139,167,.058)';ctx.lineWidth=.55;
    const grid=52;for(let x=0;x<w;x+=grid){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();}
    for(let y=0;y<h;y+=grid){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
    ctx.strokeStyle='rgba(81,169,186,.105)';ctx.lineWidth=.7;
    const cx=w*.51,cy=h*.53;
    for(const r of [Math.min(w,h)*.18,Math.min(w,h)*.31]){
      ctx.beginPath();ctx.ellipse(cx,cy,r,r*.69,0,.14,1.08);ctx.stroke();
      ctx.beginPath();ctx.ellipse(cx,cy,r,r*.69,0,Math.PI+.15,Math.PI+1.09);ctx.stroke();
    }
    const d=13;ctx.strokeStyle='rgba(99,204,219,.24)';ctx.beginPath();ctx.moveTo(cx-29,cy);ctx.lineTo(cx-d,cy);ctx.moveTo(cx+d,cy);ctx.lineTo(cx+29,cy);ctx.moveTo(cx,cy-29);ctx.lineTo(cx,cy-d);ctx.moveTo(cx,cy+d);ctx.lineTo(cx,cy+29);ctx.stroke();
    // Calibrated ruler marks at the horizontal edges of the viewport.
    ctx.strokeStyle='rgba(117,182,201,.22)';ctx.fillStyle='rgba(112,174,191,.45)';ctx.font='9px ui-monospace,monospace';ctx.textAlign='left';
    for(let i=0;i<Math.floor(w/60);i++){let x=i*60+18;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,i%5===0?12:6);ctx.moveTo(x,h);ctx.lineTo(x,h-(i%5===0?12:6));ctx.stroke();if(i%5===0)ctx.fillText(String(i*60).padStart(4,'0'),x+3,h-18);}
    ctx.restore();
    const vignette=ctx.createRadialGradient(w*.5,h*.48,Math.min(w,h)*.2,w*.5,h*.48,Math.max(w,h)*.74);vignette.addColorStop(0,'rgba(0,0,0,0)');vignette.addColorStop(1,'rgba(0,0,0,.36)');ctx.fillStyle=vignette;ctx.fillRect(0,0,w,h);
  }
  function drawOrbits(w,h){
    // True 3D perspective reference plane. Thin calibrated guides, not business links.
    ctx.save();ctx.strokeStyle='rgba(66,142,168,.075)';ctx.lineWidth=.65;
    for(let t=-480;t<=480;t+=120){
      const a=project({x:t,y:-300,z:-170}),b=project({x:t,y:300,z:-170});
      ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
      const c=project({x:-480,y:t*.64,z:-170}),d=project({x:480,y:t*.64,z:-170});
      ctx.beginPath();ctx.moveTo(c.x,c.y);ctx.lineTo(d.x,d.y);ctx.stroke();
    }
    const base=project({x:0,y:0,z:-170});ctx.strokeStyle='rgba(62,180,191,.20)';ctx.lineWidth=.7;ctx.beginPath();ctx.moveTo(base.x-9,base.y);ctx.lineTo(base.x+9,base.y);ctx.moveTo(base.x,base.y-9);ctx.lineTo(base.x,base.y+9);ctx.stroke();ctx.restore();
  }
  function drawEdge(a,b,edge,active){
    const inferred=edge.status.assertion_kind==='ai_inference';
    ctx.save();ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);
    ctx.lineWidth=active?1.6:inferred?.95:.8;
    ctx.setLineDash(inferred?[3,5]:[]);
    ctx.strokeStyle=active?(inferred?'rgba(226,155,112,.92)':'rgba(96,223,234,.94)'):(inferred?'rgba(185,126,91,.40)':'rgba(91,153,180,.27)');
    ctx.stroke();ctx.setLineDash([]);
    if(active){
      const midx=(a.x+b.x)/2,midy=(a.y+b.y)/2;ctx.strokeStyle=inferred?'rgba(237,168,108,.66)':'rgba(93,221,231,.72)';ctx.lineWidth=.75;
      ctx.beginPath();ctx.moveTo(midx-3,midy);ctx.lineTo(midx+3,midy);ctx.moveTo(midx,midy-3);ctx.lineTo(midx,midy+3);ctx.stroke();
    }
    ctx.restore();
  }
  function drawNode(p,s,active,dimmed){
    // Engineering-grade locator glyphs: no filled glossy spheres or candy gradients.
    const r=clamp((p.node.type==='commitment'?8:6.1)*s.depth*s.scale,3.7,11);
    s.radius=Math.max(r,8);const c=p.color;
    ctx.save();ctx.globalAlpha=dimmed?.28:1;
    const peripheral=active?Math.max(r+10,17):Math.max(r+5,12);
    if(active){ctx.strokeStyle=alphaColor(c,.18);ctx.lineWidth=.7;ctx.beginPath();ctx.arc(s.x,s.y,peripheral+11,.14,1.46);ctx.stroke();ctx.beginPath();ctx.arc(s.x,s.y,peripheral+11,3.36,4.67);ctx.stroke();}
    ctx.strokeStyle=alphaColor(c,active?.96:.56);ctx.lineWidth=active?1.25:.8;
    if(p.node.type==='commitment'){
      const sz=r+2;ctx.beginPath();ctx.moveTo(s.x,s.y-sz);ctx.lineTo(s.x+sz,s.y);ctx.lineTo(s.x,s.y+sz);ctx.lineTo(s.x-sz,s.y);ctx.closePath();ctx.stroke();
    }else if(p.node.type==='evidence'){
      ctx.strokeRect(s.x-r,s.y-r,r*2,r*2);
    }else if(p.node.type==='risk'){
      ctx.beginPath();ctx.moveTo(s.x,s.y-r-2);ctx.lineTo(s.x+r+1,s.y+r);ctx.lineTo(s.x-r-1,s.y+r);ctx.closePath();ctx.stroke();
    }else if(p.node.type==='deadline'){
      ctx.beginPath();ctx.moveTo(s.x-r-2,s.y);ctx.lineTo(s.x-r*.5,s.y-r*.95);ctx.lineTo(s.x+r*.5,s.y-r*.95);ctx.lineTo(s.x+r+2,s.y);ctx.lineTo(s.x+r*.5,s.y+r*.95);ctx.lineTo(s.x-r*.5,s.y+r*.95);ctx.closePath();ctx.stroke();
    }else{
      ctx.beginPath();ctx.arc(s.x,s.y,r,0,Math.PI*2);ctx.stroke();
    }
    ctx.fillStyle=active?'#d6f9fa':alphaColor(c,.76);
    ctx.fillRect(s.x-1.25,s.y-1.25,2.5,2.5);
    // Fine acquisition ticks and 4-corner locator for selected entity.
    ctx.strokeStyle=alphaColor(c,active?.65:.22);ctx.lineWidth=.6;
    ctx.beginPath();ctx.moveTo(s.x-r-7,s.y);ctx.lineTo(s.x-r-3,s.y);ctx.moveTo(s.x+r+3,s.y);ctx.lineTo(s.x+r+7,s.y);ctx.moveTo(s.x,s.y-r-7);ctx.lineTo(s.x,s.y-r-3);ctx.moveTo(s.x,s.y+r+3);ctx.lineTo(s.x,s.y+r+7);ctx.stroke();
    if(active){
      const r2=peripheral;ctx.strokeStyle=alphaColor(c,.50);ctx.lineWidth=.85;ctx.beginPath();ctx.arc(s.x,s.y,r2,-.65,.5);ctx.arc(s.x,s.y,r2,2.4,3.55);ctx.stroke();
    }
    const label=p.node.label.split('\n')[0],suffix=p.node.label.split('\n')[1];
    ctx.font=`${active?'600':'500'} 11px "Noto Sans CJK SC","Microsoft YaHei",sans-serif`;
    // Prefer visible evidence identifiers instead of fixed 11-character truncation;
    // use actual text width so Chinese and Latin labels behave consistently.
    const allowedText=Math.min(active?174:138,Math.max(90,st.viewport.w*.235));
    let t=label;
    while(t.length>1 && ctx.measureText(t).width>allowedText)t=t.slice(0,-1);
    if(t!==label)t=t.slice(0,-1)+'…';
    const readableWidth=ctx.measureText(t).width+16;
    ctx.font='8px ui-monospace,monospace';
    const idWidth=ctx.measureText(p.id).width+12;
    ctx.font=`${active?'600':'500'} 11px "Noto Sans CJK SC","Microsoft YaHei",sans-serif`;
    const width=Math.min(Math.max(readableWidth,idWidth,46),Math.max(70,st.viewport.w-16));
    // Adaptive label anchor: labels can flip toward the center instead of leaving
    // the canvas, and may not overlap the fixed title/status zones.
    const preferRight=s.x+Math.max(r+12,17);
    const preferLeft=s.x-Math.max(r+15,19)-width;
    const useLeft=preferRight+width>st.viewport.w-10 && preferLeft>=10;
    const lx=clamp(useLeft?preferLeft:preferRight,8,Math.max(8,st.viewport.w-width-8));
    const ly=clamp(s.y-15,97,Math.max(97,st.viewport.h-60));
    // Thin rectilinear identifier labels, never pill-shaped chips.
    ctx.fillStyle=active?'rgba(8,25,36,.96)':'rgba(5,17,28,.82)';ctx.fillRect(lx,ly,width,21);
    ctx.fillStyle=active?alphaColor(c,.9):'rgba(104,164,185,.35)';ctx.fillRect(lx,ly,1,21);
    ctx.fillStyle=active?'#d8eff4':'#9ab7c7';ctx.textAlign='left';ctx.fillText(t,lx+8,ly+14);
    ctx.font='8px ui-monospace,monospace';ctx.fillStyle=active?'rgba(107,210,222,.82)':'rgba(96,142,169,.62)';ctx.fillText(p.id,lx+1,ly-5);
    if(active&&suffix){ctx.fillStyle='#9bb4c4';ctx.font='10px "Noto Sans CJK SC",sans-serif';ctx.fillText(suffix.slice(0,28),lx+8,ly+34);}
    ctx.restore();
  }
  function draw(){const {w,h,dpr}=st.viewport;if(!ctx||!w||!h)return;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);drawBackdrop(w,h);drawOrbits(w,h);if(!st.graph)return;
    const visible=visibleData(),pmap=new Map();st.projected=[];
    for(const p of visible.points){const screen=project(p);pmap.set(p.id,screen);st.projected.push({p,screen});}
    const active=st.selected;const adjacent=new Set();if(active){adjacent.add(active.id);for(const e of visible.edges){if(e.from===active.id)adjacent.add(e.to);if(e.to===active.id)adjacent.add(e.from);}}
    for(const e of visible.edges){const a=pmap.get(e.from),b=pmap.get(e.to);if(!a||!b)continue;const highlight=active&&((active.kind==='edge'&&e.id===active.id)||(active.kind==='node'&&(e.from===active.id||e.to===active.id)));
      drawEdge(a,b,e,Boolean(highlight));}
    st.projected.sort((a,b)=>a.screen.z-b.screen.z);for(const {p,screen} of st.projected){const highlighted=(active&&((active.kind==='node'&&active.id===p.id)||(active.kind==='edge'&&visible.edges.some(e=>e.id===active.id&&(e.from===p.id||e.to===p.id)))))||(st.hover?.kind==='node'&&st.hover.id===p.id);drawNode(p,screen,Boolean(highlighted),Boolean(active&&active.kind==='node'&&!adjacent.has(p.id)));}
  }
  function nearest(x,y){let node=null,best=24;for(let i=st.projected.length-1;i>=0;i--){const {p,screen}=st.projected[i];const dis=Math.hypot(x-screen.x,y-screen.y);const threshold=Math.max(16,screen.radius*1.6);if(dis<threshold&&dis<best){node={kind:'node',id:p.id};best=dis;}}
    if(node)return node;let line=null,dmin=8;const v=visibleData();const screenMap=new Map(st.projected.map(({p,screen})=>[p.id,screen]));for(const e of v.edges){const a=screenMap.get(e.from),b=screenMap.get(e.to);if(!a||!b)continue;const t=clamp(((x-a.x)*(b.x-a.x)+(y-a.y)*(b.y-a.y))/((b.x-a.x)**2+(b.y-a.y)**2||1),0,1);const d=Math.hypot(x-a.x-t*(b.x-a.x),y-a.y-t*(b.y-a.y));if(d<dmin){dmin=d;line={kind:'edge',id:e.id};}}
    return line;}
  function describeLocator(e){const p=e.locator||{};return [p.section||'未提供段落位置',p.paragraph_index!==undefined?`段落 ${p.paragraph_index}`:null,p.line_start!==undefined?`行 ${p.line_start}${p.line_end!==undefined&&p.line_end!==p.line_start?'–'+p.line_end:''}`:null].filter(Boolean).join(' · ');}
  function resetInspector(){const host=$('inspector');host.replaceChildren();const e=add(host,'div',undefined,'empty-graphic');const ring=add(e,'div',undefined,'empty-ring');add(ring,'span','⌖','empty-glyph');add(host,'div','点击星图节点，追溯证据链','empty-title');add(host,'p','旋转、缩放三维星图；选择一个承诺、证据或连线，查看经过原始校验的引用、来源和模拟复核状态。','empty-text');add(host,'div','01 选择实体 → 02 查看来源 → 03 核对复核','empty-steps');}
  function inspect(kind,id){if(!st.graph)return;const data=st.graph;const item=(kind==='node'?data.nodes:data.edges).find(x=>x.id===id);if(!item)return;st.selected={kind,id};$('tab-detail').classList.add('active');$('tab-policy').classList.remove('active');const host=$('inspector');host.replaceChildren();
    add(host,'div',kind==='node'?'NODE INTELLIGENCE':'RELATION INTELLIGENCE','section-kicker');
    add(host,'h3',kind==='node'?item.label:(REL[item.relation]||item.relation),'inspect-title');add(host,'div',item.id,'inspect-id');
    const tags=add(host,'div',undefined,'chip-row');add(tags,'span',item.status.assertion_kind==='source_direct'?'来源直接陈述':item.status.assertion_kind==='ai_inference'?'模拟推断':'未知信息','chip');add(tags,'span',REV[item.status.review_status]||item.status.review_status,'chip'+(item.status.review_status==='pending'?' pending':''));
    if(kind==='edge')add(tags,'span',`${item.from} → ${item.to}`,'chip');
    let section=add(host,'section',undefined,'inspector-section');add(section,'h3','审计解释');add(section,'p',item.status.assertion_kind==='source_direct'?'该关系来自合成资料中的直接陈述，不代表已独立证明其真实性。':item.status.assertion_kind==='ai_inference'?'模拟推断，必须人工复核；不构成真实AI预测或违约判断。':'未知信息保留为未知，不补写事实关系。');
    if(item.status.unknown_reason)add(section,'p',item.status.unknown_reason);
    section=add(host,'section',undefined,'inspector-section');add(section,'h3',`引用证据 · ${item.provenance.evidence_refs.length} 项`);
    if(!item.provenance.evidence_refs.length)add(section,'p','没有可绘制的事实证据，未知信息不得自动连线。');
    for(const ref of item.provenance.evidence_refs){const evidence=data.evidence.find(e=>e.id===ref);if(!evidence)continue;const src=data.sources.find(s=>s.id===evidence.source_ref);const card=add(section,'div',undefined,'evidence-card');add(card,'h4',`▣ ${evidence.id}`);add(card,'div',`来源：${src?.display_name||'无法定位'} (${evidence.source_ref})`,'card-meta');add(card,'div',`位置：${describeLocator(evidence)}`,'card-meta');add(card,'div',`追溯：${evidence.traceability==='located'?'可精确定位':evidence.traceability}`,'card-meta');add(card,'blockquote',evidence.excerpt===null?'原文已限制展示':evidence.excerpt);}
    if(item.status.review_event_ref){const r=data.review_events.find(e=>e.id===item.status.review_event_ref);if(r){section=add(host,'section',undefined,'inspector-section');add(section,'h3','模拟复核记录');add(section,'p',`记录：${r.id} · 目标：${r.target_kind==='node'?'节点':'关系'} ${r.target_ref}`);add(section,'p',`结论：${r.decision==='confirm'?'确认':'驳回'} · 复核人：${data.nodes.find(n=>n.id===r.actor_ref)?.label.replace(/\n/g,' / ')||'未知'}`);add(section,'p',`时间：${new Date(r.occurred_at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}（北京时间）`);add(section,'p',r.notes||'');}}
    add(host,'div','全部内容来自完全合成的校验案例，不代表真实人员签署、真实项目履约或AI自动判定。','data-disclaimer');
    document.querySelectorAll('.quick-nodes button').forEach(b=>b.classList.toggle('selected',b.dataset.id===id));draw();
  }
  function fillQuickNodes(){const box=$('quick-nodes');box.replaceChildren();for(const p of st.points.filter(p=>p.node.type==='commitment'||p.node.type==='risk'||p.node.type==='person').slice(0,7)){const b=add(box,'button',`${(TYPES[p.node.type]||TYPES.person)[0]} · ${p.node.label.split('\n')[0]}`);b.type='button';b.dataset.id=p.id;b.addEventListener('click',()=>focusNode(p.id));}}
  function focusNode(id){const p=st.points.find(p=>p.id===id);if(!p)return;inspect('node',id);const s=project(p);st.camera.panX+=st.viewport.w*.50-s.x;st.camera.panY+=st.viewport.h*.50-s.y;draw();}
  function selectAt(x,y){const sel=nearest(x,y);if(!sel){st.selected=null;resetInspector();draw();return;}if(sel.kind==='node')focusNode(sel.id);else inspect(sel.kind,sel.id);}
  function resetCamera(){st.camera={yaw:-.22,pitch:.16,zoom:.95,panX:0,panY:0};draw();}
  function controls(){let pt=null;canvas.addEventListener('pointerdown',e=>{if(e.button!==0&&e.button!==2)return;e.preventDefault();const r=canvas.getBoundingClientRect();pt={x:e.clientX-r.left,y:e.clientY-r.top,px:e.clientX,py:e.clientY,button:e.button,dragged:false};st.pointer=pt;canvas.setPointerCapture(e.pointerId);});
    canvas.addEventListener('pointermove',e=>{if(pt){const dx=e.clientX-pt.px,dy=e.clientY-pt.py;pt.px=e.clientX;pt.py=e.clientY;if(Math.abs(dx)+Math.abs(dy)>0&&Math.hypot(e.clientX-(pt.x+canvas.getBoundingClientRect().left),e.clientY-(pt.y+canvas.getBoundingClientRect().top))>4)pt.dragged=true;if(pt.dragged){if(pt.button===2){st.camera.panX+=dx;st.camera.panY+=dy;}else{st.camera.yaw+=dx*.006;st.camera.pitch=clamp(st.camera.pitch+dy*.005,-1.45,1.45);containAfterRotation();}draw();}return;}
      const r=canvas.getBoundingClientRect();const hit=nearest(e.clientX-r.left,e.clientY-r.top);if(hit?.id!==st.hover?.id||hit?.kind!==st.hover?.kind){st.hover=hit;canvas.classList.toggle('node-hover',Boolean(hit));draw();}
    });
    function release(e){if(!pt)return;const p=pt;pt=null;st.pointer=null;if(!p.dragged&&p.button===0){const r=canvas.getBoundingClientRect();selectAt(e.clientX-r.left,e.clientY-r.top);}}
    canvas.addEventListener('pointerup',release);canvas.addEventListener('pointercancel',()=>{pt=null;st.pointer=null;});canvas.addEventListener('contextmenu',e=>e.preventDefault());
    canvas.addEventListener('wheel',e=>{e.preventDefault();st.camera.zoom=clamp(st.camera.zoom*(e.deltaY<0?1.13:1/1.13),.38,3.2);draw();},{passive:false});
    canvas.addEventListener('keydown',e=>{const key=e.key;if(key==='ArrowLeft')st.camera.yaw-=.13;else if(key==='ArrowRight')st.camera.yaw+=.13;else if(key==='ArrowUp')st.camera.pitch=clamp(st.camera.pitch-.13,-1.45,1.45);else if(key==='ArrowDown')st.camera.pitch=clamp(st.camera.pitch+.13,-1.45,1.45);else if(key==='+'||key==='=')st.camera.zoom=clamp(st.camera.zoom*1.15,.38,3.2);else if(key==='-')st.camera.zoom=clamp(st.camera.zoom/1.15,.38,3.2);else if(key==='Home')resetCamera();else return;e.preventDefault();if(key.startsWith('Arrow'))containAfterRotation();draw();});
    for(const el of document.querySelectorAll('input[data-type],#show-direct,#show-inferred,#search-nodes'))el.addEventListener(el.id==='search-nodes'?'input':'change',()=>{setCounts();st.selected=null;resetInspector();draw();});
    $('show-ambient').addEventListener('change',e=>{st.ambient=e.target.checked;draw();});
    $('btn-restore').addEventListener('click',()=>{document.querySelectorAll('input[data-type]').forEach(el=>el.checked=true);$('show-direct').checked=true;$('show-inferred').checked=true;$('show-ambient').checked=true;$('search-nodes').value='';st.ambient=true;loadReport(window.COMPETITION_SYNTHETIC_REPORT);resetCamera();});
    $('file-input').addEventListener('change',async e=>{const file=e.target.files?.[0];if(!file)return;try{if(file.size>250000){fail('本地合成报告超过250KB上限 · 已清空图谱');return;}const data=JSON.parse(await file.text());loadReport(data);}catch(_){fail('本地合成报告解析失败 · 已清空图谱');}finally{e.target.value='';}});
    document.querySelector('.import-control').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('file-input').click();}});
    $('btn-zoom-in').addEventListener('click',()=>{st.camera.zoom=clamp(st.camera.zoom*1.25,.38,3.2);draw();});
    $('btn-zoom-out').addEventListener('click',()=>{st.camera.zoom=clamp(st.camera.zoom/1.25,.38,3.2);draw();});
    $('btn-home').addEventListener('click',()=>{resetCamera();st.selected=null;resetInspector();document.querySelectorAll('.quick-nodes button').forEach(b=>b.classList.remove('selected'));});
    const guide=$('guide-dialog');$('btn-guide').addEventListener('click',()=>guide.hidden=false);$('guide-ok').addEventListener('click',()=>guide.hidden=true);$('close-guide').addEventListener('click',()=>guide.hidden=true);guide.addEventListener('click',e=>{if(e.target===guide)guide.hidden=true;});
    $('tab-policy').addEventListener('click',()=>{st.selected=null;resetInspector();const host=$('inspector');host.replaceChildren();add(host,'div','VALIDATION POLICY','section-kicker');add(host,'h3','数据展示边界','inspect-title');const sec=add(host,'section',undefined,'inspector-section');add(sec,'h3','沿用原项目安全契约');for(const t of ['只接收 fully_synthetic_demo 约定合成报告。','先执行报告Schema及适配器，再通过GraphContract和跨引用验证。','缺失来源、复核错绑、未知关系或受限关系不得强行渲染。','三维深度、星星和轨道仅为显示层，不属于业务事实。','不调用真实AI模型，不写数据库或外部网络。'])add(sec,'p','✓ '+t);$('tab-policy').classList.add('active');$('tab-detail').classList.remove('active');draw();});
    $('tab-detail').addEventListener('click',()=>{$('tab-detail').classList.add('active');$('tab-policy').classList.remove('active');if(st.selected){const {kind,id}=st.selected;st.selected=null;inspect(kind,id);}else resetInspector();});
    document.addEventListener('keydown',e=>{if(e.key==='Escape')guide.hidden=true;if(e.key==='/'&&document.activeElement?.tagName!=='INPUT'){e.preventDefault();$('search-nodes').focus();}});
    window.addEventListener('resize',resize);if(window.ResizeObserver)new ResizeObserver(resize).observe(canvas);
  }
  controls();$('clock').textContent='LOCAL / OFFLINE';resetInspector();resize();
  if(!ctx){fail('当前浏览器不支持Canvas，无法呈现3D视图');}else loadReport(window.COMPETITION_SYNTHETIC_REPORT);
  // Visible test API: read-only camera inspection, safe synthetic report injection, reset, and deterministic projection.
  window.__star3d=Object.freeze({
    getState(){return {camera:{...st.camera},nodes:st.points.length,edges:st.edges.length,visibleNodes:visibleData().points.length,visibleEdges:visibleData().edges.length,selected:st.selected?{...st.selected}:null,hasGraph:!!st.graph,err:st.lastError};},
    loadReport,restore(){return loadReport(window.COMPETITION_SYNTHETIC_REPORT);},resetCamera,
    pointScreen(id){const p=st.projected.find(x=>x.p.id===id);return p?{x:p.screen.x,y:p.screen.y}:null;},
    focusNode,selectAt,
    rotateBy(dx,dy){st.camera.yaw+=dx;st.camera.pitch=clamp(st.camera.pitch+dy,-1.45,1.45);containAfterRotation();draw();},
    viewportBounds(){const {w,h}=st.viewport;return {w,h,visible:visibleData().points.map(p=>({id:p.id,x:project(p).x,y:project(p).y}))};}
  });
})();
