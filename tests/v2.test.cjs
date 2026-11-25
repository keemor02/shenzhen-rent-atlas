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
    requestAnimationFrame: fn => { fn(); return 1; },
    localStorage: {
      getItem: k => mem.get(k) ?? null,
      setItem: (k, v) => mem.set(k, v),
    },
  });
  ctx.window = ctx;
  for (const f of ['src/rail.js', 'src/bus.js', 'src/map-camera.js', 'v2/store.js', 'v2/engine.js', 'v2/map.js']) {
    vm.runInContext(read(f), ctx);
  }
  const store = ctx.createV2Store(() => {});
  const engine = ctx.createV2Engine(atlas, structuredClone(travel), timing);
  return { store, engine, mem, ctx };
}

test('V2 unified data fixes 0/17 Xixiang footprint gap, Xinan facilities ID, and syncs Codex OSM mall/school facilities', () => {
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
  // Facilities expanded to 58 across 5 core streets (including Xinan 440306017000 + Codex mall & school!)
  assert.ok(atlas.facilities.length >= 58);
  const xinan = atlas.streets.find(s => s.id === '440306017000');
  assert.ok(xinan && xinan.facilityCount >= 5, 'Xinan street should have >=5 verified facilities');
  const cats = new Set(atlas.facilities.map(f => f.category));
  assert.ok(cats.has('mall') && cats.has('school'), 'mall and school categories must be present');
  assert.ok(atlas.migrations.length >= 2, 'office migration corridors present');
});

test('V2 nearbyFacilities calculates straight-line OSM distances within 2km for Pingzhou', () => {
  const { engine } = bootEngineAndStore();
  const pz = engine.placeById.get('e-pingzhou');
  assert.ok(pz);
  const near = engine.nearbyFacilities(pz);
  assert.ok(near.length >= 3, 'Pingzhou should find 宝安大仟里, 坪洲小学, 碧海小学 within 2km');
  const names = near.map(f => f.name);
  assert.ok(names.includes('宝安大仟里'));
  assert.ok(names.includes('深圳市宝安区坪洲小学'));
  assert.ok(names.includes('深圳市宝安区碧海小学'));
  assert.ok(near[0].meters < 1000, 'Nearest facility (大仟里) should be under 1km');
});

test('V2 engine filters strictly by housing type, verifiedOnly grain, and dual-workplace commute', () => {
  const { store, engine } = bootEngineAndStore();
  store.state.work = '留仙洞';
  store.state.work2 = '企鹅岛';
  store.state.limit = 45;
  store.state.limit2 = 55;
  store.state.room = '1';

  store.state.housingTypes = ['modernEstate'];
  const estRes = engine.evaluateAll(store.state, store);
  const mabu = estRes.rowById.get('west-mabu');
  assert.equal(mabu.eligible, false);
  const bihai = estRes.rowById.get('west-bihaiyuan');
  assert.ok(bihai.rent && bihai.rent.type === 'modernEstate');
  assert.ok(bihai.route && bihai.route2, 'dual-workplace routes computed');

  store.state.housingTypes = ['village', 'oldEstate', 'modernEstate', 'apartment'];
  store.state.verifiedOnly = true;
  const verRes = engine.evaluateAll(store.state, store);
  for (const row of verRes.rows) {
    if (row.rent) assert.ok(['project', 'official_affordable', 'personal'].includes(row.rent.grain));
  }
});

test('V2 location premium («非必要溢价») detects non-work hubs and clears penalty on toggleUsedHub', () => {
  const { store, engine } = bootEngineAndStore();
  store.state.work = '留仙洞';
  store.state.limit = 60;
  store.state.room = '1';
  const res1 = engine.evaluateAll(store.state, store);

  // 留仙洞附近可步行上班
  const liuxian = res1.rowById.get('e-liuxian');
  assert.equal(liuxian.premium.status, 'direct');

  // 兴东啤酒小镇：不在留仙洞步行圈内，却在「兴东啤酒小镇」步行圈内
  const beer = res1.rowById.get('e-beer');
  assert.ok(beer.premium.hub && beer.premium.hub.name === '兴东啤酒小镇');
  assert.ok(['premium', 'unknown', 'tradeoff', 'no-extra'].includes(beer.premium.status));

  // 点击「我常去这个园区」后状态立刻转为 used 且无扣分
  store.toggleUsedHub('兴东啤酒小镇');
  const res2 = engine.evaluateAll(store.state, store);
  const beer2 = res2.rowById.get('e-beer');
  assert.equal(beer2.premium.status, 'used');
  assert.equal(beer2.fit.premiumPenalty, 0);
});

