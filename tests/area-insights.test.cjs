'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const base = JSON.parse(read('data/base.json'));
const fine = JSON.parse(read('data/fine.json'));
const esc = value => String(value ?? '').replace(/[&<>"']/g, c =>
  ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const clock = class extends Date { static now() { return Date.parse('2026-11-24T12:00:00+08:00'); } };
const context = vm.createContext({window: {}, Date: clock});
for (const file of ['world.js', 'market-period.js', 'area-insights.js']) vm.runInContext(read('src/' + file), context);
const make = (data = fine, policies = [], source = base) => context.makeAreaInsights(source, data, {policies}, esc);
const street = (name, district) => fine.streets.find(row => row.n === name && (!district || row.d === district)).id;

test('district counts cover the 14 market events and 7 public cases using unique event IDs', () => {
  const api = make(fine, [], {...base, events: [...base.events, ...base.events]});
  const all = new Set();
  for (const {n} of base.districts) {
    const events = api.get('district', n).events;
    const keys = events.map(row => row.kind + ':' + row.id);
    assert.equal(new Set(keys).size, events.length);
    keys.forEach(key => all.add(key));
    for (const event of events) {
      assert.ok(event.date && event.basis && event.relation);
      assert.match(event.source, /^https?:\/\//);
    }
  }
  assert.equal(all.size, 21);
  const baoan = api.get('district', '宝安区').events;
  assert.ok(baoan.some(row => row.id === 'industry-tantou'));
  assert.ok(baoan.some(row => row.id === 'square-xinan'), 'different cases share a source PDF');
  const west = api.get('street', street('西丽街道'));
  assert.equal(west.events.filter(row => row.id === 'works-fengyan').length, 1, 'both nearby stations are in one street');
  assert.match(west.events.find(row => row.id === 'works-fengyan').relation, /高新北、石鼓/);
});

test('local supply and demand differ from relative rent, a single negotiated lease and a nearby station', () => {
  const api = make();
  for (const [id,direction] of [['beer','up'],['guiwan','up'],['liuxian','down'],['pingzhou','down'],
    ['island','mixed'],['xili','watch'],['fuyong','watch'],['phoenix','watch']]) {
    assert.equal(api.get('hood','e-' + id).outlook.direction, direction, id);
  }
  assert.equal(api.get('district', '南山区').outlook.direction, 'mixed');
  assert.equal(api.get('zone', 'zone-坪洲').events.length, 1);
  const neighbor = api.get('hood', 'west-mabu');
  assert.ok(neighbor.events.some(row => /同站参照/.test(row.relation) && row.id === 'pingzhou'));
  assert.equal(neighbor.outlook.direction, 'watch');
  assert.ok(!neighbor.events.some(row => row.id === 'island'), 'events elsewhere in a street stay with their area');
  const minzhi = api.get('street', street('民治街道'));
  assert.equal(minzhi.outlook.direction, 'watch');
  assert.ok(minzhi.events.every(row => row.kind === 'public'));
  assert.match(api.panel('street', street('民治街道')), /data-ev="rail-minzhi"/);
  assert.match(api.panel('hood', 'e-liuxian'), /^<h2>[^<]+<\/h2>.*data-market-event="liuxian"/s);
  assert.equal(api.get('district', '西丽街道'), null);
  assert.equal(api.get('toString', '任意'), null);
  assert.equal(api.panel('hood', '不存在'), '');
});

test('observed changes respect geography, room type, source and units including zero', () => {
  const api = make();
  const nanshan = api.measure('district', '南山区', 'yoy', '');
  assert.equal(nanshan.value, .14);
  assert.equal(nanshan.label, '同比 +0.14%');
  assert.equal(nanshan.period, '2026-10');
  assert.match(nanshan.basis, /普通小区.*全户型/);
  assert.equal(api.measure('district', '南山区', 'yoy', '1'), null);
  const xixiang = street('西乡街道');
  const one = api.measure('street', xixiang, 'yoy', '');
  assert.equal(one.value, -6.25);
  assert.match(one.basis, /西乡商圈 · 一室/);
  assert.equal(api.measure('street', xixiang, 'yoy', '2').value, 0);
  assert.equal(api.measure('street', xixiang, 'mom', '2').value, -1.96);
  assert.match(api.measure('street', xixiang, 'mom', '2').basis, /2026-09 与 2026-10/);
  assert.equal(api.measure('zone', 'zone-西乡', 'yoy', '3').value, 3.17);
  assert.equal(api.measure('zone', 'zone-坪洲', 'yoy', ''), null);
  assert.equal(api.get('hood', 'west-mabu').observed, null);
  assert.equal(api.get('street', xixiang).observed.value, 2.13);
  assert.match(api.get('street', xixiang).observed.basis, /西乡街道.*57 套/);
  const project = api.measure('hood', 'nsguanlong', 'mom', '');
  assert.equal(project.value, -5.17);
  assert.match(project.basis, /官龙名苑一室/);
  assert.equal(api.measure('hood', 'nsguanlong', 'mom', '2').value, 16.67);
  assert.equal(api.measure('hood', 'nsguanlong', 'mom', '3'), null);
  assert.equal(api.measure('hood', 'bafanshen', 'yoy', '1'), null);
  assert.equal(api.measure('hood', 'm-0', 'unknown', '1'), null);
});

test('market updates, checked periods and missing consecutive observations keep rates comparable after rerender', () => {
  const data = structuredClone(fine), market = data.markets[0];
  const api = make(data), xixiang = street('西乡街道');
  market.months['2030-10'] = {'1': {price: 100, yoy: 125, checkedAt:'2030-10-30'}};
  assert.equal(api.measure('hood','m-0','yoy','1').period, '2026-10');
  market.months['2026-10']['1'].yoy = -4.01;
  assert.equal(api.measure('street', xixiang, 'yoy', '1').value, -4.01);
  market.months['2026-10']['1'].yoy = null;
  assert.equal(api.measure('street', xixiang, 'yoy', '1'), null, 'never use an older year-over-year rate');
  delete market.months['2026-09']['1'];
  assert.equal(api.measure('street', xixiang, 'mom', '1'), null, 'August cannot stand in for September');
  market.months = {'2026-11': {'1': {price: 100, yoy: 2, checkedAt: '2026-11-23T09:00:00Z'}}};
  const current = api.measure('street', xixiang, 'yoy', '1');
  assert.match(current.period, /月内样本.*2026-11-23/);
  assert.equal(api.measure('street', xixiang, 'mom', '1'), null);
});

test('policy lists distinguish eligibility from housing locations, scope, application deadline and source', () => {
  const basePolicy = {title:'政策', subject:'符合条件的单位', date:'2026-11-01', summary:'按公告申报',
    source:'https://example.test/notice', sourceName:'公开通告'};
  const xixiang = street('西乡街道');
  const api = make(fine, [
    {...basePolicy, id:'general', scope:'city', areaIds:[], subject:'无房缴存职工'},
    {...basePolicy, id:'localized-city', scope:'city', areaIds:[], housingDistricts:['坪山区']},
    {...basePolicy, id:'baoan', scope:'district', areaIds:['宝安区'], applicationEnd:'2026-11-21',
      applicability:'仅限符合公告条件的单位', sites:[{name:'测试房源', district:'宝安区', streetId:xixiang}]},
    {...basePolicy, id:'nanshan', scope:'district', areaIds:['南山区']},
    {...basePolicy, id:'pingzhou', scope:'zone', areaIds:['zone-坪洲']},
    {...basePolicy, id:'specific', scope:'hood', areaIds:['west-mabu']},
    {...basePolicy, id:'unsafe', scope:'city', areaIds:[], source:'javascript:alert(1)'}
  ]);
  const ids = (kind, id) => Array.from(api.get(kind, id).policies, policy => policy.id).sort();
  assert.deepEqual(ids('zone', 'zone-坪洲'), ['baoan','general','pingzhou','specific']);
  assert.deepEqual(ids('zone', 'zone-固戍'), ['baoan','general']);
  assert.deepEqual(ids('district', '南山区'), ['general','nanshan']);
  assert.deepEqual(ids('district', '坪山区'), ['general','localized-city']);
  const html = api.panel('street',xixiang);
  assert.match(html, /全市 · 无房缴存职工/);
  assert.match(html, /仅限符合公告条件的单位/);
  assert.match(html, /受理已截止 2026-11-21/);
  assert.match(html, /本地房源 · 测试房源/);
  assert.match(html, /https:\/\/example\.test\/notice/);
});

test('published policy inventory keeps project addresses and closing times attached to their batch', () => {
  const policies = JSON.parse(read('data/policies.json')).policies;
  const api = make(fine, policies);
  const shenzhenBatch = 'sz-rental-2026-044';
  assert.ok(api.get('district', '龙华区').policies.some(p => p.id === shenzhenBatch));
  assert.ok(!api.get('district', '宝安区').policies.some(p => p.id === shenzhenBatch));
  const batch='ba-public-rental-2026-029-pingzhou-iii';
  const local=api.get('hood','e-pingzhou');
  assert.ok(local.policies.some(p=>p.id===batch&&p.local));
  assert.ok(local.localPolicyCount>0&&local.localPolicyCount<local.policies.length);
  assert.ok(!api.get('hood','west-mabu').policies.some(p=>p.id===batch));
  assert.match(api.panel('hood','e-pingzhou'),/53 套.*一房 1 套、二房 52 套/);
  const xili = api.panel('street',street('西丽街道'));
  assert.match(xili, /本地房源 · 创智云城4栋AB座/);
  assert.match(xili, /本地房源 · 冠铭花园/);
  assert.match(xili, /受理已截止 2026-11-10 18:00/);
  assert.match(xili, /申请截至 2026-11-29/);
  assert.match(api.panel('street',street('西乡街道')), /本地房源 · 海岚居/);
});
