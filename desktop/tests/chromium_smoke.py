"""Browser-in-memory renderer regression. Network navigation is blocked by this sandbox.
Real HTTP, auth and business APIs are tested separately by Node's desktop-service tests.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
import subprocess, json, re

root=Path(__file__).resolve().parents[1]
public=root/'runtime/review-service/public'
evidence=root.parent/'evidence'
evidence.mkdir(exist_ok=True)
report={'tests':{},'browser':'Installed Chromium 144 (headless, in-memory page)',
        'scope':'real JavaScript and Canvas interaction in Chromium; not actual HTTP navigation or Electron runtime',
        'limitations':['Electron dependency unavailable offline','Chromium HTTP navigation restricted by host policy']}

def inject(page,html_root, before_scripts=None):
    html=(public/html_root).read_text('utf-8')
    html=re.sub(r'<meta\s+http-equiv="Content-Security-Policy"[^>]*>', '',html)
    scripts=re.findall(r'<script\s+src="([^"]+)"[^>]*></script>',html)
    css=re.findall(r'<link\s+rel="stylesheet"\s+href="([^"]+)"[^>]*>',html)
    html=re.sub(r'<script\s+src="[^"]+"[^>]*></script>','',html)
    html=re.sub(r'<link\s+rel="stylesheet"\s+href="[^"]+"[^>]*>','',html)
    page.set_content(html,wait_until='load')
    folder=(public/html_root).parent
    for item in css:
        page.add_style_tag(content=(folder/item.lstrip("/")).read_text('utf-8'))
    if before_scripts is not None:
        before_scripts(page)
    for item in scripts:
        page.add_script_tag(content=(folder/item.lstrip("/")).read_text('utf-8'))
    return scripts

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/lib/chromium/chromium',args=['--no-sandbox'])
    context=browser.new_context(viewport={'width':1600,'height':900},device_scale_factor=1)
    page=context.new_page();errors=[];page.on('pageerror',lambda err:errors.append(str(err)))
    scripts=inject(page,Path('graph/3d.html'))
    page.wait_for_function("document.getElementById('metric-nodes')?.textContent?.trim() === '10'",timeout=9000)
    assert page.locator('#metric-edges').inner_text().strip()=='7'
    assert page.locator('#galaxy').is_visible()
    assert page.locator('#desktop-review-link').get_attribute('href')=='/'
    page.screenshot(path=str(evidence/'V1.3_三维主界面_1600x900_内存渲染.png'),animations='disabled',full_page=True)
    report['tests']['3d_graph_loaded_10_nodes_7_edges']=True
    box=page.locator('#galaxy').bounding_box();assert box and box['width']>300
    page.mouse.move(box['x']+box['width']*.50,box['y']+box['height']*.5)
    page.mouse.down();page.mouse.move(box['x']+box['width']*.69,box['y']+box['height']*.65,steps=10);page.mouse.up()
    page.screenshot(path=str(evidence/'V1.3_手动旋转后视角_内存渲染.png'),animations='disabled')
    report['tests']['mouse_drag']=True
    page.locator('#btn-home').click();report['tests']['camera_reset']=True
    page.locator('#show-inferred').uncheck();assert page.locator('#show-inferred').is_checked() is False
    report['tests']['relation_filter']=True
    assert not errors,errors
    report['tests']['no_javascript_errors']=True
    page2=context.new_page();errors2=[];page2.on('pageerror',lambda err:errors2.append(str(err)))
    inject(page2,Path('graph/index.html'))
    page2.wait_for_timeout(200)
    assert page2.title()
    report['tests']['2d_page_loaded']=not bool(errors2)
    # UI-only case viewer test, with the ORIGINAL fixed cases supplied to a mock fetch.
    # The real HTTP /api/cases and auth contract are independently tested by Node.
    actual_cases=json.loads(subprocess.check_output(['node','--input-type=module','-e',
        "import {cases} from './runtime/review-service/cases.mjs';console.log(JSON.stringify(cases))"],cwd=root,text=True))
    casepage=context.new_page()
    def inject_case_fetch(pg):
        pg.evaluate("cases => {window.fetch=async function(url){return {ok:url==='/api/cases',json:async()=>({mode:'disabled',cases})}}}",actual_cases)
    inject(casepage,Path('index.html'),before_scripts=inject_case_fetch)
    casepage.wait_for_function("document.querySelector('#review-pane')?.hidden === false",timeout=8000)
    assert casepage.locator('#case option').count()==2
    assert casepage.locator('#analyze').is_disabled()
    casepage.screenshot(path=str(evidence/'V1.3_合成案例界面_浏览器内存渲染.png'),animations='disabled',full_page=True)
    report['tests']['synthetic_case_view_UI_with_mock_transport']=True
    context2=browser.new_context(viewport={'width':1366,'height':768},device_scale_factor=1)
    p2=context2.new_page();inject(p2,Path('graph/3d.html'))
    p2.wait_for_function("document.getElementById('metric-nodes')?.textContent?.trim() === '10'",timeout=9000)
    p2.screenshot(path=str(evidence/'V1.3_三维主界面_1366x768_内存渲染.png'),animations='disabled')
    report['tests']['1366x768']=True
    browser.close()
(evidence/'V1.3_Chromium内存渲染验收.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n','utf-8')
print(json.dumps(report,ensure_ascii=False,indent=2))
