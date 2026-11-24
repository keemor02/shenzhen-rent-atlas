/* District statistics, market events and local facilities share the exploration camera. */
function makeMapThemes(base,data,facilityData,esc) {
  const regional=makeRegionalLayers(base,esc),market=makeMarketEvents(base,esc);
  const facilities=makeFacilities(facilityData,data,esc);
  const topics=['rent','districtRent','density','market','commute','convenience','environment','fit'];
  const state={layer:'rent',localMetric:'price',kind:'community',metric:'price',region:'',marketKey:'',marketFilter:'',category:''};
  const isRegion=()=>state.layer==='districtRent'||state.layer==='density';
  const isMarket=()=>state.layer==='market';
  const isFacilities=()=>state.layer==='convenience'||state.layer==='environment';
  const isDistrict=name=>base.districts.some(d=>d.n===name);
  function setKind(id){
    if(!regional.kinds.some(k=>k.id===id))return;
    state.kind=id;
    if(!regional.options(id).some(m=>m.id===state.metric))state.metric='price';
  }
  function restore(saved){
    if(topics.includes(saved.layer))state.layer=saved.layer;
    if(['price','yoy','mom'].includes(saved.localMetric))state.localMetric=saved.localMetric;
    setKind(saved.kind);
    if(regional.options(state.kind).some(m=>m.id===saved.metric))state.metric=saved.metric;
    if(isDistrict(saved.region))state.region=saved.region;
    if(facilities.types.includes(saved.category))state.category=saved.category;
    if(base.events.some(e=>e.type===saved.marketFilter||e.signal===saved.marketFilter))state.marketFilter=saved.marketFilter;
    if(market.markers(state.marketFilter).some(m=>m.id===saved.marketKey))state.marketKey=saved.marketKey;
  }
  const btn=(attr,id,label,active)=>'<button type="button" data-'+attr+'="'+esc(id)+'" aria-pressed="'+(id===active)+'">'+esc(label)+'</button>';
  function controls(room='1'){
    const {layer,kind,metric,marketFilter,category}=state;
    if(layer==='rent'){
      const options=[['price','月租样本'],['yoy','同比'],['mom','环比']];
      const roomLabel=({'1':'一室','2':'二室','3':'三室','4':'四室'})[String(room||'')]||'';
      const note=state.localMetric!=='price'
        ?'<span class="topic-period">'+(roomLabel?'按'+roomLabel+'同户型样本':'居室不限时默认按一室样本展示')+'</span>'
        :'';
      return '<div class="topic-group" role="group" aria-label="片区月租指标">'+options.map(([id,label])=>btn('local-metric',id,label,state.localMetric)).join('')+'</div>'+note;
    }
    if(layer==='districtRent'){
      const group=(name,items,attr,active)=>'<div class="topic-group" role="group" aria-label="'+name+'"><span class="topic-label">'+name+'</span>'+items.map(i=>btn(attr,i.id,i.label,active)).join('')+'</div>';
      const stats=regional.options(kind);
      return group('住房样本',regional.kinds.slice(0,4),'rent-kind',kind)+group('2022 参考价',regional.kinds.slice(4),'rent-kind',kind)+
        '<div class="topic-line">'+(stats.length>1?group('指标',stats,'rent-metric',metric):'')+'<span class="topic-period">'+esc(regional.period(layer,kind,metric))+' · 按区</span></div>';
    }
    if(layer==='density')return '<span class="topic-period">'+esc(regional.period(layer,kind,metric))+' · 常住人口 / 陆域面积</span>';
    if(layer==='market')return market.filters(marketFilter);
    if(layer==='convenience'&&facilities.types.length)return '<div class="topic-group" role="group" aria-label="设施类型">'+btn('facility-category','','全部设施',category)+facilities.types.map(c=>btn('facility-category',c,facilities.categoryName(c),category)).join('')+'</div>';
    return '';
  }
  function geography(){
    if(isRegion())return {districts:new Map(base.districts.map(d=>[d.n,regional.summary(d.n,state.layer,state.kind,state.metric)])),region:state.region};
    if(isMarket())return {market,filter:state.marketFilter,key:state.marketKey};
    return null;
  }
  function legend(){
    if(isRegion())return regional.legend(state.layer,state.kind,state.metric);
    if(isMarket())return market.legend(state.marketFilter);
    if(isFacilities())return facilities.legend(state.layer);
    return '';
  }
  function regionalPanel(){
    const {layer,kind,metric,region}=state;
    if(!region){
      const items=base.districts.map(d=>'<li><button type="button" data-district="'+esc(d.n)+'">'+esc(d.n)+'</button><span>'+esc(regional.summary(d.n,layer,kind,metric).label)+'</span></li>');
      return '<h2>'+(layer==='density'?'各区人口密度':'各区租金行情')+'</h2><ul class="place-selection">'+items.join('')+'</ul>';
    }
    const related=base.events.filter(e=>e.dist===region);
    return '<div class="region-detail">'+regional.summary(region,layer,kind,metric).detail+'</div>'+
      '<div class="probe-actions"><button type="button" data-find-district="'+esc(region)+'">在'+esc(region.replace(/区$/,''))+'找房</button></div>'+
      (related.length?'<h3>片区事件</h3><div class="fine-chips">'+related.map(e=>'<button type="button" data-market-event="'+esc(e.key)+'">'+esc(e.area)+'</button>').join('')+'</div>':'');
  }
  function facilityPanel(street,zone,home,scope){
    const {layer,category}=state,area=home?{hood:home.id}:zone?{zone:zone.id}:street?{street:street.id}:scope?.kind==='district'?{district:scope.id}:{};
    const items=facilities.records(layer,category,area), noun=facilities.noun(layer),s=street||home?.street;
    const context=home?'片区':zone?'站点参考区':street?'街道':area.district?'行政区':'已收录街道';
    const title=home?.name||zone?.n&&zone.n+'片区'||street?.n||area.district||(layer==='environment'?'公园与环境事件':'生活便利');
    let html='<p class="place-location">'+(area.district||s?.d?esc(area.district||s.d)+' · ':'')+context+'</p><h2>'+esc(title)+'</h2>';
    if(street||zone||home||area.district){
      html+='<p class="measure-note">'+(items.length?'已核实 '+items.length+' 处'+noun:'此范围的'+noun+'待收录')+'</p>'+facilities.links(items);
      if((zone||home)&&s){
        const count=facilities.records(layer,category,{street:s.id}).length;
        if(count>items.length)html+='<div class="fine-chips"><button data-block="'+esc(s.id)+'">'+esc(s.n)+' · '+count+' 处</button></div>';
      }
      if(street&&!zone&&!home){const zones=(data.zones||[]).filter(z=>z.street===street.id);if(zones.length)html+='<div class="fine-chips">'+zones.map(z=>'<button data-zone="'+esc(z.id)+'">'+esc(z.n)+'</button>').join('')+'</div>';}
    }else{
      const groups=new Map();
      for(const item of items)groups.set(item.streetId,(groups.get(item.streetId)||0)+1);
      html+=groups.size?'<ul class="place-selection">'+[...groups].map(([id,count])=>'<li><button data-block="'+esc(id)+'">'+esc(data.streets.find(s=>s.id===id)?.n)+'</button><span>'+count+' 处</span></li>').join('')+'</ul>':'<p>本类资料待收录。</p>';
    }
    if(layer==='environment'){
      const related=(window.worldEvents||[]).filter(e=>['air','rail','flight','noise'].includes(atlasEventType(e))&&(!s||e.near?.some(name=>s.stations.includes(name))));
      if(related.length)html+='<h3>环境事件</h3><div class="fine-chips">'+related.map(e=>'<button data-ev="'+esc(e.id)+'">'+atlasEventIcon(atlasEventType(e))+esc(e.name.split(' · ')[0])+'</button>').join('')+'</div>';
    }
    return html;
  }
  return {state,topics,regional,market,facilities,isRegion,isMarket,isFacilities,isDistrict,setKind,restore,controls,geography,legend,regionalPanel,facilityPanel};
}

