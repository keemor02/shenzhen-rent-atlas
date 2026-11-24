'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..');
const snapshot=JSON.parse(fs.readFileSync(path.join(root,'data/facilities.json'),'utf8'));
const fine=JSON.parse(fs.readFileSync(path.join(root,'data/fine.json'),'utf8'));
const factory=vm.runInNewContext(fs.readFileSync(path.join(root,'src/facilities.js'),'utf8')+'\nmakeFacilities');
const model=factory(snapshot,fine,s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'));

test('all displayed facilities retain a traceable source and a valid geographic association',()=>{
  const streets=new Map(fine.streets.map(s=>[s.id,s])),hoods=new Map(fine.hoods.map(h=>[h.id,h]));
  const all=model.records('convenience');
  assert.equal(all.length,snapshot.facilities.length);
  assert.ok(all.length>0);
  assert.equal(new Set(all.map(f=>f.id)).size,all.length);
  for(const f of all){
    assert.ok(streets.has(f.streetId),f.name);
    assert.ok(f.address&&f.sourceName,f.name);
    if(f.sourceAttachment)assert.ok(f.sourceLocator,f.name);
    assert.match(f.source,/^https?:\/\//);
    assert.match(f.checkedAt,/^\d{4}-\d{2}-\d{2}$/);
    for(const id of f.hoodIds)assert.equal(hoods.get(id)?.street,f.streetId);
  }
});

test('a facility verified only to street level never counts inside a specific housing block',()=>{
  const parent=snapshot.facilities.find(f=>!f.hoodIds.length),child=snapshot.facilities.find(f=>f.hoodIds.length);
  assert.ok(parent&&child);
  assert.ok(model.records('convenience','',{street:parent.streetId}).some(f=>f.id===parent.id));
  assert.ok(!fine.hoods.some(h=>model.records('convenience','',{hood:h.id}).some(f=>f.id===parent.id)));
  assert.ok(model.records('convenience','',{hood:child.hoodIds[0]}).some(f=>f.id===child.id));
  const parks=model.records('environment');
  assert.ok(parks.length>0&&parks.every(f=>f.category==='park'));
  assert.equal(model.measure([],'convenience').value,null);
  assert.equal(model.paint(0),null);
});
