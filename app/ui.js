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
    let noteFormOpen = false, roomFormPlateId = '', editingRoomId = '';
    let toastTimer = 0, prevWorkName = '';
    const shortDestName = name => String(name || '').replace(/板块$/, '');
    const isCurDest = (...names) => !!evalResult?.dest1 && names.some(n => n && (evalResult.dest1.name === n || shortDestName(evalResult.dest1.name) === shortDestName(n)));
    const STAR_LABELS = { light: '采光通风', quiet: '隔音安静', appliance: '水压家电', walk: '步行到站', life: '买菜快递', landlord: '房东靠谱' };
    const HOUSING_TYPE_OPTS = ['电梯小区', '老小区', '品牌公寓', '城中村'];
    const profileMeta = id => store.PROFILES.find(p => p.id === id) || { id: 'custom', icon: '🎛️', name: '自定义权重', short: '自定义' };

    const store = global.createV3Store(() => refresh());
    const state = store.state;
    map = global.createV3Map($('#atlas-svg'), atlas, engine, timing, esc);
    const evIcons = global.V3EventIcons;

    $('#dest-options').innerHTML = atlas.destinations
      .map(d => `<option value="${esc(d.name)}"></option>`).join('');

    $('#help-pop').innerHTML = `
      <p><strong>独立租房评分副驾驶（数据核验至 ${esc(atlas.asOf || '最新')}）</strong></p>
      <p>• <strong>① 选画像看全城推荐分</strong>：左上角「★ Top 5 推荐」一键切换 均衡/通勤/省钱/品质 权重，117 个片区按 0–100 分动态排序。</p>
      <p>• <strong>② 实地看房「一房一卡」</strong>：点片区 →「+ 记一套看过的房」，自动算清标价+物业+网费+商水商电+中介摊销后的<strong>真实月全成本</strong>，勾出硬伤自动扣分，并在「★ 看房 PK」横向排名。</p>
      <p>• <strong>③ 独立中立与合规说明</strong>：本工具仅提供片区级统计参考区间及政府公开数据（七普人口、保租房通告、地铁/配套与环评施工公告），<strong>不展示第三方平台具体挂牌房源、不做中介引流</strong>；你看过的具体房源与评分全部保存在本机浏览器，支持 JSON 备份。</p>
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
      const isMobile = () => (global.innerWidth || 1200) <= 820;
      if (evalResult.dest1) {
        hub.hidden = false;
        sBox.classList.remove('needs-dest');
        sWrap.classList.add('compact');
        $('#omni-input').placeholder = isMobile() ? '切换目的地/片区…' : '切换目的地或搜片区…';
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
        $('#omni-input').placeholder = isMobile() ? '① 先设通勤目的地…' : '① 先设目的地（园区 / 商圈 / 地铁 / 小区）…';
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
      renderRankPanel();
    }

    function renderRankPanel() {
      const panel = $('#rank-panel');
      const hidePanel = state.macroOpen || state.housingTrack === 'affordable' || state.watchlistOpen;
      panel.hidden = hidePanel;
      if (hidePanel) return;

      const pm = profileMeta(state.profile);
      const top = evalResult.topPlates || [];
      const top1Hint = !state.rankOpen && top[0] ? ` · #1 ${top[0].plate.name} ${top[0].fit.total}分` : ` · ${evalResult.eligiblePlates.length}处`;
      const toggleBtn = $('#rank-toggle-btn');
      toggleBtn.innerHTML = `★ Top 5 推荐 <span class="rk-tag">${esc(pm.icon + ' ' + pm.short)}</span>${esc(top1Hint)} ${state.rankOpen ? '▴' : '▾'}`;
      toggleBtn.setAttribute('aria-expanded', String(!!state.rankOpen));

      const body = $('#rank-body');
      const keepWeightsOpen = !!body.querySelector('.rank-weights')?.open;
      body.hidden = !state.rankOpen;
      if (!state.rankOpen) return;

      const nw = engine.normalizedWeights(state.weights);
      const pct = k => Math.round(nw[k] * 100);
      const profBtns = store.PROFILES.map(p =>
        `<button type="button" data-profile="${esc(p.id)}" aria-pressed="${state.profile === p.id}" title="${esc(p.desc)}">${esc(p.icon + p.short)}</button>`
      ).join('');

      const weightRows = store.WEIGHT_KEYS.map(k =>
        `<label class="rank-w-row"><span>${esc(engine.FIT_NAMES[k])}</span><input type="range" min="0" max="70" step="5" value="${state.weights[k] ?? 20}" data-weight="${k}"><span>${pct(k)}%</span></label>`
      ).join('');

      const destTip = !evalResult.dest1
        ? `<div class="rank-tip"><span>设工作地后按通勤精准重排</span><button type="button" data-prompt-work>设目的地</button></div>`
        : '';

      const listHtml = top.length
        ? `<ol class="rank-list">${top.map((r, i) => {
            const sc = r.fit.total;
            const scCls = sc >= 72 ? '' : sc >= 60 ? ' mid' : ' low';
            const numCls = i === 0 ? ' top1' : i === 1 ? ' top2' : i === 2 ? ' top3' : '';
            const priceBit = r.estMonthly ? `约${money(r.estMonthly)}` : `${r.plate.unitPrice}元/㎡`;
            const isSel = r.plate.id === state.selectedPlateId;
            return `<li><button type="button" class="${isSel ? 'is-sel' : ''}" data-pick-plate="${esc(r.plate.id)}">
              <span class="rk-num${numCls}">${i + 1}</span>
              <span class="rk-info">
                <span class="rk-name-row"><span class="rk-name">${esc(r.plate.name)}</span><span class="rk-score${scCls}">${r.fit.verified ? '✓' : ''}${sc}分</span></span>
                <span class="rk-why">${esc([priceBit, r.fit.topReason].filter(Boolean).join(' · '))}</span>
              </span>
            </button></li>`;
          }).join('')}</ol>`
        : `<p class="sub-note" style="color:#a4c6be;margin:4px 0">当前筛选下暂无符合条件的片区，请放宽预算或通勤上限。</p>`;

      body.innerHTML = `
        <div class="rank-profiles" role="group" aria-label="找房偏好画像">${profBtns}</div>
        <details class="rank-weights"${keepWeightsOpen ? ' open' : ''}><summary><span>微调权重（符合 ${evalResult.eligiblePlates.length} 处）</span><span>通勤${pct('commute')}% · 租金${pct('rent')}% ▾</span></summary><div class="rank-w-grid">${weightRows}</div></details>
        ${destTip}${listHtml}
      `;
    }

    function renderMapFilterPanel() {
      const L = state.layers || {};
      const isAff = state.housingTrack === 'affordable';
      const mf = state.mapFilter || { hub: true, mall: true, transit: true, terrain: true, neutralEvents: true, majorAlerts: true };
      const hiddenCount = ['hub', 'mall', 'transit', 'terrain', 'neutralEvents', 'majorAlerts'].filter(k => mf[k] === false).length;
      const extraDataCount = isAff ? 0 : ['trend', 'premium', 'density'].filter(k => L[k]).length;
      const overlayCount = (L.facilities ? 1 : 0) + (L.risks ? 1 : 0) + extraDataCount;
      const badge = $('#map-filter-badge');
      const btn = $('#map-filter-btn');
      if (hiddenCount === 6 && !overlayCount) {
        badge.textContent = '极简';
        badge.hidden = false;
        btn.classList.add('active');
      } else if (hiddenCount || overlayCount) {
        const parts = [];
        if (overlayCount) parts.push(`+${overlayCount}`);
        if (hiddenCount) parts.push(`藏${hiddenCount}`);
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

      const extraDataSec = !isAff
        ? `<div class="mf-sec">
            <div class="mf-sec-title"><span>进阶数据叠加</span><span>可多选组合</span></div>
            <div class="mf-chips">
              <button type="button" class="mf-chip" data-layer="trend" aria-pressed="${!!L.trend}">租金涨跌</button>
              <button type="button" class="mf-chip" data-layer="premium" aria-pressed="${!!L.premium}">捡漏 / 高溢价</button>
              <button type="button" class="mf-chip" data-layer="density" aria-pressed="${!!L.density}">街道人口密度</button>
            </div>
          </div>`
        : '';

      $('#map-filter-pop').innerHTML = `
        <div class="mf-head">
          <strong>数据叠加与地图筛选</strong>
          <div class="mf-presets">
            <button type="button" data-map-preset="minimal">极简只看片区</button>
            <button type="button" data-map-preset="default">恢复默认</button>
          </div>
        </div>
        ${extraDataSec}
        <div class="mf-sec">
          <div class="mf-sec-title"><span>地图参照物</span><span>点击开关</span></div>
          <div class="mf-chips">
            <button type="button" class="mf-chip" data-map-filter="hub" aria-pressed="${mf.hub !== false}">◆ 办公园区</button>
            <button type="button" class="mf-chip" data-map-filter="mall" aria-pressed="${mf.mall !== false}">◆ 商圈商场</button>
            <button type="button" class="mf-chip" data-map-filter="transit" aria-pressed="${mf.transit !== false}">◆ 交通枢纽</button>
            <button type="button" class="mf-chip" data-map-filter="terrain" aria-pressed="${mf.terrain !== false}">山体水库</button>
          </div>
        </div>
        <div class="mf-sec">
          <div class="mf-sec-title"><span>提醒与配套点位</span></div>
          <div class="mf-chips">
            <button type="button" class="mf-chip is-risk" data-map-filter="majorAlerts" aria-pressed="${mf.majorAlerts !== false}">! 价格异动</button>
            <button type="button" class="mf-chip" data-map-filter="neutralEvents" aria-pressed="${mf.neutralEvents !== false}">外迁参照线</button>
            <button type="button" class="mf-chip" data-layer="facilities" aria-pressed="${!!L.facilities}">利好配套</button>
            <button type="button" class="mf-chip is-risk" data-layer="risks" aria-pressed="${!!L.risks}">避坑提醒</button>
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
      if (row.mastery?.visited) sigHtml += `<span class="sig-pill sig-opp">✓ 已看房${row.mastery.roomCount ? ' ' + row.mastery.roomCount + '套' : ''}${row.mastery.avgStar ? ' ' + row.mastery.avgStar + '★' : ''}</span>`;

      // V6 极简四维 2×2 评分卡（高度减半，视觉呼吸感大幅提升）
      const pm = profileMeta(state.profile);
      const rankPos = evalResult.topRankById?.get(pl.id) || 0;
      const scCls = sc => sc >= 72 ? '' : sc >= 60 ? ' mid' : ' low';
      const shortWhy = d => String(d.why || '').replace(/^预估 · /, '').split(' · ').slice(0, 2).join(' · ');
      const scoreCardHtml = `<div class="score-card">
        <div class="score-grid-4">${engine.FIT_KEYS.map(k => {
          const d = row.fit.dimensions[k];
          return `<div class="score-cell">
            <div class="score-cell-top"><span>${esc(engine.FIT_NAMES[k])}</span><strong>${d.score}分</strong></div>
            <div class="score-track"><div class="score-fill${scCls(d.score)}" style="width:${d.score}%"></div></div>
            <div class="score-cell-why" title="${esc(d.why)}">${esc(shortWhy(d))}</div>
          </div>`;
        }).join('')}</div>
      </div>`;

      // V5 片区内「一房一卡」实看表单（支持新增与编辑，实时计算真实月全成本 + 红灯硬伤扣分）
      const editingRoom = editingRoomId ? store.getRoom(editingRoomId) : null;
      const showRoomForm = roomFormPlateId === pl.id;
      let roomFormHtml = '';
      if (showRoomForm) {
        const rm = editingRoom && editingRoom.plateId === pl.id ? editingRoom : null;
        const starSel = (k, val) => `<label>${esc(STAR_LABELS[k])}<select name="star_${k}"><option value="">未评</option>${[5, 4, 3, 2, 1].map(n => `<option value="${n}"${val === n ? ' selected' : ''}>${n}★</option>`).join('')}</select></label>`;
        const initBase = rm?.rent || (row.estMonthly || (pl.unitPrice ? pl.unitPrice * 35 : 2500));
        const initUtilMode = rm?.utilityMode || 'civil';
        const initUtilExtra = initUtilMode === 'commercial' ? 220 : (initUtilMode === 'custom' ? (rm?.utilityExtra || 0) : 0);
        const initHidden = (rm?.mgmtFee || 0) + (rm?.netFee || 0) + initUtilExtra + Math.round((rm?.agencyFee || 0) / 12);
        const initTrue = initBase + initHidden;
        roomFormHtml = `<form class="room-form" data-room-form data-plate-id="${esc(pl.id)}" data-plate-name="${esc(pl.name)}" data-room-id="${esc(rm?.id || '')}">
          <h4><span>${rm ? '编辑看房卡片' : '记一套看过的房（一房一卡）'}</span><button type="button" class="link-btn" data-cancel-room-form>收起</button></h4>
          <label>小区 / 楼栋房号 *<input name="title" type="text" required value="${esc(rm?.title || '')}" placeholder="例：${esc(pl.name)}花园 3栋802 / B栋503"></label>
          <div class="rf-grid-3">
            <label>房源类型<select name="housingType">${HOUSING_TYPE_OPTS.map(t => `<option value="${esc(t)}"${(rm?.housingType || '电梯小区') === t ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
            <label>面积(㎡)<input name="areaSqm" type="number" min="5" max="300" step="1" value="${rm?.areaSqm ?? (state.sqm || '')}" placeholder="如 35"></label>
            <label>步行到站(分)<input name="walkMin" type="number" min="1" max="60" step="1" value="${rm?.walkMin ?? ''}" placeholder="选填"></label>
          </div>
          <div class="rf-grid-2">
            <label>标价月租(元) *<input name="rent" type="number" min="100" max="100000" step="50" required value="${rm?.rent ?? initBase}" placeholder="月租标价"></label>
            <label>物业/管理/服务费(元/月)<input name="mgmtFee" type="number" min="0" max="10000" step="10" value="${rm?.mgmtFee ?? 0}" placeholder="0"></label>
          </div>
          <div class="rf-grid-2">
            <label>网费/垃圾费等(元/月)<input name="netFee" type="number" min="0" max="2000" step="10" value="${rm?.netFee ?? 0}" placeholder="0"></label>
            <label>中介/服务费(一次性元)<input name="agencyFee" type="number" min="0" max="50000" step="100" value="${rm?.agencyFee ?? 0}" placeholder="自动按12个月摊销"></label>
          </div>
          <div class="rf-grid-2">
            <label>水电性质<select name="utilityMode">
              <option value="civil"${initUtilMode === 'civil' ? ' selected' : ''}>民水民电 (+¥0/月)</option>
              <option value="commercial"${initUtilMode === 'commercial' ? ' selected' : ''}>商水商电 (自动估 +¥220/月)</option>
              <option value="custom"${initUtilMode === 'custom' ? ' selected' : ''}>自定义水电差价</option>
            </select></label>
            <label data-util-custom-wrap${initUtilMode === 'custom' ? '' : ' hidden'}>水电月均多花(元)<input name="utilityExtra" type="number" min="0" max="3000" step="20" value="${rm?.utilityExtra ?? 200}"></label>
          </div>
          <div class="true-cost-preview" data-true-cost-preview>
            <span>真实月总支出</span>
            <strong>${money(initTrue)}/月</strong>
            <span class="sub-note" style="margin:0;width:100%">含隐形杂费 +${money(initHidden)}/月（物业+网费+水电差价+中介费/12）</span>
          </div>
          <div>
            <div class="sub-note" style="margin:0 0 4px;font-weight:650">现场排雷硬伤（每勾选 1 项扣 12 分）</div>
            <div class="rf-flag-grid">${store.RED_FLAGS.map(f => `<label class="rf-flag-lbl"><input type="checkbox" name="redFlags" value="${esc(f.id)}"${(rm?.redFlags || []).includes(f.id) ? ' checked' : ''}><span>${esc(f.label)}</span></label>`).join('')}</div>
          </div>
          <div class="rf-grid-3">${store.STAR_KEYS.map(k => starSel(k, rm?.stars?.[k] ?? null)).join('')}</div>
          <label>看房备忘（朝向、电梯排队、房东谈价底线…）<textarea name="note" rows="2" placeholder="写下看完房最直观的优缺点，方便晚上横向 PK">${esc(rm?.note || '')}</textarea></label>
          <div class="drawer-actions" style="margin:0">
            <button type="submit" class="btn-primary">保存并计分</button>
            <button type="button" class="btn-ghost" data-cancel-room-form>取消</button>
          </div>
        </form>`;
      }

      // 片区内已看过的具体房源卡片列表
      const flagLabelById = new Map(store.RED_FLAGS.map(f => [f.id, f.label]));
      const plateRoomsHtml = row.rooms?.length
        ? `<div class="sec-head"><h3>我在本片区看过的房 (${row.rooms.length}套)</h3><button type="button" class="link-btn" data-open-pk>去 PK 榜对比 →</button></div>
          <ul class="room-card-list">${row.rooms.map(rm => {
            const flagHtml = rm.redFlags.length
              ? rm.redFlags.map(id => `<span class="flag-pill">⚠ ${esc(flagLabelById.get(id) || id)}</span>`).join('')
              : `<span class="flag-ok">✓ 零红灯硬伤</span>`;
            const starBits = store.STAR_KEYS.filter(k => rm.stars?.[k]).map(k => `${STAR_LABELS[k].slice(0, 2)}${rm.stars[k]}★`).join(' · ');
            return `<li class="room-card-item">
              <div class="room-card-top">
                <strong>${esc(rm.title)} <span class="micro-tag">${esc(rm.housingType)}${rm.areaSqm ? ' · ' + rm.areaSqm + '㎡' : ''}</span></strong>
                <span class="room-score-pill${rm.total < 65 ? ' low' : ''}">${rm.total}分</span>
              </div>
              <div class="room-cost-line">真实月全成本 <strong>${money(rm.trueMonthly)}/月</strong>${rm.hiddenMonthly > 0 ? `<span class="room-hidden-tag">比标价多 ${money(rm.hiddenMonthly)}/月</span>` : `<span class="sub-note" style="margin-left:4px">（标价 ${money(rm.baseRent)} · 零杂费）</span>`}</div>
              <div class="room-flags">${flagHtml}</div>
              ${starBits ? `<p class="sub-note">${esc(starBits)}</p>` : ''}
              ${rm.note ? `<p class="sub-note" style="color:var(--fg)">${esc(rm.note)}</p>` : ''}
              <div class="room-card-foot">
                <span class="sub-note" style="margin:0">${esc(rm.observed)}</span>
                <div>
                  <button type="button" class="btn-ghost" data-edit-room="${esc(rm.id)}" data-plate-id="${esc(pl.id)}">编辑</button>
                  <button type="button" class="btn-ghost" data-delete-room="${esc(rm.id)}">删除</button>
                </div>
              </div>
            </li>`;
          }).join('')}</ul>`
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

      // 捡漏/谈价线索（精简收纳进折叠区）
      const reasonCard = row.arbitrage.reasons.length
        ? `<div class="alert-card is-opp"><div class="alert-head"><span>↘ 捡漏 / 谈价线索</span></div>${row.arbitrage.reasons.map(r => `<p class="sub-note" style="color:var(--fg)">• ${esc(r)}</p>`).join('')}</div>`
        : '';
      const evPolCount = row.events.length + row.policies.length;

      // 仅保留「片区级大类统计参考区间」（去商业平台引流直链 & 去品牌门店具体挂牌报价，彻底消除侵权/导流风险）
      const marketRents = row.rentsMatched.filter(r => r.grain !== 'official_affordable');
      const affRents = row.rentsMatched.filter(r => r.grain === 'official_affordable');
      const catBands = [];
      const seenCat = new Set();
      for (const r of marketRents) {
        const key = `${r.type || 'all'}_${r.room}`;
        if (seenCat.has(key)) continue;
        seenCat.add(key);
        catBands.push(r);
        if (catBands.length >= 4) break;
      }
      const rentBandsHtml = catBands.length
        ? `<ul class="rent-list">${catBands.map(r => {
            const tLabel = atlas.housingTypeMeta[r.type]?.label || '片区综合';
            const priceStr = r.low === r.high ? money(r.median) : `${money(r.low)}–${money(r.high)}`;
            return `<li><div class="rent-line"><span><strong>${esc(tLabel)} · ${ROOM_LABEL[r.room] || r.room + '室'}</strong></span><span class="rent-price">${esc(priceStr)}</span></div>
              <p class="sub-note">${r.sqm ? `${r.sqm[0]}${r.sqm[1] !== r.sqm[0] ? '–' + r.sqm[1] : ''}㎡ · ` : ''}${esc(r.period)} 片区参考区间（非具体挂牌）</p></li>`;
          }).join('')}</ul>`
        : '';

      // 折叠组 1：片区行情、议价/溢价与参考区间（默认收起，保持主界面清爽）
      const marketTags = [];
      if (row.alerts?.some(a => a.priority >= 2)) marketTags.push(row.alerts[0].short);
      if (row.premium?.status === 'premium') marketTags.push('高溢价');
      else if (row.arbitrage.status === 'opportunity') marketTags.push('可捡漏');
      if (row.trend?.yoy != null) marketTags.push(`同比${row.trend.yoy > 0 ? '+' : ''}${row.trend.yoy}%`);
      const marketFoldHtml = (majorAlertHtml || premHtml || reasonCard || rentBandsHtml)
        ? `<details class="drawer-fold">
            <summary><span class="fold-title">片区行情与参考区间</span><span class="fold-tags">${marketTags.slice(0, 2).map(t => `<span class="micro-tag">${esc(t)}</span>`).join('')}</span></summary>
            <div class="fold-body">
              ${majorAlertHtml}${premHtml}${reasonCard}${rentBandsHtml}
              <div style="margin-top:8px;display:flex;justify-content:space-between;align-items:center;gap:6px">
                <span class="sub-note" style="margin:0">独立统计参考 · 不做中介导流</span>
                <button type="button" class="btn-ghost" data-toggle-ref="${esc(pl.id)}" aria-pressed="${isRef}">${isRef ? '⇄ 已设为对比' : '⇄ 设为对比片区'}</button>
              </div>
            </div>
          </details>`
        : '';

      // 折叠组 2：周边配套、街道人口与避坑提醒（默认收起）
      const nearFacHtml = row.nearbyFacs.length
        ? `<ul class="clean-list">${row.nearbyFacs.map(f =>
          `<li><strong>${esc(f.name)}</strong><span class="micro-tag">${esc(FAC_CAT[f.category] || f.category)} · ${fmtDist(f.meters)}</span></li>`
        ).join('')}</ul>`
        : '';
      const riskHtml = row.risks.length
        ? `<div class="sec-head" style="margin-top:8px"><h3>公开避坑提醒</h3></div><ul class="clean-list">${row.risks.map(rk => {
          const rt = evIcons.eventTypeFor(rk);
          return `<li>${evIcons.eventIconSvg(rt)} <strong>${esc(rk.name)}</strong>（${esc(rk.observed)}）<p class="sub-note">${esc(rk.check)} ${lnk(rk.url, rk.source)}</p></li>`;
        }).join('')}</ul>`
        : '';
      const envTags = [];
      if (pl.streetDensity != null) envTags.push(`${(pl.streetDensity / 10000).toFixed(2)}万/km²`);
      if (row.risks.length) envTags.push(`${row.risks.length}项避坑`);
      const envCount = row.nearbyFacs.length + row.risks.length;
      const peakFootnote = row.route?.peakDetail ? `<p class="sub-note" style="color:var(--warm);margin:0 0 6px">⏱ ${esc(row.route.peakDetail)}</p>` : '';
      const comm2Footnote = evalResult.dest2 && row.route2 ? `<p class="sub-note" style="margin:0 0 6px">备选工作地 ${esc(evalResult.dest2.name)}：<strong>${row.route2.minutes} 分钟</strong></p>` : '';
      const densityFootnote = pl.streetDensity != null
        ? `<p class="sub-note" style="margin:0 0 6px">${esc(pl.streetName)}人口密度 ${(pl.streetDensity / 10000).toFixed(2)}万/km²（2020七普 ${(pl.streetPop / 10000).toFixed(1)}万人 / ${pl.streetAreaKm2}km²${(pl.subdivided || pl.clipId) ? ' · 同街道片区共用口径' : ''}）</p>`
        : '';
      const envFoldHtml = (envCount || densityFootnote || peakFootnote || comm2Footnote)
        ? `<details class="drawer-fold">
            <summary><span class="fold-title">配套、人口与避坑${envCount ? ' (' + envCount + ')' : ''}</span><span class="fold-tags">${envTags.slice(0, 2).map(t => `<span class="micro-tag">${esc(t)}</span>`).join('')}</span></summary>
            <div class="fold-body">${peakFootnote}${comm2Footnote}${densityFootnote}${nearFacHtml}${riskHtml}</div>
          </details>`
        : '';

      // 折叠组 3：政府保租房与公开政策（仅在有数据时显示，默认收起）
      const affCount = (row.affordable?.length || 0) + affRents.length + evPolCount;
      const affFoldHtml = affCount
        ? `<details class="drawer-fold">
            <summary><span class="fold-title">政府保租房与公开政策 (${affCount})</span><span class="fold-tags">${row.affordable?.length ? `<span class="micro-tag">${row.affordable.length}个保租项目</span>` : ''}</span></summary>
            <div class="fold-body">
              ${row.affordable?.length ? `<ul class="estate-list">${row.affordable.map(ar => {
                const p = ar.project;
                const pMeta = ar.estMonthly ? `约${money(ar.estMonthly)}/月` : p.unitPrice ? `${p.unitPrice}元/㎡` : p.unitsText;
                return `<li><button type="button" data-aff="${esc(p.id)}">${esc(p.shortName)} <span class="micro-tag">${esc(p.phaseLabel)}</span></button><span class="meta">${esc(pMeta)}</span></li>`;
              }).join('')}</ul>` : ''}
              ${evPolCount ? `<ul class="fold-list" style="padding:0;border:0">${[
                ...row.events.map(ev => `<li><span class="fold-main"><strong>${esc(ev.title)}</strong><span class="micro-tag">${esc(ev.date)}</span></span><span class="fold-act">${lnk(ev.source, '原文')}</span></li>`),
                ...row.policies.map(pol => `<li><span class="fold-main"><strong>${esc(pol.title)}</strong><span class="micro-tag">${esc(pol.status)}</span></span><span class="fold-act">${lnk(pol.source, '公告')}</span></li>`),
              ].join('')}</ul>` : ''}
            </div>
          </details>`
        : '';

      const starOpts = v => `<option value="">未评</option>` + [1, 2, 3, 4, 5].map(n => `<option value="${n}"${v === n ? ' selected' : ''}>${n}星</option>`).join('');
      const hasNote = !!(entry?.monthly || entry?.environment || entry?.convenience || entry?.note);
      const noteDisplay = hasNote && !noteFormOpen
        ? `<div class="sec-head"><h3>旧版看房笔记</h3><button type="button" class="link-btn" data-toggle-note>编辑</button></div>
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

      // 简洁双列 KPI（通勤 + 估月租）+ 一行精炼标签条
      const kpiComm = evalResult.dest1
        ? (row.route
            ? `<div class="kpi-card"><div class="kpi-lbl"><span>${state.peak ? '早高峰估时' : '单程通勤'}</span>${lnk(navUrl, '高德')}</div><div class="kpi-val">${row.route.minutes} 分</div><div class="kpi-sub">${esc(row.route.label)}</div></div>`
            : `<div class="kpi-card"><div class="kpi-lbl"><span>单程通勤</span></div><div class="kpi-val">—</div><div class="kpi-sub">暂无估时</div></div>`)
        : `<div class="kpi-card"><div class="kpi-lbl"><span>单程通勤</span></div><div class="kpi-val"><button type="button" class="link-btn" style="font-size:14px;font-weight:700" data-prompt-work>设工作地 →</button></div><div class="kpi-sub">${pl.lines?.length ? esc(pl.lines.join('/') + '号线') : '点击测算耗时'}</div></div>`;
      const kpiRent = row.estMonthly
        ? `<div class="kpi-card"><div class="kpi-lbl"><span>参考月租</span><span>${state.sqm}㎡</span></div><div class="kpi-val">约 ${money(row.estMonthly)}</div><div class="kpi-sub">${pl.unitPrice}元/㎡ · 片区统计</div></div>`
        : `<div class="kpi-card"><div class="kpi-lbl"><span>参考均价</span></div><div class="kpi-val">${pl.unitPrice} 元/㎡</div><div class="kpi-sub">${esc(pl.unitBasis)}</div></div>`;

      const topTags = [];
      if (rankPos) topTags.push(`<span class="pk-crown" style="margin:0">全城 #${rankPos}</span>`);
      if (sigHtml) topTags.push(sigHtml);
      if (row.alerts?.some(a => a.priority >= 2)) topTags.push(`<span class="flag-pill">! ${esc(row.alerts[0].short)}</span>`);
      if (pl.streetDensity != null) topTags.push(`<span class="micro-tag" style="margin:0">${pl.streetDensity < 8000 ? '低密' : pl.streetDensity >= 22000 ? '高密' : '密度'} ${(pl.streetDensity / 10000).toFixed(2)}万/km²</span>`);
      if (row.fit.premiumPenalty) topTags.push(`<span class="flag-pill">溢价 −${row.fit.premiumPenalty}分</span>`);

      const kickerParts = [pl.district, pl.station ? pl.station + '站' : pl.streetName, pl.lines?.length ? pl.lines.join('/') + '号线' : ''].filter(Boolean);

      return `<div class="drawer-head">
          <p class="drawer-kicker">${esc(kickerParts.join(' · '))}</p>
          <button type="button" class="drawer-close" data-close-drawer title="收起">×</button>
        </div>
        <div class="drawer-title-row">
          <h2>${esc(pl.name)}</h2>
          <span class="hero-score-badge${scCls(row.fit.total)}" title="按「${esc(pm.name)}」画像加权计算"><strong>${row.fit.total}</strong><span>分${row.fit.verified ? ' · 实看' : ''}</span></span>
        </div>
        ${row.exclusions.length ? `<p class="sub-note" style="color:var(--warm);margin:0 0 6px">当前筛选外：${esc(row.exclusions.join('、'))}</p>` : ''}
        <div class="kpi-grid">${kpiComm}${kpiRent}</div>
        ${topTags.length ? `<div class="tag-strip">${topTags.join('')}</div>` : ''}
        ${deltaHtml}
        ${scoreCardHtml}
        <div class="drawer-actions compact-row">
          <button type="button" class="btn-primary" data-open-room-form="${esc(pl.id)}">+ 记一套看过的房</button>
          <button type="button" class="${saved ? 'btn-primary' : 'btn-ghost'}" data-toggle-save="${esc(pl.id)}" data-save-name="${esc(pl.name + '片区')}">${saved ? '★ 已藏' : '☆ 收藏'}</button>
          ${isCurDest(pl.name, pl.name + '板块')
            ? `<button type="button" class="btn-dest is-current" data-clear-work title="点击取消目的地">★ 目的地 ×</button>`
            : `<button type="button" class="btn-ghost" data-set-work="${esc(pl.name + '板块')}">设工作地</button>`}
        </div>
        ${roomFormHtml}${plateRoomsHtml}${noteFormHtml}${noteDisplay}${marketFoldHtml}${envFoldHtml}${affFoldHtml}`;
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
        const wasHidden = el.hidden;
        el.innerHTML = `<div class="sheet-handle" data-sheet-handle role="button" tabindex="0" aria-label="拖动调整抽屉高度或下滑关闭"></div>` + html;
        if (wasHidden) el.classList.remove('sheet-tall');
        if (roomFormPlateId && roomFormPlateId === state.selectedPlateId) el.classList.add('sheet-tall');
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
        const rForm = el.querySelector('[data-room-form]');
        if (rForm) {
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
            if (box) {
              box.innerHTML = `<span>真实月总支出</span><strong>${money(base + hid)}/月</strong><span class="sub-note" style="margin:0;width:100%">${hid > 0 ? `比标价多 ${money(hid)}/月（物业${mgmt}+网费${net}+水电差价${uExtra}+中介摊销${agMon}）` : '与标价一致，暂无额外杂费'}</span>`;
            }
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
            if (savedRoom) {
              roomFormPlateId = '';
              editingRoomId = '';
            }
          };
        }
      } else {
        el.hidden = true;
        el.classList.remove('sheet-tall');
        stage.classList.remove('drawer-open');
      }
    }

    function renderWatchlist() {
      const host = $('#watchlist-overlay');
      if (!state.watchlistOpen) { host.hidden = true; return; }
      host.hidden = false;
      const entries = store.savedEntries();
      const scoredRooms = evalResult.scoredRooms || [];
      const activeTab = state.wlTab === 'plates' ? 'plates' : 'rooms';
      const flagLabelById = new Map(store.RED_FLAGS.map(f => [f.id, f.label]));

      const plateOpts = [...atlas.plates]
        .sort((a, b) => a.district.localeCompare(b.district, 'zh-CN') || a.name.localeCompare(b.name, 'zh-CN'))
        .map(p => `<option value="${esc(p.id)}">${esc(p.district.replace(/区$/, '') + ' · ' + p.name)}</option>`).join('');

      let bodyHtml = '';
      if (activeTab === 'rooms') {
        if (scoredRooms.length) {
          const pkCols = scoredRooms.slice(0, 6);
          const pkTable = `<div class="wl-table-wrap"><table class="wl-table"><thead><tr><th>PK 维度</th>${pkCols.map((rm, i) => `<th>
            ${i === 0 ? `<div class="pk-crown">👑 #1 推荐签约</div>` : `<div class="sub-note" style="margin:0 0 3px">第 ${i + 1} 名</div>`}
            <div><strong>${esc(rm.title)}</strong></div>
            <div class="sub-note" style="margin:2px 0 4px">${esc(rm.plateName || rm.plateRow?.plate?.name || '')} · ${esc(rm.housingType)}${rm.areaSqm ? ' ' + rm.areaSqm + '㎡' : ''}</div>
            <div style="display:flex;gap:4px;flex-wrap:wrap">
              ${rm.plateId ? `<button type="button" class="btn-ghost" data-edit-room="${esc(rm.id)}" data-plate-id="${esc(rm.plateId)}">编辑</button>` : ''}
              <button type="button" class="btn-ghost" data-delete-room="${esc(rm.id)}">删除</button>
            </div>
          </th>`).join('')}</tr></thead><tbody>
            <tr><th>综合实测分</th>${pkCols.map(rm => `<td><strong style="font-size:18px;color:${rm.total >= 75 ? 'var(--accent)' : rm.total >= 60 ? '#c99838' : 'var(--warm)'}">${rm.total} 分</strong>${rm.redFlagPenalty ? `<div class="sub-note" style="color:var(--warm)">含硬伤扣 −${rm.redFlagPenalty}分</div>` : '<div class="sub-note">零硬伤扣分</div>'}</td>`).join('')}</tr>
            <tr><th>真实月全成本</th>${pkCols.map(rm => `<td><strong style="font-size:15px">${money(rm.trueMonthly)}/月</strong><div class="sub-note">标价 ${money(rm.baseRent)}${rm.hiddenMonthly > 0 ? ` + 杂费 <span style="color:var(--warm)">${money(rm.hiddenMonthly)}</span>` : '（零隐形杂费）'}</div><div class="sub-note">${[rm.mgmtFee ? '物业' + rm.mgmtFee : '', rm.netFee ? '网费' + rm.netFee : '', rm.utilityExtra ? '商水电+' + rm.utilityExtra : '民水电', rm.agencyMonthly ? '中介摊销' + rm.agencyMonthly : ''].filter(Boolean).join(' · ')}</div></td>`).join('')}</tr>
            <tr><th>通勤估时</th>${pkCols.map(rm => `<td>${rm.commuteMin != null ? `<strong>${rm.commuteMin}分</strong>${rm.walkMin ? `<div class="sub-note">含实测步行 ${rm.walkMin}分</div>` : ''}` : (evalResult.dest1 ? '待核' : '未设工作地')}</td>`).join('')}</tr>
            <tr><th>现场 6 维星评</th>${pkCols.map(rm => {
              const bits = store.STAR_KEYS.filter(k => rm.stars?.[k]).map(k => `${STAR_LABELS[k].slice(0, 2)} ${rm.stars[k]}★`);
              return `<td>${bits.length ? bits.map(b => `<span class="micro-tag" style="margin:0 3px 3px 0;display:inline-block">${esc(b)}</span>`).join('') : '<span class="sub-note">未打星</span>'}</td>`;
            }).join('')}</tr>
            <tr><th>红灯硬伤排雷</th>${pkCols.map(rm => `<td>${rm.redFlags.length ? rm.redFlags.map(id => `<span class="flag-pill" style="display:inline-block;margin:0 3px 3px 0">⚠ ${esc(flagLabelById.get(id) || id)}</span>`).join('') : '<span class="flag-ok">✓ 零硬伤</span>'}</td>`).join('')}</tr>
            <tr><th>看房备忘</th>${pkCols.map(rm => `<td>${rm.note ? esc(rm.note) : '<span class="sub-note">—</span>'}<div class="sub-note">${esc(rm.observed)}</div></td>`).join('')}</tr>
          </tbody></table></div>`;
          bodyHtml = pkTable + `<div class="pk-quick-add"><span class="sub-note" style="margin:0">继续记一套看过的房：</span><select data-pk-plate-select>${plateOpts}</select><button type="button" class="btn-primary" data-pk-add-room>+ 去记录打分</button></div>`;
        } else {
          bodyHtml = `<div class="pk-empty">
            <div><strong style="font-size:15px">还没有记录看过的具体房源</strong><p class="sub-note" style="margin:4px 0 0">周末看完 3–5 套房最容易记混。用「一房一卡」自动算清物业、网费、商水商电和中介费摊销后的<strong>真实月全成本</strong>，勾出暗窗/隔断/蟑螂硬伤，系统会自动排出 #1 推荐签约房源。</p></div>
            <div class="pk-quick-add">
              <select data-pk-plate-select>${plateOpts}</select>
              <button type="button" class="btn-primary" data-pk-add-room>+ 记第一套看过的房</button>
              <button type="button" class="btn-ghost" data-close-wl>先回地图看推荐榜</button>
            </div>
          </div>`;
        }
      } else {
        const rows = entries.map(e => {
          const plateRow = evalResult.plateRowById.get(e.id) || (engine.placeById.get(e.id) ? evalResult.plateRowById.get(engine.placeById.get(e.id).plateId) : null);
          const placeRow = evalResult.placeRowById.get(e.id) || null;
          return { entry: e, plateRow, placeRow };
        });
        const picks = rows.filter(x => x.plateRow).slice(0, 5);
        const compareHtml = picks.length >= 2 ? `<div class="wl-table-wrap"><table class="wl-table"><thead><tr><th>维度</th>${picks.map(x => `<th><button type="button" class="btn-ghost" data-jump-id="${esc(x.entry.id)}">${esc(x.entry.name)}</button></th>`).join('')}</tr></thead><tbody>
          <tr><th>综合推荐分</th>${picks.map(x => `<td><strong style="font-size:16px;color:var(--accent)">${x.plateRow.fit.total} 分</strong><div class="sub-note">${esc(x.plateRow.fit.topReason)}</div></td>`).join('')}</tr>
          <tr><th>每平米均价</th>${picks.map(x => `<td><strong>${x.plateRow.plate.unitPrice}元/㎡</strong><div class="sub-note">${esc(x.plateRow.plate.unitBasis)}</div></td>`).join('')}</tr>
          <tr><th>单程通勤</th>${picks.map(x => {
            const rt = x.placeRow?.route || x.plateRow.route;
            return `<td>${evalResult.dest1 ? (rt ? `<strong>${rt.minutes}分</strong> ${esc(rt.label)}` : '待核') : '未设目的地'}</td>`;
          }).join('')}</tr>
          <tr><th>捡漏/避贵</th>${picks.map(x => `<td>${x.plateRow.premium?.status === 'premium' ? `<span class="sig-pill sig-prem">↑溢价¥${Math.round(x.plateRow.premium.extra)}</span>` : x.plateRow.arbitrage.status === 'opportunity' ? `<span class="sig-pill sig-opp">↘可捡漏</span>` : '—'}</td>`).join('')}</tr>
          <tr><th>我的实录</th>${picks.map(x => `<td>${[x.plateRow.rooms?.length ? '已看 ' + x.plateRow.rooms.length + ' 套房' : '', x.entry.monthly ? '实谈' + money(x.entry.monthly) : '', x.entry.environment ? '环境' + x.entry.environment + '星' : '', x.entry.convenience ? '便利' + x.entry.convenience + '星' : ''].filter(Boolean).join(' · ') || '未记'}${x.entry.note ? `<div class="sub-note">${esc(x.entry.note)}</div>` : ''}</td>`).join('')}</tr>
        </tbody></table></div>` : '';

        const listHtml = entries.length ? `<ul class="clean-list">${rows.map(({ entry, plateRow }) => `<li>
          <div class="rent-line"><strong>${esc(entry.name)}${plateRow ? ` <span class="micro-tag">${plateRow.fit.total}分</span>` : ''}</strong><div>${plateRow ? `<button type="button" class="btn-ghost" data-jump-id="${esc(entry.id)}">地图查看</button> ` : ''}<button type="button" class="btn-ghost" data-toggle-save="${esc(entry.id)}" data-save-name="${esc(entry.name)}">${entry.saved ? '移除' : '重藏'}</button></div></div>
          <p class="sub-note">${[entry.monthly ? '实谈 ' + money(entry.monthly) : '', entry.environment ? '环境' + entry.environment + '星' : '', entry.convenience ? '便利' + entry.convenience + '星' : '', entry.observed || '', entry.note || ''].filter(Boolean).join(' · ') || '已收藏，看房后可记一套实看卡片。'}</p>
        </li>`).join('')}</ul>` : '<p class="sub-note">还没有收藏片区，点击地图任意片区并点「收藏」即可横向对比。</p>';
        bodyHtml = compareHtml + listHtml;
      }

      host.innerHTML = `<div class="wl-inner">
        <div class="wl-head">
          <div><h2 style="margin:0">看房打分 PK 台</h2><p class="sub-note">真实月全成本 + 红灯排雷自动排序 · 100% 兼容旧版收藏手记 JSON 备份</p></div>
          <div class="drawer-actions" style="margin:0">
            <button type="button" id="btn-export-wl" class="btn-ghost">导出 JSON</button>
            <label class="btn-ghost" style="cursor:pointer">导入备份<input id="input-import-wl" type="file" accept=".json,application/json" hidden></label>
            <button type="button" class="btn-primary" data-close-wl>返回地图</button>
          </div>
        </div>
        <div class="pk-tabs" role="tablist">
          <button type="button" data-wl-tab="rooms" aria-pressed="${activeTab === 'rooms'}">实地看房 PK 榜 (${scoredRooms.length}套)</button>
          <button type="button" data-wl-tab="plates" aria-pressed="${activeTab === 'plates'}">收藏片区对比 (${entries.length}处)</button>
        </div>
        ${bodyHtml}</div>`;

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
      if ((state.mode === 'drive' || state.mode === 'bus') && !engine.isModeReady(state.mode)) {
        const targetMode = state.mode;
        engine.ensureModeReady(targetMode).then(ok => {
          if (ok && state.mode === targetMode) refresh();
        });
      }
      evalResult = engine.evaluateAll(state, store);
      syncTopbar();
      renderSubPills();

      const savedCount = store.savedEntries().filter(e => e.saved).length + (evalResult.scoredRooms?.length || 0);
      $('#saved-count').textContent = String(savedCount);
      const L = state.layers || {};
      showToast(state.status);

      const isRadial = !!L.commute && state.layout === 'radial' && !!evalResult.dest1;
      $('#zoom-box').hidden = isRadial;

      const legendHtml = map.render({ state, evalResult, store });
      $('#map-legend').innerHTML = legendHtml;
      renderDrawer();
      renderWatchlist();
    }

    function clearSelection() {
      noteFormOpen = false; roomFormPlateId = ''; editingRoomId = '';
      store.patch({
        selectedPlateId: '', selectedPlaceId: '', selectedLandmarkId: '',
        selectedDistrict: '', selectedRiskId: '', selectedFacilityId: '', selectedAffId: '',
      });
    }

    function fitForDrawer(bounds) {
      const mobileSheet = (global.innerWidth || 1200) <= 820;
      const padBottom = mobileSheet ? Math.round(($('#stage')?.clientHeight || 600) * 0.54) : 0;
      map.camera.fit(bounds, { padBottom });
    }

    function selectPlate(plateId, fitCamera = false) {
      const pl = engine.plateById.get(plateId);
      if (!pl) return;
      state.seen.add(plateId);
      noteFormOpen = false;
      if (roomFormPlateId && roomFormPlateId !== plateId) { roomFormPlateId = ''; editingRoomId = ''; }
      if (fitCamera || (global.innerWidth || 1200) <= 820) fitForDrawer(pl.bounds);
      // 选定片区拉出抽屉时自动收起左侧推荐榜，杜绝左右双面板夹击地图
      const autoFoldRank = state.rankOpen && ((global.innerWidth || 1200) < 1440);
      store.patch({
        watchlistOpen: false, macroOpen: false,
        rankOpen: autoFoldRank ? false : state.rankOpen,
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
      if (fitCamera && pl) fitForDrawer(pl.bounds);
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

    $('#rank-toggle-btn').onclick = () => store.patch({ rankOpen: !state.rankOpen, status: '' });
    $('#rank-body').addEventListener('change', ev => {
      const inp = ev.target.closest('[data-weight]');
      if (inp) store.setWeight(inp.dataset.weight, inp.value);
    });

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

    // 全局点击代理
    document.body.addEventListener('click', ev => {
      if (!ev.target.closest('.pop-anchor,.search-wrap')) closePopovers();

      const el = ev.target.closest('[data-profile],[data-open-room-form],[data-cancel-room-form],[data-edit-room],[data-delete-room],[data-wl-tab],[data-open-pk],[data-pk-add-room],[data-track],[data-map-filter],[data-map-preset],[data-set-work],[data-set-work2],[data-clear-work],[data-prompt-work],[data-sqm-quick],[data-htype],[data-mode],[data-peak],[data-layer],[data-fill-layer],[data-trend-kind],[data-toggle-macro],[data-close-macro],[data-aff-filter],[data-macro],[data-layout],[data-zoom],[data-plate],[data-pick-plate],[data-back-plate],[data-open-place],[data-aff],[data-landmark],[data-district],[data-risk],[data-fac],[data-risk-filter],[data-fac-filter],[data-toggle-save],[data-toggle-ref],[data-toggle-hub],[data-toggle-note],[data-close-drawer],[data-close-wl],[data-jump-id]');
      if (!el) {
        if (ev.target === $('#atlas-svg') && (state.selectedPlateId || state.selectedPlaceId || state.selectedLandmarkId || state.selectedDistrict || state.selectedRiskId || state.selectedFacilityId || state.selectedAffId)) {
          clearSelection();
        }
        return;
      }

      const d = el.dataset;
      if (d.profile) { store.setProfile(d.profile); return; }
      if (d.openRoomForm) {
        roomFormPlateId = d.openRoomForm;
        editingRoomId = '';
        renderDrawer();
        return;
      }
      if ('cancelRoomForm' in d) { roomFormPlateId = ''; editingRoomId = ''; renderDrawer(); return; }
      if (d.editRoom) {
        editingRoomId = d.editRoom;
        roomFormPlateId = d.plateId || state.selectedPlateId;
        if (state.watchlistOpen && roomFormPlateId) {
          selectPlate(roomFormPlateId, true);
        } else {
          renderDrawer();
        }
        return;
      }
      if (d.deleteRoom) {
        if (editingRoomId === d.deleteRoom) { editingRoomId = ''; roomFormPlateId = ''; }
        store.deleteRoom(d.deleteRoom);
        return;
      }
      if (d.wlTab) { store.patch({ wlTab: d.wlTab, status: '' }); return; }
      if ('openPk' in d) { closePopovers(); store.patch({ watchlistOpen: true, wlTab: 'rooms', status: '' }); return; }
      if ('pkAddRoom' in d) {
        const sel = $('#watchlist-overlay')?.querySelector('[data-pk-plate-select]');
        const pid = sel?.value || evalResult.topPlates?.[0]?.plate.id || atlas.plates[0]?.id;
        if (pid) {
          roomFormPlateId = pid;
          editingRoomId = '';
          selectPlate(pid, true);
        }
        return;
      }
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

        const priceHead = `${row.fit.verified ? '✓' : ''}${row.fit.total}分 · ${row.estMonthly ? '约' + money(row.estMonthly) + '/月' : pl.unitPrice + '元/㎡'}`;
        const subParts = [pl.district + '·' + pl.streetName];
        if (row.estMonthly) subParts.push(`${pl.unitPrice}元/㎡ × ${state.sqm}㎡`);
        if (row.route) subParts.push(`${state.peak ? '早高峰' : '通勤'} ${row.route.minutes}分 (${row.route.label})`);
        if (row.trend?.yoy != null) subParts.push(`近一年 ${row.trend.yoy > 0 ? '+' : ''}${row.trend.yoy}%`);
        if (state.layers?.density && row.density != null) {
          subParts.push(`${pl.streetName}密度 ${(row.density / 10000).toFixed(2)}万/km²(七普)`);
        }

        return `<div class="hc-head"><strong>${esc(pl.name)}</strong><span class="hc-price">${esc(priceHead)}</span></div>
          <div class="hc-sub">${esc(subParts.join(' · '))}</div>
          ${alertStrip}
          ${buffs.length ? `<div class="hc-buffs">${buffs.slice(0, 5).map(b => `<span class="hc-tag hc-buff">${esc(b)}</span>`).join('')}</div>` : ''}
          ${debuffs.length ? `<div class="hc-debuffs">${debuffs.map(b => `<span class="hc-tag hc-debuff">${esc(b)}</span>`).join('')}</div>` : ''}
          <div class="hc-foot">左键看评分拆解与记看房卡 · 右键设为目的地</div>`;
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
      if (ev.pointerType !== 'mouse' || svgEl.classList.contains('panning') || ev.target.closest?.('.map-dest-cta')) {
        hCard.hidden = true; lastHoverKey = ''; return;
      }
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

    // 移动端 Bottom Sheet 抽屉手势：轻点手柄展开/半屏，上滑拉高至 86dvh，下滑收起或关闭
    const drawerEl = $('#detail-drawer');
    let sheetStartY = null, sheetMoved = false;
    drawerEl.addEventListener('pointerdown', ev => {
      const onHandle = !!ev.target.closest('[data-sheet-handle],[data-close-drawer],.drawer-head');
      if (!onHandle || ev.target.closest('button,a')) return;
      sheetStartY = ev.clientY;
      sheetMoved = false;
    });
    drawerEl.addEventListener('pointermove', ev => {
      if (sheetStartY == null) return;
      if (Math.abs(ev.clientY - sheetStartY) > 12) sheetMoved = true;
    });
    drawerEl.addEventListener('pointerup', ev => {
      if (sheetStartY == null) return;
      const dy = ev.clientY - sheetStartY;
      const onHandle = !!ev.target.closest('[data-sheet-handle]');
      sheetStartY = null;
      if (dy > 62) {
        if (drawerEl.classList.contains('sheet-tall')) drawerEl.classList.remove('sheet-tall');
        else clearSelection();
      } else if (dy < -44) {
        drawerEl.classList.add('sheet-tall');
      } else if (!sheetMoved && onHandle) {
        drawerEl.classList.toggle('sheet-tall');
      }
    });
    drawerEl.addEventListener('pointercancel', () => { sheetStartY = null; sheetMoved = false; });

    // 视口尺寸/横竖屏变化时自适应重绘（适配手机地址栏伸缩与横竖屏切换）
    let resizeTimer = 0;
    global.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { if (evalResult) refresh(); }, 120);
    });
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
