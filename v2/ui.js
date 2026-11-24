/* V2 4 视角交互控制器：探索与议价 / 双地通勤 / 宜居与避坑 / 看房清单 */
(function (global) {
  'use strict';

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => '¥' + Math.round(n).toLocaleString('zh-CN');
  const lnk = (url, label) => /^https?:\/\//i.test(url || '')
    ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label || '来源')} ↗</a>`
    : '';
  const ROOM_LABEL = { 1: '一室/单间', 2: '二室', 3: '三室', 4: '四室' };
  const FAC_CAT = { market: '菜市场', supermarket: '超市', health: '医疗/社康', park: '公园', pharmacy: '药店' };

  function bootV2() {
    const $ = sel => document.querySelector(sel);
    const $$ = sel => [...document.querySelectorAll(sel)];
    const readJson = id => JSON.parse(document.getElementById(id).textContent);

    const atlas = readJson('atlas-v2-data');
    const travel = readJson('journey-data');
    const timing = readJson('time-data');

    const engine = global.createV2Engine(atlas, travel, timing);
    let map, evalResult, microCamera = null;
    const store = global.createV2Store(() => refresh());
    const state = store.state;
    map = global.createV2Map($('#atlas-svg'), atlas, engine, timing, esc);

    // Populate static datalists and quick buttons
    $('#work-options').innerHTML = [...new Set([...(travel.workplaces || []), ...engine.nodes.keys(), ...Object.keys(engine.ALIASES)])]
      .map(n => `<option value="${esc(n)}"></option>`).join('');
    $('#quick-works').innerHTML = engine.QUICK_WORKS
      .map(n => `<button type="button" data-quick-work="${esc(n)}">${esc(n)}</button>`).join('');
    $('#place-options').innerHTML = [...new Set([
      ...atlas.places.map(p => p.name),
      ...atlas.streets.flatMap(s => [s.n, s.short]),
    ])].map(n => `<option value="${esc(n)}"></option>`).join('');

    $('#data-help-body').innerHTML = `
      <p><strong>数据口径说明（截至 ${esc(atlas.asOf)}）：</strong></p>
      <p>1. <strong>项目实采 / 官方保租基准</strong>：具体楼盘挂牌或住建局配租基准单价，精度最高。</p>
      <p>2. <strong>分形态参考带</strong>：按「城中村 / 老小区 / 电梯小区 / 公寓」分开记录的片区月租区间，不把城中村和商品房混算，看房须核具体楼栋报价与水电标准。</p>
      <p>3. <strong>议价雷达</strong>：结合大厂外迁/保租房分流事件 + 同通勤圈（±10分钟）同形态价差 + 商圈同比综合提示，每条均附原始依据与核实条件。</p>
      <p>4. 收藏与踩点记录保存在当前浏览器（自动兼容旧版手记），可在「看房清单」随时导出 JSON 备份。</p>
    `;

    function syncInputsFromState() {
      $('#work-input').value = state.work;
      $('#budget-input').value = state.budget || '';
      $('#room-select').value = state.room;
      $('#limit-range').value = state.limit;
      $('#limit-readout').textContent = `${state.limit} 分钟`;
      $('#work2-input').value = state.work2;
      $('#limit2-input').value = state.limit2 || '';
      $('#sqm-input').value = state.sqm || '';
      $('#access-input').value = state.access;
      $('#egress-input').value = state.egress;
      $('#verified-only').checked = state.verifiedOnly;
      $('#opp-only').checked = state.oppOnly;

      // Housing type multi-select chips
      const meta = atlas.housingTypeMeta;
      $('#housing-type-chips').innerHTML = Object.entries(meta).map(([k, info]) => {
        const on = state.housingTypes.includes(k);
        return `<button type="button" data-htype="${k}" aria-pressed="${on}" title="${esc(info.utility)}">${esc(info.label)}</button>`;
      }).join('');

      $$('#mode-seg [data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode)));
      $$('#layout-switch [data-layout]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.layout === state.layout)));
      $$('#view-tabs [role="tab"]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.view === state.view)));
      $('#macro-toggle').setAttribute('aria-pressed', String(!!state.macroMode));

      const extraCount = [
        state.mode !== 'rail',
        state.limit !== 50,
        !!state.work2,
        state.limit2 > 0,
        state.sqm > 0,
        state.access !== 5 || state.egress !== 5,
        state.verifiedOnly,
        state.oppOnly,
      ].filter(Boolean).length;
      $('#extra-count').textContent = extraCount ? `（已启用 ${extraCount} 项）` : '';
    }

    function renderSubControls() {
      const host = $('#sub-controls');
      if (state.macroMode) {
        host.innerHTML = `<div class="seg-row">
          <button type="button" data-macro="districtRent" aria-pressed="${state.macroMode === 'districtRent'}">各区普通小区均价</button>
          <button type="button" data-macro="density" aria-pressed="${state.macroMode === 'density'}">各区人口密度</button>
          <button type="button" data-macro="">返回探索地图</button>
        </div>`;
        return;
      }
      if (state.view === 'explore') {
        host.innerHTML = `<div class="seg-row">
          <button type="button" data-sub="rent" aria-pressed="${state.subMode === 'rent'}">分形态月租</button>
          <button type="button" data-sub="arbitrage" aria-pressed="${state.subMode === 'arbitrage'}">议价雷达</button>
          <button type="button" data-sub="yoy" aria-pressed="${state.subMode === 'yoy'}">同比涨跌</button>
        </div>`;
      } else if (state.view === 'livability') {
        host.innerHTML = `<div class="seg-row">
          <button type="button" data-sub="all" aria-pressed="${!FAC_CAT[state.subMode]}">全部设施</button>
          ${Object.entries(FAC_CAT).map(([k, l]) => `<button type="button" data-sub="${k}" aria-pressed="${state.subMode === k}">${l}</button>`).join('')}
        </div>`;
      } else {
        host.innerHTML = '';
      }
    }

    function renderBreadcrumbs() {
      const crumbs = [`<button type="button" data-crumb="city">全深圳</button>`];
      if (state.macroMode && state.selectedDistrict) {
        crumbs.push(`<span>›</span><span>${esc(state.selectedDistrict)}</span>`);
      } else {
        const p = engine.placeById.get(state.selectedPlaceId);
        const s = engine.streetById.get(state.selectedStreetId || p?.streetId);
        if (s) crumbs.push(`<span>›</span><button type="button" data-crumb="street" data-id="${esc(s.id)}">${esc(s.d)} · ${esc(s.short)}</button>`);
        if (p) crumbs.push(`<span>›</span><span>${esc(p.shortName)}</span>`);
      }
      $('#breadcrumbs').innerHTML = crumbs.join('');
    }

    function renderPlaceCard(row) {
      const p = row.place, entry = row.entry;
      const saved = store.isSaved(p.id);
      const arbClass = row.arbitrage.status === 'opportunity' ? 'good' : row.arbitrage.status === 'tight' ? 'warn' : '';
      const rentVal = row.rent ? (row.rent.low === row.rent.high ? money(row.rent.median) : `${money(row.rent.low)}–${money(row.rent.high)}`) : '待补';
      const commVal = evalResult.work ? (row.route ? `${row.route.minutes} 分钟` : '无路线') : '未设工作地';
      const navUrl = evalResult.work ? `https://uri.amap.com/navigation?${new URLSearchParams({
        from: `${p.coord[0]},${p.coord[1]},${p.name}`,
        to: `${engine.nodes.get(evalResult.work).coord[0]},${engine.nodes.get(evalResult.work).coord[1]},${evalResult.work}`,
        mode: state.mode === 'drive' ? 'car' : 'bus',
      })}` : '';

      let tabBody = '';
      if (state.placeTab === 'overview') {
        const typeTags = p.housingTypes.map(t => `<span class="tag">${esc(atlas.housingTypeMeta[t]?.label || t)}</span>`).join('');
        const rentItems = (row.rentsMatched.length ? row.rentsMatched : p.rents).slice(0, 6).map(r => {
          const tLabel = atlas.housingTypeMeta[r.type]?.label || '综合';
          const priceStr = r.low === r.high ? `${money(r.median)}/月` : `${money(r.low)}–${money(r.high)}/月`;
          const utilNote = atlas.housingTypeMeta[r.type]?.utility || '';
          return `<li>
            <div class="rent-head"><span><strong>${esc(tLabel)} · ${ROOM_LABEL[r.room] || r.room + '室'}</strong> <span class="tag tag-grain">${esc(engine.GRAIN_LABELS[r.grain] || r.grain)}</span></span><span class="rent-price">${esc(priceStr)}</span></div>
            <p class="sub-note">${esc(r.basis)}${r.sqm ? ` · 约 ${r.sqm[0]}${r.sqm[1] !== r.sqm[0] ? '–' + r.sqm[1] : ''}㎡` : ''} · ${esc(r.period)} ${lnk(r.source, r.sourceName)}</p>
            ${utilNote ? `<p class="sub-note">水电提醒：${esc(utilNote)}</p>` : ''}
          </li>`;
        }).join('');

        const routeBlock = evalResult.work ? `<h3>通勤路线（至 ${esc(evalResult.work)}）</h3>` +
          (row.route ? `<p class="sub-note"><strong>${row.route.minutes} 分钟</strong> · ${esc(row.route.label)}（含步行约 ${row.route.walk} 分钟）${evalResult.work2 && row.route2 ? `<br>第二工作地 ${esc(evalResult.work2)}：<strong>${row.route2.minutes} 分钟</strong>` : ''} · ${lnk(navUrl, '高德核对')}</p>` : '<p class="sub-note">当前出行方式暂缺路线。</p>')
          : '';

        const facCount = row.facilities.length || p.streetFacilityCount;
        const prosHtml = p.pros.length ? `<h3>住感亮点</h3><p class="sub-note">${p.pros.map(esc).join(' · ')}</p>` : '';
        const watchHtml = (p.watchouts.length || row.risks.length) ? `<h3>看房必核避坑</h3><ul class="simple-list">${p.watchouts.map(w => `<li>⚠️ ${esc(w)}</li>`).join('')}${row.risks.map(rk => `<li>▲ <strong>${esc(rk.kind)}</strong>：${esc(rk.name)}（${esc(rk.observed)}）— ${esc(rk.check)} ${lnk(rk.url, rk.source)}</li>`).join('')}</ul>` : '';

        tabBody = `<div>${typeTags}${p.station ? `<span class="tag">近 ${esc(p.station)}站${p.walkMin ? ' 约步行' + p.walkMin + '分' : ''}</span>` : ''}${facCount ? `<span class="tag">核验设施 ${facCount} 处</span>` : ''}</div>
          <h3>分形态租金与口径</h3>
          ${rentItems ? `<ul class="rent-list">${rentItems}</ul>` : '<p class="sub-note">当前筛选条件下暂无匹配租金样本，可放宽形态或取消「仅实采」。</p>'}
          ${routeBlock}${prosHtml}${watchHtml}`;
      } else if (state.placeTab === 'arbitrage') {
        const reasons = row.arbitrage.reasons.length
          ? `<ul class="simple-list">${row.arbitrage.reasons.map(r => `<li>✓ ${esc(r)}</li>`).join('')}</ul>`
          : '<p class="sub-note">暂未检测到明显的分流或价格洼地信号。</p>';
        const evList = row.events.map(ev => `<li><strong>${esc(ev.title)}</strong> <span class="tag">${esc(ev.type)} · ${esc(ev.date)}</span><p class="sub-note">${esc(ev.fact)}</p><p class="sub-note"><strong>判断：</strong>${esc(ev.summary)} ${lnk(ev.source, ev.sourceName)}</p></li>`).join('');
        const polList = row.policies.map(pol => `<li><strong>${esc(pol.title)}</strong> <span class="tag">${esc(pol.status)}</span><p class="sub-note">${esc(pol.subject)} · ${esc(pol.summary)}</p><p class="sub-note">发布 ${esc(pol.date)}${pol.applicationEnd ? ' · 截止 ' + esc(pol.applicationEnd) : ''} ${lnk(pol.source, pol.sourceName)}</p></li>`).join('');
        tabBody = `<h3>议价雷达判断：${esc(row.arbitrage.label)}</h3>${reasons}
          <h3>关联产业与供需事件（${row.events.length}）</h3>${evList ? `<ul class="simple-list">${evList}</ul>` : '<p class="sub-note">暂无直接关联事件。</p>'}
          <h3>本地配租与政策（${row.policies.length}）</h3>${polList ? `<ul class="simple-list">${polList}</ul>` : '<p class="sub-note">暂无本地项目批次公告。</p>'}`;
      } else {
        const starOpts = v => `<option value="">未评</option>` + [1, 2, 3, 4, 5].map(n => `<option value="${n}"${v === n ? ' selected' : ''}>${n} 星</option>`).join('');
        tabBody = `<form id="place-note-form" class="note-form" data-note-id="${esc(p.id)}">
          <label>实测谈价/月租（元，选填）<input name="monthly" type="number" min="100" max="100000" value="${entry?.monthly ?? ''}" placeholder="看房谈下来的真实月租"></label>
          <label>居住环境（安静/采光/通风）<select name="environment">${starOpts(entry?.environment)}</select></label>
          <label>生活便利（买菜/通勤实走）<select name="convenience">${starOpts(entry?.convenience)}</select></label>
          <label>实地看房笔记<textarea name="note" rows="3" placeholder="例：周二晚8点关窗听不到主干道车声，民水民电，步行到站口实测9分钟">${esc(entry?.note || '')}</textarea></label>
          <button type="submit" class="btn-primary">保存踩点记录</button>
        </form>`;
      }

      return `<p class="kicker">${esc([p.district, p.streetName, p.anchor].filter(Boolean).join(' · '))}</p>
        <h2>${esc(p.name)}</h2>
        ${row.exclusions.length ? `<p class="sub-note" style="color:var(--warm)">当前筛选未命中：${esc(row.exclusions.join('、'))}</p>` : ''}
        <div class="kpi-strip">
          <div class="kpi-box"><span>单程通勤</span><strong>${esc(commVal)}</strong></div>
          <div class="kpi-box"><span>参考月租</span><strong>${esc(rentVal)}</strong></div>
          <div class="kpi-box ${arbClass}"><span>议价雷达</span><strong>${esc(row.arbitrage.label)}</strong></div>
        </div>
        <div class="action-row">
          <button type="button" class="${saved ? 'btn-primary' : 'btn-ghost'}" data-toggle-save="${esc(p.id)}">${saved ? '★ 已在看房清单' : '☆ 加入看房清单'}</button>
          ${p.streetId ? `<button type="button" class="btn-ghost" data-open-street="${esc(p.streetId)}">看同街道其他片区</button>` : ''}
        </div>
        <div class="card-tabs" role="tablist">
          <button type="button" data-ptab="overview" aria-selected="${state.placeTab === 'overview'}">概览与租金</button>
          <button type="button" data-ptab="arbitrage" aria-selected="${state.placeTab === 'arbitrage'}">议价与政策 (${row.events.length + row.policies.length})</button>
          <button type="button" data-ptab="notes" aria-selected="${state.placeTab === 'notes'}">踩点记录${entry?.note || entry?.environment ? ' ✓' : ''}</button>
        </div>
        ${tabBody}`;
    }

    function renderDetailPanel() {
      const el = $('#detail-panel');
      if (state.macroMode) {
        const d = atlas.districts.find(x => x.n === state.selectedDistrict);
        if (d) {
          el.innerHTML = `<p class="kicker">宏观背景 · ${esc(d.n)}</p><h2>${esc(d.n)}</h2>
            <ul class="simple-list">
              <li>普通小区均价：<strong>${d.community?.price ?? '—'} 元/㎡·月</strong>（同比 ${d.community?.yoy_pct ?? '—'}%，环比 ${d.community?.mom_pct ?? '—'}%）</li>
              <li>住宅挂牌综合：<strong>${d.listingPrice ?? '—'} 元/㎡·月</strong>（同比 ${d.listingYoy ?? '—'}%）</li>
              <li>城中村单间参考：<strong>${d.village?.range ? d.village.range.join('–') + ' 元/㎡·月' : '暂无分区样本'}</strong></li>
              <li>常住人口密度：<strong>${d.density.toLocaleString('zh-CN')} 人/km²</strong>（${d.pop} 万人 / ${d.area} km²）</li>
            </ul>
            <button type="button" class="btn-primary" data-macro="">切回地图细看片区</button>`;
          return;
        }
        el.innerHTML = `<h2>宏观背景（点击地图行政区查看）</h2><ul class="place-btn-list">${atlas.districts.map(x => `<li><button type="button" data-pick-dist="${esc(x.n)}">${esc(x.n)}</button><span class="meta">${state.macroMode === 'density' ? x.density.toLocaleString('zh-CN') + ' 人/km²' : (x.community?.price ? x.community.price + ' 元/㎡' : '—')}</span></li>`).join('')}</ul>`;
        return;
      }

      if (state.selectedRiskId) {
        const rk = engine.riskById.get(state.selectedRiskId);
        if (rk) {
          el.innerHTML = `<p class="kicker">公开避坑记录 · ${esc(rk.kind)}</p><h2>${esc(rk.name)}</h2>
            <p class="sub-note">状态：<strong>${esc(rk.status)}</strong> · 日期：${esc(rk.observed)}${rk.until ? ' · 截止 ' + esc(rk.until) : ''}</p>
            <p>${esc(rk.fact)}</p>
            <h3>看房踩点建议</h3><p>${esc(rk.check)}</p>
            <p class="sub-note">${esc(rk.anchor)} · ${lnk(rk.url, rk.source)}</p>
            <button type="button" class="btn-ghost" data-clear-risk>返回列表</button>`;
          return;
        }
      }

      const selRow = evalResult.rowById.get(state.selectedPlaceId);
      if (selRow) {
        el.innerHTML = renderPlaceCard(selRow);
        const form = $('#place-note-form');
        if (form) form.onsubmit = ev => {
          ev.preventDefault();
          const fd = new FormData(form);
          store.saveNote(selRow.place.id, selRow.place.name, {
            monthly: fd.get('monthly'),
            environment: fd.get('environment'),
            convenience: fd.get('convenience'),
            note: fd.get('note'),
          });
        };
        return;
      }

      const selStreet = engine.streetById.get(state.selectedStreetId);
      if (selStreet) {
        const sum = evalResult.streetSummary.get(selStreet.id);
        const stFacs = atlas.facilities.filter(f => f.streetId === selStreet.id && (!FAC_CAT[state.subMode] || f.category === state.subMode));
        el.innerHTML = `<p class="kicker">${esc(selStreet.d)} · 行政街道</p><h2>${esc(selStreet.n)}</h2>
          <p class="sub-note">${selStreet.refUnit ? `官方历史参考单价 ${selStreet.refUnit} 元/㎡·月 · ` : ''}已收录 ${sum.members.length} 处片区 · 核验设施 ${selStreet.facilityCount} 处</p>
          ${sum.members.length ? `<h3>街道内片区与小区</h3><ul class="place-btn-list">${sum.members.map(r => `<li><button type="button" data-pick-place="${esc(r.place.id)}">${esc(r.place.shortName)}${r.arbitrage.status === 'opportunity' ? ' <span class="tag tag-opp">议价</span>' : ''}</button><span class="meta">${r.rent ? money(r.rent.median) : '待补'}${r.route ? ' · ' + r.route.minutes + '分' : ''}</span></li>`).join('')}</ul>` : '<p class="sub-note">该街道暂无细化居住片区。</p>'}
          ${stFacs.length ? `<h3>已核验周边设施（${stFacs.length}）</h3><ul class="simple-list">${stFacs.slice(0, 8).map(f => `<li><strong>${esc(f.name)}</strong> <span class="tag">${esc(FAC_CAT[f.category] || f.category)}</span><p class="sub-note">${esc(f.address)} ${lnk(f.source, f.sourceName)}</p></li>`).join('')}</ul>` : ''}`;
        return;
      }

      // Default discovery list
      if (state.view === 'livability') {
        const facStreets = atlas.streets.filter(s => s.facilityCount > 0).sort((a, b) => b.facilityCount - a.facilityCount);
        el.innerHTML = `<h2>宜居设施与避坑雷达</h2>
          <p class="sub-note">已核验 ${atlas.facilities.length} 处官方设施（覆盖 ${facStreets.length} 个核心街道）与 ${atlas.publicEvents.length} 条公开环境避坑点。</p>
          <h3>已覆盖核验设施街道</h3>
          <ul class="place-btn-list">${facStreets.map(s => `<li><button type="button" data-open-street="${esc(s.id)}">${esc(s.d)} · ${esc(s.n)}</button><span class="meta">${s.facilityCount} 处设施</span></li>`).join('')}</ul>
          <h3>公开避坑提醒（▲ 地图标记）</h3>
          <ul class="place-btn-list">${atlas.publicEvents.map(rk => `<li><button type="button" data-pick-risk="${esc(rk.id)}">▲ ${esc(rk.name)}</button><span class="meta">${esc(rk.kind)}</span></li>`).join('')}</ul>`;
        return;
      }

      const top = evalResult.eligibleRows.slice(0, 12);
      const heading = state.subMode === 'arbitrage' ? '优先议价机会片区' : evalResult.work ? `符合条件的推荐片区（${evalResult.eligibleRows.length}）` : '核心走廊可探索片区';
      el.innerHTML = `<h2>${esc(heading)}</h2>
        <p class="sub-note">${evalResult.work ? `已按「议价信号 + 通勤 + 租金」排序。点任一片区看分形态价格带与砍价理由。` : '建议先在上方输入工作地（或点快捷园区），即可自动算通勤与同圈价差。'}</p>
        ${top.length ? `<ul class="place-btn-list">${top.map(r => `<li><button type="button" data-pick-place="${esc(r.place.id)}">${esc(r.place.name)}${r.arbitrage.status === 'opportunity' ? ' <span class="tag tag-opp">议价</span>' : ''}</button><span class="meta">${r.route ? r.route.minutes + '分 · ' : ''}${r.rent ? money(r.rent.median) : '待补'}</span></li>`).join('')}</ul>` : '<p class="sub-note">当前条件过严，暂无命中片区。可点「更多条件 → 重置全部条件」。</p>'}`;
    }

    function renderWatchlist() {
      const host = $('#watchlist-view');
      const entries = store.savedEntries();
      const rows = entries.map(e => ({ entry: e, row: evalResult.rowById.get(e.id) || null }));
      const picks = rows.filter(x => x.row).slice(0, 4);

      const compareHtml = picks.length >= 2 ? `<h3>核心候选横向对比（最多 4 处）</h3><div class="wl-table-wrap"><table class="wl-table"><thead><tr><th>维度</th>${picks.map(x => `<th><button type="button" class="btn-ghost" data-jump-place="${esc(x.row.place.id)}">${esc(x.row.place.shortName)}</button></th>`).join('')}</tr></thead><tbody>
        <tr><th>所属街道</th>${picks.map(x => `<td>${esc(x.row.place.district + ' · ' + x.row.place.streetName)}</td>`).join('')}</tr>
        <tr><th>单程通勤</th>${picks.map(x => `<td>${evalResult.work ? (x.row.route ? `<strong>${x.row.route.minutes} 分</strong>（${esc(x.row.route.label)}）` : '待核') : '未设工作地'}${evalResult.work2 && x.row.route2 ? `<br>第二地 ${x.row.route2.minutes} 分` : ''}</td>`).join('')}</tr>
        <tr><th>分形态月租</th>${picks.map(x => `<td>${x.row.rent ? `<strong>${money(x.row.rent.low)}–${money(x.row.rent.high)}</strong><br><span class="sub-note">${esc(atlas.housingTypeMeta[x.row.rent.type]?.label || '综合')} · ${esc(engine.GRAIN_LABELS[x.row.rent.grain])}</span>` : '待补'}</td>`).join('')}</tr>
        <tr><th>议价雷达</th>${picks.map(x => `<td><span class="tag ${x.row.arbitrage.status === 'opportunity' ? 'tag-opp' : ''}">${esc(x.row.arbitrage.label)}</span><div class="sub-note">${esc(x.row.arbitrage.reasons[0] || '常规供需')}</div></td>`).join('')}</tr>
        <tr><th>核验设施/避坑</th>${picks.map(x => `<td>设施 ${x.row.facilities.length || x.row.place.streetFacilityCount} 处 · 避坑 ${x.row.risks.length} 条</td>`).join('')}</tr>
        <tr><th>我的踩点实录</th>${picks.map(x => `<td>${x.entry.monthly ? `实谈 ${money(x.entry.monthly)}<br>` : ''}${x.entry.environment ? `环境${x.entry.environment}星 ` : ''}${x.entry.convenience ? `便利${x.entry.convenience}星` : ''}${x.entry.note ? `<div class="sub-note">${esc(x.entry.note)}</div>` : '未记'}</td>`).join('')}</tr>
      </tbody></table></div>` : '';

      const listHtml = entries.length ? `<ul class="simple-list">${rows.map(({ entry, row }) => `<li>
        <div class="rent-head">
          <strong>${esc(entry.name)}</strong>
          <div>${row ? `<button type="button" class="btn-ghost" data-jump-place="${esc(entry.id)}">地图查看</button>` : ''}
          <button type="button" class="btn-ghost" data-toggle-save="${esc(entry.id)}">${entry.saved ? '移除收藏' : '重新收藏'}</button></div>
        </div>
        <p class="sub-note">${[entry.monthly ? '实谈 ' + money(entry.monthly) : '', entry.environment ? '环境 ' + entry.environment + '/5' : '', entry.convenience ? '便利 ' + entry.convenience + '/5' : '', entry.observed || '', entry.note || ''].filter(Boolean).join(' · ') || '已收藏，去实地看房后可补录报价和噪音体感。'}</p>
      </li>`).join('')}</ul>` : '<p class="sub-note">看房清单还是空的。回到「1. 探索与议价」点亮感兴趣的片区并点「加入看房清单」即可开始横向对比。</p>';

      host.innerHTML = `<div class="wl-head">
        <div><h2 style="margin:0">我的看房清单（${entries.length}）</h2><p class="sub-note">自动兼容旧版看房手记。换电脑或手机看房前，可导出 JSON 备份。</p></div>
        <div class="action-row" style="margin:0">
          <button type="button" id="btn-export-wl" class="btn-ghost">导出备份 JSON</button>
          <label class="btn-ghost" style="cursor:pointer">导入备份<input id="input-import-wl" type="file" accept=".json,application/json" hidden></label>
        </div>
      </div>${compareHtml}<h3>全部收藏与踩点记录</h3>${listHtml}`;

      const expBtn = $('#btn-export-wl');
      if (expBtn) expBtn.onclick = () => {
        const blob = new Blob([store.exportBackup()], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob), a = document.createElement('a');
        a.href = url; a.download = `深圳租房看房清单-${new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        store.patch({ status: '已导出看房清单 JSON 备份。' });
      };
      const impInput = $('#input-import-wl');
      if (impInput) impInput.onchange = async ev => {
        const file = ev.target.files?.[0]; if (!file) return;
        try { store.importBackup(await file.text()); }
        catch (err) { store.patch({ status: '导入失败：' + err.message }); }
        ev.target.value = '';
      };
    }

    function refresh() {
      syncInputsFromState();
      renderSubControls();
      evalResult = engine.evaluateAll(state, store);

      const savedCount = store.savedEntries().filter(e => e.saved).length;
      $('#saved-count').textContent = String(savedCount);
      $('#explore-progress').textContent = `已探 ${state.seen.size} / ${atlas.places.length} 片区`;
      $('#status-bar').textContent = state.status || '';

      const isWatch = state.view === 'watchlist' && !state.macroMode;
      $('#workspace').hidden = isWatch;
      $('#watchlist-view').hidden = !isWatch;

      if (isWatch) {
        renderWatchlist();
        return;
      }

      const showRadialSwitch = state.view === 'commute' && !!evalResult.work && !state.macroMode;
      $('#layout-switch').hidden = !showRadialSwitch;
      $('#zoom-box').hidden = showRadialSwitch && state.layout === 'radial';
      $('#btn-discover').hidden = !!state.macroMode || state.view === 'livability';
      $('#btn-discover').disabled = evalResult.eligibleRows.length === 0;
      $('#match-summary').textContent = state.macroMode ? '' : `命中 ${evalResult.eligibleRows.length} / ${atlas.places.length} 片区`;

      renderBreadcrumbs();
      const legendHtml = map.render({ state, evalResult, store });
      $('#map-legend').innerHTML = legendHtml;
      renderDetailPanel();
    }

    function selectPlace(id, fitCamera = true) {
      const p = engine.placeById.get(id);
      if (!p) return;
      state.seen.add(id);
      if (fitCamera) {
        if (p.footprint) map.camera.fit(p.footprint.bounds);
        else {
          const st = engine.streetById.get(p.streetId);
          if (st) map.camera.fit(st.bounds);
        }
      }
      store.patch({
        macroMode: '',
        view: state.view === 'watchlist' ? 'explore' : state.view,
        selectedPlaceId: id,
        selectedStreetId: p.streetId || '',
        selectedRiskId: '',
        placeTab: 'overview',
        status: '',
      });
    }

    function selectStreet(id) {
      const s = engine.streetById.get(id);
      if (!s) return;
      map.camera.fit(s.bounds);
      store.patch({ macroMode: '', selectedStreetId: id, selectedPlaceId: '', selectedRiskId: '', status: '' });
    }

    // Event bindings
    $('#work-form').onsubmit = ev => {
      ev.preventDefault();
      const resolved = engine.resolveWork($('#work-input').value);
      if (!resolved) {
        store.patch({ status: '未匹配到该工作地，请从下拉列表选择或点常用园区。' });
        return;
      }
      store.patch({ work: resolved, status: `已设工作地：${resolved}（按住宅→工作地算单程）` });
    };

    $('#budget-input').onchange = e => store.patch({ budget: Math.max(0, Number(e.target.value) || 0), status: '' });
    $('#room-select').onchange = e => store.patch({ room: e.target.value, status: '' });
    $('#limit-range').oninput = e => store.patch({ limit: Number(e.target.value), status: '' });
    $('#work2-input').onchange = e => {
      const raw = e.target.value.trim();
      if (!raw) { store.patch({ work2: '', status: '' }); return; }
      const r = engine.resolveWork(raw);
      store.patch({ work2: r, status: r ? `已设第二工作地：${r}` : '第二工作地未匹配，请从下拉选择。' });
    };
    $('#limit2-input').onchange = e => store.patch({ limit2: Math.max(0, Number(e.target.value) || 0), status: '' });
    $('#sqm-input').onchange = e => store.patch({ sqm: Math.max(0, Number(e.target.value) || 0), status: '' });
    $('#access-input').onchange = e => store.patch({ access: Math.max(0, Number(e.target.value) || 0), status: '' });
    $('#egress-input').onchange = e => store.patch({ egress: Math.max(0, Number(e.target.value) || 0), status: '' });
    $('#verified-only').onchange = e => store.patch({ verifiedOnly: e.target.checked, status: '' });
    $('#opp-only').onchange = e => store.patch({ oppOnly: e.target.checked, status: '' });

    $('#place-jump').onchange = e => {
      const q = e.target.value.trim();
      if (!q) return;
      const p = atlas.places.find(x => x.name === q || x.shortName === q) || atlas.places.find(x => x.name.includes(q));
      if (p) { e.target.value = ''; selectPlace(p.id, true); return; }
      const s = atlas.streets.find(x => x.n === q || x.short === q) || atlas.streets.find(x => x.n.includes(q));
      if (s) { e.target.value = ''; selectStreet(s.id); return; }
      store.patch({ status: `未找到「${q}」，试试输入 西丽、坪洲、白石洲、沙尾、民治 等。` });
    };

    $('#reset-all').onclick = () => {
      map.camera.reset();
      store.patch({
        budget: 0, room: '1', sqm: 0, mode: 'rail', limit: 50, work2: '', limit2: 0,
        access: 5, egress: 5, housingTypes: ['village', 'oldEstate', 'modernEstate', 'apartment'],
        verifiedOnly: false, oppOnly: false, selectedPlaceId: '', selectedStreetId: '', selectedRiskId: '',
        status: '已重置全部筛选条件。',
      });
    };

    $('#macro-toggle').onclick = () => {
      if (state.macroMode) {
        if (microCamera) { map.camera.restore(microCamera); microCamera = null; }
        store.patch({ macroMode: '', status: '' });
      } else {
        if (map.camera.viewport().k > 2) microCamera = map.camera.snapshot();
        map.camera.reset();
        store.patch({ macroMode: 'districtRent', status: '' });
      }
    };

    $('#btn-discover').onclick = () => {
      const next = engine.discoverNext(evalResult, state.seen);
      if (!next) { store.patch({ status: '当前条件下的候选已全部探索完毕，可适当放宽预算或通勤上限。' }); return; }
      selectPlace(next.place.id, true);
      const tips = [];
      if (state.budget && next.rent && next.rent.median < state.budget) tips.push(`中位月租比预算省 ${money(state.budget - next.rent.median)}`);
      if (evalResult.work && next.route && next.route.minutes < state.limit) tips.push(`通勤比上限短 ${state.limit - next.route.minutes} 分钟`);
      if (next.arbitrage.status === 'opportunity') tips.push('检测到议价机会');
      store.patch({ status: `新发现 ${next.place.name}${tips.length ? '：' + tips.join('，') : ''}。` });
    };

    // Unified delegated click handler
    document.body.addEventListener('click', ev => {
      const el = ev.target.closest('[data-quick-work],[data-htype],[data-mode],[data-view],[data-sub],[data-macro],[data-layout],[data-zoom],[data-crumb],[data-place],[data-street],[data-zone],[data-district],[data-risk],[data-pick-place],[data-open-street],[data-pick-dist],[data-pick-risk],[data-clear-risk],[data-toggle-save],[data-ptab],[data-jump-place]');
      if (!el) return;
      const d = el.dataset;
      if (d.quickWork) { store.patch({ work: d.quickWork, status: `已设工作地：${d.quickWork}` }); return; }
      if (d.htype) {
        const cur = new Set(state.housingTypes);
        if (cur.has(d.htype)) { if (cur.size > 1) cur.delete(d.htype); }
        else cur.add(d.htype);
        store.patch({ housingTypes: [...cur], status: '' });
        return;
      }
      if (d.mode) { store.patch({ mode: d.mode, status: '' }); return; }
      if (d.view) {
        const nextSub = d.view === 'explore' ? (['rent', 'arbitrage', 'yoy'].includes(state.subMode) ? state.subMode : 'rent') : d.view === 'livability' ? 'all' : state.subMode;
        if (state.macroMode && microCamera) { map.camera.restore(microCamera); microCamera = null; }
        store.patch({ view: d.view, subMode: nextSub, macroMode: '', status: d.view === 'commute' && !evalResult.work ? '先在上方设定工作地，即可开启双地通勤与 10 分钟时间圈。' : '' });
        return;
      }
      if (d.sub !== undefined) { store.patch({ subMode: d.sub, status: '' }); return; }
      if (d.macro !== undefined) {
        if (!d.macro && microCamera) { map.camera.restore(microCamera); microCamera = null; }
        store.patch({ macroMode: d.macro, status: '' });
        return;
      }
      if (d.layout) { store.patch({ layout: d.layout, status: '' }); return; }
      if (d.zoom) { map.camera.control(d.zoom); return; }
      if (d.crumb === 'city') { map.camera.reset(); store.patch({ selectedPlaceId: '', selectedStreetId: '', selectedDistrict: '', selectedRiskId: '', status: '' }); return; }
      if (d.crumb === 'street') { selectStreet(d.id); return; }
      if (d.place || d.pickPlace) { selectPlace(d.place || d.pickPlace, !!d.pickPlace); return; }
      if (d.jumpPlace) { selectPlace(d.jumpPlace, true); return; }
      if (d.street || d.openStreet) { selectStreet(d.street || d.openStreet); return; }
      if (d.zone) { const z = atlas.zones.find(x => x.id === d.zone); if (z) { map.camera.fit(z.bounds); store.patch({ selectedStreetId: z.street, selectedPlaceId: '', status: '' }); } return; }
      if (d.district || d.pickDist) { store.patch({ selectedDistrict: d.district || d.pickDist, status: '' }); return; }
      if (d.risk || d.pickRisk) { store.patch({ selectedRiskId: d.risk || d.pickRisk, status: '' }); return; }
      if ('clearRisk' in d) { store.patch({ selectedRiskId: '', status: '' }); return; }
      if (d.toggleSave) { const p = engine.placeById.get(d.toggleSave); store.toggleSave(d.toggleSave, p?.name || d.toggleSave); return; }
      if (d.ptab) { store.patch({ placeTab: d.ptab }); return; }
    });

    // Hover HUD on map (zero redraw)
    const hud = $('#hover-hud');
    $('#atlas-svg').addEventListener('pointerover', ev => {
      const t = ev.target.closest?.('[data-place],[data-street],[data-district],[data-risk]');
      hud.textContent = t?.getAttribute('aria-label') || '';
    });
    $('#atlas-svg').addEventListener('pointerleave', () => { hud.textContent = ''; });

    // Resize sync
    if (typeof ResizeObserver === 'function') {
      let raf = 0;
      new ResizeObserver(() => {
        if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (!$('#workspace').hidden && evalResult) map.render({ state, evalResult, store }); });
      }).observe($('#atlas-svg'));
    }

    refresh();
  }

  if (typeof document !== 'undefined') bootV2();
})(typeof window !== 'undefined' ? window : globalThis);
