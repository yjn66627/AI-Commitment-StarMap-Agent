"""V1.6 gesture UI smoke: Chromium in-memory rendering, no loopback navigation.
The actual Electron/Windows native installer still requires Windows acceptance.
"""
from pathlib import Path
import sys,json,hashlib
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[2]/'runtime'/'workspace-ui'
out=Path(sys.argv[1]) if len(sys.argv)>1 else Path('/tmp/starmap-v18-visual')
out.mkdir(parents=True,exist_ok=True)
html=(root/'index.html').read_text();css=(root/'app.css').read_text()
html=html.replace('<link rel="stylesheet" href="/app/app.css">','<style>'+css+'</style>').replace('<script type="module" src="/app/app.js"></script>','')
graph=(root/'graph.js').read_text().replace('export function','function').replace('export const','const').replace('export class','class')
math=(root/'gesture/gesture-math.mjs').read_text().replace('export function','function').replace('export class','class').replace('export const','const').replace('clamp','gestureClamp')
guide=(root/'gesture/gesture-guide.mjs').read_text().replace("import {DEFAULT_GESTURE_SETTINGS,normalizeGestureSettings} from './gesture-math.mjs';",'').replace('export class','class')
gesture=(root/'gesture/gesture-controller.mjs').read_text().replace("import {GestureInterpreter,DEFAULT_GESTURE_SETTINGS} from './gesture-math.mjs';",'').replace("import {loadLocalHandLandmarker} from './vision-adapter.mjs';",'').replace("import {GestureGuide} from './gesture-guide.mjs';",'').replace('export class','class')
app=(root/'app.js').read_text().replace("import {GraphView,graphState,matchesState} from './graph.js';",'').replace("import {GestureController} from './gesture/gesture-controller.mjs';",'')
mock=r'''
window.calls=[];window.mock={prefs:{autoCheck:false},settings:{selected:'deepseek',profiles:{}},providers:[{id:'deepseek',name:'DeepSeek',model:'deepseek-chat',base:'https://api.deepseek.com',local:false}],project:{id:'p_aaaaaaaaaaaaaaaaaa',title:'V1.5 真实项目视觉验证（合成测试数据）',sources:[],evidence:[],claims:[],links:[]}};
const m=window.mock;
for(let i=0;i<5;i++){
 const source={id:'src_'+String(i+1).padStart(18,'0'),name:'会议与交付资料 '+(i+1),content:'供应商承诺按期交付测试报告及API文档 '+(i+1)};
 m.project.sources.push(source);
 for(let j=0;j<2;j++){
  const evidence={id:'ev_'+String(i*2+j+1).padStart(18,'0'),sourceId:source.id,quote:'供应商承诺按期交付测试报告及API文档'};
  m.project.evidence.push(evidence);
  const claim={id:'cl_'+String(i*2+j+1).padStart(18,'0'),kind:j?'risk':'commitment',text:j?'风险：验收材料需复核 '+(i+1):'承诺：交付测试材料 '+(i+1),evidenceIds:[evidence.id],review:j?'pending':'confirmed',origin:'manual'};
  m.project.claims.push(claim);
 }
}
for(let i=0;i<7;i++)m.project.links.push({id:'ln_'+String(i+1).padStart(18,'0'),from:m.project.claims[i].id,to:m.project.claims[i+1].id,kind:i%2?'related':'supports',review:i%2?'pending':'confirmed',evidenceIds:[m.project.evidence[i].id]});
m.projects=[m.project,...Array.from({length:2},(_,i)=>({id:'p_'+String(i+2).padStart(18,'0'),title:i?'另一个具有很长名称的FDE客户部署工程和验收项目':'项目 B',sources:[],evidence:[],claims:[],links:[]}))];m.removed=[];
window.fetch=async function(url,opts={}){
 const k=String(url).split('/api/workspace/')[1]||'';window.calls.push(k);let payload={};let body=opts.body?JSON.parse(opts.body):{};
 if(k==='bootstrap')payload={projects:m.projects.map(({id,title})=>({id,title})),providers:m.providers,settings:m.settings};
 else if(k.startsWith('project?id='))payload={project:m.projects.find(p=>p.id===decodeURIComponent(k.split('=')[1]))};
 else if(k==='source/impact'){const s=m.project.sources.find(s=>s.id===body.sourceId);payload={impact:{name:s.name,evidence:2,claims:2,links:1,token:'test-token'}};}
 else if(k==='source/archive'){m.project.sources.find(s=>s.id===body.sourceId).archivedAt='2026-11-23T00:00:00Z';payload={source:m.project.sources.find(s=>s.id===body.sourceId)};}
 else if(k==='source/restore'){delete m.project.sources.find(s=>s.id===body.sourceId).archivedAt;payload={};}
 else if(k==='project/remove'){m.removed.push(body.projectId);m.projects=m.projects.filter(p=>p.id!==body.projectId);payload={removed:true};}
 else if(k.startsWith('export?id='))payload={project:m.projects.find(p=>p.id===decodeURIComponent(k.split('=')[1]))};
 else if(k==='gesture/preferences'&&opts.method!=='POST')payload={preferences:m.gesturePrefs||(m.gesturePrefs={horizontal:1,vertical:1.5,zoom:1,pointer:1.05,smoothing:.36,holdMs:520,hitRadius:56,invertX:false,invertY:false})};
 else if(k==='update/status')payload={update:{status:'idle',version:'1.5.0'},preferences:m.prefs};
 else if(k==='update/check')payload={update:{status:'ready',version:'1.6.0',available:true,notes:'改善更新、卸载与3D效果',url:'https://github.com/yjn66627/AI-Commitment-StarMap/releases/tag/v1.6.0'}};
 else if(k==='update/open')payload={opened:true};
 else if(k==='gesture/preferences'){m.gesturePrefs=body;payload={preferences:m.gesturePrefs};}
 else if(k==='update/preferences'){m.prefs={autoCheck:body.autoCheck};payload={preferences:m.prefs};}
 else if(String(url)==='/app/gesture/status.json')payload={ready:false,source:'bundled-local-only'};
 else if(k==='link/add'){m.project.links.push({...body,id:'ln_000000000000000999',review:'pending'});payload={link:m.project.links.at(-1)};}
 else payload={error:'MOCK_UNIMPLEMENTED'};
 return new Response(JSON.stringify(payload),{status:payload.error?404:200,headers:{'content-type':'application/json'}});
}
'''

