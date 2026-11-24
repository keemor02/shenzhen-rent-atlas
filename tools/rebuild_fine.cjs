#!/usr/bin/env node
'use strict';

// Rebuild the street and neighbourhood layer with the projection used by base.json.
const fs = require('node:fs');
const path = require('node:path');
const { geoArea, geoContains, geoMercator, geoPath } = require('../sources/fine/vendor/d3-geo.cjs');

const root = path.resolve(__dirname, '..');
const inputs = path.join(root, 'sources', 'fine');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const source = file => read(path.join(inputs, file));

const base = read(path.join(root, 'data', 'base.json'));
const geography = source('geography.json');
const features = source('streets.geojson').features;
const markets = source('markets.json');
const rents = source('street-rents.json');
const projects = source('projects.json');
const reference = source('housing-reference.json');
const anchors = source('anchors.json');
const provenance = source('provenance.json');

const stations = new Map(base.stations.map(row => [row[0], row]));
const rounded = n => Number(n.toFixed(2));
function baseProjection() {
  const west = stations.get('宝安中心');
  const east = stations.get('坪山围');
  if (!west || !east) throw new Error('base.json 缺少投影所需的宝安中心或坪山围站。');
  const radians = Math.PI / 180;
  const [lng, lat] = west[3];
  const scale = (east[1] - west[1]) / ((east[3][0] - lng) * radians);
  return geoMercator().scale(scale).translate([
    west[1] - scale * lng * radians,
    west[2] + scale * Math.log(Math.tan(Math.PI / 4 + lat * radians / 2)),
  ]);
}
const project = baseProjection();
const coordinates = lngLat => project(lngLat).map(rounded);
const outline = geoPath(project).digits(2);

// D3 expects exterior rings of small spherical polygons to be clockwise.
// Reverse every ring together to retain holes, including within multipolygons.
for (const {geometry} of features) {
  const polygons = geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates];
  for (const rings of polygons) {
    if (geoArea({type: 'Polygon', coordinates: rings}) > 2 * Math.PI) {
      for (const ring of rings) ring.reverse();
    }
  }
}

const streets = features.map(feature => {
  const {id, name, shortName, district, labelPoint} = feature.properties;
  const mid = markets.findIndex(m => m.name === shortName && m.district === district);
  return {
    id, n: name, short: shortName, d: district, p: outline(feature),
    xy: coordinates(labelPoint), bounds: outline.bounds(feature).flat().map(rounded),
    mid: mid < 0 ? null : mid,
    rents: rents.records.filter(r => r.district === district && r.street === name),
    groups: rents.groups.filter(g => g.district === district && g.streets.includes(name)),
    ref: reference.byDistrict[district]?.[shortName] ?? null, stations: [], events: [],
  };
});
function streetAt(lngLat, district) {
  const index = features.findIndex(feature =>
    (!district || feature.properties.district === district) && geoContains(feature, lngLat));
  return streets[index] ?? null;
}
const stStreet = {};
for (const [name, , , lngLat, district] of base.stations) {
  const street = streetAt(lngLat, district);
  if (!street) continue;
  stStreet[name] = street.id;
  if (name !== '企鹅岛') street.stations.push(name);
}

const hoods = projects.cases.map(item => {
  const busName = anchors.projectBusStops[item.id];
  const busPoint = anchors.busCoordinates[busName];
  const lngLat = busPoint ?? item.coordinates;
  const street = streets.find(s => s.d === item.district && s.n === item.street);
  return {
    id: item.id, n: item.area, d: item.district, street: street?.id ?? null,
    xy: coordinates(lngLat), ll: lngLat, station: item.station, mid: null,
    project: item, events: [],
    anchor: busPoint ? busName + '公交站附近' : item.station + '地铁站附近',
  };
});
for (const event of base.events) {
  const station = event.station ?? null;
  const lngLat = event.ll ?? stations.get(station)?.[3];
  if (!lngLat) continue;
  const street = streetAt(lngLat, event.dist);
  if (street) {
    street.events.push(event.key);
    for (const hood of hoods) {
      if (hood.street === street.id && hood.station === station) hood.events.push(event.key);
    }
  }
  const island = event.key === 'island';
  hoods.push({
    id: 'e-' + event.key, n: event.area, d: event.dist, street: street?.id ?? null,
    xy: coordinates(lngLat), ll: lngLat, station: station ?? (island ? '企鹅岛' : null),
    mid: null, project: null, events: [event.key],
    anchor: station ? station + '站周边' : island ? '园区参考点' : '报道片区参考点',
  });
}
for (const [id, market] of markets.entries()) {
  const name = stations.has(market.name) ? market.name : anchors.marketStationNames[market.name];
  const station = stations.get(name);
  if (!station || station[4] !== market.district) continue;
  const street = streetAt(station[3], market.district);
  hoods.push({
    id: 'm-' + id, n: market.name + '商圈', d: market.district, street: street?.id ?? null,
    xy: station.slice(1, 3), ll: station[3], station: name, mid: id,
    project: null, events: [], anchor: name + '站 · 商圈位置参考',
  });
}

