import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const read=p=>readFile(new URL(p,import.meta.url));
const sha=b=>createHash('sha256').update(b).digest('hex');
test('model provider and GraphContract remain byte-for-byte aligned to recorded V1.2 baseline',async()=>{
  const manifest=JSON.parse((await read('../../docs/业务源码保护清单.json')).toString('utf8'));
  for (const item of manifest.files){
    assert.equal(sha(await read('../'+item.path)),item.sha256,item.path);
  }
  assert.ok(manifest.files.some(x=>x.path.endsWith('/provider.mjs')));
  assert.ok(manifest.files.some(x=>x.path.endsWith('/src/graph-contract.browser.js')));
});
