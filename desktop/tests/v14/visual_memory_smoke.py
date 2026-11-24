"""Chromium-only UI check with mocked HTTP fetch. Node actual HTTP workflows tested separately.
Run: python tests/v14/visual_memory_smoke.py [evidence-dir]
The browser sandbox denies navigation to local HTTP; this test intentionally loads the exact app files in memory.
"""
import sys,json
from pathlib import Path
from playwright.sync_api import sync_playwright

root=Path(__file__).resolve().parents[2] / 'runtime' / 'workspace-ui'
evidence=Path(sys.argv[1]) if len(sys.argv)>1 else Path('/mnt/data/_build_v14/v14_visual')
evidence.mkdir(parents=True,exist_ok=True)
html=(root/'index.html').read_text(encoding='utf-8')
css=(root/'app.css').read_text(encoding='utf-8')
html=html.replace('<link rel="stylesheet" href="/app/app.css">','<style>'+css+'</style>').replace('<script type="module" src="/app/app.js"></script>','')
graph=(root/'graph.js').read_text(encoding='utf-8').replace('export function','function').replace('export const','const').replace('export class','class')
app=(root/'app.js').read_text(encoding='utf-8').replace("import {GraphView,graphState,matchesState} from './graph.js';",'')
mock=r"""
window.mock={counter:0,settings:{selected:'deepseek',profiles:{}},providers:[{id:'deepseek',name:'DeepSeek',model:'deepseek-chat',base:'https://api.deepseek.com',local:false},{id:'openai',name:'OpenAI / GPT',model:'gpt-4o-mini',base:'https://api.openai.com/v1',local:false},{id:'claude',name:'Anthropic',model:'claude-sonnet-4-5',base:'https://api.anthropic.com',local:false}],project:{id:'p_aaaaaaaaaaaaaaaaaa',title:'交付质量跟踪',sources:[],evidence:[],claims:[],links:[]}};
window.fetch=async function(url,option={}){
 const k=String(url).split('/api/workspace/')[1]||'';
 let body={}, status=200, form=option.body?JSON.parse(option.body):{};
 const obj=window.mock, p=obj.project; const gen=(kind)=>kind+'_'+String(++obj.counter).padStart(18,'a');
 if(k==='bootstrap')body={projects:[{id:p.id,title:p.title}],providers:obj.providers,settings:obj.settings};
 else if(k.startsWith('project?id='))body={project:p};
 else if(k==='source/add'){let s={id:gen('src'),name:form.name,content:form.content};p.sources.push(s);body={source:s};}
 else if(k==='evidence/add'){let s=p.sources.find(x=>x.id===form.sourceId);if(!s||!s.content.includes(form.quote)){status=400;body={error:'QUOTE_NOT_IN_SOURCE'};}else{let e={id:gen('ev'),sourceId:s.id,quote:form.quote};p.evidence.push(e);body={evidence:e};}}
 else if(k==='claim/add'){let c={id:gen('cl'),kind:form.kind,text:form.text,evidenceIds:form.evidenceIds,origin:'manual',review:'pending'};p.claims.push(c);body={claim:c};}
 else if(k==='claim/review'){let c=p.claims.find(x=>x.id===form.claimId);c.review=form.decision;body={claim:c};}
 else if(k==='settings/save'){obj.settings.selected=form.provider;obj.settings.profiles[form.provider]={model:form.model,endpoint:form.endpoint,hasKey:!!form.apiKey};body={settings:obj.settings};}
 else if(k==='settings/delete-key'){obj.settings.profiles[form.provider].hasKey=false;body={settings:obj.settings};}
 else if(k==='ai/analyze'){let c={id:gen('cl'),kind:'risk',text:'AI建议核查后续交付证据',evidenceIds:[p.evidence[0].id],origin:'ai',provider:'openai',review:'pending',rationale:'建议人工查证'};p.claims.push(c);body={added:1,ids:[c.id]};}
 else if(k.startsWith('export?id=')){body={schemaVersion:'starmap-workspace-1',project:p};}
 else body={error:'NOT_FOUND'},status=404;
 return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
}
"""
result={}
with sync_playwright() as pl:
 browser=pl.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 page=browser.new_page(viewport={'width':1600,'height':900},device_scale_factor=1)
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.set_content(html,wait_until='load')
 page.evaluate(mock)
 page.add_script_tag(content=graph+'\n'+app)
 page.wait_for_timeout(350)
 assert page.locator('#page-title').inner_text()=='审计工作台'
 page.screenshot(path=str(evidence/'V1.4_本地工作台_Chromium内存渲染.png'))
 result['home']='PASS'
 # Manual source ingestion
 page.locator('nav button[data-page="sources"]').click()
 page.locator('#source-form input[name="name"]').fill('演示项目周会纪要')
 page.locator('#source-form textarea[name="content"]').fill('王工承诺在周五交付交互原型。风险是目前测试日志尚未补全。')
 page.locator('#source-form button.primary').click()
 page.locator('#source-list .item').first.wait_for(timeout=3000)
 assert '演示项目周会纪要' in page.locator('#source-list .item').first.inner_text()
 result['source_ingest']='PASS'
 # Exact provenance rejection and acceptance
 page.locator('nav button[data-page="evidence"]').click()
 page.locator('#evidence-form textarea[name="quote"]').fill('原文中不存在的句子')
 page.locator('#evidence-form button.primary').click()
 page.wait_for_timeout(100)
 assert '引用片段必须与原文完全一致' in page.locator('#message').inner_text()
 page.locator('#evidence-form textarea[name="quote"]').fill('王工承诺在周五交付交互原型')
 page.locator('#evidence-form button.primary').click()
 page.locator('#evidence-list .item').first.wait_for(timeout=3000)
 result['source_binding']='PASS'
 page.locator('nav button[data-page="claims"]').click()
 page.locator('#claim-form textarea[name="text"]').fill('王工承诺周五交付交互原型')
 page.locator('#claim-evidence option').first.evaluate('(el) => el.selected = true')
 page.locator('#claim-form button.primary').click()
 page.locator('.claim-card').first.wait_for(timeout=3000)
 assert '待人工复核' in page.locator('.claim-card').first.inner_text()
 page.locator('.claim-card .claim-actions button').first.click()
 page.locator('.claim-card.confirmed').first.wait_for(timeout=3000)
 assert '已人工确认' in page.locator('.claim-card').first.inner_text()
 result['human_review']='PASS'
 # 3D / 2D canvas
 page.locator('nav button[data-page="graph"]').click();page.wait_for_timeout(300)
 assert page.locator('#workspace-graph').evaluate('(el)=>el.width')>200
 page.screenshot(path=str(evidence/'V1.4_真实项目3D图谱_Chromium内存渲染.png'))
 page.locator('#view-2d').click();page.wait_for_timeout(130)
 assert 'active' in page.locator('#view-2d').get_attribute('class')
 page.screenshot(path=str(evidence/'V1.4_真实项目2D图谱_Chromium内存渲染.png'))
 page.locator('#view-3d').click();page.locator('#reset-camera').click()
 result['graph_3d_2d']='PASS'
 # Provider selection and UI persistence stub
 page.locator('nav button[data-page="settings"]').click()
 page.locator('#provider-select').select_option('openai')
 page.locator('#api-key').fill('placeholder-not-real-key')
 page.locator('#settings-form button.primary').click()
 page.wait_for_timeout(100)
 assert 'AI已配置' in page.locator('#ai-state').inner_text()
 page.screenshot(path=str(evidence/'V1.4_多模型设置_Chromium内存渲染.png'))
 result['provider_settings_ui']='PASS'
 page.locator('#analyze-project').click()
 page.wait_for_timeout(160)
 assert 'AI待复核建议' in page.locator('#message').inner_text()
 assert page.locator('.claim-card').count()==2
 result['ai_pending_review_ui']='PASS'
 assert not errors,errors
 result['page_script_errors']=errors
 browser.close()
(evidence/'V1.4_Chromium内存渲染测试报告.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(result,ensure_ascii=False,indent=2))
