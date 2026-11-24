/* Personal preference weights and evidence used by the map, discovery and comparison. */
window.RentalFit = (() => {
  'use strict';
  const names = {commute:'通勤', rent:'租金', environment:'环境', convenience:'生活便利'};
  const keys = Object.keys(names);
  const bound = n => Math.max(0, Math.min(100, n));
  const money = n => n.toLocaleString('zh-CN');
  const weight = n => [1,2,3].includes(Number(n)) ? Number(n) : 1;
  const rating = n => Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
  const missing = (value, why) => ({value, why, score:null});
  const observed = (name, entry) => {
    const stars = rating(entry?.[name]);
    if (!stars) return missing('待踩点', name === 'environment' ? '到楼栋听一听临街和卧室的声音' : '从住处走一遍你常用的买菜、用餐路线');
    return {value:stars+' / 5', why:'我的现场感受'+(entry.observed?' · '+entry.observed:''), score:(stars-1)*25, stars};
  };
  function assess(row, options, entry, weights) {
    const minutes = row.route?.minutes;
    const dimensions = {};
    if (Number.isFinite(minutes)) {
      let ratio = minutes / options.limit;
      let why = '模型估算 · 单程上限 '+options.limit+' 分钟';
      if (options.secondary && options.secondMax && row.future) {
        ratio = Math.max(ratio, row.future.minutes / options.secondMax);
        why += '，未来 '+row.future.minutes+' / '+options.secondMax+' 分钟，取较紧的一程';
      }
      dimensions.commute = {value:minutes+' 分钟', why, score:bound(100-40*ratio)};
      if (options.secondary && options.secondMax && !row.future) dimensions.commute = missing(minutes+' 分钟','未来工作地的路线待核');
    } else dimensions.commute = missing('待核路线','当前方式缺少可用路线');
    const quote = row.price?.price;
    if (!Number.isFinite(quote)) dimensions.rent = missing('缺租金样本','需要同居室的月租记录');
    else {
      const value = money(quote)+' 元/月';
      const basis = [row.price.unit,row.price.date].filter(Boolean).join(' · ');
      dimensions.rent = options.budget
        ? {value, why:basis+' · '+(quote<=options.budget?'预算余 '+money(options.budget-quote):'超预算 '+money(quote-options.budget))+' 元', score:bound(100-40*quote/options.budget)}
        : missing(value,basis+' · 填写预算可计算适配');
    }
    dimensions.environment = observed('environment',entry);
    dimensions.convenience = observed('convenience',entry);
    const total = keys.reduce((sum,k)=>sum+weight(weights[k]),0);
    let earned=0, unknown=0, count=0;
    for (const k of keys) {
      const part = dimensions[k];
      part.weightShare=weight(weights[k])/total;
      if (part.score == null) {unknown += weight(weights[k]); continue;}
      earned += weight(weights[k])*part.score;
      count++;
    }
    const low = Math.round(earned/total);
    const high = Math.round((earned+100*unknown)/total);
    const weak = keys.filter(k=>dimensions[k].score != null && dimensions[k].score < 60);
    return {dimensions, low, high, count, weak, meets:count===keys.length && !weak.length};
  }
  const range = fit => fit.count===keys.length ? String(fit.low) : fit.low+'–'+fit.high;
  const rank = (a,b) => Number(b.fit.meets)-Number(a.fit.meets) || b.fit.low-a.fit.low ||
    b.fit.count-a.fit.count || Number(!!b.price?.price)-Number(!!a.price?.price) ||
    (a.route?.minutes??Infinity)-(b.route?.minutes??Infinity) || a.c.name.localeCompare(b.c.name,'zh');
  function changes(row, reference, weights) {
    if (!reference || reference.c.id===row.c.id) return [];
    const out = [];
    const add = (key,delta,better,worse,unit,title=names[key]) => {
      if (!Number.isFinite(delta) || !delta) return;
      out.push({key,better:delta>0,text:title+(delta>0?better:worse)+money(Math.abs(delta))+unit});
    };
    if (row.route && reference.route) add('commute',reference.route.minutes-row.route.minutes,'少 ','多 ',' 分钟');
    if (row.future && reference.future) add('commute',reference.future.minutes-row.future.minutes,'少 ','多 ',' 分钟','未来通勤');
    const a=row.price, b=reference.price;
    const sameMonth=a?.date && a.date.slice(0,7)===b?.date?.slice(0,7);
    if (a?.price && b?.price && a.unit===b.unit && a.room>0 && a.room===b.room &&
       ((a.peer && a.peer===b.peer) || (sameMonth && ['单套整租挂牌','我的整租记录'].includes(a.unit)))) {
      add('rent',b.price-a.price,'样本低 ','样本高 ',' 元/月');
    }
    for (const k of ['environment','convenience']) {
      const left=row.fit.dimensions[k].stars, right=reference.fit.dimensions[k].stars;
      if (left && right) add(k,left-right,'体验高 ','体验低 ',' 档');
    }
    return out.sort((a,b)=>weight(weights[b.key])-weight(weights[a.key]));
  }
  function next(rows, seen, reference, weights) {
    const pool=rows.filter(r=>!seen.has(r.c.id) && r.c.id!==reference?.c.id);
    const sorted=pool.slice().sort(rank);
    if (!reference) return sorted[0];
    const alternatives=sorted.map(row=>({row,delta:changes(row,reference,weights)}));
    const stronger=alternatives.find(a=>a.delta.length && a.delta.every(d=>d.better));
    return stronger?.row || alternatives.find(a=>a.delta.some(d=>d.better))?.row || sorted[0];
  }
  function layerColor(row, layer) {
    const fit=row.fit;
    if (!fit) return '#a8b7b4';
    const score=layer==='fit' ? (fit.count ? fit.low : null) : fit.dimensions[layer]?.score;
    if (score == null) return '#9aa9a7';
    return score>=75?'#ffca76':score>=50?'#b0e3b5':score>=25?'#70c4ba':'#74a5b9';
  }
  return {names,keys,weight,assess,range,rank,changes,next,layerColor};
})();
