/* V2 核心计算引擎：双地通勤 + 分形态租金 + 议价雷达 + 非必要溢价 + 四维适配评分 + 2km OSM 设施测距 */
(function (global) {
  'use strict';

  const ALIASES = {
    '留仙洞总部基地': '留仙洞', '啤酒小镇': '兴东啤酒小镇', '腾讯企鹅岛': '企鹅岛',
    '腾讯岛': '企鹅岛', '腾讯': '企鹅岛', '前海': '桂湾', '深圳北': '深圳北站',
    '科兴': '科兴科学园', '华为总部': '坂田华为总部', '华为': '坂田华为总部', '大疆': '大疆天空之城',
  };

  const QUICK_WORKS = ['留仙洞', '科兴科学园', '企鹅岛', '前海金融峡谷', '岗厦北'];

  // 10 处重点办公园区参照点（用于 15 分钟步行圈「非必要溢价」判断，与 Codex 核验口径一致）
  const HUB_NAMES = new Set([
    '企鹅岛', '科兴科学园', '腾讯滨海大厦', '大疆天空之城', '坂田华为总部',
    '深圳湾科技生态园', '前海金融峡谷', '兴东啤酒小镇', '软件产业基地', '留仙洞',
  ]);

  const GRAIN_LABELS = {
    project: '项目实采',
    official_affordable: '官方保租基准',
    band: '分形态参考带',
    market: '商圈月报均值',
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
    const railNames = new Set(Object.values(timing.lines || {}).flatMap(l => l.stations));
    const railNodes = [...nodes.values()].filter(n => railNames.has(n.name));
    const hubNodes = (travel.workplaces || []).filter(name => HUB_NAMES.has(name) && nodes.has(name)).map(name => nodes.get(name));
    const rail = global.makeRailPlanner({ metro: atlas.metro }, timing);
    const railCache = new Map();
    const busCache = new Map();
    const islandCache = new Map();
    const railCosts = { access: 0, egress: 0, wait: 3, transfer: 5 };

    const meter = (a, b) => Math.hypot((a[0] - b[0]) * 102700, (a[1] - b[1]) * 110850);
    const walk = m => Math.ceil(m * 1.25 / 75);
    const closest = (ll, list) => list.reduce((a, b) => meter(a.coord, ll) <= meter(b.coord, ll) ? a : b);
    const nearestRail = n => railNames.has(n.name) ? n : closest(n.coord, railNodes);

    const eventById = new Map(atlas.events.map(e => [e.id, e]));
    const policyById = new Map(atlas.policies.map(p => [p.id, p]));
    const facById = new Map(atlas.facilities.map(f => [f.id, f]));
    const riskById = new Map(atlas.publicEvents.map(e => [e.id, e]));
    const streetById = new Map(atlas.streets.map(s => [s.id, s]));
    const placeById = new Map(atlas.places.map(p => [p.id, p]));
    const locatedFacilities = (atlas.facilities || []).filter(f => validCoord(f.location?.gcj02) && osmURL(f));

    // Pre-resolve transport node for each place once
    const placeNodes = new Map();
    for (const p of atlas.places) {
      const node = nodes.get(p.station) || closest(p.coord, [...nodes.values()]);
      const station = p.station && railNames.has(p.station) ? nodes.get(p.station) : nearestRail(node);
      placeNodes.set(p.id, { node, station });
    }

    function resolveWork(raw) {
      const q = String(raw ?? '').trim();
      if (!q) return '';
      const strip = q.replace(/(?:地铁站|站)$/u, '');
      const exact = k => nodes.has(k) ? k : (Object.hasOwn(ALIASES, k) && nodes.has(ALIASES[k]) ? ALIASES[k] : '');
      const hit = exact(q) || exact(strip);
      if (hit) return hit;
      if (strip.length < 2) return '';
      const found = new Set();
      for (const [k, v] of Object.entries(ALIASES)) if (k.includes(strip) && nodes.has(v)) found.add(v);
      for (const k of nodes.keys()) if (k.includes(strip)) found.add(k);
      return found.size === 1 ? [...found][0] : '';
    }

    function nearbyFacilities(place, category = '') {
      if (!place || !validCoord(place.coord)) return [];
      return locatedFacilities
        .filter(item => !category || item.category === category)
        .map(item => ({ ...item, meters: meter(place.coord, item.location.gcj02), osmUrl: osmURL(item) }))
        .filter(item => Number.isFinite(item.meters) && item.meters >= 0 && item.meters <= 2000)
        .sort((a, b) => a.meters - b.meters || a.id.localeCompare(b.id))
        .slice(0, 5);
    }

    function routeFor(place, destName, opt) {
      const to = nodes.get(destName);
      if (!to) return null;
      const { node: from, station } = placeNodes.get(place.id);
      const extraFrom = walk(meter(place.coord, from.coord));
      const a = Math.max(opt.access, extraFrom), e = opt.egress;

      if (opt.mode === 'rail') {
        const fromIsland = from.name === '企鹅岛';
        if (fromIsland && destName === '企鹅岛') {
          return { minutes: a + e, legs: [], label: '园区内步行', walk: a + e, same: true };
        }
        const d = destName === '企鹅岛' ? to : nearestRail(to);
        const destWalk = destName === '企鹅岛' ? e : Math.max(e, walk(meter(d.coord, to.coord)));
        const fromWalk = fromIsland ? a : Math.max(opt.access, walk(meter(place.coord, station.coord)));
        let r;
        if (fromIsland) {
          if (!islandCache.has(d.name)) islandCache.set(d.name, rail.fromIsland(d.name, railCosts));
          r = islandCache.get(d.name);
        } else {
          if (!railCache.has(d.name)) railCache.set(d.name, rail.to(d.name, railCosts));
          r = railCache.get(d.name).get(station.name);
        }
        if (!r) return null;
        const w = fromWalk + destWalk;
        return {
          ...r,
          walk: w,
          minutes: r.minutes + w,
          origin: fromIsland ? from.name : station.name,
          terminal: d.name,
          label: r.sameStation ? '同站步行' : r.legs.map(l => Object.hasOwn(timing.lines, l.line) ? l.line + '号线' : l.line).join(' → '),
        };
      }

      if (opt.mode === 'drive') {
        const sec = travel.driving?.durations?.[from.i]?.[to.i];
        const dist = travel.driving?.distances?.[from.i]?.[to.i];
        if (sec == null || dist == null) return null;
        return { minutes: Math.ceil(sec / 60) + a + e, seconds: sec, meters: dist, walk: a + e, legs: [], label: `驾车 ${(dist / 1000).toFixed(1)}km` };
      }

      // Bus
      if (from.i === to.i) return { minutes: a + e, walk: a + e, legs: [], label: '同点步行', same: true };
      const key = `${from.name}|${destName}`;
      if (!busCache.has(key)) {
        const possible = global.busOptions(travel, from.i, to.i);
        busCache.set(key, [possible.direct, possible.transfer].filter(Boolean));
      }
      const best = busCache.get(key).flatMap(r => {
        const w = Math.max(a, walk(r.fromMeters || 0)) + Math.max(e, walk(r.toMeters || 0)) + walk(r.transferMeters || 0);
        const shuttle = r.shuttle && (timing.shuttles || []).find(s => r.legs.some(l => l.line === s.line));
        if (r.shuttle && !shuttle) return [];
        const wait = shuttle ? shuttle.wait : 5 * r.legs.length;
        const ride = shuttle ? shuttle.ride : Math.ceil(r.estimatedRide);
        return [{ ...r, ride, wait, walk: w, minutes: ride + wait + w, label: r.legs.map(l => l.line).join(' → ') }];
      }).sort((x, y) => x.minutes - y.minutes)[0];
      return best || null;
    }

    function pickRent(place, state, personalEntry) {
      const allowedTypes = new Set(state.housingTypes || []);
      const targetRoom = state.room ? Number(state.room) : 0;
      const list = [];

      if (personalEntry?.monthly > 0 && (!targetRoom || !personalEntry.rooms || personalEntry.rooms === targetRoom)) {
        list.push({
          type: place.housingTypes[0] || 'modernEstate',
          room: personalEntry.rooms || targetRoom || 1,
          low: personalEntry.monthly,
          median: personalEntry.monthly,
          high: personalEntry.monthly,
          sqm: personalEntry.sqm ? [personalEntry.sqm, personalEntry.sqm] : null,
          grain: 'personal',
          period: personalEntry.observed || '实地实录',
          basis: '我实地看房记录的报价',
          source: '',
          sourceName: '个人记录',
        });
      }

      for (const r of place.rents || []) {
        if (state.verifiedOnly && !['project', 'official_affordable', 'personal'].includes(r.grain)) continue;
        if (targetRoom && r.room !== targetRoom) continue;
        if (r.type !== 'mixed' && allowedTypes.size && !allowedTypes.has(r.type)) continue;
        if (r.type === 'mixed' && allowedTypes.size < 4 && state.housingTypes.length > 0) {
          if ((place.rents || []).some(x => x.type !== 'mixed')) continue;
        }
        if (state.sqm > 0) {
          if (!r.sqm || r.sqm[1] < state.sqm) continue;
        }
        list.push(r);
      }

      const tier = { personal: 0, project: 1, official_affordable: 1, band: 2, market: 3 };
      list.sort((a, b) => (tier[a.grain] ?? 9) - (tier[b.grain] ?? 9) || a.median - b.median);
      const best = list[0] || null;
      const withinBudget = !state.budget || (best && best.low <= state.budget);
      return { best, all: list, withinBudget };
    }

    // 「非必要溢价」模型（移植并适配 Codex location-premium.js 严口径：15分钟步行圈 + ±5分钟同程 + 同形态同口径 ≥3 处对照）
    function evaluateLocationPremium(rows, work, work2, state) {
      const WALK_LIMIT = 15;
      const TIME_WINDOW = 5;
      const MIN_PEERS = 3;
      const primary = work ? nodes.get(work) : null;
      const secondary = work2 ? nodes.get(work2) : null;
      const usedSet = new Set(state.usedHubs || []);

      const walkToNode = (place, node) => {
        if (!validCoord(place.coord) || !validCoord(node?.coord)) return null;
        return {
          name: node.name,
          walk: walk(meter(place.coord, node.coord)),
          reference: node.reference || (node.name === '留仙洞' ? '留仙洞站（总部片区参照）' : node.name),
        };
      };

      const peerGroupKey = r => {
        const rent = r.rent;
        if (!rent || !(rent.median > 0)) return '';
        // 同口径分组：grain (project/official_affordable 归为实采，band 与 market 各自同口径) + type + room
        const g = (rent.grain === 'official_affordable' || rent.grain === 'personal') ? 'project' : rent.grain;
        return `${g}|${rent.type}|${rent.room}`;
      };
      const uniqueSampleId = r => {
        const rent = r.rent;
        if (!rent) return r.place.id;
        // 避免同一个片区参考带（如西乡 6 个同带城中村）被重复算作 6 个独立样本
        return rent.grain === 'band' ? `band:${rent.basis}:${rent.median}` : (rent.source ? `${rent.source}|${rent.room}|${rent.median}` : r.place.id);
      };

      const walkingSites = new Map();
      const byGroup = new Map();
      const usableRows = [];

      for (const row of rows) {
        row.premium = { status: 'no-work', reason: '先选工作地', hub: null, own: null, median: null, extra: null, count: 0, alternatives: [] };
        if (!primary) continue;
        const nearby = hubNodes
          .map(h => walkToNode(row.place, h))
          .filter(x => x && x.walk <= WALK_LIMIT)
          .sort((a, b) => a.walk - b.walk || a.name.localeCompare(b.name, 'zh'));
        walkingSites.set(row, nearby);
        if (!row.route) continue;
        if (row.eligible && row.rent) usableRows.push(row);
        const gk = peerGroupKey(row);
        if (!gk) continue;
        if (!byGroup.has(gk)) byGroup.set(gk, []);
        byGroup.get(gk).push(row);
      }

      if (!primary) return;

      const similarCommute = (other, here) =>
        Math.abs(other.route.minutes - here.route.minutes) <= TIME_WINDOW &&
        (!secondary || (other.route2 && here.route2 && Math.abs(other.route2.minutes - here.route2.minutes) <= TIME_WINDOW));
      const noSlower = (other, here) =>
        other.route.minutes <= here.route.minutes &&
        (!secondary || (other.route2 && here.route2 && other.route2.minutes <= here.route2.minutes));

      const shortlist = list => {
        const seen = new Set(), out = [];
        const sorted = list.slice().sort((a, b) =>
          a.rent.median - b.rent.median ||
          a.route.minutes - b.route.minutes ||
          a.place.name.localeCompare(b.place.name, 'zh')
        );
        for (const item of sorted) {
          const uid = uniqueSampleId(item);
          if (seen.has(uid)) continue;
          seen.add(uid);
          out.push({
            id: item.place.id,
            name: item.place.shortName,
            fullName: item.place.name,
            price: item.rent.median,
            grain: item.rent.grain,
            minutes: item.route.minutes,
            future: item.route2?.minutes ?? null,
          });
          if (out.length === 2) break;
        }
        return out;
      };

      for (const row of rows) {
        const res = row.premium;
        const prox = walkingSites.get(row) || [];
        const ownList = [[primary, false], [secondary, true]]
          .filter(([n]) => n)
          .map(([n, isSec]) => {
            const p = walkToNode(row.place, n);
            return p ? { ...p, secondary: isSec } : null;
          })
          .filter(Boolean)
          .sort((a, b) => a.walk - b.walk);
        res.own = ownList[0] || null;

        if (res.own && res.own.walk <= WALK_LIMIT) {
          res.status = 'direct';
          res.reason = res.own.secondary ? '第二工作地在 15 分钟步行圈内' : '当前工作地在 15 分钟步行圈内';
          continue;
        }

        const usedHub = prox.find(h => usedSet.has(h.name));
        res.hub = usedHub || prox[0] || null;
        if (usedHub) {
          res.status = 'used';
          res.reason = `你标记了常去「${usedHub.name}」，不计入非必要溢价`;
          continue;
        }
        if (!res.hub) {
          res.status = 'no-hub';
          res.reason = '在已收录 10 大园区的 15 分钟步行圈外，避开多余园区溢价';
          continue;
        }

        res.status = 'unknown';
        if (!row.route || (secondary && !row.route2)) {
          res.reason = '缺少到所选工作地的通勤估时';
          continue;
        }

        const gk = peerGroupKey(row);
        const myUid = uniqueSampleId(row);
        const outsideHub = other => !(walkingSites.get(other) || []).some(h => h.name === res.hub.name);
        const closeCommute = other => other !== row && similarCommute(other, row) && outsideHub(other);

        const distinct = new Map();
        if (gk) {
          for (const other of byGroup.get(gk) || []) {
            const uid = uniqueSampleId(other);
            if (uid !== myUid && closeCommute(other)) distinct.set(uid, other.rent.median);
          }
        }
        res.count = distinct.size;

        const targetRoom = row.rent?.room || Number(state.room) || 1;
        const refs = usableRows.filter(o => o.rent.room === targetRoom && closeCommute(o) && uniqueSampleId(o) !== myUid);
        const sameGroupRefs = gk ? refs.filter(o => peerGroupKey(o) === gk) : [];

        if (distinct.size < MIN_PEERS) {
          res.reason = !row.rent ? '本处缺同居室月租' : `同程同口径对照不足 3 处（当前 ${distinct.size} 处）`;
          res.alternatives = shortlist(sameGroupRefs.length ? sameGroupRefs : refs);
          continue;
        }

        const vals = [...distinct.values()].sort((a, b) => a - b);
        const mid = Math.floor(vals.length / 2);
        res.median = Math.round(vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2);
        const excess = Math.round(row.rent.median) - res.median;
        if (excess <= 0) {
          res.status = 'no-extra';
          res.extra = 0;
          res.reason = `本处样本未高于同程圈外中位数（¥${money(res.median)}/月）`;
          continue;
        }

        const cheaper = sameGroupRefs.filter(o => o.rent.median < row.rent.median);
        res.alternatives = shortlist(cheaper.filter(o => noSlower(o, row)));
        if (!res.alternatives.length) {
          res.status = 'tradeoff';
          res.reason = '虽高于同程中位，但暂缺更便宜且通勤不增的可选住区';
          res.alternatives = shortlist(cheaper);
          continue;
        }
        res.status = 'premium';
        res.extra = excess;
        res.reason = `邻近「${res.hub.name}」但你不到此上班，且存在更便宜、通勤不增的可选住区`;
      }
    }

    // 个人四维适配评分（通勤 / 租金 / 环境 / 便利 + 缺项区间 + 非必要溢价扣分 ≤ 10 分）
    function assessFit(row, state) {
      const weights = state.weights || { commute: 1, rent: 1, environment: 1, convenience: 1 };
      const wVal = k => [1, 2, 3].includes(Number(weights[k])) ? Number(weights[k]) : 1;
      const entry = row.entry;
      const dims = {};

      if (row.route) {
        let ratio = row.route.minutes / state.limit;
        let why = `单程 ${row.route.minutes} / 上限 ${state.limit} 分钟`;
        if (state.work2 && state.limit2 > 0 && row.route2) {
          ratio = Math.max(ratio, row.route2.minutes / state.limit2);
          why += `，第二工作地 ${row.route2.minutes} / ${state.limit2} 分钟`;
        }
        dims.commute = { value: `${row.route.minutes} 分钟`, why, score: bound(100 - 40 * ratio) };
      } else {
        dims.commute = { value: state.work ? '待核路线' : '未设工作地', why: state.work ? '当前方式缺路线' : '选定工作地后计分', score: null };
      }

      if (!row.rent) {
        dims.rent = { value: '待补', why: '缺同居室月租样本', score: null };
      } else {
        const valStr = row.rent.low === row.rent.high ? `¥${money(row.rent.median)}` : `¥${money(row.rent.low)}–${money(row.rent.high)}`;
        if (state.budget > 0) {
          const diff = state.budget - row.rent.median;
          dims.rent = {
            value: valStr,
            why: `${GRAIN_LABELS[row.rent.grain] || ''} · ${diff >= 0 ? '预算余 ¥' + money(diff) : '超预算 ¥' + money(-diff)}`,
            score: bound(100 - 40 * row.rent.median / state.budget),
          };
        } else {
          dims.rent = { value: valStr, why: `${GRAIN_LABELS[row.rent.grain] || ''} · 填预算可算租金分`, score: null };
        }
      }

      for (const k of ['environment', 'convenience']) {
        const stars = entry?.[k];
        if (Number.isInteger(stars) && stars >= 1 && stars <= 5) {
          dims[k] = { value: `${stars} / 5 星`, why: `我的实地体感${entry.observed ? ' · ' + entry.observed : ''}`, score: (stars - 1) * 25, stars };
        } else {
          const hint = k === 'environment'
            ? (row.risks.length ? `周边有 ${row.risks.length} 条公开环境记录` : '待实地听噪采光')
            : (row.nearbyFacs.length ? `2km 内有 ${row.nearbyFacs.length} 处定位设施` : row.place.streetFacilityCount ? `本街道 ${row.place.streetFacilityCount} 处核验设施` : '待实地走一遍买菜通勤');
          dims[k] = { value: '待踩点', why: hint, score: null, stars: null };
        }
      }

      const totalW = FIT_KEYS.reduce((s, k) => s + wVal(k), 0);
      let earned = 0, unknown = 0, count = 0;
      for (const k of FIT_KEYS) {
        if (dims[k].score == null) { unknown += wVal(k); }
        else { earned += wVal(k) * dims[k].score; count++; }
      }
      const p = row.premium;
      const premiumPenalty = p?.status === 'premium' && p.extra > 0 && p.median > 0
        ? Math.min(10, Math.round(40 * p.extra / p.median))
        : 0;
      const low = bound(Math.round(earned / totalW) - premiumPenalty);
      const high = bound(Math.round((earned + 100 * unknown) / totalW) - premiumPenalty);
      const weak = FIT_KEYS.filter(k => dims[k].score != null && dims[k].score < 60);
      const rangeText = count === 0 ? '待核' : (count === FIT_KEYS.length ? `${low} 分` : `${low}–${high} 分`);
      return { dimensions: dims, low, high, count, weak, premiumPenalty, rangeText, meets: count === FIT_KEYS.length && !weak.length };
    }

    function compareToReference(row, refRow) {
      if (!refRow || !row || refRow.place.id === row.place.id) return [];
      const out = [];
      if (row.route && refRow.route) {
        const d = refRow.route.minutes - row.route.minutes;
        if (d !== 0) out.push({ better: d > 0, text: `通勤${d > 0 ? '少' : '多'} ${Math.abs(d)} 分钟` });
      }
      if (row.route2 && refRow.route2) {
        const d = refRow.route2.minutes - row.route2.minutes;
        if (d !== 0) out.push({ better: d > 0, text: `第二工作地${d > 0 ? '少' : '多'} ${Math.abs(d)} 分钟` });
      }
      if (row.rent && refRow.rent && row.rent.room === refRow.rent.room && row.rent.type === refRow.rent.type) {
        const d = refRow.rent.median - row.rent.median;
        if (Math.abs(d) >= 50) out.push({ better: d > 0, text: `同形态月租${d > 0 ? '低' : '高'} ¥${money(Math.abs(d))}` });
      }
      for (const [k, label] of [['environment', '环境'], ['convenience', '便利']]) {
        const a = row.fit.dimensions[k].stars, b = refRow.fit.dimensions[k].stars;
        if (a && b && a !== b) out.push({ better: a > b, text: `${label}${a > b ? '高' : '低'} ${Math.abs(a - b)} 星` });
      }
      return out;
    }

    function computeOutlook(eventsList, trend) {
      const opp = eventsList.some(e => e.dir === 'opportunity');
      const tight = eventsList.some(e => e.dir === 'tight');
      const mixed = eventsList.some(e => e.dir === 'mixed');
      if ((opp && tight) || mixed) return { direction: 'mixed', label: '分歧' };
      if (opp) return { direction: 'down', label: '可议价' };
      if (tight) return { direction: 'up', label: '偏紧' };
      if (trend?.yoy != null) {
        if (trend.yoy <= -3) return { direction: 'down', label: '走弱' };
        if (trend.yoy >= 5) return { direction: 'up', label: '偏强' };
      }
      return { direction: 'watch', label: '待察' };
    }

    function evaluateAll(state, store) {
      const work = resolveWork(state.work);
      const work2 = resolveWork(state.work2);
      const rows = [];

      for (const p of atlas.places) {
        const entry = store.getEntry(p.id);
        const route = work ? routeFor(p, work, state) : null;
        const route2 = work2 ? routeFor(p, work2, state) : null;
        const rentInfo = pickRent(p, state, entry);
        const trendRoom = state.room || '1';
        const trend = p.marketTrend?.[trendRoom] || streetById.get(p.streetId)?.trend?.[trendRoom] || null;
        const nearbyFacs = nearbyFacilities(p);

        const evs = p.eventIds.map(id => eventById.get(id)).filter(Boolean);
        const oppEvents = evs.filter(e => e.dir === 'opportunity');
        const tightEvents = evs.filter(e => e.dir === 'tight');
        const mixedEvents = evs.filter(e => e.dir === 'mixed');

        const exclusions = [];
        if (work && (!route || route.minutes > state.limit)) exclusions.push('通勤超上限');
        if (work2 && state.limit2 > 0 && (!route2 || route2.minutes > state.limit2)) exclusions.push('第二工作地超上限');
        if (state.budget > 0 && rentInfo.best && !rentInfo.withinBudget) exclusions.push('超预算');
        if (state.budget > 0 && !rentInfo.best) exclusions.push('缺匹配租金');
        if (state.sqm > 0 && !rentInfo.best) exclusions.push('无匹配面积');
        if (state.housingTypes.length < 4 && p.housingTypes.length > 0 && !p.housingTypes.some(t => state.housingTypes.includes(t))) {
          exclusions.push('形态不符');
        }

        rows.push({
          place: p,
          entry,
          route,
          route2,
          rent: rentInfo.best,
          rentsMatched: rentInfo.all,
          trend,
          events: evs,
          policies: p.policyIds.map(id => policyById.get(id)).filter(Boolean),
          facilities: p.facilityIds.map(id => facById.get(id)).filter(Boolean),
          nearbyFacs,
          risks: p.riskEventIds.map(id => riskById.get(id)).filter(Boolean),
          oppEvents,
          tightEvents,
          mixedEvents,
          exclusions,
          eligible: exclusions.length === 0,
        });
      }

      // Dynamic Arbitrage Radar (±10 min same housing type peer gap)
      for (const row of rows) {
        row.peerGap = null;
        if (work && row.route && row.rent && row.rent.type !== 'mixed') {
          const seen = new Map();
          for (const other of rows) {
            if (other.place.id === row.place.id || !other.route || !other.rent) continue;
            if (Math.abs(other.route.minutes - row.route.minutes) > 10) continue;
            if (other.rent.type !== row.rent.type || other.rent.room !== row.rent.room) continue;
            const k = other.rent.grain === 'band' ? `band:${other.rent.basis}` : other.place.id;
            if (!seen.has(k)) seen.set(k, other.rent.median);
          }
          const peers = [...seen.values()].sort((a, b) => a - b);
          if (peers.length >= 3) {
            const mid = Math.floor(peers.length / 2);
            const med = peers.length % 2 ? peers[mid] : Math.round((peers[mid - 1] + peers[mid]) / 2);
            const diff = med - row.rent.median;
            const pct = Math.round((diff / med) * 100);
            row.peerGap = { median: med, count: peers.length, diff, pct };
          }
        }

        const reasons = [];
        let score = 0;
        for (const ev of row.oppEvents) {
          score += 2;
          reasons.push(`${ev.signalLabel}：${ev.summary}`);
        }
        if (row.peerGap && row.peerGap.pct >= 10) {
          score += 2;
          reasons.push(`同通勤圈（±10分钟）同形态中位价 ¥${money(row.peerGap.median)}，此处低 ¥${money(row.peerGap.diff)}（-${row.peerGap.pct}%）`);
        }
        if (row.trend && Number.isFinite(row.trend.yoy) && row.trend.yoy <= -3) {
          score += 1;
          reasons.push(`商圈 ${row.trend.period} 同户型实测同比 ${row.trend.yoy > 0 ? '+' : ''}${row.trend.yoy}%`);
        }
        if (row.tightEvents.length) score -= 2;

        let status = 'neutral', label = '常规供需';
        if (score >= 2 && !row.tightEvents.length) { status = 'opportunity'; label = '议价机会'; }
        else if ((row.oppEvents.length && row.tightEvents.length) || row.mixedEvents.length) { status = 'mixed'; label = '供需分歧'; }
        else if (row.tightEvents.length) { status = 'tight'; label = '需求偏紧'; }
        else if (score === 1) { status = 'watch'; label = '值得留意'; }

        row.arbitrage = { status, label, score, reasons };
        if (state.oppOnly && status !== 'opportunity' && status !== 'watch') {
          row.exclusions.push('非议价信号片区');
          row.eligible = false;
        }
      }

      // Location Premium («非必要溢价») + 4-Dim Personal Fit Score
      evaluateLocationPremium(rows, work, work2, state);
      for (const row of rows) {
        row.fit = assessFit(row, state);
        row.outlook = computeOutlook(row.events, row.trend);
      }

      const rowById = new Map(rows.map(r => [r.place.id, r]));
      const refRow = state.referencePlaceId ? rowById.get(state.referencePlaceId) || null : null;
      for (const row of rows) {
        row.refDeltas = refRow ? compareToReference(row, refRow) : [];
      }

      // Street-level aggregates
      const PREMIUM_PRIORITY = { premium: 0, tradeoff: 1, direct: 2, used: 2, unknown: 3, 'no-extra': 4, 'no-hub': 5, 'no-work': 6 };
      const streetSummary = new Map();
      for (const s of atlas.streets) {
        const members = rows.filter(r => r.place.streetId === s.id);
        const eligibleMembers = members.filter(r => r.eligible);
        const pool = eligibleMembers.length ? eligibleMembers : members;
        const withPrice = pool.filter(r => r.rent).sort((a, b) => a.rent.median - b.rent.median);
        const withRoute = pool.filter(r => r.route).sort((a, b) => a.route.minutes - b.route.minutes);
        const oppCount = members.filter(r => r.arbitrage.status === 'opportunity').length;
        const premSorted = pool.slice().sort((a, b) =>
          (PREMIUM_PRIORITY[a.premium.status] ?? 9) - (PREMIUM_PRIORITY[b.premium.status] ?? 9) ||
          (b.premium.extra || 0) - (a.premium.extra || 0)
        );
        const trendRoom = state.room || '1';
        const yoy = s.trend?.[trendRoom]?.yoy ?? null;
        const mom = s.trend?.[trendRoom]?.mom ?? null;
        const facCount = state.view === 'livability' && state.subMode && state.subMode !== 'all'
          ? atlas.facilities.filter(f => f.streetId === s.id && f.category === state.subMode).length
          : s.facilityCount;
        const stEvents = [...new Set([...(s.eventIds || []), ...members.flatMap(m => m.place.eventIds)])]
          .map(id => eventById.get(id)).filter(Boolean);
        const stPolicies = [...new Set([...(s.policyIds || []), ...members.flatMap(m => m.place.policyIds)])]
          .map(id => policyById.get(id)).filter(Boolean);
        const outside = members.length > 0 && eligibleMembers.length === 0 && (!!work || state.budget > 0 || state.oppOnly || state.housingTypes.length < 4);
        const bandOnly = withPrice.length > 0 && withPrice[0].rent.grain === 'band';

        streetSummary.set(s.id, {
          street: s,
          members,
          eligibleCount: eligibleMembers.length,
          outside,
          bandOnly,
          bestRent: withPrice[0]?.rent?.median ?? null,
          bestRentRow: withPrice[0] || null,
          bestMinutes: withRoute[0]?.route?.minutes ?? null,
          bestPremiumRow: premSorted[0] || null,
          oppCount,
          yoy,
          mom,
          refUnit: s.refUnit,
          facilityCount: facCount,
          events: stEvents,
          policies: stPolicies,
          outlook: computeOutlook(stEvents, s.trend?.[trendRoom]),
          hasAnyEligible: eligibleMembers.length > 0,
        });
      }

      // Area insight lookup for zoomed-in 3-icon map badges
      function getAreaInsight(kind, id) {
        if (kind === 'place') {
          const r = rowById.get(id);
          if (!r) return null;
          return { events: r.events, policies: r.policies, localPolicyCount: r.policies.length, outlook: r.outlook };
        }
        if (kind === 'street') {
          const sum = streetSummary.get(id);
          if (!sum) return null;
          return { events: sum.events, policies: sum.policies, localPolicyCount: sum.policies.length, outlook: sum.outlook };
        }
        if (kind === 'zone') {
          const zRows = rows.filter(r => r.place.zone === id);
          const evMap = new Map(), polMap = new Map();
          for (const r of zRows) {
            r.events.forEach(e => evMap.set(e.id, e));
            r.policies.forEach(p => polMap.set(p.id, p));
          }
          const evs = [...evMap.values()], pols = [...polMap.values()];
          return { events: evs, policies: pols, localPolicyCount: pols.length, outlook: computeOutlook(evs, zRows[0]?.trend) };
        }
        return null;
      }

      return {
        work,
        work2,
        refRow,
        rows,
        rowById,
        eligibleRows: rows.filter(r => r.eligible).sort((a, b) =>
          (b.arbitrage.score - a.arbitrage.score) ||
          (b.fit.low - a.fit.low) ||
          ((a.route?.minutes ?? 999) - (b.route?.minutes ?? 999)) ||
          ((a.rent?.median ?? 99999) - (b.rent?.median ?? 99999))
        ),
        streetSummary,
        getAreaInsight,
      };
    }

    function discoverNext(evalResult, seenSet) {
      const pool = evalResult.eligibleRows.filter(r => !seenSet.has(r.place.id) && r.place.id !== evalResult.refRow?.place.id);
      if (!pool.length) return null;
      const scored = pool.slice().sort((a, b) =>
        (b.arbitrage.score - a.arbitrage.score) ||
        (b.fit.low - a.fit.low) ||
        Number(!!b.rent) - Number(!!a.rent) ||
        ((a.route?.minutes ?? 999) - (b.route?.minutes ?? 999)) ||
        ((a.rent?.median ?? 99999) - (b.rent?.median ?? 99999))
      );
      if (evalResult.refRow) {
        const better = scored.find(r => r.refDeltas.length && r.refDeltas.every(d => d.better))
          || scored.find(r => r.refDeltas.some(d => d.better));
        if (better) return better;
      }
      return scored[0];
    }

    return {
      nodes, QUICK_WORKS, ALIASES, GRAIN_LABELS, FIT_NAMES, FIT_KEYS,
      resolveWork, nearbyFacilities, evaluateAll, discoverNext, compareToReference,
      eventById, policyById, facById, riskById, streetById, placeById,
    };
  }

  global.createV2Engine = createEngine;
})(typeof window !== 'undefined' ? window : globalThis);
