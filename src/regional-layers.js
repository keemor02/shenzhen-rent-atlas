/* District statistics keep their source period and units at every map zoom. */
function makeRegionalLayers(base, esc) {
  const kinds = [
    {id:'community', label:'普通小区'}, {id:'apt', label:'集中式公寓'},
    {id:'village', label:'城中村单间'}, {id:'all', label:'住宅挂牌综合样本'},
    {id:'ref0', label:'商品小区参考'}, {id:'ref1', label:'商务公寓参考'},
    {id:'ref2', label:'城中村私宅参考'}
  ];
  const districts = new Map(base.districts.map(d => [d.n, d]));
  const kindName = new Map(kinds.map(k => [k.id, k.label]));
  const referenceIndex = {ref0:0, ref1:1, ref2:2};
  const community = base.apartment.currentCommunity || base.apartment.ordinary;
  const apartment = base.apartment.currentApartment;
  const villages = base.villageRecent;
  const listing = base.apartment.listing;
  const listingURL = month => 'https://www.creprice.cn/report/sz/' + month + '.html';
  const monthOf = url => /\/(20\d\d-(?:0[1-9]|1[0-2]))\.html$/.exec(url)?.[1] || '';
  let listingMonth = monthOf(listing.sources.at(-1));
  let listingPrior = monthOf(listing.sources[0]);
  let listings = new Map(base.districts.map(d => [d.n, {price:d.oct2026, prior:d.oct2025, yoy:d.yoy_pct}]));
  const finite = Number.isFinite;
  const number = n => n.toLocaleString('zh-CN', {maximumFractionDigits:2});
  const pct = n => (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  const unit = '元/㎡·月';
  const metricLabel = {price:'均价', yoy:'同比涨跌', mom:'环比涨跌'};
  const blues = ['#2c4050','#38536a','#466980','#5786a6','#79a8c7'];
  const changes = ['#739ec2','#517693','#344d60','#75543c','#a76e46'];

  function options(kind) {
    if (kind === 'community') {
      const rows = Object.values(community.by_district);
      return ['price','yoy','mom'].filter(key => key === 'price' || rows.some(row => finite(row[key + '_pct'])))
        .map(id => ({id, label:metricLabel[id]}));
    }
    if (kind === 'all') {
      const ids = [...listings.values()].some(row => finite(row.yoy)) ? ['price','yoy'] : ['price'];
      return ids.map(id => ({id, label:metricLabel[id]}));
    }
    if (!kindName.has(kind)) return [];
    const label = kind === 'village' ? '单间区间' : kind === 'apt' ? '约均价' : '参考价';
    return [{id:'price', label}];
  }
  function period(layer, kind) {
    if (layer === 'density') return '2025年末';
    if (kind === 'all') return listingMonth;
    if (kind === 'community') return community.asof;
    if (kind === 'apt') return (apartment?.asof || '').replace('-H1','年上半年').replace('-H2','年下半年') + ' · 图表估读';
    if (kind === 'village') return villages.asof;
    return '2022年度';
  }
  function valueFor(d, layer, kind, metric) {
    if (layer === 'density') return d.density;
    if (kind === 'community') return community.by_district[d.n]?.[metric === 'price' ? 'price' : metric + '_pct'];
    if (kind === 'all') return metric === 'mom' ? null : listings.get(d.n)?.[metric];
    if (metric !== 'price') return null;
    if (kind === 'village') return villages.by_district[d.n]?.range?.[0];
    if (kind === 'apt') return apartment?.by_district[d.n]?.price_approx;
    return d.refs?.[referenceIndex[kind]];
  }
  function scale(layer, kind, metric) {
    if (layer === 'density') return {cuts:[3000,7000,11000,15000], colors:blues, basis:'人口密度（人/km²）'};
    if (metric === 'price') {
      const basis = kind === 'village' ? '单间区间下限' : kind === 'apt' ? '约均价' : Object.hasOwn(referenceIndex,kind) ? '参考价' : '区级均价';
      return {cuts:[40,60,80,100], colors:blues, basis:basis + '（' + unit + '）'};
    }
    if (kind === 'local') {
      const cuts = metric === 'mom' ? [-4,-1,1,4] : [-8,-1,1,8];
      return {cuts, colors:changes, basis:(metric === 'mom' ? '片区环比' : '片区同比') + '（%）'};
    }
    const cuts = metric === 'mom' ? [-0.5,-0.1,0,0.1] : kind === 'all' ? [-6,-3,0,3] : [-2,-0.5,0,1];
    return {cuts, colors:changes, basis:metricLabel[metric] + '（%）'};
  }
  function paint(value,layer,kind,metric) {
    if(!finite(value)) return null;
    const {cuts,colors}=scale(layer,kind,metric);
    return colors[cuts.filter(n=>value>=n).length];
  }
  function legend(layer, kind, metric='price', values=null) {
    const {cuts, colors, basis} = scale(layer, kind, metric);
    const stops = colors.map((color,i) => {
      const text = i === 0 ? '<' + number(cuts[0]) : i === cuts.length ? '≥' + number(cuts.at(-1)) : number(cuts[i-1]) + ' 至 <' + number(cuts[i]);
      return '<span class="legend-stop"><i style="background:' + color + '"></i>' + esc(text) + '</span>';
    });
    if (values ? values.some(value=>!finite(value)) : base.districts.some(d => !finite(valueFor(d,layer,kind,metric)))) {
      stops.push('<span class="legend-stop"><i class="no-sample"></i>缺资料</span>');
    }
    return '<span class="legend-basis">' + esc(basis) + '</span>' + stops.join('');
  }
  function sources(pairs) {
    const links = pairs.filter(([,url]) => typeof url === 'string' && /^https?:\/\/[^\s<>"']+$/i.test(url))
      .map(([label,url]) => '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(label) + '</a>');
    return links.length ? '<p class="measure-note">' + links.join(' · ') + '</p>' : '';
  }
  function summary(name, layer, kind='community', metric='price') {
    const d = districts.get(name);
    if (!d) return {value:null, label:'—', fill:null, detail:''};
    const raw = valueFor(d,layer,kind,metric);
    const value = finite(raw) ? raw : null;
    const fill = paint(value,layer,kind,metric);
    let label = value === null ? '—' : number(value), caption = unit, note = '', links = [];
    if (layer === 'density') {
      caption = '人/km²';
      note = finite(d.pop) && finite(d.area) ? '常住人口 ' + number(d.pop) + ' 万人 · 陆域面积 ' + number(d.area) + ' km²' : '';
      links = [['区人口公报',d.popSrc],['陆域面积',base.densSrc]];
    } else if (kind === 'community' || kind === 'all') {
      const rawRow = community.by_district[name];
      const row = kind === 'community' ? {price:rawRow?.price, yoy:rawRow?.yoy_pct, mom:rawRow?.mom_pct} : (listings.get(name) || {});
      if (metric !== 'price') {
        label = value === null ? '—' : pct(value);
        caption = metricLabel[metric];
      }
      const other = [];
      if (metric !== 'price' && finite(row.price)) other.push('均价 ' + number(row.price) + ' ' + unit);
      if (metric !== 'yoy' && finite(row.yoy)) other.push('同比 ' + pct(row.yoy));
      if (metric !== 'mom' && finite(row.mom)) other.push('环比 ' + pct(row.mom));
      if (kind === 'all' && finite(row.prior)) other.push('去年同月 ' + number(row.prior) + ' ' + unit);
      note = other.join(' · ');
      if (kind === 'community') {
        const urls = community.sources || community.source_urls || [];
        links = [['中指小区样本',urls[0]],['分区数据',urls[1]]];
      } else {
        links = [['本期挂牌报告',listingURL(listingMonth)],['上年同期',listingURL(listingPrior)]];
      }
    } else if (kind === 'apt') {
      if (value !== null) label = '约 ' + number(value);
      note = '市场化及保障性项目样本，分区柱图按 30 天折算。';
      links = [['克而瑞半年报',apartment?.sources[0]],['分区原图',apartment?.sources[1]]];
    } else if (kind === 'village') {
      const sample = villages.by_district[name];
      if (value !== null) label = sample.range.map(number).join('–');
      note = sample?.note || villages.partial?.[name]?.note || '';
      links = [['珊瑚数据 · 单间样本',villages.sources[0]],['该区原图',sample?.source]];
    } else {
      note = kind === 'ref2' ? '城中村私宅按空房标准。' : '普通装修，配基本家具家电。';
      const refs = base.refSources || [];
      links = [['发布通知',refs[0]?.url],['官方查询',refs[1]?.url],['分区数字',refs[2]?.url]];
    }
    const topic = layer === 'density' ? '常住人口密度' : (kindName.get(kind) || '');
    const detail = '<p class="place-location">' + esc(period(layer,kind) + ' · ' + topic) + '</p><h2>' + esc(name) + '</h2>' +
      (value === null ? '<p class="measure-note">本期缺同口径数据</p>' :
        '<p class="block-stat"><strong>' + esc(label) + '</strong><span>' + esc(caption) + '</span></p>') +
      (note ? '<p class="measure-note">' + esc(note) + '</p>' : '') + sources(links);
    return {value,label,fill,detail};
  }
  // main.js validates and stores the feed. This model keeps the published period and its rows together.
  function update(report) {
    const month = report?.month, prior = report?.prior;
    if (typeof month !== 'string' || !/^20\d\d-(?:0[1-9]|1[0-2])$/.test(month) || month < listingMonth ||
        prior !== (Number(month.slice(0,4))-1) + month.slice(4) || report.url !== listingURL(month)) return false;
    const next = new Map();
    for (const [name,row] of Object.entries(report.rows || {})) {
      if (districts.has(name) && finite(row?.price) && row.price > 0) {
        next.set(name,{price:row.price, prior:row.prior, yoy:row.yoy});
      }
    }
    if (!next.size) return false;
    listings = next; listingMonth = month; listingPrior = prior;
    return true;
  }
  return {kinds, options, summary, legend, period, update, paint};
}
