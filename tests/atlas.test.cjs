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
  assert.ok(atlas.plates.length >= 115, 'Should subdivide 30 core/large Shenzhen streets into ~118 seamless living plates');
  for (const pl of atlas.plates) {
    assert.ok(pl.unitPrice > 0, `${pl.name} must have an honest 元/㎡·月 unitPrice`);
    assert.ok(pl.unitBasis, `${pl.name} must declare unitBasis`);
    assert.ok(pl.streetPop > 0 && pl.streetAreaKm2 > 0 && pl.streetDensity > 0, `${pl.name} must carry real 7th-census street density`);
  }
  const byId = new Map(atlas.plates.map(p => [p.id, p]));
  assert.ok(byId.get('p-baozhong').streetDensity > byId.get('p-pingzhou').streetDensity, '新安街道 density must exceed 西乡街道');
  assert.ok(byId.get('p-pingzhou').streetDensity > byId.get('p-hourui').streetDensity, '西乡街道 density must exceed 航城街道');
  assert.ok(byId.get('p-nantougucheng').streetDensity > byId.get('p-xilicenter').streetDensity, '南头街道 density must exceed 西丽街道');
  assert.ok(byId.get('p-gaoxinyuan').streetDensity > byId.get('p-liuxian').streetDensity, '粤海街道 density must exceed 西丽街道');
  for (const syId of ['p-yingrenshi', 'p-luozu', 'p-shiyancenter', 'p-guantian', 'p-baishizhou', 'p-shangmeilin', 'p-xiameilin', 'p-longsheng', 'p-bujicenter', 'p-fenghuangcheng']) {
    assert.ok(byId.has(syId), `Newly subdivided major plate ${syId} must exist`);
  }
  const withMulti = atlas.plates.filter(p => (p.multiSourceRents || []).length > 0);
  assert.ok(withMulti.length >= 18, 'Core plates should include multi-source brand apartment & Beike/Leyoujia rent benchmarks');
  const allBrands = new Set(withMulti.flatMap(p => p.multiSourceRents.map(m => m.brand)));
  for (const br of ['万科泊寓', '龙湖冠寓', '自如', '魔方公寓', '微棠新青年社区', '贝壳/乐有家']) {
    assert.ok(allBrands.has(br), `Multi-source rent dataset should include ${br}`);
  }
  assert.ok(atlas.terrain.mountains.length >= 9);
  assert.ok(atlas.terrain.water.length >= 5);
  assert.ok(atlas.terrain.airport && atlas.terrain.airport.p);
  assert.equal(atlas.metroLines.length, 16);
  assert.ok(atlas.landmarks.length >= 40, 'Should include core landmarks + top curated towers');
  assert.ok(atlas.destinations.length >= 600, 'Should support 600+ arbitrary destinations including iconic offices & tech parks');
  assert.ok(atlas.facilities.length >= 58);

  // Every listed child estate inside plates must be a real residential place with actual rent data (zero fake event anchors!)
  const placeById = new Map(atlas.places.map(p => [p.id, p]));
  for (const pl of atlas.plates) {
    for (const cid of pl.placeIds) {
      const child = placeById.get(cid);
      assert.ok(child && child.rents.length > 0, `Child estate ${cid} inside ${pl.name} must have real rents`);
      assert.notEqual(child.kind, '片区参考', `Fake event anchor ${child.shortName} must not appear as a child estate`);
    }
  }
});

