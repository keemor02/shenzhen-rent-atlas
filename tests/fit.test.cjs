'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'), path=require('node:path'), vm=require('node:vm');
const ctx=vm.createContext({window:{}});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/fit.js'),'utf8'),ctx);
const fit=ctx.window.RentalFit;
const opt={limit:50,budget:4000};
const weights={commute:1,rent:1,environment:1,convenience:1};
const home=(id,time,price,overrides={})=>({c:{id,name:id},route:{minutes:time},
  price:price?{price,unit:'单套整租挂牌',room:1,date:'2026-11-21'}:null,...overrides});
const score=(r,entry={},w=weights)=>({...r,fit:fit.assess(r,opt,entry,w)});

test('unknown evidence widens the interval while a negative visit can narrow it downwards',()=>{
  const r=home('甲',25,2000);
  const partial=fit.assess(r,opt,null,weights);
  assert.deepEqual([partial.low,partial.high,partial.count,partial.meets],[40,90,2,false]);
  const full=fit.assess(r,opt,{environment:1,convenience:5},weights);
  assert.deepEqual([full.low,full.high,full.count,full.meets],[65,65,4,false]);
  assert.ok(full.weak.includes('environment'));
  const okay=fit.assess(r,opt,{environment:4,convenience:4},weights);
  assert.equal(okay.meets,true);
  assert.equal(fit.assess(r,{...opt,budget:0},{},weights).dimensions.rent.score,null);
  assert.equal(fit.assess(r,opt,{environment:null},weights).dimensions.environment.score,null);
});
test('changing importance and future commute updates the same four-dimensional assessment',()=>{
  const r=home('甲',25,4000,{future:{minutes:60}});
  const f=fit.assess(r,{...opt,secondary:'另一站',secondMax:60},{environment:5,convenience:5},{...weights,rent:3});
  assert.equal(f.dimensions.commute.score,60);
  assert.equal(f.low,73);
  const noRoute=fit.assess({...r,future:null},{...opt,secondary:'另一站',secondMax:60},{},weights);
  assert.equal(noRoute.dimensions.commute.score,null);
});
test('discover explains improvements, respects the supplied eligible rows and exhausts unseen places',()=>{
  const a=score(home('甲',25,2000)), b=score(home('乙',15,3500)), c=score(home('丙',40,3500));
  assert.equal(fit.next([a,b,c],new Set([a.c.id]),a,weights).c.id,'乙');
  const deltas=fit.changes(b,a,weights);
  assert.ok(deltas.some(d=>d.text==='通勤少 10 分钟'&&d.better));
  assert.ok(deltas.some(d=>d.text==='租金样本高 1,500 元/月'&&!d.better));
  assert.equal(fit.next([a],new Set(),a,weights),undefined);
  assert.equal(fit.next([b],new Set(['乙']),a,weights),undefined);
  b.price.unit='商圈月租均价';
  assert.ok(!fit.changes(b,a,weights).some(d=>d.key==='rent'));
});

test('street colors use filtered raw quotes and journeys and preserve missing field ratings',()=>{
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/block-map.js'),'utf8'),ctx);
  const street={id:'S'}, make=(id,t,p,visit={})=>{
    const row=home(id,t,p,{c:{id,name:id,street}});
    return {...row,fit:fit.assess(row,{...opt,budget:0},visit,weights)};
  };
  const quick=make('近',20,3500),cheap=make('便宜',44,1800,{environment:2}),unknown=make('无报价',15,null);
  const group=[quick,cheap,unknown];
  assert.equal(ctx.atlasBlocks(group,'rent').get('S').best.c.id,'便宜');
  assert.equal(ctx.atlasBlocks(group,'commute').get('S').value,15);
  assert.equal(ctx.atlasBlocks([quick,unknown],'rent').get('S').value,3500);
  assert.equal(ctx.atlasBlocks(group,'environment').get('S').value,2);
  assert.equal(ctx.atlasBlocks(group,'convenience').get('S').value,null);
  assert.equal(ctx.atlasPaint('rent',null),null);
  assert.equal(ctx.atlasPaint('rent',1999),ctx.atlasPaint('environment',5));
  assert.notEqual(ctx.atlasPaint('rent',1999),ctx.atlasPaint('rent',2000));
  assert.equal(ctx.atlasBlocks([{...quick,c:{id:'归属待核'}}],'rent').size,0);
  const pending={...unknown,mapState:'pending',housingReason:'缺同户型月租样本'};
  const excluded={...cheap,mapState:'outside',exclusions:['当前通勤超过上限']};
  assert.equal(ctx.atlasSummary([pending,excluded],'rent').state,'missing');
  assert.equal(ctx.atlasSummary([excluded],'rent').state,'outside');
  const route=ctx.atlasSummary([pending,excluded],'commute');
  assert.equal(route.state,'partial');assert.equal(route.value,15);
  assert.equal(ctx.atlasSummary([pending,{...quick,route:{minutes:15}}],'commute').state,'known');
  assert.equal(ctx.atlasSummary([{...pending,route:null,mapState:'no-route'}],'commute').value,null);
});
