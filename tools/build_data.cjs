#!/usr/bin/env node
'use strict';

// V3 统一板块拼图数据构建脚本：
// 1) 把 74 个街道中 15 个核心大街道按真实站区无缝 Voronoi 切分 -> 全深圳 98 块严丝合缝的「居住板块拼图」
// 2) 融入自然地形底骨（塘朗山/阳台山/梧桐山/水库/机场）+ 16 条真实地铁线 + 32 处固定地标
// 3) 每块拼图计算诚实口径的每平米参考均价（元/㎡·月），具体月租与小区/村落收归板块内部
// 4) 汇总 500+ 真实目的地索引（地标/商圈/地铁站/公交枢纽/板块/小区/核验设施）
const fs = require('node:fs');
const path = require('node:path');
const { geoArea, geoContains } = require('../sources/fine/vendor/d3-geo.cjs');

const ROOT = path.resolve(__dirname, '..');
const readJson = rel => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

const base = readJson('data/base.json');
const fine = readJson('data/fine.json');
const journey = readJson('data/journey.json');
const timing = readJson('data/timing.json');
const facilitiesBase = readJson('data/facilities.json');
const facilitiesExtra = readJson('sources/v2/facilities-extra.json');
const policiesData = readJson('data/policies.json');
const corridor = readJson('sources/v2/corridor-rents.json');
const geoSpec = readJson('sources/v3/geography.json');
const plateSpec = readJson('sources/v3/plates.json');
const publicEvents = readJson('sources/v3/public-events.json').events || [];
const affSpec = readJson('sources/v3/affordable-housing.json');
const workplaceSpec = readJson('sources/v3/workplaces.json');
const streetPopSpec = readJson('sources/v3/street-population.json');
const multiRentSpec = readJson('sources/v3/multi-source-rents.json');
const streetFeatures = readJson('sources/fine/streets.geojson').features || [];
const atlasAsOf = [affSpec.asOf, base.listingCheckedAt, fine.asof]
  .filter(date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date))
  .sort().at(-1) ?? null;
// The snapshot month may still be in progress. Using source dates keeps builds reproducible.
const marketSnapshotMonth = atlasAsOf?.slice(0, 7);

// Fix GeoJSON winding for d3-geo containment tests & compute exact spherical land area (km²) per street!
const EARTH_R_KM = 6371.0088;
const featureById = new Map();
const streetAreaById = new Map();
for (const feat of streetFeatures) {
  const polys = feat.geometry.type === 'MultiPolygon' ? feat.geometry.coordinates : [feat.geometry.coordinates];
  for (const rings of polys) {
    if (geoArea({ type: 'Polygon', coordinates: rings }) > 2 * Math.PI) {
      for (const ring of rings) ring.reverse();
    }
  }
  featureById.set(feat.properties.id, feat);
  streetAreaById.set(feat.properties.id, Number((geoArea(feat) * EARTH_R_KM * EARTH_R_KM).toFixed(2)));
}

// Verify 74-street 7th National Census populations sum to 100% of every district's official total (0-person diff)
const streetCensusById = new Map();
const distCensusCheck = new Map();
for (const st of fine.streets) {
  const key = `${st.d}|${st.n}`;
  const pop = streetPopSpec.streets[key];
  if (!Number.isFinite(pop) || pop <= 0) {
    throw new Error(`Missing 7th census population for street: ${key}`);
  }
  const areaKm2 = streetAreaById.get(st.id);
  if (!Number.isFinite(areaKm2) || areaKm2 <= 0) {
    throw new Error(`Missing GeoJSON area for street: ${st.id}`);
  }
  streetCensusById.set(st.id, { pop, areaKm2, density: Math.round(pop / areaKm2) });
  distCensusCheck.set(st.d, (distCensusCheck.get(st.d) || 0) + pop);
}
for (const [dName, expected] of Object.entries(streetPopSpec.districtTotals || {})) {
  const actual = distCensusCheck.get(dName) || 0;
  if (actual !== expected) {
    throw new Error(`7th census total mismatch for ${dName}: got ${actual}, expected ${expected}`);
  }
}

