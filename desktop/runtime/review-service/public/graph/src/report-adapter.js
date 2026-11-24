/* Stage B: explicit, synthetic-only normalized report -> GraphContract proposal-0.2.
 * NOT a V2.0 report adapter until its real interface has been independently verified.
 * Browser: window.ReportGraphAdapter; Node: module.exports. Zero dependencies.
 */
(function (root, factory) {
  const validation = typeof module !== 'undefined' && module.exports
    ? require('./validator.js') : root.GraphValidation;
  const api = factory(validation);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ReportGraphAdapter = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (GraphValidation) {
  'use strict';
  const INPUT_VERSION='competition-report-proposal-0.1';
  const GRAPH_VERSION='proposal-0.2';
  const MAX_BYTES=250000;
  const sourceKind = Object.freeze({meeting:'synthetic_meeting',email:'synthetic_email',other:'synthetic_other'});
  const assertionKind = Object.freeze({direct:'source_direct',inference:'ai_inference',unknown:'unknown'});
  const reviewState = Object.freeze({unreviewed:'not_reviewed',not_required:'not_required',pending:'pending',confirmed:'confirmed',rejected:'rejected'});
  const entitySections = Object.freeze({people:'person',commitments:'commitment',deadlines:'deadline',risks:'risk'});
  function error(code,path,rule){return {code,path,rule};}
  function reject(code,path,rule,phase){return {ok:false,phase:phase||'REPORT_INPUT',errors:[error(code,path,rule)],graph:null,validation:null};}
  function adaptReport(report,inputSchema,graphSchema) {
    if (!GraphValidation || typeof GraphValidation.validateGraph!=='function' || typeof GraphValidation.schemaValidate!=='function')
      return reject('ADAPTER_CONFIG','$','validator_unavailable','CONFIG');
    if (!inputSchema || !graphSchema) return reject('ADAPTER_CONFIG','$','schema_missing','CONFIG');
    let json;
    try { json=JSON.stringify(report); } catch(_){return reject('REPORT_SCHEMA','$','not_serializable');}
    if(typeof json!=='string' || (typeof TextEncoder==='function'?new TextEncoder().encode(json).length:json.length)>MAX_BYTES)
      return reject('REPORT_SCHEMA','$','size_limit');
    // Reject partial/mismatched source before construction. NEVER guess unknown V2.0 fields.
    const shape=GraphValidation.schemaValidate(report,inputSchema);
    if(shape.length) return {ok:false,phase:'REPORT_SCHEMA',errors:shape.map(e=>error('REPORT_SCHEMA',e.path,e.rule)),graph:null,validation:null};
    if(report.report_version!==INPUT_VERSION || report.data_class!=='fully_synthetic_demo')
      return reject('REPORT_SCHEMA','$','version_or_data_class');

    const errors=[];
    const allKeys=new Map();
    function ownKey(key,kind,path){
      if(allKeys.has(key)) errors.push(error('DUPLICATE_ID',path,'key_conflicts_with_'+allKeys.get(key)));
      else allKeys.set(key,kind);
    }
    for(const [i,s] of report.source_documents.entries()) ownKey(s.key,'source',`source_documents[${i}].key`);
    for(const [i,e] of report.evidence_records.entries()) ownKey(e.key,'evidence',`evidence_records[${i}].key`);
    for(const [section] of Object.entries(entitySections))
      report[section].forEach((e,i)=>ownKey(e.key,section,`${section}[${i}].key`));
    report.relationships.forEach((e,i)=>ownKey(e.key,'relationship',`relationships[${i}].key`));
    report.reviews.forEach((r,i)=>ownKey(r.key,'review',`reviews[${i}].key`));
    if(errors.length)return {ok:false,phase:'REPORT_REF',errors,graph:null,validation:null};

    const docByKey=new Map(report.source_documents.map(x=>[x.key,x]));
    const evidenceByKey=new Map(report.evidence_records.map(x=>[x.key,x]));
    const entityByKey=new Map();
    for(const [section,type] of Object.entries(entitySections))
      for(const n of report[section]) entityByKey.set(n.key,type);
    // Evidence nodes are materialized deterministically, no new provenance fabricated.
    for(const ev of report.evidence_records){
      const derivedId='N_'+ev.key;
      if(allKeys.has(derivedId)) errors.push(error('DUPLICATE_ID',`evidence_records[${ev.key}]`,'derived_node_id_collision'));
      else {allKeys.set(derivedId,'materialized_evidence_node');entityByKey.set(derivedId,'evidence');}
    }
    for(const [i,ev] of report.evidence_records.entries()) {
      if(!docByKey.has(ev.document_key)) errors.push(error('MISSING_SOURCE',`evidence_records[${i}].document_key`,'unknown_document'));
    }
    function checkCitations(keys,path,assertion){
      if(assertion!=='unknown' && keys.length===0) errors.push(error('MISSING_EVIDENCE',path,'non_unknown_requires_evidence'));
      if(assertion==='unknown' && keys.length!==0) errors.push(error('PROVENANCE_ERROR',path,'unknown_must_not_claim_evidence'));
      keys.forEach((key,i)=>{if(!evidenceByKey.has(key))errors.push(error('MISSING_EVIDENCE',`${path}[${i}]`,'unknown_evidence'));});
    }
    for(const section of Object.keys(entitySections))
      report[section].forEach((n,i)=>checkCitations(n.evidence_keys,`${section}[${i}].evidence_keys`,n.assessment.assertion));
    report.relationships.forEach((r,i)=>{
      if(!entityByKey.has(r.subject_key))errors.push(error('DANGLING_REF',`relationships[${i}].subject_key`,'unknown_subject'));
      if(!entityByKey.has(r.object_key))errors.push(error('DANGLING_REF',`relationships[${i}].object_key`,'unknown_object'));
      checkCitations(r.evidence_keys,`relationships[${i}].evidence_keys`,r.assessment.assertion);
    });
    report.reviews.forEach((r,i)=>{
      if(entityByKey.get(r.reviewer_key)!=='person')errors.push(error('UNVERIFIED_REVIEW',`reviews[${i}].reviewer_key`,'reviewer_must_be_person'));
      if(r.target.kind==='node' && !entityByKey.has(r.target.key)) errors.push(error('REVIEW_TARGET_NOT_FOUND',`reviews[${i}].target.key`,'missing_node'));
      if(r.target.kind==='relation' && !report.relationships.some(x=>x.key===r.target.key))errors.push(error('REVIEW_TARGET_NOT_FOUND',`reviews[${i}].target.key`,'missing_relation'));
    });
    report.notices.forEach((n,i)=>{if(n.related_key && !allKeys.has(n.related_key)) errors.push(error('DANGLING_REF',`notices[${i}].related_key`,'related_object_missing'));});
    if(errors.length)return {ok:false,phase:'REPORT_REF',errors,graph:null,validation:null};

    function provenance(keys,assertion){
      if(assertion==='unknown')return {source_refs:[],evidence_refs:[],derivation_method:'unresolved'};
      return {source_refs:[...new Set(keys.map(k=>evidenceByKey.get(k).document_key))],evidence_refs:[...keys],
        derivation_method:assertion==='direct'?'quoted_source':'ai_inference'};
    }
    function status(a,isEdge){
      const result={assertion_kind:assertionKind[a.assertion],review_status:reviewState[a.review_state],
        render_policy:a.review_state==='rejected'||(isEdge&&a.assertion==='unknown')?'withhold':a.assertion==='unknown'?'placeholder_only':'show'};
      if(a.review_key)result.review_event_ref=a.review_key;
      if(a.unknown_reason)result.unknown_reason=a.unknown_reason;
      return result;
    }
    const sources=report.source_documents.map(s=>({id:s.key,origin_kind:sourceKind[s.channel],display_name:s.title,access_state:'synthetic'}));
    const evidence=report.evidence_records.map(e=>({id:e.key,source_ref:e.document_key,locator:{...e.location},excerpt:e.quotation,privacy_state:'synthetic',traceability:'located'}));
    const nodes=[];
    for(const [section,type] of Object.entries(entitySections)) {
      for(const n of report[section]){
        const item={id:n.key,type,label:n.title,status:status(n.assessment,false),provenance:provenance(n.evidence_keys,n.assessment.assertion),sensitivity:'synthetic'};
        if(n.position)item.position={x:n.position.x,y:n.position.y};
        nodes.push(item);
      }
    }
    for(const e of report.evidence_records){
      const node={id:'N_'+e.key,type:'evidence',label:'证据 · '+e.key,
        status:{assertion_kind:'source_direct',review_status:'not_reviewed',render_policy:'show'},
        provenance:provenance([e.key],'direct'),sensitivity:'synthetic',attributes:{evidence_id:e.key}};
      if(e.position)node.position={x:e.position.x,y:e.position.y};
      nodes.push(node);
    }
    const edges=report.relationships.map(r=>({id:r.key,from:r.subject_key,to:r.object_key,relation:r.kind,
      status:status(r.assessment,true),provenance:provenance(r.evidence_keys,r.assessment.assertion)}));
    const review_events=report.reviews.map(r=>({id:r.key,decision:r.decision,actor_ref:r.reviewer_key,
      occurred_at:r.recorded_at,notes:r.remark,target_kind:r.target.kind==='relation'?'edge':'node',target_ref:r.target.key}));
    const warnings=report.notices.map(n=>({code:n.code,severity:n.severity,message:n.message,
      ...(n.related_key?{related_ref:n.related_key}:{})}));
    const graph={schema_version:GRAPH_VERSION,data_class:'fully_synthetic_demo',case_id:report.project_key,
      sources,evidence,nodes,edges,warnings,review_events,presentation:{layout_hint:'preset',title:report.project_title,fixture_banner:true}};
    // A-R's unchanged schema+CrossRefValidator is the final fail-closed gate.
    const validation=GraphValidation.validateGraph(graph,graphSchema);
    if(!validation.ok)return {ok:false,phase:'GRAPH_VALIDATION',errors:validation.errors,graph:null,validation:null};
    return {ok:true,phase:'READY',errors:[],graph,validation};
  }
  return {adaptReport,INPUT_VERSION,GRAPH_VERSION,MAX_BYTES};
});
