/* B-stage actual executable adapter tests. Original A-R suite remains untouched. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..');
const {adaptReport}=require('../src/report-adapter.js');
const {validateGraph}=require('../src/validator.js');
const schema=JSON.parse(fs.readFileSync(path.join(root,'src/report-input.schema.json'),'utf8'));
const graphSchema=JSON.parse(fs.readFileSync(path.join(root,'src/graph-contract.schema.json'),'utf8'));
const fixture=JSON.parse(fs.readFileSync(path.join(root,'fixtures/competition-synthetic-report.json'),'utf8'));
const clone=()=>JSON.parse(JSON.stringify(fixture));
const results=[];
function test(id,fn){try{fn();results.push({id,status:'PASS'});console.log('PASS',id)}catch(e){results.push({id,status:'FAIL',detail:e.message});console.error('FAIL',id,e.message)}}
function adapt(d){return adaptReport(d,schema,graphSchema)}
function reject(d,phase,code){const r=adapt(d);assert.equal(r.ok,false,'unexpected accepted');assert.equal(r.graph,null,'partial graph leaked');if(phase)assert.equal(r.phase,phase);if(code)assert(r.errors.some(e=>e.code===code),JSON.stringify(r.errors));return r;}
function canonicalIds(g){return {nodes:g.nodes.map(n=>n.id).sort(),edges:g.edges.map(e=>e.id).sort(),sources:g.sources.map(s=>s.id).sort(),evidence:g.evidence.map(e=>e.id).sort(),reviews:g.review_events.map(e=>e.id).sort()};}

test('R01_synthetic_report_to_graph_contract',()=>{const r=adapt(clone());assert(r.ok,JSON.stringify(r.errors));assert.equal(r.graph.schema_version,'proposal-0.2');assert.equal(r.graph.data_class,'fully_synthetic_demo');assert.equal(r.graph.nodes.length,10);assert.equal(r.graph.edges.length,8);assert.equal(r.validation.renderable.edges.length,7)});
test('R02_five_business_node_types',()=>{const g=adapt(clone()).graph;assert.deepEqual([...new Set(g.nodes.map(n=>n.type))].sort(),['commitment','deadline','evidence','person','risk']);});
test('R03_evidence_source_location_and_exact_quote',()=>{const r=adapt(clone());assert(r.ok);const ev=r.graph.evidence.find(e=>e.id==='EV_MEET');assert.equal(ev.source_ref,'SRC_MEET');assert.equal(ev.locator.locator_quality,'exact');assert.match(ev.excerpt,/【纯合成】/);});
test('R04_missing_document_fails_closed',()=>{const d=clone();d.evidence_records[0].document_key='MISSING';reject(d,'REPORT_REF','MISSING_SOURCE');});
test('R05_missing_quote_fails_closed',()=>{const d=clone();delete d.evidence_records[0].quotation;reject(d,'REPORT_SCHEMA','REPORT_SCHEMA');});
test('R06_missing_evidence_citation_fails_closed',()=>{const d=clone();d.commitments[0].evidence_keys=[];reject(d,'REPORT_REF','MISSING_EVIDENCE');});
test('R07_unknown_evidence_reference_fails_closed',()=>{const d=clone();d.relationships[0].evidence_keys=['EV_MISSING'];reject(d,'REPORT_REF','MISSING_EVIDENCE');});
test('R08_missing_node_target_fails_closed',()=>{const d=clone();d.relationships[0].object_key='NOT_FOUND';reject(d,'REPORT_REF','DANGLING_REF');});
test('R09_duplicate_global_business_id',()=>{const d=clone();d.commitments[0].key=d.people[0].key;reject(d,'REPORT_REF','DUPLICATE_ID');});
test('R10_derived_evidence_node_collision',()=>{const d=clone();d.people[0].key='N_EV_MEET';reject(d,'REPORT_REF','DUPLICATE_ID');});
test('R11_repeated_adaptation_stable_identifiers',()=>{const a=adapt(clone()),b=adapt(clone());assert(a.ok&&b.ok);assert.deepEqual(canonicalIds(a.graph),canonicalIds(b.graph));assert.equal(JSON.stringify(a.graph),JSON.stringify(b.graph));});
test('R12_order_rearrangement_stable_ids',()=>{const a=adapt(clone());const d=clone();d.source_documents.reverse();d.evidence_records.reverse();d.commitments.reverse();d.relationships.reverse();const b=adapt(d);assert(b.ok,JSON.stringify(b.errors));assert.deepEqual(canonicalIds(a.graph),canonicalIds(b.graph));});
test('R13_inferred_risk_edge_never_becomes_direct_fact',()=>{const r=adapt(clone());assert(r.ok);const x=r.graph.edges.find(e=>e.kind==='may_expose_to'||e.relation==='may_expose_to');assert.equal(x.status.assertion_kind,'ai_inference');assert.equal(x.status.review_status,'pending');assert.equal(x.provenance.derivation_method,'ai_inference');});
test('R14_illegal_inference_assignment_rejected',()=>{const d=clone();d.relationships[0].assessment.assertion='inference';d.relationships[0].assessment.review_state='pending';reject(d,'GRAPH_VALIDATION','PROVENANCE_ERROR');});
test('R15_ai_risk_wrong_review_status_rejected',()=>{const d=clone();const x=d.relationships.find(x=>x.kind==='may_expose_to');x.assessment.review_state='unreviewed';reject(d,'GRAPH_VALIDATION','PROVENANCE_ERROR');});
test('R16_unknown_deadline_hidden_and_unknown_edge_not_rendered',()=>{const r=adapt(clone());assert(r.ok);assert(r.graph.nodes.find(n=>n.id==='D_UNKNOWN').status.assertion_kind==='unknown');assert(!r.validation.renderable.edges.some(e=>e.id==='REL_UNKNOWN_B'));});
test('R17_review_event_exact_node_binding',()=>{const r=adapt(clone());assert(r.ok);assert.equal(r.graph.review_events[0].target_kind,'node');assert.equal(r.graph.review_events[0].target_ref,'C_A');assert.equal(r.graph.nodes.find(n=>n.id==='C_A').status.review_event_ref,'REV_C_A');});
test('R18_review_event_cross_object_binding_rejected',()=>{const d=clone();d.reviews[0].target.key='C_B';reject(d,'GRAPH_VALIDATION','REVIEW_TARGET_MISMATCH');});
test('R19_review_node_relation_type_mismatch_rejected',()=>{const d=clone();d.reviews[0].target.kind='relation';reject(d,'REPORT_REF','REVIEW_TARGET_NOT_FOUND');});
test('R20_review_missing_target_rejected',()=>{const d=clone();d.reviews[0].target.key='NOT_EXISTS';reject(d,'REPORT_REF','REVIEW_TARGET_NOT_FOUND');});
test('R21_review_duplicate_target_rejected',()=>{const d=clone();d.reviews.push({...d.reviews[0],key:'REV_SECOND'});reject(d,'GRAPH_VALIDATION','REVIEW_DUPLICATE_TARGET');});
test('R22_review_status_mismatch_rejected',()=>{const d=clone();d.reviews[0].decision='reject';reject(d,'GRAPH_VALIDATION','UNVERIFIED_REVIEW');});
test('R23_review_actor_must_be_person',()=>{const d=clone();d.reviews[0].reviewer_key='R_A';reject(d,'REPORT_REF','UNVERIFIED_REVIEW');});
test('R24_bad_endpoint_type_rejected',()=>{const d=clone();d.relationships[0].subject_key='D_A';reject(d,'GRAPH_VALIDATION','UNSUPPORTED_RELATION');});
test('R25_reject_unknown_report_top_field',()=>{const d=clone();d.v2_database_table='made-up';reject(d,'REPORT_SCHEMA','REPORT_SCHEMA');});
test('R26_reject_unknown_business_field_no_guess',()=>{const d=clone();d.commitments[0].assigned_person='P_A';reject(d,'REPORT_SCHEMA','REPORT_SCHEMA');});
test('R27_reject_genuine_v2_format_attempt',()=>{const d={report_id:'real_report',summary:{}};reject(d,'REPORT_SCHEMA','REPORT_SCHEMA');});
test('R28_reject_unmasked_data_class',()=>{const d=clone();d.data_class='masked_case_export';reject(d,'REPORT_SCHEMA','REPORT_SCHEMA');});
test('R29_reject_script_in_quotation',()=>{const d=clone();d.evidence_records[0].quotation='<img src=x onerror=alert(1)>';reject(d,'GRAPH_VALIDATION','UNSAFE_TEXT');});
test('R30_reject_api_key_in_text',()=>{const d=clone();d.commitments[0].title='api_key=TOP_SECRET_VALUE';reject(d,'GRAPH_VALIDATION','UNSAFE_TEXT');});
test('R31_reject_unrecognized_relation_kind',()=>{const d=clone();d.relationships[0].kind='owner_of';reject(d,'REPORT_SCHEMA','REPORT_SCHEMA');});
test('R32_reject_relation_without_any_citation',()=>{const d=clone();d.relationships[0].evidence_keys=[];reject(d,'REPORT_REF','MISSING_EVIDENCE');});
test('R33_reject_unknown_with_fake_evidence',()=>{const d=clone();const x=d.relationships.find(e=>e.kind==='unknown');x.evidence_keys=['EV_EMAIL'];reject(d,'REPORT_REF','PROVENANCE_ERROR');});
test('R34_reject_negative_location_line',()=>{const d=clone();d.evidence_records[0].location.line_start=-1;reject(d,'REPORT_SCHEMA','REPORT_SCHEMA');});
test('R35_reject_missing_review_binding_field',()=>{const d=clone();delete d.reviews[0].target;reject(d,'REPORT_SCHEMA','REPORT_SCHEMA');});
test('R36_support_valid_edge_review_with_exact_target',()=>{const d=clone();d.reviews.push({key:'REV_REL_SYNTH',reviewer_key:'P_B',target:{kind:'relation',key:'REL_ASSIGN_A'},decision:'confirm',recorded_at:'2026-11-08T10:05:00Z',remark:'【纯合成】核对指定关系证据。'});d.relationships[0].assessment.review_state='confirmed';d.relationships[0].assessment.review_key='REV_REL_SYNTH';const r=adapt(d);assert(r.ok,JSON.stringify(r.errors));assert.equal(r.graph.review_events[1].target_kind,'edge');});
test('R37_rejected_relation_must_be_hidden',()=>{const d=clone();d.reviews.push({key:'REV_REL_SYNTH',reviewer_key:'P_B',target:{kind:'relation',key:'REL_ASSIGN_A'},decision:'reject',recorded_at:'2026-11-08T10:05:00Z',remark:'【纯合成】核对后驳回。'});d.relationships[0].assessment.review_state='rejected';d.relationships[0].assessment.review_key='REV_REL_SYNTH';const r=adapt(d);assert(r.ok,JSON.stringify(r.errors));assert(!r.validation.renderable.edges.some(e=>e.id==='REL_ASSIGN_A'));});
test('R38_graph_validator_explicitly_rechecks_adapter_output',()=>{const r=adapt(clone());assert(r.ok);const checked=validateGraph(r.graph,graphSchema);assert(checked.ok);assert.equal(checked.renderable.edges.length,7);});
test('R39_no_mutation_of_untrusted_input',()=>{const d=clone();const before=JSON.stringify(d);const r=adapt(d);assert(r.ok);assert.equal(JSON.stringify(d),before);});
test('R40_report_input_maximum_limit',()=>{const d=clone();d.project_title='X'.repeat(251000);reject(d,'REPORT_INPUT','REPORT_SCHEMA');});
test('R41_warning_related_id_cannot_point_to_nonexistent_object',()=>{const d=clone();d.notices[0].related_key='GHOST';reject(d,'REPORT_REF','DANGLING_REF');});
test('R42_input_UTF8_byte_size_limit',()=>{const d=clone();d.project_title='汉'.repeat(85000);reject(d,'REPORT_INPUT','REPORT_SCHEMA');});
const failed=results.filter(x=>x.status!=='PASS');
const summary={environment:{node:process.version,platform:process.platform,arch:process.arch},count:results.length,passed:results.length-failed.length,failed:failed.length,tests:results};
if(process.env.WRITE_TEST_RESULTS)fs.writeFileSync(process.env.WRITE_TEST_RESULTS,JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify({tests:results.length,pass:summary.passed,fail:summary.failed}));
if(failed.length)process.exitCode=1;
