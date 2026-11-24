#!/usr/bin/env node
'use strict';

// V2 统一数据底座构建脚本：
// 把原有交通/边界/58商圈/设施/政策 + 新版 V2 分形态租金与保租房数据，合并为清晰的 data/atlas-v2.json。
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const readJson = rel => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

const base = readJson('data/base.json');
const fine = readJson('data/fine.json');
const journey = readJson('data/journey.json');
const facilitiesBase = readJson('data/facilities.json');
const facilitiesExtra = readJson('sources/v2/facilities-extra.json');
const policiesData = readJson('data/policies.json');
const corridor = readJson('sources/v2/corridor-rents.json');

// Load worldEvents from src/world.js safely
const worldCtx = vm.createContext({ window: {} });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/world.js'), 'utf8'), worldCtx);
const publicEvents = worldCtx.window.worldEvents || [];

// Exact projection matching base.json / fine.json
const westSt = base.stations.find(s => s[0] === '宝安中心');
const eastSt = base.stations.find(s => s[0] === '坪山围');
const lonScale = (eastSt[1] - westSt[1]) / (eastSt[3][0] - westSt[3][0]);
const RAD = Math.PI / 180;
const merc = lat => Math.log(Math.tan(Math.PI / 4 + lat * RAD / 2));
const project = ll => [
  Number((westSt[1] + (ll[0] - westSt[3][0]) * lonScale).toFixed(2)),
  Number((westSt[2] - (merc(ll[1]) - merc(westSt[3][1])) * lonScale / RAD).toFixed(2)),
];
const meter = (a, b) => Math.hypot((a[0] - b[0]) * 102700, (a[1] - b[1]) * 110850);
const walkMin = m => Math.max(2, Math.ceil(m * 1.25 / 75));

const stationCoords = new Map(base.stations.map(s => [s[0], s[3]]));
const streetById = new Map(fine.streets.map(s => [s.id, s]));
const streetByDistrictName = new Map(fine.streets.map(s => [`${s.d}|${s.n}`, s]));
const marketById = fine.markets;

// Merge facilities (base 41 + extra 14 = 55 across 5 core streets)
const facMap = new Map();
for (const f of [...(facilitiesBase.facilities || []), ...(facilitiesExtra.facilities || [])]) {
  if (f?.id && !facMap.has(f.id)) facMap.set(f.id, f);
}
const facilities = [...facMap.values()];

// Market event directional signals (for Arbitrage Radar)
const eventReadings = {
  dachong: { dir: 'opportunity', label: '大厂外迁 · 有议价样本', summary: '科兴部分团队迁出，周边出现议价样本（同期仍有部分小区加价）' },
  island: { dir: 'mixed', label: '企鹅岛启幕 · 供需并存', summary: '团队上岛带来需求，园区同步配建 4000+ 套员工公寓' },
  guiwan: { dir: 'tight', label: '团队迁入 · 需求偏紧', summary: 'OPPO 部分员工迁入桂湾，附近出现加价续租案例' },
  houhai: { dir: 'opportunity', label: '办公外迁 · 议价观察', summary: 'OPPO 部分办公迁出后海，步行圈小户型租客分流' },
  liuxian: { dir: 'opportunity', label: '800套保租分流 · 议价窗口', summary: '留仙洞创智云城新增约 800 套定向保租房（48.6元/㎡·月），分流同类一两房' },
  shangwu: { dir: 'tight', label: '13号线开通 · 涨价预期', summary: '换乘改善后出现续约加价通知' },
  phoenix: { dir: 'watch', label: '新线通车 · 方向待察', summary: '13号线既改善通勤，也增加沿线替代选择' },
  pingzhou: { dir: 'opportunity', label: '保租/公租分流 · 议价观察', summary: '海岚居 253 套保租 + 坪洲三期 53 套腾退公租，增加同片区比价筹码' },
  changzhen: { dir: 'opportunity', label: '三房保租放量 · 分流', summary: '光明长圳面向家庭配租三房，对相近户型形成比价' },
  beer: { dir: 'tight', label: '总部迁入 · 需求走强', summary: '企业总部迁入兴东啤酒小镇，周边租赁需求升温' },
  bantian: { dir: 'opportunity', label: '单间让价 · 议价窗口', summary: '坂田经纪人实访与公寓项目均出现单间下调记录' },
  meilin: { dir: 'opportunity', label: '公寓调价 · 议价窗口', summary: '上梅林部分集中式公寓单间有明确调价记录' },
  fuyong: { dir: 'watch', label: '个案议价 · 区域待察', summary: '运营交接期出现个案谈价成功' },
  xili: { dir: 'watch', label: '村/园价差大 · 适合比价', summary: '城中村与总部品质小区存在显著价格梯度' },
};

