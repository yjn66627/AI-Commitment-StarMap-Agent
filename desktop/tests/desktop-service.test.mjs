import test from 'node:test';
import assert from 'node:assert/strict';
import {startDesktopService} from '../electron/desktop-service.mjs';

const post=async (origin, path, body, cookie=null, crossOrigin=null) => fetch(origin+path, {
  method:'POST', redirect:'manual',
  headers:{origin:crossOrigin??origin,'Content-Type':'application/json', ...(cookie ? {cookie} : {})},
  body: JSON.stringify(body),
});

test('desktop service binds loopback, starts with model disabled and no filesystem credentials', async t => {
  const service=await startDesktopService({env:{}, log:()=>{}});
  t.after(()=>service.stop());
  const parsed=new URL(service.origin);
  assert.equal(parsed.hostname,'127.0.0.1');
  assert.equal(service.live,false);
  assert.ok(Number(parsed.port)>1024);
  const denied=await fetch(service.origin+'/graph/3d.html');
  assert.equal(denied.status,401);
  assert.equal((await denied.json()).error,'LOGIN_REQUIRED');
  const cookie=await service.signIn();
  assert.equal(cookie.name,'pcca-review');
  assert.equal(cookie.httpOnly,true);
  const cookieHeader=`${cookie.name}=${cookie.value}`;
  const page=await fetch(service.origin+'/graph/3d.html',{headers:{cookie:cookieHeader}});
  assert.equal(page.status,200);
  assert.match(await page.text(),/AI承诺审计星图/);
  assert.match(page.headers.get('content-security-policy'), /connect-src 'none'/);
  const cases=await fetch(service.origin+'/api/cases',{headers:{cookie:cookieHeader}});
  assert.equal(cases.status,200);
  const data=await cases.json();
  assert.equal(data.mode,'disabled');
  assert.equal(data.cases.length,2);
  const blocked=await post(service.origin,'/api/analyze',{caseId:data.cases[0].id},cookieHeader);
  assert.equal(blocked.status,503);
  assert.equal((await blocked.json()).error,'MODEL_DISABLED');
  const wrongOrigin=await post(service.origin,'/api/logout',{},cookieHeader,'https://not-our-app.invalid');
  assert.equal(wrongOrigin.status,403);
  const sensitive=await fetch(service.origin+'/graph/../../../budget.mjs',{headers:{cookie:cookieHeader}});
  assert.ok([400,404].includes(sensitive.status),`unexpected status ${sensitive.status}`);
  const badFile=await fetch(service.origin+'/.env.example',{headers:{cookie:cookieHeader}});
  assert.equal(badFile.status,404);
  const noCookie=await fetch(service.origin+'/graph/',{redirect:'manual'});
  assert.equal(noCookie.status,401);
  const logout=await post(service.origin,'/api/logout',{},cookieHeader);
  assert.equal(logout.status,200);
  assert.equal((await fetch(service.origin+'/api/cases',{headers:{cookie:cookieHeader}})).status,401);
});

test('explicit model opt-in requires valid key and original quota ledger', async () => {
  await assert.rejects(startDesktopService({enableModel:true,env:{STARMAP_ENABLE_MODEL:'1'}}), /MODEL_KEY_REQUIRED/);
  await assert.rejects(startDesktopService({enableModel:true,env:{STARMAP_ENABLE_MODEL:'1',DEEPSEEK_API_KEY:'sk-'+'a'.repeat(30)}}), /LEDGER_CONFIG_REQUIRED/);
});

test('stop is idempotent and releases listening socket', async () => {
  const service=await startDesktopService({env:{}});
  await service.stop();
  await service.stop();
  await assert.rejects(service.signIn(), /SERVICE_CLOSED/);
});
