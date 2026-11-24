// Append-only, metadata-only reverse journal: source text/evidence quotes remain in the current project once.
// Every historical snapshot is reconstructible without copying whole documents at each edit.
import {isDeepStrictEqual} from 'node:util';
import {validateLifecycle,validateLinkRevision} from './evolution.mjs';
const fields=['sources','evidence','claims','links'];
const ok=(v,code='HISTORY_INVALID')=>{if(!v)throw Error(code);};
const date=v=>typeof v==='string'&&v.length<=40&&Number.isFinite(Date.parse(v));
const ref=(a,ids,max=12)=>Array.isArray(a)&&a.length<=max&&new Set(a).size===a.length&&a.every(i=>ids.has(i));
const review=v=>['pending','confirmed','rejected'].includes(v);
const bounded=(v,max)=>typeof v==='string'&&v.length<=max;
export const MAX_HISTORY=1000;
export const revision=p=>p.journal?.events.length||0;
export function initJournal(p,at=new Date().toISOString()){if(!p.journal)p.journal={version:1,baselineAt:at,events:[]};return p.journal;}
export function projection(field,x){
 if(field==='sources')return {name:x.name,archivedAt:x.archivedAt??null};
 if(field==='evidence')return {};
 if(field==='claims')return {review:x.review,reviewedAt:x.reviewedAt??null,lifecycle:x.lifecycle?structuredClone(x.lifecycle):null};
 return {from:x.from,to:x.to,kind:x.kind,evidenceIds:[...x.evidenceIds],review:x.review,retiredAt:x.retiredAt??null,change:x.change?structuredClone(x.change):null};
}
export function capture(p){return Object.fromEntries(fields.map(f=>[f,new Map(p[f].map(x=>[x.id,projection(f,x)]))]));}
export function appendJournal(p,before,{action='edit',reason='',at=new Date().toISOString()}={}){
 const j=initJournal(p,at);ok(j.events.length<MAX_HISTORY,'HISTORY_LIMIT');const changes=[];
 for(const f of fields){for(const x of p[f]){const after=projection(f,x),prev=before[f].get(x.id)??null;if(!isDeepStrictEqual(prev,after))changes.push({field:f,id:x.id,before:prev,after});}
 for(const id of before[f].keys())ok(p[f].some(x=>x.id===id),'HISTORY_PHYSICAL_DELETE_DENIED');}
 j.events.push({seq:j.events.length+1,at,action,reason:String(reason||'').slice(0,500),changes});return j.events.at(-1);
}
function validateMeta(f,m,raw,all){
 ok(m&&typeof m==='object'&&!Array.isArray(m));const keys=Object.keys(projection(f,raw));ok(Object.keys(m).length===keys.length&&keys.every(k=>Object.hasOwn(m,k)));
 if(f==='sources')ok(bounded(m.name,120)&&m.name.trim()&&(m.archivedAt===null||date(m.archivedAt)));
 if(f==='claims'){ok(review(m.review)&&(m.reviewedAt===null||date(m.reviewedAt)));if(m.lifecycle!==null)validateLifecycle({...raw,lifecycle:m.lifecycle},all.evidence);}
 if(f==='links'){ok(all.claims.has(m.from)&&all.claims.has(m.to)&&m.from!==m.to&&['related','supports','contradicts'].includes(m.kind)&&ref(m.evidenceIds,all.evidence,300)&&m.evidenceIds.length>0&&review(m.review));validateLinkRevision({retiredAt:m.retiredAt??undefined,change:m.change??undefined},all.evidence);}
}
function refsInState(state,raw){
 for(const id of state.evidence.keys())ok(state.sources.has(raw.evidence.get(id).sourceId));
 for(const [id,c] of state.claims){ok(raw.claims.get(id).evidenceIds.every(i=>state.evidence.has(i)));ok(!c.lifecycle||c.lifecycle.evidenceIds.every(i=>state.evidence.has(i)));}
 for(const l of state.links.values()){ok(state.claims.has(l.from)&&state.claims.has(l.to)&&l.evidenceIds.every(i=>state.evidence.has(i)));ok(!l.change||l.change.evidenceIds.every(i=>state.evidence.has(i)));}
}
export function validateJournal(p){
 if(p.journal===undefined)return true;const j=p.journal;
 ok(j&&j.version===1&&date(j.baselineAt)&&Array.isArray(j.events)&&j.events.length<=MAX_HISTORY);
 const raw=Object.fromEntries(fields.map(f=>[f,new Map(p[f].map(x=>[x.id,x]))])),all=Object.fromEntries(fields.map(f=>[f,new Set(raw[f].keys())])),state=capture(p);
 for(let n=j.events.length-1;n>=0;n--){const e=j.events[n];ok(e&&e.seq===n+1&&date(e.at)&&bounded(e.action,80)&&e.action.length>0&&bounded(e.reason,500)&&Array.isArray(e.changes)&&e.changes.length<=1060);const seen=new Set();
  for(const c of e.changes){ok(c&&fields.includes(c.field)&&all[c.field].has(c.id)&&!seen.has(c.id));seen.add(c.id);const r=raw[c.field].get(c.id);validateMeta(c.field,c.after,r,all);ok(state[c.field].has(c.id)&&isDeepStrictEqual(state[c.field].get(c.id),c.after));if(c.before===null)state[c.field].delete(c.id);else{validateMeta(c.field,c.before,r,all);state[c.field].set(c.id,c.before);}}
  refsInState(state,raw);
 }return true;
}
export function projectAt(p,seq){
 const total=revision(p);ok(Number.isInteger(seq)&&seq>=0&&seq<=total,'HISTORY_POSITION_INVALID');const out=structuredClone(p);delete out.journal;delete out.incremental;delete out.pendingChanges;
 const state=capture(p);for(let i=total-1;i>=seq;i--)for(const c of p.journal.events[i].changes){if(c.before===null)state[c.field].delete(c.id);else state[c.field].set(c.id,structuredClone(c.before));}
 for(const f of fields){out[f]=out[f].filter(x=>state[f].has(x.id)).map(x=>{for(const [k,v] of Object.entries(state[f].get(x.id))){if(v===null)delete x[k];else x[k]=structuredClone(v);}return x;});}
 return out;
}
export function remapMeta(f,m,newId){if(m===null)return null;const v=structuredClone(m);if(f==='claims'&&v.lifecycle)v.lifecycle.evidenceIds=v.lifecycle.evidenceIds.map(newId);if(f==='links'){v.from=newId(v.from);v.to=newId(v.to);v.evidenceIds=v.evidenceIds.map(newId);if(v.change)v.change.evidenceIds=v.change.evidenceIds.map(newId);}return v;}
export function remapJournal(j,newId){if(!j)return;return {...j,events:j.events.map(e=>({...e,changes:e.changes.map(c=>({...c,id:newId(c.id),before:remapMeta(c.field,c.before,newId),after:remapMeta(c.field,c.after,newId)}))}))};}
export function timeline(p){const j=p.journal;return {baselineAt:j?.baselineAt||null,events:(j?.events||[]).map(({seq,at,action,reason,changes})=>({seq,at,action,reason,changed:changes.length})),latest:revision(p)};}
