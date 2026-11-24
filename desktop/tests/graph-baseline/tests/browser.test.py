"""Chromium in-memory execution tests. Local navigation is blocked in this sandbox.
This IS real Chromium JS/Canvas execution, but IS NOT proof of file:// or HTTP installation.
"""
import asyncio, copy, json, re, pathlib, platform, sys, traceback
from playwright.async_api import async_playwright
ROOT=pathlib.Path(__file__).resolve().parent.parent
RESULTS=[]
ERRORS=[]

async def setup(page):
    html=(ROOT/'index.html').read_text()
    # Sandbox navigation policies block file:// and localhost. Recreate the SAME static DOM and inject the actual asset bytes.
    html=re.sub(r'<meta http-equiv="Content-Security-Policy"[^>]*>','',html)
    html=re.sub(r'<link rel="stylesheet"[^>]*>','',html)
    html=re.sub(r'\s*<script src="[^"]+"></script>','',html)
    await page.set_content(html,wait_until='load')
    await page.add_style_tag(content=(ROOT/'src/styles.css').read_text())
    for path in ['vendor/cytoscape.local-3.33.1.js','src/validator.js','src/graph-contract.browser.js','fixtures/synthetic-valid.browser.js','src/app.js']:
        await page.add_script_tag(content=(ROOT/path).read_text())
    await page.wait_for_timeout(150)

async def run(name,func):
    try:
        await func()
        RESULTS.append({'id':name,'status':'PASS'})
        print('PASS',name,flush=True)
    except Exception as exc:
        RESULTS.append({'id':name,'status':'FAIL','detail':str(exc)[:600]})
        ERRORS.append((name,traceback.format_exc()))
        print('FAIL',name,str(exc)[:500],flush=True)

def need(cond,msg):
    if not cond:raise AssertionError(msg)

