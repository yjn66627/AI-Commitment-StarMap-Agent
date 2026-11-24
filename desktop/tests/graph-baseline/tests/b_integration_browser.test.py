"""Stage B actual Chromium in-memory test. file://, HTTP, CSP and Windows remain NOT_VERIFIED."""
import asyncio, json, pathlib, re, platform, sys, traceback
from playwright.async_api import async_playwright
ROOT=pathlib.Path(__file__).resolve().parent.parent
RESULTS=[];ERRORS=[]

def check(x,why):
    if not x:raise AssertionError(why)
async def run(name,cb):
    try:
        await cb();RESULTS.append({'id':name,'status':'PASS'});print('PASS',name,flush=True)
    except Exception as err:
        RESULTS.append({'id':name,'status':'FAIL','detail':str(err)[:450]});ERRORS.append((name,traceback.format_exc()));print('FAIL',name,str(err)[:450],flush=True)
async def setup(page):
    html=(ROOT/'index.html').read_text()
    assets=re.findall(r'<script src="([^"]+)"></script>',html)
    check('src/competition-flow.js' in assets,'B integration entry missing')
    html=re.sub(r'<meta http-equiv="Content-Security-Policy"[^>]*>','',html)
    html=re.sub(r'<link rel="stylesheet"[^>]*>','',html)
    html=re.sub(r'\s*<script src="[^"]+"></script>','',html)
    await page.set_content(html,wait_until='load')
    await page.add_style_tag(content=(ROOT/'src/styles.css').read_text())
    for rel in assets:
        await page.add_script_tag(content=(ROOT/rel).read_text())
    await page.wait_for_timeout(180)
async def click_node(page,node_id):
    await page.locator('#graph').scroll_into_view_if_needed()
    # Allow browser scroll event + Cytoscape resize hit-test cache to settle.
    await page.wait_for_timeout(110)
    p=await page.evaluate("""id=>{let cy=__constellationApp.cy,n=cy.getElementById(id),p=n.renderedPosition(),r=document.getElementById('graph').getBoundingClientRect();return {x:r.left+p.x,y:r.top+p.y};}""",node_id)
    await page.mouse.click(p['x'],p['y']);await page.wait_for_timeout(90)
