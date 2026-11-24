import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {validateLifecycle,applyClaimLifecycle,validateLinkRevision,applyLinkRevision} from './evolution.mjs';
import {initJournal,capture,appendJournal,validateJournal,remapJournal,projectAt,timeline,revision} from './journal.mjs';
import {validateIncremental,addIncremental,decideIncremental,remapIncremental} from './incremental.mjs';
const VERSION='starmap-workspace-1';
const LIMIT=6*1024*1024;
const id=(kind)=>kind+'_'+randomBytes(9).toString('hex');
const clean=(x,max)=>typeof x==='string'?x.trim().slice(0,max):'';
const error=(code)=>{throw Error(code);};
const assert=(test,code)=>{if(!test)error(code);};
const counts={sources:60,evidence:300,claims:300,links:400};
const validKinds=['commitment','risk','note'];
// Removal from the live materials list is reversible: retain the original text for evidence.
function materialImpact(p,sourceId){
  const source=p.sources.find(s=>s.id===sourceId);assert(source,'SOURCE_NOT_FOUND');
  const evidence=p.evidence.filter(e=>e.sourceId===sourceId),ids=new Set(evidence.map(e=>e.id));
  const claims=p.claims.filter(c=>[...c.evidenceIds,...(c.lifecycle?.evidenceIds||[])].some(i=>ids.has(i))),cids=new Set(claims.map(c=>c.id));
  const links=p.links.filter(l=>cids.has(l.from)||cids.has(l.to)||[...l.evidenceIds,...(l.change?.evidenceIds||[])].some(i=>ids.has(i)));
  const token=createHash('sha256').update(JSON.stringify([source.id,source.archivedAt||null,source.name,evidence.map(e=>e.id),claims.map(c=>c.id),links.map(l=>l.id)])).digest('hex');
  return {sourceId,name:source.name,archived:!!source.archivedAt,evidence:evidence.length,claims:claims.length,links:links.length,token};
}
const validReviews=['pending','confirmed','rejected'];

