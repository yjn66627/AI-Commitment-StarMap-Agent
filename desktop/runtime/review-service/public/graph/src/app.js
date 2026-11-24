/* AI承诺星图 Stage A. Isolated fictional-data demonstration only. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const labels = {
    assigned_to:'负责',evidenced_by:'证据支持',due_on:'约定期限',
    may_expose_to:'潜在风险',reviewed_by:'复核记录',unknown:'未知（不绘制）',
    source_direct:'来源直接陈述',ai_inference:'模拟推断',unknown_kind:'未知',
    not_required:'无需复核',not_reviewed:'尚未复核',pending:'待人工复核',confirmed:'有记录的已确认',rejected:'已驳回',
    synthetic:'合成数据',masked:'已脱敏',withheld:'不予展示',
    located:'可精确定位',approximate:'只能大致定位',unavailable:'无法定位',
    confirm:'确认',reject:'驳回',node:'节点',edge:'关系',
    person:'人物',commitment:'承诺',evidence:'证据',deadline:'期限',risk:'风险',review:'复核'
  };
  const errorLabels = {
    SCHEMA_ERROR:'数据结构错误',DUPLICATE_ID:'数据标识重复',PRIVACY_BLOCK:'数据不符合演示隐私要求',
    MISSING_SOURCE:'未找到证据来源',MISSING_EVIDENCE:'缺少可追溯证据',DANGLING_REF:'关系指向不存在的节点',
    UNSUPPORTED_RELATION:'关系类型不符合约束',UNVERIFIED_REVIEW:'复核依据无效',
    REVIEW_TARGET_MISMATCH:'复核对象绑定错误',REVIEW_EVENT_REUSE:'复核事件被多个对象复用',
    REVIEW_TARGET_NOT_FOUND:'复核目标不存在或类型错误',REVIEW_DUPLICATE_TARGET:'同一对象存在冲突的复核事件',
    REVIEW_STATUS_MISMATCH:'复核记录与对象状态不一致',REVIEW_ORPHAN:'复核事件没有对应的有效对象',
    RENDER_POLICY:'数据展示限制不符合规定',PROVENANCE_ERROR:'来源引用不一致',UNSAFE_TEXT:'文本存在潜在安全风险'
  };
  const state = {cy:null,data:null,validated:null,selectedId:null};
  function textElement(tag,content,className){
    const el=document.createElement(tag);
    if(className) el.className=className;
    el.textContent=String(content===undefined||content===null?'—':content);
    return el;
  }
  function add(parent,tag,content,className){const el=textElement(tag,content,className);parent.appendChild(el);return el;}
  function setBanner(message,kind){const el=$('validation-banner');el.textContent=message;el.className='validation-banner'+(kind?' '+kind:'');}
  function destroyGraph(){if(state.cy){state.cy.destroy();state.cy=null;} $('graph').replaceChildren();state.data=null;state.validated=null;state.selectedId=null;}
  function clearInspector(){
    const host=$('inspector');host.replaceChildren();
    const blank=add(host,'div','','empty-inspector');
    add(blank,'div','⌁','inspect-symbol');add(blank,'h3','选择一项关系');
    add(blank,'p','点击承诺、证据或连线，查看对应的合成证据、定位及复核状态。');
    add(blank,'div','这里只展示经过验证的数据，不生成任何新事实。','empty-steps');
  }
  function failed(errors,message){
    destroyGraph();
    $('graph-empty').hidden=false;
    $('metric-nodes').textContent='0';$('metric-edges').textContent='0';
    $('graph-counter').textContent='未渲染';
    const codes=errors.slice(0,4).map(e=>(errorLabels[e.code]||'数据验证失败')+'（位置：'+e.path+'）').join(' · ');
    setBanner(message+(codes?'｜'+codes:'')+(errors.length>4?`，另有 ${errors.length-4} 项`:''),'error');
    clearInspector();
  }
  function styleRules(){
    return [
      {selector:'node',style:{
        'label':'data(label)','color':'#f2f7ff','font-family':'Microsoft YaHei, PingFang SC, Noto Sans CJK SC, sans-serif',
        'font-size':16,'font-weight':600,'text-wrap':'wrap','text-max-width':'160px','text-halign':'center','text-valign':'center',
        'width':156,'height':68,'shape':'round-rectangle','background-color':'#2d5c7e','background-opacity':1,
        'border-width':2,'border-color':'#7ab9f5','border-opacity':1,'text-outline-width':0,
        'shadow-opacity':0,'z-index':4
      }},
      {selector:'node[type="person"]',style:{'background-color':'#314d87','border-color':'#93b9ff','width':132,'height':68}},
      {selector:'node[type="commitment"]',style:{'background-color':'#116b68','border-color':'#70e8d1','width':190,'height':84,'font-size':17}},
      {selector:'node[type="evidence"]',style:{'background-color':'#4e4579','border-color':'#c7aefe','width':154,'height':69}},
      {selector:'node[type="deadline"]',style:{'background-color':'#70502e','border-color':'#f7c582','width':155,'height':67}},
      {selector:'node[type="risk"]',style:{'background-color':'#793a4d','border-color':'#ffa2b0','width':193,'height':83}},
      {selector:'node[assertionKind="ai_inference"]',style:{'border-style':'dashed','border-width':3}},
      {selector:'node[reviewStatus="pending"]',style:{'border-width':4}},
      {selector:'node[assertionKind="unknown"]',style:{'background-color':'#2d3548','border-color':'#8b99ad','border-style':'dotted','color':'#bbc6d9','border-width':3}},
      {selector:'edge',style:{'curve-style':'bezier','line-color':'#83bbd8','target-arrow-color':'#83bbd8','target-arrow-shape':'triangle','arrow-scale':1.15,
        'width':2.8,'opacity':.88,'line-style':'solid','label':'data(displayLabel)','font-family':'Microsoft YaHei, PingFang SC, Noto Sans CJK SC, sans-serif',
        'font-size':12,'font-weight':600,'color':'#cdddf4','text-background-color':'#101d30','text-background-opacity':.92,
        'text-background-padding':'5px','text-background-shape':'roundrectangle','text-rotation':'autorotate','text-margin-y':-11}},
      {selector:'edge[assertionKind="ai_inference"]',style:{'line-style':'dashed','line-color':'#f5ae83','target-arrow-color':'#f5ae83','color':'#ffd0a8','width':3.5}},
      {selector:':selected',style:{'overlay-opacity':0,'border-color':'#ffffff','border-width':5,'line-color':'#eef6ff','target-arrow-color':'#eef6ff'}}
    ];
  }
  function makeCyElements(renderable){
    const items=[];
    for(const n of renderable.nodes){
      items.push({group:'nodes',data:{id:n.id,type:n.type,label:n.label,assertionKind:n.status.assertion_kind,reviewStatus:n.status.review_status},position:n.position?{x:n.position.x,y:n.position.y}:{x:0,y:0}});
    }
    for(const e of renderable.edges){
      const prefix=e.status.assertion_kind==='ai_inference'?'推断 · ':'';
      const suffix=e.status.review_status==='pending'?' / 待复核':'';
      items.push({group:'edges',data:{id:e.id,source:e.from,target:e.to,relation:e.relation,assertionKind:e.status.assertion_kind,reviewStatus:e.status.review_status,displayLabel:prefix+(labels[e.relation]||e.relation)+suffix}});
    }
    return items;
  }
  function createFallback(data,renderable){
    const host=$('graph');host.replaceChildren();
    const container=add(host,'div','','fallback-grid');container.style.cssText='padding:24px;overflow:auto;height:100%;color:#d6e3f6';
    add(container,'h3','图谱引擎不可用 · 安全降级为证据列表');
    add(container,'p','此模式不具备缩放拖动能力，不宣称图谱功能通过。');
    for(const n of renderable.nodes.filter(x=>x.type==='commitment')){
      const b=document.createElement('button');b.type='button';b.textContent=n.label.replace(/\n/g,' / ')+'　·　查看证据';b.style.cssText='display:block;margin:12px 0;padding:12px;background:#243b50;color:white;border:1px solid #7192ad;border-radius:8px;';
      b.addEventListener('click',()=>inspectItem(n.id,'node'));container.appendChild(b);
    }
  }
  function loadData(data){
    // Fail closed: full structural and cross-reference validation must complete BEFORE any graphics or sidebar content is populated.
    const result=window.GraphValidation.validateGraph(data,window.GRAPH_SCHEMA);
    if(!result.ok){failed(result.errors,'输入被拒绝：先验证数据，再渲染');return false;}
    destroyGraph();
    state.data=data;state.validated=result;
    $('graph-empty').hidden=true;
    $('metric-nodes').textContent=String(result.renderable.nodes.length);
    $('metric-edges').textContent=String(result.renderable.edges.length);
    $('graph-counter').textContent=`${result.renderable.nodes.length} 节点 / ${result.renderable.edges.length} 可见连线`;
    clearInspector();
    if(typeof window.cytoscape!=='function'){
      createFallback(data,result.renderable);
      setBanner('安全数据验证通过，但Cytoscape.js不可用；已降级为只读证据列表。图谱运行状态：未核验','degraded');
      return true;
    }
    try{
      state.cy=window.cytoscape({
        container:$('graph'),elements:makeCyElements(result.renderable),style:styleRules(),
        layout:{name:'preset',fit:true,padding:48},minZoom:.25,maxZoom:2.5,
        wheelSensitivity:.18,boxSelectionEnabled:false,autounselectify:false,userPanningEnabled:true,userZoomingEnabled:true,autoungrabify:false
      });
      state.cy.on('tap','node, edge',event=>inspectItem(event.target.id(),event.target.isNode()?'node':'edge'));
      state.cy.on('tap',event=>{if(event.target===state.cy)clearInspector();});
      applyFilters();
      setBanner(`验证通过 · ${result.renderable.nodes.length}个节点 · ${result.renderable.edges.length}条有依据的关系 · ${result.renderable.withheld}条未知/受限关系未绘制 · Cytoscape.js ${window.cytoscape.version} · 完全合成数据`);
    }catch(e){
      // Do not pass raw exception messages to UI, in case a bad imported value surfaces in them.
      if(state.cy){state.cy.destroy();state.cy=null;}
      createFallback(data,result.renderable);
      setBanner('图谱引擎运行异常，已切换安全只读回退。图谱运行状态：未核验','degraded');
    }
    return true;
  }
  function applyFilters(){
    if(!state.cy || !state.validated)return;
    const enabled=new Set(Array.from(document.querySelectorAll('[data-node-type]:checked')).map(el=>el.dataset.nodeType));
    const direct=$('edge-direct').checked,infer=$('edge-inference').checked;
    const search=$('search-nodes').value.trim().toLowerCase();
    const visible=new Set();
    state.cy.nodes().forEach(node=>{
      const match=enabled.has(node.data('type')) && (!search||node.data('label').toLowerCase().includes(search)||node.id().toLowerCase().includes(search));
      if(match){node.show();visible.add(node.id());}else node.hide();
    });
    state.cy.edges().forEach(edge=>{
      const type=edge.data('assertionKind');
      const match=visible.has(edge.source().id())&&visible.has(edge.target().id())&&((type==='source_direct'&&direct)||(type==='ai_inference'&&infer));
      if(match)edge.show();else edge.hide();
    });
    const shown=state.cy.edges().filter(e=>e.visible()).length;
    $('metric-edges').textContent=String(shown);
    $('metric-nodes').textContent=String(visible.size);
  }
  function describeLocator(e){
    const loc=e.locator||{};
    const v=[loc.section||'位置未提供'];
    if(loc.paragraph_index!==undefined)v.push(`段落索引 ${loc.paragraph_index}`);
    if(loc.line_start!==undefined)v.push(`行 ${loc.line_start}${loc.line_end!==undefined&&loc.line_end!==loc.line_start?'-'+loc.line_end:''}`);
    if(loc.char_start!==undefined)v.push(`字符 ${loc.char_start}${loc.char_end!==undefined?'-'+loc.char_end:''}`);
    return v.join(' · ');
  }
  function inspectItem(id,kind){
    if(!state.data||!state.validated)return;
    const item=(kind==='node'?state.data.nodes:state.data.edges).find(x=>x.id===id);
    if(!item)return;
    state.selectedId=id;
    const host=$('inspector');host.replaceChildren();
    add(host,'div',kind==='node'?'节点详情':'关系详情','detail-overline');
    const displayName=kind==='node'?item.label:(labels[item.relation]||item.relation);
    add(host,'h3',displayName,'detail-title');add(host,'div',item.id,'detail-id');
    const tags=add(host,'div','','detail-status');
    add(tags,'span',item.status.assertion_kind==='source_direct'?'来源直接陈述':item.status.assertion_kind==='ai_inference'?'模拟推断':'未知信息');
    add(tags,'span',labels[item.status.review_status]||item.status.review_status,item.status.review_status==='pending'?'pending':'');
    if(kind==='edge')add(tags,'span',`${item.from} → ${item.to}`);
    const section=add(host,'section','','detail-section');add(section,'h3','数据身份与验证状态');
    add(section,'p','图谱数据类别：完全合成演示','detail-line');
    add(section,'p',item.status.assertion_kind==='source_direct'?'仅表示虚构来源中有相应陈述，不代表事实已被独立核实。':item.status.assertion_kind==='ai_inference'?'推断基于模拟规则，不代表实际AI模型预测，也不构成违约判断。':'信息未获确认，不创建事实边。','detail-line');
    if(item.status.unknown_reason)add(section,'p',item.status.unknown_reason,'detail-line');
    const proof=add(host,'section','','detail-section');add(proof,'h3',`来源证据（${item.provenance.evidence_refs.length}）`);
    if(!item.provenance.evidence_refs.length)add(proof,'p','没有可引用证据；未知信息不得建立连线。','empty-evidence');
    for(const ref of item.provenance.evidence_refs){
      const e=state.data.evidence.find(x=>x.id===ref);
      if(!e)continue; // unreachable after CrossRefValidator PASS
      const src=state.data.sources.find(x=>x.id===e.source_ref);
      const card=add(proof,'article','','evidence-card');
      add(card,'h4',`证据ID · ${e.id}`);
      add(card,'p',`来源：${src?src.display_name:'不可定位'} (${e.source_ref})`,'evidence-meta');
      add(card,'p',`定位：${describeLocator(e)}`,'evidence-meta');
      add(card,'p',`来源可追溯：${labels[e.traceability]||'尚未核验'} · 摘录状态：${labels[e.privacy_state]||'未知'}`,'evidence-meta');
      add(card,'div',e.excerpt===null?'已隐藏，不展示原文':e.excerpt,'evidence-quote');
    }
    // Display the validated, target-bound synthetic review record with plain-text rendering.
    if(item.status.review_event_ref){
      const record=state.data.review_events.find(e=>e.id===item.status.review_event_ref);
      if(record){
        const reviewSection=add(host,'section','','detail-section');
        add(reviewSection,'h3','对应复核记录（完全合成）');
        add(reviewSection,'p',`复核事件：${record.id}`,'detail-line');
        add(reviewSection,'p',`目标对象：${labels[record.target_kind]} · ${record.target_ref}`,'detail-line');
        add(reviewSection,'p',`复核结果：${labels[record.decision]}`,'detail-line');
        const reviewer=state.data.nodes.find(n=>n.id===record.actor_ref);
        add(reviewSection,'p',`模拟复核人：${reviewer?reviewer.label.replace(/\n/g,' / '):'未知'}`,'detail-line');
        add(reviewSection,'p',`记录时间：${new Date(record.occurred_at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}（北京时间）`,'detail-line');
        add(reviewSection,'p',record.notes,'detail-line');
        add(reviewSection,'p','这是合成测试记录，不代表真实人员已经签署或审核。','info-tip');
      }
    }
    if(item.provenance.notes)add(host,'p',item.provenance.notes,'info-tip');
    add(host,'div','此处展示的是合成证据及演示状态，不存在真实人工签署或模型审查结果。','info-tip');
  }
  function resetPositions(){
    if(!state.cy||!state.data)return;
    for(const n of state.data.nodes){
      const ele=state.cy.getElementById(n.id);
      if(ele.nonempty()&&n.position)ele.position(n.position);
    }
    state.cy.fit(state.cy.elements(':visible'),45);
  }
  function attachControls(){
    document.querySelectorAll('[data-node-type]').forEach(el=>el.addEventListener('change',applyFilters));
    ['edge-direct','edge-inference'].forEach(id=>$(id).addEventListener('change',applyFilters));
    $('search-nodes').addEventListener('input',applyFilters);
    $('btn-zoom-in').addEventListener('click',()=>{if(state.cy)state.cy.zoom(Math.min(state.cy.maxZoom(),state.cy.zoom()*1.25));});
    $('btn-zoom-out').addEventListener('click',()=>{if(state.cy)state.cy.zoom(Math.max(state.cy.minZoom(),state.cy.zoom()/1.25));});
    $('btn-fit').addEventListener('click',()=>{if(state.cy)state.cy.fit(state.cy.elements(':visible'),44);});
    $('btn-reset-layout').addEventListener('click',resetPositions);
    // Keep all synthetic nodes in view when an assessor resizes the desktop browser.
    window.addEventListener('resize',()=>{if(state.cy){state.cy.resize();state.cy.fit(state.cy.elements(':visible'),44);}});
    // Page scroll changes canvas screen coordinates. Refresh Cytoscape hit-testing cache so mouse taps select the correct node.
    window.addEventListener('scroll',()=>{if(state.cy)state.cy.resize();},{passive:true});
    $('btn-load-demo').addEventListener('click',()=>{document.querySelectorAll('[data-node-type]').forEach(el=>el.checked=true);$('edge-direct').checked=true;$('edge-inference').checked=true;$('search-nodes').value='';if(window.ConstellationIntegration)window.ConstellationIntegration.restoreDemo();else loadData(window.SYNTHETIC_FIXTURE);});
  }
  attachControls();
  // Allow independent automated UI tests to emit synthetic selection events; no mutation of backend or real data.
  window.__constellationApp={get cy(){return state.cy;},get data(){return state.data;},loadData,inspectItem,applyFilters,rejectData:failed};
  if(window.B_STAGE_MODE){clearInspector();$('graph-empty').hidden=false;setBanner('正在验证完全合成的约定报告输入…');}
  else loadData(window.SYNTHETIC_FIXTURE);
})();
