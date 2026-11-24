/* Named public facilities retain their documented street and any finer, verified links. */
function makeFacilities(snapshot,data,esc){
  const streets=new Map(data.streets.map(s=>[s.id,s])),hoods=new Map(data.hoods.map(h=>[h.id,h]));
  const names={market:'菜市场',supermarket:'超市',health:'医疗服务',park:'公园',pharmacy:'药店',library:'图书馆',sport:'运动场地'};
  const categoryName=key=>names[key]||'其他设施';
  const list=[],ids=new Set();
  for(const item of snapshot.facilities||[]){
    if(!item?.id||ids.has(item.id)||!item.name||!streets.has(item.streetId)||!/^https?:\/\/[^\s<>"']+$/i.test(item.source))continue;
    const links=[...new Set((item.hoodIds||[]).filter(id=>hoods.get(id)?.street===item.streetId))];
    ids.add(item.id);list.push({...item,hoodIds:links,zones:[...new Set(links.map(id=>hoods.get(id)?.zone).filter(Boolean))]});
  }
  const types=[...new Set(list.map(f=>f.category))];
  function records(layer,filter='',area={}){
    return list.filter(item=>(layer!=='environment'||item.category==='park')&&(!filter||layer==='environment'||item.category===filter)&&
      (!area.district||streets.get(item.streetId).d===area.district)&&(!area.street||item.streetId===area.street)&&
      (!area.zone||item.zones.includes(area.zone))&&(!area.hood||item.hoodIds.includes(area.hood)));
  }
  const noun=layer=>layer==='environment'?'公园':'设施';
  function measure(items,layer){
    if(!items.length)return {value:null,text:'暂无可定位的'+noun(layer)+'记录',label:'',state:'missing'};
    return {value:items.length,label:items.length+' 处',text:items.length+' 处已核实'+noun(layer),state:'known'};
  }
  function paint(n){
    if(!Number.isFinite(n)||n<=0)return null;
    return n<2?'#405958':n<4?'#467b74':n<7?'#5d9b87':'#8ab9a0';
  }
  function legend(layer){
    return '<span class="legend-basis">已核实'+noun(layer)+'（处）</span>'+[[1,'1'],[2,'2–3'],[4,'4–6'],[7,'≥7']].map(([n,label])=>
      '<span class="legend-stop"><i style="background:'+paint(n)+'"></i>'+label+'</span>').join('')+
      '<span class="legend-stop"><i class="no-sample"></i>待收录</span>';
  }
  function links(items){
    if(!items.length)return '';
    const row=item=>'<li><span><strong>'+esc(item.name)+'</strong> <small>'+esc(categoryName(item.category))+'</small></span>'+
      (item.address?'<span class="measure-note">'+esc(item.address)+'</span>':'')+
      '<a href="'+esc(item.source)+'" target="_blank" rel="noopener noreferrer" title="'+esc(item.sourceName||'公开名录')+'">'+esc(item.sourceName||'来源')+(item.sourceDate?' · '+esc(item.sourceDate):'')+'</a></li>';
    const first=items.slice(0,4),rest=items.slice(4);
    return '<ul class="facility-list">'+first.map(row).join('')+'</ul>'+(rest.length?'<details class="probe-detail"><summary>其余 '+rest.length+' 处</summary><ul class="facility-list">'+rest.map(row).join('')+'</ul></details>':'');
  }
  function facts(candidate){
    const street=candidate?.street?.id;if(!street)return {};
    const result={};
    for(const layer of ['convenience','environment']){
      const local=records(layer,'',{hood:candidate.id}),parent=records(layer,'',{street});
      if(local.length)result[layer]='片区 '+local.length+' 处'+noun(layer);
      else if(parent.length)result[layer]='街道 '+parent.length+' 处'+noun(layer);
    }
    return result;
  }
  return {records,measure,paint,legend,links,facts,types,categoryName,noun};
}
