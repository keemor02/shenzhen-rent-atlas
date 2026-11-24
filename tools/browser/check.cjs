/* Run in a temporary browser profile against the built offline file. */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const {chromium} = require('playwright');
const pageURL='https://atlas.test/';
const packed=fs.readFileSync(path.join(__dirname,'..','..','index.html'));
async function gestureChecks(page,context,selector,small){
  const map=page.locator(selector),group=map.locator('.map-geography');
  const transform=()=>group.evaluate(g=>{const m=g.transform.baseVal.getItem(0).matrix,s=g.transform.baseVal.getItem(1).matrix;return [m.e,m.f,s.a];});
  await map.scrollIntoViewIfNeeded();
  const box=await map.boundingBox(), x=Math.round(box.width*.46), y=Math.round(box.height*.52), client={x:box.x+x,y:box.y+y};
  const before=await transform(), heading=await page.locator('#probe h2').textContent();
  const waitScale=old=>page.waitForFunction(([sel,k])=>Math.abs(document.querySelector(sel+' .map-geography').transform.baseVal.getItem(1).matrix.a-k)>.005,[selector,old]);
  if(small){
    const session=await context.newCDPSession(page);
    const touch=(type,span)=>session.send('Input.dispatchTouchEvent',{type,touchPoints:span?[{x:client.x-span,y:client.y,id:1},{x:client.x+span,y:client.y,id:2}]:[]});
    await touch('touchStart',24);await touch('touchMove',39);await touch('touchMove',52);await touch('touchEnd');
    await session.detach();
  }else{
    await page.mouse.move(client.x,client.y);await page.mouse.wheel(0,-180);
  }
  await waitScale(before[2]);
  const after=await transform();assert.ok(after[2]>before[2]);
  assert.ok(Math.abs((x-before[0])/before[2]-(x-after[0])/after[2])<1,'zoom anchor x');
  assert.ok(Math.abs((y-before[1])/before[2]-(y-after[1])/after[2])<1,'zoom anchor y');
  await page.mouse.move(client.x,client.y);await page.mouse.down();await page.mouse.move(client.x+45,client.y+24,{steps:4});await page.mouse.up();
  await page.waitForFunction(([sel,old])=>Math.abs(document.querySelector(sel+' .map-geography').transform.baseVal.getItem(0).matrix.e-old)>20,[selector,after[0]]);
  assert.equal(await page.locator('#probe h2').textContent(),heading,'pan or pinch accidentally selected a place');
  const zoom=map.locator('..').locator('[data-zoom]');
  await zoom.first().click();await waitScale(after[2]);
  await map.focus();const z=await transform();await map.press('-');await waitScale(z[2]);
  await zoom.last().click();
  await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
}
const frame = page => page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
const street = (page,short) => page.locator('#orbit .map-block[aria-label^="'+short+'街道"]');
const district = (page,name) => page.locator('#orbit [data-district="'+name+'"]');
const camera = page => page.locator('#orbit .map-geography').evaluate(g=>{
  const shift=g.transform.baseVal.getItem(0).matrix, scale=g.transform.baseVal.getItem(1).matrix;
  return [shift.e,shift.f,scale.a];
});
async function assertSameCamera(page,before) {
  const now=await camera(page);
  assert.ok(Math.abs(now[0]-before[0])<0.02 && Math.abs(now[1]-before[1])<0.02 &&
    Math.abs(now[2]-before[2])<0.00001,'map camera moved after switching a display control');
}
const scale = page => page.locator('#orbit .map-geography').evaluate(g=>g.transform.baseVal.getItem(1).matrix.a);
const heading = page => page.locator('#probe h2').innerText();
const panel = page => page.locator('#probe').innerText();