test('V3 engine resolves and routes to ANY landmark, iconic office tower, mall, metro station, bus hub, plate or school', () => {
  const { store, engine } = bootV3();
  for (const q of [
    '万象天地', '壹方城', '宝安大仟里', '留仙洞', '翻身', '深圳市宝安区坪洲小学',
    '汉京', '春笋', 'f518', '星河world', '梧桐岛', '天安云谷', '平安金融中心', '宝安大悦城', '福田口岸', '字节',
  ]) {
    const d = engine.resolveDestination(q);
    assert.ok(d && d.coord.length === 2, `Should resolve destination: ${q}`);
  }
  assert.equal(engine.resolveDestination('汉京').name, '汉京金融中心');
  assert.equal(engine.resolveDestination('春笋').name, '中国华润大厦（春笋）');
  assert.equal(engine.resolveDestination('f518').name, 'F518时尚创意园');
  assert.equal(engine.resolveDestination('星河world').name, '星河WORLD');
  assert.ok(engine.searchDestinations('汉京').some(d => d.name === '汉京金融中心'));
  assert.ok(engine.searchDestinations('tcl').some(d => d.name === 'TCL国际E城'));

  store.state.work = '万象天地';
  store.state.work2 = '企鹅岛';
  store.state.limit = 55;
  const res = engine.evaluateAll(store.state, store);
  assert.equal(res.dest1.name, '万象天地');
  const pz = res.plateRowById.get('p-pingzhou');
  assert.ok(pz.route && pz.route.minutes > 10 && pz.route.minutes < 90);
  assert.ok(pz.route2 && pz.route2.minutes > 5);
  assert.ok(pz.nearbyFacs.some(f => f.name === '宝安大仟里'), 'Pingzhou plate includes 宝安大仟里 nearby');
  assert.ok(
    pz.arbitrage.reasons.every(r => !/(保租|公租|安居|配租)/.test(r)),
    'Market housing track must NOT use affordable/public housing notices as bargain clues'
  );
  const lxMarket = res.plateRowById.get('p-liuxian');
  assert.ok(
    lxMarket.arbitrage.reasons.every(r => !/(保租|公租|安居|配租)/.test(r)),
    'Liuxian in market housing track must NOT cite affordable housing conversions as market bargain clues'
  );

  // Verify morning rush-hour estimation adds realistic queue/congestion time for both rail & driving
  store.state.peak = true;
  const resPeakRail = engine.evaluateAll(store.state, store);
  const pzPeakRail = resPeakRail.plateRowById.get('p-pingzhou');
  assert.ok(pzPeakRail.route.minutes > pz.route.minutes + 5, 'Pingzhou morning rush rail should add flow-control & transfer buffer');
  assert.match(pzPeakRail.route.peakDetail, /早高峰估算/);

  store.state.mode = 'drive';
  store.state.peak = false;
  const pzOffDrive = engine.evaluateAll(store.state, store).plateRowById.get('p-pingzhou');
  store.state.peak = true;
  const pzPeakDrive = engine.evaluateAll(store.state, store).plateRowById.get('p-pingzhou');
  assert.ok(pzPeakDrive.route.minutes > pzOffDrive.route.minutes + 5, 'Inbound morning rush driving should add tidal congestion buffer');
  store.state.mode = 'rail';
  store.state.peak = false;
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

  // Verify Pingzhou across water does NOT falsely claim 0-min walk to Penguin Island
  const pzCheck = res1.plateRowById.get('p-pingzhou');
  assert.notEqual(pzCheck.premium.hub?.name, '企鹅岛', 'Pingzhou must not falsely inherit Penguin Island as 0-min walk');

  store.toggleUsedHub('科兴科学园');
  const res2 = engine.evaluateAll(store.state, store);
  assert.equal(res2.plateRowById.get('p-shenda').premium.status, 'used');
  assert.equal(res2.plateRowById.get('p-shenda').fit.premiumPenalty, 0);
});

