/* V3 深圳板块拼图探索地图交互控制器：529 处任意目的地 + 板块抽屉两级租金展开 + 固定地标一键设中心 */
(function (global) {
  'use strict';

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => '¥' + Math.round(n).toLocaleString('zh-CN');
  const lnk = (url, label) => /^https?:\/\//i.test(url || '')
    ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label || '来源')}↗</a>`
    : '';
  const ROOM_LABEL = { 1: '一室', 2: '二室', 3: '三室', 4: '四室' };
  const FAC_CAT = {
    mall: '商场', school: '学校', park: '公园',
    market: '菜市', supermarket: '超市', health: '医疗', pharmacy: '药店',
  };
  const fmtDist = m => m < 100 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`;

  function bootV3() {
    const $ = sel => document.querySelector(sel);
    const $$ = sel => [...document.querySelectorAll(sel)];
    const readJson = id => JSON.parse(document.getElementById(id).textContent);

    const atlas = readJson('atlas-v3-data');
    const travel = readJson('journey-data');
    const timing = readJson('time-data');

    const engine = global.createV3Engine(atlas, travel, timing);
    let map, evalResult, microCamera = null;
    let fitExpanded = false, noteFormOpen = false, riskBarOpen = false;
    let toastTimer = 0;

    const store = global.createV3Store(() => refresh());
    const state = store.state;
    map = global.createV3Map($('#atlas-svg'), atlas, engine, timing, esc);
    const evIcons = global.V3EventIcons;

    $('#dest-options').innerHTML = atlas.destinations.slice(0, 420)
      .map(d => `<option value="${esc(d.name)}"></option>`).join('');

    $('#help-pop').innerHTML = `
      <p><strong>数据与口径速览（${esc(atlas.asOf)}）</strong></p>
      <p>• <strong>全城 98 块居住板块拼图</strong>：默认用<strong>每平米均价（元/㎡·月）</strong>统一着色，点开板块才细看城中村/老小区/电梯小区/官方保租的具体整套月租。</p>
      <p>• <strong>任意目的地通勤</strong>：支持搜索或点击任意<strong>知名地标、商圈、351 个地铁站、30 个公交枢纽、板块或小区</strong>（共 ${atlas.destinations.length} 处）设为通勤中心。</p>
      <p>• <strong>议价与溢价</strong>：金圈=目的地 15 分钟步行圈，红虚圈=其他园区步行圈；同程贵于 3 处以上圈外板块时亮出 <strong>↑贵¥X</strong>，点「我常去」可取消扣分。</p>
      <p>• 收藏与踩点保存在本机浏览器（自动兼容旧版手记），可在「★ 清单」导出 JSON 备份。</p>
    `;

    function closePopovers(exceptId = '') {
      for (const [popId, btnId] of [['omni-pop', ''], ['types-pop', 'types-btn'], ['filter-pop', 'filter-btn'], ['help-pop', 'help-btn']]) {
        if (popId === exceptId) continue;
        const pop = $('#' + popId);
        if (pop) pop.hidden = true;
        const btn = btnId ? $('#' + btnId) : null;
        if (btn) btn.setAttribute('aria-expanded', 'false');
      }
    }

    function showToast(msg) {
      const el = $('#status-bar');
      if (!msg) { el.hidden = true; el.textContent = ''; return; }
      el.textContent = msg;
      el.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { el.hidden = true; state.status = ''; }, 3600);
    }

    // 统一搜索浮层：搜任意地标/商圈/地铁站/公交站/板块/小区，既可直达查看，也可一键设目的地！
    function renderOmniPop(query = '') {
      const q = query.trim();
      const pop = $('#omni-pop');
      if (!q) {
        const hotPlates = ['p-pingzhou', 'p-liuxian', 'p-lingzhi', 'p-baozhong', 'p-hongshan', 'p-shawei']
          .map(id => engine.plateById.get(id)).filter(Boolean);
        pop.innerHTML = `<div class="omni-sec">设目的地（热门园区 / 商圈 / 枢纽）</div>
          <div class="omni-quick">${engine.QUICK_DESTS.map(n => `<button type="button" data-set-work="${esc(n)}">◆ ${esc(n)}</button>`).join('')}</div>
          <div class="omni-sec">直达热门居住板块</div>
          <ul class="omni-list">${hotPlates.map(pl => `<li><button type="button" class="omni-main" data-pick-plate="${esc(pl.id)}"><span>${esc(pl.name)}</span><small>${esc(pl.district + ' · ' + pl.unitPrice + '元/㎡')}</small></button></li>`).join('')}</ul>`;
        pop.hidden = false;
        return;
      }

      const destHits = engine.searchDestinations(q, 8);
      const plateHits = atlas.plates.filter(pl => pl.name.includes(q) || pl.streetName.includes(q)).slice(0, 5);

      const sections = [];
      if (destHits.length) {
        sections.push(`<div class="omni-sec">设为通勤目的地（地标 / 商圈 / 地铁 / 公交 / 小区）</div><ul class="omni-list">${destHits.map(d => `<li>
          <button type="button" class="omni-main" data-set-work="${esc(d.name)}"><span>◆ ${esc(d.name)}</span><small>${esc(d.kind)}</small></button>
        </li>`).join('')}</ul>`);
      }
      if (plateHits.length) {
        sections.push(`<div class="omni-sec">直达居住板块</div><ul class="omni-list">${plateHits.map(pl => `<li>
          <button type="button" class="omni-main" data-pick-plate="${esc(pl.id)}"><span>${esc(pl.name)}</span><small>${esc(pl.district + ' · ' + pl.unitPrice + '元/㎡')}</small></button>
          <button type="button" class="omni-go" data-set-work="${esc(pl.name + '板块')}">设目的地</button>
        </li>`).join('')}</ul>`);
      }
      pop.innerHTML = sections.join('') || `<div class="omni-sec">未匹配到「${esc(q)}」，试试 壹方城、万象天地、坪洲、留仙洞、高新园</div>`;
      pop.hidden = false;
    }

    function syncTopbar() {
      const wp = $('#work-pill');
      if (evalResult.dest1) {
        wp.hidden = false;
        wp.innerHTML = `<span class="dot">◆</span><span>${esc(evalResult.dest1.name)}</span><button type="button" data-clear-work title="清除目的地">×</button>`;
      } else {
        wp.hidden = true;
      }

      $('#budget-input').value = state.budget || '';
      $('#room-select').value = state.room;
      $('#limit-range').value = state.limit;
      $('#limit-readout').textContent = `${state.limit}分`;
      $('#work2-input').value = state.work2;
      $('#limit2-input').value = state.limit2 || '';
      $('#sqm-input').value = state.sqm || '';
      $('#access-input').value = state.access;
      $('#egress-input').value = state.egress;
      $('#verified-only').checked = state.verifiedOnly;
      $('#opp-only').checked = state.oppOnly;
      $$('[data-weight]').forEach(sel => { sel.value = String(state.weights[sel.dataset.weight] || 1); });

      const meta = atlas.housingTypeMeta;
      $('#housing-type-chips').innerHTML = Object.entries(meta).map(([k, info]) => {
        const on = state.housingTypes.includes(k);
        return `<button type="button" data-htype="${k}" aria-pressed="${on}" title="${esc(info.utility)}">${esc(info.label)}</button>`;
      }).join('');
      const tb = $('#types-btn');
      tb.textContent = state.housingTypes.length < 4 ? `形态 (${state.housingTypes.length}) ▾` : '形态 ▾';
      tb.classList.toggle('active', state.housingTypes.length < 4);

      const extraCount = [
        state.mode !== 'rail', state.limit !== 50, !!state.work2, state.limit2 > 0,
        state.sqm > 0, state.access !== 5 || state.egress !== 5,
        state.verifiedOnly, state.oppOnly, Object.values(state.weights).some(v => v !== 1),
      ].filter(Boolean).length;
      const badge = $('#extra-badge');
      badge.hidden = !extraCount;
      badge.textContent = String(extraCount);
      $('#filter-btn').classList.toggle('active', extraCount > 0);
      $('#watchlist-btn').setAttribute('aria-pressed', String(state.watchlistOpen));

      $$('#mode-seg [data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode)));
      $$('#lens-dock [role="tab"]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.lens === state.lens)));
      $('#toggle-fac').setAttribute('aria-pressed', String(state.showFacilities));
      $('#toggle-risk').setAttribute('aria-pressed', String(state.showRisks));
    }

    function renderSubPills() {
      const row = $('#sub-pill-row');
      if (state.lens === 'rent') {
        if (state.rentSub === 'macro') {
          const items = [['community', '小区'], ['apartment', '公寓'], ['village', '城中村'], ['listing', '挂牌'], ['ref2022', '2022参考'], ['density', '人口']];
          row.innerHTML = items.map(([k, l]) => `<button type="button" data-macro="${k}" aria-pressed="${state.macroMetric === k}">${l}</button>`).join('') +
            `<button type="button" data-rent-sub="unit">↩ 板块拼图</button>`;
        } else {
          row.innerHTML = [
            ['unit', '元/㎡均价'], ['yoy', '同比'], ['mom', '环比'], ['macro', '各区宏观'],
          ].map(([k, l]) => `<button type="button" data-rent-sub="${k}" aria-pressed="${state.rentSub === k}">${l}</button>`).join('');
        }
        row.hidden = false;
      } else if (state.lens === 'commute') {
        row.innerHTML = evalResult.dest1
          ? `<button type="button" data-layout="geo" aria-pressed="${state.layout === 'geo'}">板块拼图</button><button type="button" data-layout="radial" aria-pressed="${state.layout === 'radial'}">10分钟时间圈</button>`
          : `<button type="button" data-prompt-work>点击先设通勤目的地</button>`;
        row.hidden = false;
      } else {
        if (!evalResult.dest1) {
          row.innerHTML = `<button type="button" data-prompt-work>设目的地后激活 15 分钟园区溢价圈</button>`;
          row.hidden = false;
        } else {
          row.hidden = true;
        }
      }

      const ovRow = $('#overlay-filter-row');
      if (state.showFacilities) {
        ovRow.innerHTML = `<button type="button" data-fac-filter="" aria-pressed="${!state.facFilter}">全设施</button>` +
          Object.entries(FAC_CAT).map(([k, l]) => `<button type="button" data-fac-filter="${k}" aria-pressed="${state.facFilter === k}">${l}</button>`).join('');
        ovRow.hidden = false;
      } else if (riskBarOpen && state.showRisks) {
        ovRow.innerHTML = `<button type="button" data-risk-filter="" aria-pressed="${!state.riskFilter}">全避坑</button>` +
          Object.entries(evIcons.EVENT_TYPES).map(([k, info]) => `<button type="button" data-risk-filter="${k}" aria-pressed="${state.riskFilter === k}">${evIcons.eventIconSvg(k)}${esc(info.label)}</button>`).join('');
        ovRow.hidden = false;
      } else {
        ovRow.hidden = true;
      }
    }

    // 板块详情抽屉（两级租金揭示：地图上看元/㎡，点开板块才细看分形态具体月租与板块内小区/村落！）
    function renderPlateCard(row) {
      const pl = row.plate, entry = row.entry;
      const saved = store.isSaved(pl.id);
      const isRef = state.referenceId === pl.id;
      const navUrl = evalResult.dest1 ? `https://uri.amap.com/navigation?${new URLSearchParams({
        from: `${pl.coord[0]},${pl.coord[1]},${pl.name}`,
        to: `${evalResult.dest1.coord[0]},${evalResult.dest1.coord[1]},${evalResult.dest1.name}`,
        mode: state.mode === 'drive' ? 'car' : 'bus',
      })}` : '';

      let sigHtml = '';
      if (row.premium?.status === 'premium') sigHtml = `<span class="sig-pill sig-prem">↑ 贵¥${Math.round(row.premium.extra)}/月</span>`;
      else if (row.arbitrage.status === 'opportunity') sigHtml = `<span class="sig-pill sig-opp">↘ 可议价</span>`;
      else if (row.premium?.status === 'direct') sigHtml = `<span class="sig-pill sig-walk">◆ 步行可达</span>`;
      if (row.mastery?.visited) sigHtml += `<span class="sig-pill sig-opp">✓ 已实勘${row.mastery.avgStar ? ' ' + row.mastery.avgStar + '★' : ''}</span>`;

      const fitBadge = row.fit.count
        ? `<button type="button" class="fit-pill${row.fit.premiumPenalty ? ' has-pen' : ''}" data-toggle-fit title="查看四维评分明细">适配 ${esc(row.fit.rangeText)}${row.fit.premiumPenalty ? ' (−' + row.fit.premiumPenalty + ')' : ''}</button>`
        : '';
      const fitBreakdown = fitExpanded && row.fit.count
        ? `<div class="fit-detail-box"><strong>四维拆解</strong><ul>${engine.FIT_KEYS.map(k => {
          const d = row.fit.dimensions[k];
          return `<li>${esc(engine.FIT_NAMES[k])}：<strong>${d.score == null ? '待踩点' : Math.round(d.score) + '分'}</strong> · ${esc(d.why)}</li>`;
        }).join('')}</ul></div>`
        : '';

      const deltaHtml = evalResult.refRow && !isRef && row.refDeltas.length
        ? `<div class="delta-row"><span class="sub-note" style="margin:0;align-self:center">比「${esc(evalResult.refRow.plate.name)}」</span>${row.refDeltas.map(d => `<span class="delta-chip ${d.better ? 'better' : 'worse'}">${esc(d.text)}</span>`).join('')}</div>`
        : '';

      // 非必要溢价卡（严格静默原则：仅在他园 15 分钟步行圈内出现！）
      let premHtml = '';
      const pr = row.premium;
      if (pr && pr.hub && pr.status !== 'direct' && pr.status !== 'no-hub' && pr.status !== 'no-work') {
        const isPrem = pr.status === 'premium';
        const title = isPrem ? `↑ 同程溢价约 ¥${Math.round(pr.extra)}/月（+${pr.extraUnit}元/㎡）`
          : pr.status === 'used' ? `✓ 常去「${pr.hub.name}」（免扣分）`
          : `近「${pr.hub.name}」步行 ${pr.hub.walk}分 · ${pr.status === 'no-extra' ? '未见多付' : '差额待核'}`;
        const alts = pr.alternatives?.length
          ? `<ul class="alt-list">${pr.alternatives.map(a => `<li><button type="button" data-pick-plate="${esc(a.id)}">→ ${esc(a.name)}板块</button><span>${a.unitPrice}元/㎡ · ${a.minutes}分</span></li>`).join('')}</ul>`
          : '';
        premHtml = `<div class="alert-card${isPrem ? ' is-prem' : ''}">
          <div class="alert-head"><span>${esc(title)}</span></div>
          <p class="sub-note">${esc(pr.reason)}</p>${alts}
          <div style="margin-top:6px"><button type="button" class="btn-ghost" data-toggle-hub="${esc(pr.hub.name)}" aria-pressed="${pr.status === 'used'}">${pr.status === 'used' ? '取消常去' : '我常去「' + esc(pr.hub.name) + '」'}</button></div>
        </div>`;
      }

      // 议价线索与事件/政策（有才渲染！）
      let evPolHtml = '';
      if (row.arbitrage.reasons.length || row.events.length || row.policies.length) {
        const reasonCard = row.arbitrage.reasons.length
          ? `<div class="alert-card is-opp"><div class="alert-head"><span>↘ 议价线索</span></div>${row.arbitrage.reasons.map(r => `<p class="sub-note" style="color:var(--fg)">• ${esc(r)}</p>`).join('')}</div>`
          : '';
        const items = [
          ...row.events.map(ev => `<li><strong>${esc(ev.title)}</strong><span class="micro-tag">${esc(ev.date)}</span><p class="sub-note">${esc(ev.summary)} ${lnk(ev.source, ev.sourceName)}</p></li>`),
          ...row.policies.map(pol => `<li><strong>${esc(pol.title)}</strong><span class="micro-tag">${esc(pol.status)}</span><p class="sub-note">${esc(pol.summary)} ${lnk(pol.source, pol.sourceName)}</p></li>`),
        ].join('');
        evPolHtml = `${reasonCard}${items ? `<div class="sec-head"><h3>关联事件与政策</h3></div><ul class="clean-list">${items}</ul>` : ''}`;
      }

      // 分形态具体月租（仅在板块详情内展开！）
      const primaryType = row.rentsMatched[0]?.type;
      const utilHint = atlas.housingTypeMeta[primaryType]?.utility?.split('（')[0] || '';
      const rentHtml = row.rentsMatched.length
        ? `<div class="sec-head"><h3>板块分形态月租参考</h3>${utilHint ? `<span class="sec-hint">${esc(utilHint)}</span>` : ''}</div>
          <ul class="rent-list">${row.rentsMatched.slice(0, 6).map(r => {
            const tLabel = atlas.housingTypeMeta[r.type]?.label || '综合';
            const priceStr = r.low === r.high ? money(r.median) : `${money(r.low)}–${money(r.high)}`;
            return `<li><div class="rent-line"><span><strong>${esc(tLabel)} · ${ROOM_LABEL[r.room] || r.room + '室'}</strong><span class="micro-tag">${esc(engine.GRAIN_LABELS[r.grain] || r.grain)}</span></span><span class="rent-price">${esc(priceStr)}</span></div>
              <p class="sub-note">${r.sqm ? `${r.sqm[0]}${r.sqm[1] !== r.sqm[0] ? '–' + r.sqm[1] : ''}㎡ · ` : ''}${esc(r.period)} · ${lnk(r.source, r.sourceName) || esc(r.sourceName)}</p></li>`;
          }).join('')}</ul>`
        : '';

      // 板块内具体小区 / 村落 / 保租房项目（融合进板块内部，告别地图散点与西乡孤立补丁！）
      const estatesHtml = row.childRows.length
        ? `<div class="sec-head"><h3>板块内小区与村落 (${row.childRows.length})</h3></div>
          <ul class="estate-list">${row.childRows.map(cr => {
            const pTxt = cr.rent ? (cr.rent.low === cr.rent.high ? money(cr.rent.median) : `${(cr.rent.low / 1000).toFixed(1).replace(/\.0$/, '')}–${(cr.rent.high / 1000).toFixed(1).replace(/\.0$/, '')}k`) : '';
            return `<li><button type="button" data-open-place="${esc(cr.place.id)}">${esc(cr.place.shortName)} <span class="micro-tag">${esc(cr.place.kind)}</span></button><span class="meta">${[pTxt, cr.route ? cr.route.minutes + '分' : ''].filter(Boolean).join(' · ')}</span></li>`;
          }).join('')}</ul>`
        : '';

      // 2.5km 核验设施（商场/学校/公园）
      const nearFacHtml = row.nearbyFacs.length
        ? `<div class="sec-head"><h3>周边已定位设施</h3></div><ul class="clean-list">${row.nearbyFacs.map(f =>
          `<li><strong>${esc(f.name)}</strong><span class="micro-tag">${esc(FAC_CAT[f.category] || f.category)} · ${fmtDist(f.meters)}</span> <span class="sub-note">${lnk(f.source, '政府')} ${lnk(f.osmUrl, 'OSM')}</span></li>`
        ).join('')}</ul>`
        : '';

      // 避坑（有才显示！）
      const riskHtml = row.risks.length
        ? `<div class="sec-head"><h3>周边避坑记录</h3></div><ul class="clean-list">${row.risks.map(rk => {
          const rt = evIcons.eventTypeFor(rk);
          return `<li>${evIcons.eventIconSvg(rt)} <strong>${esc(rk.name)}</strong>（${esc(rk.observed)}）<p class="sub-note">${esc(rk.check)} ${lnk(rk.url, rk.source)}</p></li>`;
        }).join('')}</ul>`
        : '';

      const starOpts = v => `<option value="">未评</option>` + [1, 2, 3, 4, 5].map(n => `<option value="${n}"${v === n ? ' selected' : ''}>${n}星</option>`).join('');
      const hasNote = !!(entry?.monthly || entry?.environment || entry?.convenience || entry?.note);
      const noteDisplay = hasNote && !noteFormOpen
        ? `<div class="sec-head"><h3>我的踩点</h3><button type="button" class="link-btn" data-toggle-note>编辑</button></div>
          <p class="sub-note" style="color:var(--fg)">${[entry.monthly ? '实谈 ' + money(entry.monthly) : '', entry.environment ? '环境' + entry.environment + '星' : '', entry.convenience ? '便利' + entry.convenience + '星' : '', entry.note || ''].filter(Boolean).join(' · ')}</p>`
        : '';
      const noteFormHtml = noteFormOpen
        ? `<form id="place-note-form" class="note-form" data-note-id="${esc(pl.id)}" data-note-name="${esc(pl.name + '板块')}">
            <label>实谈月租（元）<input name="monthly" type="number" min="100" max="100000" value="${entry?.monthly ?? ''}" placeholder="实地谈下的真实月租"></label>
            <div class="note-form-2">
              <label>环境<select name="environment">${starOpts(entry?.environment)}</select></label>
              <label>便利<select name="convenience">${starOpts(entry?.convenience)}</select></label>
            </div>
            <label>实地笔记<textarea name="note" rows="2" placeholder="噪音、采光、水电、步行实测…">${esc(entry?.note || '')}</textarea></label>
            <div class="drawer-actions" style="margin:0"><button type="submit" class="btn-primary">保存</button><button type="button" class="btn-ghost" data-toggle-note>取消</button></div>
          </form>`
        : '';

      const commPart = evalResult.dest1
        ? (row.route ? `<span class="vital-item"><strong>${row.route.minutes}分</strong><small class="sub-note" style="margin:0">${esc(row.route.label)} ${lnk(navUrl, '高德')}</small></span>` : `<span class="vital-item">待核</span>`)
        : `<span class="vital-item"><button type="button" class="link-btn" data-prompt-work>设目的地算通勤</button></span>`;
      const comm2Note = evalResult.dest2 && row.route2 ? `<p class="sub-note" style="margin:-4px 0 8px">第二目的地 ${esc(evalResult.dest2.name)}：<strong>${row.route2.minutes} 分钟</strong></p>` : '';

      return `<div class="drawer-head">
          <p class="drawer-kicker">${esc([pl.district, pl.streetName, pl.station ? pl.station + '站' : ''].filter(Boolean).join(' · '))}</p>
          <button type="button" class="drawer-close" data-close-drawer title="收起">×</button>
        </div>
        <div class="drawer-title-row"><h2>${esc(pl.name)}</h2>${fitBadge}</div>
        ${pl.tag ? `<p class="sub-note" style="margin:0 0 8px">${esc(pl.tag)}</p>` : ''}
        ${fitBreakdown}
        ${row.exclusions.length ? `<p class="sub-note" style="color:var(--warm);margin:0 0 6px">当前筛选外：${esc(row.exclusions.join('、'))}</p>` : ''}
        <div class="vital-strip">${commPart}<span class="vital-sep">|</span><span class="vital-item" title="${esc(pl.unitBasis)}"><strong>${pl.unitPrice}元/㎡</strong><small class="sub-note" style="margin:0">${esc(pl.unitBasis)}</small></span>${sigHtml}</div>
        ${comm2Note}${deltaHtml}
        <div class="drawer-actions">
          <button type="button" class="${saved ? 'btn-primary' : 'btn-ghost'}" data-toggle-save="${esc(pl.id)}" data-save-name="${esc(pl.name + '板块')}">${saved ? '★ 已收藏' : '☆ 收藏'}</button>
          <button type="button" class="btn-ghost" data-set-work="${esc(pl.name + '板块')}">◆ 设目的地</button>
          <button type="button" class="btn-ghost" data-toggle-ref="${esc(pl.id)}" aria-pressed="${isRef}">${isRef ? '◎ 参照中' : '◎ 设参照'}</button>
          <button type="button" class="btn-ghost" data-toggle-note aria-pressed="${noteFormOpen}">✎ 踩点</button>
        </div>
        ${noteFormHtml}${noteDisplay}${premHtml}${evPolHtml}${rentHtml}${estatesHtml}${nearFacHtml}${riskHtml}`;
    }

    // 板块内具体某小区 / 村落 / 保租房详情卡
    function renderEstateCard(cr) {
      const p = cr.place, entry = cr.entry;
      const parentPlate = engine.plateById.get(p.plateId);
      const saved = store.isSaved(p.id);
      const rentVal = cr.rent ? (cr.rent.low === cr.rent.high ? money(cr.rent.median) : `${money(cr.rent.low)}–${money(cr.rent.high)}`) : '待补';
      const starOpts = v => `<option value="">未评</option>` + [1, 2, 3, 4, 5].map(n => `<option value="${n}"${v === n ? ' selected' : ''}>${n}星</option>`).join('');
      const hasNote = !!(entry?.monthly || entry?.environment || entry?.convenience || entry?.note);
      const noteFormHtml = noteFormOpen
        ? `<form id="place-note-form" class="note-form" data-note-id="${esc(p.id)}" data-note-name="${esc(p.name)}">
            <label>实谈月租（元）<input name="monthly" type="number" min="100" max="100000" value="${entry?.monthly ?? ''}" placeholder="看房谈下的真实月租"></label>
            <div class="note-form-2"><label>环境<select name="environment">${starOpts(entry?.environment)}</select></label><label>便利<select name="convenience">${starOpts(entry?.convenience)}</select></label></div>
            <label>看房笔记<textarea name="note" rows="2">${esc(entry?.note || '')}</textarea></label>
            <div class="drawer-actions" style="margin:0"><button type="submit" class="btn-primary">保存</button><button type="button" class="btn-ghost" data-toggle-note>取消</button></div>
          </form>`
        : (hasNote ? `<p class="sub-note" style="color:var(--fg);margin:6px 0">我的踩点：${[entry.monthly ? '实谈' + money(entry.monthly) : '', entry.environment ? '环境' + entry.environment + '星' : '', entry.convenience ? '便利' + entry.convenience + '星' : '', entry.note || ''].filter(Boolean).join(' · ')}</p>` : '');

      return `<div class="drawer-head">
          <p class="drawer-kicker">${parentPlate ? `<button type="button" class="link-btn" data-back-plate="${esc(parentPlate.id)}">← 返回 ${esc(parentPlate.name)}板块</button>` : esc(p.streetName)}</p>
          <button type="button" class="drawer-close" data-close-drawer>×</button>
        </div>
        <div class="drawer-title-row"><h2>${esc(p.shortName)}</h2><span class="micro-tag">${esc(p.kind)}</span></div>
        <div class="vital-strip">
          <span class="vital-item"><strong>${cr.route ? cr.route.minutes + '分' : '未设目的地'}</strong>${cr.route ? `<small class="sub-note" style="margin:0">${esc(cr.route.label)}</small>` : ''}</span>
          <span class="vital-sep">|</span>
          <span class="vital-item"><strong>${esc(rentVal)}</strong></span>
        </div>
        <div class="drawer-actions">
          <button type="button" class="${saved ? 'btn-primary' : 'btn-ghost'}" data-toggle-save="${esc(p.id)}" data-save-name="${esc(p.name)}">${saved ? '★ 已收藏' : '☆ 收藏'}</button>
          <button type="button" class="btn-ghost" data-set-work="${esc(p.shortName)}">◆ 设目的地</button>
          <button type="button" class="btn-ghost" data-toggle-note aria-pressed="${noteFormOpen}">✎ 踩点</button>
        </div>
        ${noteFormHtml}
        <div class="sec-head"><h3>具体租金样本</h3></div>
        <ul class="rent-list">${(cr.rentsMatched.length ? cr.rentsMatched : p.rents).slice(0, 6).map(r => `<li>
          <div class="rent-line"><span><strong>${esc(atlas.housingTypeMeta[r.type]?.label || '综合')} · ${ROOM_LABEL[r.room] || r.room + '室'}</strong><span class="micro-tag">${esc(engine.GRAIN_LABELS[r.grain] || r.grain)}</span></span><span class="rent-price">${esc(r.low === r.high ? money(r.median) : money(r.low) + '–' + money(r.high))}</span></div>
          <p class="sub-note">${esc(r.basis)} · ${esc(r.period)} ${lnk(r.source, r.sourceName)}</p>
        </li>`).join('')}</ul>
        ${cr.nearbyFacs.length ? `<div class="sec-head"><h3>2 公里内定位设施</h3></div><ul class="clean-list">${cr.nearbyFacs.map(f => `<li><strong>${esc(f.name)}</strong><span class="micro-tag">${esc(FAC_CAT[f.category] || f.category)} · ${fmtDist(f.meters)}</span> <span class="sub-note">${lnk(f.source, '政府')} ${lnk(f.osmUrl, 'OSM')}</span></li>`).join('')}</ul>` : ''}
        ${p.watchouts.length || cr.risks.length ? `<div class="sec-head"><h3>看房避坑</h3></div><ul class="clean-list">${p.watchouts.map(w => `<li>⚠️ ${esc(w)}</li>`).join('')}${cr.risks.map(rk => `<li>${evIcons.eventIconSvg(evIcons.eventTypeFor(rk))} <strong>${esc(rk.name)}</strong><p class="sub-note">${esc(rk.check)} ${lnk(rk.url, rk.source)}</p></li>`).join('')}</ul>` : ''}`;
    }

    function renderDrawer() {
      const el = $('#detail-drawer'), stage = $('#stage');
      let html = '';

      if (state.selectedLandmarkId) {
        const lm = engine.landmarkById.get(state.selectedLandmarkId);
        if (lm) {
          const kindLabel = lm.kind === 'hub' ? '重点办公园区' : lm.kind === 'mall' ? '知名商圈地标' : '核心交通枢纽';
          const aura = engine.landmarkAura(lm.id);
          const railPlates = aura ? [...aura.rail30].map(id => evalResult.plateRowById.get(id)).filter(Boolean).sort((a, b) => a.plate.unitPrice - b.plate.unitPrice).slice(0, 6) : [];
          html = `<div class="drawer-head"><p class="drawer-kicker">${esc(lm.district + ' · ' + kindLabel)}</p><button type="button" class="drawer-close" data-close-drawer>×</button></div>
            <div class="drawer-title-row"><h2>${esc(lm.name)}</h2></div>
            <p class="sub-note" style="color:var(--fg);margin-bottom:8px">${esc(lm.note)}</p>
            ${aura ? `<div class="vital-strip"><span class="vital-item"><strong>${aura.walk15.size}</strong><small class="sub-note" style="margin:0">板块15分步行</small></span><span class="vital-sep">|</span><span class="vital-item"><strong>${aura.rail30.size}</strong><small class="sub-note" style="margin:0">板块${aura.minutes}分轨交可达</small></span></div>` : ''}
            <div class="drawer-actions">
              <button type="button" class="btn-primary" data-set-work="${esc(lm.name)}">◆ 设为通勤目的地</button>
              <button type="button" class="btn-ghost" data-set-work2="${esc(lm.name)}">设为第二目的地</button>
            </div>
            ${railPlates.length ? `<div class="sec-head"><h3>${aura.minutes} 分钟轨交圈低单价板块</h3></div><ul class="estate-list">${railPlates.map(r => `<li><button type="button" data-pick-plate="${esc(r.plate.id)}">${esc(r.plate.name)}板块</button><span class="meta">${r.plate.unitPrice}元/㎡ · ${aura.timeMap.get(r.plate.id)}分</span></li>`).join('')}</ul>` : ''}`;
        }
      } else if (state.selectedRiskId) {
        const rk = engine.riskById.get(state.selectedRiskId);
        if (rk) {
          const rt = evIcons.eventTypeFor(rk);
          html = `<div class="drawer-head"><p class="drawer-kicker">${evIcons.eventIconSvg(rt)} ${esc(rk.kind)} · ${esc(rk.observed)}</p><button type="button" class="drawer-close" data-close-drawer>×</button></div>
            <div class="drawer-title-row"><h2>${esc(rk.name)}</h2></div>
            <p class="sub-note" style="color:var(--fg)"><strong>状态：</strong>${esc(rk.status)}${rk.until ? '（至 ' + esc(rk.until) + '）' : ''}</p>
            <p style="margin:8px 0;font-size:13px">${esc(rk.fact)}</p>
            <div class="sec-head"><h3>踩点建议</h3></div><p class="sub-note" style="color:var(--fg)">${esc(rk.check)}</p>
            <p class="sub-note" style="margin-top:8px">${esc(rk.anchor)} · ${lnk(rk.url, rk.source)}</p>`;
        }
      } else if (state.selectedFacilityId) {
        const f = engine.facById.get(state.selectedFacilityId);
        if (f) {
          html = `<div class="drawer-head"><p class="drawer-kicker">核验设施 · ${esc(FAC_CAT[f.category] || f.category)}</p><button type="button" class="drawer-close" data-close-drawer>×</button></div>
            <div class="drawer-title-row"><h2>${esc(f.name)}</h2></div>
            <p class="sub-note" style="color:var(--fg)">${esc(f.address || '')}</p>
            ${f.location?.gcj02 ? `<div class="drawer-actions" style="margin-top:10px"><button type="button" class="btn-primary" data-set-work="${esc(f.name)}">◆ 设为通勤目的地</button></div>` : ''}
            <p class="sub-note" style="margin-top:8px">${lnk(f.source, f.sourceName || '政府资料')} ${f.osm?.source ? ' · ' + lnk(f.osm.source, 'OSM 坐标') : ''}</p>`;
        }
      } else if (state.selectedPlaceId) {
        const cr = evalResult.placeRowById.get(state.selectedPlaceId);
        if (cr) html = renderEstateCard(cr);
      } else if (state.selectedPlateId) {
        const row = evalResult.plateRowById.get(state.selectedPlateId);
        if (row) html = renderPlateCard(row);
      } else if (state.selectedDistrict) {
        const d = atlas.districts.find(x => x.n === state.selectedDistrict);
        if (d) {
          html = `<div class="drawer-head"><p class="drawer-kicker">区级宏观背景</p><button type="button" class="drawer-close" data-close-drawer>×</button></div>
            <div class="drawer-title-row"><h2>${esc(d.n)}</h2></div>
            <ul class="clean-list">
              <li>普通小区均价：<strong>${d.community?.price ?? '—'} 元/㎡</strong>（同比 ${d.community?.yoy_pct ?? '—'}% / 环比 ${d.community?.mom_pct ?? '—'}%）</li>
              <li>集中式公寓：<strong>${d.apartment?.price ?? '—'} 元/㎡</strong></li>
              <li>城中村单间：<strong>${d.village?.range ? d.village.range.join('–') + ' 元/㎡' : '—'}</strong></li>
              <li>挂牌综合：<strong>${d.listingPrice ?? '—'} 元/㎡</strong>（同比 ${d.listingYoy ?? '—'}%）</li>
              <li>2022 参考：<strong>小区 ${d.refs2022?.[0] ?? '—'} / 公寓 ${d.refs2022?.[1] ?? '—'} / 村 ${d.refs2022?.[2] ?? '—'}</strong></li>
              <li>人口密度：<strong>${d.density.toLocaleString('zh-CN')} 人/km²</strong></li>
            </ul>
            <div class="drawer-actions"><button type="button" class="btn-primary" data-rent-sub="unit">切回板块拼图</button></div>`;
        }
      }

      if (html) {
        el.innerHTML = html;
        el.hidden = false;
        stage.classList.add('drawer-open');
        const form = $('#place-note-form');
        if (form) form.onsubmit = ev => {
          ev.preventDefault();
          const fd = new FormData(form);
          noteFormOpen = false;
          store.saveNote(form.dataset.noteId, form.dataset.noteName, {
            monthly: fd.get('monthly'), environment: fd.get('environment'),
            convenience: fd.get('convenience'), note: fd.get('note'),
          });
        };
      } else {
        el.hidden = true;
        stage.classList.remove('drawer-open');
      }
    }

    function renderWatchlist() {
      const host = $('#watchlist-overlay');
      if (!state.watchlistOpen) { host.hidden = true; return; }
      host.hidden = false;
      const entries = store.savedEntries();
      const rows = entries.map(e => {
        const plateRow = evalResult.plateRowById.get(e.id) || (engine.placeById.get(e.id) ? evalResult.plateRowById.get(engine.placeById.get(e.id).plateId) : null);
        const placeRow = evalResult.placeRowById.get(e.id) || null;
        return { entry: e, plateRow, placeRow };
      });
      const picks = rows.filter(x => x.plateRow).slice(0, 4);

      const compareHtml = picks.length >= 2 ? `<div class="wl-table-wrap"><table class="wl-table"><thead><tr><th>维度</th>${picks.map(x => `<th><button type="button" class="btn-ghost" data-jump-id="${esc(x.entry.id)}">${esc(x.entry.name)}</button></th>`).join('')}</tr></thead><tbody>
        <tr><th>每平米均价</th>${picks.map(x => `<td><strong>${x.plateRow.plate.unitPrice}元/㎡</strong><div class="sub-note">${esc(x.plateRow.plate.unitBasis)}</div></td>`).join('')}</tr>
        <tr><th>单程通勤</th>${picks.map(x => {
          const rt = x.placeRow?.route || x.plateRow.route;
          return `<td>${evalResult.dest1 ? (rt ? `<strong>${rt.minutes}分</strong> ${esc(rt.label)}` : '待核') : '未设目的地'}</td>`;
        }).join('')}</tr>
        <tr><th>议价/溢价</th>${picks.map(x => `<td>${x.plateRow.premium?.status === 'premium' ? `<span class="sig-pill sig-prem">↑贵¥${Math.round(x.plateRow.premium.extra)}</span>` : x.plateRow.arbitrage.status === 'opportunity' ? `<span class="sig-pill sig-opp">↘可议价</span>` : '—'}</td>`).join('')}</tr>
        <tr><th>我的实录</th>${picks.map(x => `<td>${[x.entry.monthly ? '实谈' + money(x.entry.monthly) : '', x.entry.environment ? '环境' + x.entry.environment + '星' : '', x.entry.convenience ? '便利' + x.entry.convenience + '星' : ''].filter(Boolean).join(' · ') || '未记'}${x.entry.note ? `<div class="sub-note">${esc(x.entry.note)}</div>` : ''}</td>`).join('')}</tr>
      </tbody></table></div>` : '';

      const listHtml = entries.length ? `<ul class="clean-list">${rows.map(({ entry, plateRow }) => `<li>
        <div class="rent-line"><strong>${esc(entry.name)}</strong><div>${plateRow ? `<button type="button" class="btn-ghost" data-jump-id="${esc(entry.id)}">地图查看</button> ` : ''}<button type="button" class="btn-ghost" data-toggle-save="${esc(entry.id)}" data-save-name="${esc(entry.name)}">${entry.saved ? '移除' : '重藏'}</button></div></div>
        <p class="sub-note">${[entry.monthly ? '实谈 ' + money(entry.monthly) : '', entry.environment ? '环境' + entry.environment + '星' : '', entry.convenience ? '便利' + entry.convenience + '星' : '', entry.observed || '', entry.note || ''].filter(Boolean).join(' · ') || '已收藏，看房后可补录实价与感受。'}</p>
      </li>`).join('')}</ul>` : '<p class="sub-note">清单还是空的，点击地图任意拼图板块并点「收藏」即可开始横向对比。</p>';

      host.innerHTML = `<div class="wl-inner">
        <div class="wl-head">
          <div><h2 style="margin:0">我的看房清单 (${entries.length})</h2><p class="sub-note">自动兼容旧版看房手记，可随时导出 JSON 备份。</p></div>
          <div class="drawer-actions" style="margin:0">
            <button type="button" id="btn-export-wl" class="btn-ghost">导出 JSON</button>
            <label class="btn-ghost" style="cursor:pointer">导入备份<input id="input-import-wl" type="file" accept=".json,application/json" hidden></label>
            <button type="button" class="btn-primary" data-close-wl>返回地图</button>
          </div>
        </div>${compareHtml}${listHtml}</div>`;

      const expBtn = $('#btn-export-wl');
      if (expBtn) expBtn.onclick = () => {
        const blob = new Blob([store.exportBackup()], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob), a = document.createElement('a');
        a.href = url; a.download = `深圳租房看房清单-${new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        store.patch({ status: '已导出 JSON 备份' });
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
      evalResult = engine.evaluateAll(state, store);
      syncTopbar();
      renderSubPills();

      const savedCount = store.savedEntries().filter(e => e.saved).length;
      $('#saved-count').textContent = String(savedCount);
      $('#explore-progress').textContent = `已探 ${state.seen.size}/${atlas.plates.length} 板块`;
      $('#match-summary').textContent = state.lens === 'rent' && state.rentSub === 'macro' ? '全深圳宏观' : `命中 ${evalResult.eligiblePlates.length} 板块`;
      showToast(state.status);

      const isRadial = state.lens === 'commute' && state.layout === 'radial' && !!evalResult.dest1;
      $('#zoom-box').hidden = isRadial;
      $('#btn-discover').disabled = evalResult.eligiblePlates.length === 0;

      const legendHtml = map.render({ state, evalResult, store });
      $('#map-legend').innerHTML = legendHtml;
      renderDrawer();
      renderWatchlist();
    }

    function clearSelection() {
      fitExpanded = false; noteFormOpen = false;
      store.patch({
        selectedPlateId: '', selectedPlaceId: '', selectedLandmarkId: '',
        selectedDistrict: '', selectedRiskId: '', selectedFacilityId: '',
      });
    }

    function selectPlate(plateId, fitCamera = false) {
      const pl = engine.plateById.get(plateId);
      if (!pl) return;
      state.seen.add(plateId);
      fitExpanded = false; noteFormOpen = false;
      if (fitCamera) map.camera.fit(pl.bounds);
      store.patch({
        watchlistOpen: false,
        rentSub: state.rentSub === 'macro' ? 'unit' : state.rentSub,
        selectedPlateId: plateId, selectedPlaceId: '', selectedLandmarkId: '',
        selectedDistrict: '', selectedRiskId: '', selectedFacilityId: '', status: '',
      });
    }

    function selectEstate(placeId, fitCamera = false) {
      const p = engine.placeById.get(placeId);
      if (!p) return;
      const pl = engine.plateById.get(p.plateId);
      if (pl) state.seen.add(pl.id);
      noteFormOpen = false;
      if (fitCamera && pl) map.camera.fit(pl.bounds);
      store.patch({
        watchlistOpen: false,
        rentSub: state.rentSub === 'macro' ? 'unit' : state.rentSub,
        selectedPlateId: p.plateId, selectedPlaceId: placeId, selectedLandmarkId: '',
        selectedDistrict: '', selectedRiskId: '', selectedFacilityId: '', status: '',
      });
    }

    // 统一搜索框交互
    const omni = $('#omni-input');
    omni.onfocus = () => { closePopovers('omni-pop'); renderOmniPop(omni.value); };
    omni.oninput = () => renderOmniPop(omni.value);
    omni.onkeydown = ev => {
      if (ev.key === 'Escape') { closePopovers(); omni.blur(); return; }
      if (ev.key !== 'Enter') return;
      ev.preventDefault();
      const q = omni.value.trim();
      if (!q) return;
      const dest = engine.resolveDestination(q);
      if (dest) { omni.value = ''; closePopovers(); store.patch({ work: dest.name, status: `通勤目的地：${dest.name}（${dest.kind}）` }); return; }
      const pl = atlas.plates.find(x => x.name.includes(q) || x.streetName.includes(q));
      if (pl) { omni.value = ''; closePopovers(); selectPlate(pl.id, true); return; }
      showToast(`未匹配到「${q}」`);
    };

    for (const [btnId, popId] of [['types-btn', 'types-pop'], ['filter-btn', 'filter-pop'], ['help-btn', 'help-pop']]) {
      $('#' + btnId).onclick = ev => {
        ev.stopPropagation();
        const pop = $('#' + popId);
        const willOpen = pop.hidden;
        closePopovers();
        pop.hidden = !willOpen;
        $('#' + btnId).setAttribute('aria-expanded', String(willOpen));
      };
    }

    $('#watchlist-btn').onclick = () => { closePopovers(); store.patch({ watchlistOpen: !state.watchlistOpen, status: '' }); };
    $('#budget-input').onchange = e => store.patch({ budget: Math.max(0, Number(e.target.value) || 0), status: '' });
    $('#room-select').onchange = e => store.patch({ room: e.target.value, status: '' });
    $('#limit-range').oninput = e => store.patch({ limit: Number(e.target.value), status: '' });
    $('#work2-input').onchange = e => {
      const raw = e.target.value.trim();
      if (!raw) { store.patch({ work2: '', status: '' }); return; }
      const r = engine.resolveDestination(raw);
      store.patch({ work2: r ? r.name : '', status: r ? `第二目的地：${r.name}` : '未匹配到该目的地' });
    };
    $('#limit2-input').onchange = e => store.patch({ limit2: Math.max(0, Number(e.target.value) || 0), status: '' });
    $('#sqm-input').onchange = e => store.patch({ sqm: Math.max(0, Number(e.target.value) || 0), status: '' });
    $('#access-input').onchange = e => store.patch({ access: Math.max(0, Number(e.target.value) || 0), status: '' });
    $('#egress-input').onchange = e => store.patch({ egress: Math.max(0, Number(e.target.value) || 0), status: '' });
    $('#verified-only').onchange = e => store.patch({ verifiedOnly: e.target.checked, status: '' });
    $('#opp-only').onchange = e => store.patch({ oppOnly: e.target.checked, status: '' });
    $$('[data-weight]').forEach(sel => {
      sel.onchange = () => store.patch({ weights: { ...state.weights, [sel.dataset.weight]: Number(sel.value) || 1 }, status: '' });
    });

    $('#reset-all').onclick = () => {
      map.camera.reset(); closePopovers();
      store.patch({
        budget: 0, room: '1', sqm: 0, mode: 'rail', limit: 50, work2: '', limit2: 0,
        access: 5, egress: 5, housingTypes: ['village', 'oldEstate', 'modernEstate', 'apartment'],
        verifiedOnly: false, oppOnly: false, riskFilter: '', facFilter: '', referenceId: '',
        weights: { commute: 1, rent: 1, environment: 1, convenience: 1 },
        selectedPlateId: '', selectedPlaceId: '', selectedLandmarkId: '', selectedDistrict: '', selectedRiskId: '', selectedFacilityId: '',
        status: '已重置筛选条件',
      });
    };

    $('#toggle-fac').onclick = () => {
      const next = !state.showFacilities;
      if (next) riskBarOpen = false;
      store.patch({ showFacilities: next, status: next ? '已叠加核验商场/学校/公园' : '' });
    };
    $('#toggle-risk').onclick = () => {
      if (!state.showRisks) {
        riskBarOpen = true;
        store.patch({ showRisks: true, showFacilities: false, status: '已叠加 6 类公共避坑图标' });
      } else {
        riskBarOpen = false;
        store.patch({ showRisks: false, riskFilter: '', status: '已收起避坑图标' });
      }
    };

    $('#btn-discover').onclick = () => {
      const next = engine.discoverNext(evalResult, state.seen);
      if (!next) { showToast('当前条件下的板块已全部探完，可放宽条件'); return; }
      selectPlate(next.plate.id, true);
      const tips = [`${next.plate.unitPrice}元/㎡`];
      if (evalResult.dest1 && next.route) tips.push(`${next.route.minutes}分可达`);
      if (next.arbitrage.status === 'opportunity') tips.push('↘ 可议价');
      showToast(`新发现 ${next.plate.name}板块 · ${tips.join(' · ')}`);
    };

    // 全局点击代理
    document.body.addEventListener('click', ev => {
      if (!ev.target.closest('.pop-anchor,.search-wrap')) closePopovers();

      const el = ev.target.closest('[data-set-work],[data-set-work2],[data-clear-work],[data-prompt-work],[data-htype],[data-mode],[data-lens],[data-rent-sub],[data-macro],[data-layout],[data-zoom],[data-plate],[data-pick-plate],[data-back-plate],[data-open-place],[data-landmark],[data-district],[data-risk],[data-fac],[data-risk-filter],[data-fac-filter],[data-toggle-save],[data-toggle-ref],[data-toggle-hub],[data-toggle-fit],[data-toggle-note],[data-close-drawer],[data-close-wl],[data-jump-id]');
      if (!el) {
        if (ev.target === $('#atlas-svg') && (state.selectedPlateId || state.selectedPlaceId || state.selectedLandmarkId || state.selectedDistrict || state.selectedRiskId || state.selectedFacilityId)) {
          clearSelection();
        }
        return;
      }

      const d = el.dataset;
      if (d.setWork) {
        omni.value = ''; closePopovers();
        store.patch({ work: d.setWork, selectedLandmarkId: '', status: `已设目的地：${d.setWork}` });
        return;
      }
      if (d.setWork2) {
        closePopovers();
        store.patch({ work2: d.setWork2, selectedLandmarkId: '', status: `已设第二目的地：${d.setWork2}` });
        return;
      }
      if ('clearWork' in d) { store.patch({ work: '', layout: 'geo', status: '已清除目的地' }); return; }
      if ('promptWork' in d) { omni.focus(); return; }
      if (d.htype) {
        const cur = new Set(state.housingTypes);
        if (cur.has(d.htype)) { if (cur.size > 1) cur.delete(d.htype); }
        else cur.add(d.htype);
        store.patch({ housingTypes: [...cur], status: '' });
        return;
      }
      if (d.mode) { store.patch({ mode: d.mode, status: '' }); return; }
      if (d.lens) {
        const leaveMacro = state.lens === 'rent' && state.rentSub === 'macro' && d.lens !== 'rent';
        if (leaveMacro && microCamera) { map.camera.restore(microCamera); microCamera = null; }
        store.patch({ lens: d.lens, rentSub: leaveMacro ? 'unit' : state.rentSub, status: '' });
        return;
      }
      if (d.rentSub) {
        if (d.rentSub === 'macro' && state.rentSub !== 'macro') {
          if (map.camera.viewport().k > 1.8) microCamera = map.camera.snapshot();
          map.camera.reset();
        } else if (d.rentSub !== 'macro' && state.rentSub === 'macro' && microCamera) {
          map.camera.restore(microCamera); microCamera = null;
        }
        store.patch({ lens: 'rent', rentSub: d.rentSub, selectedDistrict: '', status: '' });
        return;
      }
      if (d.macro) { store.patch({ lens: 'rent', rentSub: 'macro', macroMetric: d.macro, status: '' }); return; }
      if (d.layout) { store.patch({ layout: d.layout, status: '' }); return; }
      if (d.zoom) { map.camera.control(d.zoom); return; }
      if (d.plate || d.pickPlate || d.backPlate) {
        closePopovers();
        selectPlate(d.plate || d.pickPlate || d.backPlate, !!d.pickPlate);
        return;
      }
      if (d.openPlace) { selectEstate(d.openPlace, false); return; }
      if (d.jumpId) {
        if (engine.plateById.has(d.jumpId)) selectPlate(d.jumpId, true);
        else if (engine.placeById.has(d.jumpId)) selectEstate(d.jumpId, true);
        return;
      }
      if (d.landmark) {
        store.patch({ selectedLandmarkId: d.landmark, selectedPlateId: '', selectedPlaceId: '', selectedRiskId: '', selectedFacilityId: '' });
        return;
      }
      if (d.district) { store.patch({ selectedDistrict: d.district, selectedPlateId: '', selectedPlaceId: '', selectedLandmarkId: '' }); return; }
      if (d.risk) { store.patch({ selectedRiskId: d.risk, selectedFacilityId: '', selectedLandmarkId: '' }); return; }
      if (d.fac) { store.patch({ selectedFacilityId: d.fac, selectedRiskId: '', selectedLandmarkId: '' }); return; }
      if (d.riskFilter !== undefined) { store.patch({ riskFilter: state.riskFilter === d.riskFilter ? '' : d.riskFilter, status: '' }); return; }
      if (d.facFilter !== undefined) { store.patch({ facFilter: state.facFilter === d.facFilter ? '' : d.facFilter, status: '' }); return; }
      if (d.toggleSave) { store.toggleSave(d.toggleSave, d.saveName || d.toggleSave); return; }
      if (d.toggleRef) {
        const next = state.referenceId === d.toggleRef ? '' : d.toggleRef;
        const pl = engine.plateById.get(d.toggleRef);
        store.patch({ referenceId: next, status: next ? `已设参照：${pl?.name || d.toggleRef}` : '已取消参照' });
        return;
      }
      if (d.toggleHub) { store.toggleUsedHub(d.toggleHub); return; }
      if ('toggleFit' in d) { fitExpanded = !fitExpanded; renderDrawer(); return; }
      if ('toggleNote' in d) { noteFormOpen = !noteFormOpen; renderDrawer(); return; }
      if ('closeDrawer' in d) { clearSelection(); return; }
      if ('closeWl' in d) { store.patch({ watchlistOpen: false }); return; }
    });

    document.addEventListener('keydown', ev => {
      if (ev.key !== 'Escape') return;
      if (state.watchlistOpen) { store.patch({ watchlistOpen: false }); return; }
      closePopovers();
      if (state.selectedPlateId || state.selectedPlaceId || state.selectedLandmarkId || state.selectedDistrict || state.selectedRiskId || state.selectedFacilityId) clearSelection();
    });

    // 《P 社 / 纪元》零点击悬停结构化属性卡：鼠标滑过拼图/状态栏/地标即刻呈现优缺点，无需反复开关抽屉！
    const hCard = $('#hover-card');
    const stageEl = $('#stage');
    const svgEl = $('#atlas-svg');
    let lastHoverKey = '';

    function positionHoverCard(ev) {
      if (hCard.hidden) return;
      const sr = stageEl.getBoundingClientRect();
      const cw = 260, ch = hCard.offsetHeight || 135;
      let left = ev.clientX - sr.left + 16;
      let top = ev.clientY - sr.top + 16;
      if (left + cw > sr.width - 12) left = ev.clientX - sr.left - cw - 14;
      if (top + ch > sr.height - 12) top = ev.clientY - sr.top - ch - 12;
      hCard.style.left = Math.max(8, left) + 'px';
      hCard.style.top = Math.max(8, top) + 'px';
    }

    function buildHoverCardHtml(t) {
      if (!t) return '';
      const d = t.dataset;
      if (d.plate) {
        const row = evalResult.plateRowById.get(d.plate);
        if (!row) return '';
        const pl = row.plate;
        const buffs = [];
        if (pl.lines?.length) buffs.push(`🚇 ${pl.lines.join('/')}号线`);
        if (pl.malls?.length) buffs.push(`🛍 ${pl.malls[0].name} ${fmtDist(pl.malls[0].meters)}`);
        else if ((pl.facCats || []).includes('mall')) buffs.push('🛍 商圈商场');
        if ((pl.facCats || []).includes('park')) buffs.push('🌳 公园');
        if ((pl.facCats || []).includes('school')) buffs.push('🏫 学校');
        if ((pl.facCats || []).includes('health')) buffs.push('🏥 医疗');
        if (row.arbitrage.status === 'opportunity') buffs.push('↘ 可议价');
        if (row.premium?.status === 'direct') buffs.push('◆ 步行可达');
        if (row.mastery?.visited) buffs.push(row.mastery.avgStar ? `✓ 已实勘 ${row.mastery.avgStar}★` : '✓ 已实勘');

        const debuffs = [];
        if (row.premium?.status === 'premium') debuffs.push(`↑ 同程贵¥${Math.round(row.premium.extra)}/月`);
        for (const rk of row.risks.slice(0, 2)) debuffs.push(`⚠ ${rk.kind}`);

        const subParts = [pl.district + '·' + pl.streetName];
        if (row.route) subParts.push(`通勤 ${row.route.minutes}分 (${row.route.label})`);
        if (row.fit.count) subParts.push(`适配 ${row.fit.rangeText}`);

        return `<div class="hc-head"><strong>${esc(pl.name)}</strong><span class="hc-price">${pl.unitPrice}元/㎡</span></div>
          <div class="hc-sub">${esc(subParts.join(' · '))}</div>
          ${buffs.length ? `<div class="hc-buffs">${buffs.slice(0, 5).map(b => `<span class="hc-tag hc-buff">${esc(b)}</span>`).join('')}</div>` : ''}
          ${debuffs.length ? `<div class="hc-debuffs">${debuffs.map(b => `<span class="hc-tag hc-debuff">${esc(b)}</span>`).join('')}</div>` : ''}
          <div class="hc-foot">点击锁定影响连线 · 查看具体月租与小区</div>`;
      }
      if (d.landmark) {
        const lm = engine.landmarkById.get(d.landmark);
        if (!lm) return '';
        return `<div class="hc-head"><strong>◆ ${esc(lm.name)}</strong></div>
          <div class="hc-sub">${esc(lm.district)} · ${esc(lm.note)}</div>
          <div class="hc-foot">点击高亮 30 分钟辐射圈 / 设为目的地</div>`;
      }
      if (d.risk) {
        const rk = engine.riskById.get(d.risk);
        return rk ? `<div class="hc-head"><strong>⚠ ${esc(rk.name)}</strong></div><div class="hc-sub">${esc(rk.kind)} · ${esc(rk.status)}</div>` : '';
      }
      if (d.fac) {
        const f = engine.facById.get(d.fac);
        return f ? `<div class="hc-head"><strong>${esc(f.name)}</strong></div><div class="hc-sub">${esc(FAC_CAT[f.category] || f.category)} · ${esc(f.address || '')}</div>` : '';
      }
      if (d.district) {
        return `<div class="hc-head"><strong>${esc(d.district)}</strong></div><div class="hc-sub">${esc(t.getAttribute('aria-label') || '')}</div>`;
      }
      return '';
    }

    svgEl.addEventListener('pointermove', ev => {
      if (svgEl.classList.contains('panning')) { hCard.hidden = true; lastHoverKey = ''; return; }
      const t = ev.target.closest?.('[data-plate],[data-landmark],[data-district],[data-risk],[data-fac]');
      const key = t ? (t.dataset.plate || t.dataset.landmark || t.dataset.risk || t.dataset.fac || t.dataset.district || '') : '';
      if (!key) { hCard.hidden = true; lastHoverKey = ''; return; }
      if (key !== lastHoverKey) {
        lastHoverKey = key;
        const html = buildHoverCardHtml(t);
        hCard.innerHTML = html;
        hCard.hidden = !html;
      }
      positionHoverCard(ev);
    });
    svgEl.addEventListener('pointerleave', () => { hCard.hidden = true; lastHoverKey = ''; });

    if (typeof ResizeObserver === 'function') {
      let raf = 0;
      new ResizeObserver(() => {
        if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (!state.watchlistOpen && evalResult) map.render({ state, evalResult, store }); });
      }).observe($('#atlas-svg'));
    }

    refresh();
  }

  if (typeof document !== 'undefined') bootV3();
})(typeof window !== 'undefined' ? window : globalThis);