function drawThemeGeography(svg,base,view,theme,publicEvents,project,work,esc){
  const {w,h,k,tx,ty,pt}=view,missing=svg.id+'-region-missing',arrow=svg.id+'-migration-arrow';
  const parts=['<defs><pattern id="'+missing+'" patternUnits="userSpaceOnUse" width="7" height="7" patternTransform="scale('+(1/k)+')"><rect width="7" height="7" fill="#344e51"/><path d="M-1 1L1 -1M0 7L7 0M6 8L8 6" stroke="#58736e" stroke-width="1"/></pattern><marker id="'+arrow+'" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0L8 4L0 8Z" fill="#ffdc9b"/></marker></defs>'];
  svg.setAttribute('viewBox','0 0 '+w+' '+h);
  parts.push('<g class="map-geography" data-zoom-tier="'+(typeof atlasZoomTier==='function'?atlasZoomTier(k):0)+'" data-base-k="'+k+'" data-base-tx="'+tx+'" data-base-ty="'+ty+'" transform="translate('+tx+' '+ty+') scale('+k+')">');
  for(const d of base.districts){
    const value=theme.districts?.get(d.n),active=d.n===theme.region;
    const attr=theme.districts?'class="map-district" data-district="'+esc(d.n)+'" role="button" tabindex="0" aria-pressed="'+active+'" aria-label="'+esc(d.n+' · '+value.label)+'"':'pointer-events="none"';
    const fill=value?(value.fill||'url(#'+missing+')'):'#304b4b';
    parts.push('<path '+attr+' d="'+d.p+'" fill="'+fill+'" stroke="#15363c" stroke-width="1.2" vector-effect="non-scaling-stroke"><title>'+esc(d.n+(value?' · '+value.label:''))+'</title></path>');
  }
  const selected=base.districts.find(d=>d.n===theme.region);
  if(selected)parts.push('<path class="map-outline" d="'+selected.p+'" fill="none" stroke="#fff2bc" stroke-width="2.6" vector-effect="non-scaling-stroke" pointer-events="none"/>');
  parts.push('</g><g class="map-overlay">');
  const occupied=[{x:w-21,y:54,dx:22,dy:52}];
  function clear(x,y,dx,dy){
    if(x+dx<0||y+dy<0||x-dx>w||y-dy>h||occupied.some(b=>Math.abs(x-b.x)<dx+b.dx+2&&Math.abs(y-b.y)<dy+b.dy+2))return false;
    occupied.push({x,y,dx,dy});return true;
  }
  const near=(x,y)=>x>=-12&&x<=w+12&&y>=-12&&y<=h+12;
  const labelParts=[],order=[...base.districts].sort((a,b)=>Number(b===selected)-Number(a===selected));
  const reserve=(x,y,width,height)=>clear(x+width/2,y+height/2,width/2,height/2);
  let rich=0;
  function districtLabel(d){
    const name=d.n.replace(/新区$|区$/,''),raw=theme.districts?.get(d.n)?.label;
    const change=theme.layer==='districtRent'?({yoy:'同比 ',mom:'环比 '})[theme.metric]||'':'';
    const value=raw&&change+raw;
    const item={kind:'district',id:d.n,name,title:d.n,xy:d.a,shape:d,value,measureName:theme.layer==='density'?'人口密度（人/平方公里）':'区级租金'};
    if(theme.districts&&theme.insights&&k>=1.65&&rich<(w<480?3:6)){
      const mark=atlasAreaInsight(item,view,theme.insights,reserve,esc);
      if(mark){labelParts.push(mark);rich++;return;}
    }
    const width=Math.max(atlasInsightTextWidth(name,12.5),value?atlasInsightTextWidth(value,11):0)+4,bh=value?30:16;
    const point=atlasLabelPosition(item,view,width,bh,reserve);
    if(!point)return;
    const [x,y]=point;
    labelParts.push('<text class="district-stat-name" x="'+x+'" y="'+(value?y-2:y+4)+'" text-anchor="middle" pointer-events="none">'+esc(name)+'</text>');
    if(value)labelParts.push('<text class="district-stat-value" x="'+x+'" y="'+(y+13)+'" text-anchor="middle" pointer-events="none">'+esc(value)+'</text>');
  }
  // In statistical layers the selected district and its actual measurement have first claim on space.
  if(theme.districts)order.forEach(districtLabel);
  if(theme.market){
    for(const edge of theme.market.connections(theme.key,theme.filter)){
      const [x,y]=pt(edge.from),[ax,ay]=pt(edge.to),len=Math.hypot(ax-x,ay-y);
      if(len<29)continue;
      const dx=(ax-x)/len,dy=(ay-y)/len;
      parts.push('<line class="market-migration" x1="'+(x+13*dx)+'" y1="'+(y+13*dy)+'" x2="'+(ax-15*dx)+'" y2="'+(ay-15*dy)+'" stroke="#ffdc9b" stroke-width="1.8" stroke-dasharray="4 3" marker-end="url(#'+arrow+')" pointer-events="none"/>');
    }
    const visible=theme.market.markers(theme.filter,theme.key).map(m=>({m,p:pt(m.xy)})).filter(({p})=>near(...p));
    // Keep nearby event hit targets separate and connect a displaced symbol to its anchor.
    const placed=[];
    for(const {m,p:[x,y]} of visible.slice().reverse()){
      const offsets=[[0,0],[0,-25],[25,0],[-25,0],[0,25],[22,-22],[-22,22],[22,22],[-22,-22]];
      const [dx,dy]=offsets.find(([dx,dy])=>near(x+dx,y+dy)&&clear(x+dx,y+dy,12,12))||[0,0];
      if(dx||dy)parts.push('<path d="M'+x+' '+y+'l'+dx+' '+dy+'" stroke="#bad5bb" pointer-events="none"/>');
      placed.unshift({m,x:x+dx,y:y+dy});
    }
    for(const {m,x,y} of placed)parts.push(theme.market.glyph(m,x,y));
  }
  for(const e of publicEvents){
    const [x,y]=pt(project(e.coord));if(!near(x,y))continue;
    const [dx,dy]=[[0,0],[17,-18],[-17,18],[23,13],[-23,-13],[0,28]].find(([dx,dy])=>clear(x+dx,y+dy,12,12))||[0,0];
    parts.push(atlasEventMarker(e,x,y,false,esc,'ev',[dx,dy]));
  }
  if(work){
    const [x,y]=pt(work.xy);
    if(near(x,y)){parts.push('<path transform="translate('+x+' '+y+')" d="M0 -5l5 5-5 5-5-5z" fill="#ffdc83" stroke="#35443b" pointer-events="none"><title>'+esc(work.name)+'</title></path>');clear(x,y,6,6);}
  }
  if(!theme.districts)order.forEach(districtLabel);
  parts.push(...labelParts,'</g>');
  replaceMapMarkup(svg,parts.join(''));
}