test('V2 4-dimension personal fit score computes honest ranges, weights, and reference deltas', () => {
  const { store, engine } = bootEngineAndStore();
  store.state.work = '留仙洞';
  store.state.budget = 4500;
  store.state.limit = 50;
  store.state.room = '1';
  store.state.referencePlaceId = 'baxinlake';

  const res = engine.evaluateAll(store.state, store);
  const lake = res.rowById.get('baxinlake');
  assert.ok(lake.fit.count === 2, 'commute + rent known, environment + convenience pending');
  assert.ok(lake.fit.high > lake.fit.low, 'range should reflect unknown field ratings');
  assert.match(lake.fit.rangeText, /^\d+–\d+ 分$/);

  const guanlong = res.rowById.get('nsguanlong');
  assert.ok(guanlong.refDeltas.length > 0, 'comparison deltas against reference place computed');
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

test('V2.5 map renderer: unmistakable ↑贵¥ premium tag, hub walk rings, zero 圈外/0-icon spam, independent facility & risk overlays', () => {
  const { store, engine, ctx } = bootEngineAndStore();
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fakeSvg = {
    attrs: {},
    innerHTML: '',
    classList: { toggle() {} },
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener() {},
    getBoundingClientRect() { return { width: 1100, height: 680, left: 0, top: 0 }; },
    querySelector() { return null; },
  };
  const map = ctx.createV2Map(fakeSvg, atlas, engine, timing, esc);
  store.state.work = '大疆天空之城';
  store.state.selectedPlaceId = 'baxinlake';
  const evalResult = engine.evaluateAll(store.state, store);

  // 1. Rent lens: selected chip uses no-stroke + dashed walk leg + solid rail leg
  map.render({ state: store.state, evalResult, store });
  assert.match(fakeSvg.innerHTML, /class="no-stroke"[^>]*>新安湖花园二三期 · ¥4,117/);
  assert.match(fakeSvg.innerHTML, /stroke-dasharray="4 4"/, 'walk access leg should be dashed');

  // 2. Radar lens («议价与溢价»): draws 10-hub 15-min walk rings, NEVER prints 圈外 noise, uses ↑贵¥ (never bare +¥)
  store.state.lens = 'radar';
  map.render({ state: store.state, evalResult, store });
  assert.match(fakeSvg.innerHTML, /rgba\(255,218,120,0\.13\)/, 'own workplace 15-min walk halo ring drawn');
  assert.match(fakeSvg.innerHTML, /rgba\(226,125,96,0\.10\)/, 'other hub 15-min premium halo ring drawn');
  assert.doesNotMatch(fakeSvg.innerHTML, /圈外/, 'Must not spam 圈外 labels across the map');
  assert.doesNotMatch(fakeSvg.innerHTML, /\+¥\d+/, 'Must not display confusing +¥800 that looks like cheap rent');
  // If any place has premium status, ensure it uses ↑贵¥
  if (evalResult.rows.some(r => r.premium?.status === 'premium')) {
    assert.match(fakeSvg.innerHTML, /↑贵¥\d+/, 'Unnecessary premium badge must clearly state ↑贵¥');
  }

  // 3. Zoomed-in Xixiang footprints in Rent lens: honest range (1.4k–2.5k), NO ¥1,950 midpoint, NO 0-count insight icons!
  store.state.lens = 'rent';
  const pingzhou = engine.placeById.get('e-pingzhou');
  map.camera.fit(pingzhou.footprint.bounds);
  store.state.selectedPlaceId = 'e-pingzhou';
  map.render({ state: store.state, evalResult, store });
  assert.match(fakeSvg.innerHTML, /1\.4k–2\.5k/, 'Xixiang village band should display range, not fake single midpoint');
  assert.doesNotMatch(fakeSvg.innerHTML, /¥1,950/, 'Must not stamp identical ¥1,950 across Xixiang villages');
  assert.doesNotMatch(fakeSvg.innerHTML, /class="insight-stat no-stroke"[^>]*>0</, 'Must never draw zero-count insight icons');

  // 4. Independent overlays: facilities & 6-type risk icons work right on top of Rent lens!
  store.state.showFacilities = true;
  store.state.showRisks = true;
  map.render({ state: store.state, evalResult, store });
  assert.match(fakeSvg.innerHTML, /data-fac="osm-relation-19740575"/, 'Baoan Daqianli mall pin overlays cleanly on rent map');
  map.camera.reset();
  map.camera.control('in');
  map.render({ state: store.state, evalResult, store });
  assert.match(fakeSvg.innerHTML, /class="event-marker"/, '6-type public event icons render cleanly');
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

test('Built V2 index.html parses cleanly with zero JS syntax errors, CSS focus/stroke fixes, valid IDs, and CSP', () => {
  const html = read('index.html');
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /id="atlas-v2-data"/);
  assert.match(html, /#atlas-svg :focus \{ outline: none; \}/);
  assert.match(html, /#atlas-svg text\.no-stroke \{ stroke: none;/);
  assert.match(html, /--accent-ink: #0b221e/);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  assert.equal(scripts.length, 2);
  scripts.forEach((src, i) => new vm.Script(src, { filename: `v2-inline-${i}.js` }));

  const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  const ui = read('v2/ui.js');
  const dynamicIds = new Set(['place-note-form', 'btn-export-wl', 'input-import-wl', 'sec-evidence']);
  for (const m of ui.matchAll(/\$\('#([\w-]+)'\)|getElementById\('([\w-]+)'\)/g)) {
    const id = m[1] || m[2];
    if (!dynamicIds.has(id)) assert.ok(htmlIds.has(id), `Missing DOM id #${id} in v2/template.html`);
  }
});
