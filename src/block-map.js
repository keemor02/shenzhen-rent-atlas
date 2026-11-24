/* A block shows the best available candidate for the selected measure within its street. */
const atlasMeasures={
  rent:{name:'租金',basis:'最低月租样本',unit:'元/月',limits:[2000,3500,5500],labels:['<2,000','2,000–3,499','3,500–5,499','≥5,500'],lower:true},
  commute:{name:'通勤',basis:'最短单程',unit:'分钟',limits:[25,40,60],labels:['<25','25–39','40–59','≥60'],lower:true},
  fit:{name:'适配',basis:'最高适配下限',unit:'分',limits:[25,50,75],labels:['<25','25–49','50–74','≥75']},
  environment:{name:'环境',basis:'最高环境实评',unit:'档',limits:[2,3,4],labels:['1','2','3','4–5']},
  convenience:{name:'便利',basis:'最高便利实评',unit:'档',limits:[2,3,4],labels:['1','2','3','4–5']}
};
const atlasColors=['#317c6b','#86b799','#d3ba83','#b87958'];
function atlasValue(row,key) {
  if(key==='rent')return row.price?.price;
  if(key==='commute')return row.route?.minutes;
  if(key==='fit')return row.fit?.count?row.fit.low:null;
  return row.fit?.dimensions[key]?.stars;
}
function atlasPaint(key,value) {
  if(!Number.isFinite(value))return null;
  const m=atlasMeasures[key], i=m.limits.filter(n=>value>=n).length;
  return atlasColors[m.lower?i:3-i];
}
function atlasSummary(list,key) {
  const m=atlasMeasures[key],rows=list.filter(r=>!r.mapState||r.mapState==='eligible'||r.mapState==='pending');
  let value=null,best=null;
  for(const row of rows){
    const v=atlasValue(row,key);
    if(!Number.isFinite(v)||(row.mapState==='pending'&&key!=='commute'))continue;
    const improves=!best||(m.lower?v<value:v>value)||(v===value&&best.mapState==='pending'&&row.mapState!=='pending');
    if(improves){best=row;value=v;}
  }
  if(best){
    const partial=best.mapState==='pending',n=value.toLocaleString('zh-CN');
    const label=key==='rent'?'¥'+n:key==='commute'?n+' 分钟':key==='fit'?n+' 分':n+'/5';
    return {rows,best,value,label,text:n+' '+m.unit,state:partial?'partial':'known',reason:partial?best.housingReason:''};
  }
  const missing=({rent:'缺同户型月租',commute:'缺通勤路线',fit:'缺评分依据',environment:'环境待踩点',convenience:'便利待踩点'})[key];
  const outside=list.length&&list.every(r=>r.mapState==='outside');
  const reason=outside?[...new Set(list.flatMap(r=>r.exclusions||[]))].slice(0,2).join('、')||'超出当前筛选':
    rows.length?rows.find(r=>r.mapState==='pending')?.housingReason||missing:list.length?'缺通勤路线':'未收录候选';
  return {rows,best:null,value:null,label:'',text:reason,reason,state:outside?'outside':'missing'};
}
function atlasBlocks(rows,key,groupBy=r=>r.c.street?.id) {
  const groups=new Map();
  for(const row of rows){
    const id=groupBy(row);if(!id)continue;
    if(!groups.has(id))groups.set(id,[]);
    groups.get(id).push(row);
  }
  return new Map([...groups].map(([id,list])=>[id,atlasSummary(list,key)]));
}

