"""A-R desktop Chromium visible-string audit. Does not fetch networks or inspect real user material."""
import asyncio, json, pathlib, re, sys, platform
from playwright.async_api import async_playwright
from browser_test_import import setup  # copied helper; see adjacent file

ROOT=pathlib.Path(__file__).resolve().parent.parent
AUDITED=[]
VIOLATIONS=[]
BANNED_PHRASES=['STAGE A','CONTROL','KNOWLEDGE MAP','EVIDENCE TRACE','PERSON','COMMITMENT','EVIDENCE','DEADLINE','RISK','NODE DETAILS','RELATION DETAILS','NOT_VERIFIED','Graph Runtime','Runtime PASS','source_direct','ai_inference','not_reviewed','target kind','review event','synthetic evidence demonstrator']

async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(headless=True,executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe',args=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'])
  page=await browser.new_page(viewport={'width':1440,'height':900},locale='zh-CN')
  await setup(page)
  async def record(stage):
   text=(await page.locator('body').inner_text())+'\n'+(await page.title())
   attrs=await page.locator('input,button,aside,main,section,[title],[aria-label]').evaluate_all('els=>els.map(el=>[el.title||"",el.getAttribute("aria-label")||"",el.placeholder||""]).flat().join("\\n")')
   text+='\n'+attrs
   for bad in BANNED_PHRASES:
    # Exclude uppercase substrings embedded in documented GraphContract IDs, where allowed.
    if re.search(r'(?<![A-Za-z_])'+re.escape(bad)+r'(?![A-Za-z_])',text):
     VIOLATIONS.append({'state':stage,'untranslated_phrase':bad})
   # Search English lowercase multiwords, excluding technical terms and JSON pointer identifiers.
   for phrase in re.findall(r'(?<![\w])[A-Za-z]{3,}(?:[ -]+[A-Za-z]{3,})+(?![\w])',text):
    if phrase.lower() not in ('cytoscape js',):VIOLATIONS.append({'state':stage,'untranslated_phrase':phrase})
   AUDITED.append({'state':stage,'characters':len(text),'has_chinese':bool(re.search('[\u4e00-\u9fff]',text))})
  await record('初始化与基础提示')
  await page.evaluate("() => {__constellationApp.inspectItem('C_A','node'); return true;}")
  await record('复核对象节点中文侧栏')
  demo=json.loads((ROOT/'fixtures/synthetic-valid.json').read_text())
  for n in demo['nodes']:
   if n['status']['render_policy'] in ('show','placeholder_only'):
    await page.evaluate('(id)=>__constellationApp.inspectItem(id,\'node\')',n['id'])
    await record('节点详情_'+n['id'])
  for e in demo['edges']:
   if e['status']['render_policy']=='show':
    await page.evaluate('(id)=>__constellationApp.inspectItem(id,\'edge\')',e['id'])
    await record('关系详情_'+e['id'])
  edge_data=json.loads((ROOT/'fixtures/synthetic-review-edge-valid.json').read_text())
  await page.evaluate('d=>__constellationApp.loadData(d)',edge_data)
  await page.evaluate("() => {__constellationApp.inspectItem('REL_ASSIGN_A','edge'); return true;}")
  await record('复核对象关系中文侧栏')
  files=sorted((ROOT/'fixtures').glob('invalid-*.json'))
  for path in files:
   bad=json.loads(path.read_text())
   accepted=await page.evaluate('d=>__constellationApp.loadData(d)',bad)
   if accepted:VIOLATIONS.append({'state':path.name,'untranslated_phrase':'INVALID_ACCEPTED'})
   await record('拒绝_'+path.stem)
  await page.locator('#btn-load-demo').click()
  await page.evaluate('() => {window._savedCy=window.cytoscape; window.cytoscape=undefined; __constellationApp.loadData(window.SYNTHETIC_FIXTURE); return true;}')
  await record('图库不可用安全回退')
  await page.evaluate('() => {window.cytoscape=window._savedCy; __constellationApp.loadData(window.SYNTHETIC_FIXTURE); return true;}')
  # Real local-file widget parsing failure, no filesystem navigation needed.
  await page.locator('#file-input').set_input_files({'name':'测试错误输入.json','mimeType':'application/json','buffer':b'{invalid-json'})
  await record('本地JSON解析失败')
  # The original browser launch is `set_content` with asset injection, not a file URL/CSP test.
  result={'runtime':{'chromium':browser.version,'platform':platform.platform(),'execution_mode':'CHROMIUM_IN_MEMORY_ASSET_INJECTION','windows_file_double_click':'NOT_VERIFIED'},'states_audited':len(AUDITED),'synthetic_negative_fixtures':len(files),'static_html_language':'zh-CN','technical_names_allowed':['AI','JSON','Cytoscape.js','V2.0','technical ID','GraphContract JSON fields'],'untranslated_visible_phrases':VIOLATIONS,'states':AUDITED}
  (ROOT/'evidence/A_R_UI_STRING_AUDIT.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
  print('states',len(AUDITED),'invalid',len(files),'violation',len(VIOLATIONS))
  if VIOLATIONS:print(json.dumps(VIOLATIONS[:30],ensure_ascii=False,indent=2))
  await browser.close()
  if VIOLATIONS:sys.exit(1)

if __name__=='__main__':asyncio.run(main())

