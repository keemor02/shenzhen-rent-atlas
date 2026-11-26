/* 深圳租房新版交互控制器：Apple Maps 原生毛玻璃 UI × 塞尔达旷野色块地图 */
(function (global) {
  'use strict';

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => '¥' + Math.round(n).toLocaleString('zh-CN');
  const BLOCKED_RENTAL_HOST = /(?:^|\.)(?:58\.com|ke\.com|lianjia\.com|ziroom\.com|leyoujia\.com|inboyu\.com|anjuke\.com|fang\.com|5i5j\.com)$/i;
  const lnk = (url, label) => {
    if (!/^https?:\/\//i.test(url || '')) return '';
    try {
      const host = new URL(url).hostname;
      if (BLOCKED_RENTAL_HOST.test(host)) return '';
    } catch { return ''; }
    return `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label || '来源')}↗</a>`;
  };
  const ROOM_LABEL = { 1: '一室', 2: '二室', 3: '三室', 4: '四室' };
  const FAC_CAT = { mall: '商场', school: '学校', park: '公园', market: '菜市', supermarket: '超市', health: '医疗', pharmacy: '药店' };
  const STAR_LABELS = { light: '采光通风', quiet: '隔音安静', appliance: '水压家电', walk: '步行到站', life: '买菜快递', landlord: '房东靠谱' };
  const HOUSING_TYPE_OPTS = ['电梯小区', '老小区', '品牌公寓', '城中村'];
  const MODE_LABEL = { rail: '地铁', bus: '公交', drive: '驾车' };
  const fmtDist = m => m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`;

  const STAR_SVG = filled => filled
    ? `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="m8 1.6 1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.4l-3.8 2 .7-4.3-3.1-3 4.3-.6z"/></svg>`
    : `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="m8 1.9 1.8 3.7 4 .6-2.9 2.8.7 4L8 11.1l-3.6 1.9.7-4-2.9-2.8 4-.6z"/></svg>`;

  function bootNext() {
    const $ = sel => document.querySelector(sel);
    const $$ = sel => [...document.querySelectorAll(sel)];
    const readJson = id => JSON.parse(document.getElementById(id).textContent);

    const atlas = readJson('atlas-v3-data');
    const travel = readJson('journey-data');
    const timing = readJson('time-data');
    const theme = global.NEXT_THEME;

    // 注入主题 CSS 变量
    for (const [k, v] of Object.entries(theme.css)) {
      document.documentElement.style.setProperty(k, v);
    }

    const engine = global.createV3Engine(atlas, travel, timing);
    const store = global.createV3Store(() => refresh());
    const state = store.state;
    const map = global.createNextMap($('#nx-svg'), atlas, engine, timing, esc);
    const evIcons = global.NextEventIcons;

    const qs = new URLSearchParams(global.location?.search || '');
    if (qs.get('work')) state.work = qs.get('work');
    if (qs.get('plate')) state.selectedPlateId = qs.get('plate');
    if (qs.get('layout') === 'radial') { state.layout = 'radial'; state.layers.commute = true; state.fillLayer = 'commute'; }
    if (qs.get('fill')) { state.fillLayer = qs.get('fill'); state.layers[qs.get('fill')] = true; }

    let sideTab = qs.get('tab') === 'pk' ? 'pk' : 'top';
    let mobTab = ['map', 'top', 'pk'].includes(qs.get('mobtab')) ? qs.get('mobtab') : 'map';
    let sideCollapsed = false;
    let condOpen = false;
    let weightsOpen = false;
    let pkRoomMetric = 'dims';
    let roomFormPlateId = '';
    let editingRoomId = '';
    let evalResult = null;
    let microCamera = null;
    let toastTimer = 0;

    const PK_COLORS = ['#1d7a46', '#007aff', '#c4820a', '#7c4dff', '#d14933', '#14848c'];

    const isMobile = () => (global.innerWidth || 1200) < 900;
    const currentLeftInset = () => (isMobile() || sideCollapsed) ? 0 : 370;
    const shortDest = name => String(name || '').replace(/板块$/, '');
    const isCurDest = (...names) => !!evalResult?.dest1 && names.some(n => n && (evalResult.dest1.name === n || shortDest(evalResult.dest1.name) === shortDest(n)));

    function showToast(msg) {
      const el = $('#nx-toast');
      if (!msg) { el.hidden = true; el.textContent = ''; return; }
      el.textContent = msg;
      el.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { el.hidden = true; state.status = ''; }, 3200);
    }

    function closePopovers(except = '') {
      for (const [popId, btnId] of [['nx-omni-pop', ''], ['nx-more-pop', 'nx-more-btn']]) {
        if (popId === except) continue;
        const pop = $('#' + popId);
        if (pop) pop.hidden = true;
        if (btnId) $('#' + btnId)?.setAttribute('aria-expanded', 'false');
      }
    }

    $('#nx-dest-options').innerHTML = atlas.destinations.map(d => `<option value="${esc(d.name)}"></option>`).join('');
    $('#nx-quick-dests').innerHTML = engine.QUICK_DESTS.map(n => `<button type="button" data-set-work="${esc(n)}">${esc(n)}</button>`).join('');

    function renderOmniPop(query = '') {
      const q = query.trim();
      const pop = $('#nx-omni-pop');
      if (!q) {
        const hotPlates = ['p-pingzhou', 'p-liuxian', 'p-lingzhi', 'p-baozhong', 'p-hongshan', 'p-shawei']
          .map(id => engine.plateById.get(id)).filter(Boolean);
        pop.innerHTML = `<div class="nx-omni-sec">热门办公地 / 枢纽</div>
          <div class="nx-omni-quick">${engine.QUICK_DESTS.map(n => `<button type="button" data-set-work="${esc(n)}">${esc(n)}</button>`).join('')}</div>
          <div class="nx-omni-sec">热门居住片区</div>
          <ul class="nx-omni-list">${hotPlates.map(pl => `<li><button type="button" class="nx-omni-main" data-pick-plate="${esc(pl.id)}"><span>${esc(pl.name)}</span><small>${esc(pl.district + ' · ' + pl.unitPrice + '元/㎡')}</small></button></li>`).join('')}</ul>`;
        pop.hidden = false;
        return;
      }
      const destHits = engine.searchDestinations(q, 8);
      const plateHits = atlas.plates.filter(pl => pl.name.includes(q) || pl.streetName.includes(q)).slice(0, 5);
      const sections = [];
      if (destHits.length) {
        sections.push(`<div class="nx-omni-sec">设为通勤目的地</div><ul class="nx-omni-list">${destHits.map(d => `<li>
          <button type="button" class="nx-omni-main" data-set-work="${esc(d.name)}"><span>${esc(d.name)}</span><small>${esc([d.district, d.kind].filter(Boolean).join(' · '))}</small></button>
        </li>`).join('')}</ul>`);
      }
      if (plateHits.length) {
        sections.push(`<div class="nx-omni-sec">直达片区</div><ul class="nx-omni-list">${plateHits.map(pl => `<li>
          <button type="button" class="nx-omni-main" data-pick-plate="${esc(pl.id)}"><span>${esc(pl.name)}</span><small>${esc(pl.district + ' · ' + pl.unitPrice + '元/㎡')}</small></button>
          <button type="button" class="nx-omni-go" data-set-work="${esc(pl.name + '板块')}">设目的地</button>
        </li>`).join('')}</ul>`);
      }
      pop.innerHTML = sections.join('') || `<div class="nx-omni-sec">未匹配到「${esc(q)}」</div>`;
      pop.hidden = false;
    }

    const FILL_NAMES = { score: '推荐', rent: '租金', commute: '通勤', trend: '涨跌', premium: '溢价', density: '人口' };

    function renderMorePopover() {
      const L = state.layers || {};
      const mf = state.mapFilter || { hub: true, mall: true, transit: true, terrain: true, neutralEvents: true, majorAlerts: true };
      const isAff = state.housingTrack === 'affordable';
      const extraDataKeys = isAff ? [] : ['trend', 'premium', 'density'].filter(k => L[k]);
      const hiddenRefCount = ['hub', 'mall', 'transit', 'terrain', 'neutralEvents', 'majorAlerts'].filter(k => mf[k] === false).length;
      const overlayCount = extraDataKeys.length + (L.facilities ? 1 : 0) + (L.risks ? 1 : 0) + (!isAff && L.affordable ? 1 : 0) + (state.macroOpen ? 1 : 0);
      $('#nx-more-dot').hidden = (overlayCount === 0 && hiddenRefCount === 0);

      const fillPool = ['score', 'rent', 'commute', ...extraDataKeys];
      const fillSwitchHtml = (!isAff && !state.macroOpen && extraDataKeys.length > 0)
        ? `<div class="nx-chip-sub" style="margin-top:2px"><span style="font-size:10.5px;color:var(--muted);align-self:center;margin-right:2px">地图底色</span>` +
          fillPool.map(k => `<button type="button" data-fill-layer="${k}" aria-pressed="${state.fillLayer === k}">${FILL_NAMES[k] || k}</button>`).join('') + `</div>`
        : '';

      const facSub = L.facilities
        ? `<div class="nx-chip-sub"><button type="button" data-fac-filter="" aria-pressed="${!state.facFilter}">全部配套</button>` +
          Object.entries(FAC_CAT).map(([k, l]) => `<button type="button" data-fac-filter="${k}" aria-pressed="${state.facFilter === k}">${l}</button>`).join('') + `</div>`
        : '';

      const riskSub = L.risks && evIcons
        ? `<div class="nx-chip-sub"><button type="button" data-risk-filter="" aria-pressed="${!state.riskFilter}">全部避坑</button>` +
          Object.entries(evIcons.EVENT_TYPES).map(([k, info]) => `<button type="button" data-risk-filter="${k}" aria-pressed="${state.riskFilter === k}">${evIcons.eventIconSvg(k)}${esc(info.label)}</button>`).join('') + `</div>`
        : '';

      $('#nx-more-pop').innerHTML = `
        <div class="nx-pop-title">
          <span>图层与地图显示</span>
          <div class="nx-pop-presets">
            <button type="button" class="nx-link-quiet" data-map-preset="minimal">极简</button>
            <button type="button" class="nx-link-quiet" data-reset-more>默认</button>
          </div>
        </div>
        ${!isAff ? `<div class="nx-pop-sec">
          <div class="nx-pop-sec-head"><span>片区情况叠加</span><small>可多选组合</small></div>
          <div class="nx-chip-group">
            <button type="button" data-toggle-overlay="trend" aria-pressed="${!!L.trend}">租金涨跌</button>
            <button type="button" data-toggle-overlay="premium" aria-pressed="${!!L.premium}">捡漏/高溢价</button>
            <button type="button" data-toggle-overlay="density" aria-pressed="${!!L.density}">街道人口密度</button>
            <button type="button" class="is-risk" data-map-filter="majorAlerts" aria-pressed="${mf.majorAlerts !== false}">价格异动 !</button>
            <button type="button" data-toggle-macro aria-pressed="${state.macroOpen}">各区均价总览</button>
          </div>
          ${fillSwitchHtml}
        </div>` : ''}
        <div class="nx-pop-sec">
          <div class="nx-pop-sec-head"><span>利好与负面点位</span><small>展开分类筛选</small></div>
          <div class="nx-chip-group">
            <button type="button" data-toggle-overlay="facilities" aria-pressed="${!!L.facilities}">核验配套</button>
            <button type="button" class="is-risk" data-toggle-overlay="risks" aria-pressed="${!!L.risks}">负面/避坑</button>
            ${!isAff ? `<button type="button" data-toggle-overlay="affordable" aria-pressed="${!!L.affordable}">叠看保租房</button>` : ''}
          </div>
          ${facSub}${riskSub}
        </div>
        <div class="nx-pop-sec">
          <div class="nx-pop-sec-head"><span>地图参照物</span><small>点击显隐</small></div>
          <div class="nx-chip-group">
            <button type="button" data-map-filter="hub" aria-pressed="${mf.hub !== false}">办公园区</button>
            <button type="button" data-map-filter="mall" aria-pressed="${mf.mall !== false}">商圈商场</button>
            <button type="button" data-map-filter="transit" aria-pressed="${mf.transit !== false}">交通枢纽</button>
            <button type="button" data-map-filter="terrain" aria-pressed="${mf.terrain !== false}">山体水库</button>
            <button type="button" data-map-filter="neutralEvents" aria-pressed="${mf.neutralEvents !== false}">外迁走廊</button>
          </div>
        </div>`;
    }

    function syncControls() {
      const hasWork = !!evalResult.dest1;
      $('#nx-quick-row').hidden = hasWork;
      $('#nx-cond-bar').hidden = false;
      $('#nx-cond-panel').hidden = !condOpen;
      $('#nx-cond-trigger').setAttribute('aria-expanded', String(condOpen));
      $('#nx-cond-toggle-mob').setAttribute('aria-expanded', String(condOpen));

      const workTag = $('#nx-work-tag');
      if (hasWork) {
        workTag.hidden = false;
        workTag.innerHTML = `<span>${esc(shortDest(evalResult.dest1.name))}</span><button type="button" data-clear-work aria-label="清除目的地">×</button>`;
      } else {
        workTag.hidden = true;
      }

      const sumChips = [];
      const modeLabel = MODE_LABEL[state.mode] || '地铁';
      sumChips.push(`<b class="nx-cs-mode">${esc(modeLabel + (state.peak ? '·早高峰' : ''))}</b>`);
      sumChips.push(`<span>≤${state.limit}分</span>`);
      if (state.sqm > 0) sumChips.push(`<span>${state.sqm}㎡</span>`);
      if (state.budget > 0) sumChips.push(`<span>≤¥${state.budget}</span>`);
      if (state.work2) sumChips.push(`<span>+备选地</span>`);
      $('#nx-cond-summary').innerHTML = sumChips.join('<i class="nx-cs-dot">·</i>');

      $('#nx-limit-range').value = state.limit;
      $('#nx-limit-readout').textContent = `${state.limit}分`;
      $('#nx-sqm-input').value = state.sqm || '';
      $('#nx-budget-input').value = state.budget || '';
      $('#nx-work2-input').value = state.work2 || '';
      $('#nx-limit2-input').value = state.limit2 || '';

      $$('#nx-sqm-chips [data-sqm-quick]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.sqmQuick) === (state.sqm || 0))));
      $$('#nx-mode-seg [data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode)));
      $$('#nx-peak-seg [data-peak]').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.peak === '1') === !!state.peak)));
      $$('#nx-track-seg [data-track]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.track === state.housingTrack)));

      const isAff = state.housingTrack === 'affordable';
      $('#nx-view-seg').hidden = isAff;
      $('#nx-aff-seg').hidden = !isAff;
      if (!isAff) {
        $$('#nx-view-seg [data-fill-layer]').forEach(b => {
          b.setAttribute('aria-pressed', String(!state.macroOpen && state.fillLayer === b.dataset.fillLayer));
        });
      } else {
        const all = evalResult.affordableRows || [];
        const cAct = all.filter(r => r.project.phase === 'active').length;
        const cRec = all.filter(r => r.project.phase === 'recent').length;
        const cUp = all.filter(r => r.project.phase === 'upcoming').length;
        $('#nx-aff-seg').innerHTML = [
          ['', `全部 ${all.length}`],
          ['active', `申请中 ${cAct}`],
          ['recent', `往期 ${cRec}`],
          ['upcoming', `在建 ${cUp}`],
        ].map(([k, l]) => `<button type="button" data-aff-filter="${k}" aria-pressed="${state.affFilter === k}">${l}</button>`).join('') +
          `<button type="button" data-toggle-overlay="commute" aria-pressed="${!!state.layers?.commute}">叠看通勤</button>`;
      }

      const radialBtn = $('#nx-radial-btn');
      const canRadial = hasWork && !isAff && !state.macroOpen;
      radialBtn.hidden = !canRadial;
      radialBtn.setAttribute('aria-pressed', String(canRadial && state.layout === 'radial' && !!state.layers?.commute));

      const subRow = $('#nx-sub-row');
      if (state.macroOpen) {
        const items = [['community', '小区'], ['apartment', '公寓'], ['village', '城中村'], ['listing', '挂牌'], ['ref2022', '2022参考'], ['density', '人口密度']];
        subRow.innerHTML = items.map(([k, l]) => `<button type="button" data-macro="${k}" aria-pressed="${state.macroMetric === k}">${l}</button>`).join('') +
          `<button type="button" data-close-macro>返回片区</button>`;
        subRow.hidden = false;
      } else if (!isAff && (state.layers?.trend || state.fillLayer === 'trend')) {
        subRow.innerHTML = `<button type="button" data-trend-kind="yoy" aria-pressed="${state.trendKind === 'yoy'}">近一年同比</button>` +
          `<button type="button" data-trend-kind="mom" aria-pressed="${state.trendKind === 'mom'}">近一月环比</button>`;
        subRow.hidden = false;
      } else {
        subRow.hidden = true;
      }

      $('#nx-zoom-box').hidden = canRadial && state.layout === 'radial' && !!state.layers?.commute;

      const pkCount = (evalResult.scoredRooms?.length || 0) + store.savedEntries().filter(e => e.saved).length;
      $('#nx-pk-count').textContent = String(pkCount);
      const mobBadge = $('#nx-mob-pk-badge');
      mobBadge.textContent = String(pkCount);
      mobBadge.hidden = pkCount === 0;

      renderMorePopover();
    }

    function renderTopView() {
      const nw = engine.normalizedWeights(state.weights);
      const pct = k => Math.round(nw[k] * 100);
      const list = evalResult.eligiblePlates || [];

      const profTabs = store.PROFILES.map(p =>
        `<button type="button" data-profile="${esc(p.id)}" aria-pressed="${state.profile === p.id}">${esc(p.short)}</button>`
      ).join('');

      const weightsHtml = weightsOpen
        ? `<div class="nx-weights-drawer">${store.WEIGHT_KEYS.map(k =>
            `<label class="nx-w-row"><span>${esc(engine.FIT_NAMES[k])}</span><input type="range" min="0" max="70" step="5" value="${state.weights[k] ?? 20}" data-weight="${k}"><strong>${pct(k)}%</strong></label>`
          ).join('')}</div>`
        : '';

      const rowsHtml = list.length
        ? `<div class="nx-place-list">${list.slice(0, 45).map((r, i) => {
            const sc = r.fit.total;
            const scCls = sc >= 75 ? '' : sc >= 60 ? ' mid' : ' low';
            const saved = store.isSaved(r.plate.id);
            const isSel = r.plate.id === state.selectedPlateId;
            const priceText = r.estMonthly ? `约 ${money(r.estMonthly)}/月` : `${r.plate.unitPrice}元/㎡`;
            const commText = r.route ? `${r.route.minutes}分` : (r.plate.lines?.length ? `${r.plate.lines.slice(0, 2).join('/')}号线` : '');

            // 近期租金涨跌提示（克制行内数字色阶）
            const tv = state.trendKind === 'mom' ? r.trend?.mom : r.trend?.yoy;
            let deltaHtml = '';
            if (tv != null && Math.abs(tv) >= 0.5) {
              const cls = tv >= 5 ? 'up' : tv <= -2 ? 'down' : 'flat';
              const arrow = tv > 0 ? '↑' : '↓';
              deltaHtml = `<span class="nx-pr-delta ${cls}" title="${state.trendKind === 'mom' ? '近一月环比' : '近一年同比'}">${arrow}${Number(Math.abs(tv).toFixed(1))}%</span>`;
            }

            // 溢价 / 捡漏 / 显著异动行内提示（优先级：暴涨大跌异动 > 同程高溢价 > 可捡漏 > 普通亮点）
            const topAlert = r.alerts?.find(a => a.priority >= 2) || null;
            let sigHtml = '';
            if (topAlert && (topAlert.level === 'surge' || topAlert.level === 'drop')) {
              sigHtml = `<span class="nx-pr-sig ${topAlert.level === 'surge' ? 'warm' : 'good'}">${esc(topAlert.short)}</span>`;
            } else if (r.premium?.status === 'premium') {
              sigHtml = `<span class="nx-pr-sig warm">溢价¥${Math.round(r.premium.extra)}</span>`;
            } else if (r.arbitrage?.status === 'opportunity') {
              sigHtml = `<span class="nx-pr-sig good">可捡漏</span>`;
            }

            let whyClean = String(r.fit.topReason || '');
            if (commText) whyClean = whyClean.replace(/^通勤\d+分\s*·?\s*/, '');
            whyClean = whyClean.replace(/[↘◆✓]\s*/gu, '').replace(/可捡漏/g, '').replace(/^·\s*|\s*·$/g, '').trim();

            const metaBits = [`<span class="nx-pr-price">${esc(priceText)}</span>`];
            if (deltaHtml) metaBits.push(deltaHtml);
            if (commText) metaBits.push(`<span class="nx-pr-dot">·</span><span>${esc(commText)}</span>`);
            if (sigHtml) metaBits.push(`<span class="nx-pr-dot">·</span>${sigHtml}`);
            else if (whyClean && whyClean !== commText) metaBits.push(`<span class="nx-pr-dot">·</span><span class="nx-pr-why">${esc(whyClean)}</span>`);

            return `<article class="nx-place-row${isSel ? ' is-sel' : ''}" data-pick-plate="${esc(r.plate.id)}" role="button" tabindex="0">
              <div class="nx-pr-top">
                <div class="nx-pr-left">
                  <span class="nx-pr-rank${i < 3 ? ' top3' : ''}">${String(i + 1).padStart(2, '0')}</span>
                  <span class="nx-pr-name">${esc(r.plate.name)}</span>
                  <span class="nx-pr-sub">${esc(r.plate.district.replace(/区$/, ''))}</span>
                </div>
                <span class="nx-pr-score${scCls}">${sc}<small>分</small></span>
              </div>
              <div class="nx-pr-bottom">
                <div class="nx-pr-meta">${metaBits.join('')}</div>
                <button type="button" class="nx-star-btn" data-toggle-save="${esc(r.plate.id)}" data-save-name="${esc(r.plate.name + '片区')}" aria-pressed="${saved}" aria-label="${saved ? '取消收藏' : '收藏片区'}">${STAR_SVG(saved)}</button>
              </div>
            </article>`;
          }).join('')}</div>`
        : `<p class="nx-sub-note" style="padding:18px 14px">当前筛选条件下暂无符合片区，可适当放宽预算或通勤上限。</p>`;

      $('#nx-top-view').innerHTML = `
        <div class="nx-prof-strip">
          <div class="nx-prof-tabs" role="group" aria-label="排序偏好">${profTabs}</div>
          <button type="button" class="nx-link-quiet" data-toggle-weights>${weightsOpen ? '收起权重' : '调权重'}</button>
        </div>
        ${weightsHtml}
        <div class="nx-list-caption">
          <span>符合条件 ${list.length} 个片区</span>
          <div style="display:flex;align-items:center;gap:6px">
            <button type="button" class="nx-filter-toggle" data-toggle-opp aria-pressed="${!!state.oppOnly}">只看可捡漏</button>
            ${!evalResult.dest1 ? `<button type="button" class="nx-link-quiet" data-prompt-work>设终点</button>` : ''}
          </div>
        </div>
        ${rowsHtml}`;
    }

    function renderPkView() {
      const scoredRooms = evalResult.scoredRooms || [];
      const entries = store.savedEntries();
      const activeTab = state.wlTab === 'plates' ? 'plates' : 'rooms';
      const flagLabelById = new Map(store.RED_FLAGS.map(f => [f.id, f.label]));

      const plateOpts = [...atlas.plates]
        .sort((a, b) => a.district.localeCompare(b.district, 'zh-CN') || a.name.localeCompare(b.name, 'zh-CN'))
        .map(p => `<option value="${esc(p.id)}"${p.id === (state.selectedPlateId || evalResult.topPlates?.[0]?.plate.id) ? ' selected' : ''}>${esc(p.district.replace(/区$/, '') + ' · ' + p.name)}</option>`).join('');

      const shortLbl = s => String(s || '').replace(/片区$/, '').split('·')[0];
      const bestVal = (vals, higher = true) => {
        const nums = vals.filter(v => Number.isFinite(v));
        if (nums.length < 2) return null;
        return higher ? Math.max(...nums) : Math.min(...nums);
      };
      const buildSpecMatrix = (items, rowsSpec) => {
        const cols = items.length;
        const head = `<div class="nx-pk-m-row is-head" style="--cols:${cols}"><span>关键条件</span>${items.map((it, idx) =>
          `<button type="button" class="nx-pk-m-head"${it.plateId ? ` data-pick-plate="${esc(it.plateId)}"` : ''} title="${esc(it.fullName)}"><i style="background:${PK_COLORS[idx % PK_COLORS.length]}"></i><span>${esc(it.short)}</span></button>`
        ).join('')}</div>`;
        const lines = rowsSpec.map(spec => {
          const best = spec.higher === null ? null : bestVal(spec.vals, spec.higher);
          const allSame = best != null && spec.vals.filter(Number.isFinite).every(v => v === best);
          return `<div class="nx-pk-m-row" style="--cols:${cols}"><span class="nx-pk-m-lbl">${esc(spec.label)}</span>${spec.texts.map((t, i) => {
            const v = spec.vals[i];
            const win = !allSame && best != null && Number.isFinite(v) && v === best;
            const warn = spec.warnFn ? spec.warnFn(v) : false;
            return `<span class="nx-pk-m-val${win ? ' is-win' : ''}${warn ? ' is-warn' : ''}">${esc(t)}</span>`;
          }).join('')}</div>`;
        }).join('');
        return `<div class="nx-pk-matrix">${head}${lines}</div>`;
      };
      const buildBarGroups = (items, groups) => groups.map(g => {
        const best = bestVal(g.vals, true);
        const allSame = best != null && g.vals.filter(Number.isFinite).every(v => v === best);
        const winIdx = (!allSame && best != null) ? g.vals.findIndex(v => v === best) : -1;
        const winHint = winIdx >= 0 ? `<small class="nx-pk-win-hint">${esc(items[winIdx].short)}领先</small>` : '';
        return `<div class="nx-pk-bg-item">
          <div class="nx-pk-bg-head"><span>${esc(g.label)}</span>${winHint}</div>
          <div class="nx-pk-bg-rows">${items.map((it, i) => {
            const v = g.vals[i];
            const pct = Number.isFinite(v) ? Math.max(0, Math.min(100, (v / g.max) * 100)) : 0;
            const win = !allSame && best != null && v === best;
            const sub = g.subs?.[i] || '';
            return `<div class="nx-pk-bar-row${win ? ' is-win' : ''}">
              <span class="nx-pk-bar-name" title="${esc(it.fullName)}"><i style="background:${PK_COLORS[i % PK_COLORS.length]}"></i>${esc(it.short)}</span>
              <div class="nx-pk-bar-track"><div class="nx-pk-bar-fill" style="width:${pct.toFixed(1)}%;background:${PK_COLORS[i % PK_COLORS.length]}"></div></div>
              <strong class="nx-pk-bar-num">${Number.isFinite(v) ? esc(g.fmt ? g.fmt(v) : String(v)) : '—'}</strong>
              ${sub ? `<span class="nx-pk-bar-sub">${esc(sub)}</span>` : ''}
            </div>`;
          }).join('')}</div>
        </div>`;
      }).join('');

      let body = '';
      if (activeTab === 'rooms') {
        const addBar = `<div class="nx-pk-add">
          <select class="nx-select" data-pk-plate-select style="flex:1 1 auto;width:0;min-width:0">${plateOpts}</select>
          <button type="button" class="nx-btn-dark" style="flex:0 0 auto;height:34px;padding:0 12px;font-size:12px" data-pk-add-room>记一套房</button>
        </div>`;

        let roomPkBoard = '';
        if (scoredRooms.length >= 2) {
          const pkList = scoredRooms.slice(0, 4);
          const pkItems = pkList.map(rm => ({
            fullName: rm.title,
            short: rm.title.length > 5 ? rm.title.slice(0, 5) : rm.title,
            plateId: rm.plateId || '',
          }));
          const minCost = Math.min(...pkList.map(r => r.trueMonthly));
          const matrixHtml = buildSpecMatrix(pkItems, [
            { label: '综合实测', higher: true, vals: pkList.map(r => r.total), texts: pkList.map(r => `${r.total}分`) },
            { label: '月全成本', higher: false, vals: pkList.map(r => r.trueMonthly), texts: pkList.map(r => r.trueMonthly === minCost ? money(r.trueMonthly) : `${money(r.trueMonthly)}`) },
            { label: '隐形杂费', higher: false, vals: pkList.map(r => r.hiddenMonthly), texts: pkList.map(r => r.hiddenMonthly > 0 ? `+¥${r.hiddenMonthly}` : '¥0'), warnFn: v => v >= 300 },
            { label: '通勤估时', higher: false, vals: pkList.map(r => r.commuteMin ?? NaN), texts: pkList.map(r => r.commuteMin != null ? `${r.commuteMin}分` : '—') },
            { label: '红灯硬伤', higher: false, vals: pkList.map(r => r.redFlags.length), texts: pkList.map(r => r.redFlags.length ? `${r.redFlags.length}项` : '0项'), warnFn: v => v > 0 },
            { label: '现场均星', higher: true, vals: pkList.map(r => r.starsAvg ?? NaN), texts: pkList.map(r => r.starsAvg != null ? `${r.starsAvg}★` : '未评') },
          ]);
          const groups = pkRoomMetric === 'stars'
            ? store.STAR_KEYS.map(sk => ({
                label: STAR_LABELS[sk],
                max: 5,
                vals: pkList.map(r => Number.isInteger(r.stars?.[sk]) ? r.stars[sk] : NaN),
                fmt: v => `${v}★`,
              }))
            : engine.FIT_KEYS.map(dk => ({
                label: engine.FIT_NAMES[dk],
                max: 100,
                vals: pkList.map(r => r.dims?.[dk] ?? NaN),
              }));
          roomPkBoard = `<section class="nx-pk-board">
            <div class="nx-pk-board-head">
              <strong>房源横向指标 PK（前 ${pkList.length} 套）</strong>
              <div class="nx-seg nx-seg-sm" role="group" aria-label="房源对比维度">
                <button type="button" data-pk-room-metric="dims" aria-pressed="${pkRoomMetric === 'dims'}">四维分</button>
                <button type="button" data-pk-room-metric="stars" aria-pressed="${pkRoomMetric === 'stars'}">6项实测</button>
              </div>
            </div>
            ${matrixHtml}
            <div class="nx-pk-bars">${buildBarGroups(pkItems, groups)}</div>
          </section>`;
        }

        const listHtml = scoredRooms.length
          ? scoredRooms.map((rm, i) => {
              const flags = rm.redFlags.length
                ? rm.redFlags.map(id => `<span class="nx-meta-tag warm">${esc(flagLabelById.get(id) || id)}</span>`).join('')
                : `<span class="nx-meta-tag good">零红灯硬伤</span>`;
              const starChips = store.STAR_KEYS.filter(k => rm.stars?.[k]).map(k => {
                const sv = rm.stars[k];
                const cls = sv >= 4 ? 'good' : sv <= 2 ? 'warm' : '';
                return `<span class="nx-star-chip ${cls}">${esc(STAR_LABELS[k].slice(0, 2))} ${sv}★</span>`;
              }).join('');
              const miniDims = rm.dims
                ? `<div class="nx-mini-dims" style="padding-left:23px">${engine.FIT_KEYS.map(k => {
                    const v = rm.dims[k] ?? 0;
                    return `<div class="nx-md-item"><div class="nx-md-top"><span>${esc(engine.FIT_NAMES[k].slice(0, 2))}</span><b>${v}</b></div><div class="nx-md-track"><i style="width:${v}%;background:${PK_COLORS[i % PK_COLORS.length]}"></i></div></div>`;
                  }).join('')}</div>`
                : '';
              const colorDot = scoredRooms.length >= 2 && i < 4 ? `<i class="nx-pk-dot" style="background:${PK_COLORS[i % PK_COLORS.length]}"></i>` : '';
              return `<article class="nx-pk-row${i === 0 ? ' is-top' : ''}">
                <div class="nx-pr-top">
                  <div class="nx-pr-left">
                    <span class="nx-pr-rank${i === 0 ? ' top3' : ''}">#${i + 1}</span>
                    ${colorDot}
                    <span class="nx-pr-name">${esc(rm.title)}</span>
                  </div>
                  <span class="nx-pr-score${rm.total < 60 ? ' low' : rm.total < 75 ? ' mid' : ''}">${rm.total}<small>分</small></span>
                </div>
                <div class="nx-pr-meta" style="padding-left:23px">
                  <span class="nx-pr-price">${money(rm.trueMonthly)}/月全成本</span>
                  ${rm.hiddenMonthly > 0 ? `<span class="nx-pr-dot">·</span><span>标价${money(rm.baseRent)} + 杂费${money(rm.hiddenMonthly)}</span>` : ''}
                  ${rm.commuteMin != null ? `<span class="nx-pr-dot">·</span><span>${rm.commuteMin}分</span>` : ''}
                </div>
                ${miniDims}
                <div class="nx-meta-pills" style="padding-left:23px">${flags}</div>
                ${starChips ? `<div class="nx-star-chips" style="padding-left:23px">${starChips}</div>` : ''}
                ${rm.note ? `<p class="nx-sub-note" style="padding-left:23px;color:var(--fg-secondary)">${esc(rm.note)}</p>` : ''}
                <div class="nx-pk-acts" style="padding-left:23px">
                  ${rm.plateId ? `<button type="button" class="nx-link-quiet" data-pick-plate="${esc(rm.plateId)}">看片区</button>` : ''}
                  ${rm.plateId ? `<button type="button" class="nx-link-quiet" data-edit-room="${esc(rm.id)}" data-plate-id="${esc(rm.plateId)}">编辑</button>` : ''}
                  <button type="button" class="nx-link-quiet" style="color:var(--muted)" data-delete-room="${esc(rm.id)}">删除</button>
                </div>
              </article>`;
            }).join('')
          : `<p class="nx-sub-note" style="padding:18px 14px">看房时记录月租、物业、网费、水电性质与现场红灯项，记满 2 套自动展开真成本与 6 项实测指标条横向 PK。</p>`;
        const oneHint = scoredRooms.length === 1
          ? `<div class="nx-pk-tip">再记录 1 套看过的房，即可自动生成「真成本 + 四维分 + 6项实测星级」并排横评表</div>`
          : '';
        body = addBar + roomPkBoard + oneHint + listHtml;
      } else {
        const savedPairs = entries.map(e => ({ entry: e, row: evalResult.plateRowById.get(e.id) || null }));
        const pkRows = savedPairs.filter(x => x.row).map(x => x.row).slice(0, 4);
        let platePkBoard = '';
        if (pkRows.length >= 2) {
          const pkItems = pkRows.map(r => ({
            fullName: r.plate.name,
            short: shortLbl(r.plate.name),
            plateId: r.plate.id,
          }));
          const matrixHtml = buildSpecMatrix(pkItems, [
            { label: '综合推荐', higher: true, vals: pkRows.map(r => r.fit.total), texts: pkRows.map(r => `${r.fit.total}分`) },
            {
              label: state.sqm > 0 ? `${state.sqm}㎡估租` : '参考单价',
              higher: false,
              vals: pkRows.map(r => (state.sqm > 0 && r.estMonthly) ? r.estMonthly : (r.plate.unitPrice ?? NaN)),
              texts: pkRows.map(r => (state.sqm > 0 && r.estMonthly) ? money(r.estMonthly) : `${r.plate.unitPrice}/㎡`),
            },
            { label: '通勤时长', higher: false, vals: pkRows.map(r => r.route?.minutes ?? NaN), texts: pkRows.map(r => r.route ? `${r.route.minutes}分` : '未设终点') },
            { label: '近一年同比', higher: false, vals: pkRows.map(r => r.trend?.yoy ?? NaN), texts: pkRows.map(r => r.trend?.yoy != null ? `${r.trend.yoy > 0 ? '+' : ''}${r.trend.yoy}%` : '—'), warnFn: v => v >= 8 },
            { label: '人口密度', higher: false, vals: pkRows.map(r => r.density ?? NaN), texts: pkRows.map(r => r.density != null ? `${(r.density / 10000).toFixed(2)}万` : '—') },
            { label: '避坑提醒', higher: false, vals: pkRows.map(r => r.risks?.length ?? 0), texts: pkRows.map(r => r.risks?.length ? `${r.risks.length}项` : '0项'), warnFn: v => v > 0 },
          ]);
          const dimGroups = engine.FIT_KEYS.map(dk => ({
            label: engine.FIT_NAMES[dk],
            max: 100,
            vals: pkRows.map(r => r.fit.dimensions[dk]?.score ?? NaN),
            subs: pkRows.map(r => {
              if (dk === 'commute') return r.route ? `${r.route.minutes}分` : '';
              if (dk === 'rent') return `${r.plate.unitPrice}/㎡`;
              if (dk === 'environment') return r.density != null ? `${(r.density / 10000).toFixed(1)}万` : '';
              return r.plate.lines?.length ? `${r.plate.lines.length}条地铁` : '';
            }),
          }));
          platePkBoard = `<section class="nx-pk-board">
            <div class="nx-pk-board-head">
              <strong>收藏片区横向指标 PK（${pkRows.length} 个）</strong>
              <span class="nx-sub-note">点片区名可定位</span>
            </div>
            ${matrixHtml}
            <div class="nx-pk-bars">${buildBarGroups(pkItems, dimGroups)}</div>
          </section>`;
        }

        const cardsHtml = savedPairs.length
          ? savedPairs.map(({ entry: e, row }, i) => {
              const isRef = row && state.referenceId === row.plate.id;
              const colorDot = pkRows.length >= 2 && row && i < 4 ? `<i class="nx-pk-dot" style="background:${PK_COLORS[i % PK_COLORS.length]}"></i>` : '';
              const miniDims = row
                ? `<div class="nx-mini-dims">${engine.FIT_KEYS.map(k => {
                    const v = row.fit.dimensions[k]?.score ?? 0;
                    return `<div class="nx-md-item"><div class="nx-md-top"><span>${esc(engine.FIT_NAMES[k].slice(0, 2))}</span><b>${v}</b></div><div class="nx-md-track"><i style="width:${v}%;background:${PK_COLORS[i % PK_COLORS.length]}"></i></div></div>`;
                  }).join('')}</div>`
                : '';
              const scCls = !row ? '' : row.fit.total >= 75 ? '' : row.fit.total >= 60 ? ' mid' : ' low';
              const metaBits = row
                ? [
                    row.plate.district.replace(/区$/, ''),
                    row.estMonthly ? `约${money(row.estMonthly)}/月 (${row.plate.unitPrice}/㎡)` : `${row.plate.unitPrice}元/㎡`,
                    row.route ? `通勤 ${row.route.minutes}分` : '',
                    row.density != null ? `密度 ${(row.density / 10000).toFixed(2)}万` : '',
                  ].filter(Boolean).join(' · ')
                : '已收藏记录';
              return `<div class="nx-pk-row">
                <div class="nx-pr-top">
                  <div class="nx-pr-left">${colorDot}<span class="nx-pr-name">${esc(e.name)}</span></div>
                  ${row ? `<span class="nx-pr-score${scCls}">${row.fit.total}<small>分</small></span>` : ''}
                </div>
                <div class="nx-sub-note">${esc(metaBits)}</div>
                ${miniDims}
                <div class="nx-pk-acts">
                  ${row ? `<button type="button" class="nx-link-quiet" data-pick-plate="${esc(row.plate.id)}">查看片区</button>` : ''}
                  ${row ? `<button type="button" class="nx-link-quiet${isRef ? ' is-ref-on' : ''}" data-toggle-ref="${esc(row.plate.id)}">${isRef ? '当前对比基准' : '设为地图基准'}</button>` : ''}
                  <button type="button" class="nx-link-quiet" style="color:var(--muted)" data-toggle-save="${esc(e.id)}" data-save-name="${esc(e.name)}">${e.saved ? '移除收藏' : '重新收藏'}</button>
                </div>
              </div>`;
            }).join('')
          : `<p class="nx-sub-note" style="padding:18px 14px">还没有收藏片区。点击列表右侧星标收藏 2 个以上片区，即可自动生成四维指标条与核心条件横评。</p>`;
        const onePlateTip = pkRows.length === 1
          ? `<div class="nx-pk-tip">再收藏 1 个片区即可自动解锁多片区横向指标条 PK</div>`
          : '';
        body = platePkBoard + onePlateTip + cardsHtml;
      }

      $('#nx-pk-view').innerHTML = `
        <div class="nx-pk-head">
          <div class="nx-seg nx-seg-sm" role="tablist">
            <button type="button" data-wl-tab="rooms" aria-pressed="${activeTab === 'rooms'}">实地看房 ${scoredRooms.length}</button>
            <button type="button" data-wl-tab="plates" aria-pressed="${activeTab === 'plates'}">收藏片区 ${entries.length}</button>
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            <button type="button" id="nx-btn-export" class="nx-link-quiet">导出</button>
            <label class="nx-link-quiet" style="cursor:pointer">导入<input id="nx-input-import" type="file" accept=".json,application/json" hidden></label>
          </div>
        </div>
        ${body}`;

      const expBtn = $('#nx-btn-export');
      if (expBtn) expBtn.onclick = () => {
        const blob = new Blob([store.exportBackup()], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob), a = document.createElement('a');
        a.href = url; a.download = `深圳租房看房清单-${new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        store.patch({ status: '已导出 JSON 备份' });
      };
      const impInput = $('#nx-input-import');
      if (impInput) impInput.onchange = async ev => {
        const file = ev.target.files?.[0];
        if (!file) return;
        try { store.importBackup(await file.text()); }
        catch (err) { store.patch({ status: '导入失败：' + err.message }); }
        ev.target.value = '';
      };
    }

    function buildDetailHtml() {
      const backBtn = `<button type="button" class="nx-back-chevron" data-close-detail><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2.5 4.5 7 9 11.5"/></svg><span>返回</span></button>`;

      if (state.selectedAffId) {
        const ar = evalResult.affRowById?.get(state.selectedAffId);
        if (!ar) return '';
        const p = ar.project;
        const parentPl = engine.plateById.get(p.plateId);
        const priceVal = ar.estMonthly ? `约 ${money(ar.estMonthly)}/月` : p.unitPrice ? `${p.unitPrice}元/㎡` : '按官方批次定价';
        return `<div class="nx-detail-wrap">
          <div class="nx-detail-nav">${backBtn}<span class="nx-meta-tag good">${esc(p.phaseLabel)}</span></div>
          <div class="nx-detail-hero"><div><h2>${esc(p.name)}</h2><p class="nx-kicker">${esc(p.district)} · 政府保租房 · ${esc(p.station)}站</p></div></div>
          <div class="nx-inset-group nx-kpi-pair">
            <div class="nx-kpi-cell"><div class="nx-kpi-lbl"><span>通勤估时</span></div><div class="nx-kpi-val">${ar.route ? ar.route.minutes + ' 分' : '未设终点'}</div><div class="nx-kpi-sub">${esc(ar.route?.label || '设工作地测算')}</div></div>
            <div class="nx-kpi-cell"><div class="nx-kpi-lbl"><span>官方参考</span></div><div class="nx-kpi-val">${esc(priceVal)}</div><div class="nx-kpi-sub">${esc(p.unitsText)}</div></div>
          </div>
          <div class="nx-cta-row">
            ${isCurDest(p.name) ? `<button type="button" class="nx-btn-dark" data-clear-work>取消目的地</button>` : `<button type="button" class="nx-btn-dark" data-set-work="${esc(p.name)}">设为目的地</button>`}
            ${parentPl ? `<button type="button" class="nx-btn-subtle" data-pick-plate="${esc(parentPl.id)}">看所属片区</button>` : ''}
          </div>
          <div class="nx-inset-group" style="display:flex;flex-direction:column;gap:6px">
            <p class="nx-sub-note" style="color:var(--fg)"><strong>申请对象：</strong>${esc(p.audience)} · ${esc(p.audienceDetail)}</p>
            <p class="nx-sub-note">${esc(p.timeline)} · ${esc(p.rooms)}</p>
            <p class="nx-sub-note" style="color:var(--fg-secondary)">${esc(p.summary)}</p>
            <p class="nx-sub-note" style="color:var(--warm)">注意：${esc(p.watchout)}</p>
            <p class="nx-sub-note">出处：${lnk(p.source, p.sourceName) || esc(p.sourceName)}</p>
          </div>
        </div>`;
      }

      if (state.selectedLandmarkId) {
        const lm = engine.landmarkById.get(state.selectedLandmarkId);
        if (!lm) return '';
        const aura = engine.landmarkAura(lm.id);
        const railPlates = aura ? [...aura.rail30].map(id => evalResult.plateRowById.get(id)).filter(Boolean).sort((a, b) => a.plate.unitPrice - b.plate.unitPrice).slice(0, 6) : [];
        return `<div class="nx-detail-wrap">
          <div class="nx-detail-nav">${backBtn}<span class="nx-meta-tag">${esc(lm.district)}</span></div>
          <div class="nx-detail-hero"><div><h2>${esc(lm.name)}</h2><p class="nx-kicker">${esc(lm.note)}</p></div></div>
          ${aura ? `<div class="nx-inset-group nx-kpi-pair">
            <div class="nx-kpi-cell"><div class="nx-kpi-lbl"><span>15分步行圈</span></div><div class="nx-kpi-val">${aura.walk15.size} 个片区</div></div>
            <div class="nx-kpi-cell"><div class="nx-kpi-lbl"><span>${aura.minutes}分轨交直达</span></div><div class="nx-kpi-val">${aura.rail30.size} 个片区</div></div>
          </div>` : ''}
          <div class="nx-cta-row">
            ${isCurDest(lm.name) ? `<button type="button" class="nx-btn-dark" data-clear-work>取消目的地</button>` : `<button type="button" class="nx-btn-dark" data-set-work="${esc(lm.name)}">设为通勤目的地</button>`}
            <button type="button" class="nx-btn-subtle" data-set-work2="${esc(lm.name)}">设备选地</button>
          </div>
          ${railPlates.length ? `<div class="nx-disclosure-list"><details class="nx-disclosure" open><summary><span>${aura.minutes} 分钟直达低单价片区</span></summary><div class="nx-disc-body"><ul class="nx-clean-ul">${railPlates.map(r => `<li><button type="button" class="nx-link-quiet" style="padding:0" data-pick-plate="${esc(r.plate.id)}">${esc(r.plate.name)}</button><span class="nx-sub-note">${r.plate.unitPrice}元/㎡ · ${aura.timeMap.get(r.plate.id)}分</span></li>`).join('')}</ul></div></details></div>` : ''}
        </div>`;
      }

      if (state.selectedRiskId) {
        const rk = engine.riskById.get(state.selectedRiskId);
        if (!rk) return '';
        return `<div class="nx-detail-wrap">
          <div class="nx-detail-nav">${backBtn}<span class="nx-meta-tag warm">${esc(rk.kind)}</span></div>
          <div class="nx-detail-hero"><div><h2>${esc(rk.name)}</h2><p class="nx-kicker">${esc(rk.status)} · ${esc(rk.observed)}</p></div></div>
          <div class="nx-inset-group" style="display:flex;flex-direction:column;gap:6px">
            <p class="nx-sub-note" style="color:var(--fg)">${esc(rk.fact)}</p>
            <p class="nx-sub-note"><strong>现场核验建议：</strong>${esc(rk.check)} ${lnk(rk.url, rk.source)}</p>
          </div>
        </div>`;
      }

      if (state.selectedFacilityId) {
        const f = engine.facById.get(state.selectedFacilityId);
        if (!f) return '';
        return `<div class="nx-detail-wrap">
          <div class="nx-detail-nav">${backBtn}<span class="nx-meta-tag">${esc(FAC_CAT[f.category] || f.category)}</span></div>
          <div class="nx-detail-hero"><div><h2>${esc(f.name)}</h2><p class="nx-kicker">${esc(f.address || '')}</p></div></div>
          <p class="nx-sub-note">${lnk(f.source, f.sourceName || '政府公开资料')} ${f.osm?.source ? lnk(f.osm.source, 'OSM坐标') : ''}</p>
        </div>`;
      }

      if (state.selectedDistrict) {
        const d = atlas.districts.find(x => x.n === state.selectedDistrict);
        if (!d) return '';
        return `<div class="nx-detail-wrap">
          <div class="nx-detail-nav">${backBtn}<button type="button" class="nx-link-quiet" data-close-macro>返回片区图</button></div>
          <div class="nx-detail-hero"><div><h2>${esc(d.n)}</h2><p class="nx-kicker">区级统计参考</p></div></div>
          <div class="nx-inset-group"><ul class="nx-clean-ul">
            <li><span>普通小区均价</span><strong>${d.community?.price ?? '—'} 元/㎡</strong></li>
            <li><span>集中式公寓</span><strong>${d.apartment?.price ?? '—'} 元/㎡</strong></li>
            <li><span>城中村单间</span><strong>${d.village?.range ? d.village.range.join('–') + ' 元/㎡' : '—'}</strong></li>
            <li><span>人口密度（七普）</span><strong>${d.density.toLocaleString('zh-CN')} 人/km²</strong></li>
          </ul></div>
        </div>`;
      }

      if (!state.selectedPlateId) return '';
      const row = evalResult.plateRowById.get(state.selectedPlateId);
      if (!row) return '';
      const pl = row.plate;
      const saved = store.isSaved(pl.id);
      const isRef = state.referenceId === pl.id;
      const navUrl = evalResult.dest1 ? `https://uri.amap.com/navigation?${new URLSearchParams({
        from: `${pl.coord[0]},${pl.coord[1]},${pl.name}`,
        to: `${evalResult.dest1.coord[0]},${evalResult.dest1.coord[1]},${evalResult.dest1.name}`,
        mode: state.mode === 'drive' ? 'car' : 'bus',
      })}` : '';

      const refRow = evalResult.refRow && !isRef ? evalResult.refRow : null;
      let deltaHtml = '';
      if (isRef) {
        deltaHtml = `<div class="nx-ref-card is-self">
          <span>已设为对比基准 · 点地图任意其他片区即可并排对比 4 维指标条</span>
          <button type="button" class="nx-link-quiet" data-toggle-ref="${esc(pl.id)}">取消</button>
        </div>`;
      } else if (refRow) {
        const diffTotal = row.fit.total - refRow.fit.total;
        const diffCls = diffTotal > 0 ? 'better' : diffTotal < 0 ? 'worse' : '';
        const diffTxt = diffTotal === 0 ? '总分持平' : `总分${diffTotal > 0 ? '+' : ''}${diffTotal}`;
        const cmpChips = [];
        if (row.route && refRow.route) {
          const dm = refRow.route.minutes - row.route.minutes;
          cmpChips.push(`<span class="nx-delta-chip ${dm > 0 ? 'better' : dm < 0 ? 'worse' : ''}">${dm === 0 ? '通勤同耗时' : `通勤${dm > 0 ? '快' : '慢'}${Math.abs(dm)}分`}</span>`);
        }
        if (row.estMonthly && refRow.estMonthly) {
          const dp = refRow.estMonthly - row.estMonthly;
          if (Math.abs(dp) >= 50) cmpChips.push(`<span class="nx-delta-chip ${dp > 0 ? 'better' : 'worse'}">${dp > 0 ? '月省' : '月贵'}¥${Math.abs(Math.round(dp))}</span>`);
        } else if (pl.unitPrice && refRow.plate.unitPrice) {
          const du = refRow.plate.unitPrice - pl.unitPrice;
          if (Math.abs(du) >= 2) cmpChips.push(`<span class="nx-delta-chip ${du > 0 ? 'better' : 'worse'}">单价${du > 0 ? '低' : '高'}${Math.abs(du)}元/㎡</span>`);
        }
        if (row.density != null && refRow.density != null) {
          const dd = (refRow.density - row.density) / 10000;
          if (Math.abs(dd) >= 0.15) cmpChips.push(`<span class="nx-delta-chip ${dd > 0 ? 'better' : 'worse'}">密度${dd > 0 ? '低' : '高'}${Math.abs(dd).toFixed(2)}万</span>`);
        }
        if (row.risks.length !== refRow.risks.length) {
          const dr = refRow.risks.length - row.risks.length;
          cmpChips.push(`<span class="nx-delta-chip ${dr > 0 ? 'better' : 'worse'}">提醒${dr > 0 ? '少' : '多'}${Math.abs(dr)}项</span>`);
        }
        deltaHtml = `<div class="nx-ref-card">
          <div class="nx-ref-head">
            <div class="nx-ref-title"><span>vs 基准「${esc(refRow.plate.name)}」</span><span class="nx-delta-chip ${diffCls}">${esc(diffTxt)}</span></div>
            <div class="nx-ref-acts">
              <button type="button" class="nx-link-quiet" data-pick-plate="${esc(refRow.plate.id)}">看基准</button>
              <button type="button" class="nx-link-quiet" style="color:var(--muted)" data-toggle-ref="${esc(refRow.plate.id)}">取消</button>
            </div>
          </div>
          ${cmpChips.length ? `<div class="nx-delta-bar">${cmpChips.join('')}</div>` : ''}
        </div>`;
      }

      const scCls = row.fit.total >= 75 ? '' : row.fit.total >= 60 ? ' mid' : ' low';
      const kicker = [pl.district, pl.station ? pl.station + '站' : pl.streetName, pl.lines?.length ? pl.lines.join('/') + '号线' : ''].filter(Boolean);

      const tags = [];
      if (row.premium?.status === 'premium') tags.push(`<span class="nx-meta-tag warm">同程高溢价 约¥${Math.round(row.premium.extra)}/月</span>`);
      else if (row.arbitrage.status === 'opportunity') tags.push(`<span class="nx-meta-tag good">具备议价空间</span>`);
      if (pl.streetDensity != null) tags.push(`<span class="nx-meta-tag">密度 ${(pl.streetDensity / 10000).toFixed(2)}万/km²</span>`);
      if (row.trend?.yoy != null) tags.push(`<span class="nx-meta-tag">同比 ${row.trend.yoy > 0 ? '+' : ''}${row.trend.yoy}%</span>`);
      if (row.risks.length) tags.push(`<span class="nx-meta-tag warm">${row.risks.length}项公开提醒</span>`);

      const dimLegend = refRow
        ? `<div class="nx-dim-legend"><span><i class="is-cur"></i>当前 · ${esc(pl.name.split('·')[0])}</span><span><i class="is-ref"></i>基准 · ${esc(refRow.plate.name.split('·')[0])}</span></div>`
        : '';
      const dimHtml = `<div class="nx-inset-group nx-dim-grid${refRow ? ' has-ref' : ''}">${dimLegend}${engine.FIT_KEYS.map(k => {
        const d = row.fit.dimensions[k];
        if (!refRow) {
          return `<div class="nx-dim-cell">
            <div class="nx-dim-top"><span>${esc(engine.FIT_NAMES[k])}</span><strong>${d.score}</strong></div>
            <div class="nx-dim-track"><div class="nx-dim-fill" style="width:${d.score}%"></div></div>
            <div class="nx-dim-why" title="${esc(d.why)}">${esc(d.why)}</div>
          </div>`;
        }
        const rd = refRow.fit.dimensions[k];
        const diff = d.score - rd.score;
        const dCls = diff > 0 ? 'better' : diff < 0 ? 'worse' : 'flat';
        const dLbl = diff === 0 ? '平' : `${diff > 0 ? '+' : ''}${diff}`;
        const curFillCls = diff > 0 ? ' is-better' : diff < 0 ? ' is-worse' : '';
        return `<div class="nx-dim-cell">
          <div class="nx-dim-top">
            <span>${esc(engine.FIT_NAMES[k])}</span>
            <span class="nx-dim-nums"><strong>${d.score}</strong><em class="nx-dim-delta ${dCls}">${dLbl}</em></span>
          </div>
          <div class="nx-dim-dual">
            <div class="nx-dim-track"><div class="nx-dim-fill${curFillCls}" style="width:${d.score}%"></div></div>
            <div class="nx-dim-ref-row">
              <div class="nx-dim-track is-ref"><div class="nx-dim-fill-ref" style="width:${rd.score}%"></div></div>
              <span class="nx-dim-ref-val">${rd.score}</span>
            </div>
          </div>
          <div class="nx-dim-why" title="${esc(d.why)}">${esc(d.why)}</div>
        </div>`;
      }).join('')}</div>`;

      // 一房一卡实地看房表单
      let roomFormHtml = '';
      if (roomFormPlateId === pl.id) {
        const rm = editingRoomId ? store.getRoom(editingRoomId) : null;
        const initBase = rm?.rent || (row.estMonthly || (pl.unitPrice ? pl.unitPrice * 35 : 2500));
        const initUtilMode = rm?.utilityMode || 'civil';
        const initUtilExtra = initUtilMode === 'commercial' ? 220 : (initUtilMode === 'custom' ? (rm?.utilityExtra || 0) : 0);
        const initHid = (rm?.mgmtFee || 0) + (rm?.netFee || 0) + initUtilExtra + Math.round((rm?.agencyFee || 0) / 12);
        roomFormHtml = `<form class="nx-room-form" data-room-form data-plate-id="${esc(pl.id)}" data-plate-name="${esc(pl.name)}" data-room-id="${esc(rm?.id || '')}">
          <h4><span>${rm ? '编辑看房卡片' : '记录一套看过的房'}</span><button type="button" class="nx-link-quiet" data-cancel-room-form>取消</button></h4>
          <label class="nx-field"><span class="nx-field-lbl">小区 / 楼栋房号 *</span><input class="nx-input" name="title" type="text" required value="${esc(rm?.title || '')}" placeholder="例：${esc(pl.name)}花园 3栋802"></label>
          <div class="nx-grid-3">
            <label class="nx-field"><span class="nx-field-lbl">类型</span><select class="nx-select" name="housingType">${HOUSING_TYPE_OPTS.map(t => `<option value="${esc(t)}"${(rm?.housingType || '电梯小区') === t ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
            <label class="nx-field"><span class="nx-field-lbl">面积(㎡)</span><input class="nx-input" name="areaSqm" type="number" min="5" max="300" value="${rm?.areaSqm ?? (state.sqm || '')}"></label>
            <label class="nx-field"><span class="nx-field-lbl">步行(分)</span><input class="nx-input" name="walkMin" type="number" min="1" max="60" value="${rm?.walkMin ?? ''}"></label>
          </div>
          <div class="nx-grid-2">
            <label class="nx-field"><span class="nx-field-lbl">标价月租(元) *</span><input class="nx-input" name="rent" type="number" min="100" max="100000" required value="${rm?.rent ?? initBase}"></label>
            <label class="nx-field"><span class="nx-field-lbl">物业/管理费(元/月)</span><input class="nx-input" name="mgmtFee" type="number" min="0" max="10000" value="${rm?.mgmtFee ?? 0}"></label>
          </div>
          <div class="nx-grid-2">
            <label class="nx-field"><span class="nx-field-lbl">网费/杂费(元/月)</span><input class="nx-input" name="netFee" type="number" min="0" max="2000" value="${rm?.netFee ?? 0}"></label>
            <label class="nx-field"><span class="nx-field-lbl">中介费(一次性元)</span><input class="nx-input" name="agencyFee" type="number" min="0" max="50000" value="${rm?.agencyFee ?? 0}"></label>
          </div>
          <div class="nx-grid-2">
            <label class="nx-field"><span class="nx-field-lbl">水电性质</span><select class="nx-select" name="utilityMode">
              <option value="civil"${initUtilMode === 'civil' ? ' selected' : ''}>民水民电 (+¥0)</option>
              <option value="commercial"${initUtilMode === 'commercial' ? ' selected' : ''}>商水商电 (+¥220/月)</option>
              <option value="custom"${initUtilMode === 'custom' ? ' selected' : ''}>自定义月差价</option>
            </select></label>
            <label class="nx-field" data-util-custom-wrap${initUtilMode === 'custom' ? '' : ' hidden'}><span class="nx-field-lbl">水电多花(元)</span><input class="nx-input" name="utilityExtra" type="number" min="0" max="3000" value="${rm?.utilityExtra ?? 200}"></label>
          </div>
          <div class="nx-cost-box" data-true-cost-preview>
            <span>真实月全成本</span><strong>${money(initBase + initHid)}/月</strong>
            <span class="nx-sub-note" style="width:100%">含隐形杂费 +${money(initHid)}/月</span>
          </div>
          <div class="nx-flag-grid">${store.RED_FLAGS.map(f => `<label class="nx-flag-lbl"><input type="checkbox" name="redFlags" value="${esc(f.id)}"${(rm?.redFlags || []).includes(f.id) ? ' checked' : ''}><span>${esc(f.label)}</span></label>`).join('')}</div>
          <div class="nx-grid-3">${store.STAR_KEYS.map(k => `<label class="nx-field"><span class="nx-field-lbl">${esc(STAR_LABELS[k])}</span><select class="nx-select" name="star_${k}"><option value="">未评</option>${[5, 4, 3, 2, 1].map(n => `<option value="${n}"${rm?.stars?.[k] === n ? ' selected' : ''}>${n}分</option>`).join('')}</select></label>`).join('')}</div>
          <label class="nx-field"><span class="nx-field-lbl">看房备忘</span><textarea class="nx-input" style="height:auto;padding:8px" name="note" rows="2">${esc(rm?.note || '')}</textarea></label>
          <div class="nx-cta-row"><button type="submit" class="nx-btn-dark">保存并计分</button><button type="button" class="nx-btn-subtle" data-cancel-room-form>取消</button></div>
        </form>`;
      }

      // 合规底线：只呈现片区级统计参考区间，无商业找房平台链接或品牌门店具体报价
      const marketRents = row.rentsMatched.filter(r => r.grain !== 'official_affordable');
      const catBands = [];
      const seenCat = new Set();
      for (const r of marketRents) {
        const key = `${r.type || 'all'}_${r.room}`;
        if (seenCat.has(key)) continue;
        seenCat.add(key);
        catBands.push(r);
        if (catBands.length >= 4) break;
      }

      const disclosures = [];
      if (row.rooms?.length) {
        disclosures.push(`<details class="nx-disclosure" open><summary><span>本片区看房实录 (${row.rooms.length})</span><small>去 PK 台对比</small></summary>
          <div class="nx-disc-body">${row.rooms.map(rm => `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
            <div><strong>${esc(rm.title)}</strong><div class="nx-sub-note">全成本 ${money(rm.trueMonthly)}/月 · ${rm.total}分</div></div>
            <div style="display:flex;gap:8px"><button type="button" class="nx-link-quiet" data-edit-room="${esc(rm.id)}" data-plate-id="${esc(pl.id)}">编辑</button><button type="button" class="nx-link-quiet" style="color:var(--muted)" data-delete-room="${esc(rm.id)}">删除</button></div>
          </div>`).join('')}</div></details>`);
      }
      if (catBands.length) {
        disclosures.push(`<details class="nx-disclosure"><summary><span>片区统计参考区间</span><small>统计口径</small></summary>
          <div class="nx-disc-body"><ul class="nx-clean-ul">${catBands.map(r => {
            const tLbl = atlas.housingTypeMeta[r.type]?.label || '片区综合';
            const pStr = r.low === r.high ? money(r.median) : `${money(r.low)}–${money(r.high)}`;
            return `<li><span>${esc(tLbl)} · ${ROOM_LABEL[r.room] || r.room + '室'}<br><small class="nx-sub-note">${esc(r.period)} 片区参考（非具体挂牌）</small></span><strong>${esc(pStr)}</strong></li>`;
          }).join('')}</ul></div></details>`);
      }
      if (row.nearbyFacs.length || row.risks.length || row.route?.peakDetail || (evalResult.dest2 && row.route2) || pl.streetDensity != null) {
        const comm2Note = evalResult.dest2 && row.route2
          ? `<p class="nx-sub-note" style="color:var(--fg-secondary)">备选工作地 ${esc(evalResult.dest2.name)}：<strong>${row.route2.minutes} 分钟</strong></p>`
          : '';
        const densNote = pl.streetDensity != null
          ? `<p class="nx-sub-note">${esc(pl.streetName)}人口密度 ${(pl.streetDensity / 10000).toFixed(2)}万/km²（2020七普 ${(pl.streetPop / 10000).toFixed(1)}万人 / ${pl.streetAreaKm2}km²${(pl.subdivided || pl.clipId) ? ' · 同街道共用口径' : ''}）</p>`
          : '';
        disclosures.push(`<details class="nx-disclosure"><summary><span>配套、人口与公开提醒</span><small>${row.nearbyFacs.length + row.risks.length} 项</small></summary>
          <div class="nx-disc-body">
            ${row.route?.peakDetail ? `<p class="nx-sub-note" style="color:var(--warm)">${esc(row.route.peakDetail)}</p>` : ''}
            ${comm2Note}${densNote}
            ${row.nearbyFacs.length ? `<ul class="nx-clean-ul">${row.nearbyFacs.map(f => `<li><span>${esc(f.name)}</span><span class="nx-sub-note">${esc(FAC_CAT[f.category] || f.category)} · ${fmtDist(f.meters)}</span></li>`).join('')}</ul>` : ''}
            ${row.risks.length ? `<ul class="nx-clean-ul">${row.risks.map(rk => {
              const ico = evIcons ? evIcons.eventIconSvg(evIcons.eventTypeFor(rk)) : '';
              return `<li><span>${ico} <strong style="color:var(--warm)">${esc(rk.name)}</strong><br><small class="nx-sub-note">${esc(rk.check)}</small></span><span>${lnk(rk.url, rk.source)}</span></li>`;
            }).join('')}</ul>` : ''}
          </div></details>`);
      }
      if (row.affordable?.length || row.events.length || row.policies.length) {
        const cnt = (row.affordable?.length || 0) + row.events.length + row.policies.length;
        disclosures.push(`<details class="nx-disclosure"><summary><span>政府保租房与公开政策</span><small>${cnt} 条</small></summary>
          <div class="nx-disc-body"><ul class="nx-clean-ul">
            ${(row.affordable || []).map(ar => `<li><button type="button" class="nx-link-quiet" style="padding:0;text-align:left" data-aff="${esc(ar.project.id)}">${esc(ar.project.shortName)}</button><span class="nx-sub-note">${esc(ar.project.phaseLabel)}</span></li>`).join('')}
            ${row.events.map(ev => `<li><span>${esc(ev.title)}</span><span>${lnk(ev.source, '原文')}</span></li>`).join('')}
            ${row.policies.map(pol => `<li><span>${esc(pol.title)}</span><span>${lnk(pol.source, '公告')}</span></li>`).join('')}
          </ul></div></details>`);
      }

      // 近期涨跌、溢价与议价判断洞察块（保留时间、样本与可验证理由）
      const insightParts = [];
      if (row.trend && (row.trend.yoy != null || row.trend.mom != null)) {
        const yoyStr = row.trend.yoy != null ? `同比 ${row.trend.yoy > 0 ? '+' : ''}${row.trend.yoy}%` : '';
        const momStr = row.trend.mom != null ? `环比 ${row.trend.mom > 0 ? '+' : ''}${row.trend.mom}%` : '';
        const tTone = (row.trend.yoy >= 8) ? 'warm' : (row.trend.yoy <= -3 ? 'good' : '');
        insightParts.push(`<div class="nx-insight-row"><span class="nx-insight-head ${tTone}">近期租金走势</span><span><strong>${esc([yoyStr, momStr].filter(Boolean).join(' · '))}</strong></span></div>
          <p class="nx-sub-note">${esc(row.trend.period || '')} 商圈同户型统计参考（非单套挂牌）</p>`);
      }
      const pr = row.premium;
      if (pr && (pr.status === 'premium' || (pr.hub && pr.status !== 'direct' && pr.status !== 'no-hub' && pr.status !== 'no-work'))) {
        const isPrem = pr.status === 'premium';
        const isPeer = pr.kind === 'peer';
        const headTxt = isPrem
          ? (isPeer ? `同程高溢价 约¥${Math.round(pr.extra)}/月（+${pr.pct}%）` : `邻园高溢价 约¥${Math.round(pr.extra)}/月`)
          : (pr.status === 'used' ? `常去「${pr.hub.name}」· 已免溢价扣分` : `近「${pr.hub.name}」步行${pr.hub.walk}分`);
        const altChips = pr.alternatives?.length
          ? `<div class="nx-alt-row">${pr.alternatives.slice(0, 3).map(a => `<button type="button" class="nx-alt-chip" data-pick-plate="${esc(a.id)}">${esc(a.name)}<span>${a.unitPrice}/㎡ · ${a.minutes}分</span></button>`).join('')}</div>`
          : '';
        const hubBtn = pr.hub && !isPeer
          ? `<div><button type="button" class="nx-link-quiet" style="padding:2px 0" data-toggle-hub="${esc(pr.hub.name)}">${pr.status === 'used' ? '取消常去标记' : '我常去「' + esc(pr.hub.name) + '」（免扣分）'}</button></div>`
          : '';
        insightParts.push(`<div class="nx-insight-head ${isPrem ? 'warm' : ''}">${esc(headTxt)}</div>
          <p class="nx-sub-note" style="color:var(--fg-secondary)">${esc(pr.reason)}</p>${altChips}${hubBtn}`);
      }
      if (row.arbitrage?.reasons?.length) {
        insightParts.push(`<div class="nx-insight-head good">议价 / 捡漏依据</div>
          <ul class="nx-insight-ul">${row.arbitrage.reasons.map(r => `<li>· ${esc(r)}</li>`).join('')}</ul>`);
      }
      if (row.alerts?.length) {
        insightParts.push(`<div class="nx-insight-head ${row.alerts[0].level === 'surge' ? 'warm' : row.alerts[0].level === 'drop' ? 'good' : ''}">近期异动提醒</div>
          <ul class="nx-insight-ul">${row.alerts.slice(0, 3).map(a => `<li>· <strong>${esc(a.title)}</strong>${a.date ? `（${esc(a.date)}）` : ''} ${lnk(a.source, a.sourceLabel || '原文')}</li>`).join('')}</ul>`);
      }
      const insightHtml = insightParts.length
        ? `<div class="nx-inset-group nx-insight-box">${insightParts.join('')}</div>`
        : '';

      const mobMapBtn = (isMobile() && mobTab !== 'map') ? `<button type="button" class="nx-link-quiet" data-jump-map="${esc(pl.id)}">地图定位</button>` : '';
      return `<div class="nx-detail-wrap">
        <div class="nx-detail-nav">
          ${backBtn}
          <div class="nx-detail-nav-acts">
            ${mobMapBtn}
            <button type="button" class="nx-filter-toggle" data-toggle-ref="${esc(pl.id)}" aria-pressed="${isRef}">${isRef ? '已设为对比' : '设为对比'}</button>
            <button type="button" class="nx-star-btn" data-toggle-save="${esc(pl.id)}" data-save-name="${esc(pl.name + '片区')}" aria-pressed="${saved}" aria-label="${saved ? '取消收藏' : '收藏'}">${STAR_SVG(saved)}</button>
          </div>
        </div>
        <div class="nx-detail-hero">
          <div><h2>${esc(pl.name)}</h2><p class="nx-kicker">${esc(kicker.join(' · '))}</p></div>
          <div class="nx-hero-score${scCls}"><strong>${row.fit.total}</strong><span>综合分</span></div>
        </div>
        <div class="nx-inset-group nx-kpi-pair">
          <div class="nx-kpi-cell">
            <div class="nx-kpi-lbl"><span>${state.peak ? '早高峰估时' : '单程通勤'}</span>${lnk(navUrl, '高德')}</div>
            <div class="nx-kpi-val">${row.route ? row.route.minutes + ' 分' : '未设终点'}</div>
            <div class="nx-kpi-sub">${esc(row.route?.label || '设工作地测算')}</div>
          </div>
          <div class="nx-kpi-cell">
            <div class="nx-kpi-lbl"><span>${row.estMonthly ? state.sqm + '㎡估租' : '参考均价'}</span></div>
            <div class="nx-kpi-val">${row.estMonthly ? '约' + money(row.estMonthly) : pl.unitPrice + '元/㎡'}</div>
            <div class="nx-kpi-sub">${esc(pl.unitBasis)}</div>
          </div>
        </div>
        ${deltaHtml}
        ${tags.length ? `<div class="nx-meta-pills">${tags.join('')}</div>` : ''}
        ${dimHtml}
        ${insightHtml}
        <div class="nx-cta-row">
          <button type="button" class="nx-btn-dark" data-open-room-form="${esc(pl.id)}">记录实地看房</button>
          ${isCurDest(pl.name, pl.name + '板块')
            ? `<button type="button" class="nx-btn-subtle" data-clear-work aria-pressed="true">当前目的地</button>`
            : `<button type="button" class="nx-btn-subtle" data-set-work="${esc(pl.name + '板块')}">设为目的地</button>`}
        </div>
        ${roomFormHtml}
        ${disclosures.length ? `<div class="nx-disclosure-list">${disclosures.join('')}</div>` : ''}
      </div>`;
    }

    function bindRoomForm(container) {
      const rForm = container.querySelector('[data-room-form]');
      if (!rForm) return;
      const updatePreview = () => {
        const fd = new FormData(rForm);
        const uMode = fd.get('utilityMode') || 'civil';
        const customWrap = rForm.querySelector('[data-util-custom-wrap]');
        if (customWrap) customWrap.hidden = uMode !== 'custom';
        const base = Math.max(0, Number(fd.get('rent')) || 0);
        const mgmt = Math.max(0, Number(fd.get('mgmtFee')) || 0);
        const net = Math.max(0, Number(fd.get('netFee')) || 0);
        const uExtra = uMode === 'commercial' ? 220 : (uMode === 'custom' ? Math.max(0, Number(fd.get('utilityExtra')) || 0) : 0);
        const agMon = Math.round(Math.max(0, Number(fd.get('agencyFee')) || 0) / 12);
        const hid = mgmt + net + uExtra + agMon;
        const box = rForm.querySelector('[data-true-cost-preview]');
        if (box) box.innerHTML = `<span>真实月全成本</span><strong>${money(base + hid)}/月</strong><span class="nx-sub-note" style="width:100%">${hid > 0 ? `含隐形杂费 +${money(hid)}/月` : '与标价一致，零杂费'}</span>`;
      };
      rForm.addEventListener('input', updatePreview);
      rForm.addEventListener('change', updatePreview);
      rForm.onsubmit = ev => {
        ev.preventDefault();
        const fd = new FormData(rForm);
        const stars = {};
        for (const k of store.STAR_KEYS) {
          const v = fd.get('star_' + k);
          stars[k] = v ? Number(v) : null;
        }
        const savedRoom = store.saveRoom({
          id: rForm.dataset.roomId || undefined,
          plateId: rForm.dataset.plateId,
          plateName: rForm.dataset.plateName,
          title: fd.get('title'),
          housingType: fd.get('housingType'),
          areaSqm: fd.get('areaSqm'),
          walkMin: fd.get('walkMin'),
          rent: fd.get('rent'),
          mgmtFee: fd.get('mgmtFee'),
          netFee: fd.get('netFee'),
          utilityMode: fd.get('utilityMode'),
          utilityExtra: fd.get('utilityExtra'),
          agencyFee: fd.get('agencyFee'),
          redFlags: fd.getAll('redFlags'),
          stars,
          note: fd.get('note'),
        });
        if (savedRoom) { roomFormPlateId = ''; editingRoomId = ''; }
      };
    }

    function renderSheets() {
      const hasSel = !!(state.selectedPlateId || state.selectedAffId || state.selectedLandmarkId || state.selectedRiskId || state.selectedFacilityId || state.selectedDistrict);
      const detailHtml = hasSel ? buildDetailHtml() : '';
      const mob = isMobile();

      $('#app-shell').setAttribute('data-active-mob-tab', mobTab);
      $('#app-shell').classList.toggle('side-collapsed', !mob && sideCollapsed);
      $('#nx-side-open').hidden = mob || !sideCollapsed;

      $$('#nx-side-tabs [data-side-tab]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.sideTab === sideTab)));
      $$('#nx-mobile-tabs [data-mob-tab]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mobTab === mobTab)));

      const activeTab = mob ? mobTab : sideTab;
      const showDetailInSide = hasSel && (!mob || mobTab !== 'map');
      $('#nx-side-tabs-wrap').hidden = showDetailInSide;
      $('#nx-detail-view').hidden = !showDetailInSide;
      $('#nx-top-view').hidden = showDetailInSide || activeTab !== 'top';
      $('#nx-pk-view').hidden = showDetailInSide || activeTab !== 'pk';

      if (showDetailInSide) {
        $('#nx-detail-view').innerHTML = detailHtml;
        bindRoomForm($('#nx-detail-view'));
      } else if (activeTab === 'pk') {
        renderPkView();
      } else {
        renderTopView();
      }

      const sheet = $('#nx-mobile-sheet');
      if (mob && mobTab === 'map' && hasSel && detailHtml) {
        sheet.innerHTML = `<div class="nx-sheet-handle" data-sheet-handle></div>${detailHtml}`;
        if (roomFormPlateId && roomFormPlateId === state.selectedPlateId) sheet.classList.add('sheet-tall');
        sheet.hidden = false;
        bindRoomForm(sheet);
      } else {
        sheet.hidden = true;
        sheet.classList.remove('sheet-tall');
      }
    }

    function refresh() {
      if ((state.mode === 'drive' || state.mode === 'bus') && typeof engine.isModeReady === 'function' && !engine.isModeReady(state.mode)) {
        const targetMode = state.mode;
        engine.ensureModeReady(targetMode).then(ok => {
          if (ok && state.mode === targetMode) refresh();
        });
      }
      evalResult = engine.evaluateAll(state, store);
      syncControls();
      showToast(state.status);
      renderSheets();
      $('#nx-legend').innerHTML = map.render({ state, evalResult, store, theme, leftInset: currentLeftInset() });
    }

    function clearSelection() {
      roomFormPlateId = '';
      editingRoomId = '';
      store.patch({
        selectedPlateId: '', selectedPlaceId: '', selectedLandmarkId: '',
        selectedDistrict: '', selectedRiskId: '', selectedFacilityId: '', selectedAffId: '',
      });
    }

    function fitIntoSafeArea(box = map.world) {
      const mob = isMobile();
      const left = currentLeftInset();
      const padB = mob ? (state.selectedPlateId ? Math.round(($('#nx-stage')?.clientHeight || 600) * 0.46) : 56) : 70;
      if (mob || left <= 0) {
        map.camera.fit(box, { padBottom: padB });
        return;
      }
      map.camera.fit(box, { padBottom: padB });
      const v = map.camera.viewport();
      const availW = Math.max(200, v.w - left - 44);
      const availH = Math.max(180, v.h - padB - 40);
      const boxW = Math.max(18, box[2] - box[0]);
      const boxH = Math.max(16, box[3] - box[1]);
      const unit = Math.min((v.w - 28) / (map.world[2] - map.world[0]), (v.h - 28) / (map.world[3] - map.world[1]));
      const targetK = Math.min(availW / boxW, availH / boxH);
      const zoom = Math.max(0.75, Math.min(42, targetK / unit));
      const k2 = unit * zoom;
      const cx = (box[0] + box[2]) / 2 - (left / 2) / k2;
      const cy = (box[1] + box[3]) / 2 + (padB / 2 - 12) / k2;
      map.camera.restore({ cx, cy, zoom });
    }

    function selectPlate(plateId, fitCamera = false) {
      const pl = engine.plateById.get(plateId);
      if (!pl) return;
      roomFormPlateId = roomFormPlateId === plateId ? roomFormPlateId : '';
      if (!isMobile() && sideCollapsed) sideCollapsed = false;
      if (fitCamera || isMobile()) fitIntoSafeArea(pl.bounds);
      store.patch({
        macroOpen: false,
        selectedPlateId: plateId, selectedPlaceId: '', selectedLandmarkId: '',
        selectedDistrict: '', selectedRiskId: '', selectedFacilityId: '', selectedAffId: '', status: '',
      });
    }

    function applyDestination(destName) {
      const nextLayers = state.layers.commute ? state.layers : { ...state.layers, commute: true };
      store.patch({
        work: destName, layers: nextLayers, selectedLandmarkId: '',
        status: `已设目的地：${shortDest(destName)}`,
      });
    }

    // ======================== 事件绑定 ========================
    const omni = $('#nx-omni-input');
    omni.onfocus = () => { closePopovers('nx-omni-pop'); renderOmniPop(omni.value); };
    omni.oninput = () => { $('#nx-search-clear').hidden = !omni.value; renderOmniPop(omni.value); };
    $('#nx-search-clear').onclick = () => { omni.value = ''; $('#nx-search-clear').hidden = true; renderOmniPop(''); omni.focus(); };
    omni.onkeydown = ev => {
      if (ev.key === 'Escape') { closePopovers(); omni.blur(); return; }
      if (ev.key !== 'Enter') return;
      ev.preventDefault();
      const q = omni.value.trim();
      if (!q) return;
      const dest = engine.resolveDestination(q);
      if (dest) { omni.value = ''; $('#nx-search-clear').hidden = true; closePopovers(); applyDestination(dest.name); return; }
      const pl = atlas.plates.find(x => x.name.includes(q) || x.streetName.includes(q));
      if (pl) { omni.value = ''; $('#nx-search-clear').hidden = true; closePopovers(); selectPlate(pl.id, true); return; }
      showToast(`未匹配到「${q}」`);
    };

    $('#nx-more-btn').onclick = ev => {
      ev.stopPropagation();
      const pop = $('#nx-more-pop');
      const open = pop.hidden;
      closePopovers();
      pop.hidden = !open;
      $('#nx-more-btn').setAttribute('aria-expanded', String(open));
    };

    const toggleCond = () => { condOpen = !condOpen; syncControls(); };
    $('#nx-cond-trigger').onclick = toggleCond;
    $('#nx-cond-toggle-mob').onclick = toggleCond;

    $('#nx-side-close').onclick = () => { sideCollapsed = true; refresh(); };
    $('#nx-side-open').onclick = () => { sideCollapsed = false; refresh(); };

    $('#nx-limit-range').oninput = e => store.patch({ limit: Number(e.target.value), status: '' });
    $('#nx-sqm-input').oninput = e => store.patch({ sqm: Math.max(0, Number(e.target.value) || 0), status: '' });
    $('#nx-budget-input').onchange = e => store.patch({ budget: Math.max(0, Number(e.target.value) || 0), status: '' });
    $('#nx-work2-input').onchange = e => {
      const raw = e.target.value.trim();
      if (!raw) { store.patch({ work2: '', status: '' }); return; }
      const r = engine.resolveDestination(raw);
      store.patch({ work2: r ? r.name : '', status: r ? `备选工作地：${r.name}` : '未匹配到该地点' });
    };
    $('#nx-limit2-input').onchange = e => store.patch({ limit2: Math.max(0, Number(e.target.value) || 0), status: '' });
    $('#nx-reset-all').onclick = () => {
      store.patch({ budget: 0, sqm: 0, mode: 'rail', peak: false, limit: 50, work2: '', limit2: 0, oppOnly: false, status: '已重置筛选条件' });
    };

    $('#nx-top-view').addEventListener('change', ev => {
      const inp = ev.target.closest('[data-weight]');
      if (inp) store.setWeight(inp.dataset.weight, inp.value);
    });

    $('#nx-radial-btn').onclick = () => {
      const nextRadial = !(state.layout === 'radial' && state.layers?.commute);
      store.patch({
        layout: nextRadial ? 'radial' : 'geo',
        layers: { ...state.layers, commute: true },
        fillLayer: nextRadial ? 'commute' : 'score',
        status: '',
      });
    };

    document.body.addEventListener('click', ev => {
      if (!ev.target.closest('.nx-pop-anchor,.nx-search-wrap')) closePopovers();
      const el = ev.target.closest('[data-side-tab],[data-mob-tab],[data-jump-map],[data-toggle-weights],[data-toggle-cond],[data-toggle-opp],[data-toggle-hub],[data-toggle-ref],[data-set-work],[data-set-work2],[data-clear-work],[data-prompt-work],[data-mode],[data-peak],[data-track],[data-sqm-quick],[data-fill-layer],[data-aff-filter],[data-trend-kind],[data-toggle-macro],[data-close-macro],[data-macro],[data-toggle-overlay],[data-map-filter],[data-map-preset],[data-fac-filter],[data-risk-filter],[data-reset-more],[data-zoom],[data-profile],[data-plate],[data-pick-plate],[data-landmark],[data-aff],[data-district],[data-risk],[data-fac],[data-toggle-save],[data-close-detail],[data-open-room-form],[data-cancel-room-form],[data-edit-room],[data-delete-room],[data-wl-tab],[data-pk-add-room],[data-pk-room-metric]');
      if (!el) {
        if (ev.target === $('#nx-svg')) clearSelection();
        return;
      }
      const d = el.dataset;
      if (d.sideTab) { sideTab = d.sideTab; clearSelection(); renderSheets(); return; }
      if (d.mobTab) { mobTab = d.mobTab; condOpen = false; clearSelection(); refresh(); return; }
      if (d.jumpMap) { mobTab = 'map'; selectPlate(d.jumpMap, true); return; }
      if ('toggleWeights' in d) { weightsOpen = !weightsOpen; renderTopView(); return; }
      if ('toggleCond' in d) { toggleCond(); return; }
      if ('toggleOpp' in d) { store.patch({ oppOnly: !state.oppOnly, status: !state.oppOnly ? '已筛选：仅看具备议价空间的片区' : '' }); return; }
      if (d.toggleHub) { store.toggleUsedHub(d.toggleHub); return; }
      if (d.toggleRef) {
        const nextRef = state.referenceId === d.toggleRef ? '' : d.toggleRef;
        const rPl = engine.plateById.get(d.toggleRef);
        store.patch({ referenceId: nextRef, status: nextRef ? `已设为对比基准：${rPl?.name || d.toggleRef}` : '已取消对比基准' });
        return;
      }
      if (d.setWork) { omni.value = ''; $('#nx-search-clear').hidden = true; closePopovers(); applyDestination(d.setWork); return; }
      if (d.setWork2) { closePopovers(); store.patch({ work2: d.setWork2, selectedLandmarkId: '', status: `备选地：${d.setWork2}` }); return; }
      if ('clearWork' in d) { store.patch({ work: '', layout: 'geo', status: '已清除目的地' }); return; }
      if ('promptWork' in d) { omni.focus(); return; }
      if (d.mode) { store.patch({ mode: d.mode, status: '' }); return; }
      if (d.peak !== undefined) { store.patch({ peak: d.peak === '1', status: d.peak === '1' ? '已切至早高峰估时' : '已切回平峰基准' }); return; }
      if (d.track) { closePopovers(); store.setHousingTrack(d.track); return; }
      if (d.sqmQuick !== undefined) { store.patch({ sqm: Number(d.sqmQuick) || 0, status: '' }); return; }
      if (d.fillLayer) {
        if (state.macroOpen && microCamera) { map.camera.restore(microCamera); microCamera = null; }
        store.setFillLayer(d.fillLayer);
        return;
      }
      if (d.affFilter !== undefined) { store.patch({ affFilter: d.affFilter, status: '' }); return; }
      if (d.trendKind) { store.patch({ trendKind: d.trendKind, status: '' }); return; }
      if ('toggleMacro' in d) {
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
      if (d.toggleOverlay) { store.toggleLayer(d.toggleOverlay); return; }
      if (d.mapFilter) { store.toggleMapFilter(d.mapFilter); return; }
      if (d.mapPreset) { store.applyMapPreset(d.mapPreset); return; }
      if (d.facFilter !== undefined) { store.patch({ facFilter: state.facFilter === d.facFilter ? '' : d.facFilter, status: '' }); return; }
      if (d.riskFilter !== undefined) { store.patch({ riskFilter: state.riskFilter === d.riskFilter ? '' : d.riskFilter, status: '' }); return; }
      if ('resetMore' in d) {
        if (microCamera) { map.camera.restore(microCamera); microCamera = null; }
        store.patch({
          macroOpen: false,
          fillLayer: state.housingTrack === 'affordable' ? 'affordable' : 'score',
          layers: {
            ...state.layers,
            score: true, rent: true,
            trend: false, premium: false, density: false,
            facilities: false, risks: false,
            affordable: state.housingTrack === 'affordable',
          },
          facFilter: '', riskFilter: '',
          mapFilter: { hub: true, mall: true, transit: true, terrain: true, neutralEvents: true, majorAlerts: true },
          status: '已恢复默认图层显示',
        });
        return;
      }
      if (d.zoom) {
        if (d.zoom === 'reset') { fitIntoSafeArea(map.world); map.render({ state, evalResult, store, theme, leftInset: currentLeftInset() }); }
        else map.camera.control(d.zoom);
        return;
      }
      if (d.profile) { store.setProfile(d.profile); return; }
      if (d.plate || d.pickPlate) { closePopovers(); selectPlate(d.plate || d.pickPlate, !!d.pickPlate); return; }
      if (d.landmark) { store.patch({ selectedLandmarkId: d.landmark, selectedPlateId: '', selectedAffId: '', selectedRiskId: '', selectedFacilityId: '' }); return; }
      if (d.aff) { store.patch({ selectedAffId: d.aff, selectedPlateId: '', selectedLandmarkId: '', selectedRiskId: '', selectedFacilityId: '' }); return; }
      if (d.district) { store.patch({ selectedDistrict: d.district, selectedPlateId: '' }); return; }
      if (d.risk) { store.patch({ selectedRiskId: d.risk, selectedPlateId: '', selectedFacilityId: '' }); return; }
      if (d.fac) { store.patch({ selectedFacilityId: d.fac, selectedPlateId: '', selectedRiskId: '' }); return; }
      if (d.toggleSave) { store.toggleSave(d.toggleSave, d.saveName || d.toggleSave); return; }
      if ('closeDetail' in d) { clearSelection(); return; }
      if (d.openRoomForm) { roomFormPlateId = d.openRoomForm; editingRoomId = ''; renderSheets(); return; }
      if ('cancelRoomForm' in d) { roomFormPlateId = ''; editingRoomId = ''; renderSheets(); return; }
      if (d.editRoom) { editingRoomId = d.editRoom; roomFormPlateId = d.plateId || state.selectedPlateId; if (roomFormPlateId) selectPlate(roomFormPlateId, false); else renderSheets(); return; }
      if (d.deleteRoom) { if (editingRoomId === d.deleteRoom) { editingRoomId = ''; roomFormPlateId = ''; } store.deleteRoom(d.deleteRoom); return; }
      if (d.wlTab) { store.patch({ wlTab: d.wlTab, status: '' }); return; }
      if (d.pkRoomMetric) { pkRoomMetric = d.pkRoomMetric; renderPkView(); return; }
      if ('pkAddRoom' in d) {
        const sel = $('#nx-pk-view')?.querySelector('[data-pk-plate-select]');
        const pid = sel?.value || evalResult.topPlates?.[0]?.plate.id || atlas.plates[0]?.id;
        if (pid) { roomFormPlateId = pid; editingRoomId = ''; if (isMobile()) mobTab = 'map'; selectPlate(pid, true); }
      }
    });

    // 悬停结构化片区信息卡（含涨跌、溢价、负面影响、地铁配套与右键设目的地提示）
    const hCard = $('#nx-hover'), stageEl = $('#nx-stage'), svgEl = $('#nx-svg');
    let lastHover = '';

    function buildHoverHtml(t) {
      if (t.dataset.plate) {
        const r = evalResult.plateRowById.get(t.dataset.plate);
        if (!r) return '';
        const pl = r.plate;
        const scCls = r.fit.total >= 75 ? '' : r.fit.total >= 60 ? ' mid' : ' low';
        const priceHead = `${r.fit.verified ? '✓' : ''}${r.fit.total}分 · ${r.estMonthly ? '约' + money(r.estMonthly) + '/月' : pl.unitPrice + '元/㎡'}`;

        const subParts = [`${pl.district}·${pl.streetName}`];
        if (r.estMonthly) subParts.push(`${pl.unitPrice}元/㎡ × ${state.sqm}㎡`);
        if (r.route) subParts.push(`${state.peak ? '早高峰' : '通勤'} ${r.route.minutes}分 (${r.route.label})`);
        if (r.trend?.yoy != null) subParts.push(`近一年 ${r.trend.yoy > 0 ? '+' : ''}${r.trend.yoy}%`);
        if (r.density != null) subParts.push(`密度 ${(r.density / 10000).toFixed(2)}万/km²(七普)`);

        // 片区情况条：涨跌异动、高溢价、负面影响/避坑提醒
        const alerts = [];
        for (const a of (r.alerts || []).slice(0, 2)) {
          alerts.push(`<div class="nx-hc-alert ${esc(a.level)}"><span class="nx-hc-dot">!</span><span>${esc(a.title)}</span></div>`);
        }
        if (r.premium?.status === 'premium') {
          alerts.push(`<div class="nx-hc-alert prem"><span class="nx-hc-dot">!</span><span>同程高溢价 约¥${Math.round(r.premium.extra)}/月</span></div>`);
        }
        for (const rk of (r.risks || []).slice(0, 2)) {
          const shortRisk = rk.name.split(' · ')[0];
          alerts.push(`<div class="nx-hc-alert risk"><span class="nx-hc-dot">!</span><span>${esc(rk.kind)} · ${esc(shortRisk)}</span></div>`);
        }

        const tags = [];
        const mt = evIcons ? evIcons.formatMetroTag(pl.lines) : null;
        if (mt) tags.push(`<span class="nx-hc-tag"><i class="nx-hc-metro-dot" style="background:${mt.color}"></i>${esc(mt.text)}</span>`);
        if (pl.malls?.length) tags.push(`<span class="nx-hc-tag">${esc(pl.malls[0].name)} ${fmtDist(pl.malls[0].meters)}</span>`);
        if ((pl.facCats || []).includes('park')) tags.push(`<span class="nx-hc-tag">公园</span>`);
        if ((pl.facCats || []).includes('health')) tags.push(`<span class="nx-hc-tag">医疗</span>`);
        if (r.arbitrage?.status === 'opportunity') tags.push(`<span class="nx-hc-tag good">可捡漏</span>`);
        if (r.premium?.status === 'direct') tags.push(`<span class="nx-hc-tag">步行可达</span>`);
        if (r.mastery?.visited) tags.push(`<span class="nx-hc-tag good">${r.mastery.avgStar ? '已看房 ' + r.mastery.avgStar + '★' : '已看房'}</span>`);

        return `<div class="nx-hc-head"><strong>${esc(pl.name)}</strong><span class="nx-hc-price${scCls}">${esc(priceHead)}</span></div>` +
          `<div class="nx-hc-sub">${esc(subParts.join(' · '))}</div>` +
          (alerts.length ? `<div class="nx-hc-alerts">${alerts.slice(0, 3).join('')}</div>` : '') +
          (tags.length ? `<div class="nx-hc-tags">${tags.slice(0, 5).join('')}</div>` : '') +
          `<div class="nx-hc-foot">左键看详情与记看房卡 · 右键设为目的地</div>`;
      }
      if (t.dataset.landmark) {
        const lm = engine.landmarkById.get(t.dataset.landmark);
        if (!lm) return '';
        return `<div class="nx-hc-head"><strong>${esc(lm.name)}</strong></div><div class="nx-hc-sub">${esc(lm.district)} · ${esc(lm.note)}</div><div class="nx-hc-foot">左键看辐射圈 · 右键设为目的地</div>`;
      }
      if (t.dataset.aff) {
        const ar = evalResult.affRowById?.get(t.dataset.aff);
        if (!ar) return '';
        const p = ar.project;
        const pTxt = ar.estMonthly ? `约${money(ar.estMonthly)}/月` : p.unitPrice ? `${p.unitPrice}元/㎡` : p.unitsText;
        return `<div class="nx-hc-head"><strong>${esc(p.name)}</strong><span class="nx-hc-price">${esc(pTxt)}</span></div>` +
          `<div class="nx-hc-sub">${esc([p.phaseLabel, p.audience, p.unitsText, ar.route ? '通勤 ' + ar.route.minutes + '分' : ''].filter(Boolean).join(' · '))}</div>` +
          `<div class="nx-hc-foot">点击查看申请条件与官方公告</div>`;
      }
      if (t.dataset.risk) {
        const rk = engine.riskById.get(t.dataset.risk);
        return rk ? `<div class="nx-hc-head"><strong>${esc(rk.name)}</strong></div><div class="nx-hc-sub">${esc(rk.kind)} · ${esc(rk.status)} · ${esc(rk.observed)}</div><div class="nx-hc-foot">点击查看现场核验建议与出处</div>` : '';
      }
      if (t.dataset.fac) {
        const f = engine.facById.get(t.dataset.fac);
        return f ? `<div class="nx-hc-head"><strong>${esc(f.name)}</strong></div><div class="nx-hc-sub">${esc(FAC_CAT[f.category] || f.category)}${f.address ? ' · ' + esc(f.address) : ''}</div><div class="nx-hc-foot">右键可直接设为目的地</div>` : '';
      }
      if (t.dataset.district) {
        return `<div class="nx-hc-head"><strong>${esc(t.dataset.district)}</strong></div><div class="nx-hc-sub">${esc(t.getAttribute('aria-label') || '')}</div>`;
      }
      return '';
    }

    svgEl.addEventListener('pointermove', ev => {
      if (ev.pointerType !== 'mouse' || svgEl.classList.contains('panning')) { hCard.hidden = true; lastHover = ''; return; }
      const t = ev.target.closest?.('[data-plate],[data-landmark],[data-aff],[data-risk],[data-fac],[data-district]');
      const key = t ? (t.dataset.plate || t.dataset.landmark || t.dataset.aff || t.dataset.risk || t.dataset.fac || t.dataset.district || '') : '';
      if (!key) { hCard.hidden = true; lastHover = ''; return; }
      if (key !== lastHover) {
        lastHover = key;
        hCard.innerHTML = buildHoverHtml(t);
        hCard.hidden = !hCard.innerHTML;
      }
      if (!hCard.hidden) {
        const sr = stageEl.getBoundingClientRect();
        const cw = hCard.offsetWidth || 284;
        const ch = hCard.offsetHeight || 160;
        let left = ev.clientX - sr.left + 16;
        let top = ev.clientY - sr.top + 16;
        if (left + cw > sr.width - 12) left = ev.clientX - sr.left - cw - 14;
        if (top + ch > sr.height - 12) top = ev.clientY - sr.top - ch - 12;
        hCard.style.left = Math.max(8, left) + 'px';
        hCard.style.top = Math.max(8, top) + 'px';
      }
    });
    svgEl.addEventListener('pointerleave', () => { hCard.hidden = true; lastHover = ''; });

    // 地图右键任意片区 / 地标 / 配套：直接一键设为通勤目的地
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
      lastHover = '';
      applyDestination(targetWork);
    });

    // 手机抽屉拖拽手势
    const sheetEl = $('#nx-mobile-sheet');
    let sheetStartY = null, sheetMoved = false;
    sheetEl.addEventListener('pointerdown', ev => {
      if (!ev.target.closest('[data-sheet-handle]')) return;
      sheetStartY = ev.clientY; sheetMoved = false;
    });
    sheetEl.addEventListener('pointermove', ev => { if (sheetStartY != null && Math.abs(ev.clientY - sheetStartY) > 10) sheetMoved = true; });
    sheetEl.addEventListener('pointerup', ev => {
      if (sheetStartY == null) return;
      const dy = ev.clientY - sheetStartY; sheetStartY = null;
      if (dy > 55) { if (sheetEl.classList.contains('sheet-tall')) sheetEl.classList.remove('sheet-tall'); else clearSelection(); }
      else if (dy < -40 || !sheetMoved) sheetEl.classList.toggle('sheet-tall');
    });

    let resizeTimer = 0;
    global.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { if (evalResult) refresh(); }, 100);
    });

    if (typeof ResizeObserver === 'function') {
      let raf = 0;
      new ResizeObserver(() => {
        if (!raf) raf = requestAnimationFrame(() => { if (evalResult) map.render({ state, evalResult, store, theme, leftInset: currentLeftInset() }); });
      }).observe($('#nx-svg'));
    }

    refresh();
    requestAnimationFrame(() => {
      const initPl = state.selectedPlateId ? engine.plateById.get(state.selectedPlateId) : null;
      fitIntoSafeArea(initPl ? initPl.bounds : map.world);
      map.render({ state, evalResult, store, theme, leftInset: currentLeftInset() });
    });
  }

  if (typeof document !== 'undefined') bootNext();
})(typeof window !== 'undefined' ? window : globalThis);
