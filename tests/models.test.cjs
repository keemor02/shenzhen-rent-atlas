'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

// Load exactly the classic scripts and embedded datasets used by the offline app.
const project = join(__dirname, '..');
const browser = vm.createContext({});
browser.window = browser;
for (const file of ['market-period.js', 'rail.js', 'bus.js', 'explore-model.js']) {
  vm.runInContext(readFileSync(join(project, 'src', file), 'utf8'), browser, { filename: file });
}
const load = name => JSON.parse(readFileSync(join(project, 'data', name + '.json'), 'utf8'));
const base = load('base'), fine = load('fine'), journey = load('journey'), timing = load('timing');
const model = browser.makeExploreModel(base, fine, journey, timing);
const options = { mode: 'rail', room: '1', sqm: 0, budget: 0, access: 5, egress: 5 };

function homeAt(station) {
  const node = model.nodes.get(station);
  assert.ok(node, 'missing station in journey data: ' + station);
  return { node, station: node, coord: node.coord };
}

test('real rail routes have continuous legs and additive waiting, walking and ride times', () => {
  const planner = browser.makeRailPlanner(base, timing);
  const allStations = new Set(base.metro.flatMap(line => line.s));
  for (const dest of ['后海', '沙田', '企鹅岛']) {
    const network = planner.to(dest);
    assert.equal(network.size, allStations.size);
    for (const [origin, trip] of network) {
      assert.ok(allStations.has(origin));
      assert.equal(trip.minutes, trip.ride + trip.wait + trip.walk + trip.transferMinutes + trip.shuttleMinutes);
      assert.equal(trip.legs.reduce((n, leg) => n + leg.minutes, 0), trip.ride + trip.shuttleMinutes);
      if (origin === dest) {
        assert.ok(trip.sameStation);
        assert.equal(trip.legs.length, 0);
        continue;
      }
      assert.equal(trip.legs[0].from, origin);
      assert.equal(trip.legs.at(-1).to, dest);
      for (let i = 1; i < trip.legs.length; i++) assert.equal(trip.legs[i - 1].to, trip.legs[i].from);
    }
  }
  const eastbound = planner.to('沙田').get('岗厦北');
  assert.equal(eastbound.legs[0].line, '14');
  assert.equal(eastbound.ride, 55); // Published end-to-end reference for the pinned timetable.
});

test('rail catchments use the time from the dwelling to the destination', () => {
  const b = { metro: [{ id: '1', s: ['甲', '乙', '丙'] }] };
  const t = { lines: { '1': { stations: ['甲', '乙', '丙'], forward: [2, 3], backward: [9, 6] } } };
  const costs = { access: 4, egress: 2, wait: 1, transfer: 5 };
  const rail = browser.makeRailPlanner(b, t);
  assert.equal(rail.to('丙', costs).get('甲').minutes, 12);
  assert.equal(rail.to('甲', costs).get('丙').minutes, 22);
  assert.equal(rail.to('不存在', costs).size, 0);
});

test('station, island shuttle and driving journeys account for the first and last segments once', () => {
  const same = model.route(homeAt('留仙洞'), '留仙洞', options);
  assert.ok(same.same);
  assert.equal(same.minutes, 10);
  for (const shuttle of timing.shuttles) {
    const {station:origin,line} = shuttle;
    for (const mode of ['rail', 'bus']) {
      const trip = model.route(homeAt(origin), '企鹅岛', { ...options, mode });
      assert.equal(trip.legs.length, 1);
      assert.equal(trip.legs[0].line, line);
      assert.equal(trip.minutes, shuttle.wait + shuttle.ride + options.access + options.egress);
      const reverse = model.route(homeAt('企鹅岛'), origin, {...options,mode});
      assert.equal(reverse.origin, '企鹅岛');
      assert.equal(reverse.legs[0].line, line);
      assert.equal(reverse.minutes, trip.minutes);
    }
  }
  for (const [a, b] of [['洪浪北', '留仙洞'], ['留仙洞', '洪浪北']]) {
    const home = homeAt(a), job = model.nodes.get(b);
    const trip = model.route(home, b, { ...options, mode: 'drive' });
    assert.equal(trip.seconds, journey.driving.durations[home.node.i][job.i]);
    assert.equal(trip.meters, journey.driving.distances[home.node.i][job.i]);
    assert.equal(trip.minutes, Math.ceil(trip.seconds / 60) + 10);
  }
});

