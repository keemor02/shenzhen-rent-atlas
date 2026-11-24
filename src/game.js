function resolveDestinationName(value,nodes,aliases){
  const name=String(value??'').trim();
  if(!name)return '';
  const lookup=key=>nodes.has(key)?key:(Object.hasOwn(aliases,key)&&nodes.has(aliases[key])?aliases[key]:'');
  const stripped=name.replace(/(?:地铁站|站)$/u,'');
  const exact=lookup(name)||lookup(stripped);
  if(exact)return exact;
  if(stripped.length<2)return '';
  const matches=new Set();
  for(const [k,v] of Object.entries(aliases||{})){
    if(k.includes(stripped)&&nodes.has(v))matches.add(v);
  }
  const list=nodes instanceof Map?[...nodes.keys()]:[...nodes];
  for(const n of list){
    if(typeof n==='string'&&n.includes(stripped))matches.add(n);
  }
  return matches.size===1?[...matches][0]:'';
}
window.initGame=function({base,data,travel,timing,facilities,policies,liveDrive,focusMarket,districtFeed}){
  const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
  const esc=s=>String(s??'').replace(/[&<>"']/g,k=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[k]));
  const lnk=(url,label)=>/^https?:\/\//i.test(url||'')?'<a rel="noopener noreferrer" target="_blank" href="'+esc(url)+'">'+esc(label)+' ↗</a>':'';
  const model=makeExploreModel(base,data,travel,timing),draw=createOrbit($('#orbit'),base,data,model,timing,esc);
  const jobs=['留仙洞','兴东啤酒小镇','企鹅岛','前海金融峡谷','科兴科学园','岗厦北','坂田华为总部','大运','坪山围'];
  const shortcuts=['留仙洞','兴东啤酒小镇','企鹅岛'];
  const aliases={'留仙洞总部基地':'留仙洞','啤酒小镇':'兴东啤酒小镇','腾讯企鹅岛':'企鹅岛','腾讯岛':'企鹅岛','前海':'桂湾','深圳北':'深圳北站','科兴':'科兴科学园','华为总部':'坂田华为总部','大疆':'大疆天空之城'};
  const roomNames=['','一室','二室','三室','四室','五室'];
  const busPeriod=travel.bus.period;
  const shuttles=timing.shuttles||[];
  const transferSources=shuttles.map(s=>'<li>'+lnk(s.source,s.line+' · '+s.station)+'　候车 '+esc(s.wait)+' 分钟，乘车 '+esc(s.ride)+' 分钟（估算）。'+esc(s.window||s.inboundService||'请查询线路当日服务时段。')+(s.stopSource?' '+lnk(s.stopSource,'站牌'):'')+'</li>').join('');

  const themes=makeMapThemes(base,data,facilities,esc),topic=themes.state;
  if(districtFeed)themes.regional.update(districtFeed);
  const evidence=makeAreaInsights(base,data,policies,esc);
  const showingTrend=()=>topic.layer==='rent'&&topic.localMetric!=='price';
  const observed=(kind,id)=>evidence.measure(kind,id,topic.localMetric,$('#room').value);
  function trendMeasure(kind,id){
    const reading=observed(kind,id);
    return reading?{...reading,text:reading.label,state:'known'}:{value:null,label:'',text:'暂无同口径涨跌样本',state:'missing'};
  }
  let insightFocus=null,insightOrigin=null,facilityOrigin=null,microCamera=null,eventLegendOpen=false;
  const fit=window.RentalFit, fitView=makeFitView(esc);
  const sessionKey='shenzhen-rent-atlas.exploration.v1';
  const fieldIds=['budget','sqm','room','access','egress','corridor','second-dest','second-limit','time-limit'];
  let dest='',mode='rail',layout='geo',selected='',eventId='',eventsOn=true,showLedger=false,eventGroup='',seen=new Set(),allRows=[],rows=[],rowByStop=new Map(),mapEvents=[],openBands=new Set(),pendingId='',liveTicket=0;
  let scope=null, discoveryId='', message='', storageNotice='', lastSessionText='';
  const weights={commute:1,rent:1,environment:1,convenience:1};
  const candidateMap=new Map();
  const recordsById=new Map();
  const candidateZoneCache=new Map();
  let book, blockId='', blocks=new Map(), preview=[], listOpen=false, matrixOpen=false;
  let zoneId='',zoneBlocks=new Map();
  const zoneById=new Map((data.zones||[]).map(z=>[z.id,z]));
  const streetById=new Map(data.streets.map(s=>[s.id,s]));
  const nameFor=s=>resolveDestinationName(s,model.nodes,aliases);
  function saveSession(){
    const fields=Object.fromEntries(fieldIds.map(id=>[id,$('#'+id).value]));
    const serialized=JSON.stringify({fields,dest,mode,layout,selected,scope,
      seen:[...seen],blockId,zoneId,eventsOn,eventGroup,layer:topic.layer,theme:{...topic},onlySaved:$('#only-saved').checked,insight:insightFocus});
    if(serialized===lastSessionText)return;
    try {localStorage.setItem(sessionKey,serialized);lastSessionText=serialized;storageNotice='';}
    catch {storageNotice='浏览器暂时无法保存本次探索进度。';}
  }
  function restoreSession(){
    let s;
    try{s=JSON.parse(localStorage.getItem(sessionKey)||'null');}catch{return;}
    if(!s || typeof s!=='object')return;
    for(const id of fieldIds) if(typeof s.fields?.[id]==='string')$('#'+id).value=s.fields[id];
    dest=nameFor(s.dest);$('#dest-input').value=dest;
    if(['drive','bus','rail'].includes(s.mode))mode=s.mode;
    if(['geo','radial'].includes(s.layout))layout=s.layout;
    themes.restore({...s.theme,layer:s.theme?.layer||s.layer});
    if(themes.isRegion()||themes.isMarket()||themes.isFacilities()||showingTrend())layout='geo';
    eventsOn=s.eventsOn!==false;
    blockId=streetById.has(s.blockId)?s.blockId:'';
    zoneId=zoneById.get(s.zoneId)?.street===blockId?s.zoneId:'';
    eventGroup=Object.hasOwn(atlasEventTypes,s.eventGroup)?s.eventGroup:'';
    selected=typeof s.selected==='string'?s.selected:'';
    if(s.insight&&evidence.get(s.insight.kind,s.insight.id))insightFocus={kind:s.insight.kind,id:s.insight.id,part:['events','policies'].includes(s.insight.part)?s.insight.part:'outlook'};
    seen=new Set(Array.isArray(s.seen)?s.seen.filter(x=>typeof x==='string'):[]);
    if(s.scope?.kind==='street'&&data.streets.some(a=>a.id===s.scope.id))scope=s.scope;
    if(s.scope?.kind==='district'&&base.districts.some(a=>a.n===s.scope.id))scope=s.scope;
    $('#only-saved').checked=s.onlySaved===true&&book.entries().some(e=>e.saved);
  }
  const inScope=c=>!scope || (scope.kind==='street'?c.street?.id===scope.id:(c.street?.d||c.node.district)===scope.id);
  const scopeName=()=>scope?.kind==='street'?data.streets.find(s=>s.id===scope.id)?.n:scope?.id;
  const lookupRow=id=>recordsById.get(id);
  function futureMessage(){
    const second=$('#second-dest').value.trim();
    if(second&&!nameFor(second))return '未来工作地未匹配，当前列表只按现工作地筛选。请从下拉表选择未来工作地。';
    return !second&&$('#second-limit').value.trim()?'填写未来工作地后，才会应用第二个通勤上限。':'';
  }
  const cap=(id,min,max,fallback)=>{const t=$(id).value;if(t==null||String(t).trim()==='')return fallback;const v=Number(t);return Number.isFinite(v)?Math.min(max,Math.max(min,v)):fallback;};
  function options(){return {mode,line:mode==='rail'?$('#corridor').value:'',limit:cap('#time-limit',10,90,50),room:$('#room').value??'1',budget:cap('#budget',1,1000000,0),sqm:cap('#sqm',1,1000,0),access:cap('#access',0,60,5),egress:cap('#egress',0,60,5),secondary:nameFor($('#second-dest').value),secondMax:cap('#second-limit',1,240,0),saved:$('#only-saved').checked};}
  function publicEvents(filterGroup=true){
    const records=window.worldEvents||[];
    return records.filter(e=>!filterGroup||!eventGroup||atlasEventType(e)===eventGroup);
  }
  function recompute(){
    const opt=options();rowByStop=new Map();allRows=[];rows=[];
    candidateMap.clear();recordsById.clear();candidateZoneCache.clear();
    for(const c of model.candidates(book.manual()))candidateMap.set(c.id,c);
    mapEvents=eventsOn?publicEvents():[];
    if(!candidateMap.has(selected))selected='';
    if(!dest){
      preview=[];
      for(const c of candidateMap.values()){
        const housing=model.housing(c,opt),outside=!inScope(c)||(opt.saved&&!book.saved(c.id));
        const r={c,price:housing.sample,housingReason:housing.reason,mapState:outside?'outside':housing.status,exclusions:outside?['超出当前筛选']:[housing.reason].filter(Boolean)};
        r.fit=fit.assess(r,opt,book.get(c.id),weights);recordsById.set(c.id,r);
        if(r.mapState==='eligible')preview.push(r);
      }
      return;
    }
    for(const c of candidateMap.values()){
      const route=model.route(c,dest,opt);
      const housing=model.housing(c,opt);
      const r={c,route,price:housing.sample,housingState:housing.status,housingReason:housing.reason};
      recordsById.set(c.id,r);
      if(!route)continue;
      const previous=rowByStop.get(c.node.name);
      if(!previous||model.meter(c.coord,c.node.coord)<model.meter(previous.c.coord,previous.c.node.coord))rowByStop.set(c.node.name,r);
      if(!rowByStop.has(c.station.name))rowByStop.set(c.station.name,r);
      allRows.push(r);
    }
    for(const r of recordsById.values()){
      if(opt.secondary)r.future=model.route(r.c,opt.secondary,opt);
      r.fit=fit.assess(r,opt,book.get(r.c.id),weights);
      r.exclusions=[];
      if(r.route&&r.route.minutes>opt.limit)r.exclusions.push('当前通勤超过上限');
      if(!inScope(r.c))r.exclusions.push('在所选区域以外');
      if(opt.saved&&!book.saved(r.c.id))r.exclusions.push('仅显示已收藏地点');
      if(opt.line&&r.route&&!r.route.legs.some(l=>l.line===opt.line))r.exclusions.push('最快路线未经过所选线路');
      if(opt.secondary&&opt.secondMax&&(!r.future||r.future.minutes>opt.secondMax))r.exclusions.push('未来通勤未满足上限');
      r.mapState=r.exclusions.length||r.housingState==='outside'?'outside':!r.route?'no-route':r.housingState;
      if(!r.route)r.exclusions.push('当前方式缺少路线');
      if(r.housingReason)r.exclusions.push(r.housingReason);
    }
    rows=allRows.filter(r=>r.exclusions.length===0);
    rows.sort((a,b)=>a.route.minutes-b.route.minutes||Number(!!b.price)-Number(!!a.price)||a.c.name.localeCompare(b.c.name,'zh'));
  }
  const rowName=r=>esc(r.c.name);
  const valueText=x=>x?.price?Number(x.price).toLocaleString('zh-CN')+' 元/月':x?.sqm?x.sqm+' ㎡':'租金待补';
  function geoRef(e){return e.near?.length?'位置参照 · '+e.near.join('、'):'';}
  function setDest(n){
    const target=nameFor(n);
    if(!target){$('#dest-error').textContent='请选择下拉表中的站点或园区，也可以点地图上的工作地。';return;}
    const changed=dest!==target;
    if(changed){insightFocus=null;insightOrigin=null;}
    if(changed){selected='';discoveryId='';seen.clear();openBands.clear();}
    dest=target;$('#dest-input').value=target;$('#dest-error').textContent=futureMessage();eventId='';message='';
    recompute();
    if(changed&&!blockId){const pts=[model.nodes.get(dest).coord,...rows.map(r=>r.c.coord)].map(draw.project);draw.camera.fit(atlasExtent(pts.map(p=>[...p,...p])));}
    render(false);if(pendingId){const remembered=pendingId;pendingId='';savedSelection(remembered);}
  }
  function savedSelection(id){
    const c=candidateMap.get(id);
    if(!c)return;
    if(!dest)pendingId=id;
    if(!rows.some(r=>r.c.id===id))layout='geo';
    select(id);
  }
  function select(id,discovered=false){
    if(!candidateMap.has(id))return;
    const c=candidateMap.get(id);
    const view=draw.camera.viewport(), [x,y]=view.pt(draw.project(c.coord));
    const local=c.hood?.footprint;
    if(local&&(view.k<8||x<0||x>view.w||y<0||y>view.h))draw.camera.fit(local.bounds);
    else if(c.street?.id!==blockId||!blockId||x<0||x>view.w||y<0||y>view.h){if(c.street)draw.camera.fit(c.street.bounds);else draw.focusPoint(c.coord);}
    topic.region=c.street?.d||'';
    insightFocus=null;insightOrigin=null;
    discoveryId=discovered?id:'';
    zoneId=zoneForCandidate(c)||'';
    blockId=c.street?.id||'';selected=id;eventId='';message='';seen.add(id);render(false);
  }
  function openBlock(id){
    const s=streetById.get(id);if(!s)return;
    insightFocus=null;insightOrigin=null;topic.region=s.d;
    zoneId='';blockId=id;selected='';eventId='';pendingId='';message='';draw.camera.fit(s.bounds);render(false);
  }
  function zoneForCandidate(c){
    if(c.hood?.zone)return c.hood.zone;
    if(candidateZoneCache.has(c.id))return candidateZoneCache.get(c.id);
    const zones=(data.zones||[]).filter(z=>z.street===c.street?.id);
    if(!zones.length){candidateZoneCache.set(c.id,'');return '';}
    const xy=draw.project(c.coord), distance=z=>Math.hypot(z.xy[0]-xy[0],z.xy[1]-xy[1]);
    const nearest=zones.sort((a,b)=>distance(a)-distance(b))[0];
    const found=distance(nearest)<=nearest.radius?nearest.id:'';
    candidateZoneCache.set(c.id,found);
    return found;
  }
  function openZone(id){
    const z=zoneById.get(id);if(!z)return;
    insightFocus=null;insightOrigin=null;topic.region=streetById.get(z.street)?.d||'';
    zoneId=z.id;blockId=z.street;layout='geo';selected='';eventId='';pendingId='';message='';draw.camera.fit(z.bounds);render(false);
  }
  function selectEvent(id){insightFocus=null;eventsOn=true;eventId=id;mapEvents=publicEvents();if(!mapEvents.some(e=>e.id===id)){eventGroup='';mapEvents=publicEvents();}if(dest&&!mapEvents.find(e=>e.id===id)?.near?.some(n=>rowByStop.get(n)?.route.minutes<=options().limit))layout='geo';const event=mapEvents.find(e=>e.id===id);if(event&&layout==='geo')draw.focusPoint(event.coord);render(false);}
  function discover(){
    const r=fit.next(rows,seen,null,weights);
    if(r){select(r.c.id,true);focusPlace();return;}
    message='当前候选已探完，可调整预算或通勤时间。';render(false);
  }
  function focusPlace(){
    const title=$('#probe h2');
    if(title){title.tabIndex=-1;title.focus({preventScroll:true});if(window.matchMedia?.('(max-width:780px)').matches)title.scrollIntoView({block:'start'});}
  }
  function bookmarkButton(c){
    const saved=book.saved(c.id);
    return '<button type="button" data-bookmark="'+esc(c.id)+'" aria-pressed="'+saved+'" aria-label="'+(saved?'取消收藏':'收藏')+esc(c.name)+'">'+(saved?'已收藏':'收藏')+'</button>';
  }
  function toggleBookmark(id){
    const c=candidateMap.get(id);
    if(!c)return;
    const removing=book.saved(id);
    message=removing?'已取消收藏。':'已收藏'+c.name+'。';
    if(removing && options().saved && id===selected){selected='';pendingId='';blockId='';zoneId='';}
    book.toggle(id,c.name);
    const next=$('#probe [data-bookmark]')||$('#only-saved');
    next.focus({preventScroll:true});
  }
  function worldCard(e){
    const until=e.until&&/^\d{4}-\d{2}-\d{2}$/.test(e.until)?e.until:'';
    const expired=until&&new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'})>until;
    const nearRows=rows.filter(r=>e.near?.some(n=>r.c.node.name===n||r.c.station.name===n)).sort((a,b)=>Number(!!b.c.hood)-Number(!!a.c.hood));
    const places=dest?nearRows.slice(0,4).map(r=>'<button data-pick="'+esc(r.c.id)+'">'+rowName(r)+'</button>').join(''):(e.near||[]).filter(n=>model.nodes.has(n)).slice(0,3).map(n=>'<button data-work="'+esc(n)+'">以'+esc(n)+'为中心</button>').join('');
    const dateText=e.personal?(e.observed?'观察日期 '+e.observed:'观察日期未填写'):'资料日期 '+(e.observed||'待核');
    return '<article class="event-card"><div class="event-state">'+esc(e.kind)+' · '+esc(expired?'公告期已过，现况待核':e.status)+'</div><h2>'+esc(e.name)+'</h2><p>'+esc(e.fact)+'</p><p class="measure-note">'+esc(dateText)+(until?' · 公告截至 '+esc(until):'')+'</p><h3>踩点时留意</h3><p class="event-check">'+esc(e.check)+'</p><p>'+esc([e.anchor,geoRef(e)].filter(Boolean).join(' · '))+'</p><div class="place-links">'+places+'</div><p>'+[lnk(e.url,e.source),lnk(e.relatedUrl,e.relatedSource)].filter(Boolean).join('　')+'</p><div class="probe-actions"><button id="back-probe">返回探索</button></div></article>';
  }
  function routeDetails(r,opt){
    const v=r.route;
    if(mode==='drive'){
      return '<p>参考路程 '+(v.meters/1000).toFixed(1)+' 公里 · 行车 '+Math.ceil(v.seconds/60)+' 分钟 · 取车及停车后步行 '+v.walk+' 分钟。</p>';
    }
    if(v.same)return '<p>两端使用同一参考点，按首末步行共 '+v.walk+' 分钟估算。</p>';
    const legs=(v.legs||[]).map(l=>'<li><b class="route-pin">'+esc(mode==='rail'&&Object.hasOwn(timing.lines,l.line)?l.line+'号线':l.line)+'</b>　'+esc(l.from||l.fromStop)+' → '+esc(l.to||l.toStop)+(l.minutes?' · '+l.minutes+' 分钟':l.stops?' · '+l.stops+' 站':'')+'</li>').join('');
    let note='乘车 '+((v.ride||0)+(v.shuttleMinutes||0))+' 分钟，候车 '+(v.wait||0)+' 分钟，首末及换乘步行 '+((v.walk||0)+(v.transferMinutes||0))+' 分钟。';
    if(v.shuttleMinutes||v.shuttle){
      const service=shuttles.find(s=>v.legs.some(leg=>leg.line===s.line));
      if(service){
        note+=' '+esc(service.line)+' 接驳车程和候车均为工作日估算。';
        if(dest==='企鹅岛')note+=esc(service.window||service.inboundService||'');
        note+=' '+lnk(service.stopSource||service.source,'核对本线方向和服务时段');
      }
    }
    return '<ol class="route-steps">'+legs+'</ol><p>'+note+'</p>';
  }
  function renderBlock(s){
    const z=zoneById.get(zoneId),block=z?zoneBlocks.get(z.id):blocks.get(s.id), key=topic.layer, m=atlasMeasures[key];
    const shownValue=r=>r.mapState==='pending'&&key!=='commute'?null:atlasValue(r,key);
    const ranked=(block?.rows||[]).slice().sort((a,b)=>{
      const av=shownValue(a),bv=shownValue(b);
      if(Number.isFinite(av)&&Number.isFinite(bv)&&av!==bv)return m.lower?av-bv:bv-av;
      return Number(Number.isFinite(bv))-Number(Number.isFinite(av))||Number(a.mapState==='pending')-Number(b.mapState==='pending')||Number(!!b.c.hood)-Number(!!a.c.hood)||a.c.name.localeCompare(b.c.name,'zh');
    });
    const line=r=>{const v=shownValue(r);return '<li><button type="button" data-pick="'+esc(r.c.id)+'">'+rowName(r)+'</button><span>'+(Number.isFinite(v)?esc(v.toLocaleString('zh-CN')+' '+m.unit):'待核')+'</span></li>';};
    const first=ranked.slice(0,3),rest=ranked.slice(3);
    let html='<p class="place-location">'+esc(z?s.n+' · 站点参考区':s.d)+'</p><h2>'+esc(z?z.n+'片区':s.n)+'</h2>';
    if(showingTrend())html+=trendReading(z?'zone':'street',z?.id||s.id);
    else html+=block?.best?'<p class="block-stat"><strong>'+esc(block.text)+'</strong><span>'+m.basis+'</span></p>'+(block.state==='partial'?'<p class="measure-note">'+esc(block.reason)+'</p>':''):'<p class="measure-note">'+esc(block?.text||'未收录候选')+'</p>';
    if(!z){const local=(data.zones||[]).filter(a=>a.street===s.id);if(local.length)html+='<div class="fine-chips">'+local.map(a=>'<button data-zone="'+esc(a.id)+'">'+esc(a.n)+'</button>').join('')+'</div>';}
    if(dest&&key==='rent'&&!showingTrend()&&!block?.best)html+='<button class="fine-link-button" id="color-commute">看通勤时间</button>';
    if(first.length&&showingTrend())html+='<h3>候选月租</h3>';
    if(first.length)html+='<ul class="place-selection">'+first.map(line).join('')+'</ul>';
    if(rest.length)html+='<details><summary>更多候选（'+rest.length+'）</summary><ul class="place-selection">'+rest.map(line).join('')+'</ul></details>';
    const ids=new Set(ranked.map(r=>r.c.id)),other=data.hoods.filter(h=>h.street===s.id&&(!z||h.zone===z.id)&&!ids.has(h.id));
    if(other.length)html+='<details><summary>其他片区（'+other.length+'）</summary><div class="fine-chips">'+other.map(h=>'<button data-pick="'+esc(h.id)+'">'+esc(h.n)+'</button>').join('')+'</div></details>';
    return html;
  }
  function trendReading(kind,id){
    const value=observed(kind,id);
    if(!value)return '<p class="measure-note">暂无同户型'+(topic.localMetric==='yoy'?'同比':'环比')+'样本</p>';
    return '<p class="block-stat"><strong>'+esc(value.label)+'</strong></p><p class="measure-note">'+esc([value.period,value.basis].filter(Boolean).join(' · '))+' '+lnk(value.source,'数据来源')+'</p>';
  }
  function currentArea(){
    if(themes.isRegion())return topic.region?{kind:'district',id:topic.region}:null;
    if(themes.isMarket())return null;
    const hood=candidateMap.get(selected)?.hood?.id;
    if(hood)return {kind:'hood',id:hood};
    if(zoneId)return {kind:'zone',id:zoneId};
    if(blockId)return {kind:'street',id:blockId};
    return scope||null;
  }
  function openInsight(kind,id,part='outlook'){
    const info=evidence.get(kind,id);
    if(!info)return;
    if(kind==='district')topic.region=id;
    else {
      const hood=kind==='hood'?candidateMap.get(id):null;
      const z=kind==='zone'?zoneById.get(id):null;
      blockId=kind==='street'?id:z?.street||hood?.street?.id||'';
      selected=hood?.id||'';zoneId=z?.id||hood?.hood?.zone||'';
      topic.region=streetById.get(blockId)?.d||'';
    }
    eventId='';pendingId='';message='';insightOrigin=null;insightFocus={kind,id,part:['events','policies'].includes(part)?part:'outlook'};
    render(false);focusPlace();
  }
  function evidenceAction(){
    const probe=$('#probe');
    if(insightFocus)return;
    if(eventId||themes.isMarket()){
      if(insightOrigin)probe.insertAdjacentHTML('beforeend','<div class="probe-actions"><button type="button" data-insight-return>返回'+esc(evidence.get(insightOrigin.kind,insightOrigin.id)?.name||'片区')+'</button></div>');
      return;
    }
    const place=currentArea();
    if(!place||!evidence.get(place.kind,place.id))return;
    probe.insertAdjacentHTML('beforeend','<div class="probe-actions"><button type="button" data-area-insight="'+esc(place.kind)+'" data-area-id="'+esc(place.id)+'">事件与政策</button></div>');
  }
  function renderProbe(opt){
    liveTicket++;
    const el=$('#probe'),e=mapEvents.find(x=>x.id===eventId);
    if(e){el.innerHTML=worldCard(e);return;}
    if(insightFocus){
      const {kind,id,part}=insightFocus,place=evidence.get(kind,id);
      el.innerHTML=evidence.panel(kind,id,showingTrend()?{reading:observed(kind,id)}:{});
      const sections=[['outlook','走势'],['events','事件 '+place.events.length],['policies','政策 '+place.localPolicyCount]];
      const tabs=sections.map(([key,label])=>'<button type="button" data-insight-tab="'+key+'" aria-pressed="'+(key===part)+'">'+esc(label)+'</button>').join('');
      el.querySelector('h2').insertAdjacentHTML('afterend','<div class="probe-actions insight-controls" role="group" aria-label="片区资料">'+tabs+'<button type="button" data-insight-close>返回地点</button></div>');
      for(const section of el.querySelectorAll('[data-insight-section]'))section.hidden=section.dataset.insightSection!==part;
      return;
    }
    const r=lookupRow(selected),street=streetById.get(blockId);
    const key=topic.layer;
    if(themes.isRegion()){el.innerHTML=themes.regionalPanel();return;}
    if(themes.isMarket()){el.innerHTML=topic.marketKey?themes.market.card(topic.marketKey):themes.market.overview(topic.marketFilter);return;}
    if(themes.isFacilities()){
      const home=r?.c;
      el.innerHTML=themes.facilityPanel(street,zoneById.get(zoneId),home,scope);
      const backBtn=!home&&facilityOrigin?'<button type="button" data-facility-return>返回'+esc(facilityOrigin.name)+'</button>':'';
      if(home)el.insertAdjacentHTML('beforeend','<div class="probe-actions">'+bookmarkButton(home)+'<button data-place-rent="'+esc(home.id)+'">查看月租</button></div>');
      else if(backBtn)el.insertAdjacentHTML('beforeend','<div class="probe-actions">'+backBtn+'</div>');
      return;
    }
    if(key==='commute'&&!dest){el.innerHTML='<h2>通勤</h2><button type="button" id="choose-work">选工作地看通勤</button>';return;}
    if(!selected&&street){el.innerHTML=renderBlock(street);return;}
    if(!r){
      if(showingTrend()){
        const available=data.streets.filter(s=>!scope||(scope.kind==='district'?s.d===scope.id:s.id===scope.id)).map(s=>[s,observed('street',s.id)]).filter(([,v])=>v);
        available.sort((a,b)=>Math.abs(b[1].value)-Math.abs(a[1].value));
        el.innerHTML='<h2>片区租金'+(topic.localMetric==='yoy'?'同比':'环比')+'</h2>'+(available.length?'<p class="measure-note">同户型商圈样本 · 按变动幅度</p><ul class="place-selection">'+available.slice(0,4).map(([s,v])=>'<li><button data-block="'+esc(s.id)+'">'+esc(s.short)+'</button><span>'+esc(v.label)+'</span></li>').join('')+'</ul>':'<p>此范围暂无可比样本。</p>');return;
      }
      if(dest){
        el.innerHTML=fitView.recommendations(rows,opt);
      }else if(opt.saved){
        const saved=[...recordsById.values()].filter(row=>book.saved(row.c.id)&&inScope(row.c)&&row.mapState!=='outside');
        el.innerHTML='<h2>已收藏</h2>'+(saved.length?'<ul class="place-selection">'+saved.map(row=>
          '<li><button type="button" data-pick="'+esc(row.c.id)+'">'+rowName(row)+'</button><span>'+esc(valueText(row.price))+'</span></li>').join('')+'</ul>':'<p>此范围暂无收藏。</p>');
      }else{
        const m=atlasMeasures[key],top=[...blocks.entries()].filter(([,b])=>b.best)
          .sort((a,b)=>m.lower?a[1].value-b[1].value:b[1].value-a[1].value).slice(0,3);
        el.innerHTML='<h2>'+(key==='rent'?'低租金样本':m.name+'街区')+'</h2>'+(top.length?'<ul class="place-selection">'+top.map(([id,b])=>
          '<li><button data-block="'+esc(id)+'">'+esc(streetById.get(id).short)+'</button><span>'+esc(b.text)+'</span></li>').join('')+'</ul>':'<p>此范围暂无资料。</p>');
      }
      return;
    }
    const {c,price:p}=r;
    const location=[c.street?.d||c.node.district,c.street?.n,c.hood?.footprint?.kind].filter(Boolean).join(' · ');
    const reasons=r.exclusions||[];
    const filterStatus=reasons.length?' · '+(r.mapState==='outside'?'筛选外，':'')+esc(reasons.join('、')):'';
    r.facilityFacts=themes.facilities.facts(c);
    const areaInfo=c.hood?evidence.get('hood',c.hood.id):c.street?evidence.get('street',c.street.id):null;
    const kpi='<div class="probe-kpi"><span>通勤 <b>'+(dest?(r.route?r.route.minutes+' 分钟':'待核'):'未选工作地')+'</b></span>'+
      '<span>月租 <b>'+(p?.price?Number(p.price).toLocaleString('zh-CN')+' 元/月':'待核')+'</b></span>'+
      (areaInfo?'<span>'+esc(areaInfo.outlook.label)+' · 事件 '+areaInfo.events.length+' · 政策 '+areaInfo.localPolicyCount+'</span>':'')+'</div>';
    let box='<h2>'+rowName(r)+'</h2><p class="place-location">'+esc(location)+filterStatus+'</p>'+kpi+
      (showingTrend()?trendReading('hood',c.id):'')+fitView.card(r,opt,discoveryId===c.id);
    if(p?.price){
      const basis=[p.roomLabel||roomNames[p.room],p.unit,p.sqm?p.sqm+' ㎡':'',p.date].filter(Boolean).join(' · ');
      box+='<p class="measure-note">'+esc(basis)+' '+lnk(p.source,'租金来源')+'</p>';
    }
    const actions=[bookmarkButton(c)];
    if(!dest)actions.push('<button type="button" id="choose-work">选工作地看通勤</button>');
    if(dest&&key==='rent'&&r.mapState==='pending'&&r.route)actions.push('<button type="button" id="color-commute">按通勤着色</button>');
    box+='<div class="probe-actions">'+actions.join('')+'</div>';
    if(dest){
      if(opt.secondary)box+='<p class="measure-note">'+esc(opt.secondary)+' · '+(r.future?r.future.minutes+' 分钟':'路线待核')+'</p>';
      const navParams=new URLSearchParams({from:[...c.coord,c.name].join(','),to:[...model.nodes.get(dest).coord,dest].join(','),mode:mode==='drive'?'car':'bus',policy:mode==='bus'?'3':'0',callnative:'0'});
      box+='<details class="probe-detail"><summary>'+(r.route?r.route.minutes+' 分钟到 '+esc(dest)+' · 路线':'通勤路线待核')+'</summary>'+
        (r.route?routeDetails(r,opt):'<p>当前方式缺少路线。</p>')+'</details><div class="probe-actions">'+
        lnk('https://uri.amap.com/navigation?'+navParams,'地图导航')+
        (mode==='drive'&&r.route?'<button type="button" id="drive-live">当前路况</button>':'')+'</div>';
      if(mode==='drive'&&r.route)box+='<p id="drive-status" role="status"></p>';
    }
    const activity=(c.hood?.events||[]).filter(themes.market.has);
    if(activity.length)box+='<div class="fine-chips">'+activity.map(id=>'<button data-market-event="'+esc(id)+'">'+esc(themes.market.get(id).type)+' · '+esc(themes.market.get(id).signal)+'</button>').join('')+'</div>';
    const noteEntry=book.get(c.id);
    const starOpts=val=>'<option value="">未评</option>'+['1·很不合适','2·不太合适','3·一般','4·满意','5·很满意'].map((t,i)=>'<option value="'+(i+1)+'"'+(val===i+1?' selected':'')+'>'+t+'</option>').join('');
    const hasObs=!!(noteEntry?.environment||noteEntry?.convenience||noteEntry?.note);
    box+='<details class="probe-detail" data-note-drawer><summary>'+(hasObs?'编辑看房备注':'我的看房备注')+'</summary><form class="noteform" data-inline-note="'+esc(c.id)+'"><div class="book-flags"><label>居住环境 <select data-note-field="environment">'+starOpts(noteEntry?.environment)+'</select></label><label>生活便利 <select data-note-field="convenience">'+starOpts(noteEntry?.convenience)+'</select></label></div><label>看房速记<textarea class="notefield" data-note-field="note" maxlength="1200" rows="2" placeholder="例如：晚间临街声、步行到站口实测、采光通风">'+esc(noteEntry?.note||'')+'</textarea></label><div><button class="subtle" type="submit">保存备注</button></div></form></details>';
    el.innerHTML=box;
    const inlineForm=el.querySelector('[data-inline-note]');
    if(inlineForm)inlineForm.onsubmit=ev=>{
      ev.preventDefault();
      try{
        book.saveObservation(c.id,c.name,{
          environment:inlineForm.querySelector('[data-note-field="environment"]').value,
          convenience:inlineForm.querySelector('[data-note-field="convenience"]').value,
          note:inlineForm.querySelector('[data-note-field="note"]').value
        });
        message='已保存'+c.name+'的看房备注。';
        $('#decision-status').textContent=[message,storageNotice].filter(Boolean).join(' ');
      }catch(err){message=err.message;$('#decision-status').textContent=message;}
    };
    const drive=$('#drive-live');if(drive){drive.onclick=async()=>{const ticket=++liveTicket,status=$('#drive-status');drive.disabled=true;status.textContent='正在查询当前路况…';try{const result=await liveDrive(c.node.name,dest);if(ticket!==liveTicket)return;status.textContent='当前车内 '+result.minutes+' 分钟，含首末段约 '+(Math.ceil(result.minutes)+r.route.walk)+' 分钟 · '+String(result.checkedAt||'').replace('T',' ');}catch(error){if(ticket===liveTicket)status.textContent=error.message;}finally{if(ticket===liveTicket)drive.disabled=false;}};}
  }
  function renderList(opt){
    const el=$('#result-list');
    if(!dest){el.innerHTML='';return;}
    const groups=new Map();
    for(const r of rows){const band=Math.max(1,Math.ceil(r.route.minutes/10));if(!groups.has(band))groups.set(band,[]);groups.get(band).push(r);}
    if(!groups.size){el.innerHTML='';return;}
    el.innerHTML='<details class="all-candidates"'+(listOpen?' open':'')+'><summary>全部候选（'+rows.length+'）</summary>'+[...groups].map(([band,items])=>{
      const lo=(band-1)*10,hi=Math.min(opt.limit,band*10);
      return '<details data-band="'+band+'"'+(openBands.has(band)?' open':'')+'><summary>'+lo+'–'+hi+' 分钟 <small>'+items.length+' 处</small></summary><div class="corridor-list">'+items.map(r=>'<button data-pick="'+esc(r.c.id)+'" aria-pressed="'+(r.c.id===selected)+'">'+rowName(r)+'<small>'+r.route.minutes+' 分钟 · '+esc(r.route.label)+(r.price?' · '+esc(valueText(r.price)):'')+'</small></button>').join('')+'</div></details>';
    }).join('')+'</details>';
    const outer=el.querySelector('.all-candidates');outer.ontoggle=()=>{listOpen=outer.open;};
    for(const group of el.querySelectorAll('[data-band]'))group.ontoggle=()=>{if(group.open)openBands.add(+group.dataset.band);else openBands.delete(+group.dataset.band);};
  }
  function renderSavedMatrix(opt){
    const toggle=$('#saved-matrix-toggle'), host=$('#saved-matrix');
    if(!toggle||!host)return;
    const savedRows=book.entries().filter(e=>e.saved).map(e=>recordsById.get(e.id)).filter(Boolean);
    toggle.hidden=savedRows.length<2;
    toggle.textContent=matrixOpen?'收起对比':'对比已收藏（'+Math.min(savedRows.length,3)+'）';
    toggle.setAttribute('aria-expanded',String(matrixOpen&&savedRows.length>=2));
    if(!matrixOpen||savedRows.length<2){host.hidden=true;host.innerHTML='';return;}
    const picks=savedRows.slice(0,3);
    const cell=fn=>picks.map(r=>'<td>'+fn(r)+'</td>').join('');
    const trendCell=r=>{
      const id=r.c.hood?.id,kind=id?'hood':'street',targetId=id||r.c.street?.id;
      if(!targetId)return '—';
      const y=evidence.measure(kind,targetId,'yoy',opt.room),m=evidence.measure(kind,targetId,'mom',opt.room);
      return [y?.label,m?.label].filter(Boolean).map(esc).join(' / ')||'—';
    };
    const insightCell=r=>{
      const info=r.c.hood?evidence.get('hood',r.c.hood.id):r.c.street?evidence.get('street',r.c.street.id):null;
      if(!info)return '—';
      return esc(info.outlook.label)+' · 事件 '+info.events.length+' · 政策 '+info.localPolicyCount;
    };
    const facCell=r=>{
      const f=themes.facilities.facts(r.c);
      return [f.convenience,f.environment].filter(Boolean).map(esc).join(' / ')||'待收录';
    };
    const obsCell=r=>{
      const e=book.get(r.c.id);
      const parts=[e?.environment?'环境'+e.environment+'/5':'',e?.convenience?'便利'+e.convenience+'/5':'',e?.note||''].filter(Boolean);
      return parts.length?esc(parts.join(' · ')):'未填';
    };
    host.hidden=false;
    host.innerHTML='<div class="saved-matrix-scroll"><table><thead><tr><th>项目</th>'+
      picks.map(r=>'<th><button type="button" data-pick="'+esc(r.c.id)+'">'+rowName(r)+'</button></th>').join('')+
      '</tr></thead><tbody>'+
      '<tr><th>位置</th>'+cell(r=>esc([r.c.street?.d||r.c.node.district,r.c.street?.n].filter(Boolean).join(' · ')))+'</tr>'+
      '<tr><th>单程通勤</th>'+cell(r=>dest?(r.route?r.route.minutes+' 分钟（'+esc(r.route.label)+'）':'路线待核'):'未选工作地')+'</tr>'+
      '<tr><th>月租样本</th>'+cell(r=>r.price?.price?esc(valueText(r.price)+' · '+(r.price.unit||'')):'待核')+'</tr>'+
      '<tr><th>同比 / 环比</th>'+cell(trendCell)+'</tr>'+
      '<tr><th>事件与走势</th>'+cell(insightCell)+'</tr>'+
      '<tr><th>公开设施</th>'+cell(facCell)+'</tr>'+
      '<tr><th>适配分</th>'+cell(r=>r.fit?.count?esc(fit.range(r.fit)+' 分'):'待核')+'</tr>'+
      '<tr><th>看房备注</th>'+cell(obsCell)+'</tr>'+
      '</tbody></table></div>';
  }
  function jumpToPlace(raw){
    const q=String(raw||'').trim();
    if(!q)return false;
    const norm=s=>String(s||'').trim();
    const hood=data.hoods.find(h=>norm(h.n)===q||norm(h.footprint?.name)===q)
      ||data.hoods.find(h=>h.n.includes(q)||h.footprint?.name?.includes(q));
    if(hood){
      if(themes.isRegion()||themes.isMarket())topic.layer='rent';
      scope=null;recompute();savedSelection(hood.id);focusPlace();
      message='已定位到 '+hood.n+'。';$('#decision-status').textContent=message;
      return true;
    }
    const zone=(data.zones||[]).find(z=>z.n===q||z.n+'片区'===q||z.n+'站'===q);
    if(zone){
      if(themes.isRegion()||themes.isMarket())topic.layer='rent';
      openZone(zone.id);focusPlace();
      message='已定位到 '+zone.n+'片区。';$('#decision-status').textContent=message;
      return true;
    }
    const street=data.streets.find(s=>s.n===q||s.short===q)||data.streets.find(s=>s.n.includes(q));
    if(street){
      if(themes.isRegion()||themes.isMarket())topic.layer='rent';
      openBlock(street.id);focusPlace();
      message='已定位到 '+street.n+'。';$('#decision-status').textContent=message;
      return true;
    }
    const dist=base.districts.find(d=>d.n===q||d.n.replace(/新区$|区$/,'')===q);
    if(dist){
      findDistrict(dist.n);
      message='已定位到 '+dist.n+'。';$('#decision-status').textContent=message;
      return true;
    }
    message='未找到匹配的片区或街道：'+q;
    $('#decision-status').textContent=message;
    return false;
  }
  function renderWorld(){
    const el=$('#world-ledger'),legend=$('#event-legend'),filterBtn=$('#event-filter-toggle');
    if(filterBtn){
      filterBtn.hidden=!eventsOn;
      filterBtn.textContent=eventGroup?'事件：'+atlasEventTypes[eventGroup].label:'事件分类';
      filterBtn.setAttribute('aria-expanded',String(eventsOn&&(eventLegendOpen||!!eventGroup)));
    }
    legend.hidden=!eventsOn||(!eventLegendOpen&&!eventGroup);
    if(!eventsOn){el.innerHTML='';legend.innerHTML='';return;}
    const types=new Set(publicEvents(false).map(atlasEventType));
    legend.innerHTML=Object.entries(atlasEventTypes).filter(([type])=>types.has(type)).map(([type,t])=>
      '<button type="button" data-event-filter="'+type+'" aria-pressed="'+(eventGroup===type)+'" title="'+(eventGroup===type?'显示全部事件':'只看'+t.label)+'">'+atlasEventIcon(type)+esc(t.label)+'</button>').join('');
    el.innerHTML='<details'+(showLedger?' open':'')+'><summary>公共事件 · '+mapEvents.length+' 条</summary><div class="world-index">'+mapEvents.map(e=>'<button data-ev="'+esc(e.id)+'" aria-pressed="'+(eventId===e.id)+'">'+atlasEventIcon(atlasEventType(e))+esc(e.name)+'</button>').join('')+'</div></details>';
    const det=el.querySelector('details');det.ontoggle=()=>showLedger=det.open;
  }
  function districtName(){return streetById.get(blockId)?.d||candidateMap.get(selected)?.street?.d||(scope?.kind==='district'?scope.id:streetById.get(scope?.id)?.d)||'';}
  function renderCrumbs(){
    const s=streetById.get(blockId),z=zoneById.get(zoneId),c=candidateMap.get(selected);
    const market=themes.isMarket()?themes.market.get(topic.marketKey):null;
    const region=themes.isRegion()?topic.region:market?.dist||districtName();
    const part=(key,id,name)=>'<button type="button" data-area-up="'+key+'" data-id="'+esc(id)+'">'+esc(name)+'</button>';
    const crumbs=[part('city','','全市')];
    if(region)crumbs.push(part('district',region,region));
    if(!themes.isRegion()&&!themes.isMarket()){
      if(s)crumbs.push(part('street',s.id,s.short));
      if(z)crumbs.push(part('zone',z.id,z.n));
      if(c)crumbs.push('<span aria-current="location">'+esc(c.hood?.footprint?.name||c.name)+'</span>');
    }else if(market)crumbs.push('<span aria-current="location">'+esc(market.area)+'</span>');
    $('#map-crumbs').innerHTML=crumbs.join('<span aria-hidden="true">›</span>');
  }
  function render(calc){
    if(calc)recompute();
    const opt=options(),layer=topic.layer,fac=themes.isFacilities(),regional=themes.isRegion()||themes.isMarket();
    const key=Object.hasOwn(atlasMeasures,layer)?layer:'rent',trend=showingTrend();
    const mapRows=[...recordsById.values()];
    blocks=atlasBlocks(mapRows,key);zoneBlocks=atlasBlocks(mapRows,key,r=>zoneForCandidate(r.c));
    if(fac){
      const measure=area=>themes.facilities.measure(themes.facilities.records(layer,topic.category,area),layer);
      for(const s of data.streets)blocks.set(s.id,{...blocks.get(s.id),...measure({street:s.id})});
      for(const z of data.zones||[])zoneBlocks.set(z.id,{...zoneBlocks.get(z.id),...measure({zone:z.id})});
    }
    if(trend){
      for(const s of data.streets)blocks.set(s.id,{...blocks.get(s.id),...trendMeasure('street',s.id)});
      for(const z of data.zones||[])zoneBlocks.set(z.id,{...zoneBlocks.get(z.id),...trendMeasure('zone',z.id)});
    }
    $('#scope-chip').hidden=!scope||regional;$('#scope-chip').textContent=scope?scopeName()+' ×':'';
    if(scope)$('#scope-chip').setAttribute('aria-label','移除范围 '+scopeName());
    $('#play-controls').hidden=!dest;
    $('#corridor-label').hidden=mode!=='rail';
    const badge=$('#filter-badge');
    if(badge){
      const activeExtra=[opt.sqm>0,opt.access!==5,opt.egress!==5,!!opt.line,!!$('#second-dest').value.trim(),!!$('#second-limit').value.trim()].filter(Boolean).length;
      badge.textContent=activeExtra?'（已设 '+activeExtra+' 项）':'';
    }
    $('.stage-views').hidden=!dest||regional||fac||trend;
    $('#discover').hidden=!dest||regional||fac||trend;$('#discover').disabled=!rows.length;
    $('#limit-value').textContent=opt.limit+' 分钟';
    $('#stage-title').textContent=dest&&!regional&&!fac?rows.length+' 处候选':'';
    for(const button of $$('[data-topic]'))button.setAttribute('aria-pressed',String(button.dataset.topic===layer));
    const html=themes.controls(opt.room),controls=$('#topic-options');
    if(controls.innerHTML!==html)controls.innerHTML=html;
    controls.hidden=!html;
    renderCrumbs();
    const m=atlasMeasures[key],radial=!!dest&&layout==='radial'&&!regional&&!fac&&!trend;
    $('#game-zoom').hidden=radial;
    const hasValue=radial?rows.some(r=>Number.isFinite(atlasValue(r,key))):[...blocks.values()].some(b=>b.best);
    const hint=key==='commute'&&!dest?'先选工作地':key==='fit'?'先选工作地或填写预算':'当前筛选暂无样本';
    $('#stage-key').innerHTML=(trend?themes.regional.legend('districtRent','local',topic.localMetric,[...blocks.values()].map(b=>b.value)):themes.legend())||('<span class="legend-basis">'+esc((radial?m.name:m.basis)+'（'+m.unit+'）')+'</span>'+
      (hasValue?m.labels.map((v,i)=>'<span class="legend-stop"><i style="background:'+atlasColors[m.lower?i:3-i]+'"></i>'+esc(v)+'</span>').join(''):'<span>'+hint+'</span>')+
      (!radial?'<span class="legend-stop"><i class="no-sample"></i>'+({rent:'缺租金资料',commute:'缺路线',fit:'待核'})[key]+'</span>':'')+
      (!radial&&[...blocks.values()].some(b=>b.state==='outside')?'<span class="legend-stop"><i class="outside-sample"></i>筛选外</span>':'')+
      (!radial&&key==='commute'&&[...recordsById.values()].some(r=>r.mapState==='pending')?'<span class="legend-stop"><i class="partial-sample"></i>住房条件待核</span>':'')+(radial?'<span>每圈 10 分钟</span>':''));
    $('#event-toggle').setAttribute('aria-pressed',String(eventsOn));
    $$('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===mode)));
    $$('[data-layout]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.layout===layout)));
    drawMap(opt);
    renderWorld();renderProbe(opt);evidenceAction();renderList(opt);renderSavedMatrix(opt);
    $('#result-list').hidden=regional||fac;$('.candidate-controls').hidden=regional||fac;
    if((regional||fac)&&$('#saved-matrix'))$('#saved-matrix').hidden=true;
    saveSession();
    $('#decision-status').textContent=[message,storageNotice].filter(Boolean).join(' ');
    focusMarket?.(candidateMap.get(selected)?.hood?.mid??(showingTrend()?streetById.get(blockId)?.mid:null)??null);
  }
  function drawMap(opt){
    const active=lookupRow(selected);
    const plotted=active?.route&&!rows.includes(active)&&layout==='geo'?[...rows,active]:rows;
    const theme=themes.geography();
    if(theme){theme.insights=evidence.get;theme.metric=topic.metric;theme.layer=topic.layer;}
    const areaMeasure=showingTrend()?{paint:n=>themes.regional.paint(n,'districtRent','local',topic.localMetric),home:h=>trendMeasure('hood',h.id)}:
      themes.isFacilities()?{paint:themes.facilities.paint,home:h=>themes.facilities.measure(themes.facilities.records(topic.layer,topic.category,{hood:h.id}),topic.layer)}:null;
    draw({dest,layout,rows:plotted,zone:zoneId,zoneBlocks,legend:$('#west-key'),active,block:blockId,blocks,streetInScope:s=>!scope||(scope.kind==='street'?s.id===scope.id:s.d===scope.id),eligible:dest?rows:preview,record:lookupRow,selected,events:mapEvents,eventId,jobs,rowByStop,limit:opt.limit,mode,layer:topic.layer,theme,insights:evidence.get,areaMeasure,measureName:showingTrend()?(topic.localMetric==='yoy'?'租金同比':'租金环比'):themes.isFacilities()?'已核实'+themes.facilities.noun(topic.layer):atlasMeasures[topic.layer]?.name});
  }
  book=makeJournal({travel,onChange:()=>render(true)});
  $('#corridor').innerHTML='<option value="">不限</option>'+Object.keys(timing.lines).map(n=>'<option value="'+esc(n)+'">'+esc(n)+'号线</option>').join('');
  $('#dest-options').innerHTML=[...new Set([...travel.workplaces,...model.nodes.keys(),...Object.keys(aliases)])].map(n=>'<option value="'+esc(n)+'"></option>').join('');
  const placeOptions=$('#place-options');
  if(placeOptions){
    const names=[...new Set([
      ...data.hoods.flatMap(h=>[h.n,h.footprint?.name].filter(Boolean)),
      ...(data.zones||[]).map(z=>z.n+'片区'),
      ...data.streets.flatMap(s=>[s.n,s.short]),
      ...base.districts.map(d=>d.n)
    ])];
    placeOptions.innerHTML=names.map(n=>'<option value="'+esc(n)+'"></option>').join('');
  }
  const placeJump=$('#place-jump');
  if(placeJump){
    const runJump=()=>{const val=placeJump.value.trim();if(!val)return;if(jumpToPlace(val))placeJump.value='';};
    placeJump.onchange=runJump;
    placeJump.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();runJump();}};
  }
  const matrixToggle=$('#saved-matrix-toggle');
  if(matrixToggle)matrixToggle.onclick=()=>{matrixOpen=!matrixOpen;renderSavedMatrix(options());};
  const resetBtn=$('#reset-filters');
  if(resetBtn)resetBtn.onclick=()=>{
    $('#budget').value='';$('#sqm').value='';$('#room').value='1';
    $('#access').value='5';$('#egress').value='5';$('#corridor').value='';
    $('#second-dest').value='';$('#second-limit').value='';$('#only-saved').checked=false;
    scope=null;eventGroup='';message='已重置全部筛选条件。';$('#dest-error').textContent='';
    render(true);
  };
  const hoverHud=$('#hover-hud');
  if(hoverHud){
    $('#orbit').addEventListener('pointerover',e=>{
      const target=e.target.closest?.('[data-block],[data-zone],[data-hood],[data-st],[data-district],[data-market-event],[data-ev],[data-area-insight]');
      hoverHud.textContent=target?.getAttribute('aria-label')||'';
    });
    $('#orbit').addEventListener('pointerleave',()=>{hoverHud.textContent='';});
  }
  $('.quick-dests').innerHTML=shortcuts.map(n=>'<button type="button" data-work="'+esc(n)+'">'+esc(n)+'</button>').join('');
  $('#dest-form').onsubmit=e=>{e.preventDefault();setDest($('#dest-input').value);};
  $('#time-limit').oninput=()=>render(true);
  for(const id of [...fieldIds.filter(id=>id!=='time-limit'),'only-saved']){
    $('#'+id).onchange=()=>{message='';$('#dest-error').textContent=futureMessage();render(true);};
  }
  function switchTopic(next){
    if(!themes.topics.includes(next))return;
    const wasMacro=themes.isRegion()||themes.isMarket();
    const willMacro=next==='districtRent'||next==='density'||next==='market';
    if((next==='districtRent'||next==='density')&&!themes.isRegion()){
      const location=districtName();
      if(location)topic.region=location;
    }
    if(!wasMacro&&willMacro){
      const view=draw.camera.viewport();
      if(view.k>2.2){
        microCamera=draw.camera.snapshot();
        const targetDist=topic.region||districtName();
        const group=targetDist&&next!=='market'?data.streets.filter(s=>s.d===targetDist):[];
        if(group.length)draw.camera.fit(atlasExtent(group.map(s=>s.bounds)));
        else draw.camera.reset();
      }
    }else if(wasMacro&&!willMacro&&microCamera){
      draw.camera.restore(microCamera);
      microCamera=null;
    }
    insightFocus=null;insightOrigin=null;facilityOrigin=null;topic.layer=next;eventId='';message='';
    if(themes.isRegion()||themes.isMarket()||themes.isFacilities()||showingTrend())layout='geo';
    render(false);
    if(next==='commute'&&!dest){$('#dest-error').textContent='选择工作地后可查看单程时间。';$('#dest-input').focus();}
  }
  function cityView(){
    scope=null;selected='';blockId='';zoneId='';pendingId='';eventId='';topic.region='';topic.marketKey='';
    insightFocus=null;insightOrigin=null;facilityOrigin=null;layout='geo';message='';draw.camera.reset();render(true);
  }
  function findDistrict(name,layer='rent'){
    if(!themes.isDistrict(name))return;
    const group=data.streets.filter(s=>s.d===name);
    if(!group.length)return;
    topic.layer=layer;if(layer==='rent')topic.localMetric='price';topic.region=name;insightFocus=null;insightOrigin=null;scope={kind:'district',id:name};
    selected='';blockId='';zoneId='';pendingId='';eventId='';message='';layout='geo';
    draw.camera.fit(atlasExtent(group.map(s=>s.bounds)));render(true);
  }
  function chooseMarket(key){
    if(key&&!themes.market.has(key))return;
    if(key&&!themes.market.markers(topic.marketFilter).some(m=>m.id===key))topic.marketFilter='';
    insightFocus=null;topic.layer='market';topic.marketKey=key;eventId='';layout='geo';message='';
    if(key){
      const point=themes.market.get(key).xy,view=draw.camera.viewport(),[x,y]=view.pt(point);
      if(x<14||y<14||x>view.w-14||y>view.h-14){
        const other=themes.market.connections(key,topic.marketFilter)[0];
        const extent=atlasExtent((other?[other.from,other.to]:[point]).map(([a,b])=>[a-17,b-17,a+17,b+17]));
        draw.camera.fit(extent);
      }
    }
    render(false);
  }
  function refocus(attr,id){
    const button=Array.from(document.querySelectorAll('[data-'+attr+']')).find(el=>el.getAttribute('data-'+attr)===id);
    button?.focus({preventScroll:true});
  }
  $('#scope-chip').onclick=cityView;
  const exportSaved=$('#export-saved'),importSaved=$('#import-saved');
  if(exportSaved)exportSaved.onclick=()=>{
    const blob=new Blob([JSON.stringify(book.pack(),null,2)],{type:'application/json;charset=utf-8'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download='深圳租房收藏备份-'+new Date(Date.now()+8*3600000).toISOString().slice(0,10)+'.json';
    document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    message='已导出收藏与看房备注备份。';$('#decision-status').textContent=message;
  };
  if(importSaved)importSaved.onchange=async ev=>{
    const file=ev.target.files?.[0];if(!file)return;
    try{
      const n=book.importText(await file.text());
      message='已导入并合并 '+n+' 条收藏/备注记录。';
    }catch(err){message='导入失败：'+(err instanceof SyntaxError?'文件不是有效 JSON':err.message);}
    ev.target.value='';
    $('#decision-status').textContent=[message,storageNotice].filter(Boolean).join(' ');
  };
  $('#game').addEventListener('click',e=>{
    const t=e.target.closest('[data-area-insight],button,[data-st],[data-ev],[data-work],[data-block],[data-zone],[data-hood],[data-district],[data-market-event]');if(!t)return;
    const d=t.dataset;
    if(d.areaInsight){openInsight(d.areaInsight,d.areaId,e.target.closest('[data-insight-part]')?.dataset.insightPart);return;}
    if(d.insightTab&&insightFocus&&['outlook','events','policies'].includes(d.insightTab)){
      insightFocus.part=d.insightTab;render(false);refocus('insight-tab',d.insightTab);return;
    }
    if('insightClose' in d){insightFocus=null;insightOrigin=null;render(false);focusPlace();return;}
    if('insightReturn' in d){
      if(insightOrigin){const {kind,id,layer,view,part}=insightOrigin;topic.layer=layer;draw.camera.restore(view);openInsight(kind,id,part);}
      return;
    }
    if(d.showFacilities){
      const c=candidateMap.get(selected), prevLayer=topic.layer;
      topic.category='';switchTopic(d.showFacilities);
      facilityOrigin=c?{id:c.id,name:c.name,layer:prevLayer}:null;
      if(c?.street&&!themes.facilities.records(d.showFacilities,'',{hood:c.id}).length)openBlock(c.street.id);
      focusPlace();return;
    }
    if('facilityReturn' in d){
      if(facilityOrigin){const origin=facilityOrigin;facilityOrigin=null;topic.layer=origin.layer;savedSelection(origin.id);focusPlace();}
      return;
    }
    if(d.topic){switchTopic(d.topic);return;}
    if(d.localMetric){
      if(['price','yoy','mom'].includes(d.localMetric)){topic.localMetric=d.localMetric;if(showingTrend())layout='geo';insightFocus=null;insightOrigin=null;eventId='';render(false);refocus('local-metric',d.localMetric);}
      return;
    }
    if(d.rentKind){themes.setKind(d.rentKind);eventId='';render(false);refocus('rent-kind',d.rentKind);return;}
    if(d.rentMetric){if(themes.regional.options(topic.kind).some(m=>m.id===d.rentMetric))topic.metric=d.rentMetric;eventId='';render(false);refocus('rent-metric',d.rentMetric);return;}
    if(d.facilityCategory!==undefined){topic.category=d.facilityCategory;eventId='';render(false);refocus('facility-category',d.facilityCategory);return;}
    if(d.areaUp){
      if(d.areaUp==='city')cityView();
      else if(d.areaUp==='district'){if(themes.isRegion()){insightFocus=null;insightOrigin=null;topic.region=d.id;eventId='';render(false);}else findDistrict(d.id,themes.isMarket()?'rent':topic.layer);}
      else if(d.areaUp==='street')openBlock(d.id);
      else if(d.areaUp==='zone')openZone(d.id);
      return;
    }
    if(d.district&&themes.isDistrict(d.district)){insightFocus=null;insightOrigin=null;topic.region=d.district;eventId='';render(false);return;}
    if(d.findDistrict){findDistrict(d.findDistrict);return;}
    if(d.marketFilter!==undefined){
      topic.marketFilter=topic.marketFilter===d.marketFilter?'':d.marketFilter;
      if(!themes.market.markers(topic.marketFilter).some(m=>m.id===topic.marketKey))topic.marketKey='';
      eventId='';render(false);refocus('market-filter',d.marketFilter);return;
    }
    if(d.marketEvent!==undefined||d.ev){
      if(insightFocus)insightOrigin={...insightFocus,layer:topic.layer,view:draw.camera.snapshot()};
      if(d.marketEvent!==undefined)chooseMarket(d.marketEvent);else selectEvent(d.ev);
      if(insightOrigin||d.ev)focusPlace();return;
    }
    if(d.exploreMarket){
      const place=data.hoods.find(h=>h.events?.includes(d.exploreMarket)&&h.id==='e-'+d.exploreMarket)||data.hoods.find(h=>h.events?.includes(d.exploreMarket));
      if(place){scope=null;topic.layer='rent';topic.localMetric='price';layout='geo';recompute();savedSelection(place.id);focusPlace();}
      return;
    }
    if(d.placeRent){topic.layer='rent';topic.localMetric='price';savedSelection(d.placeRent);return;}
    if(t.dataset.zone){openZone(t.dataset.zone);return;}
    if(t.dataset.eventFilter){eventGroup=eventGroup===t.dataset.eventFilter?'':t.dataset.eventFilter;eventId='';render(true);$('#event-legend [data-event-filter="'+t.dataset.eventFilter+'"]').focus({preventScroll:true});return;}
    if(t.id==='color-commute'){switchTopic('commute');return;}
    if(t.dataset.block){openBlock(t.dataset.block);return;}
    if(t.dataset.zoom){draw.camera.control(t.dataset.zoom);return;}
    if(t.dataset.bookmark){toggleBookmark(t.dataset.bookmark);return;}
    if(t.id==='block-back'){selected='';blockId='';zoneId='';pendingId='';draw.camera.reset();render(false);return;}
    if(t.id==='choose-work'){$('#dest-input').focus();pendingId=selected;return;}
    if(t.dataset.hood){savedSelection(t.dataset.hood);focusPlace();return;}
    if(t.dataset.work)setDest(t.dataset.work);
    else if(t.dataset.pick||t.dataset.st){if(themes.isRegion()||themes.isMarket())topic.layer='rent';savedSelection(t.dataset.pick||t.dataset.st);focusPlace();}
    else if(t.dataset.mode){mode=t.dataset.mode;render(true);}
    else if(t.dataset.layout){layout=t.dataset.layout;render(false);}
    else if(t.id==='discover')discover();
    else if(t.id==='event-toggle'){eventsOn=!eventsOn;if(!eventsOn){eventId='';eventLegendOpen=false;}render(true);}
    else if(t.id==='event-filter-toggle'){eventLegendOpen=!eventLegendOpen;renderWorld();}
    else if(t.id==='back-probe'){eventId='';render(false);}
  });
  $('#orbit').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();const tag=e.target.closest('[data-area-insight],[data-work],[data-st],[data-ev],[data-block],[data-zone],[data-hood],[data-district],[data-market-event]');if(tag)tag.dispatchEvent(new MouseEvent('click',{bubbles:true}));}});
  $('#method-text').innerHTML='<p>地铁按工作日公开时刻表估算相邻站车程，每次候车 3 分钟、换乘步行 5 分钟。园区与站口不同点按直线距离 × 1.25、步速 75 米/分钟估算，取它与所填步行时间中的较大值。相同参照站按两端步行合计。企鹅岛另计接驳候车及乘车，以预计出发时段能乘车为前提。'+lnk(timing.sources[0].url,'地铁线网')+'</p>'+(transferSources?'<details><summary>企鹅岛接驳线路与时段</summary><ul>'+transferSources+'</ul></details>':'')+'<p>公交从 '+esc(busPeriod)+' 站序中寻找直达或一次换乘，园区接驳参照各线公告。普通公交每段取站数 × 2.3 分钟与沿途站间直线距离按 40 公里/小时折算的较大值，每次候车按 5 分钟估算。高峰专线和班次须另查。驾车使用 '+esc(travel.driving.date)+' 开放街图道路矩阵，另加取车和停车后步行。公交、驾车图中连线只连接两端。'+lnk(travel.bus.source,'公交数据 CC BY 4.0')+' '+lnk(travel.driving.documentation,'OSRM')+' '+lnk('https://www.openstreetmap.org/copyright','© OpenStreetMap contributors')+'</p><p>有预算时匹配同居室的商圈月租、项目样本或整租挂牌。指定面积后，仅匹配记录了面积的整租挂牌和个人房源。同一处优先展示可比的商圈或项目样本，同类记录取符合条件的较低价。商圈及项目均值缺少面积，不能直接推算指定面积房租。请在看房时核实签约价和费用。</p>';
  let scheduled=false;if(typeof ResizeObserver==='function')new ResizeObserver(()=>{if(!$('#game').hidden&&!scheduled){scheduled=true;requestAnimationFrame(()=>{scheduled=false;drawMap(options());});}}).observe($('#orbit'));
  restoreSession();
  const savedFootprint=data.hoods.find(h=>h.id===selected)?.footprint;
  if(savedFootprint)draw.camera.fit(savedFootprint.bounds);
  else if(zoneId)draw.camera.fit(zoneById.get(zoneId).bounds);
  else if(blockId)draw.camera.fit(streetById.get(blockId).bounds);
  render(true);
  return {show(){render(true);},refresh(){render(true);},updateDistricts(report){if(themes.regional.update(report))render(false);},revealEvent:selectEvent,
    context(){const c=candidateMap.get(selected);return {street:c?.street?.id||blockId||undefined,hood:c?.hood?.id,district:c?.street?.d||c?.node.district||streetById.get(blockId)?.d};},
    explore(area){
      if(!area)return;
      eventId='';message='';
      if(area.kind==='zone'){scope=null;recompute();openZone(area.id);return;}
      if(area.kind==='hood'){scope=null;render(true);savedSelection(area.id);if(dest)focusPlace();return;}
      scope=area;selected='';zoneId='';blockId=area.kind==='street'?area.id:'';
      const group=area.kind==='street'?[streetById.get(area.id)]:data.streets.filter(s=>s.d===area.id);
      if(group[0])draw.camera.fit(atlasExtent(group.map(s=>s.bounds)));render(true);
      if(!dest){$('#dest-error').textContent='已选'+scopeName()+'，选择工作地后可查看此范围内的候选。';$('#dest-input').focus();}
    }};
};
