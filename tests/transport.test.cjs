'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const vm = require('node:vm');
const project = join(__dirname, '..');
const read = name => JSON.parse(readFileSync(join(project, 'data', name + '.json')));
const base = read('base'), timing = read('timing'), journey = read('journey');
const browser = vm.createContext({});
browser.window = browser;
for (const file of ['rail', 'bus']) {
  vm.runInContext(readFileSync(join(project, 'app', file + '.js'), 'utf8'), browser);
}
browser.worldEvents = JSON.parse(readFileSync(join(project, 'sources', 'v3', 'public-events.json'), 'utf8')).events;

test('all six published metro feeders work in both directions on the rail and bus networks', () => {
  const planner = browser.makeRailPlanner(base, timing);
  const costs = {access: 0, egress: 0, wait: 3, transfer: 5};
  const inbound = planner.to('企鹅岛', costs);
  const expected = ['宝体', '宝安', '宝华', '上川', '坪洲', '前湾'];
  assert.deepEqual(timing.shuttles.map(s => s.station), expected);
  for (const feeder of timing.shuttles) {
    for (const [from, to] of [[feeder.station, '企鹅岛'], ['企鹅岛', feeder.station]]) {
      const rail = from === '企鹅岛' ? planner.fromIsland(to, costs) : inbound.get(from);
      const bus = browser.busOptions(journey, from, to).direct;
      assert.equal(rail.minutes, feeder.wait + feeder.ride);
      assert.equal(rail.transfers, 0);
      assert.equal(rail.legs[0].line, feeder.line);
      assert.equal(rail.legs[0].from, from);
      assert.equal(rail.legs[0].to, to);
      assert.equal(bus.legs[0].line, feeder.line);
      assert.equal(bus.legs[0].fromStop, from === '企鹅岛' ? feeder.toStop : feeder.fromStop);
      assert.equal(bus.legs[0].toStop, to === '企鹅岛' ? feeder.toStop : feeder.fromStop);
    }
  }
  const trip = planner.fromIsland('灵芝', costs);
  assert.equal(trip.legs[0].from, '企鹅岛');
  assert.equal(trip.legs.at(-1).to, '灵芝');
  assert.equal(trip.minutes, trip.ride + trip.shuttleMinutes + trip.wait + trip.transferMinutes);
  assert.equal(planner.fromIsland('不存在', costs), null);
});

test('a long express leg is costed by its stop-to-stop distance in both directions', () => {
  const records = journey.bus.routes.filter(([name]) => name === 'E33路');
  let checked = 0;
  for (const [name, towards, stops] of records) {
    const names = stops.map(i => journey.bus.stops[i][0]);
    const a = names.indexOf('大运地铁站'), b = names.indexOf('松岗华美工业园');
    if (a < 0 || b < 0) continue;
    assert.equal(Math.abs(a-b), 1);
    const [start, end] = a < b ? [stops[a], stops[b]] : [stops[b], stops[a]];
    const sample = {nodes: [{name:'起'}, {name:'终'}], bus: {stops: journey.bus.stops,
      routes: [[name,towards,[start,end]]], near:[[[start,0]],[[end,0]]],
      transferLinks:[], publishedShuttles:{shuttles:[]}}};
    const {direct} = browser.busOptions(sample, '起', '终');
    assert.equal(direct.stops, 1);
    assert.ok(direct.rideMeters > 37000 && direct.rideMeters < 39000);
    assert.ok(direct.estimatedRide > 55 && direct.estimatedRide < 60);
    assert.equal(browser.busOptions(sample, '终', '起').direct, null);
    checked++;
  }
  assert.equal(checked, 2);
});

test('street references, event annotations and same-name walking links resolve against embedded coordinates', () => {
  const names = new Set(journey.nodes.map(n => n.name));
  assert.equal(names.size, journey.nodes.length);
  for (const group of Object.values(journey.streetNodes)) {
    assert.ok(group.length);
    for (const n of group) assert.ok(names.has(n), n);
  }
  assert.equal(new Set(browser.worldEvents.map(e => e.id)).size, browser.worldEvents.length);
  for (const event of browser.worldEvents) {
    assert.match(event.observed, /^\d{4}-\d\d(?:-\d\d)?$/);
    assert.match(event.url, /^https:\/\//);
    assert.ok(event.anchor && event.fact && event.check);
    assert.ok(!event.until || event.until >= event.observed);
    for (const n of event.near) assert.ok(names.has(n), n);
    assert.ok(event.coord[0]>113.7 && event.coord[0]<114.7 && event.coord[1]>22.4 && event.coord[1]<22.9);
  }
  const {stops,near,transferLinks} = journey.bus;
  function distance(a,b) {
    return Math.round(Math.hypot((a[0]-b[0])*102820,(a[1]-b[1])*111195));
  }
  for (let i=0; i<near.length; i++) {
    for (const [s,d] of near[i]) {
      assert.equal(d, distance(journey.nodes[i].coord, stops[s].slice(1)));
      assert.ok(d<=journey.bus.radiusMeters);
    }
  }
  for (const [a,b,d] of transferLinks) {
    assert.equal(stops[a][0],stops[b][0]);
    assert.equal(d,distance(stops[a].slice(1),stops[b].slice(1)));
    assert.ok(d<=journey.bus.transferMeters);
  }
});