// Exact Mercator matching data/base.json
const westSt = base.stations.find(s => s[0] === '宝安中心');
const eastSt = base.stations.find(s => s[0] === '坪山围');
const lonScale = (eastSt[1] - westSt[1]) / (eastSt[3][0] - westSt[3][0]);
const RAD = Math.PI / 180;
const merc = lat => Math.log(Math.tan(Math.PI / 4 + lat * RAD / 2));
const invMerc = y => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) / RAD;
const round2 = n => Number(n.toFixed(2));
const project = ll => [
  round2(westSt[1] + (ll[0] - westSt[3][0]) * lonScale),
  round2(westSt[2] - (merc(ll[1]) - merc(westSt[3][1])) * lonScale / RAD),
];
const unproject = xy => [
  Number((westSt[3][0] + (xy[0] - westSt[1]) / lonScale).toFixed(6)),
  Number(invMerc(merc(westSt[3][1]) - (xy[1] - westSt[2]) * RAD / lonScale).toFixed(6)),
];
const meter = (a, b) => Math.hypot((a[0] - b[0]) * 102700, (a[1] - b[1]) * 110850);
const walkMin = m => Math.max(2, Math.ceil(m * 1.25 / 75));

// Smooth closed organic polygon into quadratic Bezier SVG path (for natural mountains & reservoirs)
function smoothClosedPath(coords) {
  const pts = coords.map(project);
  const n = pts.length;
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const start = mid(pts[n - 1], pts[0]);
  let d = `M${round2(start[0])},${round2(start[1])}`;
  for (let i = 0; i < n; i++) {
    const p = pts[i], nxt = mid(p, pts[(i + 1) % n]);
    d += `Q${round2(p[0])},${round2(p[1])} ${round2(nxt[0])},${round2(nxt[1])}`;
  }
  const cx = round2(pts.reduce((s, p) => s + p[0], 0) / n);
  const cy = round2(pts.reduce((s, p) => s + p[1], 0) / n);
  return { p: d + 'Z', xy: [cx, cy] };
}

const stationCoords = new Map(base.stations.map(s => [s[0], s[3]]));
const streetById = new Map(fine.streets.map(s => [s.id, s]));
const streetByDistrictName = new Map(fine.streets.map(s => [`${s.d}|${s.n}`, s]));
const districtByName = new Map(base.districts.map(d => [d.n, d]));
const marketById = fine.markets;

// Merge verified facilities (44 base incl. Codex 3 OSM + 14 extra = 58 across 5 streets)
const facMap = new Map();
for (const f of [...(facilitiesBase.facilities || []), ...(facilitiesExtra.facilities || [])]) {
  if (f?.id && !facMap.has(f.id)) facMap.set(f.id, f);
}
const facilities = [...facMap.values()];

// Market/arbitrage events
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
    id: ev.key, title: ev.title, area: ev.area, district: ev.dist, streetId,
    station: ev.station || null, type: ev.type, date: ev.date,
    fact: ev.fact, view: ev.view, test: ev.test || '', xy: ev.xy,
    dir: reading.dir, signalLabel: reading.label, summary: reading.summary,
    source: ref?.[1] || '', sourceName: ref?.[0] || '',
  };
});

// Helper functions
function parseRoom(str) {
  if (/单间|开间/.test(str || '')) return 1;
  const m = String(str || '').match(/([一二两三四1234])\s*[室房居]/);
  if (!m) return 1;
  return ({ 一: 1, 二: 2, 两: 2, 三: 3, 四: 4 })[m[1]] || Number(m[1]) || 1;
}

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

function latest58(market, room) {
  const months = market?.months || {};
  const periods = Object.keys(months).filter(period => months[period]?.[room]?.price > 0).sort().reverse();
  const pick = periods.find(period => period < marketSnapshotMonth) || periods[0];
  if (!pick) return null;
  const row = months[pick][room];
  const complete = pick < marketSnapshotMonth;
  const [year, month] = pick.split('-').map(Number);
  const prev = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
  const prevRow = months[prev]?.[room];
  const mom = complete && prevRow?.price > 0 ? Math.round((row.price / prevRow.price - 1) * 10000) / 100 : null;
  return { period: pick, price: row.price, yoy: row.yoy ?? null, mom, complete };
}

function findBandForHood(hood) {
  return corridor.corridorBands.find(b =>
    (b.matchHoods && b.matchHoods.includes(hood.id)) ||
    (b.zones && hood.zone && b.zones.includes(hood.zone))
  ) || null;
}

// 1. Build 98 Seamless Living Plates via exact Voronoi clipping inside the 15 split core streets
const splitByStreetId = new Map(plateSpec.splits.map(s => [s.streetId, s]));
const plates = [];
const streetClips = []; // Only the 15 split streets need SVG clipPaths

function pointInPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