async function zoom(page, direction) {
  await page.locator('#game-zoom [data-zoom="'+direction+'"]').click();
  await frame(page);
}
async function topic(page, name) {
  const button=page.locator('#map-topics [data-topic="'+name+'"]');
  await button.click();
  assert.equal(await button.getAttribute('aria-pressed'),'true',name);
  await frame(page);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'horizontal overflow on '+name);
}
async function clickGeometry(page, loc) {
  await page.locator('#orbit').scrollIntoViewIfNeeded();
  const hit = await loc.evaluate(el=>{
    const b=el.getBoundingClientRect(), map=el.ownerSVGElement.getBoundingClientRect();
    const left=Math.max(0,b.left,map.left),right=Math.min(innerWidth,b.right,map.right);
    const top=Math.max(0,b.top,map.top),bottom=Math.min(innerHeight,b.bottom,map.bottom);
    if (right<=left || bottom<=top) return null;
    const fractions=[.5,.4,.6,.3,.7,.2,.8,.1,.9,.05,.95];
    for(const v of fractions)for(const u of fractions){
      const x=left+(right-left)*u,y=top+(bottom-top)*v,actual=document.elementFromPoint(x,y);
      if(actual && el.contains(actual))return {x,y};
    }
    return null;
  });
  assert.ok(hit,'visible, clickable interior of '+await loc.getAttribute('aria-label'));
  await page.mouse.click(hit.x,hit.y);
}
async function chooseCandidate(page, id) {
  const pick=page.locator('#probe [data-pick="'+id+'"]');
  if(!await pick.isVisible()) {
    const ancestors=pick.locator('xpath=ancestor::details[not(@open)]/summary');
    while(await ancestors.count())await ancestors.first().click();
  }
  await pick.click();
}
async function initialSurface(page) {
  const ids=['rent','districtRent','density','market','commute','convenience','environment','fit'];
  assert.equal(await page.locator('#map-topics [data-topic]').count(),ids.length);
  for (const id of ids) {
    const button=page.locator('#map-topics [data-topic="'+id+'"]');
    assert.ok(await button.isVisible(),id);
    assert.ok(await button.evaluate(el=>{
      const box=el.getBoundingClientRect();
      return box.left>=-1 && box.right<=innerWidth+1 && !el.closest('details:not([open])');
    }),'topic requires a drawer or horizontal scrolling: '+id);
  }
  const retired=['#open-compare','#compare-tray','#reference-nav','#reference-return','#conditions',
    '#journal','#fine','#district-page','[data-observe]','#area-page','#levels [data-level="journal"]'];
  for(const selector of retired)assert.equal(await page.locator(selector+':visible').count(),0,selector);
  const paths=page.locator('#orbit .map-block');
  assert.equal(await paths.count(),74);
  const fills=new Set(await paths.evaluateAll(ps=>ps.map(p=>p.getAttribute('fill'))));
  assert.ok(fills.size>=4 && [...fills].some(f=>f.startsWith('url')));
  await page.locator('#room').selectOption('2');await page.locator('#room').selectOption('1');
}

