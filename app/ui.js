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
  const fmtDist = m => m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`;

  function bootV3() {
    const $ = sel => document.querySelector(sel);
    const $$ = sel => [...document.querySelectorAll(sel)];
    const readJson = id => JSON.parse(document.getElementById(id).textContent);

    const atlas = readJson('atlas-v3-data');
    const listingPeriod = atlas.listingMonth ? `（${esc(atlas.listingMonth)}）` : '';
    const travel = readJson('journey-data');
    const timing = readJson('time-data');

    const engine = global.createV3Engine(atlas, travel, timing);
    let map, evalResult, microCamera = null;
    let fitExpanded = false, noteFormOpen = false, riskBarOpen = false;
    let toastTimer = 0, prevWorkName = '';
    const shortDestName = name => String(name || '').replace(/板块$/, '');
    const isCurDest = (...names) => !!evalResult?.dest1 && names.some(n => n && (evalResult.dest1.name === n || shortDestName(evalResult.dest1.name) === shortDestName(n)));

    const store = global.createV3Store(() => refresh());
    const state = store.state;
    map = global.createV3Map($('#atlas-svg'), atlas, engine, timing, esc);
    const evIcons = global.V3EventIcons;

    $('#dest-options').innerHTML = atlas.destinations
      .map(d => `<option value="${esc(d.name)}"></option>`).join('');

    $('#help-pop').innerHTML = `
      <p><strong>数据说明${atlas.asOf ? `（核验至 ${esc(atlas.asOf)}）` : ''}</strong></p>
      ${atlas.listingMonth ? `<p>各区挂牌租金统计期 ${esc(atlas.listingMonth)}</p>` : ''}
      <p>• <strong>市场房与保租房独立分开</strong>：左下角可一键切换「市场房」（城中村/老小区/电梯小区/商业公寓）与「保租房」（政府配租现房与规划在建项目）。</p>
      <p>• <strong>多维度自由叠加</strong>：市场房下「租金 / 通勤 / 涨跌 / 捡漏/避贵 / 人口」可同时多选，打开 2 项以上时可在底部图例左侧随时切换「底色」着色依据。</p>
      <p>• <strong>平峰 / 早高峰通勤切换</strong>：顶部可切换「早高峰」估算（叠加深圳地铁限流大站排队或进核心区驾车潮汐拥堵，非实时 API）；抽屉内可直接点「高德↗」核对明天 8:30 实测。</p>
      <p>• <strong>多信源交叉对照</strong>：片区抽屉并列展示万科泊寓、龙湖冠寓、自如、魔方、微棠、贝壳/乐有家、58/安居客及政府保租房，并附一键跳贝壳/自如/乐有家看当日实盘。</p>
      <p>• 收藏与看房笔记保存在本机浏览器，可在「★ 看房清单」导出 JSON 备份。</p>
    `;

    function closePopovers(exceptId = '') {
      for (const [popId, btnId] of [['omni-pop', ''], ['req-pop', 'req-btn'], ['help-pop', 'help-btn'], ['map-filter-pop', 'map-filter-btn']]) {
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
          <div class="omni-sec">直达热门居住片区</div>
          <ul class="omni-list">${hotPlates.map(pl => `<li><button type="button" class="omni-main" data-pick-plate="${esc(pl.id)}"><span>${esc(pl.name)}</span><small>${esc(pl.district + ' · ' + pl.unitPrice + '元/㎡')}</small></button></li>`).join('')}</ul>`;
        pop.hidden = false;
        return;
      }

      const destHits = engine.searchDestinations(q, 10);
      const plateHits = atlas.plates.filter(pl => pl.name.includes(q) || pl.streetName.includes(q)).slice(0, 5);

      const sections = [];
      if (destHits.length) {
        sections.push(`<div class="omni-sec">设为通勤目的地（写字楼 / 园区 / 商圈 / 地铁 / 小区）</div><ul class="omni-list">${destHits.map(d => `<li>
          <button type="button" class="omni-main" data-set-work="${esc(d.name)}"><span>◆ ${esc(d.name)}</span><small>${esc([d.district, d.kind].filter(Boolean).join(' · '))}</small></button>
        </li>`).join('')}</ul>`);
      }
      if (plateHits.length) {
        sections.push(`<div class="omni-sec">直达居住片区</div><ul class="omni-list">${plateHits.map(pl => `<li>
          <button type="button" class="omni-main" data-pick-plate="${esc(pl.id)}"><span>${esc(pl.name)}</span><small>${esc(pl.district + ' · ' + pl.unitPrice + '元/㎡')}</small></button>
          <button type="button" class="omni-go" data-set-work="${esc(pl.name + '板块')}">设目的地</button>
        </li>`).join('')}</ul>`);
      }
      pop.innerHTML = sections.join('') || `<div class="omni-sec">未匹配到「${esc(q)}」，试试 汉京、春笋、星河WORLD、天安云谷、壹方城</div>`;
      pop.hidden = false;
    }

    function syncTopbar() {
      const hub = $('#commute-hub');
      const wp = $('#work-pill');
      const sBox = $('#search-box');
      const sWrap = $('#search-wrap');
      const curWork = evalResult.dest1?.name || '';
      if (evalResult.dest1) {
        hub.hidden = false;
        sBox.classList.remove('needs-dest');
        sWrap.classList.add('compact');
        $('#omni-input').placeholder = '切换目的地或搜片区…';
        wp.innerHTML = `<span class="dot">★</span><span>去往 · ${esc(shortDestName(curWork))}</span><button type="button" data-clear-work title="清除目的地">×</button>`;
        if (curWork !== prevWorkName) {
          hub.classList.remove('just-unlocked');
          void hub.offsetWidth;
          hub.classList.add('just-unlocked');
        }
      } else {
        hub.hidden = true;
        hub.classList.remove('just-unlocked');
        sBox.classList.add('needs-dest');
        sWrap.classList.remove('compact');
        $('#omni-input').placeholder = '① 先设目的地（园区 / 商圈 / 地铁 / 小区）…';
      }
      prevWorkName = curWork;

      $('#budget-input').value = state.budget || '';
      $('#limit-range').value = state.limit;
      $('#limit-readout').textContent = `${state.limit}分`;
      $('#work2-input').value = state.work2;
      $('#limit2-input').value = state.limit2 || '';
      $('#sqm-input').value = state.sqm || '';
      $$('#sqm-chips [data-sqm-quick]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.sqmQuick) === (state.sqm || 0))));

      // 合并「居住要求」单按钮动态摘要（如：40㎡ · ≤3500 ▾）
      const reqSummary = [];
      if (state.sqm > 0) reqSummary.push(`${state.sqm}㎡`);
      if (state.budget > 0) reqSummary.push(`≤¥${state.budget}`);
      if (state.work2) reqSummary.push(`备选:${shortDestName(state.work2)}`);
      const extraCount = [
        state.sqm > 0, state.budget > 0, state.macroOpen, !!state.work2, state.limit2 > 0,
      ].filter(Boolean).length;
      $('#req-btn-label').textContent = reqSummary.length ? `${reqSummary.slice(0, 2).join(' · ')} ▾` : '居住要求 ▾';
      const badge = $('#extra-badge');
      badge.hidden = !extraCount || reqSummary.length > 0;
      badge.textContent = String(extraCount);
      $('#req-btn').classList.toggle('active', extraCount > 0);
      $('#macro-toggle-btn').setAttribute('aria-pressed', String(state.macroOpen));
      $('#watchlist-btn').setAttribute('aria-pressed', String(state.watchlistOpen));

      $$('#mode-seg [data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode)));
      $$('#peak-seg [data-peak]').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.peak === '1') === !!state.peak)));
      const isAffTrack = state.housingTrack === 'affordable';
      $$('#track-seg [data-track]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.track === state.housingTrack)));
      const L = state.layers || {};
      $('#layer-dock').hidden = isAffTrack;
      $('#aff-dock').hidden = !isAffTrack;
      if (!isAffTrack) {
        $$('#layer-dock [data-layer]').forEach(b => {
          const k = b.dataset.layer;
          b.setAttribute('aria-pressed', String(!!L[k]));
          b.classList.toggle('is-fill', !state.macroOpen && state.fillLayer === k && !!L[k]);
        });
      } else {
        const all = evalResult.affordableRows || [];
        const cAct = all.filter(r => r.project.phase === 'active').length;
        const cRec = all.filter(r => r.project.phase === 'recent').length;
        const cUp = all.filter(r => r.project.phase === 'upcoming').length;
        $('#aff-dock').innerHTML = [
          ['', `全部(${all.length})`],
          ['active', `申请中(${cAct})`],
          ['recent', `往期(${cRec})`],
          ['upcoming', `在建(${cUp})`],
        ].map(([k, l]) => `<button type="button" data-aff-filter="${k}" aria-pressed="${state.affFilter === k}">${l}</button>`).join('') +
          `<span class="dock-sep" aria-hidden="true"></span>` +
          `<button type="button" data-layer="commute" aria-pressed="${!!L.commute}" class="${state.fillLayer === 'commute' && L.commute ? 'is-fill' : ''}"><i class="ld-dot"></i>叠看通勤</button>`;
      }
      renderMapFilterPanel();
    }

    function renderMapFilterPanel() {
      const L = state.layers || {};
      const mf = state.mapFilter || { hub: true, mall: true, transit: true, terrain: true, neutralEvents: true, majorAlerts: true };
      const hiddenCount = ['hub', 'mall', 'transit', 'terrain', 'neutralEvents', 'majorAlerts'].filter(k => mf[k] === false).length;
      const overlayCount = (L.facilities ? 1 : 0) + (L.risks ? 1 : 0);
      const badge = $('#map-filter-badge');
      const btn = $('#map-filter-btn');
      if (hiddenCount === 6 && !overlayCount) {
        badge.textContent = '极简';
        badge.hidden = false;
        btn.classList.add('active');
      } else if (hiddenCount || overlayCount) {
        const parts = [];
        if (hiddenCount) parts.push(`藏${hiddenCount}`);
        if (overlayCount) parts.push(`+${overlayCount}`);
        badge.textContent = parts.join(' ');
        badge.hidden = false;
        btn.classList.add('active');
      } else {
        badge.hidden = true;
        btn.classList.remove('active');
      }

      const facSub = L.facilities
        ? `<div class="mf-sub"><button type="button" data-fac-filter="" aria-pressed="${!state.facFilter}">全部配套</button>` +
          Object.entries(FAC_CAT).map(([k, l]) => `<button type="button" data-fac-filter="${k}" aria-pressed="${state.facFilter === k}">${l}</button>`).join('') + `</div>`
        : '';
      const riskSub = L.risks
        ? `<div class="mf-sub"><button type="button" data-risk-filter="" aria-pressed="${!state.riskFilter}">全部避坑</button>` +
          Object.entries(evIcons.EVENT_TYPES).map(([k, info]) => `<button type="button" data-risk-filter="${k}" aria-pressed="${state.riskFilter === k}">${evIcons.eventIconSvg(k)}${esc(info.label)}</button>`).join('') + `</div>`
        : '';

      $('#map-filter-pop').innerHTML = `
        <div class="mf-head">
          <strong>地图标点与事件筛选</strong>
          <div class="mf-presets">
            <button type="button" data-map-preset="minimal">极简只看片区</button>
            <button type="button" data-map-preset="default">恢复默认</button>
          </div>
        </div>
        <div class="mf-sec">
          <div class="mf-sec-title"><span>地图物体（中立参照）</span><span>点击开关</span></div>
          <div class="mf-chips">
            <button type="button" class="mf-chip" data-map-filter="hub" aria-pressed="${mf.hub !== false}">◆ 办公园区</button>
            <button type="button" class="mf-chip" data-map-filter="mall" aria-pressed="${mf.mall !== false}">◆ 商圈商场</button>
            <button type="button" class="mf-chip" data-map-filter="transit" aria-pressed="${mf.transit !== false}">◆ 交通枢纽</button>
            <button type="button" class="mf-chip" data-map-filter="terrain" aria-pressed="${mf.terrain !== false}">山体与水库</button>
          </div>
        </div>
        <div class="mf-sec">
          <div class="mf-sec-title"><span>地图事件（按性质筛选）</span><span>异动 / 中立 / 利好 / 避坑</span></div>
          <div class="mf-chips">
            <button type="button" class="mf-chip is-risk" data-map-filter="majorAlerts" aria-pressed="${mf.majorAlerts !== false}">! 重要异动提醒</button>
            <button type="button" class="mf-chip" data-map-filter="neutralEvents" aria-pressed="${mf.neutralEvents !== false}">中立外迁与参照线</button>
            <button type="button" class="mf-chip" data-layer="facilities" aria-pressed="${!!L.facilities}">利好配套点位</button>
            <button type="button" class="mf-chip is-risk" data-layer="risks" aria-pressed="${!!L.risks}">避坑警示事件</button>
          </div>
          ${facSub}${riskSub}
        </div>
      `;
    }

    function renderSubPills() {
      const row = $('#sub-pill-row');
      const L = state.layers || {};
      if (state.macroOpen) {
        const items = [['community', '小区'], ['apartment', '公寓'], ['village', '城中村'], ['listing', '挂牌'], ['ref2022', '2022参考'], ['density', '人口密度']];
        row.innerHTML = items.map(([k, l]) => `<button type="button" data-macro="${k}" aria-pressed="${state.macroMetric === k}">${l}</button>`).join('') +
          `<button type="button" data-close-macro>↩ 返回片区地图</button>`;
        row.hidden = false;
      } else if (state.housingTrack === 'affordable') {
        row.innerHTML = '';
        row.hidden = true;
      } else {
        const groups = [];
        if (L.commute) {
          groups.push(evalResult.dest1
            ? `<button type="button" data-layout="geo" aria-pressed="${state.layout === 'geo'}">地图</button><button type="button" data-layout="radial" aria-pressed="${state.layout === 'radial'}">通勤时间圈</button>`
            : `<button type="button" data-prompt-work>点击先设通勤目的地</button>`);
        }
        if (L.trend) {
          groups.push(`<button type="button" data-trend-kind="yoy" aria-pressed="${state.trendKind === 'yoy'}">近一年(同比)</button><button type="button" data-trend-kind="mom" aria-pressed="${state.trendKind === 'mom'}">近一月(环比)</button>`);
        }
        if (L.premium && !evalResult.dest1) {
          groups.push(`<button type="button" data-prompt-work>设目的地后标出偏贵园区圈</button>`);
        }
        row.innerHTML = groups.join('<span class="sub-sep"></span>');
        row.hidden = groups.length === 0;
      }

      // 右下角旧浮条已收编进「标点与事件」统一面板，保持界面干净不散落
      const ovRow = $('#overlay-filter-row');
      if (ovRow) ovRow.hidden = true;
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
      if (row.premium?.status === 'premium') sigHtml = `<span class="sig-pill sig-prem">↑ 高溢价 ¥${Math.round(row.premium.extra)}/月</span>`;
      else if (row.arbitrage.status === 'opportunity') sigHtml = `<span class="sig-pill sig-opp">↘ 可捡漏</span>`;
      else if (row.premium?.status === 'direct') sigHtml = `<span class="sig-pill sig-walk">◆ 步行可达</span>`;
      if (row.mastery?.visited) sigHtml += `<span class="sig-pill sig-opp">✓ 已看房${row.mastery.avgStar ? ' ' + row.mastery.avgStar + '★' : ''}</span>`;

      // 仅在至少有 2 个真实维度可计分时才展示匹配度，避免「14–89分」这类过宽的无意义区间
      const fitBadge = row.fit.count >= 2
        ? `<button type="button" class="fit-pill${row.fit.premiumPenalty ? ' has-pen' : ''}" data-toggle-fit title="查看四项评分明细">匹配度 ${esc(row.fit.rangeText)}${row.fit.premiumPenalty ? ' (−' + row.fit.premiumPenalty + ')' : ''}</button>`
        : '';
      const fitBreakdown = fitExpanded && row.fit.count
        ? `<div class="fit-detail-box"><strong>匹配度拆解</strong><ul>${engine.FIT_KEYS.map(k => {
          const d = row.fit.dimensions[k];
          return `<li>${esc(engine.FIT_NAMES[k])}：<strong>${d.score == null ? '待看房' : Math.round(d.score) + '分'}</strong> · ${esc(d.why)}</li>`;
        }).join('')}</ul></div>`
        : '';

      const deltaHtml = evalResult.refRow && !isRef && row.refDeltas.length
        ? `<div class="delta-row"><span class="sub-note" style="margin:0;align-self:center">比「${esc(evalResult.refRow.plate.name)}」</span>${row.refDeltas.map(d => `<span class="delta-chip ${d.better ? 'better' : 'worse'}">${esc(d.text)}</span>`).join('')}</div>`
        : '';

      // 重要动态提醒卡（租金暴涨/大跌、新线通车、大厂迁入迁出等）
      const majorAlertHtml = row.alerts?.length
        ? `<div class="alert-card ${row.alerts[0].level === 'surge' ? 'is-prem' : row.alerts[0].level === 'drop' ? 'is-opp' : 'is-ev'}">
            <div class="alert-head"><span>! 重要动态提醒（${row.alerts.length}）</span></div>
            <ul class="alert-ul">${row.alerts.map(a => `<li>
              <div class="alert-row"><span class="a-dot a-${a.level}">!</span><strong>${esc(a.title)}</strong>${a.date ? `<span class="micro-tag">${esc(a.date)}</span>` : ''}</div>
              ${a.detail ? `<p class="sub-note" style="margin:2px 0 0 18px">${esc(a.detail)} ${lnk(a.source, a.sourceLabel || '来源')}</p>` : ''}
            </li>`).join('')}</ul>
          </div>`
        : '';

      // 高溢价卡（包含：他园 15 分钟步行圈办公溢价 + 全城同程贵出 ≥20% 高溢价！）
      let premHtml = '';
      const pr = row.premium;
      if (pr && ((pr.status === 'premium') || (pr.hub && pr.status !== 'direct' && pr.status !== 'no-hub' && pr.status !== 'no-work'))) {
        const isPrem = pr.status === 'premium';
        const isPeer = pr.kind === 'peer';
        const title = isPrem
          ? (isPeer
              ? `↑ 同程高溢价约 ¥${Math.round(pr.extra)}/月（高出同程 +${pr.pct}%）`
              : `↑ 他园高溢价约 ¥${Math.round(pr.extra)}/月（+${pr.extraUnit}元/㎡）`)
          : pr.status === 'used' ? `✓ 常去「${pr.hub.name}」（免扣分）`
          : `近「${pr.hub.name}」步行 ${pr.hub.walk}分 · ${pr.status === 'no-extra' ? '未见多付' : '差额待核'}`;
        const alts = pr.alternatives?.length
          ? `<ul class="alt-list">${pr.alternatives.map(a => `<li><button type="button" data-pick-plate="${esc(a.id)}">→ ${esc(a.name)}片区</button><span>${a.unitPrice}元/㎡ · ${a.minutes}分</span></li>`).join('')}</ul>`
          : '';
        const hubToggleBtn = pr.hub && !isPeer
          ? `<div style="margin-top:6px"><button type="button" class="btn-ghost" data-toggle-hub="${esc(pr.hub.name)}" aria-pressed="${pr.status === 'used'}">${pr.status === 'used' ? '取消常去' : '我常去「' + esc(pr.hub.name) + '」'}</button></div>`
          : '';
        premHtml = `<div class="alert-card${isPrem ? ' is-prem' : ''}">
          <div class="alert-head"><span>${esc(title)}</span></div>
          <p class="sub-note">${esc(pr.reason)}</p>${alts}${hubToggleBtn}
        </div>`;
      }

      // 捡漏/谈价线索（精简保留）与 折叠版「关联事件与政策」（默认收起，只显示关键词，展开后直接点链接看原文）
      const reasonCard = row.arbitrage.reasons.length
        ? `<div class="alert-card is-opp"><div class="alert-head"><span>↘ 捡漏 / 谈价线索</span></div>${row.arbitrage.reasons.map(r => `<p class="sub-note" style="color:var(--fg)">• ${esc(r)}</p>`).join('')}</div>`
        : '';
      const evPolCount = row.events.length + row.policies.length;
      let evPolFold = '';
      if (evPolCount) {
        const kwPills = [
          ...row.events.map(ev => ev.signalLabel?.split('·')[0]?.trim() || ev.type),
          ...row.policies.map(pol => pol.title.replace(/配租|认租|政策/g, '').slice(0, 8)),
        ].filter(Boolean).slice(0, 2).map(k => `<span class="micro-tag">${esc(k)}</span>`).join('');
        const foldItems = [
          ...row.events.map(ev => `<li><span class="fold-main"><strong>${esc(ev.title)}</strong><span class="micro-tag">${esc(ev.date)}</span></span><span class="fold-act">${lnk(ev.source, '原文')}</span></li>`),
          ...row.policies.map(pol => `<li><span class="fold-main"><strong>${esc(pol.title)}</strong><span class="micro-tag">${esc(pol.status)}</span></span><span class="fold-act">${lnk(pol.source, '公告')}</span></li>`),
        ].join('');
        evPolFold = `<details class="drawer-fold">
          <summary><span class="fold-title">关联事件与政策 (${evPolCount})</span><span class="fold-tags">${kwPills}</span></summary>
          <ul class="fold-list">${foldItems}</ul>
        </details>`;
      }

      // 市场房（民房/老小区/电梯小区/商业公寓）与 政府保租房 严格分开列示！
      const marketRents = row.rentsMatched.filter(r => r.grain !== 'official_affordable');
      const affRents = row.rentsMatched.filter(r => r.grain === 'official_affordable');
      const primaryType = marketRents[0]?.type;
      const utilHint = atlas.housingTypeMeta[primaryType]?.utility?.split('（')[0] || '';
      const rentHtml = marketRents.length
        ? `<div class="sec-head"><h3>市场房参考月租（民房 / 小区 / 公寓）</h3>${utilHint ? `<span class="sec-hint">${esc(utilHint)}</span>` : ''}</div>
          <ul class="rent-list">${marketRents.slice(0, 8).map(r => {
            const tLabel = atlas.housingTypeMeta[r.type]?.label || '综合';
            const priceStr = r.low === r.high ? money(r.median) : `${money(r.low)}–${money(r.high)}`;
            const cntTag = r.count > 1 ? ` · ${r.count}条汇总` : '';
            return `<li><div class="rent-line"><span><strong>${esc(tLabel)} · ${ROOM_LABEL[r.room] || r.room + '室'}</strong><span class="micro-tag">${esc(engine.GRAIN_LABELS[r.grain] || r.grain)}</span></span><span class="rent-price">${esc(priceStr)}</span></div>
              <p class="sub-note" title="${esc(r.sourceName || '')}">${r.sqm ? `${r.sqm[0]}${r.sqm[1] !== r.sqm[0] ? '–' + r.sqm[1] : ''}㎡ · ` : ''}${esc(r.period)}${cntTag} · ${lnk(r.source, '来源') || esc(r.sourceName)}</p></li>`;
          }).join('')}</ul>`
        : '';

      // 多信源交叉对照（万科泊寓 / 龙湖冠寓 / 自如 / 魔方 / 微棠 / 贝壳·乐有家公开数据）+ 一键核对当日实盘
      const multiList = pl.multiSourceRents || [];
      const multiHtml = multiList.length
        ? `<div class="sec-head"><h3>多平台对照（品牌公寓 / 贝壳·乐有家）</h3><span class="sec-hint">跨平台交叉核价</span></div>
          <ul class="rent-list">${multiList.map(m => {
            const priceStr = m.low === m.high ? money(m.median) : `${money(m.low)}–${money(m.high)}`;
            return `<li><div class="rent-line"><span><strong>${esc(m.store)}</strong><span class="brand-badge">${esc(m.brand)}</span></span><span class="rent-price">${esc(priceStr)}</span></div>
              <p class="sub-note">${m.sqm ? `${m.sqm[0]}–${m.sqm[1]}㎡ · ` : ''}${ROOM_LABEL[m.room] || m.room + '室'} · ${esc(m.period)} · ${lnk(m.source, m.brand)}</p>
              <p class="sub-note">${esc(m.utility)}</p></li>`;
          }).join('')}</ul>`
        : '';

      const liveKw = pl.name.split('·')[0].replace(/中心$/, '') || pl.streetName.replace(/街道$/, '');
      const liveEnc = encodeURIComponent(liveKw);
      const liveLinksHtml = `<div class="sec-head"><h3>去看今日在租实盘（${esc(liveKw)}）</h3><span class="sec-hint">直达官方实盘</span></div>
        <div class="live-links">
          <a class="live-link-pill" href="https://sz.zu.ke.com/zufang/rs${liveEnc}/" target="_blank" rel="noopener noreferrer">贝壳找房↗</a>
          <a class="live-link-pill" href="https://sz.ziroom.com/z/?qwd=${liveEnc}" target="_blank" rel="noopener noreferrer">自如↗</a>
          <a class="live-link-pill" href="https://shenzhen.leyoujia.com/zf/?n=${liveEnc}" target="_blank" rel="noopener noreferrer">乐有家↗</a>
          <a class="live-link-pill" href="https://www.inboyu.com/" target="_blank" rel="noopener noreferrer">万科泊寓↗</a>
        </div>`;

      const marketChildRows = row.childRows.filter(cr => cr.place.kind !== '官方保租房');
      const estatesHtml = marketChildRows.length
        ? `<div class="sec-head"><h3>片区内民房、小区与公寓 (${marketChildRows.length})</h3></div>
          <ul class="estate-list">${marketChildRows.map(cr => {
            const pTxt = cr.rent ? (cr.rent.low === cr.rent.high ? money(cr.rent.median) : `${money(cr.rent.low)}–${money(cr.rent.high)}`) : '';
            return `<li><button type="button" data-open-place="${esc(cr.place.id)}">${esc(cr.place.shortName)} <span class="micro-tag">${esc(cr.place.kind)}</span></button><span class="meta">${[pTxt, cr.route ? cr.route.minutes + '分' : ''].filter(Boolean).join(' · ')}</span></li>`;
          }).join('')}</ul>`
        : '';

      const nearFacHtml = row.nearbyFacs.length
        ? `<div class="sec-head"><h3>周边配套</h3></div><ul class="clean-list">${row.nearbyFacs.map(f =>
          `<li><strong>${esc(f.name)}</strong><span class="micro-tag">${esc(FAC_CAT[f.category] || f.category)} · ${fmtDist(f.meters)}</span> <span class="sub-note">${lnk(f.source, '政府')} ${lnk(f.osmUrl, '地图')}</span></li>`
        ).join('')}</ul>`
        : '';

      const riskHtml = row.risks.length
        ? `<div class="sec-head"><h3>周边避坑提醒</h3></div><ul class="clean-list">${row.risks.map(rk => {
          const rt = evIcons.eventTypeFor(rk);
          return `<li>${evIcons.eventIconSvg(rt)} <strong>${esc(rk.name)}</strong>（${esc(rk.observed)}）<p class="sub-note">${esc(rk.check)} ${lnk(rk.url, rk.source)}</p></li>`;
        }).join('')}</ul>`
        : '';

      const starOpts = v => `<option value="">未评</option>` + [1, 2, 3, 4, 5].map(n => `<option value="${n}"${v === n ? ' selected' : ''}>${n}星</option>`).join('');
      const hasNote = !!(entry?.monthly || entry?.environment || entry?.convenience || entry?.note);
      const noteDisplay = hasNote && !noteFormOpen
        ? `<div class="sec-head"><h3>我的看房笔记</h3><button type="button" class="link-btn" data-toggle-note>编辑</button></div>
          <p class="sub-note" style="color:var(--fg)">${[entry.monthly ? '实谈 ' + money(entry.monthly) : '', entry.environment ? '环境' + entry.environment + '星' : '', entry.convenience ? '便利' + entry.convenience + '星' : '', entry.note || ''].filter(Boolean).join(' · ')}</p>`
        : '';
      const noteFormHtml = noteFormOpen
        ? `<form id="place-note-form" class="note-form" data-note-id="${esc(pl.id)}" data-note-name="${esc(pl.name + '片区')}">
            <label>实谈月租（元）<input name="monthly" type="number" min="100" max="100000" value="${entry?.monthly ?? ''}" placeholder="看房谈下的真实月租"></label>
            <div class="note-form-2">
              <label>环境<select name="environment">${starOpts(entry?.environment)}</select></label>
              <label>便利<select name="convenience">${starOpts(entry?.convenience)}</select></label>
            </div>
            <label>看房笔记<textarea name="note" rows="2" placeholder="噪音、采光、水电、步行实测…">${esc(entry?.note || '')}</textarea></label>
            <div class="drawer-actions" style="margin:0"><button type="submit" class="btn-primary">保存</button><button type="button" class="btn-ghost" data-toggle-note>取消</button></div>
          </form>`
        : '';

      const commPart = evalResult.dest1
        ? (row.route ? `<span class="vital-item"><strong>${row.route.minutes}分</strong><small class="sub-note" style="margin:0">${esc(row.route.label)} ${lnk(navUrl, '高德')}</small></span>` : `<span class="vital-item">暂无数据</span>`)
        : `<span class="vital-item"><button type="button" class="link-btn" data-prompt-work>设目的地算通勤</button></span>`;
      const peakNote = row.route?.peakDetail ? `<p class="sub-note" style="margin:-4px 0 8px;color:var(--warm)">⏱ ${esc(row.route.peakDetail)}</p>` : '';
      const comm2Note = evalResult.dest2 && row.route2 ? `<p class="sub-note" style="margin:-4px 0 8px">备选工作地 ${esc(evalResult.dest2.name)}：<strong>${row.route2.minutes} 分钟</strong></p>` : '';
      const densityNote = pl.streetDensity != null
        ? `<p class="sub-note" style="margin:-4px 0 8px">${esc(pl.streetName)}人口密度：<strong>${(pl.streetDensity / 10000).toFixed(2)}万/km²</strong>（2020七普常住 ${(pl.streetPop / 10000).toFixed(1)}万人 / 陆地 ${pl.streetAreaKm2}km²${pl.clipId ? ' · 同街道片区共用街道口径' : ''}）</p>`
        : '';

      const affInPlateHtml = (row.affordable?.length || affRents.length)
        ? `<div class="sec-head"><h3>政府保租房（与市场房分开列示）</h3><button type="button" class="link-btn" data-track="affordable">去保租房专场 →</button></div>` +
          (row.affordable?.length
            ? `<ul class="estate-list">${row.affordable.map(ar => {
                const p = ar.project;
                const pMeta = ar.estMonthly ? `约${money(ar.estMonthly)}/月` : p.unitPrice ? `${p.unitPrice}元/㎡` : p.unitsText;
                return `<li><button type="button" data-aff="${esc(p.id)}">${esc(p.shortName)} <span class="micro-tag">${esc(p.phaseLabel)}</span></button><span class="meta">${esc(pMeta)}</span></li>`;
              }).join('')}</ul>`
            : '') +
          (affRents.length
            ? `<ul class="rent-list">${affRents.slice(0, 4).map(r => {
                const priceStr = r.low === r.high ? money(r.median) : `${money(r.low)}–${money(r.high)}`;
                return `<li><div class="rent-line"><span><strong>政府保租房 · ${ROOM_LABEL[r.room] || r.room + '室'}</strong><span class="micro-tag">官方保租</span></span><span class="rent-price">${esc(priceStr)}</span></div>
                  <p class="sub-note">${r.sqm ? `${r.sqm[0]}${r.sqm[1] !== r.sqm[0] ? '–' + r.sqm[1] : ''}㎡ · ` : ''}${esc(r.period)} · ${lnk(r.source, '公告') || esc(r.sourceName)}</p></li>`;
              }).join('')}</ul>`
            : '')
        : '';

      const priceVital = row.estMonthly
        ? `<span class="vital-item" title="${esc(pl.unitBasis)}"><strong>约${money(row.estMonthly)}/月</strong><small class="sub-note" style="margin:0">${pl.unitPrice}元/㎡ × ${state.sqm}㎡</small></span>`
        : `<span class="vital-item" title="${esc(pl.unitBasis)}"><strong>${pl.unitPrice}元/㎡</strong><small class="sub-note" style="margin:0">${esc(pl.unitBasis)}</small></span>`;

      return `<div class="drawer-head">
          <p class="drawer-kicker">${esc([pl.district, pl.streetName, pl.station ? pl.station + '站' : ''].filter(Boolean).join(' · '))}</p>
          <button type="button" class="drawer-close" data-close-drawer title="收起">×</button>
        </div>
        <div class="drawer-title-row"><h2>${esc(pl.name)}</h2>${fitBadge}</div>
        ${pl.tag ? `<p class="sub-note" style="margin:0 0 8px">${esc(pl.tag)}</p>` : ''}
        ${fitBreakdown}
        ${row.exclusions.length ? `<p class="sub-note" style="color:var(--warm);margin:0 0 6px">当前筛选外：${esc(row.exclusions.join('、'))}</p>` : ''}
        <div class="vital-strip">${commPart}<span class="vital-sep">|</span>${priceVital}${sigHtml}</div>
        ${peakNote}${comm2Note}${densityNote}${deltaHtml}
        <div class="drawer-actions">
          ${isCurDest(pl.name, pl.name + '板块')
            ? `<button type="button" class="btn-dest is-current" data-clear-work title="点击取消目的地">★ 当前目的地 ×</button>`
            : `<button type="button" class="btn-dest" data-set-work="${esc(pl.name + '板块')}">★ 设为目的地</button>`}
          <button type="button" class="${saved ? 'btn-primary' : 'btn-ghost'}" data-toggle-save="${esc(pl.id)}" data-save-name="${esc(pl.name + '片区')}">${saved ? '★ 已收藏' : '☆ 收藏'}</button>
          <button type="button" class="btn-ghost" data-toggle-ref="${esc(pl.id)}" aria-pressed="${isRef}">${isRef ? '⇄ 对比中' : '⇄ 设为对比'}</button>
          <button type="button" class="btn-ghost" data-toggle-note aria-pressed="${noteFormOpen}">✎ 看房笔记</button>
        </div>
        ${noteFormHtml}${noteDisplay}${majorAlertHtml}${premHtml}${reasonCard}${multiHtml}${liveLinksHtml}${rentHtml}${estatesHtml}${affInPlateHtml}${evPolFold}${nearFacHtml}${riskHtml}`;
    }

    // 片区内具体小区 / 村落 / 保租房详情卡
    function renderEstateCard(cr) {
      const p = cr.place, entry = cr.entry;
      const parentPlate = engine.plateById.get(p.plateId);
      const saved = store.isSaved(p.id);
      const rents = cr.rentsMatched.length ? cr.rentsMatched : (p.rents || []);
      const firstR = rents[0];
      const rentVal = firstR ? (firstR.low === firstR.high ? money(firstR.median) : `${money(firstR.low)}–${money(firstR.high)}`) : '暂无数据';
      const starOpts = v => `<option value="">未评</option>` + [1, 2, 3, 4, 5].map(n => `<option value="${n}"${v === n ? ' selected' : ''}>${n}星</option>`).join('');
      const hasNote = !!(entry?.monthly || entry?.environment || entry?.convenience || entry?.note);
      const noteFormHtml = noteFormOpen
        ? `<form id="place-note-form" class="note-form" data-note-id="${esc(p.id)}" data-note-name="${esc(p.name)}">
            <label>实谈月租（元）<input name="monthly" type="number" min="100" max="100000" value="${entry?.monthly ?? ''}" placeholder="看房谈下的真实月租"></label>
            <div class="note-form-2"><label>环境<select name="environment">${starOpts(entry?.environment)}</select></label><label>便利<select name="convenience">${starOpts(entry?.convenience)}</select></label></div>
            <label>看房笔记<textarea name="note" rows="2">${esc(entry?.note || '')}</textarea></label>
            <div class="drawer-actions" style="margin:0"><button type="submit" class="btn-primary">保存</button><button type="button" class="btn-ghost" data-toggle-note>取消</button></div>
          </form>`
        : (hasNote ? `<p class="sub-note" style="color:var(--fg);margin:6px 0">我的看房笔记：${[entry.monthly ? '实谈' + money(entry.monthly) : '', entry.environment ? '环境' + entry.environment + '星' : '', entry.convenience ? '便利' + entry.convenience + '星' : '', entry.note || ''].filter(Boolean).join(' · ')}</p>` : '');

      return `<div class="drawer-head">
          <p class="drawer-kicker">${parentPlate ? `<button type="button" class="link-btn" data-back-plate="${esc(parentPlate.id)}">← 返回 ${esc(parentPlate.name)}片区</button>` : esc(p.streetName)}</p>
          <button type="button" class="drawer-close" data-close-drawer>×</button>
        </div>
        <div class="drawer-title-row"><h2>${esc(p.shortName)}</h2><span class="micro-tag">${esc(p.kind)}</span></div>
        <div class="vital-strip">
          <span class="vital-item"><strong>${cr.route ? cr.route.minutes + '分' : '未设目的地'}</strong>${cr.route ? `<small class="sub-note" style="margin:0">${esc(cr.route.label)}</small>` : ''}</span>
          <span class="vital-sep">|</span>
          <span class="vital-item"><strong>${esc(rentVal)}</strong></span>
        </div>
        <div class="drawer-actions">
          ${isCurDest(p.shortName, p.name)
            ? `<button type="button" class="btn-dest is-current" data-clear-work title="点击取消目的地">★ 当前目的地 ×</button>`
            : `<button type="button" class="btn-dest" data-set-work="${esc(p.shortName)}">★ 设为目的地</button>`}
          <button type="button" class="${saved ? 'btn-primary' : 'btn-ghost'}" data-toggle-save="${esc(p.id)}" data-save-name="${esc(p.name)}">${saved ? '★ 已收藏' : '☆ 收藏'}</button>
          <button type="button" class="btn-ghost" data-toggle-note aria-pressed="${noteFormOpen}">✎ 看房笔记</button>
        </div>
        ${noteFormHtml}
        <div class="sec-head"><h3>参考月租</h3></div>
        <ul class="rent-list">${rents.slice(0, 6).map(r => `<li>
          <div class="rent-line"><span><strong>${esc(r.grain === 'official_affordable' ? '保租房' : (atlas.housingTypeMeta[r.type]?.label || '综合'))} · ${ROOM_LABEL[r.room] || r.room + '室'}</strong><span class="micro-tag">${esc(engine.GRAIN_LABELS[r.grain] || r.grain)}</span></span><span class="rent-price">${esc(r.low === r.high ? money(r.median) : money(r.low) + '–' + money(r.high))}</span></div>
          <p class="sub-note" title="${esc(r.sourceName || '')}">${r.sqm ? `${r.sqm[0]}${r.sqm[1] !== r.sqm[0] ? '–' + r.sqm[1] : ''}㎡ · ` : ''}${esc(r.period)} · ${lnk(r.source, '来源') || esc(r.sourceName)}</p>
        </li>`).join('')}</ul>
        ${cr.nearbyFacs.length ? `<div class="sec-head"><h3>周边配套</h3></div><ul class="clean-list">${cr.nearbyFacs.map(f => `<li><strong>${esc(f.name)}</strong><span class="micro-tag">${esc(FAC_CAT[f.category] || f.category)} · ${fmtDist(f.meters)}</span> <span class="sub-note">${lnk(f.source, '政府')} ${lnk(f.osmUrl, '地图')}</span></li>`).join('')}</ul>` : ''}
        ${p.watchouts.length || cr.risks.length ? `<div class="sec-head"><h3>看房提醒</h3></div><ul class="clean-list">${p.watchouts.map(w => `<li>⚠️ ${esc(w)}</li>`).join('')}${cr.risks.map(rk => `<li>${evIcons.eventIconSvg(evIcons.eventTypeFor(rk))} <strong>${esc(rk.name)}</strong><p class="sub-note">${esc(rk.check)} ${lnk(rk.url, rk.source)}</p></li>`).join('')}</ul>` : ''}`;
    }

    function renderDrawer() {
      const el = $('#detail-drawer'), stage = $('#stage');
      let html = '';

      if (state.selectedAffId) {
        const ar = evalResult.affRowById?.get(state.selectedAffId);
        if (ar) {
          const p = ar.project;
          const parentPl = engine.plateById.get(p.plateId);
          const phaseCls = p.phase === 'active' ? 'sig-opp' : p.phase === 'upcoming' ? 'sig-walk' : '';
          const priceStr = ar.estMonthly
            ? `<strong>约${money(ar.estMonthly)}/月</strong><small class="sub-note" style="margin:0">${p.unitPrice}元/㎡ × ${state.sqm}㎡</small>`
            : p.unitPrice
              ? `<strong>${p.unitPrice}元/㎡</strong><small class="sub-note" style="margin:0">官方基准价</small>`
              : `<strong>待定/按60%定价</strong><small class="sub-note" style="margin:0">详见批次通告</small>`;
          const commStr = ar.route
            ? `<strong>${ar.route.minutes}分</strong><small class="sub-note" style="margin:0">${esc(ar.route.label)}</small>`
            : `<button type="button" class="link-btn" data-prompt-work>设目的地算通勤</button>`;
          html = `<div class="drawer-head">
              <p class="drawer-kicker">${esc(p.district)} · 保租房 / 保障性住房 · ${esc(p.station)}站</p>
              <button type="button" class="drawer-close" data-close-drawer>×</button>
            </div>
            <div class="drawer-title-row"><h2>${esc(p.name)}</h2><span class="sig-pill ${phaseCls}">${esc(p.phaseLabel)}</span></div>
            <div class="vital-strip">
              <span class="vital-item">${commStr}</span><span class="vital-sep">|</span>
              <span class="vital-item">${priceStr}</span><span class="vital-sep">|</span>
              <span class="vital-item"><strong>${esc(p.unitsText)}</strong></span>
            </div>
            <div class="drawer-actions">
              ${isCurDest(p.name)
                ? `<button type="button" class="btn-dest is-current" data-clear-work>★ 当前目的地 ×</button>`
                : `<button type="button" class="btn-dest" data-set-work="${esc(p.name)}">★ 设为目的地</button>`}
              ${parentPl ? `<button type="button" class="btn-ghost" data-pick-plate="${esc(parentPl.id)}">查看 ${esc(parentPl.name)}板块</button>` : ''}
            </div>
            <div class="alert-card${p.phase === 'active' ? ' is-opp' : ''}">
              <div class="alert-head"><span>申请对象：${esc(p.audience)}</span></div>
              <p class="sub-note" style="color:var(--fg)">${esc(p.audienceDetail)}</p>
              <p class="sub-note">时间节点：${esc(p.timeline)} · 户型：${esc(p.rooms)}</p>
            </div>
            <div class="sec-head"><h3>项目概况与市场影响</h3></div>
            <p style="margin:4px 0 8px;font-size:13px">${esc(p.summary)}</p>
            <div class="sec-head"><h3>准入与踩坑提醒</h3></div>
            <p class="sub-note" style="color:var(--fg)">⚠️ ${esc(p.watchout)}</p>
            <p class="sub-note" style="margin-top:8px">来源：${lnk(p.source, p.sourceName) || esc(p.sourceName)}</p>
            ${atlas.affordableCityPlan ? `<div class="alert-card" style="margin-top:12px"><div class="alert-head"><span>深圳 ${atlas.affordableCityPlan.year} 全市保租房计划</span></div><p class="sub-note">${esc(atlas.affordableCityPlan.summary)} ${lnk(atlas.affordableCityPlan.source, atlas.affordableCityPlan.sourceName)}</p></div>` : ''}`;
        }
      } else if (state.selectedLandmarkId) {
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
              ${isCurDest(lm.name)
                ? `<button type="button" class="btn-dest is-current" data-clear-work title="点击取消目的地">★ 当前目的地 ×</button>`
                : `<button type="button" class="btn-dest" data-set-work="${esc(lm.name)}">★ 设为通勤目的地</button>`}
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
            ${f.location?.gcj02 ? `<div class="drawer-actions" style="margin-top:10px">${isCurDest(f.name)
              ? `<button type="button" class="btn-dest is-current" data-clear-work>★ 当前目的地 ×</button>`
              : `<button type="button" class="btn-dest" data-set-work="${esc(f.name)}">★ 设为通勤目的地</button>`}</div>` : ''}
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
              <li>挂牌综合${listingPeriod}：<strong>${d.listingPrice ?? '—'} 元/㎡</strong>（同比 ${d.listingYoy ?? '—'}%）</li>
              <li>2022 参考：<strong>小区 ${d.refs2022?.[0] ?? '—'} / 公寓 ${d.refs2022?.[1] ?? '—'} / 村 ${d.refs2022?.[2] ?? '—'}</strong></li>
              <li>人口密度：<strong>${d.density.toLocaleString('zh-CN')} 人/km²</strong></li>
            </ul>
            <div class="drawer-actions"><button type="button" class="btn-primary" data-close-macro>返回片区地图</button></div>`;
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
        <tr><th>捡漏/避贵</th>${picks.map(x => `<td>${x.plateRow.premium?.status === 'premium' ? `<span class="sig-pill sig-prem">↑溢价¥${Math.round(x.plateRow.premium.extra)}</span>` : x.plateRow.arbitrage.status === 'opportunity' ? `<span class="sig-pill sig-opp">↘可捡漏</span>` : '—'}</td>`).join('')}</tr>
        <tr><th>我的实录</th>${picks.map(x => `<td>${[x.entry.monthly ? '实谈' + money(x.entry.monthly) : '', x.entry.environment ? '环境' + x.entry.environment + '星' : '', x.entry.convenience ? '便利' + x.entry.convenience + '星' : ''].filter(Boolean).join(' · ') || '未记'}${x.entry.note ? `<div class="sub-note">${esc(x.entry.note)}</div>` : ''}</td>`).join('')}</tr>
      </tbody></table></div>` : '';

      const listHtml = entries.length ? `<ul class="clean-list">${rows.map(({ entry, plateRow }) => `<li>
        <div class="rent-line"><strong>${esc(entry.name)}</strong><div>${plateRow ? `<button type="button" class="btn-ghost" data-jump-id="${esc(entry.id)}">地图查看</button> ` : ''}<button type="button" class="btn-ghost" data-toggle-save="${esc(entry.id)}" data-save-name="${esc(entry.name)}">${entry.saved ? '移除' : '重藏'}</button></div></div>
        <p class="sub-note">${[entry.monthly ? '实谈 ' + money(entry.monthly) : '', entry.environment ? '环境' + entry.environment + '星' : '', entry.convenience ? '便利' + entry.convenience + '星' : '', entry.observed || '', entry.note || ''].filter(Boolean).join(' · ') || '已收藏，看房后可补录实价与感受。'}</p>
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
      $('#explore-progress').textContent = `已看 ${state.seen.size}/${atlas.plates.length} 片区`;
      const L = state.layers || {};
      $('#match-summary').textContent = state.macroOpen
        ? `全城各区均价${state.macroMetric === 'listing' ? listingPeriod : ''}`
        : L.affordable && !L.rent && !L.commute
          ? `保租房 ${(evalResult.affordableRows || []).filter(r => !state.affFilter || r.project.phase === state.affFilter).length} 处`
          : `符合条件 ${evalResult.eligiblePlates.length} 处`;
      showToast(state.status);

      const isRadial = !!L.commute && state.layout === 'radial' && !!evalResult.dest1;
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
        selectedDistrict: '', selectedRiskId: '', selectedFacilityId: '', selectedAffId: '',
      });
    }

    function selectPlate(plateId, fitCamera = false) {
      const pl = engine.plateById.get(plateId);
      if (!pl) return;
      state.seen.add(plateId);
      fitExpanded = false; noteFormOpen = false;
      if (fitCamera) map.camera.fit(pl.bounds);
      store.patch({
        watchlistOpen: false, macroOpen: false,
        selectedPlateId: plateId, selectedPlaceId: '', selectedLandmarkId: '',
        selectedDistrict: '', selectedRiskId: '', selectedFacilityId: '', selectedAffId: '', status: '',
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
        watchlistOpen: false, macroOpen: false,
        selectedPlateId: p.plateId, selectedPlaceId: placeId, selectedLandmarkId: '',
        selectedDistrict: '', selectedRiskId: '', selectedFacilityId: '', selectedAffId: '', status: '',
      });
    }

    function applyDestination(destName) {
      const nextLayers = state.layers.commute ? state.layers : { ...state.layers, commute: true };
      store.patch({
        work: destName, layers: nextLayers, selectedLandmarkId: '',
        status: `已设目的地：${shortDestName(destName)} · 通勤时长已同步开启`,
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
      if (dest) { omni.value = ''; closePopovers(); applyDestination(dest.name); return; }
      const pl = atlas.plates.find(x => x.name.includes(q) || x.streetName.includes(q));
      if (pl) { omni.value = ''; closePopovers(); selectPlate(pl.id, true); return; }
      showToast(`未匹配到「${q}」`);
    };

    for (const [btnId, popId] of [['req-btn', 'req-pop'], ['help-btn', 'help-pop'], ['map-filter-btn', 'map-filter-pop']]) {
      $('#' + btnId).onclick = ev => {
        ev.stopPropagation();
        const pop = $('#' + popId);
        const willOpen = pop.hidden;
        closePopovers();
        pop.hidden = !willOpen;
        $('#' + btnId).setAttribute('aria-expanded', String(willOpen));
      };
    }

    // 图例内嵌「底色」选择器事件
    $('#map-legend').addEventListener('change', ev => {
      const sel = ev.target.closest('[data-fill-select]');
      if (sel) store.setFillLayer(sel.value);
    });

    $('#watchlist-btn').onclick = () => { closePopovers(); store.patch({ watchlistOpen: !state.watchlistOpen, status: '' }); };
    $('#budget-input').onchange = e => store.patch({ budget: Math.max(0, Number(e.target.value) || 0), status: '' });
    $('#limit-range').oninput = e => store.patch({ limit: Number(e.target.value), status: '' });
    $('#work2-input').onchange = e => {
      const raw = e.target.value.trim();
      if (!raw) { store.patch({ work2: '', status: '' }); return; }
      const r = engine.resolveDestination(raw);
      store.patch({ work2: r ? r.name : '', status: r ? `备选工作地：${r.name}` : '未匹配到该地点' });
    };
    $('#limit2-input').onchange = e => store.patch({ limit2: Math.max(0, Number(e.target.value) || 0), status: '' });
    $('#sqm-input').oninput = e => {
      const v = Math.max(0, Number(e.target.value) || 0);
      store.patch({ sqm: v, status: v > 0 ? `已按 ${v}㎡ 实时换算全图预估月租` : '已切回每平米参考均价' });
    };

    $('#reset-all').onclick = () => {
      map.camera.reset(); closePopovers();
      store.patch({
        budget: 0, room: '1', sqm: 0, mode: 'rail', peak: false, limit: 50, work2: '', limit2: 0,
        housingTypes: ['village', 'oldEstate', 'modernEstate', 'apartment'],
        macroOpen: false, affFilter: '', riskFilter: '', facFilter: '', referenceId: '',
        selectedPlateId: '', selectedPlaceId: '', selectedLandmarkId: '', selectedDistrict: '', selectedRiskId: '', selectedFacilityId: '', selectedAffId: '',
        status: '已重置居住要求',
      });
    };

    $('#btn-discover').onclick = () => {
      const next = engine.discoverNext(evalResult, state.seen);
      if (!next) { showToast('符合条件的片区已全部看过，可放宽条件'); return; }
      selectPlate(next.plate.id, true);
      const tips = [next.estMonthly ? `约${money(next.estMonthly)}/月` : `${next.plate.unitPrice}元/㎡`];
      if (evalResult.dest1 && next.route) tips.push(`${next.route.minutes}分可达`);
      if (next.arbitrage.status === 'opportunity') tips.push('↘ 可捡漏');
      showToast(`推荐 ${next.plate.name}片区 · ${tips.join(' · ')}`);
    };

    // 全局点击代理
    document.body.addEventListener('click', ev => {
      if (!ev.target.closest('.pop-anchor,.search-wrap')) closePopovers();

      const el = ev.target.closest('[data-track],[data-map-filter],[data-map-preset],[data-set-work],[data-set-work2],[data-clear-work],[data-prompt-work],[data-sqm-quick],[data-htype],[data-mode],[data-peak],[data-layer],[data-fill-layer],[data-trend-kind],[data-toggle-macro],[data-close-macro],[data-aff-filter],[data-macro],[data-layout],[data-zoom],[data-plate],[data-pick-plate],[data-back-plate],[data-open-place],[data-aff],[data-landmark],[data-district],[data-risk],[data-fac],[data-risk-filter],[data-fac-filter],[data-toggle-save],[data-toggle-ref],[data-toggle-hub],[data-toggle-fit],[data-toggle-note],[data-close-drawer],[data-close-wl],[data-jump-id]');
      if (!el) {
        if (ev.target === $('#atlas-svg') && (state.selectedPlateId || state.selectedPlaceId || state.selectedLandmarkId || state.selectedDistrict || state.selectedRiskId || state.selectedFacilityId || state.selectedAffId)) {
          clearSelection();
        }
        return;
      }

      const d = el.dataset;
      if (d.track) { closePopovers(); store.setHousingTrack(d.track); return; }
      if (d.mapFilter) { store.toggleMapFilter(d.mapFilter); return; }
      if (d.mapPreset) { store.applyMapPreset(d.mapPreset); return; }
      if (d.sqmQuick !== undefined) {
        const v = Number(d.sqmQuick) || 0;
        store.patch({ sqm: v, status: v > 0 ? `已按 ${v}㎡ 实时换算全图预估月租` : '已切回每平米参考均价' });
        return;
      }
      if (d.affFilter !== undefined) { store.patch({ affFilter: d.affFilter, status: '' }); return; }
      if (d.aff) {
        store.patch({ selectedAffId: d.aff, selectedPlateId: '', selectedPlaceId: '', selectedLandmarkId: '', selectedRiskId: '', selectedFacilityId: '' });
        return;
      }
      if (d.setWork) {
        omni.value = ''; closePopovers();
        applyDestination(d.setWork);
        return;
      }
      if (d.setWork2) {
        closePopovers();
        store.patch({ work2: d.setWork2, selectedLandmarkId: '', status: `已设备选工作地：${d.setWork2}` });
        return;
      }
      if ('clearWork' in d) { store.patch({ work: '', layout: 'geo', status: '已清除目的地' }); return; }
      if ('promptWork' in d) { omni.focus(); return; }
      if (d.mode) { store.patch({ mode: d.mode, status: '' }); return; }
      if (d.peak !== undefined) {
        const isPk = d.peak === '1';
        store.patch({ peak: isPk, status: isPk ? '已切至早高峰估算（叠加限流排队 / 进核心区潮汐拥堵）' : '已切回平峰基准通勤' });
        return;
      }
      if (d.layer) {
        if (state.macroOpen && microCamera) { map.camera.restore(microCamera); microCamera = null; }
        const willEnable = !state.layers[d.layer];
        const msg = d.layer === 'commute' && willEnable && !evalResult.dest1 ? '请先在左上角设置目的地，再查看各片区通勤时间' : '';
        store.toggleLayer(d.layer, { status: msg });
        return;
      }
      if (d.fillLayer) { store.setFillLayer(d.fillLayer); return; }
      if (d.trendKind) { store.patch({ trendKind: d.trendKind, status: '' }); return; }
      if ('toggleMacro' in d) {
        closePopovers();
        if (!state.macroOpen) {
          if (map.camera.viewport().k > 1.8) microCamera = map.camera.snapshot();
          map.camera.reset();
          store.patch({ macroOpen: true, selectedDistrict: '', status: '' });
        } else {
          if (microCamera) { map.camera.restore(microCamera); microCamera = null; }
          store.patch({ macroOpen: false, selectedDistrict: '', status: '' });
        }
        return;
      }
      if ('closeMacro' in d) {
        if (microCamera) { map.camera.restore(microCamera); microCamera = null; }
        store.patch({ macroOpen: false, selectedDistrict: '', status: '' });
        return;
      }
      if (d.macro) { store.patch({ macroOpen: true, macroMetric: d.macro, status: '' }); return; }
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
        store.patch({ referenceId: next, status: next ? `已设为对比：${pl?.name || d.toggleRef}` : '已取消对比' });
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
      if (state.selectedPlateId || state.selectedPlaceId || state.selectedLandmarkId || state.selectedDistrict || state.selectedRiskId || state.selectedFacilityId || state.selectedAffId) clearSelection();
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
        if (row.arbitrage.status === 'opportunity') buffs.push('↘ 可捡漏');
        if (row.premium?.status === 'direct') buffs.push('◆ 步行可达');
        if (row.mastery?.visited) buffs.push(row.mastery.avgStar ? `✓ 已看房 ${row.mastery.avgStar}★` : '✓ 已看房');

        const debuffs = [];
        if (row.premium?.status === 'premium') debuffs.push(`↑ 高溢价 ¥${Math.round(row.premium.extra)}/月`);
        for (const rk of row.risks.slice(0, 2)) debuffs.push(`⚠ ${rk.kind}`);

        const alertStrip = row.alerts?.length
          ? `<div class="hc-alerts">${row.alerts.slice(0, 2).map(a => `<div class="hc-alert hc-alert-${a.level}"><strong>!</strong> <span>${esc(a.title)}</span></div>`).join('')}</div>`
          : '';

        const priceHead = row.estMonthly
          ? `约${money(row.estMonthly)}/月`
          : `${pl.unitPrice}元/㎡`;
        const subParts = [pl.district + '·' + pl.streetName];
        if (row.estMonthly) subParts.push(`${pl.unitPrice}元/㎡ × ${state.sqm}㎡`);
        if (row.route) subParts.push(`${state.peak ? '早高峰' : '通勤'} ${row.route.minutes}分 (${row.route.label})`);
        if (row.trend?.yoy != null) subParts.push(`近一年 ${row.trend.yoy > 0 ? '+' : ''}${row.trend.yoy}%`);
        if (state.layers?.density && row.density != null) {
          subParts.push(`${pl.streetName}密度 ${(row.density / 10000).toFixed(2)}万/km²(七普)`);
        }
        if (row.fit.count >= 2) subParts.push(`匹配度 ${row.fit.rangeText}`);

        return `<div class="hc-head"><strong>${esc(pl.name)}</strong><span class="hc-price">${esc(priceHead)}</span></div>
          <div class="hc-sub">${esc(subParts.join(' · '))}</div>
          ${alertStrip}
          ${buffs.length ? `<div class="hc-buffs">${buffs.slice(0, 5).map(b => `<span class="hc-tag hc-buff">${esc(b)}</span>`).join('')}</div>` : ''}
          ${debuffs.length ? `<div class="hc-debuffs">${debuffs.map(b => `<span class="hc-tag hc-debuff">${esc(b)}</span>`).join('')}</div>` : ''}
          <div class="hc-foot">左键看月租与小区 · 右键直接设为目的地</div>`;
      }
      if (d.aff) {
        const ar = evalResult.affRowById?.get(d.aff);
        if (!ar) return '';
        const p = ar.project;
        const pTxt = ar.estMonthly ? `约${money(ar.estMonthly)}/月` : p.unitPrice ? `${p.unitPrice}元/㎡` : p.unitsText;
        const sub = [p.phaseLabel, p.audience, p.unitsText, ar.route ? `通勤 ${ar.route.minutes}分` : ''].filter(Boolean).join(' · ');
        return `<div class="hc-head"><strong>${esc(p.name)}</strong><span class="hc-price">${esc(pTxt)}</span></div>
          <div class="hc-sub">${esc(sub)}</div>
          <div class="hc-buffs"><span class="hc-tag hc-buff">${esc(p.rooms)}</span><span class="hc-tag hc-buff">${esc(p.timeline)}</span></div>
          <div class="hc-foot">点击查看准入门槛与官方公告</div>`;
      }
      if (d.landmark) {
        const lm = engine.landmarkById.get(d.landmark);
        if (!lm) return '';
        return `<div class="hc-head"><strong>◆ ${esc(lm.name)}</strong></div>
          <div class="hc-sub">${esc(lm.district)} · ${esc(lm.note)}</div>
          <div class="hc-foot">左键看辐射圈 · 右键直接设为目的地</div>`;
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
      if (svgEl.classList.contains('panning') || ev.target.closest?.('.map-dest-cta')) { hCard.hidden = true; lastHoverKey = ''; return; }
      const t = ev.target.closest?.('[data-aff],[data-plate],[data-landmark],[data-district],[data-risk],[data-fac]');
      const key = t ? (t.dataset.aff || t.dataset.plate || t.dataset.landmark || t.dataset.risk || t.dataset.fac || t.dataset.district || '') : '';
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
    // 地图右键任意板块/地标/设施：直接一键设为通勤目的地！
    svgEl.addEventListener('contextmenu', ev => {
      const t = ev.target.closest?.('[data-plate],[data-landmark],[data-fac]');
      if (!t) return;
      let targetWork = '';
      if (t.dataset.plate) {
        const pl = engine.plateById.get(t.dataset.plate);
        if (pl) targetWork = pl.name + '板块';
      } else if (t.dataset.landmark) {
        const lm = engine.landmarkById.get(t.dataset.landmark);
        if (lm) targetWork = lm.name;
      } else if (t.dataset.fac) {
        const f = engine.facById.get(t.dataset.fac);
        if (f?.location?.gcj02) targetWork = f.name;
      }
      if (!targetWork) return;
      ev.preventDefault();
      hCard.hidden = true;
      applyDestination(targetWork);
    });

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