function voronoiClip(rect, seed, others) {
  let ring = rect.slice();
  const [sx, sy] = seed;
  for (const [ox, oy] of others) {
    const mx = (sx + ox) / 2, my = (sy + oy) / 2;
    const dx = ox - sx, dy = oy - sy;
    const signed = ([px, py]) => (px - mx) * dx + (py - my) * dy;
    const out = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const da = signed(a), db = signed(b);
      if (da <= 0) out.push(a);
      if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
        const t = da / (da - db);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    ring = out;
    if (!ring.length) break;
  }
  return ring;
}

for (const s of fine.streets) {
  const split = splitByStreetId.get(s.id);
  if (!split) {
    const stCoord = s.stations?.[0] && stationCoords.get(s.stations[0]) ? stationCoords.get(s.stations[0]) : unproject(s.xy);
    plates.push({
      id: 'st-' + s.id,
      name: s.short,
      fullName: s.n,
      district: s.d,
      streetId: s.id,
      streetName: s.n,
      clipId: null,
      p: s.p,
      xy: s.xy,
      bounds: s.bounds,
      coord: stCoord,
      station: s.stations?.[0] || null,
      tag: '',
      refUnit: s.ref,
      mid: s.mid,
    });
    continue;
  }

  // Subdivide this large street seamlessly into exact convex Voronoi plates clipped by street.p!
  const clipId = 'clip-' + s.id;
  streetClips.push({ id: clipId, p: s.p });
  const [bx0, by0, bx1, by1] = s.bounds;
  const pad = 6;
  const rect = [[bx0 - pad, by0 - pad], [bx1 + pad, by0 - pad], [bx1 + pad, by1 + pad], [bx0 - pad, by1 + pad]];
  const feat = featureById.get(s.id);

  const seeds = split.plates.map(def => {
    const coord = def.coord || stationCoords.get(def.anchor);
    if (!coord) throw new Error(`Missing anchor coord for plate ${def.id}: ${def.anchor}`);
    return { ...def, coord, seedXY: project(coord) };
  });

  for (const item of seeds) {
    const others = seeds.filter(o => o !== item).map(o => o.seedXY);
    const poly = voronoiClip(rect, item.seedXY, others);
    const cellPath = 'M' + poly.map(p => p.map(round2).join(',')).join('L') + 'Z';

    // Find visual interior label point inside BOTH Voronoi cell AND parent street GeoJSON!
    const px0 = Math.max(bx0, Math.min(...poly.map(p => p[0])));
    const py0 = Math.max(by0, Math.min(...poly.map(p => p[1])));
    const px1 = Math.min(bx1, Math.max(...poly.map(p => p[0])));
    const py1 = Math.min(by1, Math.max(...poly.map(p => p[1])));
    const insidePts = [];
    for (let u = 1; u <= 7; u++) {
      for (let v = 1; v <= 7; v++) {
        const pt = [px0 + (px1 - px0) * u / 8, py0 + (py1 - py0) * v / 8];
        if (pointInPoly(pt, poly) && (!feat || geoContains(feat, unproject(pt)))) {
          insidePts.push(pt);
        }
      }
    }
    // Pick interior point closest to anchor (or centroid of interior sample points)
    let labelXY = item.seedXY;
    let pBounds = [round2(px0), round2(py0), round2(px1), round2(py1)];
    if (insidePts.length) {
      const avgX = insidePts.reduce((acc, p) => acc + p[0], 0) / insidePts.length;
      const avgY = insidePts.reduce((acc, p) => acc + p[1], 0) / insidePts.length;
      // Blend toward seedXY while staying strictly inside street + cell
      const target = [avgX * 0.55 + item.seedXY[0] * 0.45, avgY * 0.55 + item.seedXY[1] * 0.45];
      insidePts.sort((a, b) => Math.hypot(a[0] - target[0], a[1] - target[1]) - Math.hypot(b[0] - target[0], b[1] - target[1]));
      labelXY = insidePts[0].map(round2);
      pBounds = [
        round2(Math.min(...insidePts.map(p => p[0])) - 1.2),
        round2(Math.min(...insidePts.map(p => p[1])) - 1.2),
        round2(Math.max(...insidePts.map(p => p[0])) + 1.2),
        round2(Math.max(...insidePts.map(p => p[1])) + 1.2),
      ];
    }

    plates.push({
      id: item.id,
      name: item.name,
      fullName: `${s.n} · ${item.name}`,
      district: s.d,
      streetId: s.id,
      streetName: s.n,
      clipId,
      p: cellPath,
      xy: labelXY,
      seedXY: item.seedXY,
      bounds: pBounds,
      coord: item.coord,
      station: item.anchor,
      tag: item.tag || '',
      refUnit: s.ref,
      mid: s.mid,
    });
  }
}