async def main():
    async with async_playwright() as p:
        browser=await p.chromium.launch(headless=True,executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe',args=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'])
        page=await browser.new_page(viewport={'width':1440,'height':900},device_scale_factor=1)
        page_errors=[];requests=[]
        page.on('pageerror',lambda err:page_errors.append(str(err)))
        page.on('request',lambda r:requests.append(r.url))
        await setup(page)
        report=json.loads((ROOT/'fixtures/competition-synthetic-report.json').read_text())
        async def initial():
            x=await page.evaluate("({mode:window.B_STAGE_MODE,exists:!!window.ConstellationIntegration,n:__constellationApp.cy.nodes().length,e:__constellationApp.cy.edges().length,version:window.cytoscape.version})")
            check(x=={'mode':True,'exists':True,'n':10,'e':7,'version':'3.33.1'},str(x))
        await run('CB01_real_chromium_adapter_boot_and_canvas',initial)
        async def chain():
            txt=await page.locator('#pipeline-state').inner_text()
            check('合成报告输入' in txt and '跨引用与复核校验' in txt and '图谱展示' in txt,txt)
            check('验证通过' in await page.locator('#validation-banner').inner_text(),'validation banner missing')
        await run('CB02_report_adapter_graph_render_chain',chain)
        async def synthesis():
            txt=await page.locator('body').inner_text()
            for s in ['合成数据演示','非真实AI分析结果','未接入V2.0','待人工复核']:
                check(s in txt,'missing mandatory warning '+s)
        await run('CB03_Chinese_fiction_and_scope_notice',synthesis)
        async def clicks():
            await click_node(page,'C_A');txt=await page.locator('#inspector').inner_text()
            check('EV_MEET' in txt and 'REV_C_A' in txt and '目标对象：节点 · C_A' in txt,txt[:450])
        await run('CB04_real_mouse_commitment_and_bound_review_drawer',clicks)
        await page.screenshot(path=str(ROOT/'evidence/B_COMPETITION_CHINESE_REVIEW_PANEL.png'),full_page=True)
        async def source():
            await click_node(page,'N_EV_EMAIL');txt=await page.locator('#inspector').inner_text()
            check('EV_EMAIL' in txt and 'SRC_EMAIL' in txt,'missing evidence mapping')
            check('EV_MEET' not in txt,'cross-evidence leakage')
        await run('CB05_source_and_evidence_drawer',source)
        async def inference():
            await page.evaluate("() => {__constellationApp.cy.getElementById('REL_RISK_A').emit('tap');return true;}")
            txt=await page.locator('#inspector').inner_text()
            check('模拟推断' in txt and '待人工复核' in txt,'inference incorrectly shown')
            edge=await page.evaluate("__constellationApp.cy.getElementById('REL_RISK_A').data('assertionKind')")
            check(edge=='ai_inference','inference upgraded')
        await run('CB06_relation_inference_and_pending_review',inference)
        async def controls():
            await page.locator('#edge-inference').uncheck()
            visible=await page.evaluate("__constellationApp.cy.getElementById('REL_RISK_A').visible()")
            check(not visible,'inference filter failed')
            await page.locator('#edge-inference').check()
            await page.locator('[data-node-type="risk"]').uncheck()
            check(not await page.evaluate("__constellationApp.cy.getElementById('R_A').visible()"),'risk type filter failed')
            await page.locator('[data-node-type="risk"]').check()
            await page.locator('#search-nodes').fill('承诺A')
            ids=await page.evaluate("__constellationApp.cy.nodes().filter(n=>n.visible()).map(n=>n.id())")
            check(ids==['C_A'],str(ids));await page.locator('#search-nodes').fill('')
        await run('CB07_node_edge_and_text_filters',controls)
        async def zoom():
            before=await page.evaluate('__constellationApp.cy.zoom()')
            await page.locator('#btn-zoom-in').click()
            after=await page.evaluate('__constellationApp.cy.zoom()')
            check(after>before,'zoom failed')
            await page.locator('#btn-reset-layout').click()
            check(await page.evaluate('__constellationApp.cy.nodes().length')==10,'reset removed nodes')
        await run('CB08_zoom_and_reset_layout',zoom)
        async def upload():
            await page.locator('#file-input').set_input_files(str(ROOT/'fixtures/competition-synthetic-report.json'))
            await page.wait_for_timeout(150)
            check('已完成' in await page.locator('#pipeline-state').inner_text(),'import failed')
            check(await page.evaluate('__constellationApp.cy.edges().length')==7,'import edge count wrong')
        await run('CB09_real_browser_file_upload_valid_report',upload)
        async def invalid_unknown():
            d=json.loads(json.dumps(report));d['v2_report_extra']='unmapped'
            ok=await page.evaluate('data=>ConstellationIntegration.loadReport(data)',d)
            check(ok is False,'unknown field accepted')
            check(await page.locator('#graph-empty').is_visible(),'old graph still visible after failure')
            check('合成报告被拒绝' in await page.locator('#validation-banner').inner_text(),'missing localized failure')
            await page.locator('#btn-load-demo').click()
        await run('CB10_unknown_V2_field_safe_failure_no_render',invalid_unknown)
        async def invalid_source():
            d=json.loads(json.dumps(report));d['evidence_records'][0]['document_key']='MISSING'
            ok=await page.evaluate('data=>ConstellationIntegration.loadReport(data)',d)
            check(ok is False,'missing source accepted')
            check(await page.locator('#graph-empty').is_visible(),'graph not cleared')
            await page.locator('#btn-load-demo').click()
        await run('CB11_missing_evidence_source_rejected_before_render',invalid_source)
        async def invalid_review():
            d=json.loads(json.dumps(report));d['reviews'][0]['target']['key']='C_B'
            ok=await page.evaluate('data=>ConstellationIntegration.loadReport(data)',d)
            check(ok is False,'cross-target review accepted')
            check(await page.locator('#graph-empty').is_visible(),'graph not cleared')
            await page.locator('#btn-load-demo').click()
        await run('CB12_cross_object_review_rejected_in_browser',invalid_review)
        async def injection():
            d=json.loads(json.dumps(report));d['evidence_records'][0]['quotation']='<img src=x onerror=alert(1)>'
            ok=await page.evaluate('data=>ConstellationIntegration.loadReport(data)',d)
            check(ok is False,'unsafe HTML accepted')
            check(await page.locator('#graph-empty').is_visible(),'unsafe graph visible')
            check(await page.locator('#inspector img, #inspector iframe, #inspector script').count()==0,'DOM injected')
            await page.locator('#btn-load-demo').click()
        await run('CB13_malicious_markup_refused_no_html_execution',injection)
        async def harmless_markup_plain_text():
            d=json.loads(json.dumps(report));d['evidence_records'][0]['quotation']='【纯合成】<b>仅为普通文本</b>'
            ok=await page.evaluate('data=>ConstellationIntegration.loadReport(data)',d)
            check(ok is True,'safe markup-like text invalid')
            await click_node(page,'C_A')
            inspector=page.locator('#inspector')
            check('<b>仅为普通文本</b>' in await inspector.inner_text(),'literal tag was not preserved')
            check(await page.locator('#inspector b').count()==0,'markup became DOM')
            await page.locator('#btn-load-demo').click()
        await run('CB14_untrusted_evidence_rendered_as_text_not_html',harmless_markup_plain_text)
        async def rejected_relation_not_drawn():
            d=json.loads(json.dumps(report))
            d['reviews'].append({'key':'REV_EDGE','reviewer_key':'P_B','target':{'kind':'relation','key':'REL_ASSIGN_A'},'decision':'reject','recorded_at':'2026-11-08T10:03:00Z','remark':'【纯合成】驳回此关系。'})
            d['relationships'][0]['assessment'].update({'review_state':'rejected','review_key':'REV_EDGE'})
            ok=await page.evaluate('data=>ConstellationIntegration.loadReport(data)',d)
            check(ok is True,'valid rejected fixture not accepted')
            ids=await page.evaluate('__constellationApp.cy.edges().map(e=>e.id())')
            check('REL_ASSIGN_A' not in ids,'rejected edge rendered')
            await page.locator('#btn-load-demo').click()
        await run('CB15_rejected_edge_is_not_rendered',rejected_relation_not_drawn)
        async def browser_isolated():check(len(requests)==0,'unexpected network requests: '+str(requests[:3]))
        await run('CB16_zero_network_requests',browser_isolated)
        async def no_exceptions():check(not page_errors,'console page errors '+str(page_errors[:3]))
        await run('CB17_no_uncaught_js_exceptions',no_exceptions)
        async def desk_1366():
            await page.set_viewport_size({'width':1366,'height':900});await page.wait_for_timeout(210)
            dims=await page.evaluate("({w:document.documentElement.scrollWidth,v:innerWidth,canvases:document.querySelectorAll('#graph canvas').length})")
            check(dims['w']<=dims['v']+2 and dims['canvases']>=1,str(dims))
            visible=await page.evaluate("""() => {const cy=__constellationApp.cy,r=document.getElementById('graph').getBoundingClientRect();return cy.nodes().filter(n=>n.visible()).map(n=>({id:n.id(),x:n.renderedPosition().x,y:n.renderedPosition().y,w:r.width,h:r.height}));}""")
            for n in visible:check(15<n['x']<n['w']-15 and 15<n['y']<n['h']-15,'clipped '+str(n))
            await page.screenshot(path=str(ROOT/'evidence/B_COMPETITION_CHINESE_DESKTOP_1366.png'),full_page=True)
        await run('CB18_1366_Chinese_layout_no_overflow',desk_1366)
        async def mobile():
            pg=await browser.new_page(viewport={'width':390,'height':844},device_scale_factor=1)
            try:
                await setup(pg)
                d=await pg.evaluate("({w:document.documentElement.scrollWidth,v:innerWidth,n:__constellationApp.cy.nodes().length})")
                check(d['w']<=d['v']+2 and d['n']==10,str(d))
                await pg.screenshot(path=str(ROOT/'evidence/B_COMPETITION_CHINESE_MOBILE.png'),full_page=True)
            finally:await pg.close()
        await run('CB19_mobile_render_and_no_horiz_overflow',mobile)
        async def chinese_error():
            d=json.loads(json.dumps(report));d['relationships'][0]['object_key']='X_NOT_FOUND'
            await page.evaluate('data=>ConstellationIntegration.loadReport(data)',d)
            txt=await page.locator('#validation-banner').inner_text()
            check('合成报告被拒绝' in txt,'missing Chinese error')
            check('对象' in txt,'missing Chinese relation message')
            await page.locator('#btn-load-demo').click()
        await run('CB20_Chinese_user_visible_error_for_bad_relation',chinese_error)
        await browser.close()
        summary={'environment':{'python':sys.version.split()[0],'platform':platform.platform(),'browser':'Chromium 144.0.7559.96 (local executable)','execution':'browser in-memory static assets; NOT file:// or localhost'},'count':len(RESULTS),'passed':sum(x['status']=='PASS' for x in RESULTS),'failed':sum(x['status']=='FAIL' for x in RESULTS),'tests':RESULTS}
        (ROOT/'evidence/B_INTEGRATION_BROWSER_RESULTS.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
        (ROOT/'evidence/B_INTEGRATION_BROWSER_FAILURES.log').write_text('\n'.join(n+'\n'+trace for n,trace in ERRORS))
        print('SUMMARY',summary['passed'],'PASS',summary['failed'],'FAIL',flush=True)
        return summary['failed']
if __name__=='__main__':
    raise SystemExit(asyncio.run(main()))