const localSource=source('west-residential.geojson');
const westStreet=streets.find(s=>s.n==='西乡街道');
const zones=['西乡','坪洲','固戍'].map(name=>{
  const station=stations.get(name),xy=coordinates(station[3]);
  // The station comparison window extends 1.8 km, clipped to nearer stations and the parent street on the map.
  const radius=Math.abs(coordinates([station[3][0],station[3][1]+1800/111200])[1]-xy[1]);
  return {id:'zone-'+name,n:name,street:westStreet.id,xy,radius};
});
function zoneFor(point) {
  const ranked=zones.map(z=>[z,Math.hypot(point[0]-z.xy[0],point[1]-z.xy[1])]).sort((a,b)=>a[1]-b[1]);
  return ranked[0][1]<=ranked[0][0].radius?ranked[0][0]:null;
}
for(const z of zones){
  const [x,y]=z.xy,r=z.radius;
  let ring=Array.from({length:64},(_,i)=>[x+r*Math.cos(i*Math.PI/32),y+r*Math.sin(i*Math.PI/32)]);
  for(const other of zones.filter(s=>s!==z)){
    const [ox,oy]=other.xy, signed=([px,py])=>(px-(x+ox)/2)*(ox-x)+(py-(y+oy)/2)*(oy-y);
    const out=[];
    for(let i=0;i<ring.length;i++){
      const a=ring[i],b=ring[(i+1)%ring.length],da=signed(a),db=signed(b);
      if(da<=0)out.push(a);
      if((da<0&&db>0)||(da>0&&db<0))out.push(a.map((v,j)=>v+(b[j]-v)*da/(da-db)));
    }
    ring=out;
  }
  z.p='M'+ring.map(p=>p.map(rounded).join(',')).join('L')+'Z';
  z.bounds=[Math.min(...ring.map(p=>p[0])),Math.min(...ring.map(p=>p[1])),Math.max(...ring.map(p=>p[0])),Math.max(...ring.map(p=>p[1]))].map(rounded);
}
for(const feature of localSource.features){
  const {id,name,kind,ways}=feature.properties;
  const parts=feature.geometry.coordinates.map(rings=>{
    const polygon={type:'Polygon',coordinates:rings};
    if(geoArea(polygon)>2*Math.PI)rings.forEach(ring=>ring.reverse());
    return polygon;
  }).sort((a,b)=>geoArea(b)-geoArea(a));
  const main=parts[0],point=outline.centroid(main);
  if(!geoContains(main,project.invert(point)))throw Error(name+' 的参考点超出住宅范围');
  const ll=project.invert(point).map(v=>+v.toFixed(6)),xy=coordinates(ll);
  const street=streetAt(ll,'宝安区'),zone=zoneFor(xy);
  if(!street||street.id!==westStreet.id||!zone)throw Error(name+' 超出当前站点覆盖区: '+street?.n);
  const nearest=base.stations.filter(s=>s[4]==='宝安区').sort((a,b)=>Math.hypot(a[1]-xy[0],a[2]-xy[1])-Math.hypot(b[1]-xy[0],b[2]-xy[1]))[0];
  let hood=hoods.find(h=>h.id===id);
  if(!hood){
    hood={id,n:name,d:street.d,street:street.id,mid:null,project:null,events:[],separateFromStation:true};
    hoods.push(hood);
  }
  Object.assign(hood,{ll,xy,station:nearest[0],zone:zone.id,anchor:'住宅范围内参考点',
    footprint:{kind,name,ways,p:outline(feature),bounds:outline.bounds(feature).flat().map(rounded)}});
}
for(const h of hoods)if(h.street===westStreet.id && !h.zone)h.zone=zoneFor(h.xy)?.id;
const data = {
  streets, hoods, markets, stStreet, zones, localCredit:{name:localSource.credit,url:localSource.license,asof:localSource.timestamp.slice(0,10)}, geoMeta: geography,
  refSource: reference.source, asof: provenance.snapshotDate,
};
const target = path.join(root, 'data', 'fine.json');
const temporary = target + '.' + process.pid + '.tmp';
try {
  fs.writeFileSync(temporary, JSON.stringify(data));
  fs.renameSync(temporary, target);
} finally {
  fs.rmSync(temporary, {force: true});
}
console.log('data/fine.json · ' + streets.length + ' 个街道，' + hoods.length +
  ' 个代表片区，' + markets.length + ' 个商圈，' + projects.cases.length + ' 个项目。');
