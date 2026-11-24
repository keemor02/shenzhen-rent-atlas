'use strict';

function makeAreaInsights(base, data, policyData, esc) {
  const byId = rows => new Map((rows || []).map(row => [String(row.id), row]));
  const areas = {
    district: new Map((base.districts || []).map(row => [row.n, row])),
    street: byId(data.streets),
    zone: byId(data.zones),
    hood: byId(data.hoods)
  };
  const sourceUrl = value => typeof value === 'string' && /^https?:\/\/[^\s"<>]+$/i.test(value);
  const environment = typeof window === 'undefined' ? {} : window;
  const stationStreet = new Map(Object.entries(data.stStreet || {}));
  for (const street of areas.street.values()) {
    for (const station of street.stations || []) {
      if (!stationStreet.has(station)) stationStreet.set(station, street.id);
    }
  }
  function locate(kind, id) {
    if (!Object.hasOwn(areas, kind)) return null;
    const item = areas[kind]?.get(String(id));
    if (!item) return null;
    const street = kind === 'street' ? item : areas.street.get(String(item.street));
    return {
      id: String(id), kind, name: item.n, item, street,
      district: kind === 'district' ? item.n : item.d || street?.d,
      zone: kind === 'zone' ? item : areas.zone.get(item.zone)
    };
  }

  // Each entry interprets the named event and its original evidence, at its reported scale.
  const readings = {
    dachong: ['down', '需求可能减弱', '团队迁出，科兴附近有议价样本，同期也有小区加价。'],
    island: ['mixed', '供需并存', '团队迁入带来需求，园区同时提供四千余套员工公寓。'],
    guiwan: ['up', '需求可能走强', 'OPPO 部分员工迁入桂湾，附近另有一套两房加价续租。'],
    houhai: ['down', '需求可能减弱', 'OPPO 部分办公迁出，原办公点步行圈的小户型可能少一批租客。'],
    liuxian: ['down', '同类供应增加', '创智云城新增保租房，附近面积相近的一房、两房多了比价选择。'],
    shangwu: ['up', '近站加价预期', '换乘改善后有续约加价通知，实际签约价仍待核实。'],
    phoenix: ['watch', '通勤变化', '新线既改善通勤，也增加其他沿线选择，租金方向待观察。'],
    pingzhou: ['down', '同类供应增加', '海岚居新增有资格与名额限制的房源，可与附近相近面积一房比价。'],
    changzhen: ['down', '同类供应增加', '本批三房面向符合条件的四人及以上家庭，影响集中在相近户型。'],
    beer: ['up', '需求可能走强', '总部迁入兴东，周边租房的员工人数尚未披露。'],
    bantian: ['down', '部分单间让价', '经纪人实访与公寓项目监测均有下调记录，覆盖不同单间。'],
    meilin: ['down', '部分单间让价', '上梅林部分集中式公寓单间有调价记录，适用该批项目。'],
    fuyong: ['watch', '单套议价个案', '租客在运营交接时谈下月租，区域走势仍待观察。'],
    xili: ['watch', '现状价差', '同季不同村落和总部片区的租金有差距，缺少同地跨期比较。']
  };
  function unique(rows, key) {
    const seen = new Map();
    for (const row of rows || []) {
      if (row?.[key] && !seen.has(row[key])) seen.set(row[key], row);
    }
    return [...seen.values()];
  }
  const marketEvents = unique(base.events, 'key').map(event => {
    const hood = areas.hood.get('e-' + event.key);
    const streetId = hood?.street || stationStreet.get(event.station) ||
      (data.streets || []).find(street => street.events?.includes(event.key))?.id;
    const [direction, signal, basis] = readings[event.key] || ['watch', event.signal || '片区观察', event.view || event.fact];
    const ref = (event.ref || []).find(item => Array.isArray(item) && sourceUrl(item[1]));
    return {
      id: event.key, kind: 'market', title: event.title, category: event.type, date: event.date, fact: event.fact,
      direction, signal, basis, station: event.station, area: event.area,
      source: ref?.[1], sourceName: ref?.[0], streetId, district: event.dist || areas.street.get(streetId)?.d,
      zoneId: hood?.zone, hoodId: hood?.id
    };
  });
  const publicEvents = unique(environment.worldEvents, 'id').map(event => ({
    id: event.id, kind: 'public', title: event.name, category: event.kind, date: event.observed, until: event.until,
    fact: event.fact, direction: 'watch', signal: event.kind,
    basis: String(event.fact || event.status || '').split('。', 1)[0] + '。', near: event.near || [],
    anchor: event.anchor, source: event.url, sourceName: event.source
  }));
  function marketRelation(place, event) {
    const namedArea = event.area || event.station || '';
    if (place.kind === 'district' && place.id === event.district) return [namedArea, true];
    if (place.kind === 'street' && place.id === event.streetId) {
      return [event.station ? '定位参照 · ' + event.station + '站' : namedArea, true];
    }
    if (place.kind === 'hood' && place.id === event.hoodId) return [namedArea, true];
    if (place.kind === 'zone') {
      if (place.id === event.zoneId) return [namedArea, true];
      if (event.station === place.name && event.streetId === place.street?.id) return ['同站参照 · ' + event.station + '站', false];
    }
    if (place.kind === 'hood' && event.station && event.streetId === place.street?.id && event.station === place.item.station) {
      return ['同站参照 · ' + event.station + '站', false];
    }
    if (place.kind === 'hood' && place.item.events?.includes(event.id)) return ['片区关联 · ' + namedArea, false];
    return null;
  }
  function publicRelation(place, event) {
    const near = event.near.filter(name => {
      const streetId = stationStreet.get(name);
      if (place.kind === 'district') return areas.street.get(streetId)?.d === place.id;
      if (place.kind === 'street') return streetId === place.id;
      if (streetId !== place.street?.id) return false;
      return name === (place.kind === 'zone' ? place.name : place.item.station);
    });
    return near.length ? '邻站参照 · ' + near.join('、') : '';
  }
  function eventsFor(place) {
    const result = [];
    for (const event of marketEvents) {
      const match = marketRelation(place, event);
      if (match) result.push({...event, relation: match[0], contributes: match[1]});
    }
    for (const event of publicEvents) {
      const relation = publicRelation(place, event);
      if (relation) result.push({...event, relation, contributes: false});
    }
    return result;
  }
  function outlookFor(events) {
    const local = events.filter(row => row.contributes);
    const directional = local.filter(row => row.direction !== 'watch');
    const singleReason = directional.length === 1 ? directional[0].basis : '';
    const up = local.some(row => row.direction === 'up' || row.direction === 'mixed');
    const down = local.some(row => row.direction === 'down' || row.direction === 'mixed');
    if (up && down) return {direction: 'mixed', label: '线索分歧', reason: singleReason || '不同事件给出了方向相反的供需线索。'};
    if (up) return {direction: 'up', label: '偏涨线索', reason: singleReason || '本地事件提示部分房源有加价预期。'};
    if (down) return {direction: 'down', label: '偏跌线索', reason: singleReason || '相关房源出现让价记录或同类供应增加。'};
    return {direction: 'watch', label: '待观察', reason: local.length ? '现有记录不足以判断租金方向。' :
      events.length ? '现有记录涉及公共事件或附近站点，缺少本地供需依据。' : '尚无本地租金方向的事件依据。'};
  }

  const roomNames = ['', '一室', '二室', '三室', '四室'];
  const intervalName = {yoy: '同比', mom: '环比'};
  function roomCode(text) {
    const match = String(text || '').match(/([一二两三四1234])\s*[室房居]/);
    if (match) return ({一: '1', 二: '2', 两: '2', 三: '3', 四: '4'})[match[1]] || match[1];
    return /单间|开间/.test(text || '') ? '1' : '';
  }
  function observation(value, interval, period, basis, source, sourceName) {
    if (!Number.isFinite(value) || !sourceUrl(source) || !period) return null;
    const label = intervalName[interval] + ' ' + (value > 0 ? '+' : '') +
      value.toLocaleString('zh-CN', {maximumFractionDigits: 2}) + '%';
    return {value, interval, label, period, basis, source, sourceName};
  }
  const monthOf = date => String(date || '').match(/^(\d{4}-(?:0[1-9]|1[0-2]))/)?.[1];
  const today = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  function shiftMonth(month, back) {
    const [year, number] = month.split('-').map(Number);
    return new Date(Date.UTC(year, number - 1 - back, 1)).toISOString().slice(0, 7);
  }
  function marketMeasure(market, interval, room) {
    if (!market || !sourceUrl(market.url)) return null;
    // The live feed mutates market.months in place. Pick the current comparable period afresh.
    const months = market.months || {};
    const currentDate = today(), now = currentDate.slice(0, 7);
    function periodStatus(period, row) {
      if (environment.marketPeriodStatus) return environment.marketPeriodStatus(period, row, data.asof);
      const asof = row?.checkedAt || data.asof;
      return {asof, complete: period < monthOf(asof) && period < now};
    }
    const allowed = Object.keys(months).filter(period => monthOf(period) === period && period <= now)
      .filter(period => {
        const row = months[period]?.[room];
        const checked = periodStatus(period, row).asof || data.asof;
        return Number.isFinite(row?.price) && row.price > 0 && monthOf(checked) &&
          String(checked).slice(0, 10) <= currentDate && period <= monthOf(checked);
      }).sort().reverse();
    if (!allowed.length) return null;
    function complete(period) {
      return periodStatus(period, months[period][room]).complete;
    }
    const period = allowed.find(complete) || allowed[0], row = months[period][room];
    const basis = market.name + '商圈 · ' + roomNames[room] + '挂牌样本';
    const asof = periodStatus(period, row).asof || data.asof;
    const displayPeriod = complete(period) ? period : period + ' 月内样本' + (asof ? '（截至 ' + asof + '）' : '');
    let value = row[interval], reason = basis;
    if (!Number.isFinite(value)) {
      // Two finished consecutive months of the same series can supply a month-on-month figure.
      if (interval !== 'mom' || !complete(period)) return null;
      const priorPeriod = shiftMonth(period, 1), prior = months[priorPeriod]?.[room];
      if (!allowed.includes(priorPeriod) || !complete(priorPeriod) || !Number.isFinite(prior?.price) || prior.price <= 0) return null;
      value = Math.round((row.price / prior.price - 1) * 10000) / 100;
      reason += '，按 ' + priorPeriod + ' 与 ' + period + ' 同户型月租计算';
    }
    return observation(value, interval, displayPeriod, reason, market.url, '58 同城租金走势');
  }
  function projectMeasure(project, interval, room) {
    const metrics = (project?.metrics || []).filter(row => roomCode(row.rooms) === room &&
      monthOf(row.period) && monthOf(row.period) <= today().slice(0, 7) && sourceUrl(row.source) &&
      Number.isFinite(row.price) && row.price > 0);
    const latest = metrics.map(row => monthOf(row.period)).sort().at(-1);
    const row = metrics.find(row => monthOf(row.period) === latest && Number.isFinite(row[interval]));
    return row ? observation(row[interval], interval, row.period,
      project.area + ' · ' + row.rooms + '挂牌样本', row.source, '项目户型样本') : null;
  }
  function sameMarket(place) {
    const markets = data.markets || [];
    if (place.kind === 'hood') {
      const mid = place.item.mid;
      const market = mid == null ? null : markets[mid];
      return market?.district === place.district ? market : null;
    }
    const name = place.kind === 'zone' ? place.name : place.item.short || place.name.replace(/街道$/, '');
    return markets.find(market => market.district === place.district && market.name === name);
  }
  function localMeasure(place, interval, room) {
    if (!intervalName[interval] || (room !== '' && !/^[1-4]$/.test(room))) return null;
    if (place.kind === 'district') {
      // The district series aggregates dwelling sizes and cannot answer a specific bedroom filter.
      if (room) return null;
      const report = base.apartment?.currentCommunity, row = report?.by_district?.[place.name];
      if (!monthOf(report?.asof) || monthOf(report.asof) > today().slice(0, 7)) return null;
      return observation(row?.[interval + '_pct'], interval, report.asof, place.name + '普通小区 · 全户型样本',
        report.sources?.find(sourceUrl), '中指研究院普通住宅租金报告');
    }
    const selectedRoom = String(room || '1');
    if (place.kind === 'hood' && place.item.project) {
      return projectMeasure(place.item.project, interval, selectedRoom);
    }
    return marketMeasure(sameMarket(place), interval, selectedRoom);
  }
  function measure(kind, id, interval, room = '') {
    const place = locate(kind, id);
    return place ? localMeasure(place, interval, String(room ?? '')) : null;
  }
  function observedFor(place) {
    if (place.kind === 'street') {
      const rows = (place.item.rents || []).filter(row => row.district === place.district &&
        row.street === place.name && monthOf(row.asof) && monthOf(row.asof) <= today().slice(0, 7) && sourceUrl(row.source));
      const latest = rows.map(row => monthOf(row.asof)).sort().at(-1);
      for (const row of rows.filter(row => monthOf(row.asof) === latest)) {
        for (const interval of ['yoy', 'mom']) {
          const value = observation(row[interval], interval, row.asof,
            place.name + ' · ' + row.type + (row.sample ? '（' + row.sample + ' 套）' : ''), row.source, '街道挂牌样本');
          if (value) return value;
        }
      }
    }
    return localMeasure(place, 'yoy', '') || localMeasure(place, 'mom', '');
  }

  const records = unique(Array.isArray(policyData) ? policyData : policyData?.policies, 'id');
  function policyPlaces(place) {
    const matches = {city: new Map([['深圳市', '全市']]), district: new Map(), street: new Map(), zone: new Map(), hood: new Map()};
    function add(kind, item) {
      if (!item) return;
      matches[kind].set(String(item.id ?? item.n), item.n);
      matches[kind].set(item.n, item.n);
      if (item.short) matches[kind].set(item.short, item.n);
    }
    add('district', areas.district.get(place.district));
    add('street', place.street); add('zone', place.zone);
    if (place.kind === 'hood') add('hood', place.item);
    if (place.kind === 'district') {
      for (const street of areas.street.values()) if (street.d === place.district) add('street', street);
    }
    if (place.kind === 'district' || place.kind === 'street') {
      for (const zone of areas.zone.values()) if (matches.street.has(String(zone.street))) add('zone', zone);
    }
    if (place.kind !== 'hood') {
      for (const hood of areas.hood.values()) {
        if (place.kind === 'zone' ? hood.zone === place.id : matches.street.has(String(hood.street))) add('hood', hood);
      }
    }
    return matches;
  }
  function policiesFor(place) {
    const regions = policyPlaces(place), out = [];
    for (const policy of records) {
      if (!sourceUrl(policy.source) || !policy.title || !policy.subject || !regions[policy.scope]) continue;
      if (policy.housingDistricts?.length && !policy.housingDistricts.includes(place.district)) continue;
      const areaIds = (policy.areaIds || []).map(String);
      let scopeName;
      if (policy.scope === 'city') {
        if (areaIds.length && !areaIds.some(id => ['深圳','深圳市','全市'].includes(id))) continue;
        scopeName = '全市';
      } else {
        const names = areaIds.map(id => regions[policy.scope].get(id)).filter(Boolean);
        if (!names.length) continue;
        scopeName = [...new Set(names)].join('、');
      }
      const siteInPlace = (policy.sites || []).filter(site => {
        if (place.kind === 'district') return site.district === place.district;
        if (place.kind === 'street') return place.id === site.streetId;
        return place.kind === 'zone' ? place.id === site.zoneId : place.id === site.hoodId;
      });
      const siteLabel = siteInPlace.length ? '本地房源 · ' + siteInPlace.map(site => site.name).filter(Boolean).join('、') :
        policy.housingDistricts?.length ? '本批房源 · ' + policy.housingDistricts.join('、') : '';
      const projectNotice=policy.housingDistricts?.length||policy.sites?.length;
      const local = !!siteInPlace.length || (projectNotice ? place.kind==='district'&&policy.housingDistricts?.includes(place.id) :
        policy.scope!=='city');
      out.push({...policy, siteLabel, local:!!local, scopeLabel: scopeName + ' · ' + policy.subject});
    }
    return out.sort((a, b) => Number(b.local)-Number(a.local) || Number(a.scope === 'city') - Number(b.scope === 'city') ||
      String(b.date || '').localeCompare(String(a.date || '')));
  }

  const evidence = new Map();
  function get(kind, id) {
    const place = locate(kind, id);
    if (!place) return null;
    const key = kind + ':' + place.id;
    if (!evidence.has(key)) {
      const events = eventsFor(place);
      const policies=policiesFor(place);
      evidence.set(key, {id: place.id, kind, name: place.name, events, policies, localPolicyCount:policies.filter(p=>p.local).length, outlook: outlookFor(events)});
    }
    return {...evidence.get(key), observed: observedFor(place)};
  }
  function link(url, label) {
    return sourceUrl(url) ? '<a target="_blank" rel="noopener noreferrer" href="' + esc(url) + '">' + esc(label || '来源') + '</a>' : '';
  }
  function policyItem(policy) {
    const deadline = policy.applicationEnd, endTime = policy.applicationEndTime;
    const timing = [policy.date ? '发布 ' + policy.date : ''];
    if (deadline) {
      const end = Date.parse(deadline + 'T' + (endTime || '23:59') + ':00+08:00') + (endTime ? 0 : 59999);
      const closed = Date.now() >= end || policy.status === '已截止';
      timing.push((closed ? '受理已截止 ' : '申请截至 ') + deadline + (endTime ? ' ' + endTime : ''));
    } else {
      if (policy.effectiveFrom) timing.push(policy.effectiveFrom + ' 起施行');
      timing.push(policy.status);
    }
    const description = [policy.summary, policy.siteLabel].filter(Boolean).map(esc);
    const qualification = policy.applicability && policy.applicability !== policy.summary ?
      '<details><summary>资格细则</summary><p>' + esc(policy.applicability) + '</p></details>' : '';
    return '<li><b>' + esc(policy.title) + '</b><p>' + esc(policy.scopeLabel) + '</p>' +
      (description.length ? '<p>' + description.join('<br>') + '</p>' : '') +
      '<small>' + esc(timing.filter(Boolean).join(' · ')) + ' ' + link(policy.source, policy.sourceName) + (sourceUrl(policy.sourceAttachment)?' · '+link(policy.sourceAttachment,policy.attachmentName||'原始附件'):'') + '</small>' +
      qualification + '</li>';
  }
  function panel(kind, id, context={}) {
    const place = get(kind, id);
    if (!place) return '';
    const {outlook, events, policies} = place;
    const observed=Object.hasOwn(context,'reading')?context.reading:place.observed;
    const prices = observed ? '<p class="area-observation">样本变化 · <b>' + esc(observed.label) + '</b> · ' + esc(observed.period) +
      '<br>' + esc(observed.basis) + ' ' + link(observed.source, observed.sourceName) + '</p>' : '';
    const eventItems = events.map(row => {
      const action = row.kind === 'market' ? 'data-market-event' : 'data-ev';
      return '<li><button type="button" ' + action + '="' + esc(row.id) + '">' + esc(row.title) + '</button>' +
        '<p>' + esc(row.signal) + ' · ' + esc(row.relation) + '</p><p>' + esc(row.basis) + '</p><small>' +
        esc(row.date || '') + ' ' + link(row.source, row.sourceName) + '</small></li>';
    }).join('');
    const localPolicies=policies.filter(p=>p.local),generalPolicies=policies.filter(p=>!p.local);
    const policyRows=rows=>'<ul class="area-evidence">'+rows.map(policyItem).join('')+'</ul>';
    const policyItems=(localPolicies.length?policyRows(localPolicies):'<p>暂未收录本地项目或政策。</p>')+
      (generalPolicies.length?'<h3>其他适用政策 · '+generalPolicies.length+'</h3>'+policyRows(generalPolicies):'');
    return '<h2>' + esc(place.name) + '</h2><section class="region-detail area-outlook" data-insight-section="outlook"><h3>租金判断 · ' +
      esc(outlook.label) + '</h3><p>' + esc(outlook.reason) + '</p>' + prices + '</section>' +
      '<section class="region-detail" data-insight-section="events"><h3>相关事件 · ' + events.length + '</h3>' + (eventItems ? '<ul class="area-evidence">' +
      eventItems + '</ul>' : '<p>暂无关联记录</p>') + '</section>' +
      '<section class="region-detail" data-insight-section="policies"><h3>本地关联政策 · ' + localPolicies.length + '</h3>' + policyItems + '</section>';
  }
  return {get, measure, panel};
}
