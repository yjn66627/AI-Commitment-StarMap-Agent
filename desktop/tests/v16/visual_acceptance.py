"""V1.6 gesture UI smoke: Chromium in-memory rendering, no loopback navigation.
The actual Electron/Windows native installer still requires Windows acceptance.
"""
from pathlib import Path
import sys,json,hashlib
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[2]/'runtime'/'workspace-ui'
out=Path(sys.argv[1]) if len(sys.argv)>1 else Path('/mnt/data/_v15_visual')
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
window.fetch=async function(url,opts={}){
 const k=String(url).split('/api/workspace/')[1]||'';window.calls.push(k);let payload={};let body=opts.body?JSON.parse(opts.body):{};
 if(k==='bootstrap')payload={projects:[{id:m.project.id,title:m.project.title}],providers:m.providers,settings:m.settings};
 else if(k.startsWith('project?id='))payload={project:m.project};
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
results={}
with sync_playwright() as pl:
 browser=pl.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 for width,height in [(1600,900),(1366,768)]:
  page=browser.new_page(viewport={'width':width,'height':height},device_scale_factor=1)
  errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.set_content(html,wait_until='load');page.evaluate(mock);page.add_script_tag(content=graph+'\n'+math+'\n'+"const loadLocalHandLandmarker=async()=>{throw Error('MODEL_NOT_PACKAGED')};"+'\n'+guide+'\n'+gesture+'\n'+app);page.wait_for_timeout(320)
  page.locator('nav button[data-page="graph"]').click();page.wait_for_timeout(300)
  assert page.locator('#workspace-graph').evaluate('(el)=>el.width')>200
  before=page.locator('#workspace-graph').evaluate('(el)=>el.toDataURL()')
  assert page.locator('#gesture-toggle').is_visible()
  assert page.locator('#gesture-toggle').get_attribute('aria-pressed')=='false'
  page.locator('#gesture-toggle').click();page.wait_for_timeout(120)
  assert '模型未就绪' in page.locator('#gesture-status').inner_text(),page.locator('#gesture-status').inner_text()
  assert page.locator('#gesture-toggle').get_attribute('aria-pressed')=='false'
  assert page.locator('#gesture-video').is_hidden()
  # V1.6-R2 tutorial and settings are visible, and local persistence works.
  page.locator('#gesture-guide').click();assert page.locator('.gesture-guide-dialog').is_visible()
  rectGuide=page.locator('.gesture-guide-dialog').bounding_box()
  assert rectGuide['x']>=0 and rectGuide['y']>=0 and rectGuide['x']+rectGuide['width']<=width+1 and rectGuide['y']+rectGuide['height']<=height+1
  page.screenshot(path=str(out/f'V1.6-R2_手势教学_{width}x{height}.png'))
  assert '左右旋转' in page.locator('.guide-name').inner_text()
  page.locator('.guide-next').click();assert '上下旋转' in page.locator('.guide-name').inner_text()
  page.locator('[data-guide-tab="settings"]').click()
  page.locator('.guide-slider input[data-setting="vertical"]').fill('2.4')
  page.locator('.guide-save').click();page.wait_for_timeout(120)
  assert page.evaluate('window.mock.gesturePrefs.vertical')==2.4
  assert page.evaluate('gestures.interpreter.settings.vertical')==2.4
  page.screenshot(path=str(out/f'V1.6-R2_灵敏度设置_{width}x{height}.png'))
  page.locator('[data-guide-tab="lesson"]').click();page.locator('.guide-close').click()
  page.locator('#gesture-settings').click();assert page.locator('.guide-sliders').is_visible()
  page.locator('.guide-close').click()
  # In-memory renderer, no real camera or cloud call.
  # Simulated device/recognizer integration, NOT a real webcam test.
  state=page.evaluate('''async()=>{
     let calls=0,closed=0;const prior=window.fetch;
     window.fetch=async(url,...args)=>String(url)==='/app/gesture/status.json'
         ?new Response(JSON.stringify({ready:true,source:'bundled-local-only'}),{status:200})
         :prior(url,...args);
     gestures.loadDetector=async()=>({close:()=>{closed++},detectForVideo:()=>({landmarks:[]})});
     gestures.getMedia=async(options)=>{calls++;if(options.audio!==false)throw Error('MICROPHONE_REQUESTED');return new MediaStream();};
     gestures.video.play=async()=>{};
     await gestures.start();
     return {calls,active:gestures.active,status:document.getElementById('gesture-status').textContent};
   }''')
  assert state['calls']==1 and state['active'] and '摄像头运行中' in state['status'],state
  assert page.locator('#gesture-toggle').get_attribute('aria-pressed')=='true'
  page.locator('#gesture-toggle').click();page.wait_for_timeout(50)
  assert page.locator('#gesture-toggle').get_attribute('aria-pressed')=='false'
  assert page.locator('#gesture-video').is_hidden()

  # Synthetic hand landmarks drive the real gesture interpreter and original graph camera.
  yaw=page.evaluate('graph.yaw')
  page.evaluate('graph.rotateByGesture(.045,.012)')
  assert page.evaluate('graph.yaw')!=yaw
  zoom=page.evaluate('graph.zoom')
  page.evaluate('graph.zoomByGesture(1.12)')
  assert page.evaluate('graph.zoom')>zoom
  page.locator('#reset-camera').click()

  # Virtual cursor: hover must not change inspector; pinch selects exact pre-highlighted target.
  hover=page.evaluate('''()=>{const h=graph.hit.find(x=>x.node.type==='evidence');return {x:h.x/graph.w,y:h.y/graph.h,id:h.node.id}}''')
  page.evaluate('(p)=>gestures.moveCursor({type:"aim",x:p.x,y:p.y})',hover)
  assert page.locator('#gesture-cursor').is_visible()
  assert page.locator('#gesture-cursor').get_attribute('aria-label').startswith('瞄准：')
  assert page.evaluate('graph.gestureHover')==hover['id']
  page.screenshot(path=str(out/f'V1.6-R2_3D光标预高亮_{width}x{height}.png'))
  # Switch from A to B using the visible pointer/preview/selection pathway.
  switch=page.evaluate('''()=>{
    const available=graph.hit.filter(h=>h.node.type==='evidence');
    const a=available[0],b=available.find(h=>h.node.id!==a.node.id);
    gestures.moveCursor({x:a.x/graph.w,y:a.y/graph.h});
    const aPreview=graph.gestureHover;graph.selectByGesture(a.x/graph.w,a.y/graph.h);
    gestures.moveCursor({x:b.x/graph.w,y:b.y/graph.h});
    const bPreview=graph.gestureHover;graph.selectByGesture(b.x/graph.w,b.y/graph.h);
    return {a:a.node.id,b:b.node.id,aPreview,bPreview,selected:graph.selected};
  }''')
  assert switch['a']!=switch['b'] and switch['aPreview']==switch['a'] and switch['bPreview']==switch['b'] and switch['selected']==switch['b'],switch
  assert '可定位证据' in page.locator('#graph-detail').inner_text()
  page.evaluate('gestures.clearAim()');assert page.locator('#gesture-cursor').is_hidden()
  page.screenshot(path=str(out/f'V1.6_真实项目3D星图_{width}x{height}.png'))
  page.locator('[data-graph-filter="source"]').uncheck();page.wait_for_timeout(100)
  after=page.locator('#workspace-graph').evaluate('(el)=>el.toDataURL()');assert before!=after,'Source visibility filter had no visual effect'
  page.locator('[data-graph-filter="source"]').check()
  coords=page.evaluate('(()=>{let p=graph.hit.find(h=>h.node.type==="evidence");return {x:p.x,y:p.y}})()')
  rect=page.locator('#workspace-graph').bounding_box()
  page.mouse.click(rect['x']+coords['x'],rect['y']+coords['y'])
  assert '可定位证据' in page.locator('#graph-detail').inner_text()
  # Hand-only graph hit testing uses same evidence detail as mouse.
  page.evaluate('(()=>{const hit=graph.hit.find(h=>h.node.type==="evidence");graph.selectByGesture(hit.x/graph.w,hit.y/graph.h)})()')
  assert '可定位证据' in page.locator('#graph-detail').inner_text()

  page.mouse.move(rect['x']+rect['width']/2,rect['y']+rect['height']/2)
  yaw0=page.evaluate('graph.yaw');page.mouse.down();page.mouse.move(rect['x']+rect['width']/2+140,rect['y']+rect['height']/2+35,steps=6);page.mouse.up();assert page.evaluate('graph.yaw')!=yaw0
  zoom0=page.evaluate('graph.zoom');page.mouse.wheel(0,-450);assert page.evaluate('graph.zoom')>zoom0
  page.locator('#reset-camera').click();assert abs(page.evaluate('graph.zoom')-1)<1e-8
  page.locator('#view-2d').click();assert page.evaluate('graph.mode')=='2d';assert page.locator('#gesture-toggle').is_visible();page.screenshot(path=str(out/f'V1.6_真实项目2D星图_{width}x{height}.png'))
  page.locator('#view-3d').click();assert page.evaluate('graph.mode')=='3d'
  # Test v1.4 Windows relationship form repair: real HTML name fields survive FormData.
  page.locator('nav button[data-page="claims"]').click()
  page.locator('#link-from').select_option('cl_000000000000000001')
  page.locator('#link-to').select_option('cl_000000000000000002')
  page.locator('#link-evidence option').first.evaluate('(e)=>e.selected=true')
  page.locator('#link-form button').click();page.wait_for_timeout(80)
  assert 'link/add' in page.evaluate('window.calls')
  # Test manual version checker, trusted release link, and optional auto-check preference.
  page.locator('nav button[data-page="updates"]').click()
  assert page.locator('#update-status').inner_text()=='尚未检查更新'
  page.locator('#check-update').click();page.wait_for_timeout(100)
  assert '1.6.0' in page.locator('#update-status').inner_text()
  assert page.locator('#open-release').is_enabled()
  page.locator('#auto-check-updates').check();page.wait_for_timeout(60)
  assert page.evaluate('window.mock.prefs.autoCheck')==True
  page.screenshot(path=str(out/f'V1.6_软件更新设置_{width}x{height}.png'))
  assert not errors,errors
  results[f'{width}x{height}']={'gesture_tutorial':'PASS','gesture_prefs_save':'PASS','gesture_cursor_preview':'PASS','graph3d':'PASS','graph2d':'PASS','filter':'PASS','node_inspection':'PASS','synthetic_camera_lifecycle':'PASS','gesture_missing_asset_fallback':'PASS','synthetic_gesture_rotation_zoom_select':'PASS','rotation':'PASS','zoom_reset':'PASS','relationship_form':'PASS','update_check':'PASS','update_preference':'PASS','page_errors':errors}
  page.close()
 browser.close()
(out/'V1.6_Chromium交互验收.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
print(json.dumps(results,ensure_ascii=False,indent=2))