const events = (base.events || []).map(ev => {
  const reading = eventReadings[ev.key] || { dir: 'watch', label: ev.signal || '片区观察', summary: ev.view || ev.fact };
  const ref = (ev.ref || []).find(r => Array.isArray(r) && /^https?:\/\//i.test(r[1]));
  const streetId = fine.stStreet[ev.station] || fine.streets.find(s => s.events?.includes(ev.key))?.id || null;
  return {
    id: ev.key,
    title: ev.title,
    area: ev.area,
    district: ev.dist,
    streetId,
    station: ev.station || null,
    type: ev.type,
    date: ev.date,
    fact: ev.fact,
    view: ev.view,
    test: ev.test || '',
    xy: ev.xy,
    dir: reading.dir,
    signalLabel: reading.label,
    summary: reading.summary,
    source: ref?.[1] || '',
    sourceName: ref?.[0] || '',
  };
});

// Helper: infer room number from project metric label
function parseRoom(str) {
  if (/单间|开间/.test(str || '')) return 1;
  const m = String(str || '').match(/([一二两三四1234])\s*[室房居]/);
  if (!m) return 1;
  return ({ 一: 1, 二: 2, 两: 2, 三: 3, 四: 4 })[m[1]] || Number(m[1]) || 1;
}

// Helper: infer housing type from project category/footprint
function inferHousingType(hood, metricRooms = '') {
  if (hood.footprint?.kind === '城中村') return 'village';
  if (hood.footprint?.kind === '住宅小区') return 'modernEstate';
  const cat = hood.project?.category || '';
  if (cat === '城中村及相邻住宅小区') return /官龙名苑/.test(metricRooms) ? 'oldEstate' : 'village';
  if (/城中村/.test(cat)) return 'village';
  if (/公寓|园区|综合体/.test(cat)) return 'apartment';
  if (/小区/.test(cat)) return 'modernEstate';
  return null;
}

// Helper: get latest complete 58 market month + YoY
function latest58(market, room) {
  const months = market?.months || {};
  const periods = Object.keys(months).sort().reverse();
  const pick = periods.find(p => p < '2026-11' && months[p]?.[room]?.price > 0) || periods.find(p => months[p]?.[room]?.price > 0);
  if (!pick) return null;
  const row = months[pick][room];
  const prev = periods[periods.indexOf(pick) + 1];
  const prevRow = prev ? months[prev]?.[room] : null;
  const mom = prevRow?.price > 0 && pick < '2026-11' ? Math.round((row.price / prevRow.price - 1) * 10000) / 100 : null;
  return { period: pick, price: row.price, yoy: row.yoy ?? null, mom, complete: pick < '2026-11' };
}

// Map corridor bands quickly
function findBandForHood(hood) {
  return corridor.corridorBands.find(b =>
    (b.matchHoods && b.matchHoods.includes(hood.id)) ||
    (b.zones && hood.zone && b.zones.includes(hood.zone))
  ) || null;
}

function findBandForStreet(district, streetName) {
  return corridor.corridorBands.find(b => b.district === district && b.street === streetName) || null;
}

// Build unified places[]
const places = [];
const placeById = new Map();

function addPlace(p) {
  if (placeById.has(p.id)) return;
  placeById.set(p.id, p);
  places.push(p);
}

// 1. Convert all existing fine.hoods (82) into unified V2 places
for (const h of fine.hoods) {
  const street = streetById.get(h.street) || null;
  const rents = [];
  const types = new Set();

  // A. Direct project metrics (highest fidelity)
  if (h.project?.metrics?.length) {
    for (const m of h.project.metrics) {
      if (/合租/.test(m.scope || '') || !(m.price > 0)) continue;
      const t = inferHousingType(h, m.rooms) || 'modernEstate';
      types.add(t);
      rents.push({
        type: t,
        room: parseRoom(m.rooms),
        low: m.price,
        median: m.price,
        high: m.price,
        sqm: m.sqm ? [m.sqm, m.sqm] : null,
        grain: 'project',
        period: String(m.period || '').slice(0, 10).replace(/（.*/, ''),
        mom: m.mom ?? null,
        yoy: m.yoy ?? null,
        basis: `${h.n} · ${m.rooms}（${m.sqm ? m.sqm + '㎡ 整租挂牌' : '项目样本'}）`,
        source: m.source,
        sourceName: '安居客/公开项目样本',
      });
    }
  }

  // B. Corridor by-type market reference bands (fills 17/17 Xixiang footprints & core event hubs without mixing village/estate!)
  const band = findBandForHood(h);
  if (band) {
    const fpType = inferHousingType(h);
    const allowedTypes = fpType ? [fpType] : Object.keys(band.byType);
    for (const t of allowedTypes) {
      const list = band.byType[t] || [];
      if (!list.length) continue;
      types.add(t);
      for (const b of list) {
        // Avoid duplicating if we already have a project sample for same type+room? Keep band as complement only if no project sample for that type+room
        if (rents.some(r => r.grain === 'project' && r.type === t && r.room === b.room)) continue;
        rents.push({
          type: t,
          room: b.room,
          low: b.low,
          median: b.median,
          high: b.high,
          sqm: b.sqm,
          grain: 'band',
          period: band.period,
          yoy: null,
          mom: null,
          basis: b.basis,
          source: band.source,
          sourceName: band.sourceName,
        });
      }
    }
  }

  // C. 58 market monthly sample (kept as market-grain fallback + trend series)
  let marketTrend = null;
  const market = h.mid != null ? marketById[h.mid] : (street?.mid != null ? marketById[street.mid] : null);
  if (market) {
    marketTrend = {};
    for (const r of ['1', '2', '3']) {
      const obs = latest58(market, r);
      if (obs) marketTrend[r] = { ...obs, marketName: market.name, url: market.url };
    }
    if (h.mid != null && !rents.length) {
      for (const r of ['1', '2', '3']) {
        const obs = marketTrend[r];
        if (!obs) continue;
        rents.push({
          type: 'mixed',
          room: Number(r),
          low: obs.price,
          median: obs.price,
          high: obs.price,
          sqm: null,
          grain: 'market',
          period: obs.complete ? obs.period : `${obs.period}（月内）`,
          yoy: obs.yoy,
          mom: obs.mom,
          basis: `${market.name}商圈 · ${r}室挂牌均价（多业态混合口径）`,
          source: market.url,
          sourceName: '58同城租金走势',
        });
      }
    }
  }

  // Station walk estimate
  const stCoord = h.station ? stationCoords.get(h.station) : null;
  const distM = stCoord && h.ll ? Math.round(meter(h.ll, stCoord)) : null;

  // Match events, policies, facilities
  const linkedEvents = events.filter(ev =>
    (h.events && h.events.includes(ev.id)) ||
    (h.id === 'e-' + ev.id) ||
    (ev.streetId && h.street === ev.streetId && ev.station && ev.station === h.station)
  );
  const directEvents = linkedEvents.filter(ev => h.id === 'e-' + ev.id || (h.events && h.events.includes(ev.id)));
  const linkedPolicies = (policiesData.policies || []).filter(pol => {
    if (pol.scope === 'hood' && (pol.areaIds || []).includes(h.id)) return true;
    if ((pol.sites || []).some(s => s.hoodId === h.id || (s.streetId && s.streetId === h.street))) return true;
    return false;
  });
  const localFacs = facilities.filter(f => (f.hoodIds || []).includes(h.id));
  const streetFacs = street ? facilities.filter(f => f.streetId === street.id) : [];
  const riskEvents = publicEvents.filter(pe => h.station && (pe.near || []).includes(h.station));

  addPlace({
    id: h.id,
    name: h.n,
    shortName: h.footprint?.name || h.n.split(' · ').at(-1),
    district: h.d,
    streetId: h.street || null,
    streetName: street?.n || '',
    zone: h.zone || null,
    coord: h.ll,
    xy: h.xy,
    station: h.station || null,
    walkMin: distM != null ? walkMin(distM) : null,
    anchor: h.anchor || '',
    footprint: h.footprint || null,
    housingTypes: [...types],
    rents,
    marketTrend,
    eventIds: linkedEvents.map(e => e.id),
    directEventIds: directEvents.map(e => e.id),
    policyIds: linkedPolicies.map(p => p.id),
    facilityIds: localFacs.map(f => f.id),
    streetFacilityCount: streetFacs.length,
    riskEventIds: riskEvents.map(e => e.id),
    pros: [],
    watchouts: [],
  });
}

// 2. Add 3 official 2026-11 Nanshan 045 affordable rental projects (with exact official unit prices!)
for (const proj of corridor.officialAffordableProjects) {
  const street = streetByDistrictName.get(`${proj.district}|${proj.street}`);
  const stCoord = stationCoords.get(proj.station);
  const distM = stCoord ? Math.round(meter(proj.coord, stCoord)) : null;
  const streetFacs = street ? facilities.filter(f => f.streetId === street.id) : [];
  addPlace({
    id: proj.id,
    name: proj.name,
    shortName: proj.name.replace(/（.*）/, ''),
    district: proj.district,
    streetId: street?.id || null,
    streetName: proj.street,
    zone: null,
    coord: proj.coord,
    xy: project(proj.coord),
    station: proj.station,
    walkMin: distM != null ? walkMin(distM) : null,
    anchor: `${proj.station}站 · 官方保租房项目`,
    footprint: null,
    housingTypes: proj.housingTypes,
    rents: proj.rents,
    marketTrend: null,
    eventIds: proj.id === 'v2-chuangzhi-yuncheng' ? ['liuxian'] : [],
    directEventIds: proj.id === 'v2-chuangzhi-yuncheng' ? ['liuxian'] : [],
    policyIds: [proj.policyId],
    facilityIds: facilities.filter(f => (f.hoodIds || []).includes(proj.id)).map(f => f.id),
    streetFacilityCount: streetFacs.length,
    riskEventIds: [],
    pros: proj.livability?.pros || [],
    watchouts: proj.livability?.watchouts || [],
  });
}

// 3. Add newly covered core corridor hubs (白石洲、南油、沙井、沙尾、景田、民治)
for (const band of corridor.corridorBands) {
  if (!band.createPlace) continue;
  const cp = band.createPlace;
  const street = streetByDistrictName.get(`${band.district}|${band.street}`);
  const rents = [];
  const types = Object.keys(band.byType);
  for (const t of types) {
    for (const b of band.byType[t]) {
      rents.push({
        type: t,
        room: b.room,
        low: b.low,
        median: b.median,
        high: b.high,
        sqm: b.sqm,
        grain: 'band',
        period: band.period,
        yoy: null,
        mom: null,
        basis: b.basis,
        source: band.source,
        sourceName: band.sourceName,
      });
    }
  }
  const stCoord = stationCoords.get(cp.station);
  const distM = stCoord ? Math.round(meter(cp.coord, stCoord)) : null;
  const market = street?.mid != null ? marketById[street.mid] : null;
  let marketTrend = null;
  if (market) {
    marketTrend = {};
    for (const r of ['1', '2', '3']) {
      const obs = latest58(market, r);
      if (obs) marketTrend[r] = { ...obs, marketName: market.name, url: market.url };
    }
  }
  addPlace({
    id: cp.id,
    name: cp.name,
    shortName: cp.name.split(' · ')[0],
    district: band.district,
    streetId: street?.id || null,
    streetName: band.street,
    zone: null,
    coord: cp.coord,
    xy: project(cp.coord),
    station: cp.station,
    walkMin: distM != null ? walkMin(distM) : null,
    anchor: `${cp.station}站 · 核心居住片区`,
    footprint: null,
    housingTypes: types,
    rents,
    marketTrend,
    eventIds: events.filter(ev => ev.streetId === street?.id).map(e => e.id),
    directEventIds: [],
    policyIds: (policiesData.policies || []).filter(p => (p.sites || []).some(s => s.streetId === street?.id)).map(p => p.id),
    facilityIds: [],
    streetFacilityCount: street ? facilities.filter(f => f.streetId === street.id).length : 0,
    riskEventIds: publicEvents.filter(pe => (pe.near || []).includes(cp.station)).map(e => e.id),
    pros: cp.pros || [],
    watchouts: cp.watchouts || [],
  });
}

// 4. Attach corridor bands & official reference unit prices to streets (74)
const streets = fine.streets.map(s => {
  const band = findBandForStreet(s.d, s.n);
  const market = s.mid != null ? marketById[s.mid] : null;
  const trend = {};
  if (market) {
    for (const r of ['1', '2', '3']) {
      const obs = latest58(market, r);
      if (obs) trend[r] = { ...obs, marketName: market.name, url: market.url };
    }
  }
  return {
    id: s.id,
    n: s.n,
    short: s.short,
    d: s.d,
    p: s.p,
    xy: s.xy,
    bounds: s.bounds,
    refUnit: s.ref, // Official 2022 Shenzhen Housing Bureau street unit price (元/㎡·月)
    stations: s.stations,
    trend,
    hasBand: !!band,
    facilityCount: facilities.filter(f => f.streetId === s.id).length,
    eventIds: s.events || [],
  };
});

// 5. Compact districts summary
const districts = base.districts.map(d => {
  const comm = base.apartment?.currentCommunity?.by_district?.[d.n] || null;
  const vil = base.villageRecent?.by_district?.[d.n] || null;
  const apt = base.apartment?.currentApartment?.by_district?.[d.n] || null;
  return {
    n: d.n,
    p: d.p,
    a: d.a,
    density: d.density,
    pop: d.pop,
    area: d.area,
    listingPrice: d.oct2026,
    listingYoy: d.yoy_pct,
    community: comm,
    village: vil,
    apartment: apt,
    refs2022: d.refs,
  };
});

const atlasV2 = {
  version: 2,
  asOf: '2026-11-24',
  housingTypeMeta: corridor.housingTypeMeta,
  refSource: fine.refSource,
  localCredit: fine.localCredit,
  districts,
  streets,
  zones: fine.zones,
  places,
  events,
  publicEvents,
  facilities,
  policies: policiesData.policies || [],
  stations: base.stations,
  metro: base.metro,
};

const outFile = path.join(ROOT, 'data', 'atlas-v2.json');
fs.writeFileSync(outFile, JSON.stringify(atlasV2), 'utf8');

const withRent = places.filter(p => p.rents.length > 0).length;
const fpPlaces = places.filter(p => p.footprint);
const fpWithRent = fpPlaces.filter(p => p.rents.length > 0).length;
const withOpp = places.filter(p => p.eventIds.some(id => events.find(e => e.id === id)?.dir === 'opportunity')).length;
console.log(`data/atlas-v2.json · ${(fs.statSync(outFile).size / 1024).toFixed(1)} KB`);
console.log(`  街道: ${streets.length} (含官方参考单价: ${streets.filter(s => s.refUnit).length}) | 居住片区: ${places.length} (有租金: ${withRent}/${places.length})`);
console.log(`  西乡住宅轮廓有租金: ${fpWithRent}/${fpPlaces.length} | 设施: ${facilities.length} (覆盖 ${new Set(facilities.map(f => f.streetId)).size} 个街道) | 议价线索片区: ${withOpp}`);
