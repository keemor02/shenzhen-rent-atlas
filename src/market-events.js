/* Market events use the atlas projection and keep the source's judgment separate from the observed event. */
function makeMarketEvents(base,esc) {
  const events=base.events||[],byKey=new Map(events.map(event=>[event.key,event]));
  const icons=new Map([
    ['产业迁移','<path d="M-8-3H6L2-7M8 4H-6l4 4"/>'],
    ['地铁开通','<rect x="-6" y="-8" width="12" height="13" rx="3"/><path d="M-6-2H6M-4 8l2-3m6 3L2 5M-3 1h1m4 0h1"/>'],
    ['住房供应','<path d="M-8-1l7-6 7 6M-6-2v9h5m-2-5h2v5M5 1v7m-3.5-3.5h7"/>'],
    ['租金调整','<path d="M-8-7h8l8 8-7 7-9-9z"/><circle cx="-4" cy="-3" r="1"/>'],
    ['租金梯度','<path d="M-8 6h5V2h5v-5h6M-6 7V4M0 2v-4m6-1v-5"/>']
  ]);
  const colors=new Map([
    ['议价样本','#8ec9f2'],['议价观察','#98ccab'],['溢价留意','#f4b475'],
    ['供需观察','#b8c3be'],['相对低租','#e8a3d1']
  ]);
  const typeNames=[...new Set(events.map(event=>event.type))];
  const signalNames=[...new Set(events.map(event=>event.signal))];
  const ordered=(map,names)=>[...map.keys()].filter(key=>names.includes(key)).concat(names.filter(key=>!map.has(key)));
  const types=ordered(icons,typeNames),signals=ordered(colors,signalNames);
  const pairs=[['dachong','island'],['houhai','guiwan']];
  const shortNames={dachong:'科兴',houhai:'后海',xili:'西丽北部'};
  const shortName=event=>Object.hasOwn(shortNames,event.key)?shortNames[event.key]:event.area.split('·').at(-1).trim();
  const color=signal=>colors.get(signal)||'#d3d9d4';
  const matches=(event,filter)=>!filter||event.type===filter||event.signal===filter;
  const pairFor=key=>pairs.find(pair=>pair.includes(key)&&pair.every(id=>byKey.has(id)));
  const glyphPaths=type=>icons.get(type)||'<circle r="4"/>';
  function icon(type) {
    return '<svg class="event-icon market-icon" aria-hidden="true" focusable="false" viewBox="-12 -12 24 24"><g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'+glyphPaths(type)+'</g></svg>';
  }
  function filterButton(value,label,active,prefix='') {
    return '<button type="button" data-market-filter="'+esc(value)+'" aria-pressed="'+(active===value)+'">'+prefix+esc(label)+'</button>';
  }
  function filters(filter='') {
    return '<div class="event-legend market-filters" role="group" aria-label="片区事件类型">'+filterButton('','全部',filter)+
      types.map(type=>filterButton(type,type,filter,icon(type))).join('')+'</div>';
  }
  function legend(filter='') {
    return '<div class="event-legend market-judgments" role="group" aria-label="租房判断">'+signals.map(signal=>{
      const swatch='<i aria-hidden="true" style="display:inline-block;width:.7em;height:.7em;border-radius:2px;background:'+color(signal)+'"></i>';
      return filterButton(signal,signal,filter,swatch);
    }).join('')+'</div>';
  }
  function markers(filter='',key='') {
    return events.filter(event=>matches(event,filter)&&Array.isArray(event.xy)&&event.xy.length===2&&event.xy.every(Number.isFinite))
      .map(event=>({id:event.key,xy:event.xy,name:shortName(event),title:event.area,type:event.type,signal:event.signal,selected:event.key===key}))
      .sort((a,b)=>Number(a.selected)-Number(b.selected));
  }
  function glyph(marker,x,y) {
    if(!Number.isFinite(x)||!Number.isFinite(y))return '';
    const title=esc([marker.title,marker.type,marker.signal].join(' · '));
    const ring=marker.selected?'<rect x="-13" y="-13" width="26" height="26" rx="7" fill="none" stroke="#fff0b4" stroke-width="2.5"/>':'';
    const label=marker.selected?'<text class="area-name" text-anchor="middle" y="27" pointer-events="none">'+esc(marker.name)+'</text>':'';
    return '<g class="map-marker market-marker" role="button" tabindex="0" data-market-event="'+esc(marker.id)+'" aria-pressed="'+marker.selected+'" aria-label="'+title+'" transform="translate('+x+' '+y+')"><title>'+title+'</title>'+
      '<rect x="-10" y="-10" width="20" height="20" rx="5" fill="'+color(marker.signal)+'" stroke="#193338" stroke-width="1.5"/>'+
      '<g aria-hidden="true" fill="none" stroke="#173238" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">'+glyphPaths(marker.type)+'</g>'+ring+
      '<rect class="marker-hit" x="-12" y="-12" width="24" height="24" rx="6" fill="transparent"/>'+label+'</g>';
  }
  function connections(key='',filter='') {
    return pairs.filter(pair=>(!key||pair.includes(key))&&pair.every(id=>{
      const event=byKey.get(id);
      return event&&matches(event,filter)&&Array.isArray(event.xy)&&event.xy.length===2&&event.xy.every(Number.isFinite);
    })).map(([from,to])=>({from:byKey.get(from).xy,to:byKey.get(to).xy,fromId:from,toId:to}));
  }
  function overview(filter='') {
    const visible=events.filter(event=>matches(event,filter));
    if(!visible.length)return '<h2>片区事件</h2><p class="measure-note">暂无这类事件。</p>';
    const entries=visible.map(event=>{
      const label=esc(event.area+' · '+event.title);
      return '<button type="button" data-market-event="'+esc(event.key)+'" title="'+label+'" aria-label="'+label+'">'+esc(shortName(event))+'</button>';
    });
    return '<h2>片区事件</h2><div class="fine-chips market-places">'+entries.join('')+'</div>';
  }
  function card(key) {
    const event=byKey.get(key);
    if(!event)return '';
    const pair=pairFor(key);
    const linked=pair?'<div class="fine-chips market-pair" role="group" aria-label="团队迁移方向">'+pair.map((id,i)=>{
      const label=esc(shortName(byKey.get(id))+' · '+(i?'迁入':'迁出'));
      return id===key?'<strong>'+label+'</strong>':'<button type="button" data-market-event="'+esc(id)+'">'+label+'</button>';
    }).join('<span aria-hidden="true">→</span>')+'</div>':'';
    const sourceLinks=(event.ref||[]).filter(link=>Array.isArray(link)&&/^https?:\/\/[^\s"<>]+$/i.test(link[1])).map(([label,href])=>
      '<a href="'+esc(href)+'" rel="noopener noreferrer" target="_blank">'+esc(label)+'</a>').join(' ');
    return '<p class="place-location">'+esc([event.dist,event.type,event.date].filter(Boolean).join(' · '))+'</p><h2>'+esc(event.area)+'</h2>'+linked+
      '<h3>'+esc(event.title)+'</h3><p>'+esc(event.fact)+'</p>'+
      '<h3>租房判断 · '+esc(event.signal)+'</h3><p>'+esc(event.view)+'</p>'+
      '<div class="probe-actions"><button type="button" data-explore-market="'+esc(key)+'">在此找房</button><button type="button" data-market-event="">事件列表</button></div>'+
      (event.test?'<details class="probe-detail"><summary>核实条件</summary><p>'+esc(event.test)+'</p></details>':'')+
      (sourceLinks?'<div class="fine-links market-sources" aria-label="事件来源">'+sourceLinks+'</div>':'');
  }
  return {filters,legend,markers,glyph,connections,card,overview,has:key=>byKey.has(key),get:key=>byKey.get(key)};
}
