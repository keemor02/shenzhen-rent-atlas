'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const vm = require('node:vm');

const root = join(__dirname,'..');
const factory = vm.runInNewContext(readFileSync(join(root,'src/regional-layers.js'),'utf8') + '\nmakeRegionalLayers;');
const base = JSON.parse(readFileSync(join(root,'data/base.json'),'utf8'));
const esc = s => String(s).replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

test('district density uses the census period, district population and district land area', () => {
  const model = factory(base,esc);
  const nanshan = model.summary('南山区','density');
  assert.equal(nanshan.label,'9,970');
  assert.match(nanshan.detail,/186\.97 万人/);
  assert.match(nanshan.detail,/187\.53 km²/);
  assert.match(nanshan.detail,/2025年末/);
  assert.ok(nanshan.detail.includes(base.districts.find(d => d.n === '南山区').popSrc));
  for (const d of base.districts) assert.equal(model.summary(d.n,'density').value,d.density);
  assert.doesNotMatch(model.legend('density'),/缺资料/);
  assert.equal(model.summary('西丽街道','density').value,null);
});

test('each housing type retains its period, measure, coverage, and district unit', () => {
  const model = factory(base,esc);
  assert.deepEqual(Array.from(model.kinds,k => k.id),['community','apt','village','all','ref0','ref1','ref2']);
  const ids = k => Array.from(model.options(k), m => m.id);
  assert.deepEqual(ids('community'),['price','yoy','mom']);
  assert.deepEqual(ids('all'),['price','yoy']);
  for (const k of ['apt','village','ref0','ref1','ref2']) assert.deepEqual(ids(k),['price']);
  const read = (k,m='price',d='南山区') => model.summary(d,'districtRent',k,m);
  assert.equal(read('community','yoy').label,'+0.14%');
  assert.equal(read('community','mom').value,0.38);
  assert.equal(read('all').value,110.16);
  assert.equal(read('all','yoy').value,-6.75);
  assert.equal(read('community','price','大鹏新区').fill,null);
  assert.match(model.legend('districtRent','community','price'),/缺资料/);
  assert.equal(read('apt').label,'约 164');
  assert.match(read('apt').detail,/2026年上半年 · 图表估读/);
  assert.equal(read('apt','yoy').value,null);
  const village = read('village');
  assert.equal(village.value,60);
  assert.equal(village.label,'60–103');
  assert.match(village.detail,/2026年第一季度/);
  assert.match(model.legend('districtRent','village','price'),/单间区间下限/);
  const partial = read('village','price','龙华区');
  assert.equal(partial.fill,null);
  assert.match(partial.detail,/79/);
  assert.deepEqual(['ref0','ref1','ref2'].map(k=>read(k).value),[109,154,65]);
  assert.match(read('ref2').detail,/2022年度/);
});

test('verified monthly listings replace only their period and do not fill omitted districts from an older snapshot', () => {
  const model = factory(base,esc);
  const updated = {
    month:'2026-11', prior:'2025-11', url:'https://www.creprice.cn/report/sz/2026-11.html',
    rows:{'南山区':{price:105.4,prior:105.4,yoy:0},'福田区':{price:0,yoy:-100}}
  };
  assert.equal(model.update({...updated,url:'https://example.org/report'}),false);
  assert.equal(model.update({...updated,prior:'2026-10'}),false);
  assert.equal(model.update(updated),true);
  assert.equal(model.period('districtRent','all'),'2026-11');
  const nanshan = model.summary('南山区','districtRent','all','yoy');
  assert.equal(nanshan.value,0);
  assert.ok(nanshan.fill);
  assert.match(nanshan.detail,/2026-11\.html/);
  assert.match(nanshan.detail,/2025-11\.html/);
  assert.equal(model.summary('福田区','districtRent','all','price').fill,null);
  assert.equal(model.summary('南山区','districtRent','community','price').value,118);
  assert.equal(model.update({...updated,month:'2026-10',prior:'2025-10',url:'https://www.creprice.cn/report/sz/2026-10.html'}),false);
  assert.equal(model.update({...updated,rows:{'南山区':{price:106,prior:null,yoy:null}}}),true);
  assert.deepEqual(Array.from(model.options('all'), m=>m.id),['price']);
});

test('source links allow public HTTP(S) addresses and escape attribute and note text', () => {
  const local = structuredClone(base);
  local.apartment.currentCommunity.sources = ['javascript:alert(1)','https://example.org/?a=1&b=2'];
  local.villageRecent.by_district['南山区'].note = '<b>来源备注</b>';
  const model = factory(local,esc);
  const links = model.summary('南山区','districtRent','community').detail;
  assert.doesNotMatch(links,/javascript:/);
  assert.match(links,/a=1&amp;b=2/);
  assert.match(model.summary('南山区','districtRent','village').detail,/&lt;b&gt;来源备注&lt;\/b&gt;/);
});
