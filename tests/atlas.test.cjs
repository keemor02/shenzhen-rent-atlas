'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const atlas = JSON.parse(read('data/atlas-v3.json'));
const travel = JSON.parse(read('data/journey.json'));
const timing = JSON.parse(read('data/timing.json'));

function bootV3(initialStorage = {}) {
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
  for (const f of ['app/rail.js', 'app/bus.js', 'app/map-camera.js', 'app/store.js', 'app/engine.js', 'app/map.js']) {
    vm.runInContext(read(f), ctx);
  }
  const store = ctx.createV3Store(() => {});
  const engine = ctx.createV3Engine(atlas, structuredClone(travel), timing);
  return { store, engine, mem, ctx };
}

test('V3 seamless plates cover all Shenzhen with 100% honest unitPrice, terrain, 16 metro lines, landmarks and 500+ destinations', () => {
  assert.ok(atlas.plates.length >= 95, 'Should subdivide core streets into ~98 seamless living plates');
  for (const pl of atlas.plates) {
    assert.ok(pl.unitPrice > 0, `${pl.name} must have an honest 元/㎡·月 unitPrice`);
    assert.ok(pl.unitBasis, `${pl.name} must declare unitBasis`);
  }
  assert.ok(atlas.terrain.mountains.length >= 9);
  assert.ok(atlas.terrain.water.length >= 5);
  assert.ok(atlas.terrain.airport && atlas.terrain.airport.p);
  assert.equal(atlas.metroLines.length, 16);
  assert.ok(atlas.landmarks.length >= 30);
  assert.ok(atlas.destinations.length >= 500, 'Should support 500+ arbitrary destinations');
  assert.ok(atlas.facilities.length >= 58);
});

test('V3 engine resolves and routes to ANY landmark, mall, metro station, bus hub, plate or school', () => {
  const { store, engine } = bootV3();
  for (const q of ['万象天地', '壹方城', '宝安大仟里', '留仙洞', '翻身', '深圳市宝安区坪洲小学']) {
    const d = engine.resolveDestination(q);
    assert.ok(d && d.coord.length === 2, `Should resolve destination: ${q}`);
  }

  store.state.work = '万象天地';
  store.state.work2 = '企鹅岛';
  store.state.limit = 55;
  const res = engine.evaluateAll(store.state, store);
  assert.equal(res.dest1.name, '万象天地');
  const pz = res.plateRowById.get('p-pingzhou');
  assert.ok(pz.route && pz.route.minutes > 10 && pz.route.minutes < 90);
  assert.ok(pz.route2 && pz.route2.minutes > 5);
  assert.ok(pz.nearbyFacs.some(f => f.name === '宝安大仟里'), 'Pingzhou plate includes 宝安大仟里 nearby');
});

test('V3 unnecessary location premium detects non-work hub plates and clears on toggleUsedHub', () => {
  const { store, engine } = bootV3();
  store.state.work = '留仙洞';
  store.state.limit = 60;
  const res1 = engine.evaluateAll(store.state, store);

  const lx = res1.plateRowById.get('p-liuxian');
  assert.equal(lx.premium.status, 'direct');

  const xingdong = res1.plateRowById.get('p-xingdong');
  assert.ok(xingdong.premium.hub && xingdong.premium.hub.name === '兴东啤酒小镇');

  const kexingPlate = res1.plateRowById.get('p-shenda');
  assert.ok(kexingPlate.premium.hub && kexingPlate.premium.hub.name === '科兴科学园');

  store.toggleUsedHub('科兴科学园');
  const res2 = engine.evaluateAll(store.state, store);
  assert.equal(res2.plateRowById.get('p-shenda').premium.status, 'used');
  assert.equal(res2.plateRowById.get('p-shenda').fit.premiumPenalty, 0);
});