// Cache interior anchors in map coordinates. Labels use a fixed size in screen pixels.
const atlasLabelShapes=new WeakMap();
function atlasLabelShape(shape,preferred) {
  if(atlasLabelShapes.has(shape))return atlasLabelShapes.get(shape);
  const rings=shape.p.split(/M/i).slice(1).map(part=>Array.from(part.matchAll(/(-?[\d.]+),(-?[\d.]+)/g),m=>[+m[1],+m[2]]));
  const edges=[];
  const bounds=shape.bounds||[Infinity,Infinity,-Infinity,-Infinity];
  for(const ring of rings)for(let j=ring.length-1,i=0;i<ring.length;j=i++){
    const [ax,ay]=ring[j],[bx,by]=ring[i];
    edges.push([ax,ay,bx,by,bx-ax,by-ay]);
    if(!shape.bounds){
      bounds[0]=Math.min(bounds[0],ax);bounds[1]=Math.min(bounds[1],ay);
      bounds[2]=Math.max(bounds[2],ax);bounds[3]=Math.max(bounds[3],ay);
    }
  }
  function clearance(x,y){
    let inside=false,least=Infinity;
    for(const [ax,ay,bx,by,dx,dy] of edges){
      if((ay>y)!==(by>y)&&x<dx*(y-ay)/dy+ax)inside=!inside;
      const t=Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy||1)));
      least=Math.min(least,(x-ax-t*dx)**2+(y-ay-t*dy)**2);
    }
    return inside?Math.sqrt(least):0;
  }
  // A rectangle fits only when its centre is inside and no ring (including a hole) enters it.
  function fits(x,y,rx,ry){
    const left=x-rx,top=y-ry,right=x+rx,bottom=y+ry;
    if(left<bounds[0]||top<bounds[1]||right>bounds[2]||bottom>bounds[3])return false;
    let inside=false;
    for(const [ax,ay,bx,by,dx,dy] of edges){
      if((ay>y)!==(by>y)&&x<dx*(y-ay)/dy+ax)inside=!inside;
      if(Math.max(ax,bx)<left||Math.min(ax,bx)>right||Math.max(ay,by)<top||Math.min(ay,by)>bottom)continue;
      const x1=dx?(left-ax)/dx:-Infinity,x2=dx?(right-ax)/dx:Infinity;
      const y1=dy?(top-ay)/dy:-Infinity,y2=dy?(bottom-ay)/dy:Infinity;
      if(Math.max(0,Math.min(x1,x2),Math.min(y1,y2))<=Math.min(1,Math.max(x1,x2),Math.max(y1,y2)))return false;
    }
    return inside;
  }
  const [x0,y0,x1,y1]=bounds,sites=[];
  function add(point){
    const room=clearance(...point);
    if(room>0)sites.push({point,room});
  }
  if(preferred)add(preferred);
  for(let u=1;u<8;u++)for(let v=1;v<8;v++)add([x0+(x1-x0)*u/8,y0+(y1-y0)*v/8]);
  sites.sort((a,b)=>b.room-a.room);
  const info={bounds,fits,sites,best:sites[0]||{point:preferred||[(x0+x1)/2,(y0+y1)/2],room:0}};
  atlasLabelShapes.set(shape,info);
  return info;
}

function atlasLabelPosition(item,view,bw,bh,reserve){
  const {k,w,h,tx,ty,pt}=view,form=atlasLabelShape(item.shape,item.xy);
  const [west,north,east,south]=form.bounds,rx=(bw/2+3)/k,ry=(bh/2+3)/k;
  const x0=Math.max(west+rx,(bw/2+4-tx)/k),y0=Math.max(north+ry,(bh/2+4-ty)/k);
  const x1=Math.min(east-rx,(w-bw/2-4-tx)/k),y1=Math.min(south-ry,(h-bh/2-4-ty)/k);
  if(x1<x0||y1<y0)return null;
  const clip=item.clip&&atlasLabelShape(item.clip,item.clip.xy);
  const requiredRoom=Math.hypot(rx,ry);
  function attempt(point,room=0){
    const [x,y]=point;
    if(x<x0||x>x1||y<y0||y>y1)return null;
    if(item.avoid?.some(b=>x+rx>b[0]&&x-rx<b[2]&&y+ry>b[1]&&y-ry<b[3]))return null;
    if(room<requiredRoom&&!form.fits(x,y,rx,ry))return null;
    if(clip&&!clip.fits(x,y,rx,ry))return null;
    const [sx,sy]=pt(point);
    return reserve(sx-bw/2,sy-bh/2,bw,bh)?[sx,sy]:null;
  }
  for(const site of form.sites){
    const point=attempt(site.point,site.room);
    if(point)return point;
  }
  // When only a portion of a large polygon is on screen, anchor within the visible portion.
  for(const u of [.5,.25,.75])for(const v of [.5,.25,.75]){
    const point=attempt([x0+(x1-x0)*u,y0+(y1-y0)*v]);
    if(point)return point;
  }
  return null;
}

