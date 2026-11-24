'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const source = file => readFileSync(join(__dirname, '..', 'src', file), 'utf8');

test('typed destinations accept both station suffixes and official names without exposing unrelated properties', () => {
  const context = vm.createContext({window:{}});
  vm.runInContext(source('game.js'), context);
  const nodes = new Set(['留仙洞', '深圳北站', '桂湾']);
  const aliases = {'深圳北':'深圳北站', '前海':'桂湾', '旧名':'已移除地点'};
  const resolve = name => context.resolveDestinationName(name, nodes, aliases);
  for (const name of ['留仙洞', '留仙洞站', ' 留仙洞地铁站 ']) assert.equal(resolve(name), '留仙洞');
  for (const name of ['深圳北站', '深圳北', '深圳北地铁站']) assert.equal(resolve(name), '深圳北站');
  assert.equal(resolve('前海'), '桂湾');
  for (const name of ['toString','__proto__','旧名','不存在站','']) assert.equal(resolve(name), '');
});

// Drive the actual backup controls with a file and in-memory download destination.
function journal(storage = new Map()) {
  const controls = {'import-book':{}, 'export-book':{}, 'journal-status':{}};
  let downloaded;
  const window = {
    document: {
      getElementById: id => controls[id] || null,
      body: {appendChild() {}},
      createElement: () => ({click() {}, remove() {}})
    },
    localStorage: {getItem: key => storage.get(key) || null, setItem: (key,value) => storage.set(key,value)},
    URL: {createObjectURL(blob) { downloaded = blob; return 'blob:journal-test'; }, revokeObjectURL() {}},
    setTimeout(fn) { fn(); }
  };
  const runtime = vm.createContext({window, Blob});
  vm.runInContext(source('journal.js'), runtime);
  return {
    book: window.makeJournal({travel:{nodes:[{name:'洪浪北',kind:'地铁站'}]}}),
    async import(value) {
      const input = {value:'selected',files:[{text:async () => typeof value === 'string' ? value : JSON.stringify(value)}]};
      await controls['import-book'].onchange({target:input});
      assert.equal(input.value, '');
      return controls['journal-status'].textContent;
    },
    async export() {
      controls['export-book'].onclick();
      return JSON.parse(await downloaded.text());
    }
  };
}
const record = {id:'manual-1',name:'自看房',station:'洪浪北',manual:true,saved:true,rooms:'1',monthly:'2500',
  sqm:40,issue:'噪声',note:'卧室 <img src=x> & 窗台',observed:'2024-02-29',updatedAt:'2026-11-22T22:00:00Z'};
const backup = entries => ({format:'shenzhen-rent-journal',version:1,chosenId:'manual-1',entries});

test('site ratings round-trip in first-version backups and old records keep unknown ratings',async()=>{
  const session=journal();
  await session.import(backup([record]));
  assert.equal(session.book.get(record.id).environment,null);
  await session.import(backup([{...record,environment:5,convenience:2,updatedAt:'2026-11-24T00:00:00Z'}]));
  const copy=await session.export();
  const restored=journal();await restored.import(copy);
  assert.deepEqual([restored.book.get(record.id).environment,restored.book.get(record.id).convenience],[5,2]);
  assert.match(await restored.import(backup([{...record,environment:6}])),/导入失败/);
});

test('manual entries survive export, reload, duplicate merge and out-of-order imports', async () => {
  const storage = new Map();
  const first = journal(storage);
  assert.match(await first.import(backup([record])), /已合并/);
  const exported = await first.export();
  assert.equal(exported.entries.length, 1);
  assert.equal(exported.chosenId, record.id);
  const reopened = journal(storage);
  for (const instance of [reopened, journal()]) {
    await instance.import(exported);
    await instance.import(backup([{...record,monthly:1500,note:'旧记录',updatedAt:'2026-10-01T00:00:00Z'}]));
    assert.equal(instance.book.manual().length, 1);
    const restored = instance.book.get(record.id);
    assert.deepEqual([restored.monthly,restored.sqm,restored.rooms],[2500,40,1]);
    assert.ok(restored.saved && restored.chosen);
    assert.equal(restored.observed, record.observed);
    assert.equal(restored.issue, record.issue);
    assert.equal(restored.note, record.note);
    assert.match(instance.book.card(record.id, record.name), /&lt;img src=x&gt; &amp;/);
    assert.doesNotMatch(instance.book.card(record.id, record.name), /<img/);
  }
});

test('invalid files reject the whole import and preserve the existing journal', async () => {
  const session = journal();
  await session.import(backup([record]));
  const before = await session.export();
  const valid = {...record,id:'manual-2'};
  for (const invalid of [
    backup([valid,{...record,observed:'2026-02-29'}]),
    backup([valid,{...record,rooms:1.5}]),
    backup([valid,{...record,station:'未收录站'}]),
    backup([valid,valid]), {...before,version:2}, 'broken JSON'
  ]) {
    assert.match(await session.import(invalid), /导入失败/);
    assert.deepEqual(await session.export(), before);
  }
});