async function westernNeighborhoods(page, small) {
  const map=page.locator('#orbit'), legend=page.locator('#event-legend'), key=page.locator('#west-key');
  const homes=await page.locator('#fine-data').evaluate(el=>JSON.parse(el.textContent).hoods.filter(h=>h.footprint).map(h=>h.id));
  assert.equal(homes.length,17);
  assert.equal(await legend.locator('button').count(),6);
  assert.equal(new Set(await map.locator('[data-ev]').evaluateAll(els=>els.map(el=>el.dataset.eventType))).size,6);
  await legend.locator('[data-event-filter="flight"]').click();
  assert.equal(await map.locator('[data-ev]').count(),1);
  assert.match(await map.locator('[data-ev]').getAttribute('aria-label'),/航空噪声/);
  await legend.locator('[data-event-filter="flight"]').click();
  assert.equal(await map.locator('.residential-area').count(),0);
  await clickGeometry(page,street(page,'西乡'));
  assert.equal(await heading(page),'西乡街道');
  assert.equal(await street(page,'西乡').evaluate(el=>getComputedStyle(el).outlineStyle),'none');
  await street(page,'西乡').press('Enter');
  assert.deepEqual(await street(page,'西乡').evaluate(el=>[
    el.matches(':focus-visible'),getComputedStyle(el).vectorEffect,getComputedStyle(el).strokeWidth
  ]),[true,'non-scaling-stroke','3px']);
  assert.deepEqual((await page.locator('#probe [data-zone]').allTextContents()).sort(),['固戍','坪洲','西乡']);
  for(let i=0;i<10 && await scale(page)>=8;i++)await zoom(page,'out');
  for(let i=0;i<10 && await scale(page)<2.4;i++)await zoom(page,'in');
  assert.equal(await key.getAttribute('data-detail'),'zones');
  assert.equal(await map.locator('.residential-area').count(),0);
  const rendered=new Set();
  for (const zone of ['西乡','固戍','坪洲']) {
    await street(page,'西乡').press('Enter');
    await page.locator('#probe [data-zone="zone-'+zone+'"]').click();
    assert.equal(await heading(page),zone+'片区');
    for(let i=0;i<10 && await scale(page)>=12;i++)await zoom(page,'out');
    for(let i=0;i<10 && await scale(page)<8;i++)await zoom(page,'in');
    assert.equal(await key.getAttribute('data-detail'),'homes');
    for(const id of await map.locator('.residential-area').evaluateAll(els=>els.map(el=>el.dataset.hood)))rendered.add(id);
    assert.ok(await map.locator('.area-name').count()<=(small?3:6));
  }
  assert.deepEqual([...rendered].sort(),homes.sort(),'all 17 local footprints are reachable');
  assert.ok(await map.locator('.residential-area.village').count()>0);
  assert.ok(await map.locator('.residential-area.estate').count()>0);
  await clickGeometry(page,map.locator('.residential-area[data-hood="west-mabu"]'));
  assert.equal(await heading(page),'麻布新村');
  assert.match(await panel(page),/城中村/);
  assert.match(await panel(page),/月租待核|缺.*(?:月租|租金)|暂无.*(?:月租|租金)/);
  await page.reload();
  assert.equal(await map.locator('.residential-area[data-hood="west-mabu"]').getAttribute('aria-pressed'),'true');
  await page.locator('#map-crumbs [data-area-up="city"]').click();
  assert.equal(await map.locator('.residential-area').count(),0);
}

async function drivingAndBudget(page) {
  await page.locator('.quick-dests [data-work="留仙洞"]').click();
  await page.locator('[data-mode="drive"]').click();
  await page.locator('#budget').fill('10000');await page.locator('#budget').press('Tab');
  await page.locator('#time-limit').press('End');
  assert.equal(await page.locator('#limit-value').innerText(),'90 分钟');
  assert.equal(await street(page,'桃源').getAttribute('data-state'),'missing');
  await street(page,'西丽').press('Enter');
  await chooseCandidate(page,'node-高新北');
  assert.equal(await heading(page),'高新北站周边');
  assert.match(await panel(page),/缺同户型月租/);
  assert.match(await panel(page),/17 分钟/);
  assert.equal(await page.locator('#result-list [data-pick="node-高新北"]').count(),0);
  const view=await camera(page);
  await topic(page,'commute');
  await assertSameCamera(page,view);
  assert.equal(await street(page,'桃源').getAttribute('data-state'),'partial');
  assert.ok(!(await street(page,'桃源').getAttribute('fill')).startsWith('url'));
  assert.match(await page.locator('#stage-key').innerText(),/住房条件待核/);
  await page.locator('[data-layout="radial"]').click();
  await page.locator('#event-legend [data-event-filter="works"]').click();
  assert.equal(await page.locator('#orbit [data-ev="works-fengyan"]').getAttribute('data-event-type'),'works');
  await page.locator('#event-legend [data-event-filter="works"]').click();
  await page.locator('[data-layout="geo"]').click();
  await page.locator('#map-crumbs [data-area-up="city"]').click();
}

