function makeFitView(esc) {
  const fit=window.RentalFit;
  const format=n=>Number(n).toLocaleString('zh-CN');

  function discoveryReason(row,opt) {
    const savings=[];
    if(opt.budget && row.price?.price>0 && row.price.price<opt.budget)
      savings.push('月租样本比预算低 '+format(opt.budget-row.price.price)+' 元');
    if(row.route && row.route.minutes<opt.limit)
      savings.push('单程比上限短 '+format(opt.limit-row.route.minutes)+' 分钟');
    return savings.length?'<p class="fit-reason">'+esc(savings.join('，'))+'。</p>':'';
  }

  function card(row,opt,discovered=false) {
    const f=row.fit;
    const dimensions=fit.keys.map(key=>{
      const part=f.dimensions[key],fact=row.facilityFacts?.[key];
      const state=fact?'documented':part.score==null?'pending':part.score<60?'tradeoff':'known';
      let value=part.value;
      if(key==='environment'||key==='convenience')value=fact||(part.stars?'实评 '+part.value:'暂无资料');
      const reading=fact?'<button type="button" class="facility-fact" data-show-facilities="'+key+'" aria-label="查看'+esc(value)+'">'+esc(value)+' ›</button>':'<strong>'+esc(value)+'</strong>';
      return '<div class="fit-dimension '+state+'"><dt>'+esc(fit.names[key])+'</dt><dd>'+reading+'</dd></div>';
    }).join('');
    const breakdown=fit.keys.map(key=>{
      const part=f.dimensions[key];
      const why=part.score==null && (key==='environment'||key==='convenience')?'暂无现场评分':part.why;
      return '<li>'+esc(fit.names[key])+' · '+(part.score==null?'待核':Math.round(part.score)+' 分')+' · '+esc(why)+'</li>';
    }).join('');
    const score=f.count?esc(fit.range(f))+' 分':'待核';
    return '<section class="fit-card" aria-label="个人适配"><div class="fit-heading"><h3>个人适配</h3><b>'+score+'</b></div>'+
      (discovered?discoveryReason(row,opt):'')+'<dl class="fit-grid">'+dimensions+'</dl>'+
      '<details class="fit-breakdown"><summary>评分依据</summary><p>四项等权，有缺项时显示分数区间。</p><ul>'+breakdown+'</ul></details></section>';
  }

  function recommendations(rows,opt) {
    const top=rows.slice().sort(fit.rank).slice(0,3);
    if(!top.length)return '<h2>当前条件下没有候选</h2><p>'+(opt.saved?'试试取消「只看收藏」。':'可放宽预算或通勤上限。')+'</p>';
    const list=top.map(row=>'<li><button type="button" data-pick="'+esc(row.c.id)+'">'+esc(row.c.name)+'</button><span>'+
      row.route.minutes+' 分钟 · '+(row.price?.price?format(row.price.price)+' 元/月':'租金待核')+'</span></li>').join('');
    return '<h2>优先探索</h2><ul class="place-selection">'+list+'</ul>';
  }

  return {card,recommendations};
}