const platesByStreet = new Map();
for (const pl of plates) {
  if (!platesByStreet.has(pl.streetId)) platesByStreet.set(pl.streetId, []);
  platesByStreet.get(pl.streetId).push(pl);
}

function resolvePlateId(streetId, xy, station = '', shortName = '') {
  const list = platesByStreet.get(streetId);
  if (!list || !list.length) {
    return plates.reduce((a, b) => Math.hypot(a.xy[0] - xy[0], a.xy[1] - xy[1]) <= Math.hypot(b.xy[0] - xy[0], b.xy[1] - xy[1]) ? a : b).id;
  }
  if (list.length === 1) return list[0].id;
  if (shortName) {
    const byName = list.find(pl => shortName.startsWith(pl.name.split('·')[0]));
    if (byName) return byName.id;
  }
  if (station) {
    const byStation = list.find(pl => pl.station === station);
    if (byStation) return byStation.id;
  }
  return list.reduce((a, b) => {
    const ax = a.seedXY || a.xy, bx = b.seedXY || b.xy;
    return Math.hypot(ax[0] - xy[0], ax[1] - xy[1]) <= Math.hypot(bx[0] - xy[0], bx[1] - xy[1]) ? a : b;
  }).id;
}

// 2. Build unified detailed places[] (all assigned cleanly to a plateId!)
const places = [];
const placeById = new Map();
function addPlace(p) {
  if (placeById.has(p.id)) return;
  p.plateId = resolvePlateId(p.streetId, p.xy, p.station, p.shortName);
  placeById.set(p.id, p);
  places.push(p);
}

for (const h of fine.hoods) {
  const street = streetById.get(h.street) || null;
  const rents = [];
  const types = new Set();

  if (h.project?.metrics?.length) {
    for (const m of h.project.metrics) {
      if (/合租/.test(m.scope || '') || !(m.price > 0)) continue;
      const t = inferHousingType(h, m.rooms) || 'modernEstate';
      types.add(t);
      rents.push({
        type: t, room: parseRoom(m.rooms), low: m.price, median: m.price, high: m.price,
        sqm: m.sqm ? [m.sqm, m.sqm] : null,
        unitPrice: m.sqm > 0 ? Math.round(m.price / m.sqm) : null,
        grain: 'project',
        period: String(m.period || '').slice(0, 10).replace(/（.*/, ''),
        mom: m.mom ?? null, yoy: m.yoy ?? null,
        basis: `${h.n} · ${m.rooms}${m.sqm ? `（${m.sqm}㎡ 整租挂牌）` : '（项目样本）'}`,
        source: m.source, sourceName: '安居客/公开项目样本',
      });
    }
  }

  const band = findBandForHood(h);
  if (band) {
    const fpType = inferHousingType(h);
    const allowedTypes = fpType ? [fpType] : Object.keys(band.byType);
    for (const t of allowedTypes) {
      const list = band.byType[t] || [];
      if (!list.length) continue;
      types.add(t);
      for (const b of list) {
        if (rents.some(r => r.grain === 'project' && r.type === t && r.room === b.room)) continue;
        const midSqm = b.sqm ? (b.sqm[0] + b.sqm[1]) / 2 : null;
        rents.push({
          type: t, room: b.room, low: b.low, median: b.median, high: b.high,
          sqm: b.sqm, unitPrice: midSqm ? Math.round(b.median / midSqm) : null,
          grain: 'band', period: band.period, yoy: null, mom: null,
          basis: b.basis, source: band.source, sourceName: band.sourceName,
        });
      }
    }
  }

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
          type: 'mixed', room: Number(r), low: obs.price, median: obs.price, high: obs.price,
          sqm: null, unitPrice: null, grain: 'market',
          period: obs.complete ? obs.period : `${obs.period}（月内）`,
          yoy: obs.yoy, mom: obs.mom,
          basis: `${market.name}商圈 · ${r}室挂牌均价`,
          source: market.url, sourceName: '58同城租金走势',
        });
      }
    }
  }

  const stCoord = h.station ? stationCoords.get(h.station) : null;
  const distM = stCoord && h.ll ? Math.round(meter(h.ll, stCoord)) : null;
  const linkedEvents = events.filter(ev =>
    (h.events && h.events.includes(ev.id)) || (h.id === 'e-' + ev.id) ||
    (ev.streetId && h.street === ev.streetId && ev.station && ev.station === h.station)
  );
  const linkedPolicies = (policiesData.policies || []).filter(pol =>
    (pol.scope === 'hood' && (pol.areaIds || []).includes(h.id)) ||
    (pol.sites || []).some(s => s.hoodId === h.id || (s.streetId && s.streetId === h.street))
  );

  addPlace({
    id: h.id,
    name: h.n,
    shortName: h.footprint?.name || h.n.split(' · ').at(-1),
    isMarketProxy: h.id.startsWith('m-'),
    kind: h.footprint?.kind || (h.project ? '实采项目' : h.id.startsWith('m-') ? '商圈样本' : '片区参考'),
    district: h.d, streetId: h.street || null, streetName: street?.n || '',
    coord: h.ll, xy: h.xy, station: h.station || null,
    walkMin: distM != null ? walkMin(distM) : null,
    anchor: h.anchor || '',
    housingTypes: [...types], rents, marketTrend,
    eventIds: linkedEvents.map(e => e.id),
    policyIds: linkedPolicies.map(p => p.id),
    facilityIds: facilities.filter(f => (f.hoodIds || []).includes(h.id)).map(f => f.id),
    riskEventIds: publicEvents.filter(pe => h.station && (pe.near || []).includes(h.station)).map(e => e.id),
    pros: [], watchouts: [],
  });
}

