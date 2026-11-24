// V1.6-R2: camera landmarks only -> local, read-only graph navigation actions.
// No user project content or camera frames are transmitted to model vendors.
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const avg=pts=>({x:pts.reduce((n,p)=>n+p.x,0)/pts.length,y:pts.reduce((n,p)=>n+p.y,0)/pts.length});
export const DEFAULT_GESTURE_SETTINGS=Object.freeze({horizontal:1,vertical:1.5,zoom:1,pointer:1.05,smoothing:.36,holdMs:520,hitRadius:56,invertX:false,invertY:false});
const RANGES={horizontal:[.3,3],vertical:[.3,3],zoom:[.4,2.5],pointer:[.6,1.7],smoothing:[.08,.85],holdMs:[280,1300],hitRadius:[24,90]};
export function normalizeGestureSettings(input){
  if(input===null||typeof input!=='object'||Array.isArray(input))throw Error('GESTURE_PREFS_INVALID');
  const keys=[...Object.keys(RANGES),'invertX','invertY'];
  if(Object.keys(input).some(k=>!keys.includes(k)))throw Error('GESTURE_PREFS_INVALID');
  const next={...DEFAULT_GESTURE_SETTINGS};
  for(const [key,[lo,hi]] of Object.entries(RANGES))if(Object.hasOwn(input,key)){
    if(!Number.isFinite(input[key])||input[key]<lo||input[key]>hi)throw Error('GESTURE_PREFS_INVALID');
    next[key]=input[key];
  }
  for(const key of ['invertX','invertY'])if(Object.hasOwn(input,key)){
    if(typeof input[key]!=='boolean')throw Error('GESTURE_PREFS_INVALID');next[key]=input[key];
  }
  return next;
}
export function classifyHand(points){
  if(!Array.isArray(points)||points.length!==21||points.some(p=>!Number.isFinite(p?.x)||!Number.isFinite(p?.y)))return null;
  const palm=Math.max(.045,distance(points[0],points[9]));
  const fingerPairs=[[8,6],[12,10],[16,14],[20,18]];
  const extended=fingerPairs.map(([tip,pip])=>distance(points[tip],points[0])>distance(points[pip],points[0])+palm*.23);
  const extendedCount=extended.filter(Boolean).length;
  const pinchRatio=distance(points[4],points[8])/palm;
  const pinch=pinchRatio<.43;
  const point=extended[0]&&!extended[1]&&!extended[2]&&!extended[3]&&!pinch;
  const open=extendedCount>=3&&!pinch;
  const fist=extendedCount<=1&&!point&&!pinch;
  return {pose:pinch?'pinch':point?'point':open?'open':fist?'fist':'neutral',center:avg([points[0],points[5],points[9],points[13],points[17]]),tip:points[8],palm,pinchRatio,extended:extendedCount};
}
const pointerAt=(hand,prefs)=>({x:clamp(.5+(.5-hand.tip.x)*prefs.pointer,0,1),y:clamp(.5+(hand.tip.y-.5)*prefs.pointer,0,1)});
export class GestureInterpreter{
  constructor(settings={}){this.settings=normalizeGestureSettings(settings);this.reset();}
  configure(settings){this.settings=normalizeGestureSettings(settings);this.reset();}
  reset(){this.previous=null;this.mode=null;this.openCount=0;this.pinchStarted=0;this.didSelect=false;this.lastSelect=-Infinity;this.lastTime=-Infinity;this.releasedFrames=2;this.pointer=null;this.pointerTime=-Infinity;this.lockedPointer=null;this.smoothX=0;this.smoothY=0;}
  consume(landmarks,now=performance.now()){
    if(!Number.isFinite(now)||now<this.lastTime)this.reset();this.lastTime=now;
    const hands=(landmarks||[]).slice(0,2).map(classifyHand).filter(Boolean);
    if(!hands.length){this.reset();this.lastTime=now;return {status:'未识别到手',actions:[]};}
    const actions=[],s=this.settings;
    if(hands.length>=2&&hands.every(h=>h.pose==='open')){
      const separation=distance(hands[0].center,hands[1].center);
      if(this.mode==='two'&&this.previous?.separation>0){
        const delta=(separation-this.previous.separation)/Math.max(.25,this.previous.separation);
        if(Math.abs(delta)>.018)actions.push({type:'zoom',factor:clamp(1+delta*1.65*s.zoom,.84,1.16)});
      }
      this.mode='two';this.previous={separation};this.openCount=0;this.lockedPointer=null;
      actions.push({type:'cursor-hide'});
      return {status:'👐 双手远离放大 / 靠近缩小',actions,pose:'two'};
    }
    const hand=hands[0];
    if(hand.pose==='fist'){
      this.mode='fist';this.previous=null;this.openCount=0;this.lockedPointer=null;this.smoothX=0;this.smoothY=0;
      return {status:'✊ 握拳暂停；张掌可恢复',actions:[{type:'cursor-hide'}],pose:'fist'};
    }
    if(hand.pose==='pinch'){
      if(this.mode!=='pinch'){
        this.pinchStarted=now;this.didSelect=false;
        // The index fingertip moves towards the thumb during a pinch. Lock the
        // target location from the preceding pointing pose, not the pinch frame.
        this.lockedPointer=(this.pointer&&now-this.pointerTime<800)?{...this.pointer}:pointerAt(hand,s);
      }
      this.mode='pinch';this.previous=null;this.openCount=0;
      actions.push({type:'aim',...this.lockedPointer,locked:true});
      if(!this.didSelect&&now-this.pinchStarted>=s.holdMs&&this.releasedFrames>=2&&now-this.lastSelect>=320){
        this.didSelect=true;this.lastSelect=now;this.releasedFrames=0;
        actions.push({type:'select',...this.lockedPointer});
      }
      return {status:this.didSelect?'🤏 已确认；松开并指向另一节点':'🤏 保持捏合以确认高亮目标',actions,pose:'pinch'};
    }
    if(this.mode==='pinch')this.releasedFrames=0;
    else this.releasedFrames=Math.min(2,this.releasedFrames+1);
    this.pinchStarted=0;this.lockedPointer=null;
    if(hand.pose==='point'){
      const target=pointerAt(hand,s);
      // Small smoothing for pointer, reset after pose changes to prevent jumps.
      this.pointer=this.mode==='point'&&this.pointer?{x:this.pointer.x*.25+target.x*.75,y:this.pointer.y*.25+target.y*.75}:target;
      this.pointerTime=now;this.mode='point';this.previous=null;this.openCount=0;
      return {status:'☝️ 移动食指瞄准；目标高亮后捏合',actions:[{type:'aim',...this.pointer}],pose:'point'};
    }
    if(hand.pose==='open'){
      this.openCount++;
      if(this.mode==='open'&&this.previous&&this.openCount>=3){
        const dx=this.previous.x-hand.center.x,dy=hand.center.y-this.previous.y;
        const alpha=1-s.smoothing;
        this.smoothX=this.smoothX*s.smoothing+dx*alpha;this.smoothY=this.smoothY*s.smoothing+dy*alpha;
        // Per-axis thresholds and adjustable sensitivity, with explicit inversion.
        const x=Math.abs(this.smoothX)>.0025?clamp(this.smoothX*3.8*s.horizontal*(s.invertX?-1:1),-.08,.08):0;
        const y=Math.abs(this.smoothY)>.0025?clamp(this.smoothY*3.8*s.vertical*(s.invertY?-1:1),-.08,.08):0;
        if(x||y)actions.push({type:'rotate',dx:x,dy:y});
      }else {this.smoothX=0;this.smoothY=0;}
      this.previous={x:hand.center.x,y:hand.center.y};this.mode='open';
      actions.push({type:'cursor-hide'});
      return {status:'✋ 左右移动=水平旋转，上下移动=俯仰旋转',actions,pose:'open'};
    }
    this.mode='neutral';this.openCount=0;this.previous=null;this.smoothX=0;this.smoothY=0;
    return {status:'请张掌旋转，或伸出食指瞄准节点',actions:[{type:'cursor-hide'}],pose:'neutral'};
  }
}
