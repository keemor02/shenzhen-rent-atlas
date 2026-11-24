'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {JSDOM,VirtualConsole}=require('jsdom');
const root=path.resolve(__dirname,'..','..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const sessionKey='shenzhen-rent-atlas.exploration.v1';
const journalKey='shenzhen-rent-atlas.journal.v1';

function dom(saved={},page=html,now=null) {
  const errors=[],console=new VirtualConsole();
  console.on('jsdomError',e=>{if(!/parse CSS stylesheet/i.test(e.message))errors.push(e.detail?.stack||e.message);});
  const app=new JSDOM(page,{url:'https://atlas-test.invalid/',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:console,beforeParse(w){
    if(now!==null){
      const DateClass=w.Date;
      w.Date=class extends DateClass { constructor(...args){super(...(args.length?args:[now]));} static now(){return now;} };
    }
    for(const [key,value] of Object.entries(saved))w.localStorage.setItem(key,value);
    w.ResizeObserver=class{observe(){}};
    w.matchMedia=()=>({matches:false});w.HTMLElement.prototype.scrollIntoView=()=>{};
    w.CSS={escape:s=>s};w.URL.createObjectURL=()=> 'blob:offline-test';w.URL.revokeObjectURL=()=>{};
  }});
  const w=app.window,doc=w.document;
  const q=selector=>{const el=doc.querySelector(selector);assert.ok(el,selector+' '+errors.join('\n').slice(0,400));return el;};
  const all=selector=>[...doc.querySelectorAll(selector)];
  const text=selector=>q(selector).textContent;
  const click=selector=>q(selector).dispatchEvent(new w.MouseEvent('click',{bubbles:true,cancelable:true}));
  const change=(selector,value)=>{
    const el=q(selector);
    if(el.type==='checkbox')el.checked=value;else el.value=value;
    el.dispatchEvent(new w.Event('change',{bubbles:true}));
  };
  const topic=()=>q('#map-topics [aria-pressed=true]').dataset.topic;
  const data=selector=>JSON.parse(text(selector));
  const snapshot=()=>Object.fromEntries(Object.entries(w.localStorage));
  const close=()=>{w.close();assert.deepEqual(errors,[]);};
  return {w,doc,q,all,text,click,change,topic,data,snapshot,close};
}
const selector=(attr,value)=>'['+attr+'="'+value+'"]';
const oldEntry={id:'nsguanlong',name:'官龙村 · 官龙名苑',saved:true,chosen:true,manual:false,
  environment:4,convenience:null,note:'旧版保存的现场记录',observed:'2026-11-20',updatedAt:'2026-11-20T00:00:00Z'};
const legacy={
  [sessionKey]:JSON.stringify({dest:'留仙洞',mode:'drive',layout:'geo',layer:'rent',selected:oldEntry.id,
    fields:{budget:'2800',room:'1','time-limit':'55',access:'5',egress:'5'},
    seen:[oldEntry.id],compared:[oldEntry.id],weights:{rent:3},allFit:true,onlySaved:true}),
  [journalKey]:JSON.stringify({format:'shenzhen-rent-journal',version:1,chosenId:oldEntry.id,entries:[oldEntry]})
};

function checkMigrationAndDiscovery(){
  let app=dom(legacy);
  assert.equal(app.topic(),'rent');
  assert.equal(app.q('#dest-input').value,'留仙洞');
  assert.equal(app.q('#budget').value,'2800');
  assert.equal(app.q('#time-limit').value,'55');
  assert.equal(app.q('[data-mode="drive"]').getAttribute('aria-pressed'),'true');
  assert.equal(app.q('#only-saved').checked,true);
  assert.match(app.text('#probe h2'),/官龙/);
  assert.equal(app.q('#probe [data-bookmark]').getAttribute('aria-pressed'),'true');
  assert.deepEqual(app.all('#result-list [data-pick]').map(b=>b.dataset.pick),[oldEntry.id]);
  assert.equal(app.doc.querySelector('#open-compare,#compare-tray,#reference-nav,#conditions,#journal,#fit-weights,#all-fit'),null);
  assert.doesNotMatch(app.text('#probe'),/加入对比|已知项均合意|项有依据|记录环境|租金与周边资料|返回街道/);
  app.click('#probe [data-bookmark]');
  const after=JSON.parse(app.snapshot()[journalKey]);
  assert.equal(after.chosenId,oldEntry.id);
  const entry=after.entries.find(x=>x.id===oldEntry.id);
  assert.deepEqual([entry.saved,entry.note,entry.environment,entry.observed],[false,oldEntry.note,4,oldEntry.observed]);
  assert.equal(app.all('#result-list [data-pick]').length,0);
  app.change('#only-saved',false);
  assert.ok(app.all('#result-list [data-pick]').length>1);
  app.click('#discover');
  const discovered=app.q('#probe [data-bookmark]').dataset.bookmark;
  assert.notEqual(discovered,oldEntry.id);
  assert.match(app.text('#probe .fit-heading'),/适配/);
  assert.match(app.text('#probe .fit-reason'),/预算低|上限短/);
  app.click('#probe [data-bookmark]');
  assert.equal(app.q('#probe [data-bookmark]').getAttribute('aria-pressed'),'true');
  app.click('[data-topic="commute"]');
  const saved=app.snapshot();app.close();app=dom(saved);
  assert.equal(app.topic(),'commute');
  assert.equal(app.q('#probe [data-bookmark]').dataset.bookmark,discovered);
  assert.equal(app.q('#probe [data-bookmark]').getAttribute('aria-pressed'),'true');
  assert.equal(app.q('#budget').value,'2800');
  app.change('#only-saved',true);
  assert.deepEqual(app.all('#result-list [data-pick]').map(b=>b.dataset.pick),[discovered]);
  app.click('#probe [data-bookmark]');
  assert.equal(app.all('#result-list [data-pick]').length,0);
  app.close();
  const empty=dom({[sessionKey]:legacy[sessionKey]});
  assert.equal(empty.q('#only-saved').checked,false);
  empty.close();
}

function checkDistrictAndEvents(){
  let app=dom();
  const layers=['rent','districtRent','density','market','commute','fit','environment','convenience'].sort();
  assert.deepEqual(app.all('#map-topics [data-topic]').map(b=>b.dataset.topic).sort(),layers);
  const map=app.q('#orbit');
  app.click('[data-topic="density"]');
  const base=app.data('.szdata');
  assert.equal(app.all('#orbit [data-district]').length,base.districts.length);
  const district=base.districts.find(r=>r.n==='南山区');
  const shape='#orbit '+selector('data-district',district.n);
  app.click(shape);
  assert.match(app.text('#probe h2'),/南山/);
  assert.ok(app.text('#probe').includes(district.density.toLocaleString('zh-CN')));
  assert.match(app.text('#probe'),/常住人口|陆域面积/);
  app.click('[data-topic="districtRent"]');
  assert.equal(app.all('#topic-options [data-rent-kind]').length,7);
  app.click('[data-rent-kind="community"]');
  app.click('[data-rent-metric="yoy"]');
  app.click(shape);
  const source=base.apartment.currentCommunity.by_district[district.n];
  assert.ok(app.text('#probe').includes(Math.abs(source.yoy_pct).toFixed(2)+'%'));
  assert.equal(app.q('#orbit'),map);
  const saved=app.snapshot();app.close();app=dom(saved);
  assert.equal(app.topic(),'districtRent');assert.match(app.text('#probe h2'),/南山/);
  assert.equal(app.q('[data-rent-metric="yoy"]').getAttribute('aria-pressed'),'true');
  app.click('[data-rent-kind="apt"]');
  assert.equal(app.doc.querySelector('[data-rent-metric=yoy]:not(:disabled)'),null);
  assert.match(app.text('#topic-options')+app.text('#probe'),/估读/);
  app.click('[data-rent-kind="ref2"]');assert.match(app.text('#topic-options')+app.text('#probe'),/2022/);
  app.click('[data-topic="market"]');app.click('[data-market-filter="产业迁移"]');
  app.click('[data-market-event="dachong"]');
  assert.match(app.text('#probe h2'),/科兴/);
  assert.ok(app.all('#probe a[href^="https:"]').length);
  assert.ok(app.q('#probe [data-explore-market="dachong"]'));
  app.click('#probe [data-explore-market="dachong"]');
  assert.equal(app.topic(),'rent');
  assert.match(app.text('#probe h2'),/大冲|粤海|高新/);
  app.close();
}

function checkCachedDistrictReport(){
  const read=dom(),base=read.data('.szdata');read.close();
  const url=base.apartment.listing.sources.at(-1),month=url.match(/(20\d\d-\d\d)\.html$/)[1];
  const prior=(Number(month.slice(0,4))-1)+month.slice(4);
  const rows=Object.fromEntries(base.districts.slice(0,5).map((d,i)=>[d.n,{price:215.5+i,prior:200}]));
  const checkedAt=month+'-25T12:00:00+08:00';
  const cached={districts:{month,prior,url,rows,checkedAt},markets:{}};
  const app=dom({'sz-rent-public-feeds-v2':JSON.stringify(cached)},html,Date.parse(checkedAt));
  app.click('[data-topic="districtRent"]');app.click('[data-rent-kind="all"]');
  app.click('[data-rent-metric="price"]');app.click('#orbit [data-district="南山区"]');
  assert.match(app.text('#probe .block-stat'),/217\.5/);
  app.click('[data-rent-metric="yoy"]');
  assert.match(app.text('#probe .block-stat'),/\+8\.75%/);
  assert.ok(app.all('#probe a').some(a=>a.getAttribute('href')===url));
  app.close();
}

function checkFacilityEvidence(){
  const read=dom(),snapshot=read.data('#facilities-data'),fine=read.data('#fine-data');read.close();
  const hoods=new Map(fine.hoods.map(h=>[h.id,h]));
  const row=snapshot.facilities.find(f=>f.hoodIds?.some(id=>hoods.has(id)))||
    snapshot.facilities.find(f=>fine.hoods.some(h=>h.street===f.streetId));
  assert.ok(row,'No verified facility linked to a mapped area');
  const hood=hoods.get(row.hoodIds?.find(id=>hoods.has(id)))||fine.hoods.find(h=>h.street===row.streetId);
  const state={[sessionKey]:JSON.stringify({dest:'留仙洞',mode:'drive',selected:hood.id,layer:'rent',
    fields:{budget:'10000',room:'1','time-limit':'90'}})};
  const empty=html.replace(/(<script type="application\/json" id="facilities-data">)[\s\S]*?(<\/script>)/,
    '$1'+JSON.stringify({...snapshot,facilities:[]})+'$2');
  assert.notEqual(empty,html);
  const before=dom(state,empty),score=before.text('#probe .fit-heading');before.close();
  const app=dom(state);
  assert.equal(app.q('#probe [data-bookmark]').dataset.bookmark,hood.id);
  assert.equal(app.text('#probe .fit-heading'),score,'public coverage entered the personal rating');
  assert.match(app.text('#probe .fit-grid'),/片区|街道/);
  app.click('[data-topic="convenience"]');
  assert.match(app.text('#stage-key'),/设施/);
  const street='#orbit '+selector('data-block',row.streetId);
  app.click(street);
  assert.ok(app.text('#probe').includes(row.name));
  assert.ok(app.all('#probe a').some(a=>a.getAttribute('href')===row.source));
  app.click('[data-topic="environment"]');
  assert.match(app.text('#stage-key'),/公园/);
  app.close();
}
checkMigrationAndDiscovery();
checkDistrictAndEvents();
checkCachedDistrictReport();
checkFacilityEvidence();
console.log('已验证旧收藏与进度迁移、发现、区级指标与选择恢复、事件接入、设施证据与个人评分。');