function atlasInsightTextWidth(text,size){
  return Array.from(text).reduce((n,c)=>n+(c.charCodeAt(0)<128||c==='¥' ? .61 : 1)*size,0);
}
const atlasInsightIcons={
  event:'M1.5 3.5h9v7h-9z M3.5 1.5v3m5-3v3m-5 2h5',
  policy:'M3 1h4.5L10 3.5V11H3z M7.5 1v3h2 M5 6h3m-3 2h3',
  up:'M1.5 9l3.5-4 2 2 3.5-5M7 2h3.5v3.5',
  down:'M1.5 3l3.5 4 2-2 3.5 5M7 10h3.5V6.5',
  mixed:'M1 8l3-4 3 4 4-5M8 3h3v3',
  watch:'M1 6s2-3.5 5-3.5S11 6 11 6s-2 3.5-5 3.5S1 6 1 6z M6 5v2'
};
function atlasAreaInsight(item,view,insights,reserve,esc){
  if(typeof insights!=='function')return '';
  const data=item.evidence||insights(item.kind,item.id);
  if(!data)return '';
  const events=data.events?.length||0,policies=data.localPolicyCount??data.policies?.length??0;
  const hasEvidence=events>0||policies>0;
  const outlook=data.outlook||{},trend=outlook.label||'待核';
  const direction=['up','down','mixed','watch'].includes(outlook.direction)?outlook.direction:'watch';
  const value=item.value||'—',title=item.title||item.name;
  const spoken=title+'，'+(item.measureName?item.measureName+' ':'')+(value==='—'?'暂无数据':value)+'，已收录事件 '+events+' 项，租金可能走势：'+trend+'，本地关联政策 '+policies+' 项';
  function metricRow(compact){
    const bits=[['events','event',String(events),'关联事件 '+events+' 项'],['outlook',direction,compact?'':trend,'租金走势 · '+trend],['policies','policy',String(policies),'本地关联政策 '+policies+' 项']];
    let x=0;
    const glyphs=bits.map(([part,key,caption,hint])=>{
      const width=12+(caption?2+atlasInsightTextWidth(caption,10.5):0);
      const mark='<g data-insight-part="'+part+'" transform="translate('+x+' 0)"><title>'+esc(hint)+'</title>'+
        '<rect class="insight-part-hit" x="-2" y="-2" width="'+(width+4)+'" height="17" rx="3" fill="transparent"/><path class="insight-icon" d="'+atlasInsightIcons[key]+'"/>'+
        (caption?'<text class="insight-stat" x="14" y="10">'+esc(caption)+'</text>':'')+'</g>';
      x+=width+5;
      return mark;
    });
    return {width:x-5,svg:glyphs.join('')};
  }
  const nameWidth=atlasInsightTextWidth(item.name,12.5),valueWidth=atlasInsightTextWidth(value,11.5);
  const district=item.kind==='district',nameClass='insight-name'+(district?' district-stat-name':''),valueClass='insight-value'+(district?' district-stat-value':'');
  for(const format of hasEvidence?['full','compact','stack']:['full','stack']){
    const stack=format==='stack',stats=hasEvidence?metricRow(format!=='full'):null;
    const width=Math.ceil(Math.max(stack?Math.max(nameWidth,valueWidth):nameWidth+6+valueWidth,stats?.width||0)+6);
    const height=hasEvidence?(stack?48:36):(stack?33:22),headY=hasEvidence?(stack?-10:-3):(stack?-2:4);
    const point=atlasLabelPosition(item,view,width,height,reserve);
    if(!point)continue;
    const [x,y]=point;
    let head='<text class="insight-heading" text-anchor="middle" y="'+headY+'"><tspan class="'+nameClass+'">'+esc(item.name)+'</tspan>';
    head+=stack?'</text><text class="'+valueClass+'" y="'+(headY+14)+'" text-anchor="middle">'+esc(value)+'</text>':
      '<tspan class="'+valueClass+'" dx="5">'+esc(value)+'</tspan></text>';
    const strip=stats?'<g class="insight-strip" transform="translate('+(-stats.width/2).toFixed(2)+' '+(stack?8:2)+')"><rect class="insight-back" x="-3" y="-1" width="'+(stats.width+6)+'" height="15" rx="4"/>'+stats.svg+'</g>':'';
    return '<g class="area-insight" data-area-insight="'+item.kind+'" data-area-id="'+esc(item.id)+'" role="button" tabindex="0" aria-label="'+esc(spoken)+'" transform="translate('+x.toFixed(2)+' '+y.toFixed(2)+')"><title>'+esc(spoken)+'</title>'+
      '<rect class="insight-hit" x="'+(-width/2)+'" y="'+(-height/2)+'" width="'+width+'" height="'+height+'" rx="4" fill="transparent"/>'+head+strip+'</g>';
  }
  return '';
}