// Official 2026-11 Nanshan 045 affordable rental projects
for (const proj of corridor.officialAffordableProjects) {
  const street = streetByDistrictName.get(`${proj.district}|${proj.street}`);
  const stCoord = stationCoords.get(proj.station);
  const distM = stCoord ? Math.round(meter(proj.coord, stCoord)) : null;
  addPlace({
    id: proj.id, name: proj.name, shortName: proj.name.replace(/（.*）/, ''),
    isMarketProxy: false, kind: '官方保租房',
    district: proj.district, streetId: street?.id || null, streetName: proj.street,
    coord: proj.coord, xy: project(proj.coord), station: proj.station,
    walkMin: distM != null ? walkMin(distM) : null,
    anchor: `${proj.station}站 · 官方保租房项目`,
    housingTypes: proj.housingTypes, rents: proj.rents, marketTrend: null,
    eventIds: proj.id === 'v2-chuangzhi-yuncheng' ? ['liuxian'] : [],
    policyIds: [proj.policyId],
    facilityIds: facilities.filter(f => (f.hoodIds || []).includes(proj.id)).map(f => f.id),
    riskEventIds: [],
    pros: proj.livability?.pros || [], watchouts: proj.livability?.watchouts || [],
  });
}

// Newly covered corridor residential hubs (白石洲、南油、沙井、沙尾、景田、民治)
for (const band of corridor.corridorBands) {
  if (!band.createPlace) continue;
  const cp = band.createPlace;
  const street = streetByDistrictName.get(`${band.district}|${band.street}`);
  const rents = [];
  const types = Object.keys(band.byType);
  for (const t of types) {
    for (const b of band.byType[t]) {
      const midSqm = b.sqm ? (b.sqm[0] + b.sqm[1]) / 2 : null;
      rents.push({
        type: t, room: b.room, low: b.low, median: b.median, high: b.high,
        sqm: b.sqm, unitPrice: midSqm ? Math.round(b.median / midSqm) : null,
        grain: 'band', period: band.period, yoy: null, mom: null,
        basis: b.basis, source: band.source, sourceName: band.sourceName,
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
    id: cp.id, name: cp.name, shortName: cp.name.split(' · ')[0],
    isMarketProxy: false, kind: '核心片区',
    district: band.district, streetId: street?.id || null, streetName: band.street,
    coord: cp.coord, xy: project(cp.coord), station: cp.station,
    walkMin: distM != null ? walkMin(distM) : null,
    anchor: `${cp.station}站 · 核心居住片区`,
    housingTypes: types, rents, marketTrend,
    eventIds: events.filter(ev => ev.streetId === street?.id).map(e => e.id),
    policyIds: (policiesData.policies || []).filter(p => (p.sites || []).some(s => s.streetId === street?.id)).map(p => p.id),
    facilityIds: [],
    riskEventIds: publicEvents.filter(pe => (pe.near || []).includes(cp.station)).map(e => e.id),
    pros: cp.pros || [], watchouts: cp.watchouts || [],
  });
}

// 3. Enrich every Plate with honest 元/㎡·月 unitPrice, trends, events, policies, facilities, risks & child places!
const districts = base.districts.map(d => ({
  n: d.n, p: d.p, a: d.a, density: d.density, pop: d.pop, area: d.area,
  listingPrice: d.oct2026, listingYoy: d.yoy_pct,
  community: base.apartment?.currentCommunity?.by_district?.[d.n] || null,
  village: base.villageRecent?.by_district?.[d.n] || null,
  apartment: base.apartment?.currentApartment?.by_district?.[d.n] || null,
  refs2022: d.refs,
}));
const distInfoByName = new Map(districts.map(d => [d.n, d]));

// Build station -> metro line numbers map + plate -> stations map for Civ 6 Banner metro Buffs!
const stationToLines = new Map();
for (const [lineId, info] of Object.entries(timing.lines || {})) {
  for (const st of info.stations || []) {
    if (!stationToLines.has(st)) stationToLines.set(st, new Set());
    stationToLines.get(st).add(lineId);
  }
}
const plateStations = new Map(plates.map(p => [p.id, new Set(p.station ? [p.station] : [])]));
for (const [stName, , , ll] of base.stations) {
  if (stName === '企鹅岛') continue;
  const stId = fine.stStreet[stName];
  if (!stId) continue;
  const pid = resolvePlateId(stId, project(ll), stName);
  if (plateStations.has(pid)) plateStations.get(pid).add(stName);
}

const baseLandmarks = geoSpec.landmarks.map(l => ({ ...l, xy: project(l.coord) }));
const extraLandmarks = (workplaceSpec.items || [])
  .filter(w => w.landmarkTier)
  .map(w => ({
    id: w.id, name: w.name, label: w.label || w.name,
    kind: w.kind === '知名商圈' ? 'mall' : (w.kind === '口岸枢纽' ? 'transit' : 'hub'),
    tier: w.landmarkTier, coord: w.coord, district: w.district, note: w.note,
    xy: project(w.coord),
  }));
const landmarks = [...baseLandmarks, ...extraLandmarks];
const mallLandmarks = landmarks.filter(l => l.kind === 'mall');

// Cross-check every workplace coordinate against its real GCJ-02 adjacent metro station (<= 2.8km)
for (const w of workplaceSpec.items || []) {
  const stLL = stationCoords.get(w.station);
  if (!stLL) throw new Error(`Unknown anchor station for workplace ${w.name}: ${w.station}`);
  const d = meter(w.coord, stLL);
  if (d > 2800) throw new Error(`Workplace ${w.name} coord drifted ${Math.round(d)}m from station ${w.station}`);
}

const REAL_ESTATE_KINDS = new Set(['住宅小区', '城中村', '实采项目', '官方保租房']);

for (const pl of plates) {
  const members = places.filter(p => p.plateId === pl.id);
  // 仅保留真实有租金数据的小区/村落/保租项目，剔除历史事件空锚点（如 企鹅岛/桂湾/原办公点/上屋 等伪小区）
  const namedPlaces = members.filter(p =>
    !p.isMarketProxy &&
    p.rents?.length > 0 &&
    (REAL_ESTATE_KINDS.has(p.kind) || p.id === 'v2-baishizhou')
  );
  const street = streetById.get(pl.streetId);
  const distInfo = distInfoByName.get(pl.district);

  // Market trends (check plate's own proxy/member marketTrend first, then street)
  const trend = {};
  const srcMarket = members.find(m => m.marketTrend)?.marketTrend || null;
  const stMarket = street?.mid != null ? marketById[street.mid] : null;
  for (const r of ['1', '2', '3']) {
    if (srcMarket?.[r]) trend[r] = srcMarket[r];
    else if (stMarket) {
      const obs = latest58(stMarket, r);
      if (obs) trend[r] = { ...obs, marketName: stMarket.name, url: stMarket.url };
    }
  }

  // Honest 元/㎡·月 calculation (NO made-up fake multipliers!):
  const sampleUnits = [];
  for (const m of members.filter(p => !p.isMarketProxy)) {
    for (const r of m.rents) {
      if (r.unitPrice > 0 && r.grain !== 'official_affordable') sampleUnits.push(r.unitPrice);
    }
  }
  sampleUnits.sort((a, b) => a - b);
  const sampleMedianUnit = sampleUnits.length ? sampleUnits[Math.floor(sampleUnits.length / 2)] : null;

  let unitPrice = null, unitBasis = '';
  if (sampleMedianUnit && (pl.clipId || !pl.refUnit)) {
    unitPrice = sampleMedianUnit;
    unitBasis = '片区挂牌/行情换算';
  } else if (pl.refUnit) {
    unitPrice = pl.refUnit;
    unitBasis = '政府街道参考价';
  } else if (sampleMedianUnit) {
    unitPrice = sampleMedianUnit;
    unitBasis = '片区挂牌/行情换算';
  } else if (distInfo?.community?.price) {
    unitPrice = distInfo.community.price;
    unitBasis = `${pl.district}小区均价`;
  } else if (distInfo?.refs2022?.[0]) {
    unitPrice = distInfo.refs2022[0];
    unitBasis = `${pl.district}官方参考`;
  }

  // Real metro lines serving this plate
  const stSet = plateStations.get(pl.id) || new Set();
  const lineSet = new Set();
  for (const st of stSet) {
    for (const ln of stationToLines.get(st) || []) lineSet.add(ln);
  }
  const lines = [...lineSet].sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

  // Nearby verified commercial landmarks (within 1.8km -> Civ 6 🛍 Buff + Skylines green influence lines!)
  const nearbyMalls = mallLandmarks
    .map(m => ({ id: m.id, name: m.name, coord: m.coord, meters: Math.round(meter(pl.coord, m.coord)) }))
    .filter(m => m.meters <= 1800)
    .sort((a, b) => a.meters - b.meters)
    .slice(0, 2);

  // Events, policies, facilities, risks mapped cleanly to this plate
  const plateEvents = [...new Set([
    ...members.flatMap(m => m.eventIds),
    ...events.filter(ev => ev.streetId === pl.streetId && (!pl.clipId || resolvePlateId(pl.streetId, ev.xy) === pl.id)).map(e => e.id),
  ])];
  const platePolicies = [...new Set([
    ...members.flatMap(m => m.policyIds),
    ...(policiesData.policies || []).filter(pol => (pol.sites || []).some(site => site.streetId === pl.streetId)).map(p => p.id),
  ])];
  const streetFacs = facilities.filter(f => f.streetId === pl.streetId);
  const unlocatedStreetFacs = streetFacs.filter(f => !f.location?.gcj02);
  const osmNearFacs = facilities.filter(f => f.location?.gcj02 && meter(pl.coord, f.location.gcj02) <= 2200);
  const facCats = [...new Set([
    ...unlocatedStreetFacs.map(f => f.category),
    ...osmNearFacs.map(f => f.category),
    ...(nearbyMalls.length ? ['mall'] : []),
  ])];

  const plateRisks = [...new Set([
    ...members.flatMap(m => m.riskEventIds),
    ...publicEvents.filter(pe => {
      const hitStation = (pe.near || []).some(st => stSet.has(st));
      const radius = pe.id === 'airport-noise' ? 4200 : 1800;
      const hitCoord = meter(pe.coord, pl.coord) <= radius && (!pl.clipId || resolvePlateId(pl.streetId, project(pe.coord)) === pl.id || pe.id === 'airport-noise');
      return hitStation || hitCoord;
    }).map(e => e.id),
  ])];

  const stCensus = streetCensusById.get(pl.streetId) || null;
  const multiMatch = (multiRentSpec.entries || []).find(e => e.plateId === pl.id);
  pl.streetPop = stCensus?.pop ?? null;
  pl.streetAreaKm2 = stCensus?.areaKm2 ?? null;
  pl.streetDensity = stCensus?.density ?? null;
  pl.multiSourceRents = multiMatch ? multiMatch.items : [];
  pl.unitPrice = unitPrice;
  pl.unitBasis = unitBasis;
  pl.verifiedUnit = sampleMedianUnit;
  pl.lines = lines;
  pl.malls = nearbyMalls;
  pl.facCats = facCats;
  pl.trend = trend;
  pl.placeIds = namedPlaces.map(p => p.id);
  pl.allMemberIds = members.map(p => p.id);
  pl.eventIds = plateEvents;
  pl.policyIds = platePolicies;
  pl.facilityCount = streetFacs.length;
  pl.riskIds = plateRisks;
  delete pl.seedXY;
  delete pl.mid;
}

// 4. Natural terrain & fixed landmarks (pre-projected for instant rendering!)
const terrain = {
  mountains: geoSpec.mountains.map(m => ({ id: m.id, name: m.name, minZoom: m.minZoom, ...smoothClosedPath(m.coords) })),
  water: geoSpec.water.map(w => ({ id: w.id, name: w.name, minZoom: w.minZoom, ...smoothClosedPath(w.coords) })),
  airport: { id: geoSpec.airport.id, name: geoSpec.airport.name, ...smoothClosedPath(geoSpec.airport.coords) },
};

// 5. Metro skeleton (all 16 real Shenzhen Metro lines from base.json!)
const metroLines = Object.values(base.metro || {}).map(m => ({ id: m.id, p: m.p }));

// 6. Office migration corridors
const migrations = [
  { from: 'dachong', to: 'island', label: '科兴→企鹅岛' },
  { from: 'houhai', to: 'guiwan', label: '后海→桂湾' },
].map(m => {
  const a = events.find(e => e.id === m.from), b = events.find(e => e.id === m.to);
  return a && b ? { ...m, fromXy: a.xy, toXy: b.xy } : null;
}).filter(Boolean);

// 6.5 Verified affordable rental housing projects (existing + upcoming supply)
const plateIdSet = new Set(plates.map(p => p.id));
const affordableProjects = (affSpec.projects || []).map(pr => {
  const xy = project(pr.coord);
  let plateId = pr.plateId;
  if (!plateIdSet.has(plateId)) {
    const fallbackStreet = pr.plateId.startsWith('st-') ? pr.plateId.slice(3) : (fine.stStreet[pr.station] || '');
    if (fallbackStreet) plateId = resolvePlateId(fallbackStreet, xy, pr.station);
  }
  return { ...pr, plateId, xy };
});
const affByPlate = new Map();
for (const pr of affordableProjects) {
  if (!affByPlate.has(pr.plateId)) affByPlate.set(pr.plateId, []);
  affByPlate.get(pr.plateId).push(pr.id);
}
for (const pl of plates) {
  pl.affordableIds = affByPlate.get(pl.id) || [];
}

// 7. Unified 600+ Destination Directory: Workplaces + Landmarks + Metro Stations + Bus Hubs + Plates + Estates + Facilities
const destMap = new Map();
function addDest(name, kind, coord, district = '', extraId = '', aliases = [], note = '') {
  if (!name || !Array.isArray(coord) || coord.length < 2) return;
  if (destMap.has(name)) return;
  const entry = { name, kind, coord: [Number(coord[0].toFixed(5)), Number(coord[1].toFixed(5))], district, refId: extraId };
  if (aliases?.length) entry.aliases = aliases;
  if (note) entry.note = note;
  destMap.set(name, entry);
}
for (const l of baseLandmarks) addDest(l.name, l.kind === 'hub' ? '办公园区' : l.kind === 'mall' ? '知名商圈' : '交通枢纽', l.coord, l.district, l.id, [], l.note);
for (const w of workplaceSpec.items || []) addDest(w.name, w.kind, w.coord, w.district, w.id, w.aliases || [], w.note || '');
for (const n of journey.nodes || []) addDest(n.name, n.kind || '站点', n.coord, '', '');
for (const pl of plates) addDest(pl.name + '板块', '居住片区', pl.coord, pl.district, pl.id);
for (const pr of affordableProjects) addDest(pr.name, '保租房项目', pr.coord, pr.district, pr.id);
for (const p of places) {
  if (!p.isMarketProxy) addDest(p.shortName, p.kind || '小区/村', p.coord, p.district, p.id);
}
for (const f of facilities) {
  if (f.location?.gcj02) addDest(f.name, f.category === 'mall' ? '商场' : f.category === 'school' ? '学校' : '配套', f.location.gcj02, '', f.id);
}
const destinations = [...destMap.values()];

const atlasV3 = {
  version: 3,
  asOf: atlasAsOf,
  listingMonth: base.listingMonth ?? null,
  housingTypeMeta: corridor.housingTypeMeta,
  refSource: fine.refSource,
  districts,
  streetClips,
  plates,
  places,
  terrain,
  landmarks,
  metroLines,
  events,
  migrations,
  publicEvents,
  affordableCityPlan: affSpec.cityPlan || null,
  affordableProjects,
  facilities,
  policies: policiesData.policies || [],
  destinations,
  stations: base.stations,
  metro: base.metro,
};

const outFile = path.join(ROOT, 'data', 'atlas-v3.json');
fs.writeFileSync(outFile, JSON.stringify(atlasV3), 'utf8');

console.log(`data/atlas-v3.json · ${(fs.statSync(outFile).size / 1024).toFixed(1)} KB`);
console.log(`  无缝拼图板块: ${plates.length} (含单价: ${plates.filter(p => p.unitPrice > 0).length}/${plates.length})`);
console.log(`  山体: ${terrain.mountains.length} | 水库: ${terrain.water.length} | 地铁线: ${metroLines.length} | 固定地标: ${landmarks.length}`);
console.log(`  全城可设目的地: ${destinations.length} 处 | 细化片区/楼盘: ${places.filter(p => !p.isMarketProxy).length} | 核验设施: ${facilities.length}`);
