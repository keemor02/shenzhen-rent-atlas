/* 深圳租房新版地图渲染器：塞尔达旷野色块地图 × Apple 极简胶囊/近景信息牌 × 图层按需叠加 */
(function (global) {
  'use strict';

  // 6 类公开负面/避坑纯矢量图标（既用于地图风险点位，也嵌入片区近景/图层副条）
  const EVENT_TYPES = {
    works:  { label: '施工绕行', color: '#c46a10', bg: '#fff4e5', icon: '<path d="M-8 -4H8V2H-8ZM-5 2V7M5 2V7M-6 0l3-4M0 0l3-4M6 0l2-3"/>' },
    air:    { label: '工业气味', color: '#6b7d1a', bg: '#f4f7e4', icon: '<path d="M-8 6V-1l5 2v-4l6 3v-5h3l1 11ZM3-8q-2-2 1-3m1 3q3-1 3-3"/>' },
    rail:   { label: '轨道噪声', color: '#6b4dc4', bg: '#f3efff', icon: '<rect x="-8" y="-7" width="9" height="12" rx="2"/><path d="M-7-3H0M-6 7l2-2m4 2-2-2M4-3q4 3 0 6m3-9q7 6 0 12"/>' },
    flight: { label: '航空噪声', color: '#1b6fa8', bg: '#eaf5fc', icon: '<path d="M0-9c1 0 1.5 1.2 1.5 3.2V-2L8 3v2L1.5 2.2v3.5L4 8v1L0 7.5-4 9V8l2.5-2.3V2.2L-8 5V3l6.5-5v-3.8C-1.5-7.8-1-9 0-9Z" fill="currentColor" stroke="none"/>' },
    crowd:  { label: '枢纽客流', color: '#a66b08', bg: '#fdf4e1', icon: '<circle cx="-2" cy="-4.5" r="2.6"/><path d="M-8 6V4a6 6 0 0 1 12 0v2ZM4-6a2.5 2.5 0 0 1 0 5m2 2q3 .5 3 5"/>' },
    noise:  { label: '生活噪声', color: '#b83246', bg: '#fdecef', icon: '<path d="M-8-3h4l5-4V7l-5-4h-4ZM4-3q3 3 0 6m3-9q6 6 0 12"/>' },
  };

  // 深圳地铁真实线路色
  const METRO_COLORS = {
    '1': '#28b865', '2/8': '#e68c42', '2': '#e68c42', '3': '#39a7e0', '4': '#e24c4b',
    '5': '#a66bd4', '6': '#34b3a0', '7': '#3e8ce0', '9': '#b88565', '10': '#eb6ca2',
    '11': '#c75b86', '12': '#bf98de', '13': '#f09a43', '14': '#e8c448', '16': '#5d8be0',
  };

  const BUFF_GLYPHS = {
    mall:   { color: '#1479b8', path: 'M2 4h6l.7 5.2H1.3ZM3.4 4V2.8a1.6 1.6 0 0 1 3.2 0V4' },
    park:   { color: '#1f7a44', path: 'M5 1.2L2.2 5.6h1.6L1.8 8.2h6.4L6.2 5.6h1.6ZM5 8.2V9.6' },
    health: { color: '#c43e29', path: 'M5 1.8v6.4M1.8 5h6.4' },
    school: { color: '#6b4dc4', path: 'M1 4.4L5 2.2l4 2.2-4 2.2ZM2.6 5.4v2.3L5 8.9l2.4-1.2V5.4' },
  };

  function eventTypeFor(risk) {
    return ({
      '施工绕行': 'works', '工业废气': 'air', '工业异味': 'air',
      '轨道噪声': 'rail', '机场运行': 'flight', '铁路枢纽': 'crowd', '生活噪声': 'noise',
    })[risk?.kind] || 'works';
  }
  function eventGlyph(type, strokeColor) {
    const t = EVENT_TYPES[type] || EVENT_TYPES.works;
    const col = strokeColor || t.color;
    return `<g aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="color:${col}">${t.icon}</g>`;
  }
  function eventIconSvg(type, cls = 'nx-ev-ico') {
    return `<svg class="${cls}" viewBox="-12 -12 24 24" aria-hidden="true" focusable="false">${eventGlyph(type)}</svg>`;
  }
  function formatMetroTag(lines) {
    if (!lines?.length) return null;
    const color = METRO_COLORS[lines[0]] || '#2c7ea8';
    const clean = lines.map(l => (lines.length > 1 && l === '2/8') ? '2' : l);
    let text;
    if (clean.length === 1) text = `${clean[0]}号线`;
    else if (clean.length === 2) text = `${clean[0]}/${clean[1]}号线`;
    else if (clean.length === 3) text = `${clean[0]}/${clean[1]}/${clean[2]}线`;
    else text = `${clean[0]}/${clean[1]}等${clean.length}线`;
    return { text, color };
  }

  global.NextEventIcons = { EVENT_TYPES, METRO_COLORS, eventTypeFor, eventIconSvg, formatMetroTag };

  function textWidth(str, fontSize) {
    let total = 0;
    for (const ch of String(str || '')) {
      const c = ch.charCodeAt(0);
      if (ch === '%') total += fontSize * 0.90;
      else if ('(),.· '.includes(ch)) total += fontSize * 0.42;
      else if (c < 128 || '¥–↑↓↘◆◈✈★✓/+-'.includes(ch)) total += fontSize * 0.64;
      else total += fontSize * 1.03;
    }
    return total;
  }

  function tierForZoom(k) {
    return (k >= 0.9) + (k >= 2.2) + (k >= 2.9) + (k >= 4.0);
  }

  // 缩放自适应阅读字号比例：全城概览精巧不打架，放大到街道/片区时平滑放大至 14–15px 舒适阅读级
  function labelScaleFor(k, isCompact) {
    const boost = Math.max(0, Math.log2(Math.max(1, k / (isCompact ? 2.0 : 2.1))));
    return isCompact
      ? Math.min(1.26, 1 + boost * 0.14)
      : Math.min(1.44, 1.04 + boost * 0.155);
  }

  function createNextMap(svg, atlas, engine, timing, esc) {
    const world = global.atlasExtent(atlas.plates.map(p => p.bounds));
    let lastPayload = null;
    let lastGeoEval = null, lastGeoKey = '';

    const west = atlas.stations.find(s => s[0] === '宝安中心');
    const east = atlas.stations.find(s => s[0] === '坪山围');
    const lonScale = (east[1] - west[1]) / (east[3][0] - west[3][0]);
    const RAD = Math.PI / 180;
    const merc = lat => Math.log(Math.tan(Math.PI / 4 + lat * RAD / 2));
    const project = ll => [
      west[1] + (ll[0] - west[3][0]) * lonScale,
      west[2] - (merc(ll[1]) - merc(west[3][1])) * lonScale / RAD,
    ];
    const stationXY = name => engine.nodes.has(name) ? project(engine.nodes.get(name).coord) : null;
    const walkRadiusMapUnits = Math.abs((900 / 102700) * lonScale);

    // 60fps 丝滑平移缩放：跨层级不断流，手势停稳后再局部刷新轻量标牌层
    function fastTransform(view) {
      if (typeof svg.querySelector !== 'function') return false;
      const geo = svg.querySelector('.v3-geo');
      if (!geo || !geo.dataset?.baseK) return false;
      const baseK = Number(geo.dataset.baseK), btx = Number(geo.dataset.baseTx), bty = Number(geo.dataset.baseTy);
      geo.setAttribute('transform', `matrix(${view.k.toFixed(5)} 0 0 ${view.k.toFixed(5)} ${view.tx.toFixed(2)} ${view.ty.toFixed(2)})`);
      const ov = svg.querySelector('.v3-overlay');
      if (ov) {
        const rk = view.k / baseK;
        const dx = view.tx - btx * rk, dy = view.ty - bty * rk;
        ov.setAttribute('transform', `matrix(${rk.toFixed(5)} 0 0 ${rk.toFixed(5)} ${dx.toFixed(2)} ${dy.toFixed(2)})`);
      }
      return true;
    }

    const camera = global.makeMapCamera(
      svg, world,
      () => { if (lastPayload) render(lastPayload); },
      () => !!lastPayload && !(lastPayload.state.layers?.commute && lastPayload.state.layout === 'radial' && lastPayload.evalResult.dest1),
      fastTransform
    );

    const SCORE_CUTS = [60, 72, 82];
    const UNIT_CUTS = [55, 75, 100];
    const COMMUTE_CUTS = [25, 40, 60];
    const YOY_CUTS = [-8, -1, 1, 8];
    const MOM_CUTS = [-3, -0.5, 0.5, 3];
    const DENSITY_CUTS = [8000, 15000, 22000];
    const DIST_DENSITY_CUTS = [5000, 10100, 13000];
    const DENSITY_CHIP_TONES = [
      { bg: '#e6f5ec', tc: '#19663c' },
      { bg: '#e8f3fa', tc: '#175a80' },
      { bg: '#fbf1dc', tc: '#8c5a08' },
      { bg: '#fbe9e6', tc: '#9e2e1d' },
    ];

    const pickColor = (val, cuts, colors) => Number.isFinite(val) ? colors[cuts.filter(c => val >= c).length] : null;
    const fmtShortMoney = n => `¥${Math.round(n).toLocaleString('zh-CN')}`;
    const fmtDist = m => m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`;
    const distM = (a, b) => Math.hypot((a[0] - b[0]) * 102700, (a[1] - b[1]) * 110850);
    const fmtDensity = d => d == null ? '' : `${(d / 10000).toFixed(2)}万/km²`;
    const densityTier = d => Number.isFinite(d) ? DENSITY_CUTS.filter(c => d >= c).length : 1;
    const trendValFor = (row, state) => state.trendKind === 'mom' ? row.trend?.mom : row.trend?.yoy;
    const fmtTrendSigned = tv => tv == null ? '' : `${tv > 0 ? '+' : ''}${Number(tv.toFixed(1))}%`;
    const plateAffList = (row, state) => {
      const list = row.affordable || [];
      return state.affFilter ? list.filter(a => a.project.phase === state.affFilter) : list;
    };

    function plateFill(row, state, M) {
      const fillMode = state.fillLayer || 'score';
      if (fillMode === 'affordable') {
        const list = plateAffList(row, state);
        if (!list.length) return M.affColors.none;
        const hasAct = list.some(a => a.project.phase === 'active');
        const hasUp = list.some(a => a.project.phase === 'upcoming');
        if (hasAct && hasUp) return M.affColors.mixed;
        if (hasAct) return M.affColors.active;
        if (hasUp) return M.affColors.upcoming;
        return M.affColors.recent;
      }
      if (!row.eligible) return M.hatchBg;
      if (fillMode === 'score') return pickColor(row.fit?.total, SCORE_CUTS, M.scoreColors) || M.districtFill;
      if (fillMode === 'commute') return pickColor(row.route?.minutes, COMMUTE_CUTS, M.commuteColors) || M.districtFill;
      if (fillMode === 'premium') {
        if (row.premium?.status === 'premium') return M.radarColors.premium;
        return M.radarColors[row.arbitrage.status] || M.radarColors.neutral;
      }
      if (fillMode === 'trend') {
        return pickColor(trendValFor(row, state), state.trendKind === 'mom' ? MOM_CUTS : YOY_CUTS, M.trendColors);
      }
      if (fillMode === 'density') return pickColor(row.density, DENSITY_CUTS, M.densityColors) || M.districtFill;
      if (fillMode === 'rent') return pickColor(row.plate.unitPrice, UNIT_CUTS, M.unitColors) || M.districtFill;
      return M.districtFill;
    }

    function priceTextFor(row, state) {
      if (state.sqm > 0 && row.estMonthly) return fmtShortMoney(row.estMonthly);
      return row.plate.unitPrice ? `${row.plate.unitPrice}/㎡` : '';
    }

    // 概览主指标（严格克制，由底图主视图 + 图层开关联合决定）
    function overviewMetric(row, state) {
      const fm = state.fillLayer || 'score';
      const L = state.layers || {};
      if (state.housingTrack === 'affordable' || fm === 'affordable') {
        const list = plateAffList(row, state);
        const segs = [];
        if (list.length) segs.push(`${list.length}保租`);
        if (L.commute && row.route) segs.push(`${row.route.minutes}分`);
        return { text: segs.join('·'), tone: list.length ? 'good' : 'sub', dot: '' };
      }
      if (!row.eligible) return { text: '', tone: 'sub', dot: '' };

      const tv = trendValFor(row, state);
      const isPrem = row.premium?.status === 'premium';
      const isOpp = row.arbitrage?.status === 'opportunity';
      const topAlert = row.alerts?.find(a => a.priority >= 2) || null;
      const showAlerts = state.mapFilter?.majorAlerts !== false;
      const sigDot = (!showAlerts && topAlert) ? '' : (isPrem ? 'warm' : (isOpp ? 'good' : ''));

      const trendBit = (L.trend && tv != null && Math.abs(tv) >= 0.5)
        ? `${tv > 0 ? '↑' : '↓'}${Math.abs(tv) >= 10 ? Math.round(Math.abs(tv)) : Number(Math.abs(tv).toFixed(1))}%`
        : '';

      if (fm === 'trend') {
        if (tv == null) return { text: '', tone: 'sub', dot: '' };
        return { text: fmtTrendSigned(tv), tone: tv > 0 ? 'warm' : tv < 0 ? 'good' : 'sub', dot: '' };
      }
      if (fm === 'premium') {
        if (isPrem) return { text: `贵¥${Math.round(row.premium.extra)}`, tone: 'warm', dot: '' };
        if (isOpp) return { text: '可捡漏', tone: 'good', dot: '' };
        if (row.premium?.status === 'direct') return { text: '步行圈', tone: 'sub', dot: '' };
      }
      if (fm === 'density') {
        return row.density != null ? { text: `${(row.density / 10000).toFixed(1)}万`, tone: 'sub', dot: '' } : { text: '', tone: 'sub', dot: '' };
      }
      if (fm === 'rent') {
        const base = priceTextFor(row, state);
        if (base && trendBit) {
          return { text: `${base} ${trendBit}`, tone: tv >= 5 ? 'warm' : tv <= -2 ? 'good' : 'sub', dot: sigDot };
        }
        return { text: base, tone: 'sub', dot: sigDot };
      }
      if (fm === 'commute' && row.route) {
        return { text: trendBit ? `${row.route.minutes}分 ${trendBit}` : `${row.route.minutes}分`, tone: trendBit ? (tv >= 5 ? 'warm' : tv <= -2 ? 'good' : 'sub') : 'sub', dot: sigDot };
      }
      if (row.fit?.total != null) {
        return { text: trendBit ? `${row.fit.total}分 ${trendBit}` : `${row.fit.total}分`, tone: trendBit ? (tv >= 5 ? 'warm' : tv <= -2 ? 'good' : 'sub') : 'sub', dot: sigDot };
      }
      return { text: priceTextFor(row, state), tone: 'sub', dot: sigDot };
    }

    // Apple 极简胶囊 + 图层严格可控 + 三级响应式降级（空间不足时优先缩减副条/次要字段，绝不轻易隐藏片区）
    function buildPlatePill(row, px, py, state, M, k, reserve, forceReserve, topRank, focusedId, isCompact) {
      const pl = row.plate;
      const L = state.layers || {};
      const active = pl.id === focusedId;
      const saved = row.mastery?.saved;
      const visited = row.mastery?.visited;
      const isAffOnly = state.housingTrack === 'affordable' || state.fillLayer === 'affordable';
      const isPrem = row.premium?.status === 'premium';
      const isOpp = row.arbitrage?.status === 'opportunity';
      const isWalk = row.premium?.status === 'direct';
      const tv = trendValFor(row, state);
      const showAlerts = !isAffOnly && state.mapFilter?.majorAlerts !== false;
      const topAlert = showAlerts ? (row.alerts?.find(a => a.priority >= 2) || null) : null;
      const baseScale = labelScaleFor(k, isCompact);

      const mObj = overviewMetric(row, state);

      // 超出当前预算/通勤条件的片区：近景放大时保留克制的半透明片区名标，避免变成无名灰块
      if (!isAffOnly && !row.eligible && !active && !saved && topRank === 0) {
        if (k < 1.85) return '';
        const nm = k >= 3.2 ? pl.name : String(pl.name || '').split('·')[0];
        const mScale = Math.max(0.92, baseScale * 0.85);
        const fsM = 9.8, mh = 18;
        const mw = Math.ceil(textWidth(nm, fsM) + 12);
        const sw = mw * mScale, sh = mh * mScale;
        const tries = [[0, 0], [0, -10 * mScale], [0, 10 * mScale], [-12 * mScale, 0], [12 * mScale, 0]];
        const hit = tries.find(([ox, oy]) => reserve(px - sw / 2 + ox, py - sh / 2 + oy, sw, sh));
        if (!hit) return '';
        const bx = px - sw / 2 + hit[0], by = py - sh / 2 + hit[1];
        const aria = `${pl.district}·${pl.name}片区（超出当前筛选条件）`;
        return `<g class="nx-pill is-muted" data-plate="${esc(pl.id)}" data-tier="muted" role="button" tabindex="0" aria-label="${esc(aria)}" transform="translate(${bx.toFixed(1)} ${by.toFixed(1)}) scale(${mScale.toFixed(3)})">` +
          `<rect x="0" y="0" width="${mw}" height="${mh}" rx="${(mh / 2).toFixed(1)}" fill="rgba(255,253,248,0.78)" stroke="rgba(92,74,50,0.22)" stroke-width="0.8"/>` +
          `<text class="no-stroke" x="${(mw / 2).toFixed(1)}" y="${(mh / 2 + 3.3).toFixed(1)}" text-anchor="middle" fill="#6f6558" font-size="${fsM}" font-weight="600">${esc(nm)}</text></g>`;
      }

      // 严格遵循图层面板开关：人口密度 / 溢价捡漏 / 避坑图标关闭后即真正隐藏，不再被缩放强行常驻
      const wantDensity = !isAffOnly && row.eligible && row.density != null && (L.density || state.fillLayer === 'density');
      const wantPremChip = !isAffOnly && row.eligible && (isPrem || isOpp || isWalk) && (L.premium || state.fillLayer === 'premium' || active);
      const filteredRisks = (row.risks || []).filter(rk => !state.riskFilter || eventTypeFor(rk) === state.riskFilter);
      const wantRisks = !isAffOnly && row.eligible && filteredRisks.length > 0 && (L.risks || active);
      const richHead = !isAffOnly && row.eligible && (k >= 2.35 || active);
      const wantSubStrip = !isAffOnly && row.eligible && (
        active || wantDensity || wantPremChip || wantRisks ||
        (k >= 2.6 && (pl.lines?.length || (k >= 3.2 && pl.facCats?.length) || visited))
      );

      if (!active && !mObj.text && !saved && topRank === 0 && !wantSubStrip) return '';

      const bg = active ? M.activePillBg : M.pillBg;
      const border = active ? M.activePillBorder : (isPrem && L.premium ? M.pillWarm : isOpp && L.premium ? M.pillGood : M.pillBorder);
      const tc = active ? M.activePillText : (row.eligible ? M.pillText : M.radialText);
      const fs = active ? 11.2 : 10.5;
      const headH = active ? 23 : 20.5;
      const aria = `${pl.district}·${pl.name}片区${mObj.text ? ' · ' + mObj.text : ''}`;

      const buildAlert = (headXNum, hw) => {
        if (!topAlert || !row.eligible) return '';
        const aFill = topAlert.level === 'surge' ? M.pillWarm : topAlert.level === 'drop' ? M.pillGood : '#b88316';
        return `<g class="nx-alert-badge alert-${topAlert.level}" transform="translate(${(headXNum + hw - 1.5).toFixed(1)} 1.5)" pointer-events="none">` +
          `<circle r="6" fill="${aFill}" stroke="#ffffff" stroke-width="1.3"/>` +
          `<text class="no-stroke" x="0" y="3.2" text-anchor="middle" fill="#ffffff" font-size="9" font-weight="900">!</text></g>`;
      };

      const placeBox = (wLocal, hLocal, scale, triesList) => {
        const sw = wLocal * scale, sh = hLocal * scale;
        const bx0 = px - sw / 2, by0 = py - sh / 2;
        if (active) {
          forceReserve(bx0, by0, sw, sh);
          return [bx0, by0];
        }
        const hit = triesList.find(([ox, oy]) => reserve(bx0 + ox * scale, by0 + oy * scale, sw, sh));
        return hit ? [bx0 + hit[0] * scale, by0 + hit[1] * scale] : null;
      };

      // -------- Tier 1: 完整富信息双行卡（优先展示；空间不够时优雅降级到 Tier 2 而非隐藏片区） --------
      if (richHead || wantSubStrip) {
        let headW = 0, headInner = '';
        if (richHead) {
          const nameTxt = `${saved ? '★ ' : (topRank > 0 ? `#${topRank} ` : '')}${pl.name}`;
          const nameW = textWidth(nameTxt, fs);
          const scVal = row.fit?.total;
          const scTxt = scVal != null ? `${row.fit.verified ? '✓' : ''}${scVal}分` : '';
          const scW = scTxt ? Math.ceil(textWidth(scTxt, 9.4) + 9) : 0;

          const rSegs = [], rSvgSegs = [];
          const pTxt = priceTextFor(row, state);
          const showTrendInline = (L.trend || state.fillLayer === 'trend' || active) && tv != null && Math.abs(tv) >= 0.5;
          const tStr = showTrendInline ? fmtTrendSigned(tv) : '';
          const tCol = active ? (tv > 0 ? '#ffb39b' : '#80f0b4') : (tv > 0 ? M.pillWarm : M.pillGood);

          if (pTxt) {
            if (tStr) {
              rSegs.push(`${pTxt}(${tStr})`);
              rSvgSegs.push(`${esc(pTxt)}<tspan fill="${tCol}" font-weight="750">(${esc(tStr)})</tspan>`);
            } else {
              rSegs.push(pTxt);
              rSvgSegs.push(esc(pTxt));
            }
          } else if (tStr) {
            rSegs.push(tStr);
            rSvgSegs.push(`<tspan fill="${tCol}" font-weight="750">${esc(tStr)}</tspan>`);
          }
          if (row.route) {
            const cTxt = `${row.route.minutes}分`;
            rSegs.push(cTxt);
            rSvgSegs.push(esc(cTxt));
          }

          const rightPlain = rSegs.join(' · ');
          const rightW = rightPlain ? textWidth(rightPlain, 10) + 10 : 0;
          headW = Math.ceil(nameW + (scW ? scW + 6 : 0) + rightW + 16);

          const scBg = active ? '#38383a' : scVal >= 82 ? '#e3f5ea' : scVal >= 72 ? '#e7f4f1' : scVal >= 60 ? '#fbf1da' : '#fceae7';
          const scTc = active ? '#9ef2c3' : scVal >= 82 ? '#166b3c' : scVal >= 72 ? '#185e52' : scVal >= 60 ? '#8c5a08' : '#b03320';
          const scX = 8 + nameW + 5;
          const scSvg = scTxt
            ? `<rect x="${scX.toFixed(1)}" y="${((headH - 14) / 2).toFixed(1)}" width="${scW}" height="14" rx="4" fill="${scBg}"/>` +
              `<text class="no-stroke" x="${(scX + scW / 2).toFixed(1)}" y="${(headH / 2 + 3.2).toFixed(1)}" text-anchor="middle" fill="${scTc}" font-size="9.4" font-weight="750">${esc(scTxt)}</text>`
            : '';
          const rightCol = active ? M.activePillSub : M.pillSub;
          const sepSvg = `<tspan fill="${active ? '#8e8e93' : '#9c8f7d'}"> · </tspan>`;

          headInner = `<text class="no-stroke" x="8" y="${(headH / 2 + 3.6).toFixed(1)}" fill="${tc}" font-size="${fs}" font-weight="700">${esc(nameTxt)}</text>` +
            scSvg +
            (rightPlain ? `<text class="no-stroke" x="${(headW - 8).toFixed(1)}" y="${(headH / 2 + 3.4).toFixed(1)}" text-anchor="end" fill="${rightCol}" font-size="10" font-weight="650">${rSvgSegs.join(sepSvg)}</text>` : '');
        } else {
          // 图层触发副条时的精简主行
          const prefix = saved ? '★ ' : (topRank > 0 ? `#${topRank} ` : '');
          const shortName = k < 2.2 ? String(pl.name || '').split('·')[0] : pl.name;
          const metric = mObj.text;
          const fullTxt = `${prefix}${shortName}${metric ? '  ' + metric : ''}`;
          headW = Math.ceil(textWidth(fullTxt, fs) + 14);
          const subCol = active ? M.activePillSub : (mObj.tone === 'good' ? M.pillGood : mObj.tone === 'warm' ? M.pillWarm : M.pillSub);
          headInner = `<text class="no-stroke" x="7" y="${(headH / 2 + 3.6).toFixed(1)}" fill="${tc}" font-size="${fs}" font-weight="650">${esc(prefix + shortName)}</text>` +
            (metric ? `<text class="no-stroke" x="${(headW - 7).toFixed(1)}" y="${(headH / 2 + 3.6).toFixed(1)}" text-anchor="end" fill="${subCol}" font-size="${fs}" font-weight="750">${esc(metric)}</text>` : '');
        }

        // 副行（地铁/人口密度/配套图标/溢价捡漏/避坑）
        let subSvg = '', subW = 0, subH = 0;
        const subFs = 9.3;
        if (wantSubStrip) {
          const items = [];
          if (k >= 2.6 || active) {
            const mt = formatMetroTag(pl.lines);
            if (mt) items.push({ kind: 'metro', text: mt.text, dot: mt.color, w: Math.ceil(textWidth(mt.text, subFs) + 13) });
          }
          if (wantDensity) {
            const dt = DENSITY_CHIP_TONES[densityTier(row.density)] || DENSITY_CHIP_TONES[1];
            const dTxt = `人口 ${fmtDensity(row.density)}`;
            items.push({ kind: 'chip', text: dTxt, bg: active ? '#323236' : dt.bg, tc: active ? '#d4d4d8' : dt.tc, w: Math.ceil(textWidth(dTxt, subFs) + 10) });
          }
          if (k >= 3.2 || active) {
            const cats = new Set(pl.facCats || []);
            for (const ck of ['mall', 'park', 'health', 'school']) {
              if (cats.has(ck)) items.push({ kind: 'glyph', g: BUFF_GLYPHS[ck], w: 10 });
            }
          }
          if (wantPremChip && state.fillLayer !== 'premium') {
            if (isPrem) {
              const pTxt = `贵¥${Math.round(row.premium.extra)}`;
              items.push({ kind: 'chip', text: pTxt, bg: active ? '#5c261e' : '#fbe9e6', tc: active ? '#ffc4b8' : M.pillWarm, w: Math.ceil(textWidth(pTxt, subFs) + 9) });
            } else if (isOpp) {
              items.push({ kind: 'chip', text: '可捡漏', bg: active ? '#184d30' : '#e5f5ec', tc: active ? '#8ef0b8' : M.pillGood, w: 38 });
            } else if (isWalk) {
              items.push({ kind: 'chip', text: '步行圈', bg: active ? '#4a3811' : '#fbf1dc', tc: active ? '#f6d476' : '#8c5a08', w: 38 });
            }
          }
          if (visited && (k >= 2.5 || active)) {
            const vTxt = row.mastery.avgStar ? `已看${row.mastery.avgStar}★` : '已看房';
            items.push({ kind: 'chip', text: vTxt, bg: active ? '#184d30' : '#e5f5ec', tc: active ? '#8ef0b8' : M.pillGood, w: Math.ceil(textWidth(vTxt, subFs) + 8) });
          }

          const riskItems = [];
          if (wantRisks) {
            for (const rk of filteredRisks) {
              riskItems.push({ kind: 'risk', type: eventTypeFor(rk), w: 12 });
              if (riskItems.length >= 3) break;
            }
          }

          if (items.length || riskItems.length) {
            let cx = 5;
            const partsSub = [];
            const drawSub = it => {
              if (it.kind === 'metro') {
                partsSub.push(
                  `<circle cx="${(cx + 3.2).toFixed(1)}" cy="8.2" r="2.7" fill="${it.dot}"/>` +
                  `<text class="no-stroke" x="${(cx + 8).toFixed(1)}" y="11.3" fill="${active ? '#e5e5ea' : '#3a342c'}" font-size="${subFs}" font-weight="650">${esc(it.text)}</text>`
                );
              } else if (it.kind === 'chip') {
                partsSub.push(
                  `<rect x="${cx.toFixed(1)}" y="2" width="${it.w}" height="12.5" rx="3.5" fill="${it.bg}"/>` +
                  `<text class="no-stroke" x="${(cx + it.w / 2).toFixed(1)}" y="11.1" text-anchor="middle" fill="${it.tc}" font-size="${subFs}" font-weight="700">${esc(it.text)}</text>`
                );
              } else if (it.kind === 'glyph') {
                partsSub.push(`<g transform="translate(${cx.toFixed(1)} 3.2)" fill="none" stroke="${active ? '#d1d1d6' : it.g.color}" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="${it.g.path}"/></g>`);
              } else if (it.kind === 'risk') {
                const info = EVENT_TYPES[it.type];
                partsSub.push(`<g transform="translate(${(cx + 5.5).toFixed(1)} 8.2) scale(0.54)" fill="none" stroke="${info.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:${info.color}">${info.icon}</g>`);
              }
              cx += it.w + 4;
            };
            items.forEach(drawSub);
            if (items.length && riskItems.length) {
              partsSub.push(`<line x1="${(cx - 1.5).toFixed(1)}" y1="3" x2="${(cx - 1.5).toFixed(1)}" y2="13.5" stroke="${active ? 'rgba(255,255,255,0.2)' : 'rgba(89,72,52,0.22)'}" stroke-width="0.9"/>`);
              cx += 2.5;
            }
            riskItems.forEach(drawSub);
            subW = Math.ceil(cx + 2);
            subH = 16.5;
            subSvg = partsSub.join('');
          }
        }

        const totalW = Math.max(headW, subW);
        const totalH = headH + (subH ? subH + 1.5 : 0);
        const t1Tries = (topRank > 0 || saved || topAlert)
          ? [[0, 0], [-20, 0], [0, -16], [0, 16], [20, 0], [-22, -14]]
          : [[0, 0], [0, -14], [0, 14]];
        const pos1 = placeBox(totalW, totalH, baseScale, t1Tries);
        if (pos1) {
          const [bx, by] = pos1;
          const headXNum = (totalW - headW) / 2;
          const rx = subH ? 9 : (headH / 2).toFixed(1);
          const subBar = subH
            ? `<g transform="translate(${((totalW - subW) / 2).toFixed(1)} ${(headH + 1.5).toFixed(1)})">` +
              `<rect x="0" y="0" width="${subW}" height="${subH}" rx="5" fill="${active ? 'rgba(29,29,31,0.92)' : 'rgba(255,253,248,0.94)'}" stroke="${border}" stroke-width="0.8"/>` +
              `${subSvg}</g>`
            : '';
          return `<g class="nx-pill${active ? ' is-active' : ''}${subH ? ' has-sub' : ''}" data-plate="${esc(pl.id)}" data-tier="full" data-scale="${baseScale.toFixed(2)}" role="button" tabindex="0" aria-label="${esc(aria)}" transform="translate(${bx.toFixed(1)} ${by.toFixed(1)}) scale(${baseScale.toFixed(3)})">` +
            `<g transform="translate(${headXNum.toFixed(1)} 0)"><rect x="0" y="1.4" width="${headW}" height="${headH}" rx="${rx}" fill="rgba(47,38,27,0.13)" pointer-events="none"/><rect x="0" y="0" width="${headW}" height="${headH}" rx="${rx}" fill="${bg}" stroke="${border}" stroke-width="${active ? 1.5 : 0.9}"/>${headInner}</g>` +
            subBar + buildAlert(headXNum, headW) + `</g>`;
        }
      }

      // -------- Tier 2: 紧凑单行胶囊（概览默认，或 Tier 1 空间不足时自动隐藏副行与次要字段以保住片区） --------
      const showName = !isCompact || active || k >= 1.85 || topRank > 0 || saved;
      const shortName = k < 2.6 ? String(pl.name || '').split('·')[0] : pl.name;
      const label = showName ? shortName : '';
      const prefix = saved ? '★ ' : (topRank > 0 ? `#${topRank} ` : '');
      const metric = mObj.text;
      const fullTxt = label ? `${prefix}${label}${metric ? '  ' + metric : ''}` : metric;
      if (fullTxt) {
        const showDot = !active && !topAlert && Boolean(mObj.dot);
        const dotExtra = showDot ? 9 : 0;
        const cHeadW = Math.ceil(textWidth(fullTxt, fs) + 14 + dotExtra);
        const cScale = (richHead || wantSubStrip) ? Math.max(0.96, baseScale * 0.92) : baseScale;
        const t2Tries = (topRank > 0 || saved || topAlert)
          ? [[0, 0], [-18, 0], [0, -14], [0, 14], [18, 0], [-20, -12]]
          : [[0, 0], [0, -12], [0, 12], [-14, 0], [14, 0]];
        const pos2 = placeBox(cHeadW, headH, cScale, t2Tries);
        if (pos2) {
          const [bx, by] = pos2;
          const subCol = active
            ? M.activePillSub
            : (mObj.tone === 'good' ? M.pillGood : mObj.tone === 'warm' ? M.pillWarm : M.pillSub);
          let cInner = '';
          if (label && metric) {
            cInner = `<text class="no-stroke" x="7" y="${(headH / 2 + 3.6).toFixed(1)}" fill="${tc}" font-size="${fs}" font-weight="${active ? 700 : 600}">${esc(prefix + label)}</text>` +
              `<text class="no-stroke" x="${(cHeadW - 7 - dotExtra).toFixed(1)}" y="${(headH / 2 + 3.6).toFixed(1)}" text-anchor="end" fill="${subCol}" font-size="${fs}" font-weight="750">${esc(metric)}</text>`;
          } else {
            cInner = `<text class="no-stroke" x="${((cHeadW - dotExtra) / 2).toFixed(1)}" y="${(headH / 2 + 3.6).toFixed(1)}" text-anchor="middle" fill="${label ? tc : subCol}" font-size="${fs}" font-weight="750">${esc(fullTxt)}</text>`;
          }
          if (showDot) {
            cInner += `<circle class="nx-sig-dot" cx="${(cHeadW - 7.5).toFixed(1)}" cy="${(headH / 2).toFixed(1)}" r="2.7" fill="${mObj.dot === 'warm' ? M.pillWarm : M.pillGood}"/>`;
          }
          const rx = (headH / 2).toFixed(1);
          return `<g class="nx-pill${active ? ' is-active' : ''}" data-plate="${esc(pl.id)}" data-tier="compact" data-scale="${cScale.toFixed(2)}" role="button" tabindex="0" aria-label="${esc(aria)}" transform="translate(${bx.toFixed(1)} ${by.toFixed(1)}) scale(${cScale.toFixed(3)})">` +
            `<rect x="0" y="1.4" width="${cHeadW}" height="${headH}" rx="${rx}" fill="rgba(47,38,27,0.13)" pointer-events="none"/>` +
            `<rect x="0" y="0" width="${cHeadW}" height="${headH}" rx="${rx}" fill="${bg}" stroke="${border}" stroke-width="${active ? 1.5 : 0.9}"/>${cInner}` +
            buildAlert(0, cHeadW) + `</g>`;
        }
      }

      // -------- Tier 3: 极简微名标（高密度邻接区仍挤不下时，收窄为纯短名，尽量不丢片区） --------
      const microTxt = `${saved ? '★' : ''}${String(pl.name || '').split('·')[0]}`;
      if (!microTxt) return '';
      const mFs = 9.8, mH = 18;
      const mW = Math.ceil(textWidth(microTxt, mFs) + 12);
      const mScale = Math.max(0.9, baseScale * 0.84);
      const pos3 = placeBox(mW, mH, mScale, [[0, 0], [0, -10], [0, 10], [-12, 0], [12, 0], [-10, -10], [10, 10]]);
      if (!pos3) return '';
      const [bx3, by3] = pos3;
      return `<g class="nx-pill is-micro" data-plate="${esc(pl.id)}" data-tier="micro" data-scale="${mScale.toFixed(2)}" role="button" tabindex="0" aria-label="${esc(aria)}" transform="translate(${bx3.toFixed(1)} ${by3.toFixed(1)}) scale(${mScale.toFixed(3)})">` +
        `<rect x="0" y="1.1" width="${mW}" height="${mH}" rx="${(mH / 2).toFixed(1)}" fill="rgba(47,38,27,0.11)" pointer-events="none"/>` +
        `<rect x="0" y="0" width="${mW}" height="${mH}" rx="${(mH / 2).toFixed(1)}" fill="${bg}" stroke="${border}" stroke-width="0.85"/>` +
        `<text class="no-stroke" x="${(mW / 2).toFixed(1)}" y="${(mH / 2 + 3.3).toFixed(1)}" text-anchor="middle" fill="${tc}" font-size="${mFs}" font-weight="650">${esc(microTxt)}</text></g>`;
    }

    const MACRO_META = {
      community: { title: '小区均价', cuts: [50, 70, 95], labels: ['<50', '50–70', '70–95', '≥95'], val: d => d.community?.price ?? null, fmt: v => `${v}元/㎡` },
      apartment: { title: '公寓均价', cuts: [55, 80, 110], labels: ['<55', '55–80', '80–110', '≥110'], val: d => d.apartment?.price ?? null, fmt: v => `${v}元/㎡` },
      village:   { title: '城中村', cuts: [40, 55, 75], labels: ['<40', '40–55', '55–75', '≥75'], val: d => d.village?.range ? Math.round((d.village.range[0] + d.village.range[1]) / 2) : null, fmt: (v, d) => d.village?.range ? `${d.village.range[0]}–${d.village.range[1]}` : '—' },
      listing:   { title: '挂牌综合', cuts: [50, 70, 95], labels: ['<50', '50–70', '70–95', '≥95'], val: d => d.listingPrice ?? null, fmt: v => `${v}元/㎡` },
      ref2022:   { title: '2022参考', cuts: [50, 70, 95], labels: ['<50', '50–70', '70–95', '≥95'], val: d => d.refs2022?.[0] ?? null, fmt: v => `${v}元/㎡` },
      density:   { title: '人口密度', cuts: DIST_DENSITY_CUTS, labels: ['<0.5万', '0.5–1.0', '1.0–1.3', '≥1.3万'], val: d => d.density ?? null, fmt: v => fmtDensity(v) },
    };

    function legendMarkup(state, M) {
      const stop = (color, text) => `<span class="nx-leg-item"><i class="nx-leg-sw" style="background:${color}"></i>${esc(text)}</span>`;
      if (state.macroOpen) {
        const m = MACRO_META[state.macroMetric] || MACRO_META.community;
        const pal = state.macroMetric === 'density' ? M.densityColors : M.unitColors;
        return m.labels.map((l, i) => stop(pal[i], l)).join('');
      }
      const fm = state.fillLayer || 'score';
      if (fm === 'score') {
        return stop(M.scoreColors[0], '<60') + stop(M.scoreColors[1], '60–71') + stop(M.scoreColors[2], '72–81') + stop(M.scoreColors[3], '≥82');
      }
      if (fm === 'commute') {
        return stop(M.commuteColors[0], '<25分') + stop(M.commuteColors[1], '25–39') + stop(M.commuteColors[2], '40–59') + stop(M.commuteColors[3], '≥60');
      }
      if (fm === 'rent') {
        if (state.sqm > 0) {
          const sq = state.sqm;
          return stop(M.unitColors[0], `<${fmtShortMoney(55 * sq)}`) +
            stop(M.unitColors[1], `${fmtShortMoney(55 * sq)}–${fmtShortMoney(75 * sq)}`) +
            stop(M.unitColors[2], `${fmtShortMoney(75 * sq)}–${fmtShortMoney(100 * sq)}`) +
            stop(M.unitColors[3], `≥${fmtShortMoney(100 * sq)}`);
        }
        return stop(M.unitColors[0], '<55/㎡') + stop(M.unitColors[1], '55–74') + stop(M.unitColors[2], '75–99') + stop(M.unitColors[3], '≥100');
      }
      if (fm === 'trend') {
        const tags = state.trendKind === 'mom' ? ['<-3%', '-3~0', '平', '+0.5~3', '≥+3%'] : ['<-8%', '-8~-1', '平', '+1~8', '≥+8%'];
        return tags.map((t, i) => stop(M.trendColors[i], t)).join('');
      }
      if (fm === 'premium') {
        return stop(M.radarColors.opportunity, '可捡漏') + stop(M.radarColors.premium, '高溢价') + stop(M.radarColors.mixed, '分化');
      }
      if (fm === 'density') {
        return stop(M.densityColors[0], '<0.8万') + stop(M.densityColors[1], '0.8–1.5') + stop(M.densityColors[2], '1.5–2.2') + stop(M.densityColors[3], '≥2.2万/km²');
      }
      if (fm === 'affordable') {
        return stop(M.affColors.active, '申请中') + stop(M.affColors.recent, '往期') + stop(M.affColors.upcoming, '在建');
      }
      return '';
    }

    function renderMacro(state, M) {
      lastGeoEval = null; lastGeoKey = '';
      const view = camera.viewport(), { w, h, k, tx, ty, pt } = view;
      const m = MACRO_META[state.macroMetric] || MACRO_META.community;
      const pal = state.macroMetric === 'density' ? M.densityColors : M.unitColors;
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      const parts = [
        `<rect width="100%" height="100%" fill="${M.bg}"/>`,
        `<defs><pattern id="nx-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="scale(${1 / k})"><rect width="7" height="7" fill="${M.hatchBg}"/><path d="M-1 1L1 -1M0 7L7 0M6 8L8 6" stroke="${M.hatchLine}" stroke-width=".9"/></pattern></defs>`,
        `<g class="v3-geo" data-zoom-tier="${tierForZoom(k)}" data-base-k="${k}" data-base-tx="${tx}" data-base-ty="${ty}" transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${k})">`,
      ];
      for (const d of atlas.districts) {
        const val = m.val(d);
        const fill = pickColor(val, m.cuts, pal) || 'url(#nx-hatch)';
        const active = state.selectedDistrict === d.n;
        const labelVal = val != null ? m.fmt(val, d) : '缺同口径';
        parts.push(`<path class="plate-shape" data-district="${esc(d.n)}" role="button" tabindex="0" aria-label="${esc(d.n + ' · ' + labelVal)}" d="${d.p}" fill="${fill}" stroke="${active ? M.selectedStroke : M.plateStroke}" stroke-width="${active ? 2.4 : 1}" vector-effect="non-scaling-stroke"/>`);
      }
      parts.push('</g><g class="v3-overlay">');
      for (const d of atlas.districts) {
        const [x, y] = pt(d.a);
        if (x < 10 || x > w - 10 || y < 10 || y > h - 10) continue;
        const val = m.val(d);
        const txt = val != null ? m.fmt(val, d) : '—';
        parts.push(`<text class="no-stroke" x="${x.toFixed(1)}" y="${(y - 2).toFixed(1)}" text-anchor="middle" fill="${M.pillText}" font-size="12" font-weight="700">${esc(d.n.replace(/新区$|区$/, ''))}</text>`);
        parts.push(`<text class="no-stroke" x="${x.toFixed(1)}" y="${(y + 12).toFixed(1)}" text-anchor="middle" fill="${M.radialText}" font-size="10.5" font-weight="600">${esc(txt)}</text>`);
      }
      parts.push('</g>');
      svg.innerHTML = parts.join('');
    }

    function renderRadial(state, evalResult, M, leftInset = 0) {
      lastGeoEval = null; lastGeoKey = '';
      const dest = evalResult.dest1;
      const rect = svg.getBoundingClientRect();
      const w = rect.width || 1100, h = rect.height || 700;
      const isCompact = w < 900;
      const usableLeft = isCompact ? 0 : leftInset;
      const cx = usableLeft + (w - usableLeft) / 2;
      const cy = h / 2 - (isCompact ? 10 : 12);
      const maxR = Math.min((w - usableLeft) - (isCompact ? 36 : 80), h - (isCompact ? 190 : 140)) * 0.43;
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      const parts = [`<rect width="100%" height="100%" fill="${M.bg}"/>`];
      const limit = state.limit;

      const occupied = [[cx - 34, cy - 22, cx + 34, cy + 36]];
      for (let m = 10; m <= limit; m += 10) {
        const r = (m / limit) * maxR;
        const fillRing = m === limit ? M.districtFill : 'none';
        parts.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="${fillRing}" fill-opacity="${m === limit ? '0.42' : '0'}" stroke="${M.radialRing}" stroke-width="1.2" stroke-dasharray="4 4"/>`);
        const lx = cx - 6, ly = cy - r - 4;
        occupied.push([lx - 28, ly - 11, lx + 4, ly + 3]);
        parts.push(`<text class="no-stroke" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="end" fill="${M.radialText}" font-size="11" font-weight="650">${m}分</text>`);
      }
      for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
        parts.push(`<line x1="${cx.toFixed(1)}" y1="${cy.toFixed(1)}" x2="${(cx + Math.cos(a) * maxR).toFixed(1)}" y2="${(cy + Math.sin(a) * maxR).toFixed(1)}" stroke="${M.radialAxis}" stroke-width="1"/>`);
      }

      const toXY = (coord, min) => {
        const dx = (coord[0] - dest.coord[0]) * Math.cos(dest.coord[1] * RAD);
        const dy = dest.coord[1] - coord[1];
        const ang = Math.atan2(dy, dx);
        const r = Math.min(1, min / limit) * maxR;
        return [cx + Math.cos(ang) * r, cy + Math.sin(ang) * r];
      };

      const canLabel = (x, y, bw, bh) => {
        if (x < usableLeft + 10 || x + bw > w - 10 || y < 12 || y + bh > h - 82) return false;
        if (occupied.some(b => x < b[2] + 4 && x + bw > b[0] - 4 && y < b[3] + 3 && y + bh > b[1] - 3)) return false;
        occupied.push([x, y, x + bw, y + bh]);
        return true;
      };

      const reachable = evalResult.plateRows.filter(r => r.route && r.route.minutes <= limit)
        .sort((a, b) =>
          Number(b.plate.id === state.selectedPlateId) - Number(a.plate.id === state.selectedPlateId) ||
          Number(!!b.mastery?.saved) - Number(!!a.mastery?.saved) ||
          Number(b.eligible) - Number(a.eligible) ||
          (b.fit?.total ?? 0) - (a.fit?.total ?? 0)
        );

      const pts = reachable.map(row => ({ row, xy: toXY(row.plate.coord, row.route.minutes) }));
      const dotsSvg = [];
      const labelsSvg = [];

      for (const { row, xy: [px, py] } of pts) {
        const active = row.plate.id === state.selectedPlateId;
        const saved = row.mastery?.saved;
        const dotFill = !row.eligible ? M.hatchLine : (pickColor(row.route.minutes, COMMUTE_CUTS, M.commuteColors) || M.destColor);
        const aria = `${row.plate.name}片区 · ${row.route.minutes}分钟 · ${row.fit.total}分`;
        dotsSvg.push(`<g data-plate="${esc(row.plate.id)}" role="button" tabindex="0" aria-label="${esc(aria)}" transform="translate(${px.toFixed(1)} ${py.toFixed(1)})">` +
          `${active || saved ? `<circle r="${active ? 10 : 8}" fill="none" stroke="${active ? M.selectedStroke : M.destColor}" stroke-width="1.8"/>` : ''}` +
          `<circle r="${active ? 6 : 4.4}" fill="${dotFill}" stroke="${M.pillBg}" stroke-width="1.4"/></g>`);
        if (active || saved || row.eligible) {
          const metric = state.sqm > 0 && row.estMonthly ? fmtShortMoney(row.estMonthly) : `${row.route.minutes}分`;
          const shortN = String(row.plate.name || '').split('·')[0];
          const text = `${shortN} ${metric}`;
          const bw = textWidth(text, 10.5) + 12;
          const tries = [[px + 8, py - 9], [px - bw - 8, py - 9], [px - bw / 2, py - 24], [px - bw / 2, py + 8]];
          const hit = tries.find(([lx, ly]) => canLabel(lx, ly, bw, 18));
          if (hit) {
            const [lx, ly] = hit;
            labelsSvg.push(`<g data-plate="${esc(row.plate.id)}" role="button" tabindex="0">` +
              `<rect x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" width="${bw.toFixed(0)}" height="18" rx="9" fill="${active ? M.activePillBg : M.pillBg}" stroke="${active ? M.activePillBorder : M.pillBorder}" stroke-width="0.9"/>` +
              `<text class="no-stroke" x="${(lx + 6).toFixed(1)}" y="${(ly + 12.5).toFixed(1)}" fill="${active ? M.activePillText : M.pillText}" font-size="10.5" font-weight="650">${esc(text)}</text></g>`);
          }
        }
      }
      parts.push(...dotsSvg, ...labelsSvg);

      const dLabel = String(dest.name || '').replace(/板块$/, '');
      const dw = Math.ceil(textWidth(dLabel, 12) + 22);
      parts.push(`<g transform="translate(${cx.toFixed(1)} ${cy.toFixed(1)})"><circle r="13" fill="${M.destColor}" fill-opacity="0.24"/><circle r="6.5" fill="${M.destColor}" stroke="#ffffff" stroke-width="2"/><rect x="${(-dw / 2).toFixed(1)}" y="11" width="${dw}" height="22" rx="11" fill="${M.destColor}" stroke="#ffffff" stroke-width="1.3"/><text class="no-stroke" x="0" y="25.5" text-anchor="middle" fill="${M.destInk}" font-size="11.5" font-weight="800">${esc(dLabel)}</text></g>`);
      svg.innerHTML = parts.join('');
    }

    function renderGeo(state, evalResult, M, leftInset = 0) {
      const view = camera.viewport(), { w, h, k, tx, ty, pt } = view;
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      const fmt = n => Number(n).toFixed(2);
      const inView = ([x0, y0, x1, y1]) => x1 * k + tx > -20 && x0 * k + tx < w + 20 && y1 * k + ty > -20 && y0 * k + ty < h + 20;

      const activeAff = state.selectedAffId ? evalResult.affRowById?.get(state.selectedAffId) : null;
      const focusedPlateId = state.selectedPlateId || (activeAff ? activeAff.project.plateId : '');
      const focusedRow = focusedPlateId ? evalResult.plateRowById.get(focusedPlateId) : null;
      const aura = state.selectedLandmarkId ? engine.landmarkAura(state.selectedLandmarkId) : null;
      const L = state.layers || {};
      const mf = state.mapFilter || { hub: true, mall: true, transit: true, terrain: true, neutralEvents: true, majorAlerts: true };
      const metroAlpha = L.commute ? 1 : (k >= 2.2 ? 0.8 : 0.45);
      const showPremiumOverlays = state.housingTrack !== 'affordable' && (L.premium || state.fillLayer === 'premium');

      // 静动分层：平移缩放停稳若底图数据/选中态未变，直接复用常驻 .v3-geo 矢量底图，只刷新轻量标牌层
      const geoKey = [
        M.bg, state.fillLayer, state.housingTrack, state.affFilter, state.trendKind,
        state.sqm, state.budget, state.profile, focusedPlateId, state.selectedLandmarkId,
        mf.terrain !== false, L.commute, showPremiumOverlays, metroAlpha, (state.usedHubs || []).join(','),
      ].join('|');
      const existingGeo = typeof svg.querySelector === 'function' ? svg.querySelector('.v3-geo') : null;
      const existingOv = typeof svg.querySelector === 'function' ? svg.querySelector('.v3-overlay') : null;
      const reuseGeo = Boolean(existingGeo && existingOv && lastGeoEval === evalResult && lastGeoKey === geoKey);

      let geoPrefixParts = null;
      if (!reuseGeo) {
        const clipPathById = new Map((atlas.streetClips || []).map(c => [c.id, c.p]));
        const clipsMarkup = (atlas.streetClips || []).map(c => `<clipPath id="${esc(c.id)}"><path d="${c.p}"/></clipPath>`).join('');
        const parts = [
          `<rect width="100%" height="100%" fill="${M.bg}"/>`,
          `<defs>` +
            `<marker id="nx-arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M1 1.5L8.5 5L1 8.5Z" fill="#a66b08"/></marker>` +
            `<pattern id="nx-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="scale(0.5)"><rect width="7" height="7" fill="${M.hatchBg}"/><path d="M-1 1L1 -1M0 7L7 0M6 8L8 6" stroke="${M.hatchLine}" stroke-width=".9"/></pattern>` +
            clipsMarkup +
          `</defs>`,
          `<g class="v3-geo" data-zoom-tier="${tierForZoom(k)}" data-base-k="${k}" data-base-tx="${tx}" data-base-ty="${ty}" transform="matrix(${k.toFixed(5)} 0 0 ${k.toFixed(5)} ${fmt(tx)} ${fmt(ty)})">`,
        ];

        for (const d of atlas.districts) {
          parts.push(`<path d="${d.p}" fill="${M.districtFill}" stroke="${M.districtStroke}" stroke-width="0.9" vector-effect="non-scaling-stroke" pointer-events="none"/>`);
        }

        const byClip = new Map(), unclipped = [];
        for (const row of evalResult.plateRows) {
          if (row.plate.id === focusedPlateId) continue;
          if (row.plate.clipId) {
            if (!byClip.has(row.plate.clipId)) byClip.set(row.plate.clipId, []);
            byClip.get(row.plate.clipId).push(row);
          } else unclipped.push(row);
        }

        const drawPlatePath = row => {
          const pl = row.plate;
          const inAuraWalk = aura?.walk15.has(pl.id);
          const inAura30 = aura?.rail30.has(pl.id);
          const dimmed = Boolean(focusedPlateId) || (aura && !inAura30 && !inAuraWalk);
          const fill = plateFill(row, state, M) || 'url(#nx-hatch)';
          const strokeCol = inAuraWalk ? M.destColor : inAura30 ? M.selectedStroke : M.plateStroke;
          const strokeW = inAuraWalk ? 2.2 : inAura30 ? 1.5 : ((pl.clipId || pl.subdivided) ? 0.78 : 0.92);
          return `<path class="plate-shape" data-plate="${esc(pl.id)}" role="button" tabindex="0" aria-label="${esc(pl.district + '·' + pl.name)}" d="${pl.p}" fill="${fill}" fill-opacity="${dimmed ? '0.46' : '0.96'}" fill-rule="evenodd" stroke="${strokeCol}" stroke-width="${strokeW}" vector-effect="non-scaling-stroke"/>`;
        };

        for (const row of unclipped) parts.push(drawPlatePath(row));
        for (const [clipId, rows] of byClip) {
          parts.push(`<g clip-path="url(#${esc(clipId)})">${rows.map(drawPlatePath).join('')}</g>`);
          const parentD = clipPathById.get(clipId);
          if (parentD) parts.push(`<path d="${parentD}" fill="none" stroke="${M.clipOuterStroke}" stroke-width="1" vector-effect="non-scaling-stroke" pointer-events="none"/>`);
        }

        if (mf.terrain !== false) {
          for (const m of atlas.terrain.mountains) {
            parts.push(`<path class="terrain-mtn" d="${m.p}" fill="${M.mountainFill}" fill-opacity="0.86" stroke="${M.mountainStroke}" stroke-width="0.95" vector-effect="non-scaling-stroke" pointer-events="none"/>`);
          }
          for (const wt of atlas.terrain.water) {
            parts.push(`<path class="terrain-water" d="${wt.p}" fill="${M.waterFill}" fill-opacity="0.88" stroke="${M.waterStroke}" stroke-width="0.95" vector-effect="non-scaling-stroke" pointer-events="none"/>`);
          }
          if (atlas.terrain.airport) {
            parts.push(`<path d="${atlas.terrain.airport.p}" fill="${M.airportFill}" fill-opacity="0.82" stroke="${M.airportStroke}" stroke-dasharray="3 2" stroke-width="0.9" vector-effect="non-scaling-stroke" pointer-events="none"/>`);
          }
        }

        parts.push(`<g class="metro-skeleton" fill="none" stroke="${M.metroStroke}" opacity="${metroAlpha}" stroke-width="${L.commute ? 1.15 : 0.85}" stroke-linecap="round" stroke-linejoin="round" pointer-events="none">`);
        for (const line of atlas.metroLines) parts.push(`<path d="${line.p}" vector-effect="non-scaling-stroke"/>`);
        parts.push('</g>');

        // 纯矢量双层选中轮廓（彻底淘汰全屏 CPU 滤镜 feMorphology，选中片区拖动依然 60fps！）
        if (focusedRow) {
          const fpl = focusedRow.plate;
          const fFill = plateFill(focusedRow, state, M) || M.districtFill;
          const inner =
            `<path d="${fpl.p}" fill="none" fill-rule="evenodd" stroke="${M.selectedGlow}" stroke-opacity="0.48" stroke-width="6.4" stroke-linejoin="round" vector-effect="non-scaling-stroke" pointer-events="none"/>` +
            `<path class="plate-shape plate-selected" data-plate="${esc(fpl.id)}" role="button" tabindex="0" aria-label="${esc(fpl.name)}" d="${fpl.p}" fill="${fFill}" fill-rule="evenodd" stroke="${M.selectedStroke}" stroke-width="2.1" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>` +
            `<path d="${fpl.p}" fill="${M.selectedTint}" fill-rule="evenodd" stroke="none" pointer-events="none"/>`;
          parts.push(`<g id="nx-sel-glow" class="plate-selected-wrap">${fpl.clipId ? `<g clip-path="url(#${esc(fpl.clipId)})">${inner}</g>` : inner}</g>`);
        }

        if (aura) {
          const [lx, ly] = project(aura.landmark.coord);
          parts.push(`<circle class="landmark-aura-ring" cx="${fmt(lx)}" cy="${fmt(ly)}" r="${fmt(walkRadiusMapUnits)}" fill="${M.selectedTint}" stroke="${M.selectedStroke}" stroke-width="1.8" stroke-dasharray="4 3" vector-effect="non-scaling-stroke" pointer-events="none"/>`);
        } else if (showPremiumOverlays && evalResult.dest1 && engine.hubNodes?.length) {
          const usedSet = new Set(state.usedHubs || []);
          for (const hub of engine.hubNodes) {
            const [hx, hy] = project(hub.coord);
            const isOwn = hub.name === evalResult.dest1.name || hub.name === evalResult.dest2?.name;
            const isUsed = usedSet.has(hub.name);
            const stroke = isOwn ? M.destColor : isUsed ? M.walkColor : M.radarColors.premium;
            parts.push(`<circle cx="${fmt(hx)}" cy="${fmt(hy)}" r="${fmt(walkRadiusMapUnits)}" fill="none" stroke="${stroke}" stroke-width="${isOwn ? 1.8 : 1.2}" stroke-dasharray="4 3" vector-effect="non-scaling-stroke" pointer-events="none"/>`);
          }
        }

        parts.push('</g><g class="v3-overlay">');
        geoPrefixParts = parts;
      }

      const ovParts = [];
      const parts = ovParts;

      // 办公外迁走廊弧线（开启溢价图层且未关闭外迁走廊时展示）
      if (showPremiumOverlays && mf.neutralEvents !== false && atlas.migrations?.length) {
        for (const mig of atlas.migrations) {
          const [x1, y1] = pt(mig.fromXy), [x2, y2] = pt(mig.toXy);
          const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 - 20;
          parts.push(`<path class="migration-arc" d="M${fmt(x1)},${fmt(y1)} Q${fmt(mx)},${fmt(my)} ${fmt(x2)},${fmt(y2)}" fill="none" stroke="#a66b08" stroke-width="1.6" stroke-dasharray="5 3" opacity="0.78" marker-end="url(#nx-arrow)" pointer-events="none"/>`);
          if (k >= 1.75) {
            parts.push(`<text class="no-stroke" x="${fmt(mx)}" y="${fmt(my + 4)}" text-anchor="middle" fill="#6b4504" font-size="10" font-weight="700">${esc(mig.label)}</text>`);
          }
        }
      }

      // 选中片区近距影响连线（≤1.8km 商圈/配套绿线，≤2.2km 公开负面避坑红线）
      const influenceLayer = [];
      if (focusedRow) {
        const [ox, oy] = pt(focusedRow.plate.xy);
        if (mf.neutralEvents !== false || L.facilities) {
          const greenTargets = [];
          const seenNames = new Set();
          for (const m of focusedRow.plate.malls || []) {
            if (m.meters > 1800) continue;
            seenNames.add(m.name);
            greenTargets.push({ kind: 'landmark', id: m.id, name: m.name, dist: fmtDist(m.meters), coord: m.coord });
          }
          for (const f of focusedRow.nearbyFacs || []) {
            if (f.meters > 1800 || seenNames.has(f.name)) continue;
            seenNames.add(f.name);
            greenTargets.push({ kind: 'fac', id: f.id, name: f.name, dist: fmtDist(f.meters), coord: f.location.gcj02 });
          }
          for (const gt of greenTargets.slice(0, 2)) {
            const [tx2, ty2] = pt(project(gt.coord));
            const mx = (ox + tx2) / 2, my = (oy + ty2) / 2 - 8;
            const attr = gt.kind === 'landmark' ? `data-landmark="${esc(gt.id)}"` : `data-fac="${esc(gt.id)}"`;
            const shortGt = gt.name.length > 8 ? gt.name.replace(/^深圳市[^区]+区/, '') : gt.name;
            const tagTxt = `${shortGt} ${gt.dist}`;
            const bw = Math.ceil(textWidth(tagTxt, 9.8) + 12);
            influenceLayer.push(`<path class="influence-line-good" d="M${fmt(ox)},${fmt(oy)} Q${fmt(mx)},${fmt(my)} ${fmt(tx2)},${fmt(ty2)}" fill="none" stroke="${M.walkColor}" stroke-width="1.5" stroke-dasharray="3 3" opacity="0.82" pointer-events="none"/>`);
            influenceLayer.push(`<g ${attr} role="button" tabindex="0" transform="translate(${fmt(tx2)} ${fmt(ty2)})">` +
              `<circle r="4.2" fill="${M.walkColor}" stroke="#ffffff" stroke-width="1.4"/>` +
              `<rect x="8" y="-7.6" width="${bw}" height="18" rx="9" fill="rgba(47,38,27,0.12)" pointer-events="none"/>` +
              `<rect x="8" y="-9" width="${bw}" height="18" rx="9" fill="#fffdf8" stroke="${M.walkColor}" stroke-width="1"/>` +
              `<text class="no-stroke" x="14" y="3.2" fill="#175c34" font-size="9.8" font-weight="650">${esc(tagTxt)}</text></g>`);
          }
        }
        const localRisks = (focusedRow.risks || []).filter(rk =>
          distM(focusedRow.plate.coord, rk.coord) <= 2200 &&
          (!state.riskFilter || eventTypeFor(rk) === state.riskFilter)
        ).slice(0, 2);
        for (const rk of localRisks) {
          const [rx, ry] = pt(project(rk.coord));
          const rt = eventTypeFor(rk);
          const info = EVENT_TYPES[rt];
          const mx = (ox + rx) / 2, my = (oy + ry) / 2 + 8;
          const tagTxt = `${info.label} · ${rk.name.split(' · ')[0]}`;
          const bw = Math.ceil(textWidth(tagTxt, 9.8) + 12);
          influenceLayer.push(`<path class="influence-line-risk" d="M${fmt(ox)},${fmt(oy)} Q${fmt(mx)},${fmt(my)} ${fmt(rx)},${fmt(ry)}" fill="none" stroke="${M.pillWarm}" stroke-width="1.5" stroke-dasharray="3 3" opacity="0.82" pointer-events="none"/>`);
          influenceLayer.push(`<g class="event-marker" data-risk="${esc(rk.id)}" role="button" tabindex="0" transform="translate(${fmt(rx)} ${fmt(ry)})">` +
            `<circle cy="1.3" r="10" fill="rgba(47,38,27,0.12)" pointer-events="none"/>` +
            `<circle r="10" fill="${info.bg}" stroke="${info.color}" stroke-width="1.4"/>${eventGlyph(rt)}` +
            `<rect x="13" y="-7.6" width="${bw}" height="18" rx="9" fill="rgba(47,38,27,0.12)" pointer-events="none"/>` +
            `<rect x="13" y="-9" width="${bw}" height="18" rx="9" fill="#fff8f6" stroke="${M.pillWarm}" stroke-width="1"/>` +
            `<text class="no-stroke" x="19" y="3.2" fill="#9e2d1b" font-size="9.8" font-weight="650">${esc(tagTxt)}</text></g>`);
        }
      }

      const activePlace = state.selectedPlaceId ? evalResult.placeRowById.get(state.selectedPlaceId) : null;
      const activeRoute = activeAff?.route || activePlace?.route || focusedRow?.route || null;
      const originCoord = activeAff?.project.coord || activePlace?.place.coord || focusedRow?.plate.coord || null;
      if (activeRoute && originCoord && evalResult.dest1) {
        const startXY = project(originCoord);
        const destXY = project(evalResult.dest1.coord);
        if (state.mode === 'rail' && activeRoute.legs?.length) {
          const railPts = [];
          for (const leg of activeRoute.legs) {
            const stList = timing.lines[leg.line]?.stations;
            if (!stList) continue;
            const a = stList.indexOf(leg.from), b = stList.indexOf(leg.to);
            if (a < 0 || b < 0) continue;
            const seg = stList.slice(Math.min(a, b), Math.max(a, b) + 1);
            if (a > b) seg.reverse();
            for (const nm of seg) {
              const p = stationXY(nm);
              if (p && (!railPts.length || Math.hypot(p[0] - railPts.at(-1)[0], p[1] - railPts.at(-1)[1]) > 0.05)) railPts.push(p);
            }
          }
          if (railPts.length) {
            const [s1, s2] = [pt(startXY), pt(railPts[0])];
            if (Math.hypot(s1[0] - s2[0], s1[1] - s2[1]) > 3) {
              parts.push(`<line x1="${fmt(s1[0])}" y1="${fmt(s1[1])}" x2="${fmt(s2[0])}" y2="${fmt(s2[1])}" stroke="${M.routeGlow}" stroke-width="4.2" pointer-events="none"/><line x1="${fmt(s1[0])}" y1="${fmt(s1[1])}" x2="${fmt(s2[0])}" y2="${fmt(s2[1])}" stroke="${M.walkColor}" stroke-width="2" stroke-dasharray="4 4" pointer-events="none"/>`);
            }
            if (railPts.length > 1) {
              const rStr = railPts.map(p => pt(p).map(fmt).join(',')).join(' ');
              parts.push(`<polyline points="${rStr}" fill="none" stroke="${M.routeGlow}" stroke-width="5.6" stroke-linejoin="round" pointer-events="none"/><polyline points="${rStr}" fill="none" stroke="${M.routeColor}" stroke-width="2.6" stroke-linejoin="round" pointer-events="none"/>`);
            }
            const [e1, e2] = [pt(railPts.at(-1)), pt(destXY)];
            if (Math.hypot(e1[0] - e2[0], e1[1] - e2[1]) > 3) {
              parts.push(`<line x1="${fmt(e1[0])}" y1="${fmt(e1[1])}" x2="${fmt(e2[0])}" y2="${fmt(e2[1])}" stroke="${M.routeGlow}" stroke-width="4.2" pointer-events="none"/><line x1="${fmt(e1[0])}" y1="${fmt(e1[1])}" x2="${fmt(e2[0])}" y2="${fmt(e2[1])}" stroke="${M.walkColor}" stroke-width="2" stroke-dasharray="4 4" pointer-events="none"/>`);
            }
          }
        } else {
          const str = [startXY, destXY].map(p => pt(p).map(fmt).join(',')).join(' ');
          parts.push(`<polyline points="${str}" fill="none" stroke="${M.routeGlow}" stroke-width="4.6" pointer-events="none"/><polyline points="${str}" fill="none" stroke="${M.routeColor}" stroke-width="2.3" stroke-dasharray="6 4" pointer-events="none"/>`);
        }
      }

      const isCompact = w < 900;
      const uiScale = labelScaleFor(k, isCompact);
      const pinScale = Math.min(1.26, 1 + (uiScale - 1) * 0.72);
      const occupied = isCompact
        ? [[0, 0, w, 138], [0, h - 88, w, h]]
        : [
            ...(leftInset > 0 ? [[0, 0, leftInset + 12, h]] : [[0, 0, 58, 58]]),
            [w - 200, 0, w, 62],
            [w - 64, h - 140, w, h],
            [leftInset + (w - leftInset) / 2 - 240, h - 72, leftInset + (w - leftInset) / 2 + 240, h],
          ];
      const reserve = (x, y, bw, bh) => {
        if (x < 6 || y < 6 || x + bw > w - 6 || y + bh > h - 6) return false;
        if (occupied.some(b => x < b[2] + 3 && x + bw > b[0] - 3 && y < b[3] + 2.5 && y + bh > b[1] - 2.5)) return false;
        occupied.push([x, y, x + bw, y + bh]);
        return true;
      };
      const forceReserve = (x, y, bw, bh) => { occupied.push([x, y, x + bw, y + bh]); };

      // 目的地金标（保留塞尔达勇者金信标）
      const destLayer = [];
      const destScreenPts = [];
      let dest1ScreenPt = null;
      for (const [isPrimary, destObj, col, ink] of [
        [true, evalResult.dest1, M.destColor, M.destInk],
        [false, evalResult.dest2, M.dest2Color, '#ffffff'],
      ]) {
        if (!destObj) continue;
        const [wx, wy] = pt(project(destObj.coord));
        if (wx < -12 || wx > w + 12 || wy < -12 || wy > h + 12) continue;
        destScreenPts.push([wx, wy]);
        if (isPrimary) dest1ScreenPt = [wx, wy];
        forceReserve(wx - 16 * pinScale, wy - 16 * pinScale, 32 * pinScale, 32 * pinScale);
        const disp = String(destObj.name || '').replace(/板块$/, '');
        const txt = (isPrimary ? '★ ' : '◆ ') + disp;
        const bw = Math.ceil(textWidth(txt, 11.5) + 18), bh = 24;
        const offsets = [[-bw / 2, -bh - 12], [-bw / 2, 14], [14, -bh / 2], [-bw - 14, -bh / 2]];
        const [dx, dy] = offsets.find(([ox, oy]) => reserve(wx + ox * pinScale, wy + oy * pinScale, bw * pinScale, bh * pinScale)) || offsets[0];
        forceReserve(wx + dx * pinScale, wy + dy * pinScale, bw * pinScale, bh * pinScale);
        destLayer.push(`<g class="dest-beacon" transform="translate(${fmt(wx)} ${fmt(wy)}) scale(${pinScale.toFixed(3)})" pointer-events="none">` +
          `<circle r="15" fill="${col}" fill-opacity="0.24"/>` +
          `<circle r="6" fill="${col}" stroke="#ffffff" stroke-width="2"/>` +
          `<rect x="${fmt(dx)}" y="${fmt(dy + 1.6)}" width="${bw}" height="${bh}" rx="12" fill="rgba(47,38,27,0.16)" pointer-events="none"/>` +
          `<rect x="${fmt(dx)}" y="${fmt(dy)}" width="${bw}" height="${bh}" rx="12" fill="${col}" stroke="#ffffff" stroke-width="1.5"/>` +
          `<text class="no-stroke" x="${fmt(dx + bw / 2)}" y="${fmt(dy + 15.8)}" text-anchor="middle" fill="${ink}" font-size="11.5" font-weight="800">${esc(txt)}</text></g>`);
      }

      // 保租房项目标（支持保租房专场或在市场房下叠看，自带多向避让）
      const affLayer = [];
      if (state.housingTrack === 'affordable' || L.affordable) {
        const affItems = (evalResult.affordableRows || []).filter(r => !state.affFilter || r.project.phase === state.affFilter);
        for (const r of affItems) {
          const pr = r.project;
          const [ax, ay] = pt(pr.xy);
          if (ax < 10 || ax > w - 10 || ay < 10 || ay > h - 10) continue;
          const active = state.selectedAffId === pr.id;
          const pVal = r.estMonthly ? fmtShortMoney(r.estMonthly) : (pr.unitPrice ? pr.unitPrice + '/㎡' : pr.phaseLabel);
          const txt = `${pr.shortName} · ${pVal}${L.commute && r.route ? ' · ' + r.route.minutes + '分' : ''}`;
          const bw = Math.ceil(textWidth(txt, 10) + 16), bh = 21;
          const sbw = bw * pinScale, sbh = bh * pinScale;
          const offsets = [
            [0, 0], [0, -24 * pinScale], [0, 24 * pinScale], [sbw / 2 + 8, 0], [-sbw / 2 - 8, 0],
            [sbw / 2 + 8, -24 * pinScale], [-sbw / 2 - 8, -24 * pinScale], [sbw / 2 + 8, 24 * pinScale], [-sbw / 2 - 8, 24 * pinScale], [0, 48 * pinScale],
          ];
          const off = active ? [0, 0] : offsets.find(([ox, oy]) => reserve(ax + ox - sbw / 2, ay + oy - sbh / 2, sbw, sbh));
          if (!off) continue;
          if (active) forceReserve(ax - sbw / 2, ay - sbh / 2, sbw, sbh);
          const [ox, oy] = off;
          const col = pr.phase === 'active' ? M.affColors.active : pr.phase === 'upcoming' ? M.affColors.upcoming : M.affColors.recent;
          const stem = (ox || oy) ? `<line x1="${fmt(-ox / pinScale)}" y1="${fmt(-oy / pinScale)}" x2="0" y2="0" stroke="${col}" stroke-width="1" stroke-dasharray="2 2" opacity="0.7" pointer-events="none"/><circle cx="${fmt(-ox / pinScale)}" cy="${fmt(-oy / pinScale)}" r="3" fill="${col}" stroke="#ffffff" stroke-width="1" pointer-events="none"/>` : '';
          affLayer.push(`<g class="aff-pin" data-aff="${esc(pr.id)}" role="button" tabindex="0" transform="translate(${fmt(ax + ox)} ${fmt(ay + oy)}) scale(${pinScale.toFixed(3)})">` +
            stem +
            `<rect x="${fmt(-bw / 2)}" y="${fmt(-bh / 2 + 1.4)}" width="${bw}" height="${bh}" rx="10.5" fill="rgba(47,38,27,0.13)" pointer-events="none"/>` +
            `<rect x="${fmt(-bw / 2)}" y="${fmt(-bh / 2)}" width="${bw}" height="${bh}" rx="10.5" fill="${active ? M.activePillBg : M.pillBg}" stroke="${active ? M.activePillBorder : col}" stroke-width="1.4"/>` +
            `<circle cx="${fmt(-bw / 2 + 8)}" cy="0" r="3" fill="${col}"/>` +
            `<text class="no-stroke" x="${fmt(-bw / 2 + 14)}" y="3.5" fill="${active ? M.activePillText : M.pillText}" font-size="10" font-weight="650">${esc(txt)}</text></g>`);
        }
      }

      // 片区标牌层
      const affOnly = state.housingTrack === 'affordable';
      const topRankMap = evalResult.topRankById || new Map();
      const bannerLayer = [];
      const visPlates = affOnly
        ? evalResult.plateRows.filter(r => inView(r.plate.bounds) && plateAffList(r, state).length === 0)
        : evalResult.plateRows.filter(r => inView(r.plate.bounds));

      visPlates.sort((a, b) =>
        Number(b.plate.id === focusedPlateId) - Number(a.plate.id === focusedPlateId) ||
        Number(topRankMap.has(b.plate.id)) - Number(topRankMap.has(a.plate.id)) ||
        Number(b.alerts?.some(x => x.priority >= 2)) - Number(a.alerts?.some(x => x.priority >= 2)) ||
        Number(b.mastery?.saved) - Number(a.mastery?.saved) ||
        (b.fit?.total ?? 0) - (a.fit?.total ?? 0) ||
        (b.plate.bounds[2] - b.plate.bounds[0]) - (a.plate.bounds[2] - a.plate.bounds[0])
      );

      for (const row of visPlates) {
        let [px, py] = pt(row.plate.xy);
        if (px < 10 || px > w - 10 || py < 10 || py > h - 10) continue;
        if (row.plate.id === focusedPlateId && dest1ScreenPt && Math.hypot(px - dest1ScreenPt[0], py - dest1ScreenPt[1]) < 32 * pinScale) {
          py = Math.min(h - 70, dest1ScreenPt[1] + 34 * pinScale);
        }
        const pill = buildPlatePill(row, px, py, state, M, k, reserve, forceReserve, topRankMap.get(row.plate.id) || 0, focusedPlateId, isCompact);
        if (pill) bannerLayer.push(pill);
      }

      const terrainLabels = [];
      const terFs = +(10.2 * uiScale).toFixed(1);
      const terH = Math.ceil(terFs * 1.4);
      if (mf.terrain !== false) {
        for (const m of atlas.terrain.mountains) {
          if (k < m.minZoom) continue;
          const [mx, my] = pt(m.xy);
          const bw = textWidth(m.name, terFs) + 6;
          if (reserve(mx - bw / 2, my - terH / 2, bw, terH)) {
            terrainLabels.push(`<text class="no-stroke" x="${fmt(mx)}" y="${fmt(my + terFs * 0.35)}" text-anchor="middle" fill="${M.mountainLabel}" font-size="${terFs}" font-weight="650" opacity="0.9">${esc(m.name)}</text>`);
          }
        }
        for (const wt of atlas.terrain.water) {
          if (k < wt.minZoom) continue;
          const [wx, wy] = pt(wt.xy);
          const bw = textWidth(wt.name, terFs) + 6;
          if (reserve(wx - bw / 2, wy - terH / 2, bw, terH)) {
            terrainLabels.push(`<text class="no-stroke" x="${fmt(wx)}" y="${fmt(wy + terFs * 0.35)}" text-anchor="middle" fill="${M.waterLabel}" font-size="${terFs}" font-weight="650" opacity="0.9">${esc(wt.name)}</text>`);
          }
        }
      }

      // 办公园区 / 商圈商场 / 交通枢纽地标（受图层参照物分类开关控制，放大时随片区字体同步清晰放大）
      const lmLayer = [];
      const maxTier = k >= 3.8 ? 3 : k >= 2.2 ? 2 : 1;
      const lmFs = +(9.8 * uiScale).toFixed(1);
      const lmDia = +(3.8 * pinScale).toFixed(1);
      for (const lm of atlas.landmarks) {
        const active = state.selectedLandmarkId === lm.id;
        if (!active && mf[lm.kind] === false) continue;
        if (!active && lm.tier > maxTier) continue;
        if (lm.name === evalResult.dest1?.name || lm.name === evalResult.dest2?.name) continue;
        const [lx, ly] = pt(lm.xy);
        if (lx < 12 || lx > w - 12 || ly < 12 || ly > h - 12) continue;
        if (!active && destScreenPts.some(([dx, dy]) => Math.hypot(lx - dx, ly - dy) < 48 * pinScale)) continue;
        const bw = Math.ceil(textWidth(lm.label, lmFs) + lmDia * 2 + 10), bh = Math.ceil(lmFs * 1.55);
        if (!active && !reserve(lx - lmDia - 2, ly - bh / 2, bw, bh)) continue;
        if (active) forceReserve(lx - lmDia - 2, ly - bh / 2, bw, bh);
        lmLayer.push(`<g class="landmark-pin" data-landmark="${esc(lm.id)}" role="button" tabindex="0" transform="translate(${fmt(lx)} ${fmt(ly)})">` +
          `<path d="M0 ${(-lmDia).toFixed(1)}L${lmDia} 0L0 ${lmDia}L${(-lmDia).toFixed(1)} 0Z" fill="${active ? M.destColor : M.pillText}" stroke="#ffffff" stroke-width="1.2"/>` +
          `<text class="no-stroke" x="${(lmDia + 3).toFixed(1)}" y="${(lmFs * 0.34).toFixed(1)}" fill="${active ? M.destColor : M.radialText}" font-size="${lmFs}" font-weight="${active ? 750 : 650}">${esc(lm.label)}</text></g>`);
      }

      const facLayer = [];
      if (L.facilities) {
        const catCol = { mall: '#007aff', school: '#6e5ce6', park: M.walkColor, health: M.pillWarm, market: '#b87409', supermarket: '#14848c', pharmacy: '#c94c6b' };
        for (const fac of atlas.facilities) {
          if (!fac.location?.gcj02) continue;
          if (state.facFilter && fac.category !== state.facFilter) continue;
          const [fx, fy] = pt(project(fac.location.gcj02));
          if (fx < -10 || fx > w + 10 || fy < -10 || fy > h + 10) continue;
          const col = catCol[fac.category] || '#007aff';
          facLayer.push(`<g data-fac="${esc(fac.id)}" role="button" tabindex="0" transform="translate(${fmt(fx)} ${fmt(fy)})"><circle r="8" fill="transparent"/><circle r="4.5" fill="${col}" stroke="#ffffff" stroke-width="1.5"/></g>`);
        }
      }

      // 6 类公开负面/避坑矢量点位（支持按类别筛选 + 自动避让片区标牌，牵引线置底、图标落空位，绝不遮挡文字）
      const riskLayer = [];
      const riskUnderLayer = [];
      if (L.risks) {
        const riskOffsets = [
          [0, 0], [0, 28], [0, -28], [0, 38], [0, -38],
          [26, 28], [-26, 28], [26, -28], [-26, -28],
          [0, 52], [0, -52], [48, 28], [-48, 28], [48, -28], [-48, -28],
          [72, 0], [-72, 0],
        ];
        for (const risk of atlas.publicEvents) {
          const rType = eventTypeFor(risk);
          if (state.riskFilter && state.riskFilter !== rType) continue;
          const [rx, ry] = pt(project(risk.coord));
          if (rx < -12 || rx > w + 12 || ry < -12 || ry > h + 12) continue;
          const active = state.selectedRiskId === risk.id;
          const info = EVENT_TYPES[rType];
          const off = active
            ? [0, 0]
            : riskOffsets.find(([ox, oy]) => reserve(rx + ox - 11.5, ry + oy - 11.5, 23, 23));
          if (off) {
            if (active) forceReserve(rx - 11.5, ry - 11.5, 23, 23);
            const [ox, oy] = off;
            if (ox || oy) {
              riskUnderLayer.push(
                `<line x1="${fmt(rx)}" y1="${fmt(ry)}" x2="${fmt(rx + ox)}" y2="${fmt(ry + oy)}" stroke="${info.color}" stroke-width="1.3" stroke-dasharray="2.5 2" opacity="0.82" pointer-events="none"/>` +
                `<circle cx="${fmt(rx)}" cy="${fmt(ry)}" r="3" fill="${info.color}" stroke="#ffffff" stroke-width="1.1" pointer-events="none"/>`
              );
            }
            riskLayer.push(`<g class="event-marker" data-risk="${esc(risk.id)}" role="button" tabindex="0" aria-label="${esc(info.label + ' · ' + risk.name)}" transform="translate(${fmt(rx + ox)} ${fmt(ry + oy)})">` +
              `<circle cy="1.4" r="10.5" fill="rgba(47,38,27,0.14)" pointer-events="none"/>` +
              `<circle r="10.5" fill="${active ? '#1d1d1f' : info.bg}" stroke="${active ? '#ffffff' : info.color}" stroke-width="${active ? 2 : 1.4}"/>` +
              `${eventGlyph(rType, active ? '#ffffff' : info.color)}</g>`);
          } else {
            // 极高密度视野退化为底层小圆点，确保绝不覆盖标牌文字
            riskUnderLayer.push(`<g class="event-marker" data-risk="${esc(risk.id)}" role="button" tabindex="0" aria-label="${esc(info.label + ' · ' + risk.name)}" transform="translate(${fmt(rx)} ${fmt(ry)})">` +
              `<circle r="5.5" fill="${info.bg}" stroke="${info.color}" stroke-width="1.4"/></g>`);
          }
        }
      }

      ovParts.push(...terrainLabels, ...lmLayer, ...facLayer, ...riskUnderLayer, ...bannerLayer, ...affLayer, ...riskLayer, ...influenceLayer, ...destLayer);
      if (reuseGeo) {
        existingGeo.dataset.zoomTier = String(tierForZoom(k));
        existingGeo.dataset.baseK = String(k);
        existingGeo.dataset.baseTx = String(tx);
        existingGeo.dataset.baseTy = String(ty);
        existingGeo.setAttribute('transform', `matrix(${k.toFixed(5)} 0 0 ${k.toFixed(5)} ${fmt(tx)} ${fmt(ty)})`);
        existingOv.removeAttribute('transform');
        existingOv.innerHTML = ovParts.join('');
      } else {
        svg.innerHTML = geoPrefixParts.join('') + ovParts.join('') + '</g>';
        lastGeoEval = evalResult;
        lastGeoKey = geoKey;
      }
    }

    function render(payload) {
      lastPayload = payload;
      const { state, evalResult, leftInset = 0 } = payload;
      const M = (payload.theme || global.NEXT_THEME).map;
      if (state.macroOpen) renderMacro(state, M);
      else if (state.layers?.commute && state.layout === 'radial' && evalResult.dest1) renderRadial(state, evalResult, M, leftInset);
      else renderGeo(state, evalResult, M, leftInset);
      return legendMarkup(state, M);
    }

    return { render, camera, project, world };
  }

  global.createNextMap = createNextMap;
})(typeof window !== 'undefined' ? window : globalThis);
