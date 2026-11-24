/* Standalone offline tests, no npm packages required. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root=path.join(__dirname,'..');
const {validateGraph,schemaValidate,crossRefValidate}=require('../src/validator.js');
const schema=JSON.parse(fs.readFileSync(path.join(root,'src/graph-contract.schema.json'),'utf8'));
const valid=JSON.parse(fs.readFileSync(path.join(root,'fixtures/synthetic-valid.json'),'utf8'));
const clone=()=>JSON.parse(JSON.stringify(valid));
const results=[];
function run(id,fn){
  try{fn();results.push({id,status:'PASS'});console.log('PASS',id);}catch(e){results.push({id,status:'FAIL',message:e.message});console.error('FAIL',id,e.message);}
}
run('T01 schema_and_valid_graph',()=>{assert.equal(schemaValidate(valid,schema).length,0);const r=validateGraph(valid,schema);assert(r.ok,JSON.stringify(r.errors));assert.equal(r.renderable.nodes.length,10);assert.equal(r.renderable.edges.length,7);});
run('T02 evidence_source_reference',()=>{const d=clone();d.evidence[0].source_ref='WRONG';assert(validateGraph(d,schema).errors.some(e=>e.code==='MISSING_SOURCE'));});
run('T03 missing_edge_node',()=>{const d=clone();d.edges[0].to='FAKE';assert(validateGraph(d,schema).errors.some(e=>e.code==='DANGLING_REF'));});
run('T04 duplicate_global_id',()=>{const d=clone();d.nodes[0].id='SRC_MEET';assert(validateGraph(d,schema).errors.some(e=>e.code==='DUPLICATE_ID'));});
run('T05 invalid_relation_types',()=>{const d=clone();d.edges[0].from='D_A';assert(validateGraph(d,schema).errors.some(e=>e.code==='UNSUPPORTED_RELATION'));});
run('T06 no_proof_direct_relation',()=>{const d=clone();d.edges[0].provenance.evidence_refs=[];assert(!validateGraph(d,schema).ok);});
run('T07 inference_not_upgraded_to_fact',()=>{const d=clone();d.edges[4].status.assertion_kind='source_direct';assert(!validateGraph(d,schema).ok);});
run('T08 missing_review_event',()=>{const d=clone();d.nodes[0].status.review_status='confirmed';d.nodes[0].status.review_event_ref='MISSING';assert(validateGraph(d,schema).errors.some(e=>e.code==='UNVERIFIED_REVIEW'));});
run('T09 privacy_field_and_markup',()=>{for(const name of ['private-text','unsafe-markup','non-synthetic']){const d=JSON.parse(fs.readFileSync(path.join(root,`fixtures/invalid-${name}.json`)));assert(!validateGraph(d,schema).ok);}});
run('T10 unknown_relation_withheld',()=>{const r=validateGraph(valid,schema);assert(r.ok);assert.equal(r.renderable.withheld,1);assert(!r.renderable.edges.some(e=>e.relation==='unknown'));});
run('T11 rejected_relation_withheld_even_if_reviewed',()=>{const d=clone();d.review_events.push({id:'REV_FAKE_SYNTH',decision:'reject',actor_ref:'P_A',occurred_at:'2026-11-08T10:00:00Z',notes:'纯合成复核记录：该边予以驳回。',target_kind:'edge',target_ref:'REL_ASSIGN_A'});d.edges[0].status={assertion_kind:'source_direct',review_status:'rejected',render_policy:'withhold',review_event_ref:'REV_FAKE_SYNTH'};const r=validateGraph(d,schema);assert(r.ok,JSON.stringify(r.errors));assert(!r.renderable.edges.some(e=>e.id==='REL_ASSIGN_A'));});
run('T12 correct_synthetic_review_event',()=>{const d=clone();d.review_events.push({id:'REV_APPROVED_SYNTH',decision:'confirm',actor_ref:'P_A',occurred_at:'2026-11-08T10:00:00Z',notes:'合成复核记录，仅用于验证流程。',target_kind:'node',target_ref:'P_B'});d.nodes[6].status={assertion_kind:'source_direct',review_status:'confirmed',render_policy:'show',review_event_ref:'REV_APPROVED_SYNTH'};const r=validateGraph(d,schema);assert(r.ok,JSON.stringify(r.errors));});
run('T13 prohibited_unsupported_relation',()=>{const d=clone();d.edges[0].relation='supports';assert(validateGraph(d,schema).errors.some(e=>e.code==='UNSUPPORTED_RELATION'));});
run('T14 evidence_binding_enforced',()=>{const d=clone();d.nodes[2].attributes.evidence_id='EV_EMAIL';assert(validateGraph(d,schema).errors.some(e=>e.code==='MISSING_EVIDENCE'));});
run('T15 untrusted_extra_fields',()=>{const d=clone();d.nodes[0].password='not-valid';assert(!validateGraph(d,schema).ok);});
run('T16 forged_source_provenance',()=>{const d=clone();d.edges[0].provenance={source_refs:['SRC_EMAIL'],evidence_refs:['EV_EMAIL'],derivation_method:'quoted_source'};assert(!validateGraph(d,schema).ok);});
run('T17 reversed_evidence_locator',()=>{const d=clone();d.evidence[0].locator.line_start=14;d.evidence[0].locator.line_end=3;assert(!validateGraph(d,schema).ok);});
run('T18 no_render_before_validating',()=>{const d=clone();d.edges[0].to='MISSING';const r=validateGraph(d,schema);assert.equal(r.renderable,null);});
run('T19 status_differentiation',()=>{const r=validateGraph(valid,schema);assert(r.ok);const risk=r.renderable.edges.find(e=>e.relation==='may_expose_to');assert.equal(risk.status.assertion_kind,'ai_inference');assert.equal(risk.status.review_status,'pending');assert.equal(r.renderable.nodes.find(n=>n.id==='R_A').status.assertion_kind,'ai_inference');});
run('T20 all_17_negative_fixtures_rejected',()=>{const files=fs.readdirSync(path.join(root,'fixtures')).filter(f=>f.startsWith('invalid-')&&f.endsWith('.json'));assert(files.length>=8);for(const f of files){const d=JSON.parse(fs.readFileSync(path.join(root,'fixtures',f)));const r=validateGraph(d,schema);assert(!r.ok,f+' unexpectedly accepted');}});
run('T21 payload_size_limit',()=>{const d=clone();d.warnings=Array.from({length:1000},(_,i)=>({code:'OTHER',severity:'warning',message:'X'.repeat(350),related_ref:'C_A'}));const r=validateGraph(d,schema);assert(!r.ok);assert(r.errors.some(e=>e.rule==='too_large'));});
run('T22 prohibited_remote_link',()=>{const d=clone();d.sources[0].external_url='https://example.org';assert(!validateGraph(d,schema).ok);});

// A-R additions. Original T01-T22 remain present, with T11/T12 fixture shape updated for required target reference.
run('T23_node_review_exact_binding',()=>{const r=validateGraph(valid,schema);assert(r.ok,JSON.stringify(r.errors));assert.equal(valid.nodes[1].status.review_event_ref,'REV_C_A');assert.equal(valid.review_events[0].target_kind,'node');assert.equal(valid.review_events[0].target_ref,'C_A');});
run('T24_edge_review_exact_binding',()=>{const d=JSON.parse(fs.readFileSync(path.join(root,'fixtures/synthetic-review-edge-valid.json'),'utf8'));const r=validateGraph(d,schema);assert(r.ok,JSON.stringify(r.errors));assert.equal(d.review_events[1].target_kind,'edge');assert.equal(d.review_events[1].target_ref,'REL_ASSIGN_A');});
run('T25_cross_object_reuse_two_nodes',()=>{const d=JSON.parse(fs.readFileSync(path.join(root,'fixtures/invalid-review-multiple-nodes.json'),'utf8'));assert(validateGraph(d,schema).errors.some(e=>e.code==='REVIEW_EVENT_REUSE'));});
run('T26_cross_object_reuse_node_and_edge',()=>{const d=JSON.parse(fs.readFileSync(path.join(root,'fixtures/invalid-review-cross-node-edge.json'),'utf8'));assert(validateGraph(d,schema).errors.some(e=>e.code==='REVIEW_EVENT_REUSE'));});
run('T27_mismatched_existing_target',()=>{const d=JSON.parse(fs.readFileSync(path.join(root,'fixtures/invalid-review-cross-node.json'),'utf8'));assert(validateGraph(d,schema).errors.some(e=>e.code==='REVIEW_TARGET_MISMATCH'));});
run('T28_wrong_target_kind',()=>{const d=JSON.parse(fs.readFileSync(path.join(root,'fixtures/invalid-review-wrong-kind.json'),'utf8'));const r=validateGraph(d,schema);assert(r.errors.some(e=>e.code==='REVIEW_TARGET_NOT_FOUND'));});
run('T29_target_does_not_exist',()=>{const d=JSON.parse(fs.readFileSync(path.join(root,'fixtures/invalid-review-target-not-found.json'),'utf8'));assert(validateGraph(d,schema).errors.some(e=>e.code==='REVIEW_TARGET_NOT_FOUND'));});
run('T30_review_decision_status_conflict',()=>{const d=JSON.parse(fs.readFileSync(path.join(root,'fixtures/invalid-review-wrong-decision.json'),'utf8'));const r=validateGraph(d,schema);assert(r.errors.some(e=>e.code==='REVIEW_STATUS_MISMATCH'));});
run('T31_duplicate_events_same_target',()=>{const d=JSON.parse(fs.readFileSync(path.join(root,'fixtures/invalid-review-duplicate-target.json'),'utf8'));assert(validateGraph(d,schema).errors.some(e=>e.code==='REVIEW_DUPLICATE_TARGET'));});
run('T32_orphan_event_and_pending_target',()=>{const d=JSON.parse(fs.readFileSync(path.join(root,'fixtures/invalid-review-orphan-pending.json'),'utf8'));const r=validateGraph(d,schema);assert(r.errors.some(e=>e.code==='REVIEW_ORPHAN'));});
run('T33_missing_target_field_schema',()=>{const d=JSON.parse(fs.readFileSync(path.join(root,'fixtures/invalid-review-missing-target-field.json'),'utf8'));assert(schemaValidate(d,schema).some(e=>e.rule==='required'&&e.path.endsWith('target_ref')));});
run('T34_status_event_both_directions',()=>{const d=JSON.parse(fs.readFileSync(path.join(root,'fixtures/invalid-review-mismatched-status.json'),'utf8'));assert(validateGraph(d,schema).errors.some(e=>e.code==='REVIEW_STATUS_MISMATCH'));});
run('T35_forged_source_as_review_target',()=>{const d=JSON.parse(fs.readFileSync(path.join(root,'fixtures/invalid-review-forged-target-id.json'),'utf8'));assert(validateGraph(d,schema).errors.some(e=>e.code==='REVIEW_TARGET_NOT_FOUND'));});
run('T36_review_event_id_collision',()=>{const d=JSON.parse(fs.readFileSync(path.join(root,'fixtures/invalid-review-duplicate-event-id.json'),'utf8'));assert(validateGraph(d,schema).errors.some(e=>e.code==='DUPLICATE_ID'));});
run('T37_all_30_negative_fixtures_rejected',()=>{const files=fs.readdirSync(path.join(root,'fixtures')).filter(f=>f.startsWith('invalid-')&&f.endsWith('.json'));assert(files.length>=30,String(files.length));for(const f of files){const d=JSON.parse(fs.readFileSync(path.join(root,'fixtures',f),'utf8'));const r=validateGraph(d,schema);assert(!r.ok,f+' unexpectedly accepted');}});

const failed=results.filter(x=>x.status!=='PASS');
if(process.env.WRITE_TEST_RESULTS){fs.writeFileSync(process.env.WRITE_TEST_RESULTS,JSON.stringify({environment:{node:process.version,arch:process.arch,platform:process.platform},count:results.length,passed:results.length-failed.length,failed:failed.length,tests:results},null,2)+'\n');}
console.log(JSON.stringify({tests:results.length,pass:results.length-failed.length,fail:failed.length}));
if(failed.length)process.exitCode=1;
