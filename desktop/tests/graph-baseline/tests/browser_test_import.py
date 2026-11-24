"""Load the exact A-R Web assets for isolated Chromium tests, without filesystem navigation."""
import pathlib,re
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
async def setup(page):
    html=(ROOT/'index.html').read_text(encoding='utf8')
    html=re.sub(r'<meta http-equiv="Content-Security-Policy"[^>]*>','',html)
    html=re.sub(r'<link rel="stylesheet"[^>]*>','',html)
    html=re.sub(r'\s*<script src="[^"]+"></script>','',html)
    await page.set_content(html,wait_until='load')
    await page.add_style_tag(content=(ROOT/'src/styles.css').read_text(encoding='utf8'))
    for rel in ['vendor/cytoscape.local-3.33.1.js','src/validator.js','src/graph-contract.browser.js','fixtures/synthetic-valid.browser.js','src/app.js']:
        await page.add_script_tag(content=(ROOT/rel).read_text(encoding='utf8'))
    await page.wait_for_timeout(150)
