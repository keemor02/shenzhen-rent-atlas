#!/usr/bin/env node
'use strict';

// OSM / Overpass 增量同步与校验工具（仅用 Node.js 标准库 + 项目内置 d3-geo）。
// 严格区分：地图同步时间 (syncedAt) 与 营业/政策人工核实日期 (checkedAt)。
const fs = require('node:fs');
const path = require('node:path');
const { geoArea, geoContains } = require('../sources/fine/vendor/d3-geo.cjs');

const ROOT = path.resolve(__dirname, '..');
const CREDIT = '© OpenStreetMap contributors';
const LICENSE = 'https://www.openstreetmap.org/copyright';

// Standard WGS-84 to GCJ-02 transform for China mainland (matches atlas streets.geojson / base.json).
function wgs84ToGcj02(lng, lat) {
  if (lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271) return [lng, lat];
  const PI = Math.PI;
  const a = 6378245.0;
  const ee = 0.00669342162296594323;
  const x = lng - 105.0;
  const y = lat - 35.0;
  let dLat = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
    + (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0
    + (20.0 * Math.sin(y * PI) + 40.0 * Math.sin(y / 3.0 * PI)) * 2.0 / 3.0
    + (160.0 * Math.sin(y / 12.0 * PI) + 320.0 * Math.sin(y * PI / 30.0)) * 2.0 / 3.0;
  let dLng = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
    + (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0
    + (20.0 * Math.sin(x * PI) + 40.0 * Math.sin(x / 3.0 * PI)) * 2.0 / 3.0
    + (150.0 * Math.sin(x / 12.0 * PI) + 300.0 * Math.sin(x / 30.0 * PI)) * 2.0 / 3.0;
  const radLat = lat / 180.0 * PI;
  let magic = Math.sin(radLat);
  magic = 1 - ee * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / ((a * (1 - ee)) / (magic * sqrtMagic) * PI);
  dLng = (dLng * 180.0) / (a / sqrtMagic * Math.cos(radLat) * PI);
  return [Number((lng + dLng).toFixed(6)), Number((lat + dLat).toFixed(6))];
}

function buildOverpassQuery(bbox) {
  const [s, w, n, e] = bbox;
  const box = `${s},${w},${n},${e}`;
  return [
    '[out:json][timeout:30];',
    '(',
    `  way["landuse"="residential"]["name"](${box});`,
    `  relation["landuse"="residential"]["name"](${box});`,
    `  nwr["shop"~"^(mall|department_store|supermarket)$"]["name"](${box});`,
    `  nwr["amenity"~"^(school|marketplace|clinic|hospital|pharmacy)$"]["name"](${box});`,
    `  nwr["leisure"="park"]["name"](${box});`,
    ');',
    'out center geom;',
  ].join('\n');
}

function parseGeofabrikState(text) {
  const result = { timestamp: null, sequenceNumber: null };
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim().replace(/\\:/g, ':');
    if (key === 'timestamp') result.timestamp = val;
    if (key === 'sequenceNumber') result.sequenceNumber = Number(val) || val;
  }
  return result;
}

function classifyPoi(tags = {}) {
  if (tags.shop === 'mall' || tags.shop === 'department_store') return 'mall';
  if (tags.shop === 'supermarket') return 'supermarket';
  if (tags.amenity === 'school') return 'school';
  if (tags.amenity === 'marketplace') return 'market';
  if (tags.amenity === 'clinic' || tags.amenity === 'hospital') return 'health';
  if (tags.amenity === 'pharmacy') return 'pharmacy';
  if (tags.leisure === 'park') return 'park';
  return null;
}

function classifyResidentialKind(name, tags = {}) {
  if (tags.residential === 'urban_village' || /(?:新村|旧村|老村|村)$/.test(name)) return '城中村';
  return '住宅小区';
}

function normalizeStreetFeatures(features) {
  return features.map(f => {
    const copy = structuredClone(f);
    const polys = copy.geometry.type === 'MultiPolygon' ? copy.geometry.coordinates : [copy.geometry.coordinates];
    for (const rings of polys) {
      if (geoArea({ type: 'Polygon', coordinates: rings }) > 2 * Math.PI) {
        for (const ring of rings) ring.reverse();
      }
    }
    return copy;
  });
}

function findStreetForPoint(gcjLngLat, streetFeatures) {
  for (const f of streetFeatures) {
    if (geoContains(f, gcjLngLat)) {
      return { streetId: f.properties.id, streetName: f.properties.name, district: f.properties.district };
    }
  }
  return null;
}

function closedRingFromGeometry(geom) {
  if (!Array.isArray(geom) || geom.length < 4) return null;
  const ring = geom.map(pt => wgs84ToGcj02(pt.lon, pt.lat));
  const first = ring[0], last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([...first]);
  return ring.length >= 4 ? ring : null;
}

function ringCenter(ring) {
  const pts = ring.slice(0, -1);
  const sum = pts.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0]);
  return [Number((sum[0] / pts.length).toFixed(6)), Number((sum[1] / pts.length).toFixed(6))];
}

