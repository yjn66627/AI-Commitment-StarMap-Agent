/* Stage A independent GraphContract validator. New demonstration code, not V2.0 code.
   Browser: window.GraphValidation; Node: module.exports. No dependencies. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.GraphValidation = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MAX_JSON_BYTES = 250000;
  const RELATIONS = Object.freeze({
    assigned_to: ['person', 'commitment'],
    evidenced_by: ['commitment', 'evidence'],
    due_on: ['commitment', 'deadline'],
    may_expose_to: ['commitment', 'risk'],
    reviewed_by: ['review', 'commitment']
  });
  const PRIVATE_PATTERN = /(?:<\s*\/?\s*(?:script|iframe|img|svg|object|style|form)\b|onerror\s*=|javascript\s*:|-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY|\b(?:sk-proj|sk-test|sk-live)-[a-z0-9_-]{8,}|\b(?:api[_ -]?key|password|passwd|access[_ -]?token|vault[_ -]?secret)\s*[:=]|\b\d{17}[0-9Xx]\b|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b)/i;

  function kind(v) {
    if (v === null) return 'null';
    if (Array.isArray(v)) return 'array';
    if (Number.isInteger(v)) return 'integer';
    return typeof v;
  }
  function typeMatches(v, type) {
    const actual = kind(v);
    return actual === type || (type === 'number' && actual === 'integer');
  }
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function refResolve(rootSchema, ref) {
    if (!ref.startsWith('#/')) return null;
    let item = rootSchema;
    for (const seg of ref.slice(2).split('/')) {
      const key = seg.replace(/~1/g, '/').replace(/~0/g, '~');
      if (item === null || typeof item !== 'object' || !Object.prototype.hasOwnProperty.call(item, key)) return null;
      item = item[key];
    }
    return item;
  }
  function checkAt(value, schema, rootSchema, path, errors, depth) {
    if (depth > 40 || !schema || typeof schema !== 'object') { errors.push({code:'SCHEMA_ERROR',path,rule:'invalid_schema'}); return; }
    if (schema.$ref) {
      const resolved = refResolve(rootSchema, schema.$ref);
      if (!resolved) { errors.push({code:'SCHEMA_ERROR',path,rule:'invalid_ref'}); return; }
      checkAt(value,resolved,rootSchema,path,errors,depth+1);
    }
    if (schema.type) {
      const types=Array.isArray(schema.type)?schema.type:[schema.type];
      if (!types.some(t=>typeMatches(value,t))) {errors.push({code:'SCHEMA_ERROR',path,rule:'type'});return;}
    }
    if (schema.const !== undefined && !same(value,schema.const)) errors.push({code:'SCHEMA_ERROR',path,rule:'const'});
    if (schema.enum && !schema.enum.some(x=>same(value,x))) errors.push({code:'SCHEMA_ERROR',path,rule:'enum'});
    if (typeof value === 'string') {
      if (schema.minLength!==undefined && [...value].length<schema.minLength) errors.push({code:'SCHEMA_ERROR',path,rule:'minLength'});
      if (schema.maxLength!==undefined && [...value].length>schema.maxLength) errors.push({code:'SCHEMA_ERROR',path,rule:'maxLength'});
      if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push({code:'SCHEMA_ERROR',path,rule:'pattern'});
      if (schema.format==='date-time' && !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value)) errors.push({code:'SCHEMA_ERROR',path,rule:'date-time'});
    }
    if (typeof value === 'number') {
      if (schema.minimum!==undefined && value<schema.minimum) errors.push({code:'SCHEMA_ERROR',path,rule:'minimum'});
      if (schema.maximum!==undefined && value>schema.maximum) errors.push({code:'SCHEMA_ERROR',path,rule:'maximum'});
      if (!Number.isFinite(value)) errors.push({code:'SCHEMA_ERROR',path,rule:'finite'});
    }
    if (Array.isArray(value)) {
      if (schema.minItems!==undefined && value.length<schema.minItems) errors.push({code:'SCHEMA_ERROR',path,rule:'minItems'});
      if (schema.maxItems!==undefined && value.length>schema.maxItems) errors.push({code:'SCHEMA_ERROR',path,rule:'maxItems'});
      if (schema.uniqueItems && new Set(value.map(x=>JSON.stringify(x))).size!==value.length) errors.push({code:'SCHEMA_ERROR',path,rule:'uniqueItems'});
      if (schema.items) value.forEach((v,i)=>checkAt(v,schema.items,rootSchema,`${path}[${i}]`,errors,depth+1));
    }
    if (value && typeof value==='object' && !Array.isArray(value)) {
      if (schema.maxProperties!==undefined && Object.keys(value).length>schema.maxProperties) errors.push({code:'SCHEMA_ERROR',path,rule:'maxProperties'});
      for(const key of schema.required||[]) if(!Object.prototype.hasOwnProperty.call(value,key)) errors.push({code:'SCHEMA_ERROR',path:`${path}.${key}`,rule:'required'});
      for (const [key,v] of Object.entries(value)) {
        if(schema.properties && Object.prototype.hasOwnProperty.call(schema.properties,key)) checkAt(v,schema.properties[key],rootSchema,`${path}.${key}`,errors,depth+1);
        else if(schema.additionalProperties===false) errors.push({code:'SCHEMA_ERROR',path:`${path}.${key}`,rule:'additionalProperties'});
        else if(schema.additionalProperties && typeof schema.additionalProperties==='object') checkAt(v,schema.additionalProperties,rootSchema,`${path}.${key}`,errors,depth+1);
      }
    }
    if(schema.allOf) for (const s of schema.allOf) checkAt(value,s,rootSchema,path,errors,depth+1);
    if(schema.if) {
      const scratch=[];
      checkAt(value,schema.if,rootSchema,path,scratch,depth+1);
      if(scratch.length===0 && schema.then) checkAt(value,schema.then,rootSchema,path,errors,depth+1);
      if(scratch.length!==0 && schema.else) checkAt(value,schema.else,rootSchema,path,errors,depth+1);
    }
  }
  function schemaValidate(data, schema) {
    const errors=[];
    if(!schema || schema.$schema!=='https://json-schema.org/draft/2020-12/schema') return [{code:'SCHEMA_ERROR',path:'$',rule:'schema_not_loaded'}];
    checkAt(data,schema,schema,'$',errors,0);
    return errors;
  }
  function redactError(code,path,rule){return {code,path,rule};}
  function crossRefValidate(data) {
    const errors=[], warnings=[];
    const ids=new Map();
    const sets=[['sources','source'],['evidence','evidence'],['nodes','node'],['edges','edge'],['review_events','review']];
    for(const [key,group] of sets){
      for(const [idx,item] of (data[key]||[]).entries()){
        if(ids.has(item.id)) errors.push(redactError('DUPLICATE_ID',`${key}[${idx}].id`,'global_id_collision'));
        else ids.set(item.id,group);
      }
    }
    const sources = new Map(data.sources.map(s=>[s.id,s]));
    const evidence = new Map(data.evidence.map(e=>[e.id,e]));
    const nodes = new Map(data.nodes.map(n=>[n.id,n]));
    const reviews = new Map((data.review_events||[]).map(r=>[r.id,r]));
    const reviewUsage = new Map();
    const targetUsage = new Map();
    function complain(code,path,rule){errors.push(redactError(code,path,rule));}
    if(data.data_class!=='fully_synthetic_demo') complain('PRIVACY_BLOCK','$','synthetic_only');
    data.sources.forEach((s,i)=>{
      if(s.access_state!=='synthetic' || !s.origin_kind.startsWith('synthetic_')) complain('PRIVACY_BLOCK',`sources[${i}]`,'non_synthetic_source');
    });
    data.evidence.forEach((e,i)=>{
      const path=`evidence[${i}]`;
      if(!sources.has(e.source_ref)) complain('MISSING_SOURCE',`${path}.source_ref`,'not_found');
      if(e.privacy_state!=='synthetic') complain('PRIVACY_BLOCK',path,'non_synthetic_evidence');
      if(e.traceability!=='located' || e.locator.locator_quality!=='exact' || (!e.locator.section && e.locator.paragraph_index===undefined && e.locator.line_start===undefined)) complain('MISSING_EVIDENCE',path,'unlocatable');
      if(typeof e.excerpt!=='string' || e.excerpt.trim().length===0) complain('MISSING_EVIDENCE',`${path}.excerpt`,'empty_excerpt');
      if(e.locator.line_start!==undefined && e.locator.line_end!==undefined && e.locator.line_start>e.locator.line_end) complain('SCHEMA_ERROR',`${path}.locator`,'reversed_lines');
      if(e.locator.char_start!==undefined && e.locator.char_end!==undefined && e.locator.char_start>e.locator.char_end) complain('SCHEMA_ERROR',`${path}.locator`,'reversed_chars');
    });
    function inspectStatus(item,path,targetKind){
      const st=item.status, pr=item.provenance;
      if (st.review_status==='confirmed' || st.review_status==='rejected') {
        const ev=reviews.get(st.review_event_ref);
        if(!ev || !nodes.has(ev.actor_ref) || nodes.get(ev.actor_ref).type!=='person' ||
           ev.decision !== (st.review_status==='confirmed'?'confirm':'reject') || !ev.notes || !ev.notes.trim()) complain('UNVERIFIED_REVIEW',`${path}.status.review_event_ref`,'missing_matching_review_event');
        // A valid reviewer and matching decision are insufficient: bind to this exact object.
        if(ev && (ev.target_kind!==targetKind || ev.target_ref!==item.id))
          complain('REVIEW_TARGET_MISMATCH',`${path}.status.review_event_ref`,'review_event_belongs_to_different_object');
        if(ev){
          const identity=`${targetKind}:${item.id}`;
          if(reviewUsage.has(ev.id) && reviewUsage.get(ev.id)!==identity)
            complain('REVIEW_EVENT_REUSE',`${path}.status.review_event_ref`,'review_event_reused_across_objects');
          else reviewUsage.set(ev.id,identity);
        }
      } else if(st.review_event_ref) complain('UNVERIFIED_REVIEW',`${path}.status.review_event_ref`,'premature_review_link');
      if(st.review_status==='rejected' && st.render_policy!=='withhold') complain('RENDER_POLICY',path,'rejected_must_withhold');
      if(st.assertion_kind==='unknown') {
        if(st.render_policy==='show') complain('RENDER_POLICY',path,'unknown_must_withhold');
        if(pr.source_refs.length || pr.evidence_refs.length || pr.derivation_method!=='unresolved') complain('PROVENANCE_ERROR',path,'unknown_cannot_claim_evidence');
      } else {
        if(st.render_policy==='placeholder_only') complain('RENDER_POLICY',path,'non_unknown_placeholder');
        if(pr.evidence_refs.length===0 || pr.source_refs.length===0) complain('MISSING_EVIDENCE',path,'provenance_required');
        if(st.assertion_kind==='source_direct' && pr.derivation_method!=='quoted_source') complain('PROVENANCE_ERROR',path,'direct_method');
        if(st.assertion_kind==='ai_inference') {
          if(pr.derivation_method!=='ai_inference') complain('PROVENANCE_ERROR',path,'inference_method');
          if(!['pending','not_reviewed','confirmed','rejected'].includes(st.review_status)) complain('UNVERIFIED_REVIEW',path,'inference_review_required');
        }
      }
      const evidencedSources=new Set();
      for(const [i,id] of pr.evidence_refs.entries()) {
        const e=evidence.get(id);
        if(!e) complain('MISSING_EVIDENCE',`${path}.provenance.evidence_refs[${i}]`,'not_found');
        else evidencedSources.add(e.source_ref);
      }
      for(const [i,id] of pr.source_refs.entries()) if(!sources.has(id)) complain('MISSING_SOURCE',`${path}.provenance.source_refs[${i}]`,'not_found');
      for(const sourceId of evidencedSources) if(!pr.source_refs.includes(sourceId)) complain('PROVENANCE_ERROR',path,'evidence_source_not_cited');
      for(const sourceId of pr.source_refs) if(!evidencedSources.has(sourceId)) complain('PROVENANCE_ERROR',path,'source_without_matching_evidence');
      if(st.review_status==='pending') warnings.push({code:'REVIEW_PENDING',path});
    }
    data.nodes.forEach((node,i)=>{
      const path=`nodes[${i}]`;
      if(node.sensitivity!=='synthetic') complain('PRIVACY_BLOCK',path,'non_synthetic_node');
      inspectStatus(node,path,'node');
      if(node.type==='evidence') {
        const ref=node.attributes && node.attributes.evidence_id;
        if(typeof ref!=='string' || !evidence.has(ref) || !node.provenance.evidence_refs.includes(ref)) complain('MISSING_EVIDENCE',`${path}.attributes.evidence_id`,'evidence_node_binding');
      }
      if(node.status.assertion_kind==='unknown' && node.status.render_policy==='placeholder_only') warnings.push({code:'UNKNOWN_VALUE',path});
    });
    data.edges.forEach((edge,i)=>{
      const path=`edges[${i}]`;
      inspectStatus(edge,path,'edge');
      const from=nodes.get(edge.from),to=nodes.get(edge.to);
      if(!from || !to) {complain('DANGLING_REF',path,'missing_endpoint');return;}
      if(edge.relation==='unknown'){
        if(edge.status.assertion_kind!=='unknown' || edge.status.render_policy!=='withhold') complain('RENDER_POLICY',path,'unknown_edge_visible');
        return;
      }
      const pair=RELATIONS[edge.relation];
      if(!pair || from.type!==pair[0] || to.type!==pair[1]) complain('UNSUPPORTED_RELATION',path,'invalid_endpoint_type_or_relation');
      if(['assigned_to','evidenced_by','due_on'].includes(edge.relation) && edge.status.assertion_kind!=='source_direct') complain('PROVENANCE_ERROR',path,'direct_relation_cannot_be_inferred');
      if(edge.relation==='may_expose_to' && (edge.status.assertion_kind!=='ai_inference' || edge.status.review_status!=='pending')) complain('PROVENANCE_ERROR',path,'risk_must_be_pending_inference');
      if(from.status.render_policy==='withhold' || to.status.render_policy==='withhold') complain('RENDER_POLICY',path,'hidden_endpoint');
      if(edge.relation==='evidenced_by' && (!to.attributes || !edge.provenance.evidence_refs.includes(to.attributes.evidence_id))) complain('PROVENANCE_ERROR',path,'evidenced_by_binding_mismatch');
      if(edge.status.assertion_kind==='source_direct' && (!edge.provenance.evidence_refs.some(id=>from.provenance.evidence_refs.includes(id)) || !edge.provenance.evidence_refs.some(id=>to.provenance.evidence_refs.includes(id)))) complain('PROVENANCE_ERROR',path,'relation_not_supported_by_endpoints');
      if(edge.status.assertion_kind==='ai_inference' && !edge.provenance.evidence_refs.some(id=>to.provenance.evidence_refs.includes(id))) complain('PROVENANCE_ERROR',path,'inference_not_supported_by_target');
    });
    for(const [i,r] of (data.review_events||[]).entries()) {
      const path=`review_events[${i}]`;
      if(!nodes.has(r.actor_ref) || nodes.get(r.actor_ref).type!=='person') complain('UNVERIFIED_REVIEW',`${path}.actor_ref`,'review_actor_missing');
      if(!r.notes || !r.notes.trim()) complain('UNVERIFIED_REVIEW',`${path}.notes`,'review_note_missing');
      const target=r.target_kind==='node'?nodes.get(r.target_ref):r.target_kind==='edge'?data.edges.find(e=>e.id===r.target_ref):null;
      if(!target) { complain('REVIEW_TARGET_NOT_FOUND',`${path}.target_ref`,'target_id_not_found_in_declared_kind');continue; }
      const key=`${r.target_kind}:${r.target_ref}`;
      if(targetUsage.has(key) && targetUsage.get(key)!==r.id)
        complain('REVIEW_DUPLICATE_TARGET',`${path}.target_ref`,'several_review_events_claim_same_object');
      else targetUsage.set(key,r.id);
      if(target.status.review_event_ref!==r.id ||
         target.status.review_status!==(r.decision==='confirm'?'confirmed':'rejected'))
        complain('REVIEW_STATUS_MISMATCH',`${path}.target_ref`,'target_status_does_not_bind_back_to_event');
      if(!reviewUsage.has(r.id) || reviewUsage.get(r.id)!==key)
        complain('REVIEW_ORPHAN',path,'event_not_consumed_by_its_exact_target');
    }
    function inspectText(v,path,depth){
      if(depth>15)return;
      if(typeof v==='string' && PRIVATE_PATTERN.test(v)) complain('UNSAFE_TEXT',path,'privacy_or_markup_pattern');
      else if(Array.isArray(v)) v.forEach((item,i)=>inspectText(item,`${path}[${i}]`,depth+1));
      else if(v && typeof v==='object') for(const [key,item] of Object.entries(v)) inspectText(item,`${path}.${key}`,depth+1);
    }
    inspectText(data,'$',0);
    return {errors,warnings};
  }
  function validateGraph(data,schema){
    const errors=[];
    let bytes=0;
    try {bytes=JSON.stringify(data).length;} catch (_) {return {ok:false,errors:[{code:'SCHEMA_ERROR',path:'$',rule:'non_serializable'}],warnings:[],renderable:null};}
    if(bytes>MAX_JSON_BYTES) return {ok:false,errors:[{code:'SCHEMA_ERROR',path:'$',rule:'too_large'}],warnings:[],renderable:null};
    errors.push(...schemaValidate(data,schema));
    if(errors.length) return {ok:false,errors,warnings:[],renderable:null};
    const checked=crossRefValidate(data);
    errors.push(...checked.errors);
    if(errors.length) return {ok:false,errors,warnings:checked.warnings,renderable:null};
    const visibleNodes=data.nodes.filter(n=>n.status.render_policy==='show' || n.status.render_policy==='placeholder_only');
    const ids=new Set(visibleNodes.map(n=>n.id));
    const visibleEdges=data.edges.filter(e=>e.status.render_policy==='show' && ids.has(e.from) && ids.has(e.to));
    return {ok:true,errors:[],warnings:checked.warnings,renderable:{nodes:visibleNodes,edges:visibleEdges,withheld:data.edges.length-visibleEdges.length}};
  }
  return {validateGraph,schemaValidate,crossRefValidate,RELATIONS,MAX_JSON_BYTES};
});
