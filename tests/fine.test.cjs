'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const load=file=>JSON.parse(read(file));
const fine=load('data/fine.json'),base=load('data/base.json');
const source=file=>load('sources/fine/'+file+'.json');
const url=value=>assert.match(value,/^https?:\/\//);
const YM=/^20\d\d-(?:0[1-9]|1[012])$/;

function harness() {
  // Rendering needs only these SVG and event operations, with no browser or network dependency.
  const nodes=new Map();
  function node(tag='div'){
    return {tag,attrs:{},dataset:{},children:[],handlers:{},innerHTML:'',hidden:false,
      setAttribute(k,v){this.attrs[k]=String(v);},appendChild(c){this.children.push(c);},
      replaceChildren(){this.children=[];},addEventListener(k,fn){this.handlers[k]=fn;},
      getBoundingClientRect(){return {width:800,height:430};}};
  }
  const el=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);};
  const fixed=Date.parse('2027-02-04T12:00:00+08:00');
  class Clock extends Date{constructor(...args){super(...(args.length?args:[fixed]));}static now(){return fixed;}}
  const browser=vm.createContext({document:{getElementById:el,querySelectorAll:()=>[],createElementNS:(_,tag)=>node(tag)},
    Date:Clock,ResizeObserver:class {observe(){}}});
  browser.window=browser;
  for(const filename of ['src/world.js','src/market-period.js','src/map-camera.js','src/block-map.js','archive/legacy-v1/fine.js'])vm.runInContext(read(filename),browser);
  const data=structuredClone(fine);
  const api=browser.initFineAtlas({data,base,go:()=>{}});
  const change=(field,value)=>el('fine').handlers.change({target:{dataset:{field},value}});
  const view=view=>el('fine').handlers.click({target:{closest:()=>({dataset:{view}})}});
  return {el,browser,data,api,change,view,detail:()=>el('fine-inspector').innerHTML};
}

test('all published street, area, project and monthly values retain their source grain',()=>{
  const streets=new Map(fine.streets.map(s=>[s.id,s]));
  const events=new Set(base.events.map(e=>e.key));
  const refs=source('housing-reference');
  assert.equal(streets.size,fine.streets.length);
  assert.equal(new Set(fine.hoods.map(h=>h.id)).size,fine.hoods.length);
  assert.deepEqual(fine.markets,source('markets'));
  for(const m of fine.markets){
    url(m.url);
    for(const [month,values] of Object.entries(m.months)){
      assert.match(month,YM);assert.ok(month<=fine.asof.slice(0,7));
      for(const [room,row] of Object.entries(values)){
        assert.match(room,/^[1-5]$/);assert.ok(Number.isFinite(row.price)&&row.price>0);
        assert.ok(row.yoy==null||Number.isFinite(row.yoy));
      }
    }
  }
  for(const item of fine.streets){
    assert.equal(item.ref,refs.byDistrict[item.d]?.[item.short]??null);
    if(item.mid!=null){assert.equal(fine.markets[item.mid].name,item.short);assert.equal(fine.markets[item.mid].district,item.d);}
    for(const r of item.rents){url(r.source);assert.equal(r.street,item.n);assert.equal(r.district,item.d);assert.equal(r.unit,'元/㎡·月');}
    for(const g of item.groups){url(g.source);assert.ok(g.streets.includes(item.n));assert.equal(g.district,item.d);assert.ok(g.range[0]<=g.range[1]);assert.equal(g.price,undefined);}
    for(const e of item.events)assert.ok(events.has(e));
  }
  for(const h of fine.hoods){
    assert.ok(h.xy.every(Number.isFinite));if(h.street!=null)assert.equal(streets.get(h.street)?.d,h.d);
    for(const e of h.events)assert.ok(events.has(e));
    if(h.mid!=null){assert.equal(fine.markets[h.mid].district,h.d);assert.ok(h.anchor);}
    if(h.project){assert.equal(h.mid,null);for(const r of h.project.metrics){url(r.source);assert.match(r.period.slice(0,7),YM);assert.ok(r.price>0);assert.ok(r.rooms&&r.scope);}}
  }
});

test('complete months follow each room’s own collection date across offline years and cache upgrades',()=>{
  const {browser:b}=harness();
  const m={months:{'2026-10':{'1':{price:3200}},'2026-11':{'1':{price:3500},'2':{price:5500,checkedAt:'2026-12-03T00:00:00+08:00'}},'2026-12':{'1':{price:3600,checkedAt:null}}}};
  assert.equal(b.latestMarketRent(m,1,'2026-11-23').period,'2026-10');
  assert.equal(b.latestMarketRent(m,2,'2026-11-23').period,'2026-11');
  assert.equal(b.latestMarketRent(m,3,'2026-11-23'),null);
  assert.equal(b.marketPeriodStatus('2026-11',m.months['2026-11']['1'],'2026-11-23').complete,false);
  assert.equal(b.marketPeriodStatus('2026-12',m.months['2026-12']['1'],'2026-11-23').asof,null);
  assert.equal(b.marketPeriodStatus('2026-11',{checkedAt:'2026-11-30T16:20:00Z'},'2026-11-23').complete,true);
  assert.equal(b.latestMarketRent({months:{'2026-11':{'4':{price:9000}}}},4,'2026-11-23').complete,false);
});

