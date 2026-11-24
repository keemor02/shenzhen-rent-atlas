'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const atlas = JSON.parse(read('data/atlas-v2.json'));
const travel = JSON.parse(read('data/journey.json'));
const timing = JSON.parse(read('data/timing.json'));

function bootEngineAndStore(initialStorage = {}) {
  const mem = new Map(Object.entries(initialStorage));
  const ctx = vm.createContext({
    window: {},
    atob,
    localStorage: {
      getItem: k => mem.get(k) ?? null,
      setItem: (k, v) => mem.set(k, v),
    },
  });
  ctx.window = ctx;
  for (const f of ['src/rail.js', 'src/bus.js', 'v2/store.js', 'v2/engine.js']) {
    vm.runInContext(read(f), ctx);
  }
  const store = ctx.createV2Store(() => {});
  const engine = ctx.createV2Engine(atlas, structuredClone(travel), timing);
  return { store, engine, mem };
}

test('V2 unified data fixes 0/17 Xixiang footprint gap and separates village from modernEstate', () => {
  const fps = atlas.places.filter(p => p.footprint);
  assert.equal(fps.length, 17);
  for (const fp of fps) {
    assert.ok(fp.rents.length > 0, `${fp.name} should have rent data`);
    if (fp.footprint.kind === '城中村') {
      assert.ok(fp.housingTypes.includes('village'), `${fp.name} should be typed village`);
      assert.ok(!fp.housingTypes.includes('modernEstate'), `${fp.name} must not mix modernEstate`);
    } else {
      assert.ok(fp.housingTypes.includes('modernEstate'), `${fp.name} should be typed modernEstate`);
      assert.ok(!fp.housingTypes.includes('village'), `${fp.name} must not mix village`);
    }
  }
  // Official 2026-11 Nanshan 045 projects present with exact official unit prices
  const cz = atlas.places.find(p => p.id === 'v2-chuangzhi-yuncheng');
  assert.ok(cz && cz.rents[0].grain === 'official_affordable' && cz.rents[0].unitPrice === 48.6);
  // Facilities expanded to 5 core streets
  assert.ok(atlas.facilities.length >= 55);
  assert.ok(new Set(atlas.facilities.map(f => f.streetId)).size >= 5);
});

test('V2 engine filters strictly by housing type, verifiedOnly grain, and dual-workplace commute', () => {
  const { store, engine } = bootEngineAndStore();
  store.state.work = '留仙洞';
  store.state.work2 = '企鹅岛';
  store.state.limit = 45;
  store.state.limit2 = 55;
  store.state.room = '1';

  // Only modernEstate: excludes pure villages like 麻布新村
  store.state.housingTypes = ['modernEstate'];
  const estRes = engine.evaluateAll(store.state, store);
  const mabu = estRes.rowById.get('west-mabu');
  assert.equal(mabu.eligible, false);
  const bihai = estRes.rowById.get('west-bihaiyuan');
  assert.ok(bihai.rent && bihai.rent.type === 'modernEstate');
  assert.ok(bihai.route && bihai.route2, 'dual-workplace routes computed');

  // verifiedOnly excludes band/market references
  store.state.housingTypes = ['village', 'oldEstate', 'modernEstate', 'apartment'];
  store.state.verifiedOnly = true;
  const verRes = engine.evaluateAll(store.state, store);
  for (const row of verRes.rows) {
    if (row.rent) assert.ok(['project', 'official_affordable', 'personal'].includes(row.rent.grain));
  }
});

test('V2 dynamic arbitrage radar surfaces event-driven opportunities and peer price gaps', () => {
  const { store, engine } = bootEngineAndStore();
  store.state.work = '留仙洞';
  store.state.limit = 50;
  store.state.room = '1';
  const res = engine.evaluateAll(store.state, store);

  const liuxian = res.rowById.get('v2-chuangzhi-yuncheng');
  assert.equal(liuxian.arbitrage.status, 'opportunity');
  assert.ok(liuxian.arbitrage.reasons.length > 0);

  const pingzhou = res.rowById.get('e-pingzhou');
  assert.equal(pingzhou.arbitrage.status, 'opportunity');
  assert.ok(res.eligibleRows.some(r => r.arbitrage.status === 'opportunity'));
});

test('V2 store migrates legacy v1 journal bookmarks and field ratings losslessly', () => {
  const legacy = JSON.stringify({
    format: 'shenzhen-rent-journal',
    version: 1,
    chosenId: 'nsguanlong',
    entries: [{
      id: 'nsguanlong', name: '官龙村 · 官龙名苑', saved: true, chosen: true,
      environment: 4, convenience: 5, monthly: 2400, note: '旧版踩点笔记', observed: '2026-11-20', updatedAt: '2026-11-20T00:00:00Z',
    }],
  });
  const { store } = bootEngineAndStore({ 'shenzhen-rent-atlas.journal.v1': legacy });
  assert.equal(store.isSaved('nsguanlong'), true);
  const e = store.getEntry('nsguanlong');
  assert.equal(e.environment, 4);
  assert.equal(e.convenience, 5);
  assert.equal(e.monthly, 2400);
  assert.equal(e.note, '旧版踩点笔记');
});

test('Built V2 index.html parses cleanly with zero JS syntax errors, valid IDs, and CSP', () => {
  const html = read('index.html');
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /id="atlas-v2-data"/);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  assert.equal(scripts.length, 2);
  scripts.forEach((src, i) => new vm.Script(src, { filename: `v2-inline-${i}.js` }));

  // Check every static DOM ID queried in v2/ui.js exists in v2/template.html
  const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  const ui = read('v2/ui.js');
  const dynamicIds = new Set(['place-note-form', 'btn-export-wl', 'input-import-wl']);
  for (const m of ui.matchAll(/\$\('#([\w-]+)'\)|getElementById\('([\w-]+)'\)/g)) {
    const id = m[1] || m[2];
    if (!dynamicIds.has(id)) assert.ok(htmlIds.has(id), `Missing DOM id #${id} in v2/template.html`);
  }
});
