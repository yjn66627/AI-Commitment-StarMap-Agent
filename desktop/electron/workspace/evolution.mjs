// V1.9 lifecycle state is separate from review. No model output directly mutates a confirmed claim.
export const STATUS = Object.freeze({
 commitment:['unassessed','planned','in_progress','awaiting_acceptance','fulfilled','cancelled','superseded'],
 risk:['unassessed','open','mitigating','resolved','accepted'],
 note:['unassessed','open','resolved']
});
const assert=(v,code='LIFECYCLE_INVALID')=>{if(!v)throw Error(code);};
const str=(v,max)=>typeof v==='string'&&v.length<=max;
export const validDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
export const effectiveLifecycle=c=>c.lifecycle||{status:'unassessed',owner:'',due:'',evidenceIds:[],reason:''};
export function validateLifecycle(c,evIds){
 if(c.lifecycle===undefined)return true;const l=c.lifecycle;
 assert(l&&typeof l==='object'&&!Array.isArray(l)&&Object.keys(l).every(k=>['status','owner','due','evidenceIds','reason'].includes(k)));
 assert(STATUS[c.kind]?.includes(l.status)&&str(l.owner,100)&&str(l.due,10)&&(!l.due||validDate(l.due))&&str(l.reason,500)&&Array.isArray(l.evidenceIds)&&l.evidenceIds.length<=12&&new Set(l.evidenceIds).size===l.evidenceIds.length&&l.evidenceIds.every(i=>evIds.has(i)));
 assert(l.status==='unassessed'&&!l.owner&&!l.due&&!l.reason&&!l.evidenceIds.length||l.reason.trim().length>=2&&l.evidenceIds.length>0);
 return true;
}
export function applyClaimLifecycle(p,claimId,input){
 const c=p.claims.find(x=>x.id===claimId);assert(c,'CLAIM_NOT_FOUND');assert(c.review==='confirmed','CONFIRMED_CLAIM_REQUIRED');
 const l={status:input.status,owner:input.owner,due:input.due,evidenceIds:Array.isArray(input.evidenceIds)?[...new Set(input.evidenceIds)]:input.evidenceIds,reason:input.reason};
 assert(typeof l.reason==='string'&&l.reason.trim().length>=2&&Array.isArray(l.evidenceIds)&&l.evidenceIds.length>0,'CHANGE_EVIDENCE_REQUIRED');
 if(typeof l.owner==='string')l.owner=l.owner.trim();l.reason=l.reason.trim();
 validateLifecycle({...c,lifecycle:l},new Set(p.evidence.map(e=>e.id)));
 c.lifecycle=l;return c;
}

// A relation can be corrected, retired, or reactivated; identity and audit history stay intact.
export function validateLinkRevision(l,evIds){
 assert(l.retiredAt===undefined||typeof l.retiredAt==='string'&&Number.isFinite(Date.parse(l.retiredAt)),'LINK_REVISION_INVALID');
 if(l.change===undefined){assert(!l.retiredAt,'LINK_REVISION_INVALID');return true;}
 assert(l.change&&typeof l.change==='object'&&Object.keys(l.change).every(k=>['reason','evidenceIds'].includes(k))&&str(l.change.reason,500)&&l.change.reason.trim().length>=2&&Array.isArray(l.change.evidenceIds)&&l.change.evidenceIds.length>=1&&l.change.evidenceIds.length<=12&&new Set(l.change.evidenceIds).size===l.change.evidenceIds.length&&l.change.evidenceIds.every(i=>evIds.has(i)),'LINK_REVISION_INVALID');return true;
}
export function applyLinkRevision(p,linkId,input){
 const l=p.links.find(x=>x.id===linkId);assert(l,'LINK_NOT_FOUND');
 const {from,to,kind,active,evidenceIds,reason}=input;
 assert(typeof active==='boolean'&&from!==to&&['related','supports','contradicts'].includes(kind)&&p.claims.some(c=>c.id===from&&c.review!=='rejected')&&p.claims.some(c=>c.id===to&&c.review!=='rejected'),'LINK_REVISION_INVALID');
 assert(Array.isArray(evidenceIds)&&typeof reason==='string','CHANGE_EVIDENCE_REQUIRED');
 const change={reason:reason.trim(),evidenceIds:[...new Set(evidenceIds)]},retiredAt=active?undefined:l.retiredAt||new Date().toISOString();
 validateLinkRevision({...l,change,retiredAt},new Set(p.evidence.map(e=>e.id)));
 // Existing verified edge may be retired explicitly. A new topology/relationship type or reactivation needs another review.
 const topologyChanged=l.from!==from||l.to!==to||l.kind!==kind;assert(active||!topologyChanged,'LINK_REVISION_INVALID');const altered=topologyChanged||!!l.retiredAt&&active;
 if(altered){l.from=from;l.to=to;l.kind=kind;l.evidenceIds=[...change.evidenceIds];l.review='pending';}
 l.change=change;if(active)delete l.retiredAt;else l.retiredAt=retiredAt;return l;
}