function drawWestAreas({data,local,view,activeStreet,svgId,esc,color,pattern,dots,inScope}){
  const labels=[],parts=[],{k,pt,w,h}=view;
  const detail=k>=8;
  if(!local||k<2.4)return {geometry:'',labels,shown:false,detail};
  const visible=([x0,y0,x1,y1])=>{const a=pt([x0,y0]),b=pt([x1,y1]);return b[0]>0&&b[1]>0&&a[0]<w&&a[1]<h;};
  const zones=(data.zones||[]).filter(z=>visible(z.bounds)&&inScope(data.streets.find(s=>s.id===z.street)));
  if(!zones.length)return {geometry:'',labels,shown:false,detail};
  const clip=svgId+'-west', street=data.streets.find(s=>s.id===zones[0].street);
  parts.push('<defs><clipPath id="'+clip+'"><path d="'+street.p+'"/></clipPath></defs><g clip-path="url(#'+clip+')">');
  function shape({cls,attr,id,p,name,measure,active,stroke,dash,back}){
    const state=measure?.state||(Number.isFinite(measure?.value)?'known':'missing'),text=measure?.text||'暂无本项记录';
    const fill=state==='outside'?'#2b4244':(color(measure?.value)||pattern);
    const title=esc(name+' · '+text+(state==='partial'?' · '+measure.reason:''));
    parts.push('<path class="'+cls+'" data-'+attr+'="'+esc(id)+'" data-state="'+esc(state)+'" role="button" tabindex="0" aria-label="'+title+'" aria-pressed="'+active+'" d="'+p+'" fill="'+fill+'" fill-rule="evenodd" stroke="'+(active?'#fff0b6':stroke)+'" stroke-width="'+(active?2.4:1.25)+'" stroke-dasharray="'+(active?'none':dash)+'" vector-effect="non-scaling-stroke"><title>'+title+'</title></path>');
    if(back)parts.push('<path d="'+p+'" fill="#173337" fill-opacity=".18" pointer-events="none"/>');
    if(state==='partial')parts.push('<path d="'+p+'" fill="url(#'+dots+')" pointer-events="none"/>');
  }
  const zoneLabels=[];
  for(const z of zones){
    const measure=local.zoneData(z),active=local.zone===z.id,title=z.n+'站参考区';
    shape({cls:'map-zone',attr:'zone',id:z.id,p:z.p,name:title,measure,active,stroke:'#b1c8b6',dash:'5 3',back:detail});
    zoneLabels.push({kind:'zone',id:z.id,name:z.n+'站',xy:z.xy,shape:z,clip:street,title,active,value:measure?.label});
  }
  if(detail){
    const homes=data.hoods.filter(h=>h.footprint&&zones.some(z=>z.id===h.zone)&&visible(h.footprint.bounds));
    homes.sort((a,b)=>Number(a.id===local.selected)-Number(b.id===local.selected));
    const priorities=[];
    for(const h of homes){
      const f=h.footprint,active=h.id===local.selected,village=f.kind==='城中村',measure=local.placeData(h);
      shape({cls:'residential-area '+(village?'village':'estate'),attr:local.action,id:h.id,p:f.p,name:f.kind+' · '+f.name,measure,active,stroke:village?'#e8ca8c':'#9dd5e4',dash:village?'3 2':'none'});
      const width=(f.bounds[2]-f.bounds[0])*k,height=(f.bounds[3]-f.bounds[1])*k;
      if(active||(width>=Math.min(84,f.name.length*11)&&height>=16))priorities.push({kind:'hood',id:h.id,name:f.name,xy:h.xy,shape:f,clip:street,active,value:measure?.label,weight:active?Infinity:width*height});
    }
    labels.push(...priorities.sort((a,b)=>b.weight-a.weight));
    const footprints=homes.map(home=>home.footprint.bounds);
    for(const label of zoneLabels)label.avoid=footprints;
  }
  labels.push(...zoneLabels);
  parts.push('</g>');
  return {geometry:parts.join(''),labels,shown:true,detail};
}

