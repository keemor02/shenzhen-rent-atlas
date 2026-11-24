'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const project=path.resolve(__dirname,'..');
const script=readFileSync(path.join(project,'src','market-events.js'),'utf8');
const base=JSON.parse(readFileSync(path.join(project,'data','base.json'),'utf8'));
const fine=JSON.parse(readFileSync(path.join(project,'data','fine.json'),'utf8'));
const escapeText=text=>String(text??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const make=vm.runInNewContext(script+'\nmakeMarketEvents');
const market=make(base,escapeText);

test('all market events have a projected marker, a linked rental candidate and selectable type and judgment',()=>{
  const all=market.markers();
  assert.equal(all.length,14);
  const types=new Set(base.events.map(e=>e.type)),signals=new Set(base.events.map(e=>e.signal));
  assert.equal(types.size,5);assert.equal(signals.size,5);
  for(const type of types)assert.ok(market.filters(type).includes('data-market-filter="'+type+'" aria-pressed="true"'));
  for(const signal of signals)assert.ok(market.legend(signal).includes('data-market-filter="'+signal+'" aria-pressed="true"'));
  for(const marker of all) {
    const event=market.get(marker.id);
    assert.ok(market.has(event.key));
    assert.equal(marker.xy,event.xy);
    assert.ok(fine.hoods.some(hood=>hood.id==='e-'+event.key));
    for(const filter of [event.type,event.signal]) {
      const shown=Array.from(market.markers(filter),m=>m.id);
      assert.ok(shown.includes(event.key));
      assert.deepEqual(shown,base.events.filter(e=>e.type===filter||e.signal===filter).map(e=>e.key));
      assert.ok(market.overview(filter).includes('data-market-event="'+event.key+'"'));
    }
    const svg=market.glyph(marker,10,20);
    assert.ok(svg.includes('role="button"')&&svg.includes('tabindex="0"')&&svg.includes('aria-label="'+escapeText([event.area,event.type,event.signal].join(' · '))+'"'));
    assert.ok(!svg.includes('<text '),'only the current selection gets a map caption');
    assert.ok(market.card(event.key).includes('data-explore-market="'+event.key+'"'));
  }
  const active=market.markers('产业迁移','dachong').at(-1);
  assert.ok(active.selected);assert.equal(active.id,'dachong');
  assert.match(market.glyph(active,0,0),/<text[^>]*>科兴<\/text>/);
  assert.equal(market.glyph(active,NaN,0),'');
});

test('migration arrows use the documented direction and never point at a filtered-out market marker',()=>{
  const all=market.connections('','产业迁移');
  assert.deepEqual(Array.from(all,c=>c.fromId+' → '+c.toId),['dachong → island','houhai → guiwan']);
  for(const {fromId,toId} of all){
    for(const key of [fromId,toId]){
      const result=market.connections(key);
      assert.equal(result.length,1);
      assert.equal(result[0].from,market.get(fromId).xy);
      assert.equal(result[0].to,market.get(toId).xy);
      const other=key===fromId?toId:fromId;
      assert.ok(market.card(key).includes('data-market-event="'+other+'"'));
    }
  }
  assert.equal(market.connections('liuxian').length,0);
  assert.equal(market.connections('dachong','议价样本').length,0);
  assert.equal(market.connections('','住房供应').length,0);
});

test('event facts, rental judgment, source and verification remain accessible without moving to another map',()=>{
  for(const event of base.events){
    const card=market.card(event.key);
    for(const field of ['title','fact','view','test','date','signal'])assert.ok(card.includes(escapeText(event[field])),event.key+' '+field);
    for(const [label,url] of event.ref){
      assert.ok(card.includes(escapeText(label)));
      assert.ok(card.includes('href="'+escapeText(url)+'"'));
    }
    assert.ok(card.includes('data-market-event=""'));
  }
  assert.equal(market.card('unknown'),'');
  const event={...base.events[0],fact:'<b>sample</b>',ref:[['bad','javascript:alert(1)']],xy:null};
  const sample=make({events:[event]},escapeText);
  assert.equal(sample.markers().length,0);
  assert.match(sample.card(event.key),/&lt;b&gt;sample&lt;\/b&gt;/);
  assert.ok(!sample.card(event.key).includes('javascript:'));
});