test('bus transfers follow stop order and require an actual pedestrian connection', () => {
  const mock = { nodes: [{name: '家'}, {name: '单位'}], bus: {
    period: 'test', stops: [['起点'], ['中转南'], ['中转北'], ['终点']],
    routes: [['A', '中转南', [0, 1]], ['B', '终点', [2, 3]]],
    transferLinks: [[1, 2, 90]], near: [[[0, 15]], [[3, 25]]], publishedShuttles: { shuttles: [] }
  } };
  const outbound = browser.busOptions(mock, '家', '单位');
  assert.equal(outbound.direct, null);
  assert.equal(outbound.transfer.stops, 2);
  assert.equal(outbound.transfer.transferMeters, 90);
  assert.equal(outbound.transfer.legs.map(leg => leg.line).join(','), 'A,B');
  assert.equal(browser.busOptions(mock, '单位', '家').transfer, null);
  const noWalkingLink = { ...mock, bus: { ...mock.bus, transferLinks: [] } };
  assert.equal(browser.busOptions(noWalkingLink, '家', '单位').transfer, null);
});

test('a numeric room count from a personal journal works with room, budget and area filters', () => {
  const entry = { id: 'manual-test', name: '自看一房', station: '洪浪北', monthly: 2500,
    sqm: 40, rooms: 1, observed: '2026-11-20' };
  const candidate = model.candidates([entry]).find(c => c.id === entry.id);
  assert.ok(candidate);
  const exact = model.prices(candidate, { ...options, budget: 2500, sqm: 40 });
  assert.equal(exact.price, 2500);
  assert.equal(exact.room, 1);
  assert.equal(exact.sqm, 40);
  assert.equal(exact.date, entry.observed);
  for (const change of [{room: '2'}, {budget: 2499}, {sqm: 41}]) {
    assert.equal(model.prices(candidate, {...options, ...change}), null);
  }
  assert.equal(model.route(candidate, '留仙洞', options).terminal, '留仙洞');
  assert.equal(model.route(candidate, '岗厦北', options).terminal, '岗厦北');
});

function projectCandidate(id, category, metrics) {
  return { id, hood: { project: { category, metrics } } };
}
function metric(rooms, price, extra = {}) {
  return { rooms, price, period: '2026-11', scope: '项目租金样本', ...extra };
}

test('mixed developments retain the underlying project or village label and exclude shared-room offers', () => {
  const mixed = projectCandidate('mixed', '城中村及相邻住宅小区', [
    metric('村西区二室', 3500), metric('官龙名苑一室', 5500),
    metric('官龙名苑一室一厅', 6200, {scope:'单套整租挂牌', sqm:60}),
    metric('村内整租单间', 2000, {scope:'单套整租挂牌', sqm:30}),
    metric('一室', 900, {scope:'单套合租挂牌', sqm:60})
  ]);
  const flat = model.prices(mixed, options);
  const village = model.prices(mixed, {...options, room:'2'});
  assert.equal(flat.roomLabel, '官龙名苑一室');
  assert.equal(flat.category, '住宅小区');
  assert.equal(village.roomLabel, '村西区二室');
  assert.equal(village.category, '城中村');
  assert.notEqual(flat.peer, village.peer);
  const spacious = model.prices(mixed, {...options, sqm:45});
  assert.equal(spacious.price, 6200);
  assert.equal(spacious.sqm, 60);
  assert.equal(model.prices(mixed, {...options, sqm:45, budget:3000}), null);
});