test('V3 jigsaw map renders 元/㎡ by default, mountains/water/metro/landmarks, ↑贵¥ radar stamps, and zero floating 圈外 spam', () => {
  const { store, engine, ctx } = bootV3();
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fakeSvg = {
    attrs: {}, innerHTML: '', classList: { toggle() {} },
    setAttribute(k, v) { this.attrs[k] = v; }, addEventListener() {},
    getBoundingClientRect() { return { width: 1200, height: 700, left: 0, top: 0 }; },
    querySelector() { return null; },
  };
  const map = ctx.createV3Map(fakeSvg, atlas, engine, timing, esc);
  store.state.work = '留仙洞';
  const evalResult = engine.evaluateAll(store.state, store);

  // 1. Rent lens: 元/㎡ labels + mountains + water + metro skeleton + landmarks
  map.render({ state: store.state, evalResult, store });
  assert.match(fakeSvg.innerHTML, /class="terrain-mtn"/);
  assert.match(fakeSvg.innerHTML, /class="terrain-water"/);
  assert.match(fakeSvg.innerHTML, /class="metro-skeleton"/);
  assert.match(fakeSvg.innerHTML, /class="landmark-pin"/);
  assert.match(fakeSvg.innerHTML, /\d+元\/㎡/, 'Overview rent map should show 元/㎡ unit prices');

  // 2. Radar lens: hub 15-min rings, migration arrows, zero 圈外, unmistakable ↑贵¥ (never +¥)
  store.state.lens = 'radar';
  map.render({ state: store.state, evalResult, store });
  assert.match(fakeSvg.innerHTML, /rgba\(255,218,120,0\.13\)/);
  assert.match(fakeSvg.innerHTML, /科兴→企鹅岛/);
  assert.doesNotMatch(fakeSvg.innerHTML, /圈外/);
  assert.doesNotMatch(fakeSvg.innerHTML, /\+¥\d+/);
  if (evalResult.plateRows.some(r => r.premium?.status === 'premium')) {
    assert.match(fakeSvg.innerHTML, /↑贵¥\d+/);
  }

  // 3. Radial 10-minute rings around arbitrary mall destination (万象天地)
  store.state.work = '万象天地';
  store.state.lens = 'commute';
  store.state.layout = 'radial';
  const resMall = engine.evaluateAll(store.state, store);
  map.render({ state: store.state, evalResult: resMall, store });
  assert.match(fakeSvg.innerHTML, /万象天地/);
  assert.match(fakeSvg.innerHTML, /10分/);
});

test('V3 store losslessly preserves legacy shenzhen-rent-atlas.journal.v1 bookmarks & notes', () => {
  const legacy = JSON.stringify({
    format: 'shenzhen-rent-journal', version: 1, chosenId: 'nsguanlong',
    entries: [{
      id: 'nsguanlong', name: '官龙村 · 官龙名苑', saved: true, chosen: true,
      environment: 4, convenience: 5, monthly: 2400, note: '旧版踩点笔记', observed: '2026-11-20', updatedAt: '2026-11-20T00:00:00Z',
    }],
  });
  const { store } = bootV3({ 'shenzhen-rent-atlas.journal.v1': legacy });
  assert.equal(store.isSaved('nsguanlong'), true);
  assert.equal(store.getEntry('nsguanlong').monthly, 2400);
  assert.equal(store.getEntry('nsguanlong').note, '旧版踩点笔记');
});

test('Built index.html has lossless packed driving matrix, valid JS syntax, strict CSP, and zero missing DOM IDs', () => {
  const html = read('index.html');
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /id="atlas-v3-data"/);
  assert.match(html, /#atlas-svg :focus \{ outline: none; \}/);
  assert.match(html, /#atlas-svg text\.no-stroke \{ stroke: none;/);

  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  assert.equal(scripts.length, 2);
  scripts.forEach((src, i) => new vm.Script(src, { filename: `v3-inline-${i}.js` }));

  // Verify lossless packed driving matrix decode
  const jMatch = html.match(/<script type="application\/json" id="journey-data">([\s\S]*?)<\/script>/);
  const embedded = JSON.parse(jMatch[1]);
  assert.ok(embedded.driving?.packed?.durations);
  const unpack = (b64, n) => {
    const buf = Buffer.from(b64, 'base64'), rows = new Array(n);
    let p = 0;
    for (let i = 0; i < n; i++) {
      const row = new Int32Array(n); let prev = 0;
      for (let j = 0; j < n; j++) {
        let z = 0, shift = 0, b;
        do { b = buf[p++]; z |= (b & 127) << shift; shift += 7; } while (b & 128);
        prev += (z & 1) ? -((z + 1) >>> 1) : (z >>> 1);
        row[j] = prev;
      }
      rows[i] = row;
    }
    return rows;
  };
  const decDur = unpack(embedded.driving.packed.durations, embedded.driving.packed.n);
  assert.equal(decDur.length, travel.driving.durations.length);
  for (let i = 0; i < decDur.length; i += 17) {
    assert.deepEqual(Array.from(decDur[i]), travel.driving.durations[i]);
  }

  // Verify all queried static DOM IDs exist
  const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  const ui = read('app/ui.js');
  const dynamicIds = new Set(['place-note-form', 'btn-export-wl', 'input-import-wl']);
  for (const m of ui.matchAll(/\$\('#([\w-]+)'\)|getElementById\('([\w-]+)'\)/g)) {
    const id = m[1] || m[2];
    if (!dynamicIds.has(id)) assert.ok(htmlIds.has(id), `Missing DOM id #${id} in app/template.html`);
  }
});