async function districtThemes(page) {
  const kind=k=>page.locator('#topic-options [data-rent-kind="'+k+'"]');
  const metric=k=>page.locator('#topic-options [data-rent-metric="'+k+'"]');
  const address=page.locator('#dest-input'), map=page.locator('#orbit');
  const view=await camera(page);
  await topic(page,'density');await assertSameCamera(page,view);
  assert.equal(await map.locator('[data-district]').count(),10);
  await clickGeometry(page,district(page,'南山区'));
  assert.equal(await heading(page),'南山区');
  assert.match(await panel(page),/9,970/);
  assert.match(await panel(page),/186\.97/);assert.match(await panel(page),/187\.53/);
  assert.ok(await page.locator('#probe a[href^="https://"]').count()>=2);
  const selectedView=await camera(page);
  await topic(page,'districtRent');await assertSameCamera(page,selectedView);
  assert.equal(await address.inputValue(),'留仙洞');
  assert.equal(await page.locator('#topic-options [data-rent-kind]:visible').count(),7);
  await kind('community').click();await metric('yoy').click();
  assert.match(await panel(page),/\+0\.14%/);
  assert.match(await district(page,'大鹏新区').getAttribute('fill'),/^url\(/);
  await metric('mom').click();assert.match(await panel(page),/\+0\.38%/);
  await metric('price').click();assert.match(await panel(page),/118/);
  for(const [id,value] of [['apt','约 164'],['village','60–103'],['all','110.16'],['ref0','109'],['ref1','154'],['ref2','65']]) {
    await kind(id).click();
    assert.ok((await panel(page)).includes(value),id+' '+value);
    assert.equal(await heading(page),'南山区');
    await assertSameCamera(page,selectedView);
  }
  assert.match(await panel(page),/2022年度/);
  assert.equal(await metric('yoy').count(),0);
  await page.locator('#probe [data-find-district="南山区"]').click();
  assert.equal(await page.locator('#map-topics [data-topic="rent"]').getAttribute('aria-pressed'),'true');
  assert.equal(await address.inputValue(),'留仙洞');
  assert.match(await page.locator('#scope-chip').innerText(),/南山/);
  assert.ok(await page.locator('#result-list [data-pick]').count()>0);
  await page.locator('#discover').click();assert.match(await panel(page),/南山区/);
  await page.locator('#scope-chip').click();
}
async function marketEvidence(page) {
  const map=page.locator('#orbit');
  await topic(page,'market');
  await zoom(page,'reset');
  const migrate=page.locator('[data-market-filter="产业迁移"]');
  await migrate.click();
  const tags=await map.locator('[data-market-event]').evaluateAll(tags=>tags.map(el=>el.getAttribute('aria-label')));
  assert.ok(tags.length>=2 && tags.every(tag=>tag.includes('产业迁移')));
  await clickGeometry(page,map.locator('[data-market-event="dachong"]'));
  assert.match(await heading(page),/大冲.*科兴/);
  assert.match(await panel(page),/议价样本/);
  assert.match(await panel(page),/腾讯/);
  assert.ok(await page.locator('#probe a[href^="https://"]').count()>0);
  await page.locator('#probe [data-market-event="island"]').click();
  assert.match(await heading(page),/企鹅岛/);
  await page.locator('[data-market-filter="议价样本"]').click();
  await zoom(page,'reset');
  const signals=await map.locator('[data-market-event]').evaluateAll(tags=>tags.map(el=>el.getAttribute('aria-label')));
  assert.ok(signals.length>0 && signals.every(tag=>tag.includes('议价样本')));
  await map.locator('[data-market-event="dachong"]').press('Enter');
  await page.locator('#probe [data-explore-market="dachong"]').click();
  assert.equal(await page.locator('#map-topics [data-topic="rent"]').getAttribute('aria-pressed'),'true');
  assert.match(await panel(page),/大冲|科兴|高新园/);
  assert.equal(await page.locator('#dest-input').inputValue(),'留仙洞');
}
async function localFacilities(page) {
  const items=await page.locator('#facilities-data').evaluate(el=>JSON.parse(el.textContent).facilities);
  assert.ok(items.length>0,'a local facility pilot is embedded in the offline map');
  await topic(page,'convenience');
  const item=items.find(row=>row.category!=='park') || items[0];
  await page.locator('#topic-options [data-facility-category="'+item.category+'"]').click();
  const block=page.locator('#orbit .map-block[data-block="'+item.streetId+'"]');
  await block.press('Enter');
  assert.equal(await block.getAttribute('data-state'),'known');
  assert.ok(await page.locator('#probe').getByText(item.name,{exact:true}).first().isVisible());
  assert.ok((await page.locator('#probe a').evaluateAll(links=>links.map(a=>a.getAttribute('href')))).includes(item.source));
  assert.match(await page.locator('#stage-key').innerText(),/已核实设施/);
  await topic(page,'environment');
  const park=items.find(row=>row.category==='park');
  if(park) {
    await page.locator('#orbit .map-block[data-block="'+park.streetId+'"]').press('Enter');
    assert.ok(await page.locator('#probe').getByText(park.name,{exact:true}).first().isVisible());
    assert.match(await page.locator('#stage-key').innerText(),/公园/);
  }
  await page.locator('#map-crumbs [data-area-up="city"]').click();
}
async function discoveryAndFavorites(page) {
  await topic(page,'fit');await topic(page,'rent');
  await page.locator('#budget').fill('1');await page.locator('#budget').press('Tab');
  assert.equal(await page.locator('#result-list [data-pick]').count(),0);
  await page.locator('#budget').fill('3500');await page.locator('#budget').press('Tab');
  for(const mode of ['bus','rail','drive']){
    await page.locator('[data-mode="'+mode+'"]').click();
    assert.ok(await page.locator('#result-list [data-pick]').count()>0,mode);
  }
  await page.locator('#discover').click();
  const name=await heading(page), bookmark=page.locator('#probe [data-bookmark]');
  await bookmark.click();
  await page.reload();
  assert.equal(await heading(page),name);
  assert.match(await page.locator('#probe [data-bookmark]').innerText(),/已收藏|取消收藏/);
  await page.locator('#only-saved').check();
  assert.equal(await page.locator('#result-list [data-pick]').count(),1);
  assert.ok((await page.locator('#result-list').textContent()).includes(name));
  const text=await panel(page);
  assert.doesNotMatch(text,/已知项均合意|项有依据|记录环境|加入对比|查看片区资料|租金与周边资料/);
}

async function areaAnnotations(page) {
  await page.locator('#map-crumbs [data-area-up="city"]').click();
  await topic(page,'rent');
  const rate=page.locator('#topic-options [data-local-metric="yoy"]');
  await rate.click();
  const map=page.locator('#orbit'), detail=page.locator('#probe');
  assert.equal(await map.locator('[data-area-insight]').count(),0,'zoomed-out urban overview');
  await street(page,'西丽').press('Enter');
  const tag=map.locator('[data-area-insight="street"][data-area-id="440305009000"]');
  await tag.waitFor();
  const info=await tag.getAttribute('aria-label');
  assert.match(info,/同比/);assert.match(info,/事件/);assert.match(info,/政策/);
  const viewport=await camera(page);
  await tag.locator('[data-insight-part="policies"] rect').first().click();
  assert.ok(await detail.locator('[data-insight-section="policies"]').isVisible());
  assert.match(await detail.innerText(),/创智云城4栋AB座/);
  assert.match(await detail.innerText(),/其他适用政策/);
  await assertSameCamera(page,viewport);
  await detail.locator('[data-insight-tab="events"]').click();
  assert.ok(await detail.locator('[data-insight-section="events"]').isVisible());
  await detail.locator('[data-market-event="liuxian"]').click();
  assert.equal(await page.locator('#map-topics [data-topic="market"]').getAttribute('aria-pressed'),'true');
  await detail.locator('[data-insight-return]').click();
  assert.ok(await detail.locator('[data-insight-section="events"]').isVisible());
  await assertSameCamera(page,viewport);
  await detail.locator('[data-insight-close]').click();
  await tag.press('Enter');
  assert.ok(await detail.locator('[data-insight-section="outlook"]').isVisible());
  await detail.locator('[data-insight-close]').click();
  const observed=await detail.locator('.block-stat').first().innerText();
  assert.match(observed,/同比.*%/);
  await page.locator('#topic-options [data-local-metric="mom"]').click();
  assert.ok(await detail.getByText(/环比/).count()>0);
  await page.locator('#topic-options [data-local-metric="price"]').click();
  await page.locator('#map-crumbs [data-area-up="city"]').click();
}
async function cachedZeroGrowth(page) {
  // The public cache is seeded only in this temporary browser profile.
  await page.evaluate(()=>{
    const base=JSON.parse(document.querySelector('.szdata').textContent);
    const url=base.apartment.listing.sources.at(-1), month=url.match(/(\d{4}-\d{2})\.html$/)[1];
    const prior=(Number(month.slice(0,4))-1)+month.slice(4);
    const rows=Object.fromEntries(base.districts.filter(d=>d.oct2026>0).map(d=>[d.n,{price:d.oct2026,prior:d.oct2026,yoy:0}]));
    localStorage.clear();
    localStorage.setItem('sz-rent-public-feeds-v2',JSON.stringify({districts:{
      month,prior,url,rows,checkedAt:month+'-15T00:00:00+08:00'
    },markets:{}}));
  });
  await page.reload();await topic(page,'districtRent');
  await page.locator('[data-rent-kind="all"]').click();
  await page.locator('[data-rent-metric="yoy"]').click();
  await clickGeometry(page,district(page,'南山区'));
  assert.match(await panel(page),/0\.00%/);
  assert.doesNotMatch(await district(page,'南山区').getAttribute('fill'),/^url\(/);
  assert.match(await district(page,'大鹏新区').getAttribute('fill'),/^url\(/);
}
async function check(browser,viewport) {
  const small=viewport.width<700, context=await browser.newContext({viewport,hasTouch:small});
  await context.route('**/*',route=>route.request().url()===pageURL
    ? route.fulfill({body:packed,contentType:'text/html; charset=utf-8'}) : route.abort());
  const page=await context.newPage(), errors=[];
  page.setDefaultTimeout(6000);
  page.on('pageerror',error=>errors.push(error.message));
  try {
    await page.goto(pageURL);await page.locator('#probe h2').waitFor();
    await initialSurface(page);
    await gestureChecks(page,context,'#orbit',small);
    await westernNeighborhoods(page,small);
    await drivingAndBudget(page);
    await districtThemes(page);
    await marketEvidence(page);
    await localFacilities(page);
    await discoveryAndFavorites(page);
    await areaAnnotations(page);
    await cachedZeroGrowth(page);
    assert.deepEqual(errors,[]);
    console.log('OK',viewport.width+'×'+viewport.height,'地图图层、片区、筛选和收藏');
  } catch (error) {
    console.error('viewport',viewport.width,'browser errors:',errors);
    throw error;
  } finally {await context.close();}
}
(async()=>{
  const launchOptions={headless:true};
  if(process.env.ATLAS_CHROMIUM_PATH) launchOptions.executablePath=process.env.ATLAS_CHROMIUM_PATH;
  const browser=await chromium.launch(launchOptions);
  try {
    await check(browser,{width:1280,height:860});
    await check(browser,{width:390,height:844});
  } finally {await browser.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