test('rent comparisons need three distinct peers of the same type, month and room count within ten minutes', () => {
  function row(id, price, minutes, category = '城中村', period = '2026-11', room = '1') {
    const sample = metric(room === '1' ? '一室' : '二室', price, {period});
    return { route: {minutes}, price:model.prices(projectCandidate(id, category, [sample]), {...options, room}) };
  }
  const subject = row('this', 2000, 20);
  const peers = [row('a', 2200, 10), row('a', 2200, 15), row('b', 2600, 30)];
  const exclude = [row('late', 800, 31), row('flat', 8000, 20, '住宅小区'),
    row('old', 3500, 20, '城中村', '2026-10'), row('two', 4000, 20, '城中村', '2026-11', '2')];
  model.compare([subject,...peers,...exclude]);
  assert.equal(subject.compare, undefined);
  model.compare([subject,...peers,...exclude,row('c', 2400, 20)]);
  assert.equal(subject.compare.count, 3);
  assert.equal(subject.compare.median, 2400);
  assert.equal(subject.compare.difference, 400);
});

test('each residential area starts at its documented map anchor', () => {
  const rows = model.candidates([]);
  for (const [name, reference] of [['西丽 · 北部村落','牛成村'], ['大冲 · 科兴','高新园'], ['兴东 · 啤酒小镇','兴东']]) {
    const home = rows.find(c => c.name === name);
    assert.equal(home.node.name, reference);
    assert.ok(model.meter(home.coord,home.node.coord) < 500);
  }
});

test('commute prices prefer the latest completed month for each room size with a labelled partial-month fallback', () => {
  const market = {url:'',months:{'2026-11':{'1':{price:3900},'2':{price:5100}},'2026-10':{'1':{price:3800}}}};
  const local = browser.makeExploreModel(base,{...fine,asof:'2026-11-23',markets:[market]},journey,timing);
  const hood = {id:'market',hood:{mid:0}};
  assert.equal(local.prices(hood, options).price, 3800);
  const partial = local.prices(hood, {...options,room:'2'});
  assert.equal(partial.price, 5100);
  assert.match(partial.unit, /月内/);
  assert.match(partial.date, /2026-11-23/);
});

test('a quick drive with unknown rent remains distinguishable from an over-budget home', () => {
  const drive={...options, mode:'drive', budget:10000};
  const candidate=model.candidates([]).find(c=>c.id==='node-高新北');
  assert.equal(model.route(candidate,'留仙洞',drive).minutes,17);
  assert.equal(model.housing(candidate,drive).status,'pending');
  assert.equal(model.prices(candidate,drive),null);
  const house=projectCandidate('local','住宅小区',[metric('一室',10500),metric('二室',4500)]);
  assert.equal(model.housing(house,drive).status,'outside');
  assert.equal(model.housing(house,{...drive,room:'2',sqm:45}).status,'pending');
  assert.equal(model.housing(house,{...drive,room:'2'}).matched.price,4500);
  const areaOnly={personal:{room:1,sqm:42}};
  assert.equal(model.housing(areaOnly,{...drive,sqm:40}).status,'pending');
  assert.equal(model.housing(areaOnly,{...drive,sqm:45}).status,'outside');
});
test('adding residential footprints keeps the candidate IDs used by earlier journals', () => {
  const priorData={...fine,hoods:fine.hoods.filter(h=>!h.separateFromStation)};
  const oldIds=browser.makeExploreModel(base,priorData,journey,timing).candidates([]).map(c=>c.id);
  const current=new Set(model.candidates([]).map(c=>c.id));
  for(const id of oldIds)assert.ok(current.has(id),id);
  for(const h of fine.hoods.filter(h=>h.footprint))assert.ok(current.has(h.id));
});
