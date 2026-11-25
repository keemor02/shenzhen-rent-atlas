/* V3 核心计算引擎：98 块无缝居住板块 + 529 处任意目的地双地通勤 + 每平米均价/分形态月租 + 议价与非必要溢价 + 四维适配评分 */
(function (global) {
  'use strict';

  const ALIASES = {
    '留仙洞总部基地': '留仙洞', '留仙洞总部': '留仙洞', '啤酒小镇': '兴东啤酒小镇',
    '腾讯企鹅岛': '企鹅岛', '腾讯岛': '企鹅岛', '腾讯': '企鹅岛', '前海': '前海金融峡谷',
    '深圳北': '深圳北站', '科兴': '科兴科学园', '华为总部': '坂田华为总部',
    '华为': '坂田华为总部', '大疆': '大疆天空之城', '大仟里': '宝安大仟里',
    '宝安机场': '宝安国际机场', '机场': '宝安国际机场', '大运': '大运中心',
  };

  const QUICK_DESTS = ['留仙洞', '科兴科学园', '企鹅岛', '前海金融峡谷', '壹方城', '深圳北站'];

  const HUB_NAMES = new Set([
    '企鹅岛', '科兴科学园', '腾讯滨海大厦', '大疆天空之城', '坂田华为总部',
    '深圳湾科技生态园', '前海金融峡谷', '兴东啤酒小镇', '软件产业基地', '留仙洞',
  ]);

  const GRAIN_LABELS = {
    project: '实采',
    official_affordable: '官方保租',
    band: '参考带',
    market: '商圈均值',
    personal: '我的实录',
  };

  const FIT_NAMES = { commute: '通勤', rent: '租金', environment: '环境', convenience: '便利' };
  const FIT_KEYS = ['commute', 'rent', 'environment', 'convenience'];

  function unpackMatrix(b64, n) {
    const bin = atob(b64), rows = new Array(n);
    let p = 0;
    for (let i = 0; i < n; i++) {
      const row = new Int32Array(n);
      let prev = 0;
      for (let j = 0; j < n; j++) {
        let z = 0, shift = 0, b;
        do { b = bin.charCodeAt(p++); z |= (b & 127) << shift; shift += 7; } while (b & 128);
        prev += (z & 1) ? -((z + 1) >>> 1) : (z >>> 1);
        row[j] = prev;
      }
      rows[i] = row;
    }
    return rows;
  }

  const bound = n => Math.max(0, Math.min(100, n));
  const money = n => Math.round(n).toLocaleString('zh-CN');
  const validCoord = p => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
  const osmURL = item => /^https:\/\/www\.openstreetmap\.org\/(?:node|way|relation)\/[1-9]\d*$/.test(item?.osm?.source || '') ? item.osm.source : '';

  function createEngine(atlas, travel, timing) {
    if (travel?.driving?.packed) {
      const pk = travel.driving.packed;
      travel.driving.durations = unpackMatrix(pk.durations, pk.n);
      travel.driving.distances = unpackMatrix(pk.distances, pk.n);
      delete travel.driving.packed;
    }

    const nodes = new Map((travel.nodes || []).map((n, i) => [n.name, { ...n, i }]));
    const allNodes = [...nodes.values()];
    const railNames = new Set(Object.values(timing.lines || {}).flatMap(l => l.stations));
    const railNodes = allNodes.filter(n => railNames.has(n.name));
    const hubNodes = (travel.workplaces || []).filter(name => HUB_NAMES.has(name) && nodes.has(name)).map(name => nodes.get(name));

    const rail = global.makeRailPlanner({ metro: atlas.metro }, timing);
    const railCache = new Map();
    const busCache = new Map();
    const islandCache = new Map();
    const railCosts = { access: 0, egress: 0, wait: 3, transfer: 5 };

    const meter = (a, b) => Math.hypot((a[0] - b[0]) * 102700, (a[1] - b[1]) * 110850);
    const walk = m => Math.ceil(m * 1.25 / 75);
    const closest = (ll, list) => list.reduce((a, b) => meter(a.coord, ll) <= meter(b.coord, ll) ? a : b);
    const nearestRail = ll => closest(ll, railNodes);
    const nearestNode = ll => closest(ll, allNodes);

    const plateById = new Map(atlas.plates.map(p => [p.id, p]));
    const placeById = new Map(atlas.places.map(p => [p.id, p]));
    const landmarkById = new Map(atlas.landmarks.map(l => [l.id, l]));
    const eventById = new Map(atlas.events.map(e => [e.id, e]));
    const policyById = new Map(atlas.policies.map(p => [p.id, p]));
    const facById = new Map(atlas.facilities.map(f => [f.id, f]));
    const riskById = new Map(atlas.publicEvents.map(e => [e.id, e]));
    const destByName = new Map(atlas.destinations.map(d => [d.name, d]));
    const locatedFacilities = (atlas.facilities || []).filter(f => validCoord(f.location?.gcj02) && osmURL(f));

    // Pre-resolve nearest transit nodes for every plate & place once
    const anchorCache = new Map();
    function getOriginNodes(id, coord, stationName) {
      if (anchorCache.has(id)) return anchorCache.get(id);
      const node = (stationName && nodes.get(stationName)) || nearestNode(coord);
      const station = (stationName && railNames.has(stationName) && nodes.get(stationName)) || nearestRail(coord);
      const res = { node, station };
      anchorCache.set(id, res);
      return res;
    }

    // 任意目的地解析：支持 529 处知名地标、商圈、351 地铁站、30 公交站、98 板块、小区/村与核验设施！
    function resolveDestination(raw) {
      const q = String(raw ?? '').trim();
      if (!q) return null;
      const strip = q.replace(/(?:地铁站|公交站|站)$/u, '');
      const tryExact = k => {
        if (destByName.has(k)) return destByName.get(k);
        if (Object.hasOwn(ALIASES, k) && destByName.has(ALIASES[k])) return destByName.get(ALIASES[k]);
        if (nodes.has(k)) {
          const n = nodes.get(k);
          return { name: n.name, kind: n.kind || '站点', coord: n.coord, district: '', refId: '' };
        }
        return null;
      };
      const exact = tryExact(q) || tryExact(strip);
      if (exact) return exact;
      if (strip.length < 2) return null;
      const hits = [];
      for (const d of atlas.destinations) {
        if (d.name.includes(strip)) hits.push(d);
        if (hits.length > 3) break;
      }
      return hits.length === 1 ? hits[0] : null;
    }

    function searchDestinations(raw, limit = 8) {
      const q = String(raw ?? '').trim();
      if (!q) return [];
      const aliasTarget = Object.entries(ALIASES).filter(([k]) => k.includes(q)).map(([, v]) => destByName.get(v)).filter(Boolean);
      const exact = [], starts = [], contains = [];
      const seen = new Set();
      const pushUnique = (arr, item) => { if (!seen.has(item.name)) { seen.add(item.name); arr.push(item); } };
      aliasTarget.forEach(d => pushUnique(exact, d));
      for (const d of atlas.destinations) {
        if (d.name === q) pushUnique(exact, d);
        else if (d.name.startsWith(q)) pushUnique(starts, d);
        else if (d.name.includes(q)) pushUnique(contains, d);
      }
      return [...exact, ...starts, ...contains].slice(0, limit);
    }

    // 任意起点 -> 任意目的地（地标/商圈/小区/公交/地铁）的真实门到门通勤估时
    function routeToDest(originId, originCoord, originStation, destObj, opt) {
      if (!destObj || !validCoord(originCoord) || !validCoord(destObj.coord)) return null;
      const { node: from, station: fromRail } = getOriginNodes(originId, originCoord, originStation);
      const toNode = nodes.get(destObj.name) || nearestNode(destObj.coord);
      const distDirect = meter(originCoord, destObj.coord);
      const walkDirect = walk(distDirect);

      // 距离在 1.1km 内直接步行最快
      if (distDirect <= 1100) {
        return { minutes: Math.max(3, walkDirect), walk: Math.max(3, walkDirect), legs: [], label: '直接步行', same: true };
      }

      const a = Math.max(opt.access, walk(meter(originCoord, from.coord)));
      const eNode = Math.max(opt.egress, walk(meter(destObj.coord, toNode.coord)));

      if (opt.mode === 'rail') {
        const fromIsland = from.name === '企鹅岛';
        const toIsland = destObj.name === '企鹅岛';
        if (fromIsland && toIsland) return { minutes: a + eNode, walk: a + eNode, legs: [], label: '园区内步行', same: true };
        const destRail = toIsland ? toNode : (railNames.has(destObj.name) ? nodes.get(destObj.name) : nearestRail(destObj.coord));
        const fromWalk = fromIsland ? a : Math.max(opt.access, walk(meter(originCoord, fromRail.coord)));
        const destWalk = toIsland ? opt.egress : Math.max(opt.egress, walk(meter(destObj.coord, destRail.coord)));
        let r;
        if (fromIsland) {
          if (!islandCache.has(destRail.name)) islandCache.set(destRail.name, rail.fromIsland(destRail.name, railCosts));
          r = islandCache.get(destRail.name);
        } else {
          if (!railCache.has(destRail.name)) railCache.set(destRail.name, rail.to(destRail.name, railCosts));
          r = railCache.get(destRail.name).get(fromRail.name);
        }
        if (!r) return null;
        const w = fromWalk + destWalk;
        return {
          ...r, walk: w, minutes: r.minutes + w,
          origin: fromIsland ? from.name : fromRail.name,
          terminal: destRail.name,
          label: r.sameStation ? '同站步行' : r.legs.map(l => Object.hasOwn(timing.lines, l.line) ? l.line + '号线' : l.line).join('→'),
        };
      }

      if (opt.mode === 'drive') {
        const sec = travel.driving?.durations?.[from.i]?.[toNode.i];
        const dist = travel.driving?.distances?.[from.i]?.[toNode.i];
        if (sec == null || dist == null) return null;
        return { minutes: Math.ceil(sec / 60) + a + eNode, seconds: sec, meters: dist, walk: a + eNode, legs: [], label: `驾车 ${(dist / 1000).toFixed(1)}km` };
      }

      // Bus
      if (from.i === toNode.i) return { minutes: a + eNode, walk: a + eNode, legs: [], label: '同点步行', same: true };
      const key = `${from.name}|${toNode.name}`;
      if (!busCache.has(key)) {
        const possible = global.busOptions(travel, from.i, toNode.i);
        busCache.set(key, [possible.direct, possible.transfer].filter(Boolean));
      }
      const best = busCache.get(key).flatMap(r => {
        const w = Math.max(a, walk(r.fromMeters || 0)) + Math.max(eNode, walk(r.toMeters || 0)) + walk(r.transferMeters || 0);
        const shuttle = r.shuttle && (timing.shuttles || []).find(s => r.legs.some(l => l.line === s.line));
        if (r.shuttle && !shuttle) return [];
        const wait = shuttle ? shuttle.wait : 5 * r.legs.length;
        const ride = shuttle ? shuttle.ride : Math.ceil(r.estimatedRide);
        return [{ ...r, ride, wait, walk: w, minutes: ride + wait + w, label: r.legs.map(l => l.line).join('→') }];
      }).sort((x, y) => x.minutes - y.minutes)[0];
      return best || null;
    }

    function nearbyFacilities(coord, category = '') {
      if (!validCoord(coord)) return [];
      return locatedFacilities
        .filter(item => !category || item.category === category)
        .map(item => ({ ...item, meters: meter(coord, item.location.gcj02), osmUrl: osmURL(item) }))
        .filter(item => Number.isFinite(item.meters) && item.meters >= 0 && item.meters <= 2500)
        .sort((a, b) => a.meters - b.meters || a.id.localeCompare(b.id))
        .slice(0, 5);
    }

    function filterRents(rawRents, housingTypesFallback, state, personalEntry) {
      const allowedTypes = new Set(state.housingTypes || []);
      const targetRoom = state.room ? Number(state.room) : 0;
      const list = [];

      if (personalEntry?.monthly > 0 && (!targetRoom || !personalEntry.rooms || personalEntry.rooms === targetRoom)) {
        list.push({
          type: housingTypesFallback?.[0] || 'modernEstate',
          room: personalEntry.rooms || targetRoom || 1,
          low: personalEntry.monthly, median: personalEntry.monthly, high: personalEntry.monthly,
          sqm: personalEntry.sqm ? [personalEntry.sqm, personalEntry.sqm] : null,
          grain: 'personal', period: personalEntry.observed || '实地实录',
          basis: '我实地看房记录的报价', source: '', sourceName: '个人记录',
        });
      }

      for (const r of rawRents || []) {
        if (state.verifiedOnly && !['project', 'official_affordable', 'personal'].includes(r.grain)) continue;
        if (targetRoom && r.room !== targetRoom) continue;
        if (r.type !== 'mixed' && allowedTypes.size && !allowedTypes.has(r.type)) continue;
        if (r.type === 'mixed' && allowedTypes.size < 4 && (rawRents || []).some(x => x.type !== 'mixed')) continue;
        if (state.sqm > 0 && (!r.sqm || r.sqm[1] < state.sqm)) continue;
        list.push(r);
      }

      // Deduplicate identical band entries when aggregated at plate level
      const dedup = new Map();
      const tier = { personal: 0, project: 1, official_affordable: 1, band: 2, market: 3 };
      for (const r of list) {
        const k = `${r.grain}|${r.type}|${r.room}|${r.low}|${r.high}|${r.basis}`;
        if (!dedup.has(k)) dedup.set(k, r);
      }
      const sorted = [...dedup.values()].sort((a, b) => (tier[a.grain] ?? 9) - (tier[b.grain] ?? 9) || a.median - b.median);
      const best = sorted[0] || null;
      const withinBudget = !state.budget || (best ? best.low <= state.budget : true);
      return { best, all: sorted, withinBudget };
    }

    // 板块级「非必要溢价」模型（15分钟步行圈 + ±5分钟同程 + ≥3 处圈外同口径对比）
    function evaluatePlatePremiums(plateRows, dest1, dest2, state) {
      const WALK_LIMIT = 15, TIME_WINDOW = 5, MIN_PEERS = 3;
      const usedSet = new Set(state.usedHubs || []);

      const walkTo = (coord, targetCoord, name) => {
        if (!validCoord(coord) || !validCoord(targetCoord)) return null;
        return { name, walk: walk(meter(coord, targetCoord)) };
      };

      // 找出每个重点园区物理坐落所在的板块（距离 ≤ 1.6km 才归属，避免隔海的企鹅岛误判到宝中）
      const hubHomePlate = new Map();
      for (const h of hubNodes) {
        const home = plateRows.reduce((a, b) => meter(a.plate.coord, h.coord) <= meter(b.plate.coord, h.coord) ? a : b);
        if (meter(home.plate.coord, h.coord) <= 1600) hubHomePlate.set(h.name, home.plate.id);
      }

      const walkingSites = new Map();
      for (const row of plateRows) {
        row.premium = { status: 'no-work', reason: '先设目的地', hub: null, own: null, median: null, extra: null, count: 0, alternatives: [] };
        if (!dest1) continue;
        const sampleCoords = [row.plate.coord, ...row.childRows.map(c => c.place.coord)].filter(validCoord);
        const nearby = hubNodes.map(h => {
          const minWalk = Math.min(...sampleCoords.map(c => walk(meter(c, h.coord))));
          const insidePlate = hubHomePlate.get(h.name) === row.plate.id;
          return { name: h.name, walk: insidePlate ? Math.min(minWalk, 10) : minWalk, insidePlate };
        }).filter(x => x.insidePlate || x.walk <= WALK_LIMIT).sort((a, b) => a.walk - b.walk || a.name.localeCompare(b.name, 'zh'));
        walkingSites.set(row, nearby);
      }
      if (!dest1) return;

      const simCommute = (a, b) =>
        a.route && b.route && Math.abs(a.route.minutes - b.route.minutes) <= TIME_WINDOW &&
        (!dest2 || (a.route2 && b.route2 && Math.abs(a.route2.minutes - b.route2.minutes) <= TIME_WINDOW));
      const noSlower = (a, b) =>
        a.route && b.route && a.route.minutes <= b.route.minutes &&
        (!dest2 || (a.route2 && b.route2 && a.route2.minutes <= b.route2.minutes));

      for (const row of plateRows) {
        const res = row.premium;
        const prox = walkingSites.get(row) || [];
        const own1 = walkTo(row.plate.coord, dest1.coord, dest1.name);
        const own2 = dest2 ? walkTo(row.plate.coord, dest2.coord, dest2.name) : null;
        const ownList = [own1 && { ...own1, secondary: false }, own2 && { ...own2, secondary: true }].filter(Boolean).sort((a, b) => a.walk - b.walk);
        res.own = ownList[0] || null;

        if (res.own && res.own.walk <= WALK_LIMIT) {
          res.status = 'direct';
          res.reason = res.own.secondary ? '第二目的地在 15 分钟步行圈内' : '目的地在 15 分钟步行圈内';
          continue;
        }
        const usedHub = prox.find(h => usedSet.has(h.name));
        res.hub = usedHub || prox[0] || null;
        if (usedHub) {
          res.status = 'used';
          res.reason = `你标记了常去「${usedHub.name}」，不计入溢价`;
          continue;
        }
        if (!res.hub) {
          res.status = 'no-hub';
          res.reason = '在 10 大园区 15 分钟步行圈外';
          continue;
        }

        res.status = 'unknown';
        if (!row.route || (dest2 && !row.route2)) {
          res.reason = '缺少到目的地的通勤估时';
          continue;
        }

        // 同程圈外板块单价（元/㎡·月）对比：全城 98 板块统一口径，统计更公平！
        const myUnit = row.plate.unitPrice;
        const peers = plateRows.filter(other =>
          other !== row && other.plate.unitPrice > 0 && simCommute(other, row) &&
          !(walkingSites.get(other) || []).some(h => h.name === res.hub.name)
        );
        res.count = peers.length;
        if (!myUnit || peers.length < MIN_PEERS) {
          res.reason = `同程圈外对照不足 3 处（当前 ${peers.length} 处）`;
          continue;
        }
        const vals = peers.map(p => p.plate.unitPrice).sort((a, b) => a - b);
        const mid = Math.floor(vals.length / 2);
        const medUnit = Math.round(vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2);
        const extraUnit = myUnit - medUnit;
        // 换算成 35㎡ 标准一居月差额，直观易懂！
        const stdSqm = state.sqm > 0 ? state.sqm : (state.room === '2' ? 60 : state.room === '3' ? 85 : 35);
        res.median = medUnit * stdSqm;
        res.medianUnit = medUnit;

        if (extraUnit <= 4) {
          res.status = 'no-extra';
          res.extra = 0;
          res.extraUnit = 0;
          res.reason = `本板块参考单价（${myUnit}元/㎡）未明显高于同程圈外中位（${medUnit}元/㎡）`;
          continue;
        }

        const cheaperPeers = peers
          .filter(o => o.plate.unitPrice < myUnit && noSlower(o, row) && o.eligible)
          .sort((a, b) => a.plate.unitPrice - b.plate.unitPrice || a.route.minutes - b.route.minutes)
          .slice(0, 2);

        res.alternatives = cheaperPeers.map(o => ({
          id: o.plate.id, name: o.plate.name, unitPrice: o.plate.unitPrice,
          minutes: o.route.minutes, future: o.route2?.minutes ?? null,
        }));

        if (!cheaperPeers.length) {
          res.status = 'tradeoff';
          res.reason = `单价高于同程中位（${medUnit}元/㎡），但暂缺更便宜且通勤不增的替代板块`;
          continue;
        }

        res.status = 'premium';
        res.extraUnit = extraUnit;
        res.extra = Math.round(extraUnit * stdSqm);
        res.stdSqm = stdSqm;
        res.reason = `邻近「${res.hub.name}」但你不到此上班，单价比同程圈外中位（${medUnit}元/㎡）贵 ${extraUnit} 元/㎡（按 ${stdSqm}㎡ 折合约 ¥${money(res.extra)}/月）`;
      }
    }

    function assessFit(row, state) {
      const weights = state.weights || { commute: 1, rent: 1, environment: 1, convenience: 1 };
      const wVal = k => [1, 2, 3].includes(Number(weights[k])) ? Number(weights[k]) : 1;
      const entry = row.entry;
      const dims = {};

      if (row.route) {
        let ratio = row.route.minutes / state.limit;
        let why = `单程 ${row.route.minutes} / 上限 ${state.limit} 分`;
        if (state.work2 && state.limit2 > 0 && row.route2) {
          ratio = Math.max(ratio, row.route2.minutes / state.limit2);
          why += `，二程 ${row.route2.minutes} / ${state.limit2} 分`;
        }
        dims.commute = { value: `${row.route.minutes}分`, why, score: bound(100 - 40 * ratio) };
      } else {
        dims.commute = { value: state.work ? '待核' : '未设目的地', why: '设目的地后计分', score: null };
      }

      const estMonthly = row.rent?.median || (row.plate.unitPrice ? row.plate.unitPrice * (state.room === '2' ? 60 : state.room === '3' ? 85 : 35) : null);
      if (!estMonthly) {
        dims.rent = { value: '待补', why: '缺租金样本', score: null };
      } else if (state.budget > 0) {
        const diff = state.budget - estMonthly;
        dims.rent = {
          value: `约¥${money(estMonthly)}`,
          why: diff >= 0 ? `预算余 ¥${money(diff)}` : `超预算 ¥${money(-diff)}`,
          score: bound(100 - 40 * estMonthly / state.budget),
        };
      } else {
        dims.rent = { value: `${row.plate.unitPrice}元/㎡`, why: '填月租预算可算租金分', score: null };
      }

      for (const k of ['environment', 'convenience']) {
        const stars = entry?.[k];
        if (Number.isInteger(stars) && stars >= 1 && stars <= 5) {
          dims[k] = { value: `${stars}星`, why: `实地体感${entry.observed ? ' · ' + entry.observed : ''}`, score: (stars - 1) * 25, stars };
        } else {
          dims[k] = { value: '待踩点', why: k === 'environment' ? '待实地听噪采光' : '待实地走买菜路线', score: null, stars: null };
        }
      }

      const totalW = FIT_KEYS.reduce((s, k) => s + wVal(k), 0);
      let earned = 0, unknown = 0, count = 0;
      for (const k of FIT_KEYS) {
        if (dims[k].score == null) unknown += wVal(k);
        else { earned += wVal(k) * dims[k].score; count++; }
      }
      const p = row.premium;
      const premiumPenalty = p?.status === 'premium' && p.extra > 0 && p.median > 0
        ? Math.min(10, Math.round(40 * p.extra / p.median))
        : 0;
      const low = bound(Math.round(earned / totalW) - premiumPenalty);
      const high = bound(Math.round((earned + 100 * unknown) / totalW) - premiumPenalty);
      const rangeText = count === 0 ? '' : (count === FIT_KEYS.length ? `${low}分` : `${low}–${high}分`);
      return { dimensions: dims, low, high, count, premiumPenalty, rangeText };
    }

    function compareToRef(row, refRow) {
      if (!refRow || !row || refRow.plate.id === row.plate.id) return [];
      const out = [];
      if (row.route && refRow.route) {
        const d = refRow.route.minutes - row.route.minutes;
        if (d !== 0) out.push({ better: d > 0, text: `通勤${d > 0 ? '少' : '多'}${Math.abs(d)}分` });
      }
      if (row.plate.unitPrice && refRow.plate.unitPrice) {
        const d = refRow.plate.unitPrice - row.plate.unitPrice;
        if (Math.abs(d) >= 3) out.push({ better: d > 0, text: `单价${d > 0 ? '低' : '高'}${Math.abs(d)}元/㎡` });
      }
      return out;
    }

    function evaluateAll(state, store) {
      const dest1 = resolveDestination(state.work);
      const dest2 = resolveDestination(state.work2);
      const plateRows = [];

      // Evaluate child places first so plates aggregate exact rents & signals
      const placeRowById = new Map();
      for (const p of atlas.places) {
        const entry = store.getEntry(p.id);
        const route = dest1 ? routeToDest(p.id, p.coord, p.station, dest1, state) : null;
        const route2 = dest2 ? routeToDest(p.id, p.coord, p.station, dest2, state) : null;
        const rentInfo = filterRents(p.rents, p.housingTypes, state, entry);
        placeRowById.set(p.id, {
          place: p, entry, route, route2,
          rent: rentInfo.best, rentsMatched: rentInfo.all, withinBudget: rentInfo.withinBudget,
          nearbyFacs: nearbyFacilities(p.coord),
          events: p.eventIds.map(id => eventById.get(id)).filter(Boolean),
          policies: p.policyIds.map(id => policyById.get(id)).filter(Boolean),
          risks: p.riskEventIds.map(id => riskById.get(id)).filter(Boolean),
        });
      }

      for (const pl of atlas.plates) {
        const entry = store.getEntry(pl.id);
        const route = dest1 ? routeToDest(pl.id, pl.coord, pl.station, dest1, state) : null;
        const route2 = dest2 ? routeToDest(pl.id, pl.coord, pl.station, dest2, state) : null;

        const childRows = pl.placeIds.map(id => placeRowById.get(id)).filter(Boolean);
        const allMemberRows = pl.allMemberIds.map(id => placeRowById.get(id)).filter(Boolean);
        const allRents = allMemberRows.flatMap(r => r.place.rents || []);
        const allTypes = [...new Set(allMemberRows.flatMap(r => r.place.housingTypes || []))];
        const rentInfo = filterRents(allRents, allTypes, state, entry);

        const trendRoom = state.room || '1';
        const trend = pl.trend?.[trendRoom] || pl.trend?.['1'] || null;
        const evs = pl.eventIds.map(id => eventById.get(id)).filter(Boolean);
        const pols = pl.policyIds.map(id => policyById.get(id)).filter(Boolean);
        const risks = pl.riskIds.map(id => riskById.get(id)).filter(Boolean);
        const oppEvents = evs.filter(e => e.dir === 'opportunity');
        const tightEvents = evs.filter(e => e.dir === 'tight');
        const mixedEvents = evs.filter(e => e.dir === 'mixed');

        // Arbitrage scoring
        const reasons = [];
        let arbScore = 0;
        for (const ev of oppEvents) { arbScore += 2; reasons.push(`${ev.signalLabel}：${ev.summary}`); }
        if (trend && Number.isFinite(trend.yoy) && trend.yoy <= -3) {
          arbScore += 1;
          reasons.push(`商圈 ${trend.period} 同户型同比 ${trend.yoy}%`);
        }
        if (tightEvents.length) arbScore -= 2;

        let arbStatus = 'neutral', arbLabel = '常规';
        if (arbScore >= 2 && !tightEvents.length) { arbStatus = 'opportunity'; arbLabel = '可议价'; }
        else if ((oppEvents.length && tightEvents.length) || mixedEvents.length) { arbStatus = 'mixed'; arbLabel = '分歧'; }
        else if (tightEvents.length) { arbStatus = 'tight'; arbLabel = '偏紧'; }
        else if (arbScore === 1) { arbStatus = 'watch'; arbLabel = '留意'; }

        // Exclusions
        const exclusions = [];
        if (dest1 && (!route || route.minutes > state.limit)) exclusions.push('通勤超上限');
        if (dest2 && state.limit2 > 0 && (!route2 || route2.minutes > state.limit2)) exclusions.push('二程超上限');
        const stdSqm = state.sqm > 0 ? state.sqm : (state.room === '2' ? 60 : state.room === '3' ? 85 : 35);
        if (state.budget > 0) {
          const checkLow = rentInfo.best ? rentInfo.best.low : (pl.unitPrice ? pl.unitPrice * stdSqm * 0.85 : null);
          if (checkLow != null && checkLow > state.budget) exclusions.push('超预算');
        }
        if (state.housingTypes.length < 4 && allTypes.length > 0 && !allTypes.some(t => state.housingTypes.includes(t))) {
          exclusions.push('形态不符');
        }
        if (state.verifiedOnly && !rentInfo.best) exclusions.push('缺实采样本');
        if (state.oppOnly && arbStatus !== 'opportunity' && arbStatus !== 'watch') exclusions.push('无议价信号');

        plateRows.push({
          plate: pl, entry, route, route2,
          rent: rentInfo.best, rentsMatched: rentInfo.all,
          childRows, trend, events: evs, policies: pols, risks,
          nearbyFacs: nearbyFacilities(pl.coord),
          arbitrage: { status: arbStatus, label: arbLabel, score: arbScore, reasons },
          exclusions,
          eligible: exclusions.length === 0,
        });
      }

      // Dynamic Peer Unit-Price Gap (±10 min commute) -> boosts Arbitrage Radar!
      if (dest1) {
        for (const row of plateRows) {
          if (!row.route || !row.plate.unitPrice) continue;
          const peers = plateRows.filter(o => o !== row && o.route && o.plate.unitPrice > 0 && Math.abs(o.route.minutes - row.route.minutes) <= 10)
            .map(o => o.plate.unitPrice).sort((a, b) => a - b);
          if (peers.length >= 4) {
            const med = peers[Math.floor(peers.length / 2)];
            const diff = med - row.plate.unitPrice;
            const pct = Math.round((diff / med) * 100);
            if (pct >= 12) {
              row.arbitrage.score += 2;
              row.arbitrage.reasons.push(`同通勤圈（±10分）均价中位 ${med}元/㎡，本板块低 ${diff}元/㎡（-${pct}%）`);
              if (row.arbitrage.status === 'neutral' || row.arbitrage.status === 'watch') {
                row.arbitrage.status = 'opportunity';
                row.arbitrage.label = '可议价';
              }
            }
          }
        }
      }

      evaluatePlatePremiums(plateRows, dest1, dest2, state);
      for (const row of plateRows) {
        row.fit = assessFit(row, state);
      }

      const plateRowById = new Map(plateRows.map(r => [r.plate.id, r]));
      const refRow = state.referenceId ? (plateRowById.get(state.referenceId) || plateRowById.get(placeById.get(state.referenceId)?.plateId) || null) : null;
      for (const row of plateRows) {
        row.refDeltas = refRow ? compareToRef(row, refRow) : [];
      }

      const eligiblePlates = plateRows.filter(r => r.eligible).sort((a, b) =>
        (b.arbitrage.score - a.arbitrage.score) ||
        (b.fit.low - a.fit.low) ||
        ((a.route?.minutes ?? 999) - (b.route?.minutes ?? 999)) ||
        ((a.plate.unitPrice ?? 999) - (b.plate.unitPrice ?? 999))
      );

      return {
        dest1, dest2, refRow,
        plateRows, plateRowById, placeRowById,
        eligiblePlates,
      };
    }

    function discoverNext(evalResult, seenSet) {
      const pool = evalResult.eligiblePlates.filter(r => !seenSet.has(r.plate.id) && r.plate.id !== evalResult.refRow?.plate.id);
      if (!pool.length) return null;
      if (evalResult.refRow) {
        const better = pool.find(r => r.refDeltas.length && r.refDeltas.every(d => d.better))
          || pool.find(r => r.refDeltas.some(d => d.better));
        if (better) return better;
      }
      return pool[0];
    }

    return {
      nodes, hubNodes, QUICK_DESTS, ALIASES, GRAIN_LABELS, FIT_NAMES, FIT_KEYS,
      resolveDestination, searchDestinations, nearbyFacilities, evaluateAll, discoverNext,
      plateById, placeById, landmarkById, eventById, policyById, facById, riskById,
    };
  }

  global.createV3Engine = createEngine;
})(typeof window !== 'undefined' ? window : globalThis);