function replaceMapMarkup(svg,markup){
  const focus=document.activeElement;
  const action=focus&&focus!==svg&&svg.contains(focus)?['areaInsight','block','zone','hoodgo','hood','st','ev','worldgo','work','district','marketEvent'].find(key=>focus.dataset?.[key]):null;
  const id=action&&focus.dataset[action];
  const areaId=action==='areaInsight'?focus.dataset.areaId:null;
  svg.innerHTML=markup;
  if(action){
    const all=Array.from(svg.querySelectorAll('[tabindex]'));
    const next=all.find(el=>el.dataset[action]===id&&(!areaId||el.dataset.areaId===areaId))||
      (areaId&&all.find(el=>[el.dataset.block,el.dataset.zone,el.dataset.hood,el.dataset.st,el.dataset.hoodgo,el.dataset.district].includes(areaId)));
    (next||svg).focus({preventScroll:true});
  }
}

function atlasZoomTier(k){
  return (k>=0.8)+(k>=1.65)+(k>=2)+(k>=2.4)+(k>=3)+(k>=8);
}
function atlasFastTransform(svg,view){
  if(typeof svg.querySelector!=='function')return false;
  const geo=svg.querySelector('.map-geography');
  if(!geo||!geo.dataset?.baseK)return false;
  const baseK=Number(geo.dataset.baseK),baseTx=Number(geo.dataset.baseTx),baseTy=Number(geo.dataset.baseTy);
  if(!Number.isFinite(baseK)||baseK<=0||Number(geo.dataset.zoomTier)!==atlasZoomTier(view.k))return false;
  const fmt=n=>Number(n).toFixed(2);
  geo.setAttribute('transform','translate('+fmt(view.tx)+' '+fmt(view.ty)+') scale('+view.k+')');
  const overlay=svg.querySelector('.map-overlay');
  if(overlay){
    const rk=view.k/baseK,dx=view.tx-baseTx*rk,dy=view.ty-baseTy*rk;
    overlay.setAttribute('transform','translate('+fmt(dx)+' '+fmt(dy)+') scale('+rk.toFixed(4)+')');
  }
  return true;
}

