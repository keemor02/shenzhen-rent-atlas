'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

test('packed driving matrices in built index.html decode losslessly cell-for-cell against journey.json', () => {
  const html = read('index.html');
  const match = html.match(/<script type="application\/json" id="journey-data">([\s\S]*?)<\/script>/);
  assert.ok(match, 'journey-data script tag present in index.html');
  const embedded = JSON.parse(match[1]);
  assert.ok(embedded.driving.packed, 'driving matrices should be packed in built HTML');
  assert.equal(embedded.driving.durations, undefined);
  assert.equal(embedded.driving.distances, undefined);

  const unpackMatrix = (b64, n) => {
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
  };

  const orig = JSON.parse(read('data/journey.json'));
  const n = embedded.driving.packed.n;
  assert.equal(n, orig.driving.durations.length);
  const dur = unpackMatrix(embedded.driving.packed.durations, n);
  const dist = unpackMatrix(embedded.driving.packed.distances, n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      assert.equal(dur[i][j], orig.driving.durations[i][j], `duration mismatch at ${i},${j}`);
      assert.equal(dist[i][j], orig.driving.distances[i][j], `distance mismatch at ${i},${j}`);
    }
  }
});

test('atlasFastTransform updates SVG transforms cleanly within same zoom tier and invalidates across tier boundaries', () => {
  const ctx = vm.createContext({ window: {} });
  vm.runInContext(read('src/block-map.js'), ctx);
  const attrs = { geo: {}, overlay: {} };
  const geoEl = {
    dataset: { zoomTier: String(ctx.atlasZoomTier(1.0)), baseK: '1', baseTx: '100', baseTy: '50' },
    setAttribute(k, v) { attrs.geo[k] = v; }
  };
  const overlayEl = {
    setAttribute(k, v) { attrs.overlay[k] = v; }
  };
  const svg = {
    querySelector: sel => (sel === '.map-geography' ? geoEl : sel === '.map-overlay' ? overlayEl : null)
  };
  // Within tier (1.0 -> 1.2): succeeds and tracks pixel-for-pixel
  const ok = ctx.atlasFastTransform(svg, { k: 1.2, tx: 140, ty: 70 });
  assert.equal(ok, true);
  assert.equal(attrs.geo.transform, 'translate(140.00 70.00) scale(1.2)');
  // Verify algebra: world point (10, 20) had base screen (110, 70); after overlay transform should equal (10*1.2+140, 20*1.2+70) = (152, 94)
  assert.equal(attrs.overlay.transform, 'translate(20.00 10.00) scale(1.2000)');
  assert.equal(110 * 1.2 + 20, 152);
  assert.equal(70 * 1.2 + 10, 94);

  // Crossing zoom tier (1.0 -> 2.5): returns false to trigger crisp full redraw
  assert.equal(ctx.atlasFastTransform(svg, { k: 2.5, tx: 100, ty: 50 }), false);
});

test('OSM sync pipeline transforms WGS-84 to GCJ-02, matches Shenzhen streets, and separates syncedAt from checkedAt', () => {
  const sync = require('../tools/sync_osm.cjs');
  const streets = JSON.parse(read('sources/fine/streets.geojson')).features;

  // Geofabrik state parsing
  const state = sync.parseGeofabrikState('# comment\nsequenceNumber=4215\ntimestamp=2026-11-23T21\\:21\\:02Z\n');
  assert.equal(state.sequenceNumber, 4215);
  assert.equal(state.timestamp, '2026-11-23T21:21:02Z');

  // WGS-84 -> GCJ-02 shift in Shenzhen (~+0.005 lon, ~-0.0028 lat)
  const [glng, glat] = sync.wgs84ToGcj02(113.858, 22.562);
  assert.ok(glng > 113.861 && glng < 113.866, `unexpected GCJ-02 lng ${glng}`);
  assert.ok(glat > 22.557 && glat < 22.562, `unexpected GCJ-02 lat ${glat}`);

  // Synthetic Overpass payload around Pingzhou (Xixiang street)
  const sample = {
    elements: [
      {
        type: 'way',
        id: 1435010462,
        tags: { landuse: 'residential', name: '坪洲新村三期' },
        geometry: [
          { lat: 22.5622, lon: 113.8576 },
          { lat: 22.5622, lon: 113.8590 },
          { lat: 22.5632, lon: 113.8590 },
          { lat: 22.5632, lon: 113.8576 },
          { lat: 22.5622, lon: 113.8576 },
        ],
      },
      {
        type: 'relation',
        id: 19740575,
        tags: { shop: 'mall', name: '宝安大仟里' },
        center: { lat: 22.5715, lon: 113.8645 },
      },
      {
        type: 'way',
        id: 9999001,
        tags: { amenity: 'school', name: '坪洲小学' },
        center: { lat: 22.5645, lon: 113.8575 },
      },
    ],
  };

  const out = sync.parseOverpassResult(sample, streets, '2026-11-24T05:21:00+08:00');
  assert.equal(out.meta.credit, '© OpenStreetMap contributors');
  assert.equal(out.meta.syncedAt, '2026-11-24T05:21:00+08:00');
  assert.equal(out.meta.checkedAt, null);
  assert.equal(out.residential.features.length, 1);
  assert.equal(out.residential.features[0].properties.name, '坪洲新村');
  assert.equal(out.residential.features[0].properties.kind, '城中村');
  assert.equal(out.residential.features[0].properties.streetId, '440306018000');
  assert.equal(out.pois.length, 2);
  const mall = out.pois.find(p => p.name === '宝安大仟里');
  assert.equal(mall.category, 'mall');
  assert.equal(mall.streetId, '440306018000');
  assert.equal(mall.checkedAt, null);
  assert.equal(mall.syncedAt, '2026-11-24T05:21:00+08:00');
});

test('resolveDestinationName supports unambiguous keyword matching without false positives', () => {
  const ctx = vm.createContext({ window: {} });
  vm.runInContext(read('src/game.js'), ctx);
  const nodes = new Set(['企鹅岛', '坂田华为总部', '大疆天空之城', '科兴科学园', '西丽', '西乡']);
  const aliases = { '腾讯企鹅岛': '企鹅岛', '腾讯岛': '企鹅岛', '华为总部': '坂田华为总部', '大疆': '大疆天空之城' };
  const resolve = s => ctx.resolveDestinationName(s, nodes, aliases);
  assert.equal(resolve('腾讯'), '企鹅岛');
  assert.equal(resolve('华为'), '坂田华为总部');
  assert.equal(resolve('天空之城'), '大疆天空之城');
  assert.equal(resolve('科兴'), '科兴科学园');
  // Ambiguous single char or multi-match stays empty
  assert.equal(resolve('西'), '');
  assert.equal(resolve('不存在园区'), '');
});