async def main():
    async with async_playwright() as p:
        browser=await p.chromium.launch(headless=True,executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe',args=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'])
        page=await browser.new_page(viewport={'width':1600,'height':1200},device_scale_factor=1)
        page_errors=[]
        requests=[]
        page.on('pageerror',lambda e:page_errors.append(str(e)))
        page.on('request',lambda r:requests.append(r.url))
        await setup(page)
        async def initial():
            x=await page.evaluate("({version:cytoscape.version,n:__constellationApp.cy.nodes().length,e:__constellationApp.cy.edges().length})")
            need(x=={'version':'3.33.1','n':10,'e':7},str(x))
            need('验证通过' in await page.locator('#validation-banner').inner_text(),'missing verified banner')
        await run('B01_chromium_real_graph_render',initial)
        async def canvas_present():
            n=await page.locator('#graph canvas').count();need(n>=1,f'expected canvas, got {n}')
            need(await page.locator('#graph-empty').is_hidden(),'graph should be visible')
        await run('B02_canvas_exists',canvas_present)
        await page.screenshot(path=str(ROOT/'evidence/A_R_CN_INITIAL_BROWSER.png'),full_page=True)
        async def click_node(id):
            await page.locator('#graph').scroll_into_view_if_needed()
            pos=await page.evaluate("""id=>{let cy=__constellationApp.cy,n=cy.getElementById(id),p=n.renderedPosition(),r=document.getElementById('graph').getBoundingClientRect();return {x:r.left+p.x,y:r.top+p.y};}""",id)
            await page.mouse.click(pos['x'],pos['y'])
            await page.wait_for_timeout(100)
        async def commitment_drawer():
            await click_node('C_A')
            txt=await page.locator('#inspector').inner_text()
            need('EV_MEET' in txt and 'EV_CHECK' in txt,'commitment evidence drawer missing references')
            need('来源' in txt and '定位' in txt and '复核' in txt,'missing required context')
        await run('B03_real_mouse_click_commitment_drawer',commitment_drawer)
        await page.screenshot(path=str(ROOT/'evidence/A_R_CN_EVIDENCE_DRAWER.png'),full_page=True)
        async def evidence_drawer():
            await click_node('N_EV_EMAIL')
            txt=await page.locator('#inspector').inner_text()
            need('EV_EMAIL' in txt and 'SRC_EMAIL' in txt,'evidence click missing source')
            need('EV_MEET' not in txt,'evidence drawer incorrectly mixed unrelated sources')
        await run('B04_real_mouse_click_evidence_node',evidence_drawer)
        async def edge_drawer():
            await page.evaluate("() => { __constellationApp.cy.getElementById('REL_RISK_A').emit('tap'); return true; }")
            txt=await page.locator('#inspector').inner_text()
            need('模拟推断' in txt and 'EV_CHECK' in txt and '待人工复核' in txt,'inference edge semantics missing')
        await run('B05_edge_event_traceability',edge_drawer)
        async def filter_nodes():
            await page.locator('[data-node-type="risk"]').uncheck()
            x=await page.evaluate("({visible:__constellationApp.cy.getElementById('R_A').visible(),edges:__constellationApp.cy.edges().filter(e=>e.visible()).length})")
            need(not x['visible'] and x['edges']==6,str(x))
            await page.locator('[data-node-type="risk"]').check()
        await run('B06_filter_node_type',filter_nodes)
        async def filter_relation():
            await page.locator('#edge-inference').uncheck()
            x=await page.evaluate("({riskVisible:__constellationApp.cy.getElementById('REL_RISK_A').visible(),edges:__constellationApp.cy.edges().filter(e=>e.visible()).length})")
            need(not x['riskVisible'] and x['edges']==6,str(x))
            await page.locator('#edge-inference').check()
        await run('B07_filter_inference_relation',filter_relation)
        async def search():
            await page.locator('#search-nodes').fill('承诺A')
            n=await page.evaluate("__constellationApp.cy.nodes().filter(n=>n.visible()).map(n=>n.id())")
            need(n==['C_A'],str(n))
            await page.locator('#search-nodes').fill('')
        await run('B08_search_filter',search)
        async def zoom():
            before=await page.evaluate('__constellationApp.cy.zoom()')
            await page.locator('#btn-zoom-in').click()
            after=await page.evaluate('__constellationApp.cy.zoom()')
            need(after>before,f'zoom not increased {before}->{after}')
            await page.locator('#btn-zoom-out').click()
        await run('B09_zoom_controls',zoom)
        async def reset_position():
            await page.evaluate("() => { __constellationApp.cy.getElementById('P_A').position({x:999,y:999}); return true; }")
            await page.locator('#btn-reset-layout').click()
            x=await page.evaluate('__constellationApp.cy.getElementById("P_A").position()')
            need(abs(x['x']-130)<.1 and abs(x['y']-180)<.1,str(x))
        await run('B10_reset_layout',reset_position)
        async def drag_node():
            await page.locator('#btn-fit').click()
            before=await page.evaluate('__constellationApp.cy.getElementById("P_A").position()')
            pos=await page.evaluate("""()=>{let cy=__constellationApp.cy,p=cy.getElementById('P_A').renderedPosition(),r=document.getElementById('graph').getBoundingClientRect();return {x:r.left+p.x,y:r.top+p.y};}""")
            await page.mouse.move(pos['x'],pos['y'])
            await page.mouse.down()
            await page.mouse.move(pos['x']+50,pos['y']+25,steps=8)
            await page.mouse.up()
            await page.wait_for_timeout(120)
            after=await page.evaluate('__constellationApp.cy.getElementById("P_A").position()')
            need(abs(after['x']-before['x'])>2 or abs(after['y']-before['y'])>2,f'node drag not observed {before}->{after}')
            await page.locator('#btn-reset-layout').click()
        await run('B11_real_mouse_node_drag',drag_node)
        async def invalid_fail_closed():
            bad=json.loads((ROOT/'fixtures/invalid-source-ref.json').read_text())
            accepted=await page.evaluate('d=>__constellationApp.loadData(d)',bad)
            need(accepted is False,'invalid data accepted')
            need(await page.locator('#graph-empty').is_visible(),'graph not cleared')
            need('输入被拒绝' in await page.locator('#validation-banner').inner_text(),'rejection not visible')
        await run('B12_invalid_data_rejected_before_render',invalid_fail_closed)
        async def restore():
            await page.locator('#btn-load-demo').click()
            need(await page.locator('#graph-empty').is_hidden(),'demo not restored')
            need(await page.evaluate('__constellationApp.cy.edges().length')==7,'edge count wrong after reset')
        await run('B13_restore_valid_synthetic_demo',restore)
        async def unsafe_markup():
            bad=json.loads((ROOT/'fixtures/invalid-unsafe-markup.json').read_text())
            accepted=await page.evaluate('d=>__constellationApp.loadData(d)',bad)
            need(accepted is False,'markup fixture should reject')
            need(await page.locator('#inspector img').count()==0,'unsafe img inserted')
            need(await page.locator('#inspector script').count()==0,'unsafe script inserted')
            await page.locator('#btn-load-demo').click()
        await run('B14_unsafe_html_rejected_no_dom_injection',unsafe_markup)
        async def local_upload():
            await page.locator('#file-input').set_input_files(str(ROOT/'fixtures/invalid-missing-node.json'))
            await page.wait_for_timeout(250)
            need('输入被拒绝' in await page.locator('#validation-banner').inner_text(),'file input bypassed gate')
            await page.locator('#btn-load-demo').click()
        await run('B15_local_json_upload_gate',local_upload)
        async def no_http():
            need(len(requests)==0,'unexpected requests '+str(requests))
        await run('B16_zero_network_requests_during_in_memory_demo',no_http)
        async def no_js_exception():
            need(not page_errors,'browser exceptions '+str(page_errors))
        await run('B17_no_uncaught_js_exceptions',no_js_exception)
        async def mobile():
            mobile=await browser.new_page(viewport={'width':390,'height':844},device_scale_factor=1)
            try:
                await setup(mobile)
                need(await mobile.evaluate('__constellationApp.cy.nodes().length')==10,'mobile no graph')
                need(await mobile.locator('#graph').is_visible(),'mobile graph hidden')
                await mobile.screenshot(path=str(ROOT/'evidence/A_R_CN_MOBILE_BROWSER.png'),full_page=True)
            finally:await mobile.close()
        await run('B18_mobile_responsive_canvas',mobile)
        async def bound_node_review():
            await click_node('C_A')
            txt=await page.locator('#inspector').inner_text()
            need('对应复核记录（完全合成）' in txt and 'REV_C_A' in txt,'review record not visible')
            need('目标对象：节点 · C_A' in txt,'node review target absent')
            need('复核结果：确认' in txt and '模拟复核人：角色乙' in txt,'review result or actor absent')
        await run('B19_review_event_bound_to_exact_node_visible',bound_node_review)
        await page.screenshot(path=str(ROOT/'evidence/A_R_CN_REVIEW_BOUND.png'),full_page=True)
        await page.locator('#inspector').evaluate('(el)=>{el.scrollTop=el.scrollHeight;}')
        await page.wait_for_timeout(100)
        await page.screenshot(path=str(ROOT/'evidence/A_R_CN_REVIEW_BINDING_DETAIL.png'),full_page=True)
        async def bound_edge_review():
            data=json.loads((ROOT/'fixtures/synthetic-review-edge-valid.json').read_text())
            accepted=await page.evaluate('d=>__constellationApp.loadData(d)',data)
            need(accepted is True,'edge reviewed fixture rejected')
            await page.evaluate("() => { __constellationApp.cy.getElementById('REL_ASSIGN_A').emit('tap'); return true; }")
            txt=await page.locator('#inspector').inner_text()
            need('目标对象：关系 · REL_ASSIGN_A' in txt and 'REV_REL_ASSIGN' in txt,'edge review target absent')
            need('REV_C_A' not in txt,'node review record incorrectly displayed in edge drawer')
        await run('B20_review_event_bound_to_exact_edge_visible',bound_edge_review)
        async def reject_cross_binding_in_browser():
            for file in ['invalid-review-multiple-nodes.json','invalid-review-cross-node-edge.json','invalid-review-cross-node.json','invalid-review-target-not-found.json']:
                bad=json.loads((ROOT/'fixtures'/file).read_text())
                accepted=await page.evaluate('d=>__constellationApp.loadData(d)',bad)
                need(accepted is False,'bad review binding allowed '+file)
                need(await page.locator('#graph-empty').is_visible(),'graph not cleared '+file)
                need('复核' in await page.locator('#validation-banner').inner_text(),'untranslated review error '+file)
            await page.locator('#btn-load-demo').click()
        await run('B21_wrong_binding_rejected_before_browser_render',reject_cross_binding_in_browser)
        async def chinese_user_ui():
            await click_node('C_A')
            title=await page.title()
            need('AI承诺星图' in title,'title not Chinese')
            visible=await page.locator('body').inner_text()
            for bad in ['STAGE A','CONTROL','KNOWLEDGE MAP','EVIDENCE TRACE','PERSON','COMMITMENT','EVIDENCE','DEADLINE','RISK','NODE DETAILS','RELATION DETAILS','NOT_VERIFIED','Graph Runtime']:
                need(not re.search(r'(?<![a-zA-Z])'+re.escape(bad)+r'(?![a-zA-Z])',visible),f'English UI residue {bad}')
            for good in ['筛选控制','关系图谱','证据追溯','节点详情','对应复核记录','合成数据演示','非真实AI分析结果','来源直接陈述','待人工复核']:
                need(good in visible,'missing Chinese text '+good)
            need('synthetic' not in visible.lower(),'raw synthetic token exposed')
        await run('B22_all_visible_business_ui_chinese',chinese_user_ui)
        async def error_fully_localized():
            bad=json.loads((ROOT/'fixtures/invalid-review-target-not-found.json').read_text())
            await page.evaluate('d=>__constellationApp.loadData(d)',bad)
            banner=await page.locator('#validation-banner').inner_text()
            need('复核目标不存在或类型错误' in banner,'binding error not translated')
            need('REVIEW_TARGET_NOT_FOUND' not in banner,'raw code surfaced')
            await page.locator('#btn-load-demo').click()
        await run('B23_localized_validation_error',error_fully_localized)
        async def desktop_1366():
            await page.set_viewport_size({'width':1366,'height':900})
            await page.wait_for_timeout(250)
            dims=await page.evaluate("({w:document.documentElement.scrollWidth,v:innerWidth,canvas:document.querySelectorAll('#graph canvas').length})")
            need(dims['canvas']>=1,'graph canvas missing in desktop viewport')
            need(dims['w']<=dims['v']+2,'horizontal document overflow '+str(dims))
            visible=await page.evaluate("""() => {let cy=__constellationApp.cy,r=document.getElementById('graph').getBoundingClientRect(); return cy.nodes().filter(n=>n.visible()).map(n=>({id:n.id(),x:n.renderedPosition().x,y:n.renderedPosition().y, width:r.width,height:r.height}));}""")
            for n in visible:
                need(15<n['x']<n['width']-15 and 15<n['y']<n['height']-15,'graph node clipped at 1366 '+str(n))
            await page.screenshot(path=str(ROOT/'evidence/A_R_CN_DESKTOP_1366.png'),full_page=True)
        await run('B24_1366_desktop_no_horizontal_overflow',desktop_1366)
        async def desktop_1440():
            await page.set_viewport_size({'width':1440,'height':900})
            await page.wait_for_timeout(100)
            dims=await page.evaluate("({w:document.documentElement.scrollWidth,v:innerWidth})")
            need(dims['w']<=dims['v']+2,str(dims))
            await page.screenshot(path=str(ROOT/'evidence/A_R_CN_DESKTOP_1440.png'),full_page=True)
        await run('B25_1440_desktop_no_horizontal_overflow',desktop_1440)
        async def no_unsanitized_evidence_html():
            await page.evaluate("() => {__constellationApp.inspectItem('C_A','node'); return true;}")
            need(await page.locator('#inspector [onerror]').count()==0,'unsafe onerror attribute inserted')
            need(await page.locator('#inspector img, #inspector iframe, #inspector script').count()==0,'untrusted HTML inserted')
            need('【纯合成】' in await page.locator('#inspector').inner_text(),'synthetic excerpt missing')
        await run('B26_plain_text_evidence_not_html',no_unsanitized_evidence_html)
        async def mobile_chinese_no_overflow():
            mobile=await browser.new_page(viewport={'width':390,'height':844},device_scale_factor=1)
            try:
                await setup(mobile)
                size=await mobile.evaluate("({w:document.documentElement.scrollWidth,v:innerWidth})")
                need(size['w']<=size['v']+2,'mobile horizontal overflow '+str(size))
                need('合成数据演示' in await mobile.locator('body').inner_text(),'mobile missing synthetic banner')
                await mobile.screenshot(path=str(ROOT/'evidence/A_R_CN_MOBILE_BROWSER.png'),full_page=True)
            finally:await mobile.close()
        await run('B27_mobile_chinese_no_horizontal_overflow',mobile_chinese_no_overflow)

        report={'environment':{'python':sys.version.split()[0],'platform':platform.platform(),'chromium':browser.version,'execution_mode':'CHROMIUM_IN_MEMORY_ASSET_INJECTION','navigation_file_and_http':'BLOCKED_BY_ADMINISTRATOR','csp_browser_runtime':'NOT_VERIFIED'},'tests':RESULTS,'passed':sum(r['status']=='PASS' for r in RESULTS),'failed':sum(r['status']=='FAIL' for r in RESULTS),'page_errors':page_errors,'outbound_requests':requests}
        (ROOT/'evidence/A_R_BROWSER_TEST_RESULTS.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
        (ROOT/'evidence/A_R_BROWSER_TEST_DETAILS.log').write_text('\n'.join(n+'\n'+tb for n,tb in ERRORS) if ERRORS else 'All browser in-memory tests passed.\n')
        print('SUMMARY',report['passed'],'PASS,',report['failed'],'FAIL; browser',browser.version,flush=True)
        await browser.close()
        if ERRORS:raise SystemExit(1)

if __name__=='__main__':asyncio.run(main())