function makeBlockMap(svg,base,data,esc,repaint,enabled) {
  const {streets}=data,world=atlasExtent(streets.map(s=>s.bounds));
  const camera=makeMapCamera(svg,world,repaint,enabled,view=>atlasFastTransform(svg,view));
  const a=base.stations.find(s=>s[0]==='宝安中心'), b=base.stations.find(s=>s[0]==='坪山围');
  const lonScale=(b[1]-a[1])/(b[3][0]-a[3][0]), rad=Math.PI/180;
  const merc=lat=>Math.log(Math.tan(Math.PI/4+lat*rad/2));
  const project=ll=>[a[1]+(ll[0]-a[3][0])*lonScale,a[2]-(merc(ll[1])-merc(a[3][1]))*lonScale/rad];
  const id=svg.id+'-missing';
  const width=t=>Array.from(t).reduce((n,c)=>n+(c.charCodeAt(0)<128?6.6:13),0);
  const fmt=n=>Number(n).toFixed(2);
  const coord=p=>p.map(fmt).join(',');
  function draw({blocks,color,activeStreet,places=[],route=[],special=[],inScope=()=>true,local=null,insights=null,measureName=''}) {
    const view=camera.viewport(),{w,h,k,tx,ty,pt}=view,selected=streets.find(s=>s.id===activeStreet);
    svg.setAttribute('viewBox','0 0 '+w+' '+h);
    const pattern='url(#'+id+')', transform='translate('+fmt(tx)+' '+fmt(ty)+') scale('+k+')';
    const dots=svg.id+'-unverified';
    const layer=['<defs><pattern id="'+dots+'" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="scale('+(1/k)+')"><circle cx="3" cy="3" r="1.05" fill="#193d43" opacity=".66"/></pattern><pattern id="'+id+'" patternUnits="userSpaceOnUse" width="7" height="7" patternTransform="scale('+(1/k)+')"><rect width="7" height="7" fill="#344e51"/><path d="M-1 1L1 -1M0 7L7 0M6 8L8 6" stroke="#506a6a" stroke-width=".8"/></pattern></defs><g class="map-geography" data-zoom-tier="'+atlasZoomTier(k)+'" data-base-k="'+k+'" data-base-tx="'+tx+'" data-base-ty="'+ty+'" transform="'+transform+'">'];
    for(const d of base.districts)layer.push('<path d="'+d.p+'" fill="#253e40" stroke="#526c69" vector-effect="non-scaling-stroke" pointer-events="none"/>');
    const visible=[];
    for(const street of streets){
      const block=blocks.get(street.id),scoped=inScope(street);
      const fill=scoped&&block?.state!=='outside'?(color(block?.value) || pattern):'#2b4244';
      const text=!scoped?'在所选区域以外':(block?.text||'未收录候选')+(block?.state==='partial'?' · '+block.reason:''),p=street.p;
      layer.push('<path class="map-block" data-block="'+esc(street.id)+'" data-state="'+esc(scoped?(block?.state||(Number.isFinite(block?.value)?'known':'missing')):'outside')+'" role="button" tabindex="0" aria-label="'+esc(street.n+'，'+text)+'" aria-pressed="'+(street===selected)+'" d="'+p+'" fill="'+fill+'" fill-rule="evenodd" stroke="#243b3d" stroke-width="1" vector-effect="non-scaling-stroke"><title>'+esc(street.n+' · '+text)+'</title></path>');
      if(scoped&&block?.state==='partial')layer.push('<path d="'+p+'" fill="url(#'+dots+')" pointer-events="none"/>');
      if(scoped){const [x0,y0,x1,y1]=street.bounds;if(x1*k+tx>0&&x0*k+tx<w&&y1*k+ty>0&&y0*k+ty<h)visible.push(street);}
    }
    const west=drawWestAreas({data,local,view:{w,h,k,tx,ty,pt},activeStreet,svgId:svg.id,esc,color,pattern,dots,inScope});
    layer.push(west.geometry);
    if(selected)layer.push('<path class="map-outline" d="'+selected.p+'" fill="none" stroke="#fff3ba" stroke-width="2.6" vector-effect="non-scaling-stroke" pointer-events="none"/>');
    layer.push('</g><g class="map-overlay">');
    if(route.length>1){
      const points=route.map(p=>coord(pt(p))).join(' ');
      layer.push('<polyline class="map-journey" points="'+points+'" fill="none" stroke="#24443e" stroke-width="4.5" pointer-events="none"/><polyline points="'+points+'" fill="none" stroke="#ffe49c" stroke-width="2" stroke-linejoin="round" pointer-events="none"/>');
    }
    const occupied=[[w-46,3,w,108]];
    function space(x,y,bw,bh) {
      const box=[x,y,x+bw,y+bh];
      if(x<2||y<2||box[2]>w-2||box[3]>h-2||occupied.some(b=>x<b[2]+3&&box[2]>b[0]-3&&y<b[3]+2&&box[3]>b[1]-2))return false;
      occupied.push(box);return true;
    }
    function addStreetLabel(street,site){
      const [x,y]=pt(site.point), block=blocks.get(street.id),bw=width(street.short)+2, readable=site.room*k;
      if(readable<bw*.46)return;
      const val=Number.isFinite(block?.value)?block.label||block.text:'', two=val && readable>Math.max(width(val)*.4,10);
      const labelWidth=Math.max(bw,two?width(val):0),bh=two?31:15;
      if(!space(x-labelWidth/2,y-bh/2,labelWidth,bh))return;
      layer.push('<text class="block-name" x="'+fmt(x)+'" y="'+fmt(y+(two?-1:5))+'" text-anchor="middle">'+esc(street.short)+'</text>');
      if(two)layer.push('<text class="block-value" x="'+fmt(x)+'" y="'+fmt(y+14)+'" text-anchor="middle">'+esc(val)+'</text>');
    }
    function areaLabel(item){
      const bw=width(item.name)+4,point=atlasLabelPosition(item,view,bw,16,space);
      if(!point)return false;
      const [x,y]=point;
      layer.push('<text class="area-name" x="'+fmt(x)+'" y="'+fmt(y+4)+'" text-anchor="middle">'+esc(item.name)+'</text>');return true;
    }
    const labelLimit=w<480?3:6,richLabels=[],namedAreas=new Set();
    const westernStreets=new Set(west.shown?(data.zones||[]).map(z=>z.street):[]);
    const order=visible.map(street=>({street,site:atlasLabelShape(street,street.xy).best})).sort((a,b)=>
      Number(b.street===selected)-Number(a.street===selected)||
      Number(Number.isFinite(blocks.get(b.street.id)?.value))-Number(Number.isFinite(blocks.get(a.street.id)?.value))||b.site.room-a.site.room);
    if(insights&&k>=2){
      const streetsToLabel=order.map(({street})=>({kind:'street',id:street.id,name:street.short,title:street.n,shape:street,xy:street.xy,active:street===selected,value:blocks.get(street.id)?.label,
        avoid:westernStreets.has(street.id)?data.zones.filter(z=>z.street===street.id).map(z=>z.bounds):null}));
      const level={hood:0,zone:1,street:2};
      const candidates=[...west.labels,...streetsToLabel].map(item=>{
        const evidence=insights(item.kind,item.id),hasEvidence=!!(evidence?.events?.length||(evidence?.localPolicyCount??evidence?.policies?.length));
        return {...item,evidence,hasEvidence};
      }).sort((a,b)=>Number(!!b.active)-Number(!!a.active)||level[a.kind]-level[b.kind]||Number(b.hasEvidence)-Number(a.hasEvidence));
      for(const item of candidates){
        if(richLabels.length>=labelLimit)break;
        const markup=atlasAreaInsight({...item,measureName},view,insights,space,esc);
        if(markup){richLabels.push(markup);namedAreas.add(item.id);}
      }
    }
    let named=0;
    for(const label of west.labels){if(named+richLabels.length>=labelLimit)break;if(!namedAreas.has(label.id)&&areaLabel(label))named++;}
    if(selected&&inScope(selected)&&!westernStreets.has(selected.id)&&!namedAreas.has(selected.id))addStreetLabel(selected,atlasLabelShape(selected,selected.xy).best);
    // A place label remains tied to its documented position. Collocated labels get a short leader.
    let casual=0;
    for(const item of special.concat(places)){
      if(item.symbol==='work'&&!item.always&&west.shown&&k<8)continue;
      if(!item.symbol&&!item.active&&!item.compared&&(west.shown&&item.zone||k<2.4||casual>=labelLimit))continue;
      const [x,y]=pt(item.xy);
      if(x<0||x>w||y<0||y>h)continue;
      if(item.event){
        const offsets=[[0,0],[19,-15],[-19,-15],[18,16],[-18,16],[0,-29],[0,29]];
        const offset=offsets.find(([dx,dy])=>space(x+dx-12,y+dy-12,24,24))||[0,0];
        layer.push(atlasEventMarker(item.event,x,y,item.active,esc,item.kind,offset));continue;
      }
      const name=item.name, title=esc(name+(item.text?' · '+item.text:'')), active=item.active;
      const attr=item.kind?' data-'+item.kind+'="'+esc(item.id)+'" role="button" tabindex="0" aria-label="'+title+'"':' aria-hidden="true"';
      const ix=fmt(x),iy=fmt(y);
      const caption=item.always||active||(!item.symbol&&k>2.1);
      const part=name.split(' · ').at(-1),short=part.length>10?part.slice(0,9)+'…':part, bw=width(short)+14, bh=21;
      let mark='';
      if(item.symbol==='work')mark='<path d="M0 -7L7 0L0 7L-7 0Z" fill="#ffdc83" stroke="#32403a"/>';
      if(item.symbol==='pick')mark='<circle r="5" fill="#fff1bd" stroke="#23443b" stroke-width="2"/>';
      if(item.compared)mark+='<circle r="8" fill="none" stroke="#fff1bd"/><circle r="11" fill="none" stroke="#fff1bd"/>';
      if(caption){
        const loc=[[8,-bh/2],[-bw-8,-bh/2],[8,-bh-5],[-bw-8,5],[8,8],[8,-bh*2],[-bw-8,bh]].find(([dx,dy])=>space(x+dx,y+dy,bw,bh));
        if(loc){
          const [dx,dy]=loc;
          if(!item.symbol&&!active&&!item.compared){
            casual++;mark+='<rect x="'+dx+'" y="'+dy+'" width="'+bw+'" height="'+bh+'" fill="transparent"/><text class="place-name" x="'+(dx+7)+'" y="'+(dy+14.5)+'">'+esc(short)+'</text>';
          }else mark+='<path d="M0 0L'+fmt(dx<0?dx+bw:dx)+','+fmt(dy+bh/2)+'" stroke="#d9e8d7" pointer-events="none"/><rect x="'+dx+'" y="'+dy+'" rx="4" width="'+bw+'" height="'+bh+'" fill="'+(active?'#fff0c0':'#17383b')+'" stroke="'+(active?'#e7cb80':'#819d93')+'" stroke-width=".75"/><text class="map-chip-text" x="'+(dx+7)+'" y="'+(dy+14.5)+'" style="fill:'+(active?'#193630':'#f0f5e5')+'">'+esc(short)+'</text>';
        }
      }
      if(!mark)continue;
      layer.push('<g class="map-marker" transform="translate('+ix+' '+iy+')"'+attr+'><title>'+title+'</title><circle class="marker-hit" r="8.5" fill="transparent"/>'+mark+'</g>');
    }
    if(k<.8){
      for(const d of base.districts){
        const [x,y]=pt(d.a),name=d.n.replace(/新区$|区$/,'');
        if(!space(x-width(name)/2,y-7,width(name),15))continue;
        layer.push('<text class="district-label" x="'+fmt(x)+'" y="'+fmt(y+4)+'" text-anchor="middle">'+esc(name)+'</text>');
      }
    }
    for(const {street,site} of order)if(street!==selected&&!westernStreets.has(street.id)&&!namedAreas.has(street.id))addStreetLabel(street,site);
    layer.push(...richLabels,'</g>');
    replaceMapMarkup(svg,layer.join(''));
    if(local?.legend){local.legend.hidden=!west.shown;if(west.shown)local.legend.dataset.detail=west.detail?'homes':'zones';}
  }
  return {draw,camera,project,world};
}