function parseOverpassResult(overpassJson, streetFeatures, syncedAt = new Date().toISOString()) {
  const normalizedStreets = normalizeStreetFeatures(streetFeatures || []);
  const elements = Array.isArray(overpassJson?.elements) ? overpassJson.elements : [];
  const residentialGroups = new Map();
  const pois = [];
  const seenPoi = new Set();

  for (const el of elements) {
    const tags = el?.tags || {};
    const name = String(tags['name:zh'] || tags.name || '').trim();
    if (!name) continue;
    const osmUrl = `https://www.openstreetmap.org/${el.type}/${el.id}`;

    if (tags.landuse === 'residential' && el.type === 'way' && Array.isArray(el.geometry)) {
      const ring = closedRingFromGeometry(el.geometry);
      if (!ring) continue;
      const center = ringCenter(ring);
      const street = findStreetForPoint(center, normalizedStreets);
      const baseName = name.replace(/[一二三四五六七八九十\d]+期$/, '').trim() || name;
      const key = `${street?.streetId || 'unknown'}::${baseName}`;
      if (!residentialGroups.has(key)) {
        residentialGroups.set(key, {
          name: baseName,
          kind: classifyResidentialKind(baseName, tags),
          ways: [],
          coordinates: [],
          streetId: street?.streetId || null,
          streetName: street?.streetName || null,
          district: street?.district || null,
        });
      }
      const group = residentialGroups.get(key);
      group.ways.push(el.id);
      group.coordinates.push([ring]);
      continue;
    }

    const category = classifyPoi(tags);
    if (!category) continue;
    let pt = null;
    if (el.type === 'node' && Number.isFinite(el.lon) && Number.isFinite(el.lat)) {
      pt = wgs84ToGcj02(el.lon, el.lat);
    } else if (el.center && Number.isFinite(el.center.lon) && Number.isFinite(el.center.lat)) {
      pt = wgs84ToGcj02(el.center.lon, el.center.lat);
    } else if (Array.isArray(el.geometry) && el.geometry.length) {
      const ring = closedRingFromGeometry(el.geometry);
      if (ring) pt = ringCenter(ring);
    }
    if (!pt) continue;
    const street = findStreetForPoint(pt, normalizedStreets);
    const dedupKey = `${category}::${street?.streetId || ''}::${name}`;
    if (seenPoi.has(dedupKey)) continue;
    seenPoi.add(dedupKey);
    pois.push({
      id: `osm-${el.type}-${el.id}`,
      name,
      category,
      coord: pt,
      streetId: street?.streetId || null,
      streetName: street?.streetName || null,
      district: street?.district || null,
      source: osmUrl,
      sourceName: 'OpenStreetMap',
      syncedAt,
      checkedAt: null,
      note: '来自 OpenStreetMap 自动同步，营业状态/招生划片/入住进展需另以官方公告核实。',
    });
  }

  const residential = {
    type: 'FeatureCollection',
    credit: CREDIT,
    license: LICENSE,
    syncedAt,
    checkedAt: null,
    coordinates: 'GCJ-02（由 OpenStreetMap WGS-84 自动转换）',
    features: [...residentialGroups.values()].map(g => ({
      type: 'Feature',
      properties: {
        id: `osm-res-${g.ways[0]}`,
        name: g.name,
        kind: g.kind,
        ways: g.ways,
        streetId: g.streetId,
        streetName: g.streetName,
        district: g.district,
        syncedAt,
        checkedAt: null,
      },
      geometry: {
        type: 'MultiPolygon',
        coordinates: g.coordinates,
      },
    })),
  };

  return {
    meta: {
      credit: CREDIT,
      license: LICENSE,
      syncedAt,
      checkedAt: null,
      residentialCount: residential.features.length,
      poiCount: pois.length,
    },
    residential,
    pois,
  };
}

async function runCli(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const k = argv[i].slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) args[k] = true;
      else { args[k] = next; i++; }
    }
  }
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'sources/fine/osm-targets.json'), 'utf8'));
  const streets = JSON.parse(fs.readFileSync(path.join(ROOT, 'sources/fine/streets.geojson'), 'utf8')).features;

  let overpassJson;
  let syncedAt = new Date().toISOString();
  if (args.input) {
    overpassJson = JSON.parse(fs.readFileSync(path.resolve(args.input), 'utf8'));
    if (overpassJson.osm3s?.timestamp_osm_base) syncedAt = overpassJson.osm3s.timestamp_osm_base;
  } else if (args.target) {
    const target = config.targets.find(t => t.id === args.target);
    if (!target) throw new Error(`未知目标片区: ${args.target}，可选: ${config.targets.map(t => t.id).join(', ')}`);
    const query = buildOverpassQuery(target.bbox);
    const resp = await fetch(config.overpassEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'User-Agent': 'ShenzhenRentalAtlas/1.0' },
      body: 'data=' + encodeURIComponent(query),
    });
    if (!resp.ok) throw new Error(`Overpass API HTTP ${resp.status}`);
    overpassJson = await resp.json();
    if (overpassJson.osm3s?.timestamp_osm_base) syncedAt = overpassJson.osm3s.timestamp_osm_base;
  } else {
    console.log('用法: node tools/sync_osm.cjs --input <overpass.json> --out <out.json>');
    console.log('   或: node tools/sync_osm.cjs --target <xixiang|xili|xinan|yuehai|nantou> --out <out.json>');
    return;
  }

  const parsed = parseOverpassResult(overpassJson, streets, syncedAt);
  if (args.out) {
    const outFile = path.resolve(args.out);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, JSON.stringify(parsed, null, 2), 'utf8');
    console.log(`同步完成: ${parsed.meta.residentialCount} 处住宅轮廓, ${parsed.meta.poiCount} 处 POI -> ${outFile}`);
  } else {
    console.log(JSON.stringify(parsed.meta, null, 2));
  }
}

if (require.main === module) {
  runCli(process.argv.slice(2)).catch(err => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = {
  wgs84ToGcj02,
  buildOverpassQuery,
  parseGeofabrikState,
  classifyPoi,
  classifyResidentialKind,
  parseOverpassResult,
};
