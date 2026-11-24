/* Offline route, listing and comparison models for the exploration screen. */
function makeExploreModel(base, data, travel, timing) {
  const nodes = new Map(travel.nodes.map((n,i) => [n.name,{...n, i}]));
  const railNames = new Set(Object.values(timing.lines).flatMap(l => l.stations));
  const railNodes = [...nodes.values()].filter(n=>railNames.has(n.name));
  const rail = makeRailPlanner(base,timing);
  const busCache = new Map();
  const railCache = new Map();
  const islandDepartures = new Map();
  const railCosts = {access:0,egress:0,wait:3,transfer:5};
  const translation = {'一':1,'二':2,'两':2,'三':3,'四':4,'五':5};
  const unitRoom = s => /单间/.test(s) ? 1 : (translation[String(s??'').match(/[一二两三四五](?=室|房)/)?.[0]] || Number(s)||0);
  const meter = (a,b) => Math.hypot((a[0]-b[0])*102700,(a[1]-b[1])*110850);
  const walking = m => Math.ceil(m*1.25/75);
  const closest = (ll,list) => list.reduce((a,b)=>meter(a.coord,ll)<=meter(b.coord,ll)?a:b);
  const nearestRail = n => railNames.has(n.name)?n:closest(n.coord,railNodes);
  const streets = new Map(data.streets.map(s=>[s.id,s]));
  const hoodStops = {'西丽 · 北部村落':'牛成村','大冲 · 科兴':'高新园','兴东 · 啤酒小镇':'兴东','九祥岭东区':'九祥岭','官龙村 · 官龙名苑':'官龙村','新安公园 · 新安湖花园二三期':'新安湖'};
  const hoods=data.hoods.map(h=>{
    const node=nodes.get(hoodStops[h.n])||nodes.get(h.n)||nodes.get(h.station)||closest(h.ll,[...nodes.values()]);
    const station=railNames.has(h.station)?nodes.get(h.station):nearestRail(node);
    return {id:h.id,name:h.n,coord:h.ll,reference:h.anchor, node,station,street:streets.get(h.street),hood:h};
  });
  // A residential footprint and its station can have separate saved visits.
  const covered = new Set(hoods.filter(c=>!c.hood.separateFromStation).map(c=>c.node.name));
  const extras=[...nodes.values()].filter(n=>!covered.has(n.name)).map(n=>{
    const sid = data.stStreet[n.name]||data.streets.find(s=>travel.streetNodes[s.n]?.includes(n.name))?.id;
    return {id:'node-'+n.name,name:n.name+(railNames.has(n.name)?'站周边':'周边'),coord:n.coord,reference:n.reference||n.name+'地铁站',node:n,station:nearestRail(n),street:streets.get(sid)};
  });
  function candidates(manual) {
    return [...hoods,...extras,...manual.filter(m=>nodes.has(m.station)).map(m=>{
      const node=nodes.get(m.station);
      return {id:m.id,name:m.name,coord:node.coord,node,station:nearestRail(node),street:streets.get(data.stStreet[node.name]),reference:node.name+'站参照',personal:m};
    })];
  }
  function getRoute(c,dest,opt){
    const from=c.node,to=nodes.get(dest),mode=opt.mode;
    if(!to)return null;
    const extraFrom=walking(meter(c.coord,from.coord));
    const a=Math.max(opt.access,extraFrom), e=opt.egress;
    if(mode==='rail'){
      const fromIsland=from.name==='企鹅岛';
      if(fromIsland&&dest==='企鹅岛')return {minutes:a+e,legs:[],label:'园区内步行',same:true,walk:a+e,origin:from.name,terminal:dest};
      const d=dest==='企鹅岛'?to:nearestRail(to);
      const destWalk=dest==='企鹅岛'?e:Math.max(e,walking(meter(d.coord,to.coord)));
      const fromWalk=fromIsland?a:Math.max(opt.access,walking(meter(c.coord,c.station.coord)));
      const key=d.name;
      let r;
      if(fromIsland){
        if(!islandDepartures.has(key))islandDepartures.set(key,rail.fromIsland(key,railCosts));
        r=islandDepartures.get(key);
      }else{
        if(!railCache.has(key))railCache.set(key,rail.to(key,railCosts));
        r=railCache.get(key).get(c.station.name);
      }
      if(!r)return null;
      const walk=fromWalk+destWalk;
      return {...r,walk,same:r.sameStation,minutes:r.minutes+walk,origin:fromIsland?from.name:c.station.name,terminal:d.name,label:r.sameStation?'同站步行':r.legs.map(l=>Object.hasOwn(timing.lines,l.line)?l.line+'号线':l.line).join(' → ')};
    }
    if(mode==='drive'){
      const seconds=travel.driving.durations[from.i]?.[to.i],meters=travel.driving.distances[from.i]?.[to.i];
      if(seconds==null||meters==null)return null;
      return {minutes:Math.ceil(seconds/60)+a+e,seconds,meters,walk:a+e,legs:[],label:from.i===to.i?'同一参考点':'驾车',origin:from.name,terminal:dest};
    }
    if(from.i===to.i)return {minutes:a+e,walk:a+e,legs:[],label:'同点步行',same:true,origin:from.name,terminal:dest};
    const key=from.name+'|'+dest;
    if(!busCache.has(key)){
      const possible=busOptions(travel,from.i,to.i);
      busCache.set(key,[possible.direct,possible.transfer].filter(Boolean));
    }
    const list=busCache.get(key).flatMap(r=>{
      const walk=Math.max(a,walking(r.fromMeters||0))+Math.max(e,walking(r.toMeters||0))+walking(r.transferMeters||0);
      const shuttle=r.shuttle&&(timing.shuttles||[]).find(s=>r.legs.some(l=>l.line===s.line));
      if(r.shuttle&&!shuttle)return [];
      const wait=shuttle?shuttle.wait:5*r.legs.length;
      const ride=shuttle?shuttle.ride:Math.ceil(r.estimatedRide);
      return {...r,ride,wait,walk,minutes:ride+wait+walk,label:r.legs.map(l=>l.line).join(' → '),origin:from.name,terminal:dest};
    });
    return list.sort((x,y)=>x.minutes-y.minutes)[0]||null;
  }
  function housing(c,opt){
    const fits = r => !opt.room || unitRoom(r)===Number(opt.room);
    const candidates=[];
    const m=c.hood?.mid!=null?data.markets[c.hood.mid]:null;
    if(m){
      for(const r of (opt.room?[opt.room]:['1','2','3','4'])){
        const sample=window.latestMarketRent(m,r,data.asof);
        if(!sample)continue;
        const {period,row,complete,asof}=sample;
        candidates.push({price:row.price,yoy:row.yoy,room:+r,date:complete?period:period+(asof?'（截至 '+asof+'）':'（月内）'),unit:complete?'商圈月租均价':'商圈月内均价',source:m.url,
          peer:'58-'+period+'-'+r+'-'+(complete?'full':asof||'partial'),unique:'m'+c.hood.mid});
      }
    }
    for(const x of c.hood?.project?.metrics||[]){
      if(!fits(x.rooms)||/合租/.test(x.scope)||!(x.price>0))continue;
      const project=x.sqm==null;
      const category=c.hood.project.category==='城中村及相邻住宅小区' ? (/官龙名苑/.test(x.rooms)?'住宅小区':'城中村') : c.hood.project.category;
      candidates.push({price:x.price,room:unitRoom(x.rooms),roomLabel:x.rooms,category,date:x.period.slice(0,10).replace(/（.*/,''),unit:project?'项目租金样本':'单套整租挂牌',sqm:x.sqm,source:x.source,mom:x.mom,
        peer:project&&unitRoom(x.rooms)?'anjuke-'+x.period.slice(0,7)+'-'+unitRoom(x.rooms)+'-'+category:null,unique:'p'+c.id});
    }
    if(c.personal?.monthly&&fits((c.personal.room??c.personal.rooms)))candidates.push({price:Number(c.personal.monthly),room:Number((c.personal.room??c.personal.rooms))||0,sqm:Number(c.personal.sqm)||null,date:c.personal.observed||'',unit:'我的整租记录'});
    if(c.personal?.sqm>0&&!c.personal.monthly&&fits(c.personal.room??c.personal.rooms)){
      candidates.push({sqm:Number(c.personal.sqm),unit:'我的面积记录',date:c.personal.observed||''});
    }
    const sorted=candidates.sort((a,b)=>Number(!!b.peer)-Number(!!a.peer)||(a.price??Infinity)-(b.price??Infinity));
    const matched=sorted.find(x=>(!opt.budget||x.price>0&&x.price<=opt.budget)&&(!opt.sqm||x.sqm>=opt.sqm)&&(x.price>0||opt.sqm))||null;
    const sample=matched||sorted[0]||null;
    if(matched||!opt.budget&&!opt.sqm)return {matched,sample,status:'eligible',reason:''};
    const possible=sorted.filter(x=>(!opt.budget||!x.price||x.price<=opt.budget)&&(!opt.sqm||!x.sqm||x.sqm>=opt.sqm));
    if(!sorted.length||possible.length){
      const reason=opt.budget&&(!possible.length||possible.some(x=>!x.price))?'缺同户型月租样本':'样本面积待核';
      return {matched:null,sample,status:'pending',reason};
    }
    const reason=opt.budget&&sorted.every(x=>x.price>opt.budget)?'已收录样本超预算':
      opt.sqm&&sorted.every(x=>x.sqm>0&&x.sqm<opt.sqm)?'已收录样本面积不足':'无样本同时满足预算和面积';
    return {matched:null,sample,status:'outside',reason};
  }
  function prices(c,opt){return housing(c,opt).matched;}
  function compare(rows){
    for(const x of rows){
      const rent=x.price;
      if(!rent?.peer)continue;
      const distinct=new Map();
      for(const y of rows)if(y.price?.peer===rent.peer&&y.price.unique!==rent.unique&&Math.abs(y.route.minutes-x.route.minutes)<=10)distinct.set(y.price.unique,y.price.price);
      const values=[...distinct.values()].sort((a,b)=>a-b);
      if(values.length<3)continue;
      const i=Math.floor(values.length/2),med=values.length%2?values[i]:(values[i-1]+values[i])/2;
      x.compare={median:med,count:values.length,difference:Math.round(med-rent.price)};
    }
  }
  return {nodes,railNames,candidates,route:getRoute,prices,housing,compare,meter};
}
