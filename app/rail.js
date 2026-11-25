(function (global) {
  'use strict';

  function makeRailPlanner(base, data) {
    const nodes = [];
    const atStation = new Map();
    const clean = name => name === '深圳北' ? '深圳北站' : name === '宝安客运' ? '宝安客运站' : name;
    for (const line of base.metro) {
      const id = String(line.id);
      const times = data.lines[id];
      if (!times) continue;
      const lookup = new Map();
      times.stations.slice(0, -1).forEach((name, i) => {
        const a = clean(name), b = clean(times.stations[i + 1]);
        lookup.set(a + '|' + b, times.forward[i]);
        lookup.set(b + '|' + a, times.backward[i]);
      });
      const route = line.s.map(name => {
        const index = nodes.length;
        nodes.push({ name, line: id, incoming: [] });
        if (!atStation.has(name)) atStation.set(name, []);
        atStation.get(name).push(index);
        return index;
      });
      for (let i = 1; i < route.length; i++) {
        const a = route[i - 1], b = route[i];
        const from = clean(nodes[a].name), to = clean(nodes[b].name);
        const forward = lookup.get(from + '|' + to), backward = lookup.get(to + '|' + from);
        if (forward > 0) nodes[b].incoming.push([a, forward]);
        if (backward > 0) nodes[a].incoming.push([b, backward]);
      }
    }
    const nonnegative = (value, fallback) =>
      typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
    function planForStation(dest, opt) {
      const output = new Map();
      if (!atStation.has(dest)) return output;
      const n = nodes.length;
      const distance = Array(n).fill(Infinity);
      const transfers = Array(n).fill(Infinity);
      const next = Array(n).fill(null);
      const settled = new Set();
      for (const i of atStation.get(dest)) { distance[i] = 0; transfers[i] = 0; }
      // A shortest-path search towards a fixed destination, with one node per line at each station.
      while (settled.size < n) {
        let best = -1;
        for (let j = 0; j < n; j++) {
          if (settled.has(j) || !Number.isFinite(distance[j])) continue;
          if (best < 0 || distance[j] < distance[best] ||
              (distance[j] === distance[best] && transfers[j] < transfers[best])) best = j;
        }
        if (best < 0) break;
        settled.add(best);
        const node = nodes[best];
        function relax(origin, minutes, isTransfer) {
          if (settled.has(origin)) return;
          const candidate = distance[best] + minutes;
          const changes = transfers[best] + (isTransfer ? 1 : 0);
          if (candidate < distance[origin] || (candidate === distance[origin] && changes < transfers[origin])) {
            distance[origin] = candidate;
            transfers[origin] = changes;
            next[origin] = { index: best, minutes, isTransfer };
          }
        }
        for (const [origin, duration] of node.incoming) relax(origin, duration, false);
        for (const origin of atStation.get(node.name)) {
          if (origin !== best) relax(origin, opt.transfer + opt.wait, true);
        }
      }
      for (const [origin, origins] of atStation) {
        if (origin === dest) {
          output.set(origin, { minutes: 0, legs: [], transfers: 0, ride: 0, wait: 0,
            walk: 0, transferMinutes: 0, shuttleMinutes: 0, sameStation: true });
          continue;
        }
        let best = origins[0];
        for (const i of origins) {
          if (distance[i] < distance[best] || (distance[i] === distance[best] && transfers[i] < transfers[best])) best = i;
        }
        if (!Number.isFinite(distance[best])) continue;
        const legs = [];
        let ride = 0, current = best;
        while (next[current]) {
          const edge = next[current], a = nodes[current], b = nodes[edge.index];
          if (!edge.isTransfer) {
            ride += edge.minutes;
            const previous = legs[legs.length - 1];
            if (previous && previous.line === a.line) {
              previous.to = b.name;
              previous.minutes += edge.minutes;
            } else {
              legs.push({ from: a.name, to: b.name, line: a.line, minutes: edge.minutes });
            }
          }
          current = edge.index;
        }
        const changes = transfers[best];
        const wait = (1 + changes) * opt.wait, transferMinutes = changes * opt.transfer;
        const walk = opt.access + opt.egress;
        output.set(origin, { minutes: ride + wait + walk + transferMinutes, legs,
          transfers: changes, ride, wait, walk, transferMinutes, shuttleMinutes: 0 });
      }
      return output;
    }
    function optionsFor(options) {
      const opt = {};
      for (const [key, fallback] of Object.entries({access: 6, egress: 5, transfer: 5, wait: 3})) {
        opt[key] = nonnegative(options[key], fallback);
      }
      return opt;
    }
    function shuttleJourney(rail, shuttle, opt, outbound) {
      const walk = opt.access + opt.egress;
      const wait = rail.wait + shuttle.wait;
      const transferMinutes = rail.transferMinutes + (rail.sameStation ? 0 : opt.transfer);
      const transfers = rail.transfers + (rail.sameStation ? 0 : 1);
      const leg = { from: outbound ? '企鹅岛' : shuttle.station, to: outbound ? shuttle.station : '企鹅岛',
        line: shuttle.line, minutes: shuttle.ride };
      return { minutes: rail.ride + walk + wait + transferMinutes + shuttle.ride,
        legs: outbound ? [leg, ...rail.legs] : [...rail.legs, leg], transfers, ride: rail.ride, wait, walk,
        transferMinutes, shuttleMinutes: shuttle.ride, shuttleWait: shuttle.wait };
    }
    const faster = (next, old) => !old || next.minutes < old.minutes ||
      (next.minutes === old.minutes && next.transfers < old.transfers);
    return {
      fromIsland(dest, options = {}) {
        const opt = optionsFor(options), rail = planForStation(clean(dest), opt);
        let best = null;
        for (const shuttle of data.shuttles || []) {
          const from = rail.get(shuttle.station);
          if (!from) continue;
          const journey = shuttleJourney(from, shuttle, opt, true);
          if (faster(journey, best)) best = journey;
        }
        return best;
      },
      to(dest, options = {}) {
        const opt = optionsFor(options);
        if (!atStation.has(dest) && dest === '深圳北') dest = '深圳北站';
        if (dest !== '企鹅岛') return planForStation(dest, opt);
        const result = new Map();
        for (const shuttle of data.shuttles || []) {
          const legsToStation = planForStation(shuttle.station, opt);
          for (const [origin, rail] of legsToStation) {
            const journey = shuttleJourney(rail, shuttle, opt, false);
            if (faster(journey, result.get(origin))) result.set(origin, journey);
          }
        }
        return result;
      }
    };
  }
  global.makeRailPlanner = makeRailPlanner;
})(typeof window !== 'undefined' ? window : globalThis);
