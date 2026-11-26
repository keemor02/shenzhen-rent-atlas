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

function bootNext(initialStorage = {}) {
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
  for (const f of ['app/rail.js', 'app/bus.js', 'app/map-camera.js', 'app/store.js', 'app/engine.js', 'app/next/themes.js', 'app/next/next-map.js']) {
    vm.runInContext(read(f), ctx);
  }
  const store = ctx.createV3Store(() => {});
  const engine = ctx.createV3Engine(atlas, structuredClone(travel), timing);
  return { store, engine, ctx };
}

test('Hyrule map + Apple UI renders clean overview pills, layer overlays, 6-type risk icons, 10-min rings & affordable view', () => {
  const { store, engine, ctx } = bootNext();
  const theme = ctx.NEXT_THEME;
  assert.equal(theme.id, 'hyrule-apple');
  assert.equal(theme.map.bg, '#ebe0c5');
  assert.ok(ctx.NextEventIcons?.EVENT_TYPES?.works, '6-type vector risk icons should be exposed');

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fakeSvg = {
    attrs: {}, innerHTML: '', classList: { toggle() {} },
    setAttribute(k, v) { this.attrs[k] = v; }, addEventListener() {},
    getBoundingClientRect() { return { width: 1440, height: 900, left: 0, top: 0 }; },
    querySelector() { return null; },
  };
  const map = ctx.createNextMap(fakeSvg, atlas, engine, timing, esc);
  store.state.work = '科兴科学园';
  store.state.limit = 75;
  store.state.sqm = 50;
  const evalResult = engine.evaluateAll(store.state, store);

  // 1. Default overview (score) renders Zelda parchment, alert badges, signal dots & beacon
  const legend = map.render({ state: store.state, evalResult, store, theme, leftInset: 370 });
  assert.match(fakeSvg.innerHTML, /fill="#ebe0c5"/);
  assert.match(fakeSvg.innerHTML, /class="nx-pill/);
  assert.match(fakeSvg.innerHTML, /class="nx-alert-badge/, 'Default view should surface major surge/drop ! badges');
  assert.match(fakeSvg.innerHTML, /class="dest-beacon"/);
  assert.match(legend, /≥82/);

  // 2. Enabling trend overlay in 图层 embeds YoY % into rent view pills without losing rent fill
  store.toggleLayer('trend');
  const trendLegend = map.render({ state: store.state, evalResult, store, theme, leftInset: 370 });
  assert.match(trendLegend, /&lt;-8%/);
  store.setFillLayer('rent');
  map.render({ state: store.state, evalResult, store, theme, leftInset: 370 });
  assert.match(fakeSvg.innerHTML, /[↑↓]\d+(\.\d)?%/, 'Rent view pills should embed trend delta when trend overlay is ON');

  // 3. Enabling premium & density & risks overlays renders migration arcs, density chips & 6-type risk icons
  store.toggleLayer('premium');
  const premLegend = map.render({ state: store.state, evalResult, store, theme, leftInset: 370 });
  assert.match(fakeSvg.innerHTML, /class="migration-arc"/);
  assert.match(premLegend, /高溢价/);

  store.toggleLayer('density');
  map.render({ state: store.state, evalResult, store, theme, leftInset: 370 });
  assert.match(fakeSvg.innerHTML, /人口 \d+\.\d+万\/km²/, 'Density overlay should add street population chips to plate pills');

  // Turning density OFF must truly hide population density chips even when zoomed in deeply
  store.toggleLayer('density');
  map.camera.control('in'); map.camera.control('in');
  map.render({ state: store.state, evalResult, store, theme, leftInset: 370 });
  assert.doesNotMatch(fakeSvg.innerHTML, /人口 \d+\.\d+万\/km²/, 'Turning off density layer must remove population chips even at close zoom');
  assert.match(fakeSvg.innerHTML, /data-tier="(?:full|compact|micro|muted)"/, 'Responsive pill placement should adapt footprint instead of hiding plates');
  map.camera.reset();

  store.toggleLayer('risks');
  map.render({ state: store.state, evalResult, store, theme, leftInset: 370 });
  assert.match(fakeSvg.innerHTML, /class="event-marker"/, 'Risks overlay should render 6-type vector risk markers');

  // 4. Selecting a plate expands its 2-line rich info banner
  store.state.selectedPlateId = 'p-pingzhou';
  map.render({ state: store.state, evalResult, store, theme, leftInset: 370 });
  assert.match(fakeSvg.innerHTML, /nx-pill is-active has-sub/, 'Selected plate should expand into 2-line rich banner');
  store.state.selectedPlateId = '';

  // 5. Radial 10-min rings & affordable track
  store.toggleLayer('commute');
  store.state.layout = 'radial';
  const radEval = engine.evaluateAll(store.state, store);
  map.render({ state: store.state, evalResult: radEval, store, theme, leftInset: 370 });
  assert.match(fakeSvg.innerHTML, /10分/);

  store.state.layout = 'geo';
  store.setHousingTrack('affordable');
  const affEval = engine.evaluateAll(store.state, store);
  const affLegend = map.render({ state: store.state, evalResult: affEval, store, theme, leftInset: 370 });
  assert.match(fakeSvg.innerHTML, /class="aff-pin"/);
  assert.match(affLegend, /申请中/);
});

test('Built next.html obeys 3-tab bottom bar, strict compliance, valid JS syntax, offline CSP, mobile safe-area & zero missing DOM IDs', () => {
  const html = read('next.html');
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /height:\s*100dvh/);
  assert.match(html, /env\(safe-area-inset-bottom\)/);
  assert.match(html, /id="nx-sheet"/);
  assert.match(html, /id="nx-mobile-tabs"/);

  // Bottom main view bar must have strictly 3 buttons: 推荐 / 租金 / 通勤
  const viewSegMatch = html.match(/id="nx-view-seg"[^>]*>([\s\S]*?)<\/div>/);
  assert.ok(viewSegMatch, 'Missing #nx-view-seg');
  const bottomBtns = [...viewSegMatch[1].matchAll(/data-fill-layer="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(bottomBtns, ['score', 'rent', 'commute'], 'Bottom bar must strictly keep only 3 views: score, rent, commute');

  const nextSources = ['themes.js', 'next-map.js', 'next-ui.js', 'template.html', 'next.css'].map(f => read('app/next/' + f)).join('\n');
  assert.doesNotMatch(nextSources, /zu\.ke\.com|ziroom\.com|leyoujia\.com|inboyu\.com|万科泊寓|龙湖冠寓|魔方公寓|微棠新青年|multiSourceRents/, 'Consumer UI must strictly exclude commercial platform links & brand-store quotes');

  const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  const ui = read('app/next/next-ui.js');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  assert.equal(scripts.length, 1);
  new vm.Script(scripts[0], { filename: 'next-inline.js' });
  assert.match(ui, /ensureModeReady/, 'next-ui.js must lazily trigger bus/drive decompression when switching modes');
  assert.match(ui, /contextmenu/, 'next-ui.js must support right-click destination setting');
  assert.match(ui, /data-toggle-ref/, 'next-ui.js must support baseline plate comparison');
  assert.doesNotMatch(html, /<feMorphology|<feDropShadow/, 'next.html must eliminate CPU SVG filters feMorphology & feDropShadow for 60fps pan/zoom');
  assert.doesNotMatch(read('app/next/next.css'), /vector-effect:\s*none/, 'Panning CSS must never strip non-scaling-stroke or borders explode when zoomed in');
  assert.match(read('app/next/next-map.js'), /reuseGeo/, 'next-map.js should keep static .v3-geo DOM persistent across pan/zoom settles');
  assert.match(read('app/next/next-map.js'), /labelScaleFor/, 'next-map.js should smoothly enlarge map typography as user zooms into neighborhoods');

  const dynamicIds = new Set(['nx-btn-export', 'nx-input-import']);
  for (const m of ui.matchAll(/\$\('#([\w-]+)'\)|getElementById\('([\w-]+)'\)/g)) {
    const id = m[1] || m[2];
    if (!dynamicIds.has(id)) assert.ok(htmlIds.has(id), `Missing DOM id #${id} in app/next/template.html`);
  }
});
