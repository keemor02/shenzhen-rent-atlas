/* V2 核心计算引擎：双地通勤 + 分形态租金匹配 + 动态议价雷达 + 探索发现 */
(function (global) {
  'use strict';

  const ALIASES = {
    '留仙洞总部基地': '留仙洞', '啤酒小镇': '兴东啤酒小镇', '腾讯企鹅岛': '企鹅岛',
    '腾讯岛': '企鹅岛', '腾讯': '企鹅岛', '前海': '桂湾', '深圳北': '深圳北站',
    '科兴': '科兴科学园', '华为总部': '坂田华为总部', '华为': '坂田华为总部', '大疆': '大疆天空之城',
  };

  const QUICK_WORKS = ['留仙洞', '科兴科学园', '企鹅岛', '前海金融峡谷', '岗厦北'];

  const GRAIN_LABELS = {
    project: '项目实采',
    official_affordable: '官方保租基准',
    band: '分形态参考带',
    market: '商圈月报均值',
    personal: '我的实录',
  };

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

      // Personal recorded monthly rent takes highest priority if entered
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
          // When user narrowed housing types, still keep mixed 58 market ONLY if place has no typed data and verifiedOnly is false
          if ((place.rents || []).some(x => x.type !== 'mixed')) continue;
        }
        if (state.sqm > 0) {
          if (!r.sqm || r.sqm[1] < state.sqm) continue;
        }
        list.push(r);
      }

      // Rank: personal > project/official_affordable > band > market, then lowest median
      const tier = { personal: 0, project: 1, official_affordable: 1, band: 2, market: 3 };
      list.sort((a, b) => (tier[a.grain] ?? 9) - (tier[b.grain] ?? 9) || a.median - b.median);
      const best = list[0] || null;
      const withinBudget = !state.budget || (best && best.low <= state.budget);
      return { best, all: list, withinBudget };
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

        // Collect direct/nearby supply-demand events
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
          risks: p.riskEventIds.map(id => riskById.get(id)).filter(Boolean),
          oppEvents,
          tightEvents,
          mixedEvents,
          exclusions,
          eligible: exclusions.length === 0,
        });
      }

      // Dynamic Arbitrage Radar: compare same-commute-band (±10 min) & same housing type peer median!
      for (const row of rows) {
        row.peerGap = null;
        if (work && row.route && row.rent && row.rent.type !== 'mixed') {
          const peers = rows.filter(other =>
            other.place.id !== row.place.id &&
            other.route &&
            Math.abs(other.route.minutes - row.route.minutes) <= 10 &&
            other.rent && other.rent.type === row.rent.type && other.rent.room === row.rent.room
          ).map(o => o.rent.median).sort((a, b) => a - b);
          if (peers.length >= 3) {
            const mid = Math.floor(peers.length / 2);
            const med = peers.length % 2 ? peers[mid] : Math.round((peers[mid - 1] + peers[mid]) / 2);
            const diff = med - row.rent.median;
            const pct = Math.round((diff / med) * 100);
            row.peerGap = { median: med, count: peers.length, diff, pct };
          }
        }

        // Compute structured arbitrage score & explainable reasons
        const reasons = [];
        let score = 0;
        for (const ev of row.oppEvents) {
          score += 2;
          reasons.push(`${ev.signalLabel}：${ev.summary}`);
        }
        if (row.peerGap && row.peerGap.pct >= 10) {
          score += 2;
          reasons.push(`同通勤圈（±10分钟）同形态中位价 ¥${row.peerGap.median.toLocaleString('zh-CN')}，此处低 ¥${row.peerGap.diff.toLocaleString('zh-CN')}（-${row.peerGap.pct}%）`);
        }
        if (row.trend && Number.isFinite(row.trend.yoy) && row.trend.yoy <= -3) {
          score += 1;
          reasons.push(`商圈 ${row.trend.period} 同户型实测同比 ${row.trend.yoy > 0 ? '+' : ''}${row.trend.yoy}%`);
        }
        if (row.tightEvents.length) score -= 2;

        let status = 'neutral', label = '常规供需';
        if (score >= 2 && !row.tightEvents.length) { status = 'opportunity'; label = '议价机会'; }
        else if (row.oppEvents.length && row.tightEvents.length || row.mixedEvents.length) { status = 'mixed'; label = '供需分歧'; }
        else if (row.tightEvents.length) { status = 'tight'; label = '需求偏紧'; }
        else if (score === 1) { status = 'watch'; label = '值得留意'; }

        row.arbitrage = { status, label, score, reasons };
        if (state.oppOnly && status !== 'opportunity' && status !== 'watch') {
          row.exclusions.push('非议价信号片区');
          row.eligible = false;
        }
      }

      // Compute street-level aggregates for choropleth map
      const streetSummary = new Map();
      for (const s of atlas.streets) {
        const members = rows.filter(r => r.place.streetId === s.id);
        const eligibleMembers = members.filter(r => r.eligible);
        const pool = eligibleMembers.length ? eligibleMembers : members;
        const withPrice = pool.filter(r => r.rent).sort((a, b) => a.rent.median - b.rent.median);
        const withRoute = pool.filter(r => r.route).sort((a, b) => a.route.minutes - b.route.minutes);
        const oppCount = members.filter(r => r.arbitrage.status === 'opportunity').length;
        const trendRoom = state.room || '1';
        const yoy = s.trend?.[trendRoom]?.yoy ?? null;
        streetSummary.set(s.id, {
          street: s,
          members,
          eligibleCount: eligibleMembers.length,
          bestRent: withPrice[0]?.rent?.median ?? null,
          bestRentRow: withPrice[0] || null,
          bestMinutes: withRoute[0]?.route?.minutes ?? null,
          oppCount,
          yoy,
          refUnit: s.refUnit,
          facilityCount: s.facilityCount,
          hasAnyEligible: eligibleMembers.length > 0,
        });
      }

      return {
        work,
        work2,
        rows,
        rowById: new Map(rows.map(r => [r.place.id, r])),
        eligibleRows: rows.filter(r => r.eligible).sort((a, b) =>
          (b.arbitrage.score - a.arbitrage.score) ||
          ((a.route?.minutes ?? 999) - (b.route?.minutes ?? 999)) ||
          ((a.rent?.median ?? 99999) - (b.rent?.median ?? 99999))
        ),
        streetSummary,
      };
    }

    function discoverNext(evalResult, seenSet) {
      const pool = evalResult.eligibleRows.filter(r => !seenSet.has(r.place.id));
      if (!pool.length) return null;
      // Prioritize: arbitrage opportunity + has verified/typed rent + short commute
      return pool.slice().sort((a, b) =>
        (b.arbitrage.score - a.arbitrage.score) ||
        Number(!!b.rent) - Number(!!a.rent) ||
        ((a.route?.minutes ?? 999) - (b.route?.minutes ?? 999)) ||
        ((a.rent?.median ?? 99999) - (b.rent?.median ?? 99999))
      )[0];
    }

    return {
      nodes, QUICK_WORKS, ALIASES, GRAIN_LABELS,
      resolveWork, evaluateAll, discoverNext,
      eventById, policyById, facById, riskById, streetById, placeById,
    };
  }

  global.createV2Engine = createEngine;
})(typeof window !== 'undefined' ? window : globalThis);