with sync_playwright() as pl:
 browser=pl.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 for w,h in [(1366,768),(1600,900)]:
  page=browser.new_page(viewport={'width':w,'height':h});errors=[];page.set_default_timeout(5000);page.on('pageerror',lambda e:errors.append(str(e)));page.set_content(html);page.evaluate(mock);page.add_script_tag(content=graph+'\n'+math+'\n'+"const loadLocalHandLandmarker=async()=>{throw Error('MODEL_NOT_PACKAGED')};"+'\n'+guide+'\n'+gesture+'\n'+app)
  page.wait_for_function("document.querySelectorAll('.project-row').length===3");page.locator('nav button[data-page=sources]').click();row=page.locator('.material-row').nth(1);row.locator('.item').click(button='right');page.locator('.project-context').get_by_role('menuitem',name='删除材料').click();d=page.locator('.project-delete-dialog');d.wait_for(state='visible');assert '关联证据 2 条' in d.inner_text();page.screenshot(path=str(out/f'材料删除_{w}x{h}.png'));d.get_by_role('button',name='取消').click();assert not page.evaluate("mock.project.sources[1].archivedAt")
  row.locator('.project-more').click();page.locator('.project-context').get_by_role('menuitem',name='删除材料').click();d.get_by_role('button',name='删除（移入历史）').click();page.wait_for_function("!!project.sources[1].archivedAt && document.querySelectorAll('.material-archive .material-row').length===1");page.locator('.material-archive summary').click();page.locator('.material-archive .project-more').scroll_into_view_if_needed();page.wait_for_timeout(150);page.locator('.material-archive .project-more').click();page.locator('.project-context').get_by_role('menuitem',name='恢复材料').click();page.wait_for_function("!project.sources[1].archivedAt && !document.querySelector('.material-archive')");assert not errors,errors;page.close();print(w,h,'material menu cancel archive restore PASS')
 browser.close()
