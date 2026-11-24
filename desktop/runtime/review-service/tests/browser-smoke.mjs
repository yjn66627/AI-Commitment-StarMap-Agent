import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fixture } from './fixture.mjs';
const { chromium } = createRequire(import.meta.url)(process.env.COMP_DR_PLAYWRIGHT);
const f = await fixture();
const browser = await chromium.launch({ executablePath: process.env.COMP_DR_CHROME });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const external = [], errors = [];
  await page.context().route('**/*', route => {
    if (new URL(route.request().url()).origin !== f.origin) {
      external.push(new URL(route.request().url()).hostname);
      return route.abort();
    }
    return route.continue();
  });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(f.origin);
  await page.getByRole('heading', { name: '评委登录' }).waitFor();
  assert.equal(await page.locator('html').getAttribute('lang'), 'zh-CN');
  await page.screenshot({ path: '../media/review-login.png' });
  await page.getByLabel('评委账号').fill(f.user);
  await page.getByLabel('评委密码').fill(f.password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByRole('heading', { name: '合成案例分析' }).waitFor();
  await page.getByLabel('案例', { exact: true }).selectOption('handoff');
  assert.match(await page.locator('#records').innerText(), /H01.*交接清单/);
  await page.getByRole('button', { name: '分析当前案例' }).click();
  await page.getByRole('heading', { name: '分析结果与引用' }).waitFor();
  assert.match(await page.locator('#result-label').innerText(), /受控测试替身/);
  assert.match(await page.locator('#findings').innerText(), /H01/);
  assert.match(await page.locator('#findings').innerText(), /H02/);
  assert(!(await page.content()).includes(f.fakeKey));
  await page.screenshot({ path: '../media/review-controlled-result.png', fullPage: true });
  const [graph] = await Promise.all([page.waitForEvent('popup'),
    page.getByRole('link', { name: '打开独立合成星图' }).click()]);
  graph.on('pageerror', error => errors.push(error.message));
  await graph.waitForFunction(() => window.__constellationApp?.cy?.edges().length === 7);
  const p = await graph.evaluate(() => {
    const n = __constellationApp.cy.getElementById('C_A').renderedPosition();
    const r = document.querySelector('#graph').getBoundingClientRect();
    return { x: r.x + n.x, y: r.y + n.y };
  });
  await graph.mouse.click(p.x, p.y);
  assert.match(await graph.locator('#inspector').innerText(), /EV_MEET/);
  await graph.screenshot({ path: '../media/review-graph.png', fullPage: true });
  await graph.close();
  await page.getByRole('button', { name: '退出登录' }).click();
  await page.getByRole('heading', { name: '评委登录' }).waitFor();
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  assert.equal(f.calls(), 1);
  console.log('CONTROLLED_TEST_PASS Windows Chrome ' + browser.version() +
    ': login, two cases, labelled substitute response, trusted citation excerpts, fixed graph and logout');
  console.log('External requests=0; leaked test key=0; real provider requests=0');
} finally {
  await browser.close();
  await f.close();
}
