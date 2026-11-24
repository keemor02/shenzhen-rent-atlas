/* Geographic and travel-time views share selectable places and route details. */
function createOrbit(svg,base,data,model,timing,esc) {
  const radians=Math.PI/180;
  let last=null;
  const geo=makeBlockMap(svg,base,data,esc,()=>draw(last),()=>!!last&&(!last.dest||last.layout==='geo'));
  const stationXY=name=>model.nodes.has(name)?geo.project(model.nodes.get(name).coord):null;
  const n=v=>Number(v).toFixed(2), pt=p=>n(p[0])+','+n(p[1]);
  const circle=(p,r,fill,more='')=>'<circle cx="'+n(p[0])+'" cy="'+n(p[1])+'" r="'+r+'" fill="'+fill+'" '+more+'/>';
  const label=(p,s,size,color,anchor='start')=>'<text x="'+n(p[0])+'" y="'+n(p[1])+'" font-size="'+size+'" fill="'+color+'" text-anchor="'+anchor+'">'+esc(s)+'</text>';
  const dot=(p,name,attr,node,fill,selected=false)=>'<g role="button" tabindex="0" aria-label="'+esc(name)+'" data-'+attr+'="'+esc(node)+'"><title>'+esc(name)+'</title>'+circle(p,8,'none','pointer-events="all"')+(selected?circle(p,8,'none','stroke="'+fill+'" stroke-width="1.3"'):'')+circle(p,selected?4.2:2.8,fill)+'</g>';
  const line=(ps,s,w,op=1,cls='')=>ps.length<2?'':'<polyline points="'+ps.map(pt).join(' ')+'" stroke="'+s+'" stroke-width="'+w+'" fill="none" stroke-linejoin="round" stroke-linecap="round" opacity="'+op+'" class="'+cls+'"/>';
  const guide='<defs><pattern id="chart-dots" width="17" height="17" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".75" fill="#769996" opacity=".2"/></pattern></defs>';
  function names(leg){
    const stations=timing.lines[leg.line]?.stations;
    if(!stations)return [leg.from,leg.to].filter(Boolean);
    const a=stations.indexOf(leg.from),b=stations.indexOf(leg.to);
    if(a<0||b<0)return [leg.from,leg.to];
    const seq=stations.slice(Math.min(a,b),Math.max(a,b)+1);
    return a>b?seq.reverse():seq;
  }
  function draw(state){
    last=state;
    const {dest,layout,rows,selected,events,eventId,jobs,rowByStop,limit,mode}=state;
    const w=svg.clientWidth&&svg.clientWidth<550?430:800,h=w<500?400:445,c=[w/2,h/2-2];
    if(state.theme){
      state.legend.hidden=true;
      drawThemeGeography(svg,base,geo.camera.viewport(),state.theme,events,geo.project,dest?{xy:stationXY(dest),name:dest}:null,esc);
      return;
    }
    if(!dest||layout==='geo'){
      const active=state.active, layer=state.layer, chosen=state.block || active?.c.street?.id;
      const places=[], special=[], route=[];
      if(dest)special.push({name:dest,xy:stationXY(dest),symbol:'work',always:true});
      for(const e of events)special.push({kind:'ev',event:e,xy:geo.project(e.coord),symbol:'event',active:e.id===eventId});
      if(!dest)for(const name of jobs)if(stationXY(name))special.push({kind:'work',id:name,name,xy:stationXY(name),symbol:'work'});
      const added=new Set();
      function place(c,text,mark){
        if(!c||added.has(c.id))return;
        if(c.hood?.footprint&&geo.camera.viewport().k>=8)return;
        added.add(c.id);
        places.push({kind:dest?'st':'hood',id:c.id,name:c.name,zone:c.hood?.zone,xy:c.hood?.xy||geo.project(c.coord),text,symbol:mark,always:!!c.hood,active:c.id===selected});
      }
      if(active){
        place(active.c,active.fit?window.RentalFit.range(active.fit)+' 分':'','pick');
        if(active.route&&dest){
          route.push(geo.project(active.c.coord));
          if(mode==='rail')route.push(...active.route.legs.flatMap(l=>names(l).map(stationXY)).filter(Boolean));
          route.push(stationXY(dest));
        }
      }
      if(chosen)for(const r of state.blocks.get(chosen)?.rows||[])if(r.c.hood)place(r.c,'');
      const view=geo.camera.viewport();
      if(view.k>3&&!chosen)for(const r of state.eligible){
        if(!r.c.hood||added.has(r.c.id))continue;
        const [x,y]=view.pt(r.c.hood.xy);
        if(x>0&&x<view.w&&y>0&&y<view.h)place(r.c,'');
      }
      const local={zone:state.zone,selected,action:dest?'st':'hood',legend:state.legend,zoneData:z=>state.zoneBlocks.get(z.id),placeData:h=>{if(state.areaMeasure)return state.areaMeasure.home(h);const row=state.record(h.id);return row?atlasSummary([row],layer):null;}};
      geo.draw({local,insights:state.insights,measureName:state.measureName,blocks:state.blocks,color:state.areaMeasure?state.areaMeasure.paint:v=>atlasPaint(layer,v),inScope:state.streetInScope,activeStreet:chosen,places,special,route});
      return;
    }
    state.legend.hidden=true;
    const target=model.nodes.get(dest);
    const selectedRow=rows.find(r=>r.c.id===selected);
    svg.setAttribute('viewBox','0 0 '+w+' '+h);
    let html=guide+'<rect width="100%" height="100%" fill="#10292d"/><rect width="100%" height="100%" fill="url(#chart-dots)"/>';
    let stationPos,markRows;
    const occupied=[];
    function placeText(p,title,opt={}){
      const size=opt.size||12.5;
      const length=[...title].reduce((s,c)=>s+(/[ -~]/.test(c)?.6:1)*size,0);
      const candidates=opt.offsets||[[8,-6],[8,14],[-8,-7],[-8,13],[9,-16],[9,24]];
      for(const [dx,dy] of candidates){
        const anchor=dx<0?'end':'start',x=p[0]+dx,y=p[1]+dy;
        const box=[anchor==='end'?x-length:x,y-size,anchor==='end'?x:x+length,y+2];
        if(box[0]<4||box[2]>w-4||box[1]<4||box[3]>h-3)continue;
        if(occupied.some(q=>q[0]-3<box[2]&&q[2]+3>box[0]&&q[1]-3<box[3]&&q[3]+3>box[1]))continue;
        occupied.push(box);return label([x,y],title,size,opt.color||'#d5e7db',anchor);
      }
      return '';
    }
    const routePoints=(r,byName)=>r.route.legs.flatMap(l=>names(l).map(byName)).filter(Boolean);
    {
      const maxR=Math.min(h*.419,w*.425);
      const radial=(ll,time)=>{let dx=(ll[0]-target.coord[0])*Math.cos(target.coord[1]*radians),dy=target.coord[1]-ll[1];const theta=Math.atan2(dy,dx);const r=time/limit*maxR;return [c[0]+Math.cos(theta)*r,c[1]+Math.sin(theta)*r];};
      const positions=new Map();
      for(const [key,r] of rowByStop)if(model.nodes.has(key))positions.set(key,radial(model.nodes.get(key).coord,r.route.minutes));
      positions.set(dest,c);if(selectedRow?.route.terminal && selectedRow.route.terminal!==dest&&!positions.has(selectedRow.route.terminal))positions.set(selectedRow.route.terminal,c);
      stationPos=name=>positions.get(name);
      for(let i=10;i<=limit;i+=10){
        const r=i/limit*maxR;
        html+=circle(c,r,'none','stroke="#52746c" stroke-width=".9" stroke-dasharray="2 4"');
        html+=label([c[0]-3,c[1]-r-3],i+'′',11.5,'#a7c5b7','end');
      }
      for(const t of [0,Math.PI/2,Math.PI,Math.PI*1.5])html+=line([c,[c[0]+Math.cos(t)*maxR,c[1]+Math.sin(t)*maxR]],'#719387',.6,.36);
      if(mode==='rail'){
        for(const l of base.metro)for(let i=1;i<l.s.length;i++){
          const aa=positions.get(l.s[i-1]),bb=positions.get(l.s[i]);
          if(!aa||!bb||Math.hypot(aa[0]-c[0],aa[1]-c[1])>maxR+.2||Math.hypot(bb[0]-c[0],bb[1]-c[1])>maxR+.2)continue;
          html+=line([aa,bb],'#678e7e',1,.46);
        }
      }
      markRows=rows.map(r=>[radial(r.c.coord,r.route.minutes),r]);
    }
    if(selectedRow){
      const p=markRows.find(x=>x[1]===selectedRow)?.[0],end=c;
      let path=mode==='rail'?routePoints(selectedRow,stationPos):[];
      if(p&&end)html+=line([p,...path,end],'#e7c17a',2,.91)+line([p,...path,end],'#fff0b1',1,.8,'route-pulse');
    }
    const visible=(p)=>p&&p[0]>2&&p[0]<w-2&&p[1]>4&&p[1]<h-4;
    const sorted=markRows.filter(pair=>visible(pair[0])).sort((a,b)=>Number(a[1].c.id===selected)-Number(b[1].c.id===selected)||Number(!!a[1].price)-Number(!!b[1].price));
    for(const [p,r] of sorted){
      const active=r.c.id===selected, layer=state.layer||'fit';
      const detail=layer==='fit'?('适配 '+window.RentalFit.range(r.fit)+' 分'):r.fit.dimensions[layer].value;
      html+=dot(p,r.c.name+' · '+r.route.minutes+'分钟 · '+detail,'st',r.c.id,atlasPaint(layer,atlasValue(r,layer))||'#849695',active);
    }
    const evPoints=[];
    for(const e of events){
      let p=null;
      {
        const ref=(e.near||[]).map(name=>rowByStop.get(name)).filter(r=>r&&r.route.minutes<=limit).sort((a,b)=>a.route.minutes-b.route.minutes)[0];
        if(ref){const rp=stationPos(ref.c.node.name)||stationPos(ref.c.station.name);if(rp)p=[rp[0]+6,rp[1]-7];}
      }
      if(visible(p)){
        const delta=[[0,0],[20,-16],[-20,-16],[20,16],[-20,16],[0,-29]].find(([dx,dy])=>evPoints.every(([q])=>Math.hypot(p[0]+dx-q[0],p[1]+dy-q[1])>23))||[0,0];
        evPoints.push([[p[0]+delta[0],p[1]+delta[1]],e]);html+=atlasEventMarker(e,p[0],p[1],e.id===eventId,esc,'ev',delta);
      }
    }
    const center=target?c:null;
    if(center){
      html+=circle(center,11,'#203e3b','stroke="#f3cb7e" stroke-width="1.5"')+'<path d="M'+pt([center[0],center[1]-5])+' l5,5 -5,5 -5,-5 z" fill="#ffce74"/>';
      html+=placeText(center,dest,{color:'#ffe2a2',size:14,offsets:[[14,5],[-14,4],[12,-10]]});
    }
    for(const [p,e] of evPoints.filter(pair=>pair[1].id===eventId))html+=placeText(p,e.name,{color:'#ffceb0',size:12});
        const priority=sorted.slice().reverse().sort((a,b)=>Number(b[1].c.id===selected)-Number(a[1].c.id===selected)||Number(!!b[1].price)-Number(!!a[1].price));
    let count=0;for(const [p,r] of priority){
      if(count>=(w<500?8:18))break;
      const name=r.c.name.replace(/站周边$|商圈$/,'').split(' · ').pop();
      const placed=placeText(p,name,{color:r.c.id===selected?'#ffdc9b':'#c3ddd0'});if(placed){html+=placed;count++;}
    }
    html+='<g aria-hidden="true"><path d="M19 31 l4 -14 4 14 -4 -3 z" fill="#a1c0b2"/>'+label([23,13],'N',9,'#9bb9ad','middle')+'</g>';
    svg.innerHTML=html.replace(/<(circle|path|polyline|rect)\b([^>]*)\/>/g,'<$1$2></$1>');
  }
  draw.project=geo.project;
  draw.camera=geo.camera;
  draw.focusPoint=ll=>{const [x,y]=geo.project(ll);geo.camera.fit([x-22,y-17,x+22,y+17]);};
  return draw;
}
