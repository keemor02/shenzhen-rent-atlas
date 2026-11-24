'use strict';
window.initFineAtlas = function initFineAtlas({data, base, go, ensureMarket}) {
  const $ = id => document.getElementById(id);
  const map = $('fine-map'), panel = $('fine-inspector');
  const streets = data.streets, hoods = data.hoods;
  const byId = (rows, id) => id == null ? null : rows.find(item => String(item.id) === String(id));
  const west = streets.filter(row => ['新安','西丽'].includes(row.short));
  const topics = ['price','growth','now','outlook'];
  const rooms = ['一室','二室','三室','四室','四室以上'];
  const metrics = {market:'商圈分户型月租', listed:'街道住宅挂牌单价', village:'街道城中村综合单价', official:'2022商品住房参考价', project:'项目与村样本'};
  const state = {level:'street', topic:'price', metric:'market', scope:'west', street:west.find(s=>s.short==='新安')?.id ?? streets[0]?.id,
    hood:null, zoomStreet:false, room:'1', period:'2026-10', growth:'yoy',followLatest:true};
  const money = n => Number(n).toLocaleString('zh-CN',{maximumFractionDigits:2});
  const today=new Date(), openMonth=today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0');
  const pct = n => (n>0?'+':'')+money(n)+'%';
  const finite = n => typeof n === 'number' && Number.isFinite(n);
  const usablePoint = p => Array.isArray(p) && p.length===2 && p.every(finite);
  const esc = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const url = s => /^https?:\/\//i.test(s||'') ? s : null;
  const link = (label, src) => url(src) ? '<a href="'+esc(src)+'" target="_blank" rel="noopener noreferrer">'+esc(label)+'</a>' : '';
  const tag = (name, cls, body) => '<'+name+' class="'+cls+'">'+body+'</'+name+'>';
  const meta = t => tag('div','fine-meta',esc(t));
  const sect = (heading, body) => body ? tag('div','fine-section','<h3>'+esc(heading)+'</h3>'+body) : '';
  const text = t => t ? '<p>'+esc(t)+'</p>' : '';
  const links = pairs => tag('div','fine-links',pairs.filter(p=>Array.isArray(p)&&url(p[1])).map(p=>link(p[0],p[1])).join(' '));
  const selStreet = () => byId(streets,state.street);
  const selHood = () => byId(hoods,state.hood);
  const localProjects = street => hoods.filter(h=>String(h.street)===String(street?.id)&&h.project).map(h=>h.project);
  const selected = () => state.level==='street'?selStreet():selHood();
  const getMarket = item => item?.mid==null ? null : data.markets[item.mid];
  const currentRent = item => window.latestMarketRent(getMarket(item),state.room,data.asof);
  const marketAnchors = new Map(hoods.filter(h=>h.mid!=null&&usablePoint(h.xy)).map(h=>[h.mid,h]));
  const childrenByStreet=new Map(streets.map(s=>[s.id,hoods.filter(h=>h.street===s.id)]));
  const atlas=makeBlockMap(map,base,data,esc,chart,()=>!$('fine').hidden);
  let lastFocus='', zoneId='',blocks=new Map();
  const zones=data.zones||[],zoneById=new Map(zones.map(z=>[z.id,z]));
  const partialNote = status => status.asof?'月内样本，采集于 '+status.asof:'历史缓存缺少该户型的核验日期，完整月状态待核实';
  const selectedMarket = () => selected()?.mid ?? null;
  const eventMap = new Map((base.events||[]).map(ev=>[ev.key,ev]));
  const visual = () => state.topic==='price'||state.topic==='growth';
  const sampleRoom = m => {
    const s=String(m.rooms||'');
    if (/四室以上|五室|六室/.test(s)) return '5';
    const k=rooms.slice(0,4).findIndex(x=>s.includes(x));
    return k>=0?String(k+1):/单间|开间/.test(s)?'1':'';
  };
  const wrapOptions = (label, key, current, choices) => '<label>'+esc(label)+'<select data-field="'+key+'" aria-label="'+esc(label)+'">'+choices.map(([v,t])=>'<option value="'+esc(v)+'"'+(String(v)===String(current)?' selected':'')+'>'+esc(t)+'</option>').join('')+'</select></label>';
  const buttons = (items, attr, value) => items.map(([key,title])=>'<button type="button" class="fine-link-button" data-'+attr+'="'+esc(key)+'"'+(key===value?' aria-pressed="true"':'')+'>'+esc(title)+'</button>').join('');
  const defaultHood = street => street==null?null:hoods.find(h=>String(h.street)===String(street)&&h.project)??hoods.find(h=>String(h.street)===String(street));
  const streetOf = item => state.level==='street'?item:byId(streets,item?.street);
  function streetInScope(s) {
    return state.scope==='all'||(state.scope==='west'?west.some(w=>w.id===s.id):s.d===state.scope);
  }
  function hoodInScope(h) {
    return state.scope==='all'||(state.scope==='west'?west.some(w=>String(w.id)===String(h.street)):h.d===state.scope);
  }
  function validEvents(item) {return (item?.events||[]).map(k=>eventMap.get(k)).filter(Boolean);}
  function observation(item) {
    if (!item) return null;
    const growth=state.topic==='growth', measure=state.growth;
    if (state.metric==='market') {
      const market=getMarket(item), history=market?.months||{}, row=history[state.period]?.[state.room];
      if (!row) return null;
      const [y,m]=state.period.split('-').map(Number);
      const prev=m===1?(y-1)+'-12':y+'-'+String(m-1).padStart(2,'0');
      const priorRow=history[prev]?.[state.room],prior=priorRow?.price;
      const ch=measure==='yoy'?row.yoy:(finite(prior)&&prior>0?(row.price/prior-1)*100:null);
      return {v:growth?ch:row.price, price:row.price, unit:'元/月', at:state.period, src:market.url,
        status:window.marketPeriodStatus(state.period,row,data.asof),
        priorStatus:growth&&measure==='mom'&&priorRow?window.marketPeriodStatus(prev,priorRow,data.asof):null,
        scope:market.name+'商圈 · '+rooms[Number(state.room)-1], note:'平台按居室数统计月租总额，未披露样本量、面积与物业类型构成。', yoy:row.yoy};
    }
    if (state.metric==='project') {
      const project=item.project, sample=(project?.metrics||[]).filter(m=>sampleRoom(m)===state.room&&String(m.period).startsWith(state.period));
      const first=growth ? sample.find(m=>finite(m[measure])) : sample.find(m=>finite(m.price));
      return first?{v:growth?first[measure]:first.price,price:first.price,unit:first.unit||'元/月',at:first.period,src:first.source,scope:project.category+' · '+first.rooms,note:first.scope+(sample.length>1?' 同月同户型有 '+sample.length+' 条记录，下方列出各条价格与来源。':''),project:true}:null;
    }
    if (state.metric==='official') {
      return finite(item.ref)?{v:growth?null:item.ref,unit:'元/㎡·月',at:'2022年度',src:data.refSource,scope:'商品住房租赁参考价',note:'按普通装修、基本家具家电口径发布，供历史比较。'}:null;
    }
    const name=state.metric==='listed'?'住宅挂牌均价':'城中村综合租金';
    const row=(item.rents||[]).find(r=>r.type===name);
    return row?{v:growth?row[measure]:row.price,price:row.price,unit:row.unit,at:row.asof,src:row.source,scope:name,note:row.sample!=null?'本月挂牌 '+row.sample+' 套。':'来源未公布本街道样本套数。',mom:row.mom}:null;
  }
  function mapValue(item) {
    if (visual()) return observation(item)?.v;
    if (validEvents(item).length) return 2;
    if (item.project && (state.topic==='now' || item.project.expectation)) return 1;
    if(item.p && localProjects(item).length) return 1;
    if(state.topic==='now' && (currentRent(item)||item.rents?.length)) return 1;
    return null;
  }
  const priceColors=['#317c6b','#5e9b81','#86b799','#bcbd92','#d3aa7e','#b87958'];
  const changeColors=['#216e7e','#65a6af','#bbd5cf','#e8dfb9','#da9d7b','#aa563f'];
  const statusColors=['#c3d7b9','#468c83'];
  function bins() {
    if(!visual())return {bounds:[1],colors:statusColors,labels:state.topic==='now'?['有租金样本','有片区事件']:['项目观察条件','有事件观察条件']};
    if(state.topic==='growth')return {bounds:[-10,-3,0,3,10],colors:changeColors,labels:['低于 −10%','−10% 至 −3%','−3% 至 0%','0% 至 +3%','+3% 至 +10%','+10% 及以上']};
    return ['market','project'].includes(state.metric)?
      {bounds:[1800,2800,4500,6500,10000],colors:priceColors,labels:['<1,800','1,800–2,799','2,800–4,499','4,500–6,499','6,500–9,999','≥10,000 元/月']}:
      {bounds:[35,50,65,85,105],colors:priceColors,labels:['<35','35–<50','50–<65','65–<85','85–<105','≥105 元/㎡·月']};
  }
  function paint(v) {
    if(!finite(v)) return null;
    if(!visual())return statusColors[v-1];
    const b=bins(),i=b.bounds.findIndex(n=>v<n);
    return b.colors[i<0?b.colors.length-1:i];
  }
  function metricOptions() {return state.level==='street'?['market','listed','village','official']:['market','project'];}
  function periods() {
    if(state.metric==='project')return [...new Set(hoods.flatMap(h=>(h.project?.metrics||[]).map(m=>String(m.period).slice(0,7))))].sort().reverse();
    const dates=new Set(['2026-10']);
    for(const m of data.markets) for(const month of Object.keys(m.months||{})) dates.add(month);
    return [...dates].filter(x=>/^\d{4}-\d{2}$/.test(x)).sort().reverse();
  }
  function setMetric(metric) {
    state.metric=metric;
    if(metric==='project'){state.period=periods()[0]||'2026-11';state.growth='mom';}
    if(metric==='market'){state.period='2026-10';state.growth='yoy';state.followLatest=true;}
    if(metric==='listed')state.growth='mom';
  }
  function toolbar() {
    document.querySelectorAll('#fine [data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===state.topic)));
    let filter='';
    if(visual()) {
      filter+=wrapOptions('口径','metric',state.metric,metricOptions().filter(x=>state.topic!=='growth'||x!=='official').map(k=>[k,metrics[k]]));
      if(['market','project'].includes(state.metric)){
        filter+=wrapOptions('户型','room',state.room,rooms.map((r,i)=>[i+1,r]));
        const market=getMarket(selected());
        filter+=wrapOptions('月份','period',state.period,periods().map(m=>{
          const row=market?.months?.[m]?.[state.room];
          const status=state.metric==='market'&&row?window.marketPeriodStatus(m,row,data.asof):null;
          const note=status&&!status.complete?(status.asof?'（月内）':'（待核实）'):'';
          return [m,m+(note||((!status&&m===openMonth)?'（月内）':''))];
        }));
      }
      if(state.topic==='growth')filter+=wrapOptions('变化','growth',state.growth,[['yoy','同比'],['mom','环比']]);
    }
    $('fine-filters').innerHTML=filter;$('fine-filter-drawer').hidden=!filter;
    const districts=[...new Set(streets.map(s=>s.d))];
    const local=streets.filter(streetInScope), inHood=hoods.filter(h=>hoodInScope(h)&&(!state.zoomStreet||String(h.street)===String(state.street)));
    let tools=wrapOptions('范围','scope',state.scope,[['west','新安与西丽'],['all','深圳全市'],...districts.map(d=>[d,d])]);
    tools+=wrapOptions('街道','street',state.zoomStreet?state.street:'',[['','查看范围内全部'],...local.map(s=>[s.id,s.n])]);
    tools+=wrapOptions('片区','hood',state.level==='hood'?(state.hood??''):'',[['','全部片区'],...inHood.map(h=>[h.id,h.n])]);
    $('geo-tools').innerHTML=tools;
  }
  function spark(market) {
    const points=Object.entries(market?.months||{}).filter(([k,v])=>k<=state.period&&finite(v[state.room]?.price)).sort(([a],[b])=>a.localeCompare(b)).slice(-8);
    if(points.length<2)return '';
    const vals=points.map(p=>p[1][state.room].price),lo=Math.min(...vals),hi=Math.max(...vals),span=hi-lo||1;
    const months=points.map(([m])=>Number(m.slice(0,4))*12+Number(m.slice(5)));
    const xy=vals.map((v,i)=>[(4+(months[i]-months[0])*211/(months.at(-1)-months[0])).toFixed(1),(hi===lo?24:42-(v-lo)*34/span).toFixed(1)]);
    const path=xy.map((point,i)=>(i&&months[i]===months[i-1]+1?'L':'M')+point.join(',')).join(' ');
    const dots=xy.map(([x,y])=>'<circle cx="'+x+'" cy="'+y+'" r="2" fill="var(--teal)"/>').join('');
    return '<div class="fine-series"><h3 style="font-size:12px;margin:4px 0">同商圈、同户型月租</h3><svg class="fine-trend" viewBox="0 0 220 48" preserveAspectRatio="none" role="img" aria-label="'+esc(points.map(([k,v])=>k+' '+v[state.room].price+'元').join('，'))+'"><path d="'+path+'" fill="none" stroke="var(--teal)" stroke-width="2" vector-effect="non-scaling-stroke"/>'+dots+'</svg><div class="fine-trend-axis"><span>'+esc(points[0][0])+'</span><span>'+esc(points.at(-1)[0])+'</span></div></div>';
  }
  function marketsWithoutAnchor(district) {
    if(!visual()||state.metric!=='market')return '';
    const lines=[];
    for(const [mid,market] of data.markets.entries()){
      if(market.district!==district||marketAnchors.has(mid))continue;
      const ob=observation({mid}),value=ob?.v;
      const figure=finite(value)?(state.topic==='growth'?pct(value):money(value)+' 元/月'):'缺数';
      const status=ob?.status&&!ob.status.complete?' · '+partialNote(ob.status):'';
      lines.push('<li>'+esc(market.name+' · '+figure+status)+' '+link('来源',market.url)+'</li>');
    }
    if(!lines.length)return '';
    return '<details><summary>'+esc(district)+'未定位商圈（'+lines.length+'）</summary>'+meta(state.period+' · '+rooms[Number(state.room)-1]+' · '+(state.topic==='growth'?(state.growth==='yoy'?'同比':'环比'):'月租'))+'<ul style="padding-left:17px">'+lines.join('')+'</ul></details>';
  }
  function inspector() {
    const s=selStreet(),h=selHood(),item=selected();
    if(!item){panel.innerHTML=meta(state.level==='hood'?'当前范围没有可定位的代表片区。':'请选择街道。');return;}
    const zone=zoneById.get(zoneId);
    if(zone&&state.level==='street'){
      const homes=hoods.filter(h=>h.zone===zone.id&&h.footprint);
      panel.innerHTML=meta(selStreet().n+' · 站点参考区')+'<h2>'+esc(zone.n)+'片区</h2>'+tag('div','fine-chips',buttons(homes.map(h=>[h.id,h.footprint.name]),'hoodgo'))+'<button class="fine-link-button" data-parent="'+esc(zone.street)+'">返回街道</button>';return;
    }
    const p=state.level==='hood'?item.project:null, st=streetOf(item), nearby=validEvents(item);
    const environment = (window.worldEvents||[]).filter(e=>e.near?.some(station=>state.level==='street'?item.stations.includes(station):item.station===station));
    let body=tag('div','fine-kicker',esc([item.d,state.level==='street'?'行政街道':st?.n||'代表片区'].filter(Boolean).join(' · ')))+'<h2>'+esc(item.n)+'</h2>';
    if(item.footprint)body+=meta(item.footprint.kind)+'<details><summary>范围来源</summary>'+links(item.footprint.ways.map((id,i)=>['地块 '+(i+1),'https://www.openstreetmap.org/way/'+id]))+'</details>';
    if(state.level==='hood'&&st){
      const parentZone=zoneById.get(item.zone);
      body+=parentZone?'<button type="button" class="fine-link-button" data-zone="'+esc(parentZone.id)+'">返回'+esc(parentZone.n)+'片区</button>':
        '<button type="button" class="fine-link-button" data-parent="'+esc(st.id)+'">返回街道</button>';
    }
    if(visual()) {
      const ob=observation(item),v=ob?.v,period=ob?.at||(['market','project'].includes(state.metric)?state.period:{listed:'2026-10',village:'2026-Q1',official:'2022年度'}[state.metric]);
      body+=meta([period,ob?.scope||metrics[state.metric]].filter(Boolean).join(' · '));
      if(finite(v)){
        body+=tag('div','fine-number',esc(state.topic==='growth'?pct(v):money(v))+'<small>'+esc(state.topic==='growth'?(state.growth==='yoy'?'同比':'环比'):ob.unit)+'</small>');
        if(state.topic==='growth'&&finite(ob.price))body+=meta('本期 '+money(ob.price)+' '+ob.unit);
        if(ob.status&&!ob.status.complete)body+=meta(partialNote(ob.status));
        if(ob.priorStatus&&!ob.priorStatus.complete)body+=meta('环比的基期为'+partialNote(ob.priorStatus));
        body+='<details><summary>口径与来源</summary>'+text(ob.note)+(ob.src?links([['原始资料',ob.src]]):'')+'</details>';
        if(state.metric==='market')body+=spark(getMarket(item));
        if(state.metric==='official')body+=links([['市住建局发布通知','https://zjj.sz.gov.cn/xxgk/tzgg/content/post_10199761.html']]);
      }else{
        body+=tag('div','fine-status',state.topic==='growth'?'缺少可比涨跌数据':'暂无此口径数据');
        if(ob?.price!=null)body+=meta('已知本期 '+money(ob.price)+' '+ob.unit);
        if(ob?.src)body+=links([['来源',ob.src]]);
      }
      if(state.metric==='village'&&!finite(v)&&state.level==='street'){
        for(const g of item.groups||[]){if(g.range)body+=sect('多个街道的区间',text((g.streets||[]).join('、')+'的综合均价落在 '+g.range.join('–')+' 元/㎡·月。')+links([['分组资料',g.source]]));}
      }
    }else{
      const projects=state.level==='street'?localProjects(item):[];
      const mk=getMarket(item), current=currentRent(item);
      if(state.topic==='now'&&current)body+=sect('同名商圈租金',text(current.period+'，'+mk.name+'商圈'+rooms[Number(state.room)-1]+'月租为 '+money(current.row.price)+' 元'+(finite(current.row.yoy)?'，同比 '+pct(current.row.yoy):'')+'。')+(current.complete?'':meta(partialNote(current)))+links([['商圈月报',mk.url]]));
      if(state.topic==='now')for(const row of item.rents||[]){
        body+=sect(row.type,meta(row.asof)+text(money(row.price)+' '+row.unit+(row.sample!=null?'，挂牌 '+row.sample+' 套。':'，来源未披露样本量。'))+links([['街道数据来源',row.source]]));
      }
      if(projects.length){const hints=projects.filter(pr=>state.topic==='now'?pr.event:pr.expectation).slice(0,2);body+=sect(state.topic==='now'?'街道内样本':'街道内项目观察条件',hints.map(pr=>text(pr.area+' · '+(state.topic==='now'?pr.event:pr.expectation))+links([['样本来源',pr.metrics?.[0]?.source]])).join(''));}
      if(p && state.topic==='now')body+=sect(p.category||'项目现况',text(p.event));
      if(p && state.topic==='outlook')body+=sect('项目观察条件',text(p.expectation));
      for(const e of nearby) {
        const details=state.topic==='now'?text(e.fact):text(e.view)+text(e.test);
        body+=sect(e.title,meta((e.date||'')+' · '+(e.type||''))+details+links(e.ref||[]));
      }
      if(!(p||nearby.length||projects.length||(state.topic==='now'&&(current||item.rents?.length||environment.length))))body+=text(state.topic==='now'?'目前没有核实到可定位的片区事件。可切换租金水平查看样本。':'目前没有可核实的局部供需事件可用于判断后续租金。');
    }
    if(state.topic==='now'&&environment.length)body+=sect('周边公共事件',tag('div','fine-chips',environment.map(e=>'<button data-worldgo="'+esc(e.id)+'">'+atlasEventIcon(atlasEventType(e))+esc(e.name)+'</button>').join('')));
    if(p && visual()){
      const samples=(p.metrics||[]).map(m=>'<li style="margin:5px 0">'+esc(m.rooms+' · '+money(m.price)+' '+m.unit)+(m.sqm?esc(' · '+m.sqm+'㎡'):'')+'<br>'+esc(m.period)+' · '+esc(m.scope)+' '+link('来源',m.source)+'</li>').join('');
      if(samples)body+='<details><summary>项目样本（'+p.metrics.length+'）</summary><ul style="padding-left:17px">'+samples+'</ul></details>';
    }
    if(state.level==='street'){
      const local=zones.filter(z=>z.street===s.id);if(local.length)body+=tag('div','fine-chips',buttons(local.map(z=>[z.id,z.n]),'zone'));
      const children=hoods.filter(x=>String(x.street)===String(s.id));
      if(children.length)body+='<div class="fine-section"><h3>街内片区</h3>'+tag('div','fine-chips',buttons(children.slice(0,3).map(c=>[c.id,c.n]),'hoodgo'))+(children.length>3?'<details><summary>更多片区（'+(children.length-3)+'）</summary>'+tag('div','fine-chips',buttons(children.slice(3).map(c=>[c.id,c.n]),'hoodgo'))+'</details>':'')+'</div>';
      if(s.stations?.length)body+='<details><summary>街道内地铁站（'+s.stations.length+'）</summary>'+text(s.stations.join('、'))+'</details>';
    }else{
      const ps=p?.context_sources||[];if(ps.length||p?.admin_source)body+='<details><summary>位置来源</summary>'+links([...ps.map((u,i)=>['片区资料 '+(i+1),u]),['项目位置',p?.admin_source]])+'</details>';
      const anchor=[h.station?'定位站 '+h.station:null,h.anchor].filter(Boolean);
      if(anchor.length)body+=meta(anchor.join(' · '));
    }
    body+=marketsWithoutAnchor(item.d);
    const gm=data.geoMeta||{};
    body+='<details><summary>地图与数据说明</summary>'+text('街道采用约2020年参考边界，填海地段可能有差异。片区标签采用已收录的定位。商圈数据采用平台样本。')+links([['边界出处',gm.source],['官方街道名册',gm.districtRoster]])+'</details>';
    panel.innerHTML=body;
  }
  function setCamera(){
    const parent=selStreet(),h=selHood(),key=(zoneId||'')+'|'+(h?.footprint?h.id:'')+'|'+state.scope+'|'+(state.zoomStreet?parent?.id||'':'')+'|'+(state.level==='hood'&&h&&!h.street?h.id:'');
    if(lastFocus===key)return;
    lastFocus=key;
    if(state.level==='hood'&&h?.footprint)atlas.camera.fit(h.footprint.bounds);
    else if(zoneId)atlas.camera.fit(zoneById.get(zoneId).bounds);
    else if(state.level==='hood'&&h&&!h.street&&usablePoint(h.xy)){
      const [x,y]=h.xy;atlas.camera.fit([x-20,y-15,x+20,y+15]);
    }else{
      const group=state.zoomStreet&&parent?[parent]:streets.filter(streetInScope);
      atlas.camera.fit(group.length?atlasExtent(group.map(s=>s.bounds)):atlas.world);
    }
  }
  function streetValue(s){
    if(!visual())return {value:mapValue(s)};
    if(state.metric==='market'){
      const anchor=s.mid!=null?marketAnchors.get(s.mid):null;
      return anchor?.street===s.id?observation(s):null;
    }
    if(state.metric==='project'){
      const records=childrenByStreet.get(s.id).map(observation).filter(ob=>finite(ob?.v)&&finite(ob.price));
      return records.sort((a,b)=>a.price-b.price)[0];
    }
    return observation(s);
  }
  function chart(){
    const current=selHood(),parent=selStreet();
    const view=atlas.camera.viewport();
    const places=(state.zoomStreet&&parent?childrenByStreet.get(parent.id):[]).slice();
    if(view.k>3&&!state.zoomStreet)for(const h of hoods){
      if(!hoodInScope(h)||places.includes(h)||!usablePoint(h.xy))continue;
      const [x,y]=view.pt(h.xy);if(x>0&&x<view.w&&y>0&&y<view.h)places.push(h);
    }
    if(state.level==='hood'&&current&&!places.includes(current))places.unshift(current);
    const markers=places.filter(h=>!h.footprint||view.k<8).sort((a,b)=>Number(b===current)-Number(a===current)).filter(h=>usablePoint(h.xy)).map(h=>({
      id:h.id,name:h.n,zone:h.zone,xy:h.xy,kind:'hoodgo',active:state.level==='hood'&&h===current,always:true
    }));
    const sample=h=>{
      const v=mapValue(h), ob=visual()?observation(h):null;
      return {value:v,text:finite(v)?(visual()?(state.topic==='growth'?pct(v):money(v)+' '+ob.unit):bins().labels[v-1]):'缺少本项资料'};
    };
    const local={zone:zoneId,selected:state.level==='hood'?current?.id:null,action:'hoodgo',legend:$('fine-west-key'),placeData:sample,
      zoneData:z=>{const h=hoods.find(h=>h.zone===z.id&&h.station===z.n&&h.mid!=null);return h&&state.metric==='market'&&visual()?sample(h):null;}};
    const ev=state.topic==='now'?(window.worldEvents||[]):[];
    const special=ev.map(e=>({kind:'worldgo',symbol:'event',event:e,xy:atlas.project(e.coord)}));
    atlas.draw({blocks,local,special,color:paint,inScope:streetInScope,activeStreet:state.zoomStreet?parent?.id:null,places:markers});
  }
  function refresh(){
    if($('fine').hidden)return;
    if(state.metric==='market'&&state.followLatest){const current=currentRent(selected());if(current)state.period=current.period;}
    toolbar();setCamera();
    const {labels,colors}=bins();
    blocks=new Map(streets.map(s=>{
      const ob=streetValue(s),v=visual()?ob?.v:ob?.value;
      const text=finite(v)?(visual()?(state.topic==='growth'?pct(v):money(v)+' '+ob.unit):labels[v-1]):'';
      return [s.id,{value:v,text}];
    }));
    const basis=visual()?(state.metric==='market'?'街道同名商圈':state.metric==='project'?'街内最低价项目':metrics[state.metric]):'街内资料';
    const period=visual()&&['market','project'].includes(state.metric)?' · '+rooms[Number(state.room)-1]+' · '+state.period:'';
    $('fine-legend').innerHTML='<span class="legend-basis">'+esc(basis+period)+'</span>'+labels.map((l,i)=>'<span><i style="background:'+colors[i]+'"></i>'+esc(l)+'</span>').join('')+'<span><i class="no-data"></i>缺资料</span>';
    const eventsKey=$('fine-event-key');eventsKey.hidden=state.topic!=='now';
    if(!eventsKey.hidden)eventsKey.innerHTML=[...new Set((window.worldEvents||[]).map(atlasEventType))].map(t=>'<span>'+atlasEventIcon(t)+atlasEventTypes[t].label+'</span>').join('');
    chart();inspector();
  }
  function selectHood(h){state.hood=h?.id??null;if(h)state.street=h.street??null;}
  function latestMarket(){
    const mid=selectedMarket();
    if(mid!=null&&typeof ensureMarket==='function') {
      const result=ensureMarket(mid);if(result&&typeof result.catch==='function')result.catch(()=>{});
    }
  }
  function show(level,streetId,hoodId) {
    if(!['street','hood'].includes(level))return;
    const old=state.level;state.level=level;zoneId='';
    const s=byId(streets,streetId);
    if(s){state.street=s.id;if(!streetInScope(s))state.scope=s.d;state.zoomStreet=true;}
    if(level==='hood'){
      const h=byId(hoods,hoodId) || (old==='hood'&&streetId==null?selHood():null) ||defaultHood(state.street);
      selectHood(h);
      if(h){
        if(!hoodInScope(h))state.scope=h.d;
        state.zoomStreet=!!h.street;
        if(!metricOptions().includes(state.metric)||(h.project&&state.metric==='market'&&h.mid==null))setMetric(h.project?'project':'market');
        if(state.metric==='project'&&!h.project)setMetric('market');
      }
    }else{
      state.hood=null;
      if(!metricOptions().includes(state.metric))setMetric('market');
    }
    for(const btn of document.querySelectorAll('#levels [data-level]'))btn.setAttribute('aria-pressed',String(btn.dataset.level==='street'));
    refresh();latestMarket();
  }
  function change(field,value) {
    if(field==='scope'){
      zoneId='';
      state.scope=value;state.zoomStreet=false;state.level='street';state.hood=null;
      const local=streets.filter(streetInScope);
      if(!local.some(v=>v.id===state.street))state.street=(local.find(v=>v.mid!=null)||local[0])?.id??null;
      if(!metricOptions().includes(state.metric))setMetric('market');
    }else if(field==='street'){
      zoneId='';
      if(value){show('street',value);return;}
      state.level='street';state.zoomStreet=false;state.hood=null;if(!metricOptions().includes(state.metric))setMetric('market');
    }else if(field==='hood'){
      if(value){show('hood',null,value);return;}
      show('street',state.street);return;
    }else if(field==='metric')setMetric(value);
    else if(['period','growth','room'].includes(field)){state[field]=value;if(field==='period')state.followLatest=false;}
    refresh();if(['scope','street','metric'].includes(field))latestMarket();
  }
  function selectZone(id){const z=zoneById.get(id);if(!z)return;state.street=z.street;state.hood=null;state.level='street';state.zoomStreet=true;zoneId=id;if(!streetInScope(selStreet()))state.scope=selStreet().d;if(!metricOptions().includes(state.metric))setMetric('market');refresh();}
  $('fine').addEventListener('change',e=>{if(e.target.dataset.field)change(e.target.dataset.field,e.target.value);});
  $('fine').addEventListener('click',e=>{
    const btn=e.target.closest('[data-view],[data-zoom],[data-block],[data-zone],[data-hoodgo],[data-parent],[data-worldgo]');
    if(!btn)return;
    if(btn.dataset.view&&topics.includes(btn.dataset.view)){
      state.topic=btn.dataset.view;
      if(state.topic==='growth'&&state.metric==='official')setMetric('listed');
      refresh();return;
    }
    if(btn.dataset.zone){selectZone(btn.dataset.zone);return;}
    if(btn.dataset.worldgo){go('event',btn.dataset.worldgo);return;}
    if(btn.dataset.hoodgo){show('hood',null,btn.dataset.hoodgo);return;}
    if(btn.dataset.block||btn.dataset.parent){show('street',btn.dataset.block||btn.dataset.parent);return;}
    if(btn.dataset.zoom==='reset'){zoneId='';state.scope='all';state.zoomStreet=false;state.hood=null;state.level='street';if(!metricOptions().includes(state.metric))setMetric('market');lastFocus='';refresh();latestMarket();return;}
    if(btn.dataset.zoom)atlas.camera.control(btn.dataset.zoom);
  });
  map.addEventListener('keydown',e=>{
    if(e.key!=='Enter'&&e.key!==' ')return;
    const el=e.target.closest('[data-block],[data-zone],[data-hoodgo],[data-worldgo]');if(!el)return;
    e.preventDefault();if(el.dataset.worldgo)go('event',el.dataset.worldgo);else if(el.dataset.zone)selectZone(el.dataset.zone);else if(el.dataset.block)show('street',el.dataset.block);else show('hood',null,el.dataset.hoodgo);
  });
  let resizeFrame;
  const resized=()=>{if(!$('fine').hidden){cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(chart);}};
  if(typeof ResizeObserver!=='undefined')new ResizeObserver(resized).observe(map);
  else window.addEventListener('resize',resized);
  return {show,refresh,selectedMarket,area(){if(zoneId)return {kind:'zone',id:zoneId};const item=selected();return item?{kind:state.level,id:item.id}:null;}};
};