test('street report, status view, month gap sparkline and unlocated areas stay distinct',()=>{
  const {api,data,detail,change,view,el}=harness();
  const xili=data.streets.find(s=>s.short==='西丽');
  api.show('street',xili.id);
  assert.match(detail(),/1,980/);assert.match(detail(),/2026-10/);assert.match(detail(),/深圳湾/);
  change('period','2026-11');assert.match(detail(),/月内样本，采集于 2026-11-23/);
  const mk=data.markets[xili.mid];mk.months['2026-12']={'1':{price:3210,yoy:-4,checkedAt:'2027-01-02T00:00:00+08:00'}};
  view('now');assert.match(detail(),/2026-12，西丽商圈一室月租为 3,210 元/);assert.match(detail(),/2026-Q1/);assert.match(detail(),/60.06/);
  view('price');change('metric','market');assert.match(detail(),/3,210/);
  delete mk.months['2026-11']['1'];api.refresh();assert.ok((detail().match(/d="M[^"]+M/g)||[]).length);
  const map=()=>el('fine-map').innerHTML;
  const xiliBlock=()=>map().match(new RegExp('<path class="map-block" data-block="'+xili.id+'"[^>]+>'))[0];
  assert.match(xiliBlock(),/3,210 元\/月/);
  assert.doesNotMatch(xiliBlock(),/fill="url/);
  assert.ok(map().includes('data-hoodgo='));
  const noStreet=data.hoods.find(h=>h.street==null);
  api.show('hood',xili.id,noStreet.id);assert.ok(detail().includes(noStreet.n));
  assert.ok(!map().includes('class="map-outline"'));
  const empty=data.streets.find(s=>!data.hoods.some(h=>h.street===s.id));
  api.show('hood',empty.id);assert.match(detail(),/当前范围没有可定位/);
  change('scope','all');assert.doesNotMatch(detail(),/当前范围没有可定位/);
});

test('the live feed and a subsequent offline reload retain per-room dates and sparse monthly values',async()=>{
  const feedKey='sz-rent-public-feeds-v2',flags=new Map([['sz-rent-autocheck-v1','false']]);
  const market=fine.markets.find(m=>m.name==='新安'),mid=fine.markets.indexOf(market);
  const checkedAt='2026-12-03T10:00:00+08:00',oldDate='2026-11-20T09:00:00+08:00';
  const old={name:market.name,url:market.url,checkedAt:oldDate,months:{'2026-11':{'4':{price:9999,yoy:0}}}};
  flags.set(feedKey,JSON.stringify({markets:{[market.url]:old}}));
  function launch(online){
    const nodes=new Map();
    function getElementById(id) {
      if(!nodes.has(id))nodes.set(id,{querySelectorAll:()=>[],addEventListener:()=>{}});
      return nodes.get(id);
    }
    for(const [id,content] of Object.entries({'fine-data':fine,'journey-data':{},'time-data':{},'facilities-data':{facilities:[]},'policy-data':{policies:[]}})){
      getElementById(id).textContent=JSON.stringify(content);
    }
    const browser=vm.createContext({document:{getElementById,querySelector:()=>({textContent:JSON.stringify(base)})},
      location:online?{protocol:'http:',hostname:'127.0.0.1'}:{protocol:'file:'},
      localStorage:{getItem:id=>flags.get(id)??null,setItem:(id,v)=>flags.set(id,v)},
      AbortController,setTimeout,clearTimeout,setInterval:()=>{},
      async fetch(endpoint){
        const data=endpoint==='/api/status'?{service:'shenzhen-rent-atlas'}:{
          url:market.url,name:market.name,checkedAt,months:{'2026-11':{'1':{price:3501,yoy:3}}}};
        return {ok:true,json:async()=>({ok:true,data})};
      }});
    browser.window=browser;
    let options;
    browser.initGame=args=>{options=args;return {show(){},refresh(){}};};
    const fixed=Date.parse('2027-02-04T12:00:00+08:00');
    browser.Date=class extends Date{constructor(...args){super(...(args.length?args:[fixed]));}static now(){return fixed;}};
    vm.runInContext(read('src/main.js'),browser);
    return options;
  }
  const live=launch(true);
  await new Promise(resolve=>setImmediate(resolve));
  await live.ensureMarket(mid,true);
  const saved=JSON.parse(flags.get(feedKey)).markets[market.url].months['2026-11'];
  assert.equal(saved['1'].checkedAt,checkedAt);assert.equal(saved['4'].checkedAt,null);
  const rooms=launch(false).data.markets[mid].months['2026-11'];
  assert.equal(rooms['1'].price,3501);assert.equal(rooms['1'].checkedAt,checkedAt);
  assert.equal(rooms['4'].price,9999);assert.equal(rooms['4'].checkedAt,null);
  assert.equal(rooms['2'].price,market.months['2026-11']['2'].price);
  assert.equal(rooms['2'].checkedAt,undefined);
});