test('V3.5 strategy map renders Civ 6 banners, Cities Skylines influence lines, landmark aura, field mastery & zero 圈外 spam', () => {
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

  // Verify location-accurate facility attribution (坪洲 gets mall & school; 固戍 does not falsely inherit 宝安大仟里)
  const pzPlate = engine.plateById.get('p-pingzhou');
  const gsPlate = engine.plateById.get('p-gushu');
  assert.ok(pzPlate.lines.includes('1') && pzPlate.lines.includes('12'), 'Pingzhou plate should carry Metro lines 1 & 12');
  assert.ok(pzPlate.facCats.includes('mall') && pzPlate.facCats.includes('school'));
  assert.ok(!gsPlate.facCats.includes('mall'), 'Gushu should not inherit distant 宝安大仟里');

  const evalResult = engine.evaluateAll(store.state, store);

  // 1. Rent lens overview: Civ 6 compact banners + capital destination beacon + quiet hidden metro skeleton
  map.render({ state: store.state, evalResult, store });
  assert.match(fakeSvg.innerHTML, /class="terrain-mtn"/);
  assert.match(fakeSvg.innerHTML, /class="terrain-water"/);
  assert.doesNotMatch(fakeSvg.innerHTML, /class="metro-skeleton"/, 'Metro cobweb lines should stay hidden at overview rent zoom');
  assert.match(fakeSvg.innerHTML, /class="dest-beacon"/, 'Chosen destination should render prominent capital beacon');
  assert.match(fakeSvg.innerHTML, /★ 目的地 · 留仙洞/);
  assert.match(fakeSvg.innerHTML, /class="landmark-pin"/);
  assert.match(fakeSvg.innerHTML, /class="civ-banner"/);
  assert.match(fakeSvg.innerHTML, /\d+\/㎡/, 'Civ 6 banners should show compact 元/㎡ prices');

  // 2. Clipped silhouette selection glow + focus dimming + restrained local influence lines + expanded Civ 6 bar
  store.saveNote('p-pingzhou', '坪洲板块', { monthly: 2300, environment: 4, convenience: 5, note: '实勘大仟里旁' });
  const evalVisited = engine.evaluateAll(store.state, store);
  assert.equal(evalVisited.plateRowById.get('p-pingzhou').mastery.visited, true);
  assert.equal(evalVisited.plateRowById.get('p-pingzhou').mastery.avgStar, 4.5);

  store.state.selectedPlateId = 'p-pingzhou';
  map.camera.fit(pzPlate.bounds);
  map.render({ state: store.state, evalResult: evalVisited, store });
  assert.match(fakeSvg.innerHTML, /fill-opacity="0\.34"/, 'Selecting a plate should dim surrounding plates');
  assert.match(fakeSvg.innerHTML, /id="v3-sel-glow"/, 'Selected subdivided plate should use clipped-silhouette glow filter');
  assert.match(fakeSvg.innerHTML, /class="plate-selected-wrap"/);
  assert.match(fakeSvg.innerHTML, /class="map-dest-cta"/, 'Selected non-destination plate should expose direct on-map ★ 设为目的地 button');
  assert.match(fakeSvg.innerHTML, /class="metro-skeleton"/, 'Subtle metro lines may appear at close zoom');
  assert.match(fakeSvg.innerHTML, /class="influence-line-good"/, 'Pingzhou should draw green influence beams to nearby verified facilities');
  assert.match(fakeSvg.innerHTML, /宝安大仟里/);
  assert.match(fakeSvg.innerHTML, /1\/12号线/, 'Expanded Civ 6 banner should display plain Chinese metro lines instead of cryptic M1·12');
  assert.doesNotMatch(fakeSvg.innerHTML, />M\d/, 'Should never show cryptic M-prefixed metro tags');
  assert.match(fakeSvg.innerHTML, /✓4\.5/, 'Field-visited plate should display mastery badge on Civ 6 banner');

  // 2.5 Area-based live monthly rent estimation on map (sqm = 40)
  store.state.sqm = 40;
  const evalSqm = engine.evaluateAll(store.state, store);
  assert.equal(evalSqm.plateRowById.get('p-pingzhou').estMonthly, Math.round(pzPlate.unitPrice * 40));
  const sqmLegend = map.render({ state: store.state, evalResult: evalSqm, store });
  assert.match(fakeSvg.innerHTML, /约¥[\d,]+/, 'Map banners should switch to unified yuan monthly rent when living area is entered');
  assert.doesNotMatch(fakeSvg.innerHTML, /¥[\d.]+k/, 'Rent values must never mix English k with Chinese 万');
  assert.match(sqmLegend, /按 40㎡ 估月租/);
  store.state.sqm = 0;

  // 2.6 Composable multi-layer switches: trend sits immediately after rent (before commute!), legend carries unified fill selector, density uses unified 万/km²
  assert.ok(atlas.affordableProjects.length >= 12, 'Should ship verified existing + upcoming affordable housing projects');
  store.state.selectedPlateId = '';
  store.toggleLayer('commute');
  store.toggleLayer('trend');
  store.toggleLayer('density');
  map.camera.reset();
  const comboLegend = map.render({ state: store.state, evalResult: evalVisited, store });
  assert.match(fakeSvg.innerHTML, /\d+\/㎡<tspan[^>]*>\([+-][\d.]+%\)<\/tspan><tspan[^>]*> · <\/tspan>\d+分/, 'Trend percentage should sit immediately after rent and before commute minutes');
  assert.match(fakeSvg.innerHTML, /class="density-pill"/, 'Density badge should render dedicated color-graded pill with people icon');
  assert.match(fakeSvg.innerHTML, /人口 \d+\.\d{2}万\/km²/, 'Density pill should uniformly use 万/km² with 人口 label');
  assert.doesNotMatch(fakeSvg.innerHTML, /\dk\/km²/, 'Density must never mix 10k with 1.2万');
  assert.match(fakeSvg.innerHTML, /fill="#4d3b15"|fill="#59231d"/, 'Higher-density districts should use warm amber/red graded density pills');
  assert.match(comboLegend, /data-fill-select/, 'Legend should embed compact fill selector instead of duplicate button row');
  assert.match(comboLegend, /人口密度/);

  // 2.7 Separate housing track: 保租房 track isolates affordable projects from market housing
  store.setHousingTrack('affordable');
  const affLegend = map.render({ state: store.state, evalResult: evalVisited, store });
  assert.match(fakeSvg.innerHTML, /class="aff-pin"/, 'Affordable track should showcase official affordable project pins');
  assert.match(fakeSvg.innerHTML, /创智云城保租/);
  assert.match(fakeSvg.innerHTML, /未来/);
  assert.match(affLegend, /规划在建/);
  store.setHousingTrack('market');
  map.render({ state: store.state, evalResult: evalVisited, store });

  // 2.8 Map object & neutral event filtering (极简模式 hides neutral landmarks, terrain & alert badges)
  const syRow = evalVisited.plateRowById.get('p-shiyancenter');
  assert.ok(syRow.alerts.some(a => a.level === 'surge' && a.title.includes('暴涨')), 'Shiyan +25.5% YoY should produce a surge major alert');
  assert.ok(evalVisited.plateRowById.get('p-yingrenshi').route.minutes < syRow.route.minutes, 'Yingrenshi (south Shiyan) should commute faster to Liuxian than north Shiyan');
  assert.match(fakeSvg.innerHTML, /class="alert-badge /, 'Plates with major surges or events should render ! alert badge on map');
  store.applyMapPreset('minimal');
  map.render({ state: store.state, evalResult: evalVisited, store });
  assert.doesNotMatch(fakeSvg.innerHTML, /class="terrain-mtn"/, 'Minimal preset should hide neutral mountain terrain objects');
  assert.doesNotMatch(fakeSvg.innerHTML, /class="landmark-pin"/, 'Minimal preset should hide neutral landmark objects');
  assert.doesNotMatch(fakeSvg.innerHTML, /class="alert-badge /, 'Minimal preset should hide ! alert badges too');
  store.applyMapPreset('default');

  // Turn extra layers back off cleanly
  store.toggleLayer('density');
  store.toggleLayer('trend');
  store.toggleLayer('commute');

  // Selecting 灵芝 should draw red risk influence beam to 新安广场
  const lzPlate = engine.plateById.get('p-lingzhi');
  store.state.selectedPlateId = 'p-lingzhi';
  map.camera.fit(lzPlate.bounds);
  map.render({ state: store.state, evalResult: evalVisited, store });
  assert.match(fakeSvg.innerHTML, /class="influence-line-risk"/, 'Lingzhi should draw red influence line to public risk source');

  // 3. Civilization VI Landmark Aura Radiance (15-min walk + honest 30/40/50-min rail)
  const auraLx = engine.landmarkAura('lm-liuxian');
  assert.ok(auraLx && auraLx.walk15.has('p-liuxian') && auraLx.minutes === 30 && auraLx.rail30.size >= 10, 'Liuxian landmark aura should reach 10+ plates within 30 min rail');
  const auraKx = engine.landmarkAura('lm-kexing');
  assert.ok(auraKx && auraKx.minutes <= 40 && auraKx.rail30.size >= 6, 'Kexing landmark aura should reach 6+ commuter plates within 30–40 min');
  const auraPg = engine.landmarkAura('lm-penguin');
  assert.ok(auraPg && auraPg.minutes === 50 && auraPg.rail30.size >= 5, 'Penguin Island aura should honestly expand to feeder-reachable plates instead of 0');
  store.state.selectedPlateId = '';
  store.state.selectedLandmarkId = 'lm-kexing';
  map.camera.reset();
  map.render({ state: store.state, evalResult: evalVisited, store });
  assert.match(fakeSvg.innerHTML, /class="landmark-aura-ring"/);

  // 4. Symmetric 捡漏/避贵 switch: hub 15-min rings, citywide peer high-premium, migration arrows, zero 圈外, unmistakable ↑溢价¥
  store.state.selectedLandmarkId = '';
  store.toggleLayer('premium');
  map.render({ state: store.state, evalResult: evalVisited, store });
  assert.match(fakeSvg.innerHTML, /rgba\(255,218,120,0\.13\)/);
  assert.match(fakeSvg.innerHTML, /科兴→企鹅岛/);
  assert.doesNotMatch(fakeSvg.innerHTML, /圈外/);
  assert.doesNotMatch(fakeSvg.innerHTML, /\+¥\d+/);
  assert.ok(evalVisited.plateRows.some(r => r.premium?.status === 'premium' && r.premium?.kind === 'peer'), 'Symmetric citywide high-premium should detect non-hub expensive plates');
  if (evalVisited.plateRows.some(r => r.premium?.status === 'premium')) {
    assert.match(fakeSvg.innerHTML, /↑溢价¥\d+/);
  }

  // 5. Radial 10-minute rings around arbitrary mall destination (万象天地)
  store.state.work = '万象天地';
  store.toggleLayer('commute');
  store.state.layout = 'radial';
  const resMall = engine.evaluateAll(store.state, store);
  map.render({ state: store.state, evalResult: resMall, store });
  assert.match(fakeSvg.innerHTML, /万象天地/);
  assert.match(fakeSvg.innerHTML, /10分/);
});

test('V5 transparent 0–100 scoring, profile weight switching, Top 3 crowns, multi-room true-cost PK & lossless backup', () => {
  const { store, engine, ctx } = bootV3();
  store.state.work = '留仙洞';
  store.state.budget = 3200;
  store.state.sqm = 35;

  // 1. Every single plate gets a real 0–100 score across all 4 dimensions + Top 5 ranking
  const resBal = engine.evaluateAll(store.state, store);
  assert.equal(store.state.fillLayer, 'score');
  assert.equal(resBal.topPlates.length, 5);
  assert.equal(resBal.topRankById.size, 3);
  for (const r of resBal.plateRows) {
    assert.equal(r.fit.count, 4, `${r.plate.name} must score all 4 dimensions`);
    assert.ok(r.fit.total >= 0 && r.fit.total <= 100, `${r.plate.name} fit.total must be in 0..100`);
  }
  assert.ok(resBal.topPlates[0].fit.total >= resBal.topPlates[4].fit.total, 'topPlates must be sorted descending by score');

  // 2. Switching renter profile presets (commute vs value vs quality) measurably updates weights & scores
  store.setProfile('commute');
  const resComm = engine.evaluateAll(store.state, store);
  store.setProfile('value');
  const resVal = engine.evaluateAll(store.state, store);
  const lxComm = resComm.plateRowById.get('p-liuxian').fit.total;
  const lxVal = resVal.plateRowById.get('p-liuxian').fit.total;
  assert.notEqual(lxComm, lxVal, 'Switching commute vs value profile must change plate score');
  store.setProfile('balanced');

  // 3. Map renders score pills, Top 3 #1 crown badge, and score legend
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fakeSvg = {
    attrs: {}, innerHTML: '', classList: { toggle() {} },
    setAttribute(k, v) { this.attrs[k] = v; }, addEventListener() {},
    getBoundingClientRect() { return { width: 1200, height: 700, left: 0, top: 0 }; },
    querySelector() { return null; },
  };
  const map = ctx.createV3Map(fakeSvg, atlas, engine, timing, esc);
  const scoreLegend = map.render({ state: store.state, evalResult: resBal, store });
  assert.match(fakeSvg.innerHTML, /class="score-pill"/, 'Score view should draw score pills on banners');
  assert.match(fakeSvg.innerHTML, /class="rank-crown"/, 'Score view should render Top 3 crown badges');
  assert.match(scoreLegend, /综合推荐分/);

  // 4. Multi-room "一房一卡" true all-in monthly cost + red-flag -12 penalty + PK ranking
  const roomGood = store.saveRoom({
    plateId: 'p-pingzhou', plateName: '坪洲', title: '碧海湾 3栋802',
    housingType: '电梯小区', areaSqm: 38, walkMin: 6,
    rent: 2800, mgmtFee: 180, netFee: 50, utilityMode: 'civil', agencyFee: 0,
    redFlags: [],
    stars: { light: 5, quiet: 4, appliance: 5, walk: 4, life: 5, landlord: 5 },
    note: '南向采光好，民水民电',
  });
  const roomTrap = store.saveRoom({
    plateId: 'p-pingzhou', plateName: '坪洲', title: '坪洲某公寓 205',
    housingType: '品牌公寓', areaSqm: 28, walkMin: 8,
    rent: 2600, mgmtFee: 200, netFee: 100, utilityMode: 'commercial', agencyFee: 1200,
    redFlags: ['dark_window', 'damp_pest'],
    stars: { light: 2, quiet: 2, appliance: 3, walk: 3, life: 4, landlord: 3 },
    note: '表面便宜但商水商电+管理费+握手楼',
  });
  assert.ok(roomGood && roomTrap);

  const resRooms = engine.evaluateAll(store.state, store);
  assert.equal(resRooms.scoredRooms.length, 2);
  const gScored = resRooms.scoredRooms.find(r => r.id === roomGood.id);
  const tScored = resRooms.scoredRooms.find(r => r.id === roomTrap.id);
  assert.equal(gScored.trueMonthly, 2800 + 180 + 50);
  assert.equal(gScored.hiddenMonthly, 230);
  assert.equal(tScored.trueMonthly, 2600 + 200 + 100 + 220 + 100); // commercial +220, agency 1200/12=+100
  assert.equal(tScored.hiddenMonthly, 620);
  assert.equal(tScored.redFlagPenalty, 24);
  assert.equal(resRooms.scoredRooms[0].id, roomGood.id, 'Clean civil-utility room must beat cheaper-looking red-flag trap room in PK');
  assert.equal(resRooms.plateRowById.get('p-pingzhou').fit.verified, true, 'Logging a real inspected room upgrades parent plate score to verified');

  // 5. JSON backup export & import preserves BOTH legacy journal entries AND V5 rooms losslessly
  store.toggleSave('p-xilicenter', '西丽中心片区');
  const backupJson = store.exportBackup();
  const boot2 = bootV3();
  const mergedCount = boot2.store.importBackup(backupJson);
  assert.ok(mergedCount >= 3);
  assert.equal(boot2.store.isSaved('p-xilicenter'), true);
  assert.equal(boot2.store.listRooms().length, 2);
  assert.equal(boot2.store.listRooms().find(r => r.title === '碧海湾 3栋802').mgmtFee, 180);

  store.deleteRoom(roomTrap.id);
  assert.equal(store.listRooms().length, 1);
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

test('Built index.html has lossless packed driving matrix, valid JS syntax, strict CSP, 60fps zero-filter SVG & zero missing DOM IDs', () => {
  const html = read('index.html');
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /viewport-fit=cover/, 'Mobile HTML should support notched screen safe areas');
  assert.match(html, /height:\s*100dvh/, 'Mobile layout should use dynamic viewport height (100dvh)');
  assert.match(html, /env\(safe-area-inset-bottom\)/, 'Mobile bottom dock & sheet should respect iOS safe-area-inset-bottom');
  assert.match(html, /id="atlas-v3-data"/);
  assert.match(html, /id="nx-sheet"/);
  assert.match(html, /id="nx-mobile-tabs"/);
  assert.match(html, /#nx-svg :focus \{ outline: none; \}/);
  assert.match(html, /#nx-svg text\.no-stroke \{ stroke: none;/);
  assert.doesNotMatch(html, /zu\.ke\.com|ziroom\.com|leyoujia\.com|inboyu\.com/, 'Flagship UI must not embed third-party commercial rental platform referral deep-links');

  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  assert.ok(scripts.length >= 1);
  scripts.forEach((src, i) => new vm.Script(src, { filename: `flagship-inline-${i}.js` }));

  // Verify lossless gzip-packed driving matrix & lazy bus network decode
  const zlib = require('node:zlib');
  const jMatch = html.match(/<script type="application\/json" id="journey-data">([\s\S]*?)<\/script>/);
  const embedded = JSON.parse(jMatch[1]);
  assert.ok(embedded.driving?.packed?.durations && embedded.driving.packed.gz === true, 'Driving matrix should be gzip-packed');
  assert.ok(embedded.bus?.gz, 'Bus network should be gzip-packed for lazy decompression');
  const unpack = (buf, n) => {
    const rows = new Array(n);
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
  const durBytes = zlib.gunzipSync(Buffer.from(embedded.driving.packed.durations, 'base64'));
  const decDur = unpack(durBytes, embedded.driving.packed.n);
  assert.equal(decDur.length, travel.driving.durations.length);
  for (let i = 0; i < decDur.length; i += 17) {
    assert.deepEqual(Array.from(decDur[i]), travel.driving.durations[i]);
  }
  const decBus = JSON.parse(zlib.gunzipSync(Buffer.from(embedded.bus.gz, 'base64')).toString('utf8'));
  assert.equal(decBus.stops.length, travel.bus.stops.length);
  assert.equal(decBus.routes.length, travel.bus.routes.length);
  assert.equal(atlas.streetClips.length, 0, 'Pre-clipped Voronoi plates should eliminate all runtime SVG clipPaths');
  assert.doesNotMatch(html, /<feMorphology|<feDropShadow/, 'CPU SVG filters feMorphology and feDropShadow must be eliminated for 60fps pan/zoom');
});

test('V6 engine lazily decompresses gzipped driving & bus payloads on demand via DecompressionStream', async () => {
  const html = read('index.html');
  const jMatch = html.match(/<script type="application\/json" id="journey-data">([\s\S]*?)<\/script>/);
  const packedTravel = JSON.parse(jMatch[1]);
  const ctx = vm.createContext({
    window: {}, atob, DecompressionStream, Response, TextDecoder,
    requestAnimationFrame: fn => { fn(); return 1; },
    localStorage: { getItem: () => null, setItem() {} },
  });
  ctx.window = ctx;
  for (const f of ['app/rail.js', 'app/bus.js', 'app/store.js', 'app/engine.js']) {
    vm.runInContext(read(f), ctx);
  }
  const store = ctx.createV3Store(() => {});
  const engine = ctx.createV3Engine(atlas, packedTravel, timing);
  assert.equal(engine.isModeReady('rail'), true);
  assert.equal(engine.isModeReady('drive'), false);
  assert.equal(engine.isModeReady('bus'), false);

  store.state.work = '科兴科学园';
  store.state.mode = 'drive';
  assert.equal(await engine.ensureModeReady('drive'), true);
  assert.equal(engine.isModeReady('drive'), true);
  const driveRes = engine.evaluateAll(store.state, store);
  assert.ok(driveRes.plateRowById.get('p-pingzhou').route.minutes > 5, 'Lazy-decoded driving matrix should compute Pingzhou->Kexing');

  store.state.mode = 'bus';
  assert.equal(await engine.ensureModeReady('bus'), true);
  assert.equal(engine.isModeReady('bus'), true);
  const busRes = engine.evaluateAll(store.state, store);
  assert.ok(busRes.plateRowById.get('p-pingzhou').route.minutes > 10, 'Lazy-decoded bus network should compute Pingzhou->Kexing');
});

test('V6 check: all static DOM IDs exist in flagship index.html & legacy template', () => {
  const html = read('index.html');
  const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  const nextUi = read('app/next/next-ui.js');
  const nextDynamicIds = new Set(['nx-btn-export', 'nx-input-import']);
  for (const m of nextUi.matchAll(/\$\('#([\w-]+)'\)|getElementById\('([\w-]+)'\)/g)) {
    const id = m[1] || m[2];
    if (!nextDynamicIds.has(id)) assert.ok(htmlIds.has(id), `Missing DOM id #${id} in flagship index.html`);
  }

  const legacyTpl = read('app/template.html');
  const legacyIds = new Set([...legacyTpl.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  const legacyUi = read('app/ui.js');
  const legacyDynamicIds = new Set(['place-note-form', 'btn-export-wl', 'input-import-wl']);
  for (const m of legacyUi.matchAll(/\$\('#([\w-]+)'\)|getElementById\('([\w-]+)'\)/g)) {
    const id = m[1] || m[2];
    if (!legacyDynamicIds.has(id)) assert.ok(legacyIds.has(id), `Missing DOM id #${id} in legacy app/template.html`);
  }
});
