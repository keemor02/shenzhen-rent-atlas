/* V2.5 极简全屏交互控制器：统一搜索框 + 3镜头悬浮坞 + 独立设施/避坑叠加 + 按需滑出抽屉 */
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

  function bootV2() {
    const $ = sel => document.querySelector(sel);
    const $$ = sel => [...document.querySelectorAll(sel)];
    const readJson = id => JSON.parse(document.getElementById(id).textContent);

    const atlas = readJson('atlas-v2-data');
    const travel = readJson('journey-data');
    const timing = readJson('time-data');

    const engine = global.createV2Engine(atlas, travel, timing);
    let map, evalResult, microCamera = null;
    let fitExpanded = false, noteFormOpen = false, riskBarOpen = false;
    let toastTimer = 0;

    const store = global.createV2Store(() => refresh());
    const state = store.state;
    map = global.createV2Map($('#atlas-svg'), atlas, engine, timing, esc);
    const evIcons = global.V2EventIcons;

    $('#work-options').innerHTML = [...new Set([...(travel.workplaces || []), ...engine.nodes.keys(), ...Object.keys(engine.ALIASES)])]
      .map(n => `<option value="${esc(n)}"></option>`).join('');

    $('#help-pop').innerHTML = `
      <p><strong>口径速览（${esc(atlas.asOf)}）</strong></p>
      <p>• <strong>实采 / 保租</strong>：精确挂牌或住建局配租单价；<strong>点纹参考带</strong>按城中村/小区/公寓分形态标区间（如 1.4k–2.5k），不混算。</p>
      <p>• <strong>议价与溢价</strong>：金圈=你的工作地 15 分钟步行圈；红虚圈=其他园区步行圈；仅当圈内贵于同程（±5分）3 处以上圈外同口径样本时亮出 <strong>↑贵¥X</strong>。</p>
      <p>• <strong>设施与避坑</strong>：${atlas.facilities.length} 处官方核验设施（含商场/学校 OSM 2km 测距）与 ${atlas.publicEvents.length} 条 6 类公开记录，可叠加在任意地图视角。</p>
      <p>• 收藏与踩点保存在本机浏览器（兼容旧版手记），可在「★ 清单」导出 JSON 备份。</p>
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

    // 统一搜索下拉：空值时给常用工作地 + 热门探索片区，输入时实时分组匹配工作地 / 片区 / 街道
    function renderOmniPop(query = '') {
      const q = query.trim();
      const pop = $('#omni-pop');
      if (!q) {
        const hotPlaces = ['e-pingzhou', 'v2-chuangzhi-yuncheng', 'baxinlake', 'v2-baishizhou', 'nsguanlong']
          .map(id => engine.placeById.get(id)).filter(Boolean);
        pop.innerHTML = `<div class="omni-sec">设工作地（快捷园区）</div>
          <div class="omni-quick">${engine.QUICK_WORKS.map(n => `<button type="button" data-set-work="${esc(n)}">◆ ${esc(n)}</button>`).join('')}</div>
          <div class="omni-sec">直达热门片区</div>
          <ul class="omni-list">${hotPlaces.map(p => `<li><button type="button" data-pick-place="${esc(p.id)}"><span>${esc(p.shortName)}</span><small>${esc(p.district + '·' + p.streetName)}</small></button></li>`).join('')}</ul>`;
        pop.hidden = false;
        return;
      }

      const workHits = new Set();
      const directW = engine.resolveWork(q);
      if (directW) workHits.add(directW);
      for (const [k, v] of Object.entries(engine.ALIASES)) if (k.includes(q)) workHits.add(v);
      for (const k of engine.nodes.keys()) if (k.includes(q) && workHits.size < 5) workHits.add(k);

      const placeHits = atlas.places.filter(p => p.name.includes(q) || p.shortName.includes(q)).slice(0, 6);
      const streetHits = atlas.streets.filter(s => s.n.includes(q) || s.short.includes(q)).slice(0, 4);

      const sections = [];
      if (workHits.size) {
        sections.push(`<div class="omni-sec">设为工作地中心</div><ul class="omni-list">${[...workHits].slice(0, 5).map(w => `<li><button type="button" data-set-work="${esc(w)}"><span>◆ ${esc(w)}</span><small>设为工作地</small></button></li>`).join('')}</ul>`);
      }
      if (placeHits.length) {
        sections.push(`<div class="omni-sec">直达片区 / 小区</div><ul class="omni-list">${placeHits.map(p => `<li><button type="button" data-pick-place="${esc(p.id)}"><span>${esc(p.name)}</span><small>${esc(p.district)}</small></button></li>`).join('')}</ul>`);
      }
      if (streetHits.length) {
        sections.push(`<div class="omni-sec">直达街道</div><ul class="omni-list">${streetHits.map(s => `<li><button type="button" data-open-street="${esc(s.id)}"><span>${esc(s.n)}</span><small>${esc(s.d)}</small></button></li>`).join('')}</ul>`);
      }
      pop.innerHTML = sections.join('') || `<div class="omni-sec">未匹配到「${esc(q)}」，试试留仙洞、坪洲、西丽、白石洲</div>`;
      pop.hidden = false;
    }

    function syncTopbar() {
      const wp = $('#work-pill');
      if (evalResult.work) {
        wp.hidden = false;
        wp.innerHTML = `<span class="dot">◆</span><span>${esc(evalResult.work)}</span><button type="button" data-clear-work title="清除工作地">×</button>`;
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
            `<button type="button" data-rent-sub="now">↩ 街道</button>`;
        } else {
          row.innerHTML = [
            ['now', '现状'], ['yoy', '同比'], ['mom', '环比'], ['macro', '各区宏观'],
          ].map(([k, l]) => `<button type="button" data-rent-sub="${k}" aria-pressed="${state.rentSub === k}">${l}</button>`).join('');
        }
        row.hidden = false;
      } else if (state.lens === 'commute') {
        if (evalResult.work) {
          row.innerHTML = `<button type="button" data-layout="geo" aria-pressed="${state.layout === 'geo'}">地理图</button>` +
            `<button type="button" data-layout="radial" aria-pressed="${state.layout === 'radial'}">10分钟时间圈</button>`;
        } else {
          row.innerHTML = `<button type="button" data-prompt-work>点击先设工作地</button>`;
        }
        row.hidden = false;
      } else {
        if (!evalResult.work) {
          row.innerHTML = `<button type="button" data-prompt-work>设工作地后激活 15 分钟园区溢价圈</button>`;
          row.hidden = false;
        } else {
          row.hidden = true;
        }
      }

      // 独立设施/避坑微筛选条（平时完全收起，点开设施或避坑筛选时才出现！）
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

    // 极简高信噪比片区详情卡：绝不重复数字、无异常静默隐藏、水电口径只提一次！
    function renderPlaceCard(row) {
      const p = row.place, entry = row.entry;
      const saved = store.isSaved(p.id);
      const isRef = state.referencePlaceId === p.id;
      const rentVal = row.rent ? (row.rent.low === row.rent.high ? money(row.rent.median) : `${money(row.rent.low)}–${money(row.rent.high)}`) : '待补';
      const navUrl = evalResult.work ? `https://uri.amap.com/navigation?${new URLSearchParams({
        from: `${p.coord[0]},${p.coord[1]},${p.name}`,
        to: `${engine.nodes.get(evalResult.work).coord[0]},${engine.nodes.get(evalResult.work).coord[1]},${evalResult.work}`,
        mode: state.mode === 'drive' ? 'car' : 'bus',
      })}` : '';

      // 唯一信号徽章（无异常则彻底不显示！）
      let sigHtml = '';
      if (row.premium?.status === 'premium') {
        sigHtml = `<span class="sig-pill sig-prem">↑ 贵¥${Math.round(row.premium.extra)}/月</span>`;
      } else if (row.arbitrage.status === 'opportunity') {
        sigHtml = `<span class="sig-pill sig-opp">↘ 可议价</span>`;
      } else if (row.premium?.status === 'direct') {
        sigHtml = `<span class="sig-pill sig-walk">◆ 可步行上班</span>`;
      }

      // 浓缩适配总分徽章（仅当已算分时出现，点击展开 4 项拆解）
      const fitBadge = row.fit.count
        ? `<button type="button" class="fit-pill${row.fit.premiumPenalty ? ' has-pen' : ''}" data-toggle-fit title="点击查看四维评分明细">适配 ${esc(row.fit.rangeText)}${row.fit.premiumPenalty ? ' (−' + row.fit.premiumPenalty + ')' : ''}</button>`
        : '';
      const fitBreakdown = fitExpanded && row.fit.count
        ? `<div class="fit-detail-box"><strong>四维拆解</strong>（缺项显示区间）<ul>${engine.FIT_KEYS.map(k => {
          const d = row.fit.dimensions[k];
          return `<li>${esc(engine.FIT_NAMES[k])}：<strong>${d.score == null ? '待踩点' : Math.round(d.score) + '分'}</strong> · ${esc(d.why)}</li>`;
        }).join('')}</ul></div>`
        : '';

      // 参照对比差额（仅当设置了参照片区时显示）
      const deltaHtml = evalResult.refRow && !isRef && row.refDeltas.length
        ? `<div class="delta-row"><span class="sub-note" style="margin:0;align-self:center">比「${esc(evalResult.refRow.place.shortName)}」</span>${row.refDeltas.map(d => `<span class="delta-chip ${d.better ? 'better' : 'worse'}">${esc(d.text)}</span>`).join('')}</div>`
        : '';

      // 非必要溢价卡：严格「静默原则」——只有在其他园区 15 分钟步行圈内（或已标常去）才出现！圈外片区零占位！
      let premHtml = '';
      const pr = row.premium;
      if (pr && pr.hub && pr.status !== 'direct' && pr.status !== 'no-hub' && pr.status !== 'no-work') {
        const isPrem = pr.status === 'premium';
        const title = isPrem ? `↑ 同程溢价 ¥${Math.round(pr.extra)}/月`
          : pr.status === 'used' ? `✓ 常去「${pr.hub.name}」（免扣分）`
          : `近「${pr.hub.name}」步行 ${pr.hub.walk}分 · ${pr.status === 'no-extra' ? '未见多付' : '差额待核'}`;
        const alts = pr.alternatives?.length
          ? `<ul class="alt-list">${pr.alternatives.map(a => `<li><button type="button" data-pick-place="${esc(a.id)}">→ ${esc(a.name)}</button><span>${money(a.price)} · ${a.minutes}分</span></li>`).join('')}</ul>`
          : '';
        premHtml = `<div class="alert-card${isPrem ? ' is-prem' : ''}">
          <div class="alert-head"><span>${esc(title)}</span></div>
          <p class="sub-note">${esc(pr.reason)}</p>${alts}
          <div style="margin-top:6px"><button type="button" class="btn-ghost" data-toggle-hub="${esc(pr.hub.name)}" aria-pressed="${pr.status === 'used'}">${pr.status === 'used' ? '取消常去' : '我常去「' + esc(pr.hub.name) + '」'}</button></div>
        </div>`;
      }

      // 议价依据（仅当有明确议价信号或事件/政策时出现！）
      let evPolHtml = '';
      if (row.arbitrage.reasons.length || row.events.length || row.policies.length) {
        const reasonLine = row.arbitrage.reasons.length
          ? `<div class="alert-card is-opp"><div class="alert-head"><span>↘ 议价线索</span></div>${row.arbitrage.reasons.map(r => `<p class="sub-note" style="color:var(--fg)">• ${esc(r)}</p>`).join('')}</div>`
          : '';
        const evItems = row.events.map(ev => `<li><strong>${esc(ev.title)}</strong> <span class="micro-tag">${esc(ev.date)}</span><p class="sub-note">${esc(ev.summary)} ${lnk(ev.source, ev.sourceName)}</p></li>`).join('');
        const polItems = row.policies.map(pol => `<li><strong>${esc(pol.title)}</strong> <span class="micro-tag">${esc(pol.status)}</span><p class="sub-note">${esc(pol.summary)} ${lnk(pol.source, pol.sourceName)}</p></li>`).join('');
        evPolHtml = `<section id="sec-evidence">${reasonLine}${(evItems || polItems) ? `<div class="sec-head"><h3>事件与本地政策</h3></div><ul class="clean-list">${evItems}${polItems}</ul>` : ''}</section>`;
      }

      // 紧凑租金列表（水电提醒统一放小标题右侧，绝不在每行抄 4 遍！）
      const primaryType = (row.rentsMatched[0] || p.rents[0])?.type;
      const utilHint = atlas.housingTypeMeta[primaryType]?.utility || '';
      const rentItems = (row.rentsMatched.length ? row.rentsMatched : p.rents).slice(0, 6).map(r => {
        const tLabel = atlas.housingTypeMeta[r.type]?.label || '综合';
        const priceStr = r.low === r.high ? money(r.median) : `${money(r.low)}–${money(r.high)}`;
        return `<li>
          <div class="rent-line"><span><strong>${esc(tLabel)} · ${ROOM_LABEL[r.room] || r.room + '室'}</strong><span class="micro-tag">${esc(engine.GRAIN_LABELS[r.grain] || r.grain)}</span></span><span class="rent-price">${esc(priceStr)}</span></div>
          <p class="sub-note">${r.sqm ? `${r.sqm[0]}${r.sqm[1] !== r.sqm[0] ? '–' + r.sqm[1] : ''}㎡ · ` : ''}${esc(r.period)} · ${lnk(r.source, r.sourceName) || esc(r.sourceName)}</p>
        </li>`;
      }).join('');

      // 2km 核验设施（有才显示！）
      const nearFacHtml = row.nearbyFacs.length
        ? `<div class="sec-head"><h3>2 公里内定位设施</h3></div><ul class="clean-list">${row.nearbyFacs.map(f =>
          `<li><strong>${esc(f.name)}</strong><span class="micro-tag">${esc(FAC_CAT[f.category] || f.category)} · ${fmtDist(f.meters)}</span> <span class="sub-note">${lnk(f.source, '政府')} ${lnk(f.osmUrl, 'OSM')}</span></li>`
        ).join('')}</ul>`
        : '';

      // 避坑（有才显示！）
      const riskHtml = (p.watchouts.length || row.risks.length)
        ? `<div class="sec-head"><h3>看房必核避坑</h3></div><ul class="clean-list">${p.watchouts.map(w => `<li>⚠️ ${esc(w)}</li>`).join('')}${row.risks.map(rk => {
          const rt = evIcons.eventTypeFor(rk);
          return `<li>${evIcons.eventIconSvg(rt)} <strong>${esc(rk.name)}</strong>（${esc(rk.observed)}）<p class="sub-note">${esc(rk.check)} ${lnk(rk.url, rk.source)}</p></li>`;
        }).join('')}</ul>`
        : '';

      // 踩点笔记（平时收起表单，已有记录则精简展示，点「✎ 踩点」立刻展开）
      const starOpts = v => `<option value="">未评</option>` + [1, 2, 3, 4, 5].map(n => `<option value="${n}"${v === n ? ' selected' : ''}>${n}星</option>`).join('');
      const hasNote = !!(entry?.monthly || entry?.environment || entry?.convenience || entry?.note);
      const noteDisplay = hasNote && !noteFormOpen
        ? `<div class="sec-head"><h3>我的踩点</h3><button type="button" class="link-btn" data-toggle-note>编辑</button></div>
          <p class="sub-note" style="color:var(--fg)">${[entry.monthly ? '实谈 ' + money(entry.monthly) : '', entry.environment ? '环境' + entry.environment + '星' : '', entry.convenience ? '便利' + entry.convenience + '星' : '', entry.note || ''].filter(Boolean).join(' · ')}</p>`
        : '';
      const noteFormHtml = noteFormOpen
        ? `<form id="place-note-form" class="note-form" data-note-id="${esc(p.id)}">
            <label>实谈月租（元）<input name="monthly" type="number" min="100" max="100000" value="${entry?.monthly ?? ''}" placeholder="看房谈下的真实月租"></label>
            <div class="note-form-2">
              <label>环境<select name="environment">${starOpts(entry?.environment)}</select></label>
              <label>便利<select name="convenience">${starOpts(entry?.convenience)}</select></label>
            </div>
            <label>实地笔记<textarea name="note" rows="2" placeholder="噪音、采光、水电、实走时间…">${esc(entry?.note || '')}</textarea></label>
            <div class="drawer-actions" style="margin:0"><button type="submit" class="btn-primary">保存</button><button type="button" class="btn-ghost" data-toggle-note>取消</button></div>
          </form>`
        : '';

      const commPart = evalResult.work
        ? (row.route ? `<span class="vital-item"><strong>${row.route.minutes}分</strong><small class="sub-note" style="margin:0">${esc(row.route.label)} ${lnk(navUrl, '高德')}</small></span>` : `<span class="vital-item">无路线</span>`)
        : `<span class="vital-item"><button type="button" class="link-btn" data-prompt-work>设工作地算通勤</button></span>`;
      const comm2Note = evalResult.work2 && row.route2 ? `<p class="sub-note" style="margin:-4px 0 8px">第二工作地 ${esc(evalResult.work2)}：<strong>${row.route2.minutes} 分钟</strong></p>` : '';

      return `<div class="drawer-head">
          <p class="drawer-kicker">${esc([p.district, p.streetName, p.station ? '近' + p.station + '站' : ''].filter(Boolean).join(' · '))}</p>
          <button type="button" class="drawer-close" data-close-drawer title="收起">×</button>
        </div>
        <div class="drawer-title-row"><h2>${esc(p.name)}</h2>${fitBadge}</div>
        ${fitBreakdown}
        ${row.exclusions.length ? `<p class="sub-note" style="color:var(--warm);margin:0 0 6px">当前筛选外：${esc(row.exclusions.join('、'))}</p>` : ''}
        <div class="vital-strip">${commPart}<span class="vital-sep">|</span><span class="vital-item"><strong>${esc(rentVal)}</strong></span>${sigHtml}</div>
        ${comm2Note}${deltaHtml}
        <div class="drawer-actions">
          <button type="button" class="${saved ? 'btn-primary' : 'btn-ghost'}" data-toggle-save="${esc(p.id)}">${saved ? '★ 已收藏' : '☆ 收藏'}</button>
          <button type="button" class="btn-ghost" data-toggle-ref="${esc(p.id)}" aria-pressed="${isRef}">${isRef ? '◎ 参照中' : '◎ 设参照'}</button>
          <button type="button" class="btn-ghost" data-toggle-note aria-pressed="${noteFormOpen}">✎ 踩点</button>
          ${p.streetId ? `<button type="button" class="btn-ghost" data-open-street="${esc(p.streetId)}">同街道</button>` : ''}
        </div>
        ${noteFormHtml}${noteDisplay}${premHtml}${evPolHtml}
        <div class="sec-head"><h3>租金样本</h3>${utilHint ? `<span class="sec-hint" title="${esc(utilHint)}">${esc(utilHint.split('（')[0])}</span>` : ''}</div>
        ${rentItems ? `<ul class="rent-list">${rentItems}</ul>` : '<p class="sub-note">当前筛选条件下暂无样本</p>'}
        ${nearFacHtml}${riskHtml}`;
    }

    function renderDrawer() {
      const el = $('#detail-drawer');
      const stage = $('#stage');
      let html = '';

      if (state.selectedRiskId) {
        const rk = engine.riskById.get(state.selectedRiskId);
        if (rk) {
          const rt = evIcons.eventTypeFor(rk);
          html = `<div class="drawer-head"><p class="drawer-kicker">${evIcons.eventIconSvg(rt)} ${esc(rk.kind)} · ${esc(rk.observed)}</p><button type="button" class="drawer-close" data-close-drawer>×</button></div>
            <div class="drawer-title-row"><h2>${esc(rk.name)}</h2></div>
            <p class="sub-note" style="color:var(--fg)"><strong>状态：</strong>${esc(rk.status)}${rk.until ? '（至 ' + esc(rk.until) + '）' : ''}</p>
            <p style="margin:8px 0;font-size:13px">${esc(rk.fact)}</p>
            <div class="sec-head"><h3>踩点核实建议</h3></div>
            <p class="sub-note" style="color:var(--fg)">${esc(rk.check)}</p>
            <p class="sub-note" style="margin-top:8px">${esc(rk.anchor)} · ${lnk(rk.url, rk.source)}</p>`;
        }
      } else if (state.selectedFacilityId) {
        const f = engine.facById.get(state.selectedFacilityId);
        if (f) {
          html = `<div class="drawer-head"><p class="drawer-kicker">核验设施 · ${esc(FAC_CAT[f.category] || f.category)}</p><button type="button" class="drawer-close" data-close-drawer>×</button></div>
            <div class="drawer-title-row"><h2>${esc(f.name)}</h2></div>
            <p class="sub-note" style="color:var(--fg)">${esc(f.address || '')}</p>
            ${f.matchNote ? `<p class="sub-note" style="margin-top:6px">${esc(f.matchNote)}</p>` : ''}
            <p class="sub-note" style="margin-top:8px">${lnk(f.source, f.sourceName || '政府资料')} ${f.osm?.source ? ' · ' + lnk(f.osm.source, 'OSM 坐标') : ''}</p>`;
        }
      } else if (state.selectedPlaceId) {
        const row = evalResult.rowById.get(state.selectedPlaceId);
        if (row) html = renderPlaceCard(row);
      } else if (state.selectedStreetId) {
        const s = engine.streetById.get(state.selectedStreetId);
        if (s) {
          const sum = evalResult.streetSummary.get(s.id);
          const stFacs = atlas.facilities.filter(f => f.streetId === s.id && (!state.facFilter || f.category === state.facFilter));
          html = `<div class="drawer-head"><p class="drawer-kicker">${esc(s.d)} · 行政街道</p><button type="button" class="drawer-close" data-close-drawer>×</button></div>
            <div class="drawer-title-row"><h2>${esc(s.n)}</h2></div>
            <p class="sub-note">${[s.refUnit ? `参考单价 ${s.refUnit}元/㎡` : '', `${sum.members.length} 处片区`, s.facilityCount ? `${s.facilityCount} 处核验设施` : ''].filter(Boolean).join(' · ')}</p>
            ${sum.members.length ? `<div class="sec-head"><h3>片区与小区</h3></div><ul class="place-btn-list">${sum.members.map(r => {
              const badge = r.premium?.status === 'premium' ? `<span class="sig-pill sig-prem">↑贵¥${Math.round(r.premium.extra)}</span>`
                : r.arbitrage.status === 'opportunity' ? `<span class="sig-pill sig-opp">↘议价</span>` : '';
              const priceTxt = r.rent ? (r.rent.grain === 'band' ? `${(r.rent.low / 1000).toFixed(1).replace(/\.0$/, '')}–${(r.rent.high / 1000).toFixed(1).replace(/\.0$/, '')}k` : money(r.rent.median)) : '';
              return `<li><button type="button" data-pick-place="${esc(r.place.id)}">${esc(r.place.shortName)} ${badge}</button><span class="meta">${[priceTxt, r.route ? r.route.minutes + '分' : ''].filter(Boolean).join(' · ')}</span></li>`;
            }).join('')}</ul>` : ''}
            ${sum.events.length || sum.policies.length ? `<div class="sec-head"><h3>事件与政策</h3></div><ul class="clean-list">${sum.events.map(e => `<li><strong>${esc(e.title)}</strong><p class="sub-note">${esc(e.summary)} ${lnk(e.source, e.sourceName)}</p></li>`).join('')}${sum.policies.map(pol => `<li><strong>${esc(pol.title)}</strong><p class="sub-note">${esc(pol.summary)} ${lnk(pol.source, pol.sourceName)}</p></li>`).join('')}</ul>` : ''}
            ${stFacs.length ? `<div class="sec-head"><h3>核验设施 (${stFacs.length})</h3></div><ul class="clean-list">${stFacs.slice(0, 8).map(f => `<li><strong>${esc(f.name)}</strong><span class="micro-tag">${esc(FAC_CAT[f.category] || f.category)}</span><p class="sub-note">${esc(f.address)} ${lnk(f.source, '来源')}</p></li>`).join('')}</ul>` : ''}`;
        }
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
            <div class="drawer-actions"><button type="button" class="btn-primary" data-rent-sub="now">切回街道细看</button></div>`;
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
          const p = engine.placeById.get(form.dataset.noteId);
          noteFormOpen = false;
          store.saveNote(p.id, p.name, {
            monthly: fd.get('monthly'), environment: fd.get('environment'),
            convenience: fd.get('convenience'), note: fd.get('note'),
          });
        };
        if (state.focusSection === 'evidence') {
          state.focusSection = '';
          el.querySelector('#sec-evidence')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
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
      const rows = entries.map(e => ({ entry: e, row: evalResult.rowById.get(e.id) || null }));
      const picks = rows.filter(x => x.row).slice(0, 4);

      const compareHtml = picks.length >= 2 ? `<div class="wl-table-wrap"><table class="wl-table"><thead><tr><th>维度</th>${picks.map(x => `<th><button type="button" class="btn-ghost" data-jump-place="${esc(x.row.place.id)}">${esc(x.row.place.shortName)}</button></th>`).join('')}</tr></thead><tbody>
        <tr><th>适配评分</th>${picks.map(x => `<td><strong>${esc(x.row.fit.rangeText)}</strong>${x.row.fit.premiumPenalty ? ` <span style="color:var(--warm)">(−${x.row.fit.premiumPenalty})</span>` : ''}</td>`).join('')}</tr>
        <tr><th>单程通勤</th>${picks.map(x => `<td>${evalResult.work ? (x.row.route ? `<strong>${x.row.route.minutes}分</strong> ${esc(x.row.route.label)}` : '待核') : '未设工作地'}${evalResult.work2 && x.row.route2 ? `<br>二地 ${x.row.route2.minutes}分` : ''}</td>`).join('')}</tr>
        <tr><th>分形态月租</th>${picks.map(x => `<td>${x.row.rent ? `<strong>${money(x.row.rent.low)}–${money(x.row.rent.high)}</strong><div class="sub-note">${esc(atlas.housingTypeMeta[x.row.rent.type]?.label || '综合')}</div>` : '待补'}</td>`).join('')}</tr>
        <tr><th>溢价/议价</th>${picks.map(x => `<td>${x.row.premium?.status === 'premium' ? `<span class="sig-pill sig-prem">↑贵¥${Math.round(x.row.premium.extra)}</span>` : x.row.arbitrage.status === 'opportunity' ? `<span class="sig-pill sig-opp">↘可议价</span>` : '—'}</td>`).join('')}</tr>
        <tr><th>我的实录</th>${picks.map(x => `<td>${[x.entry.monthly ? '实谈' + money(x.entry.monthly) : '', x.entry.environment ? '环境' + x.entry.environment + '星' : '', x.entry.convenience ? '便利' + x.entry.convenience + '星' : ''].filter(Boolean).join(' · ') || '未记'}${x.entry.note ? `<div class="sub-note">${esc(x.entry.note)}</div>` : ''}</td>`).join('')}</tr>
      </tbody></table></div>` : '';

      const listHtml = entries.length ? `<ul class="clean-list">${rows.map(({ entry, row }) => `<li>
        <div class="rent-line"><strong>${esc(entry.name)}</strong><div>${row ? `<button type="button" class="btn-ghost" data-jump-place="${esc(entry.id)}">地图查看</button> ` : ''}<button type="button" class="btn-ghost" data-toggle-save="${esc(entry.id)}">${entry.saved ? '移除' : '重藏'}</button></div></div>
        <p class="sub-note">${[entry.monthly ? '实谈 ' + money(entry.monthly) : '', entry.environment ? '环境' + entry.environment + '星' : '', entry.convenience ? '便利' + entry.convenience + '星' : '', entry.observed || '', entry.note || ''].filter(Boolean).join(' · ') || '已收藏，看房后可补录实价与噪音感受。'}</p>
      </li>`).join('')}</ul>` : '<p class="sub-note">清单还是空的，点击地图任意片区并点「收藏」即可开始横向对比。</p>';

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
      $('#explore-progress').textContent = `已探 ${state.seen.size}/${atlas.places.length}`;
      $('#match-summary').textContent = state.lens === 'rent' && state.rentSub === 'macro' ? '全深圳宏观' : `命中 ${evalResult.eligibleRows.length}`;
      showToast(state.status);

      const isRadial = state.lens === 'commute' && state.layout === 'radial' && !!evalResult.work;
      $('#zoom-box').hidden = isRadial;
      $('#btn-discover').disabled = evalResult.eligibleRows.length === 0;

      const legendHtml = map.render({ state, evalResult, store });
      $('#map-legend').innerHTML = legendHtml;
      renderDrawer();
      renderWatchlist();
    }

    function clearSelection() {
      fitExpanded = false; noteFormOpen = false;
      store.patch({ selectedPlaceId: '', selectedStreetId: '', selectedDistrict: '', selectedRiskId: '', selectedFacilityId: '' });
    }

    function selectPlace(id, fitCamera = true, section = '') {
      const p = engine.placeById.get(id);
      if (!p) return;
      state.seen.add(id);
      fitExpanded = false; noteFormOpen = false;
      if (fitCamera) {
        if (p.footprint) map.camera.fit(p.footprint.bounds);
        else {
          const st = engine.streetById.get(p.streetId);
          if (st) map.camera.fit(st.bounds);
        }
      }
      store.patch({
        watchlistOpen: false,
        rentSub: state.rentSub === 'macro' ? 'now' : state.rentSub,
        selectedPlaceId: id, selectedStreetId: p.streetId || '',
        selectedDistrict: '', selectedRiskId: '', selectedFacilityId: '',
        focusSection: section, status: '',
      });
    }

    function selectStreet(id) {
      const s = engine.streetById.get(id);
      if (!s) return;
      map.camera.fit(s.bounds);
      store.patch({
        watchlistOpen: false, rentSub: state.rentSub === 'macro' ? 'now' : state.rentSub,
        selectedStreetId: id, selectedPlaceId: '', selectedDistrict: '', selectedRiskId: '', selectedFacilityId: '', status: '',
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
      const w = engine.resolveWork(q);
      if (w) { omni.value = ''; closePopovers(); store.patch({ work: w, status: `已设工作地：${w}` }); return; }
      const p = atlas.places.find(x => x.name === q || x.shortName === q) || atlas.places.find(x => x.name.includes(q));
      if (p) { omni.value = ''; closePopovers(); selectPlace(p.id, true); return; }
      const s = atlas.streets.find(x => x.n === q || x.short === q) || atlas.streets.find(x => x.n.includes(q));
      if (s) { omni.value = ''; closePopovers(); selectStreet(s.id); return; }
      showToast(`未找到「${q}」`);
    };

    // 顶栏下拉浮层按钮
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
      const r = engine.resolveWork(raw);
      store.patch({ work2: r, status: r ? `已设第二工作地：${r}` : '第二工作地未匹配' });
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
      map.camera.reset();
      closePopovers();
      store.patch({
        budget: 0, room: '1', sqm: 0, mode: 'rail', limit: 50, work2: '', limit2: 0,
        access: 5, egress: 5, housingTypes: ['village', 'oldEstate', 'modernEstate', 'apartment'],
        verifiedOnly: false, oppOnly: false, riskFilter: '', facFilter: '', referencePlaceId: '',
        weights: { commute: 1, rent: 1, environment: 1, convenience: 1 },
        selectedPlaceId: '', selectedStreetId: '', selectedDistrict: '', selectedRiskId: '', selectedFacilityId: '',
        status: '已重置筛选条件',
      });
    };

    $('#toggle-fac').onclick = () => {
      const next = !state.showFacilities;
      if (next) riskBarOpen = false;
      store.patch({ showFacilities: next, status: next ? '已叠加核验设施（商场/学校/公园）' : '' });
    };
    $('#toggle-risk').onclick = () => {
      if (!state.showRisks) {
        riskBarOpen = true;
        store.patch({ showRisks: true, showFacilities: false, status: '已开启 6 类避坑标记' });
      } else if (!riskBarOpen) {
        riskBarOpen = true;
        store.patch({ showFacilities: false });
      } else {
        riskBarOpen = false;
        store.patch({ showRisks: false, riskFilter: '', status: '已隐藏避坑标记' });
      }
    };

    $('#btn-discover').onclick = () => {
      const next = engine.discoverNext(evalResult, state.seen);
      if (!next) { showToast('当前条件下的片区已全部探完，可放宽预算或通勤上限'); return; }
      selectPlace(next.place.id, true);
      const tips = [];
      if (evalResult.refRow && next.refDeltas.length) tips.push(...next.refDeltas.slice(0, 2).map(d => '比参照' + d.text));
      else {
        if (state.budget && next.rent && next.rent.median < state.budget) tips.push(`比预算省 ${money(state.budget - next.rent.median)}`);
        if (evalResult.work && next.route && next.route.minutes < state.limit) tips.push(`${next.route.minutes}分钟可达`);
        if (next.arbitrage.status === 'opportunity') tips.push('↘ 可议价');
      }
      showToast(`新发现 ${next.place.shortName}${tips.length ? ' · ' + tips.join(' · ') : ''}`);
    };

    // 全局点击代理
    document.body.addEventListener('click', ev => {
      if (!ev.target.closest('.pop-anchor,.search-wrap')) closePopovers();

      // 地块内嵌 3 图标点击 -> 直达证据区
      const partEl = ev.target.closest('[data-insight-part]');
      if (partEl) {
        const { areaKind, areaId } = partEl.dataset;
        if (areaKind === 'place') { selectPlace(areaId, false, 'evidence'); return; }
        if (areaKind === 'street') { selectStreet(areaId); return; }
        if (areaKind === 'zone') {
          const z = atlas.zones.find(x => x.id === areaId);
          if (z) { map.camera.fit(z.bounds); store.patch({ selectedStreetId: z.street, selectedPlaceId: '' }); }
          return;
        }
      }
      const badgeEl = ev.target.closest('[data-area-insight]');
      if (badgeEl) {
        const kind = badgeEl.dataset.areaInsight, id = badgeEl.dataset.areaId;
        if (kind === 'place') { selectPlace(id, false); return; }
        if (kind === 'street') { selectStreet(id); return; }
        if (kind === 'zone') {
          const z = atlas.zones.find(x => x.id === id);
          if (z) { map.camera.fit(z.bounds); store.patch({ selectedStreetId: z.street, selectedPlaceId: '' }); }
          return;
        }
      }

      const el = ev.target.closest('[data-set-work],[data-clear-work],[data-prompt-work],[data-htype],[data-mode],[data-lens],[data-rent-sub],[data-macro],[data-layout],[data-zoom],[data-place],[data-street],[data-zone],[data-district],[data-risk],[data-fac],[data-risk-filter],[data-fac-filter],[data-pick-place],[data-open-street],[data-toggle-save],[data-toggle-ref],[data-toggle-hub],[data-toggle-fit],[data-toggle-note],[data-close-drawer],[data-close-wl],[data-jump-place]');
      if (!el) {
        // 点击地图海洋/空白处自动收起抽屉，回归 100% 全屏地图
        if (ev.target === $('#atlas-svg') && (state.selectedPlaceId || state.selectedStreetId || state.selectedDistrict || state.selectedRiskId || state.selectedFacilityId)) {
          clearSelection();
        }
        return;
      }

      const d = el.dataset;
      if (d.setWork) { omni.value = ''; closePopovers(); store.patch({ work: d.setWork, status: `工作地中心：${d.setWork}` }); return; }
      if ('clearWork' in d) { store.patch({ work: '', layout: 'geo', status: '已清除工作地' }); return; }
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
        store.patch({ lens: d.lens, rentSub: leaveMacro ? 'now' : state.rentSub, status: '' });
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
      if (d.place || d.pickPlace) { closePopovers(); selectPlace(d.place || d.pickPlace, !!d.pickPlace); return; }
      if (d.jumpPlace) { selectPlace(d.jumpPlace, true); return; }
      if (d.street || d.openStreet) { closePopovers(); selectStreet(d.street || d.openStreet); return; }
      if (d.zone) { const z = atlas.zones.find(x => x.id === d.zone); if (z) { map.camera.fit(z.bounds); store.patch({ selectedStreetId: z.street, selectedPlaceId: '' }); } return; }
      if (d.district) { store.patch({ selectedDistrict: d.district, selectedPlaceId: '', selectedStreetId: '', selectedRiskId: '', selectedFacilityId: '' }); return; }
      if (d.risk) { store.patch({ selectedRiskId: d.risk, selectedFacilityId: '' }); return; }
      if (d.fac) { store.patch({ selectedFacilityId: d.fac, selectedRiskId: '' }); return; }
      if (d.riskFilter !== undefined) { store.patch({ riskFilter: state.riskFilter === d.riskFilter ? '' : d.riskFilter, status: '' }); return; }
      if (d.facFilter !== undefined) { store.patch({ facFilter: state.facFilter === d.facFilter ? '' : d.facFilter, status: '' }); return; }
      if (d.toggleSave) { const p = engine.placeById.get(d.toggleSave); store.toggleSave(d.toggleSave, p?.name || d.toggleSave); return; }
      if (d.toggleRef) {
        const next = state.referencePlaceId === d.toggleRef ? '' : d.toggleRef;
        const p = engine.placeById.get(d.toggleRef);
        store.patch({ referencePlaceId: next, status: next ? `已设参照：${p?.shortName || d.toggleRef}` : '已取消参照' });
        return;
      }
      if (d.toggleHub) { store.toggleUsedHub(d.toggleHub); return; }
      if ('toggleFit' in d) { fitExpanded = !fitExpanded; renderDrawer(); return; }
      if ('toggleNote' in d) { noteFormOpen = !noteFormOpen; renderDrawer(); return; }
      if ('closeDrawer' in d) { clearSelection(); return; }
      if ('closeWl' in d) { store.patch({ watchlistOpen: false }); return; }
    });

    // Escape 键一键收起浮层 / 抽屉 / 清单
    document.addEventListener('keydown', ev => {
      if (ev.key !== 'Escape') return;
      if (state.watchlistOpen) { store.patch({ watchlistOpen: false }); return; }
      closePopovers();
      if (state.selectedPlaceId || state.selectedStreetId || state.selectedDistrict || state.selectedRiskId || state.selectedFacilityId) clearSelection();
    });

    // 零重绘悬停 HUD
    const hud = $('#hover-hud');
    $('#atlas-svg').addEventListener('pointerover', ev => {
      const t = ev.target.closest?.('[data-area-insight],[data-place],[data-street],[data-district],[data-risk],[data-fac]');
      const label = t?.getAttribute('aria-label') || '';
      hud.textContent = label;
      hud.hidden = !label;
    });
    $('#atlas-svg').addEventListener('pointerleave', () => { hud.hidden = true; hud.textContent = ''; });

    if (typeof ResizeObserver === 'function') {
      let raf = 0;
      new ResizeObserver(() => {
        if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (!state.watchlistOpen && evalResult) map.render({ state, evalResult, store }); });
      }).observe($('#atlas-svg'));
    }

    refresh();
  }

  if (typeof document !== 'undefined') bootV2();
})(typeof window !== 'undefined' ? window : globalThis);
