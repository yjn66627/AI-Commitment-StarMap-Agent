import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,mkdir,readFile} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {classifyHand,GestureInterpreter} from '../../runtime/workspace-ui/gesture/gesture-math.mjs';
import {validateAssets,MODEL_SHA} from '../../scripts/gesture-assets.mjs';
import {gestureResourceReady,startWorkspaceService} from '../../electron/workspace/workspace-service.mjs';
import {KeyVault} from '../../electron/workspace/key-vault.mjs';
import {GraphView} from '../../runtime/workspace-ui/graph.js';
function makeHand(cx=.5,cy=.5,pose='open'){
  const p=Array.from({length:21},()=>({x:cx,y:cy}));
  const points={0:[0,.40],1:[-.27,.12],2:[-.34,.03],3:[-.40,-.03],4:[-.38,-.15],
    5:[-.19,.08],6:[-.23,-.1],7:[-.26,-.31],8:[-.27,-.44],
    9:[-.05,.0],10:[-.04,-.18],11:[-.035,-.39],12:[-.03,-.48],
    13:[.12,.08],14:[.15,-.14],15:[.17,-.30],16:[.18,-.41],
    17:[.27,.17],18:[.33,-.02],19:[.35,-.20],20:[.36,-.31]};
  for(const [i,[x,y]]of Object.entries(points))p[+i]={x:cx+x*.40,y:cy+y*.40};
  if(pose==='fist')for(const i of [8,12,16,20])p[i]={x:p[i-2].x,y:p[i-2].y+.10};
  if(pose==='pinch')p[4]={x:p[8].x+.008,y:p[8].y+.008};
  if(pose==='point')for(const i of [12,16,20])p[i]={x:p[i-2].x,y:p[i-2].y+.10};
  return p;
}
test('gesture geometry recognizes open, pinch and fist (no model dependency)',()=>{
  assert.equal(classifyHand(makeHand())?.pose,'open');
  assert.equal(classifyHand(makeHand(.5,.5,'pinch'))?.pose,'pinch');
  assert.equal(classifyHand(makeHand(.5,.5,'fist'))?.pose,'fist');
  assert.equal(classifyHand(makeHand(.5,.5,'point'))?.pose,'point');
  assert.equal(classifyHand([]),null);assert.equal(classifyHand([{x:NaN,y:1}]),null);
});
test('open palm rotates on independently adjustable axes; fist pauses, lost hand resets',()=>{
  const g=new GestureInterpreter({horizontal:1.5,vertical:2.2,smoothing:.2});
  assert.equal(g.consume([makeHand(.5,.5)],0).actions.some(x=>x.type==='rotate'),false);
  assert.equal(g.consume([makeHand(.55,.54)],100).actions.some(x=>x.type==='rotate'),false);
  const third=g.consume([makeHand(.61,.58)],200);
  assert.equal(Math.abs(third.actions.find(a=>a.type==='rotate')?.dx)>0,true);
  assert.equal(third.actions.find(a=>a.type==='rotate')?.dy>0,true);
  assert.equal(g.consume([makeHand(.67,.5,'fist')],300).actions.some(x=>x.type==='rotate'),false);
  assert.deepEqual(g.consume([],400).actions,[]);
  assert.equal(g.consume([makeHand(.8)],500).actions.some(x=>x.type==='rotate'),false);
});
test('two-hand span changes zoom with bounded factor and configurable gain',()=>{
  const g=new GestureInterpreter({zoom:1.5});
  g.consume([makeHand(.25),makeHand(.65)],100);
  const r=g.consume([makeHand(.13),makeHand(.83)],160);
  assert.equal(r.actions[0].type,'zoom');
  assert.ok(r.actions[0].factor<=1.16&&r.actions[0].factor>=.84);
});
test('pointing previews target, pinch locks previous fingertip position; release and point can select a different node',()=>{
  const g=new GestureInterpreter({holdMs:400,pointer:1});
  const pointA=makeHand(.4,.5,'point'),pinchA=makeHand(.2,.5,'pinch');
  const start=g.consume([pointA],100);
  assert.equal(start.pose,'point');assert.equal(start.actions[0].type,'aim');
  const targetA=start.actions[0];
  g.consume([pinchA],170);
  const selectedA=g.consume([pinchA],650).actions.find(a=>a.type==='select');
  assert.equal(selectedA?.x,targetA.x,'a finger moves during pinch; selection must remain on original preview');
  assert.equal(selectedA?.y,targetA.y);
  // A held pinch cannot repeatedly select or change graph data.
  assert.equal(g.consume([pinchA],800).actions.some(a=>a.type==='select'),false);
  const pointB=makeHand(.72,.56,'point'),pinchB=makeHand(.55,.56,'pinch');
  g.consume([pointB],900);g.consume([pointB],1000);g.consume([pointB],1100);
  const bAim=g.consume([pointB],1200).actions[0];
  assert.notEqual(bAim.x,targetA.x);
  g.consume([pinchB],1300);
  const selectedB=g.consume([pinchB],1750).actions.find(a=>a.type==='select');
  assert.equal(selectedB?.x,bAim.x);assert.equal(selectedB?.y,bAim.y);
  assert.ok(['aim','select','cursor-hide','rotate','zoom'].includes(selectedB.type));
});
test('graph gesture preview and selection follow the same nearest node, preserve inspector on hover',()=>{
  const fake={getContext:()=>({})};const g=Object.create(GraphView.prototype);
  g.mode='3d';g.yaw=0;g.pitch=0;g.zoom=1;g.w=300;g.h=200;g.gestureHover=null;
  g.hit=[{node:{id:'a'},x:150,y:100},{node:{id:'b'},x:260,y:130}];
  g.draw=()=>{};g.inspect=n=>g.seen=n.id;
  g.rotateByGesture(.5,0);assert.equal(g.yaw,.08);
  g.zoomByGesture(1.5);assert.equal(g.zoom,1.16);
  assert.equal(g.previewByGesture(.5,.5,56)?.id,'a');assert.equal(g.seen,undefined,'hover must not select');
  assert.equal(g.selectByGesture(.5,.5),true);assert.equal(g.seen,'a');
  assert.equal(g.previewByGesture(260/300,130/200,56)?.id,'b');
  assert.equal(g.selectByGesture(260/300,130/200),true);assert.equal(g.seen,'b');
  g.clearGesturePreview();assert.equal(g.gestureHover,null);
  assert.equal(g.selectByGesture(0,0),false);
  g.mode='2d';assert.equal(g.selectByGesture(.5,.5),false);
});
test('offline model assets are mandatory for Windows build, currently not falsely reported available',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'starmap-gesture-assets-'));
  try{let r=await validateAssets(dir);assert.equal(r.ok,false);
    assert.equal(await gestureResourceReady(dir),false);
    await mkdir(path.join(dir,'models'),{recursive:true});
    await writeFile(path.join(dir,'models/hand_landmarker.task'),Buffer.alloc(1500,1));
    r=await validateAssets(dir);assert.equal(r.ok,false);
    assert.match(MODEL_SHA,/^[a-f0-9]{64}$/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('gesture status and module routes require session; camera image is never an API endpoint',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'starmap-gesture-http-'));let svc;
  try{
    svc=await startWorkspaceService({dataDir:root,vault:new KeyVault(root,{isEncryptionAvailable:()=>false})});
    const url=svc.origin,cookie='starmap-workspace='+svc.cookie.value;
    assert.equal((await fetch(url+'/app/gesture/status.json')).status,401);
    const good=await fetch(url+'/app/gesture/status.json',{headers:{cookie}});
    assert.equal(good.status,200);assert.equal(typeof(await good.json()).ready,'boolean');
    assert.equal((await fetch(url+'/app/gesture/gesture-math.mjs',{headers:{cookie}})).status,200);
    assert.equal((await fetch(url+'/app/gesture/../../etc/passwd',{headers:{cookie}})).status,404);
    assert.equal((await fetch(url+'/api/workspace/camera',{headers:{cookie}})).status,404);
  }finally{await svc?.stop();await rm(root,{recursive:true,force:true});}
});