export function validateProject(project){
  assert(project&&typeof project==='object'&&!Array.isArray(project),'PROJECT_INVALID');
  assert(/^p_[a-f0-9]{18}$/.test(project.id)&&clean(project.title,101).length>0&&project.title.length<=100,'PROJECT_FIELDS_INVALID');
  for(const [field,limit] of Object.entries(counts))assert(Array.isArray(project[field])&&project[field].length<=limit,'PROJECT_LIMIT');
  const ids=new Set();
  const own=(item,prefix)=>{assert(typeof item.id==='string'&&new RegExp('^'+prefix+'_[a-f0-9]{18}$').test(item.id)&&!ids.has(item.id),'DUPLICATE_ID');ids.add(item.id);};
  for(const s of project.sources){own(s,'src');assert(clean(s.name,121).length>0&&typeof s.content==='string'&&s.content.length>0&&s.content.length<=180000,'SOURCE_INVALID');assert(s.archivedAt===undefined||typeof s.archivedAt==='string'&&Number.isFinite(Date.parse(s.archivedAt)),'SOURCE_INVALID');}
  const sourceById=new Map(project.sources.map(x=>[x.id,x]));
  for(const e of project.evidence){own(e,'ev');assert(sourceById.has(e.sourceId)&&typeof e.quote==='string'&&e.quote.trim().length>=2&&e.quote.length<=1600&&sourceById.get(e.sourceId).content.includes(e.quote),'EVIDENCE_UNLOCATED');}
  const evidenceIds=new Set(project.evidence.map(x=>x.id));
  for(const c of project.claims){own(c,'cl');assert(validKinds.includes(c.kind)&&validReviews.includes(c.review)&&clean(c.text,601).length>=2&&c.text.length<=600&&['manual','ai'].includes(c.origin)&&Array.isArray(c.evidenceIds)&&c.evidenceIds.length>0&&c.evidenceIds.length<=12&&c.evidenceIds.every(x=>evidenceIds.has(x)),'CLAIM_INVALID');validateLifecycle(c,evidenceIds);}
  const claimIds=new Set(project.claims.map(x=>x.id));
  for(const l of project.links){own(l,'ln');assert(claimIds.has(l.from)&&claimIds.has(l.to)&&l.from!==l.to&&['supports','contradicts','related'].includes(l.kind)&&Array.isArray(l.evidenceIds)&&l.evidenceIds.length>0&&l.evidenceIds.every(x=>evidenceIds.has(x))&&validReviews.includes(l.review),'LINK_INVALID');validateLinkRevision(l,evidenceIds);}
  validateJournal(project);validateIncremental(project);return true;
}
export class ProjectStore{
  constructor(folder){this.folder=folder;this.file=path.join(folder,'workspace.json');this.queue=Promise.resolve();}
  async init(){await fs.mkdir(this.folder,{recursive:true});let data;try{data=await this._read();this._check(data);}catch(e){if(e.code==='ENOENT'){await this._write({version:VERSION,evolutionSchema:1,projects:[]});return;}throw e;}
    // Preserve original workspace bytes on the one-time upgrade; never overwrite an existing backup.
    if(data.evolutionSchema!==1){const raw=await fs.readFile(this.file),backup=path.join(this.folder,'workspace.pre-v19.json');try{await fs.writeFile(backup,raw,{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;const old=await fs.readFile(backup);assert(old.equals(raw),'UPGRADE_BACKUP_CONFLICT');}for(const p of data.projects)initJournal(p);data.evolutionSchema=1;this._check(data);await this._write(data);}}

  _check(data){assert(data&&data.version===VERSION&&(data.evolutionSchema===undefined||data.evolutionSchema===1)&&Array.isArray(data.projects)&&data.projects.length<=50,'STORE_SCHEMA_INVALID');data.projects.forEach(validateProject);const ids=data.projects.map(x=>x.id);assert(new Set(ids).size===ids.length,'DUPLICATE_PROJECT');}
  async _read(){const stat=await fs.stat(this.file);assert(stat.size<=LIMIT,'STORE_TOO_LARGE');return JSON.parse(await fs.readFile(this.file,'utf8'));}
  async _write(data){const payload=JSON.stringify(data);assert(Buffer.byteLength(payload)<LIMIT,'STORE_TOO_LARGE');const tmp=this.file+'.'+randomBytes(6).toString('hex')+'.tmp';await fs.writeFile(tmp,payload,{mode:0o600,flag:'wx'});try{await fs.rename(tmp,this.file);}catch(e){await fs.rm(tmp,{force:true});throw e;}}
  async read(){const data=await this._read();this._check(data);return data;}
  async modify(fn){const task=this.queue.then(async()=>{const data=await this.read();const output=fn(data);this._check(data);await this._write(data);return output;});this.queue=task.catch(()=>{});return task;}
  async list(){return (await this.read()).projects.map(p=>({id:p.id,title:p.title,createdAt:p.createdAt,updatedAt:p.updatedAt,sources:p.sources.filter(s=>!s.archivedAt).length,evidence:p.evidence.length,claims:p.claims.length}));}
  async get(projectId){const p=(await this.read()).projects.find(p=>p.id===projectId);if(!p)error('PROJECT_NOT_FOUND');return p;}
  async create(title){title=clean(title,100);assert(title.length>0,'TITLE_REQUIRED');return this.modify(data=>{assert(data.projects.length<50,'PROJECT_LIMIT');const now=new Date().toISOString();const p={id:id('p'),title,createdAt:now,updatedAt:now,sources:[],evidence:[],claims:[],links:[]};initJournal(p,now);data.projects.unshift(p);return p;});}
  async _edit(projectId,fn,action='edit',reason=''){return this.modify(data=>{const p=data.projects.find(x=>x.id===projectId);if(!p)error('PROJECT_NOT_FOUND');const before=capture(p);const result=fn(p);p.updatedAt=new Date().toISOString();appendJournal(p,before,{action,reason,at:p.updatedAt});return result;});}
  async remove(projectId){return this.modify(data=>{const i=data.projects.findIndex(p=>p.id===projectId);if(i<0)error('PROJECT_NOT_FOUND');data.projects.splice(i,1);return {removed:true};});}
  async addSource(projectId,name,content){name=clean(name,120);assert(name.length>0&&typeof content==='string'&&content.trim().length>0&&content.length<=180000,'SOURCE_INVALID');return this._edit(projectId,p=>{assert(p.sources.length<counts.sources,'SOURCE_LIMIT');const s={id:id('src'),name,content,addedAt:new Date().toISOString()};p.sources.push(s);return s;},'source.add',name);}
  async sourceImpact(projectId,sourceId){return materialImpact(await this.get(projectId),sourceId);}
  async archiveSource(projectId,sourceId,token){return this._edit(projectId,p=>{const impact=materialImpact(p,sourceId);assert(!impact.archived&&impact.token===token,'SOURCE_IMPACT_CHANGED');const s=p.sources.find(x=>x.id===sourceId);s.archivedAt=new Date().toISOString();return s;},'source.archive');}
  async restoreSource(projectId,sourceId){return this._edit(projectId,p=>{const s=p.sources.find(x=>x.id===sourceId);assert(s&&s.archivedAt,'SOURCE_NOT_ARCHIVED');delete s.archivedAt;return s;},'source.restore');}
  async renameSource(projectId,sourceId,name){name=clean(name,120);assert(name.length>0,'SOURCE_INVALID');return this._edit(projectId,p=>{const s=p.sources.find(x=>x.id===sourceId);assert(s&&!s.archivedAt,'SOURCE_NOT_FOUND');s.name=name;return s;},'source.rename',name);}
  async addEvidence(projectId,sourceId,quote){assert(typeof quote==='string'&&quote.trim().length>=2&&quote.length<=1600,'QUOTE_INVALID');return this._edit(projectId,p=>{const s=p.sources.find(x=>x.id===sourceId);assert(s&&!s.archivedAt&&s.content.includes(quote),'QUOTE_NOT_IN_SOURCE');assert(p.evidence.length<counts.evidence,'EVIDENCE_LIMIT');const e={id:id('ev'),sourceId,quote,createdAt:new Date().toISOString()};p.evidence.push(e);return e;},'evidence.add');}
  async addClaim(projectId,{kind,text,evidenceIds,origin='manual',rationale=''}){
    assert(validKinds.includes(kind)&&clean(text,601).length>=2&&text.length<=600&&Array.isArray(evidenceIds)&&evidenceIds.length>0&&evidenceIds.length<=12&&typeof rationale==='string'&&rationale.length<=500,'CLAIM_INVALID');
    return this._edit(projectId,p=>{assert(evidenceIds.every(x=>p.evidence.some(e=>e.id===x)),'UNKNOWN_EVIDENCE');assert(p.claims.length<counts.claims,'CLAIM_LIMIT');const c={id:id('cl'),kind,text:text.trim(),evidenceIds:[...new Set(evidenceIds)],origin,review:'pending',rationale,createdAt:new Date().toISOString()};p.claims.push(c);return c;},'claim.add');
  }
  async addAIClaims(projectId,suggestions,provider,expectedRevision){
    assert(Array.isArray(suggestions)&&suggestions.length<=12,'PROPOSALS_INVALID');
    return this._edit(projectId,p=>{if(expectedRevision!==undefined)assert(revision(p)===expectedRevision,'INCREMENTAL_STALE');assert(p.claims.length+suggestions.length<=counts.claims,'CLAIM_LIMIT');const added=suggestions.map(s=>{assert(['commitment','risk'].includes(s.kind)&&typeof s.text==='string'&&s.text.length<=400&&s.text.trim().length>=2&&Array.isArray(s.evidenceIds)&&s.evidenceIds.length>0&&s.evidenceIds.every(x=>p.evidence.some(e=>e.id===x)),'PROPOSAL_INVALID');return {id:id('cl'),kind:s.kind,text:s.text.trim(),evidenceIds:[...new Set(s.evidenceIds)],origin:'ai',review:'pending',provider,rationale:s.rationale,createdAt:new Date().toISOString()};});p.claims.push(...added);return added;},'ai.analyze');
  }
  async reviewClaim(projectId,claimId,decision){assert(['confirmed','rejected'].includes(decision),'DECISION_INVALID');return this._edit(projectId,p=>{const c=p.claims.find(x=>x.id===claimId);assert(c,'CLAIM_NOT_FOUND');c.review=decision;c.reviewedAt=new Date().toISOString();return c;},'claim.review',decision);}
  async updateClaimLifecycle(projectId,claimId,input){return this._edit(projectId,p=>applyClaimLifecycle(p,claimId,input),'claim.lifecycle',input.reason);}
  async addLink(projectId,{from,to,kind,evidenceIds}){
    assert(['supports','contradicts','related'].includes(kind)&&from!==to&&Array.isArray(evidenceIds)&&evidenceIds.length>0&&evidenceIds.length<=12,'LINK_INVALID');
    return this._edit(projectId,p=>{assert(p.claims.some(x=>x.id===from)&&p.claims.some(x=>x.id===to)&&evidenceIds.every(x=>p.evidence.some(e=>e.id===x)),'LINK_REFERENCES_INVALID');assert(p.links.length<counts.links,'LINK_LIMIT');const l={id:id('ln'),from,to,kind,evidenceIds:[...new Set(evidenceIds)],review:'pending',createdAt:new Date().toISOString()};p.links.push(l);return l;},'link.add');
  }
  async reviewLink(projectId,linkId,decision){assert(['confirmed','rejected'].includes(decision),'DECISION_INVALID');return this._edit(projectId,p=>{const l=p.links.find(x=>x.id===linkId);assert(l,'LINK_NOT_FOUND');assert(!l.retiredAt,'LINK_RETIRED');l.review=decision;return l;},'link.review',decision);}
  async reviseLink(projectId,linkId,input){return this._edit(projectId,p=>applyLinkRevision(p,linkId,input),'link.revise',input.reason);}
  async addIncrementalResults(projectId,plan,result,provider){return this._edit(projectId,p=>addIncremental(p,plan,result,provider,id),'ai.incremental',`分析新证据 ${plan.batch.length} 条`);}
  async reviewChange(projectId,changeId,decision){return this._edit(projectId,p=>decideIncremental(p,changeId,decision),'ai.change.review',decision);}
  async history(projectId){return timeline(await this.get(projectId));}
  async snapshot(projectId,seq){const p=projectAt(await this.get(projectId),seq);validateProject(p);return p;}
  async importProject(external){
    assert(external&&external.schemaVersion===VERSION&&external.project,'IMPORT_FORMAT_UNSUPPORTED');
    const source=structuredClone(external.project);validateProject(source);
    return this.modify(data=>{
      assert(data.projects.length<50,'PROJECT_LIMIT');
      // Remap every identifier. Imported records cannot point to other local projects.
      const maps=new Map(),newId=old=>{if(!maps.has(old))maps.set(old,id(old.split('_')[0]));return maps.get(old);};
      const p={...source,id:id('p'),title:clean(source.title,100),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
      p.sources=p.sources.map(s=>({...s,id:newId(s.id)}));
      p.evidence=p.evidence.map(e=>({...e,id:newId(e.id),sourceId:newId(e.sourceId)}));
      p.claims=p.claims.map(c=>({...c,id:newId(c.id),evidenceIds:c.evidenceIds.map(newId),...(c.lifecycle?{lifecycle:{...c.lifecycle,evidenceIds:c.lifecycle.evidenceIds.map(newId)}}:{})}));
      p.links=p.links.map(l=>({...l,id:newId(l.id),from:newId(l.from),to:newId(l.to),evidenceIds:l.evidenceIds.map(newId),...(l.change?{change:{...l.change,evidenceIds:l.change.evidenceIds.map(newId)}}:{})}));
      if(p.journal)p.journal=remapJournal(p.journal,newId);else initJournal(p);remapIncremental(p,newId);
      validateProject(p);data.projects.unshift(p);return p;
    });
  }
  async exportProject(projectId){return {schemaVersion:VERSION,exportedAt:new Date().toISOString(),project:await this.get(projectId)};}
}
