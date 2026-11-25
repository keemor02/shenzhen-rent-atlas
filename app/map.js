/* V3.5 策略/建造游戏级深圳拼图地图：
 * 1) 《文明 6》城镇状态栏（City Banner）：板块名牌 + Buff(地铁线/商场/公园/医疗/学校/可议价/实勘) + Debuff(↑贵溢价/6类避坑)
 * 2) 《城市：天际线》选中聚焦 + 影响连线：点中板块压暗周边，直接拉出绿线连向周边商场/学校/公园、红线连向避坑源、金线连向目的地
 * 3) 《文明 6》地标辐射圈：点选固定地标，高亮其 15 分钟步行圈与 30 分钟地铁直达的所有板块
 */
(function (global) {
  'use strict';

  const UNIT_COLORS = ['#247c6a', '#55a087', '#c7ab67', '#b9664c'];
  const UNIT_CUTS = [55, 75, 100];
  const TREND_COLORS = ['#6f9cc0', '#4f7591', '#314c5f', '#8d6445', '#b96f47'];
  const YOY_CUTS = [-8, -1, 1, 8];
  const MOM_CUTS = [-3, -0.5, 0.5, 3];
  const COMMUTE_COLORS = ['#247f6b', '#56a188', '#c8ac68', '#ae5e47'];
  const COMMUTE_CUTS = [25, 40, 60];
  const RADAR_COLORS = {
    opportunity: '#249478',
    premium: '#b8563c',
    tight: '#934e3e',
    mixed: '#a88d4d',
    watch: '#366862',
    neutral: '#223a3f',
  };

  // 6 类公开避坑图标（既用于地图影响连线端点，也直接嵌入板块状态栏 Debuff 槽）
  const EVENT_TYPES = {
    works:  { label: '施工绕行', color: '#efb677', icon: '<path d="M-8 -4H8V2H-8ZM-5 2V7M5 2V7M-6 0l3-4M0 0l3-4M6 0l2-3"/>' },
    air:    { label: '工业气味', color: '#b7c98c', icon: '<path d="M-8 6V-1l5 2v-4l6 3v-5h3l1 11ZM3-8q-2-2 1-3m1 3q3-1 3-3"/>' },
    rail:   { label: '轨道噪声', color: '#b5aceb', icon: '<rect x="-8" y="-7" width="9" height="12" rx="2"/><path d="M-7-3H0M-6 7l2-2m4 2-2-2M4-3q4 3 0 6m3-9q7 6 0 12"/>' },
    flight: { label: '航空噪声', color: '#94cfeb', icon: '<path d="M0-9c1 0 1.5 1.2 1.5 3.2V-2L8 3v2L1.5 2.2v3.5L4 8v1L0 7.5-4 9V8l2.5-2.3V2.2L-8 5V3l6.5-5v-3.8C-1.5-7.8-1-9 0-9Z" fill="currentColor" stroke="none"/>' },
    crowd:  { label: '枢纽客流', color: '#e7cf86', icon: '<circle cx="-2" cy="-4.5" r="2.6"/><path d="M-8 6V4a6 6 0 0 1 12 0v2ZM4-6a2.5 2.5 0 0 1 0 5m2 2q3 .5 3 5"/>' },
    noise:  { label: '生活噪声', color: '#e5959f', icon: '<path d="M-8-3h4l5-4V7l-5-4h-4ZM4-3q3 3 0 6m3-9q6 6 0 12"/>' },
  };

  // 《文明 6》状态栏配套 Buff 微图标（10×10 纯矢量，跨系统 100% 一致清晰）
  const BUFF_GLYPHS = {
    mall:   { color: '#7be0f7', title: '近大型商圈/商场', path: 'M2 4h6l.7 5.2H1.3ZM3.4 4V2.8a1.6 1.6 0 0 1 3.2 0V4' },
    park:   { color: '#72e6ad', title: '核验公园生态',   path: 'M5 1.2L2.2 5.6h1.6L1.8 8.2h6.4L6.2 5.6h1.6ZM5 8.2V9.6' },
    health: { color: '#ff9fae', title: '核验医疗/社康',  path: 'M5 1.8v6.4M1.8 5h6.4' },
    school: { color: '#ccbaff', title: '核验学校教育',   path: 'M1 4.4L5 2.2l4 2.2-4 2.2ZM2.6 5.4v2.3L5 8.9l2.4-1.2V5.4' },
  };

  function eventTypeFor(risk) {
    return ({
      '施工绕行': 'works', '工业废气': 'air', '工业异味': 'air',
      '轨道噪声': 'rail', '机场运行': 'flight', '铁路枢纽': 'crowd', '生活噪声': 'noise',
    })[risk?.kind] || 'works';
  }
  function eventGlyph(type) {
    const t = EVENT_TYPES[type] || EVENT_TYPES.works;
    return `<g aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="color:${t.color}">${t.icon}</g>`;
  }
  function eventIconSvg(type) {
    return `<svg class="event-icon" viewBox="-12 -12 24 24" aria-hidden="true" focusable="false">${eventGlyph(type)}</svg>`;
  }
  global.V3EventIcons = { EVENT_TYPES, eventTypeFor, eventIconSvg };

  function textWidth(str, fontSize) {
    let total = 0;
    for (const ch of String(str || '')) {
      const c = ch.charCodeAt(0);
      if (ch === '%') total += fontSize * 0.90;
      else if ('(),.· '.includes(ch)) total += fontSize * 0.42;
      else if (c < 128 || '¥–↑↘◆◈✈★✓/+-'.includes(ch)) total += fontSize * 0.64;
      else total += fontSize * 1.03;
    }
    return total;
  }

  function tierForZoom(k) {
    return (k >= 0.9) + (k >= 2.5) + (k >= 2.8) + (k >= 4.2);
  }

  function createMap(svg, atlas, engine, timing, esc) {
    const world = global.atlasExtent(atlas.plates.map(p => p.bounds));
    let lastPayload = null;

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
    const walkRadiusMapUnits = Math.abs((900 / 102700) * lonScale); // 15 分钟步行圈 ≈ 900m

    function fastTransform(view) {
      if (typeof svg.querySelector !== 'function') return false;
      const geo = svg.querySelector('.v3-geo');
      if (!geo || !geo.dataset?.baseK) return false;
      if (Number(geo.dataset.zoomTier) !== tierForZoom(view.k)) return false;
      const baseK = Number(geo.dataset.baseK), btx = Number(geo.dataset.baseTx), bty = Number(geo.dataset.baseTy);
      geo.setAttribute('transform', `translate(${view.tx.toFixed(2)} ${view.ty.toFixed(2)}) scale(${view.k})`);
      const ov = svg.querySelector('.v3-overlay');
      if (ov) {
        const rk = view.k / baseK;
        const dx = view.tx - btx * rk, dy = view.ty - bty * rk;
        ov.setAttribute('transform', `translate(${dx.toFixed(2)} ${dy.toFixed(2)}) scale(${rk.toFixed(4)})`);
      }
      return true;
    }

    const camera = global.makeMapCamera(
      svg, world,
      () => { if (lastPayload) render(lastPayload); },
      () => !!lastPayload && !(lastPayload.state.layers?.commute && lastPayload.state.layout === 'radial' && lastPayload.evalResult.dest1),
      fastTransform
    );

    const pickColor = (val, cuts, colors) => Number.isFinite(val) ? colors[cuts.filter(c => val >= c).length] : null;
    const fmtDist = m => m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`;
    const fmtShortMoney = n => `¥${Math.round(n).toLocaleString('zh-CN')}`;
    const distM = (a, b) => Math.hypot((a[0] - b[0]) * 102700, (a[1] - b[1]) * 110850);

    // 深圳地铁真实线路色 + 通俗中文表述（彻底告别隐晦的 M1·5+ / M2/8·9+）
    const METRO_COLORS = {
      '1': '#28b865', '2/8': '#e68c42', '2': '#e68c42', '3': '#39a7e0', '4': '#e24c4b',
      '5': '#a66bd4', '6': '#34b3a0', '7': '#3e8ce0', '9': '#b88565', '10': '#eb6ca2',
      '11': '#c75b86', '12': '#bf98de', '13': '#f09a43', '14': '#e8c448', '16': '#5d8be0',
    };
    function formatMetroTag(lines) {
      if (!lines?.length) return null;
      const color = METRO_COLORS[lines[0]] || '#6fd6ee';
      const clean = lines.map(l => (lines.length > 1 && l === '2/8') ? '2' : l);
      let text;
      if (clean.length === 1) text = `${clean[0]}号线`;
      else if (clean.length === 2) text = `${clean[0]}/${clean[1]}号线`;
      else if (clean.length === 3) text = `${clean[0]}/${clean[1]}/${clean[2]}线`;
      else text = `${clean[0]}/${clean[1]}等${clean.length}线`;
      return { text, color };
    }

    // 街道级人口密度 4 阶有序色带（低密舒展绿 → 适中青蓝 → 较密暖琥珀 → 高密珊瑚红），全城统一用「万/km²」
    const DENSITY_COLORS = ['#236b5c', '#377a8c', '#a88446', '#a85042'];
    const DENSITY_CUTS = [8000, 15000, 22000];
    const DIST_DENSITY_CUTS = [5000, 10100, 13000];
    const DENSITY_PILLS = [
      { bg: '#134237', tc: '#82f0c8', ic: '#5ce6b4', level: '低密' },
      { bg: '#1b4052', tc: '#9adbf7', ic: '#70cdf5', level: '适中' },
      { bg: '#4d3b15', tc: '#ffd98a', ic: '#f7c454', level: '较密' },
      { bg: '#59231d', tc: '#ffc7ba', ic: '#f28c74', level: '高密' },
    ];
    const densityTier = d => Number.isFinite(d) ? DENSITY_CUTS.filter(c => d >= c).length : 1;
    const fmtDensity = d => d == null ? '' : `${(d / 10000).toFixed(2)}万/km²`;
    const activeLayers = state => state.layers || { rent: true };

    function plateAffList(row, state) {
      const list = row.affordable || [];
      return state.affFilter ? list.filter(a => a.project.phase === state.affFilter) : list;
    }

    function trendValFor(row, state) {
      return state.trendKind === 'mom' ? row.trend?.mom : row.trend?.yoy;
    }

    function plateFill(row, state) {
      const fillMode = state.fillLayer || '';
      if (fillMode === 'affordable') {
        const list = plateAffList(row, state);
        if (!list.length) return '#182b30';
        const hasActive = list.some(a => a.project.phase === 'active');
        const hasRecent = list.some(a => a.project.phase === 'recent');
        const hasUpcoming = list.some(a => a.project.phase === 'upcoming');
        if ((hasActive || hasRecent) && hasUpcoming) return '#2c78b3';
        if (hasActive) return '#1f9d7b';
        if (hasUpcoming) return '#6058b8';
        return '#2c6f7a';
      }
      if (!row.eligible) return '#1d3034';
      if (fillMode === 'commute') return pickColor(row.route?.minutes, COMMUTE_CUTS, COMMUTE_COLORS) || '#243f45';
      if (fillMode === 'premium') {
        if (row.premium?.status === 'premium') return RADAR_COLORS.premium;
        return RADAR_COLORS[row.arbitrage.status] || RADAR_COLORS.neutral;
      }
      if (fillMode === 'trend') {
        return pickColor(trendValFor(row, state), state.trendKind === 'mom' ? MOM_CUTS : YOY_CUTS, TREND_COLORS);
      }
      if (fillMode === 'density') return pickColor(row.density, DENSITY_CUTS, DENSITY_COLORS) || '#243f45';
      if (fillMode === 'rent') return pickColor(row.plate.unitPrice, UNIT_CUTS, UNIT_COLORS);
      return '#243f45';
    }

    function priceLabelFor(row, state) {
      if (state.sqm > 0 && row.estMonthly) return `约${fmtShortMoney(row.estMonthly)}`;
      return row.plate.unitPrice ? `${row.plate.unitPrice}/㎡` : '';
    }

    function fmtTrendPct(tv) {
      if (tv == null) return '';
      const num = Number(tv.toFixed(1)).toString();
      return `${tv > 0 ? '+' : ''}${num}%`;
    }

    // 返回 { plain, svg }：开启涨跌时增幅直接紧跟在租金后面（如 约¥2,840(-6.3%) · 28分），涨红跌绿一目了然
    function primaryMetricParts(row, state, active) {
      const L = activeLayers(state);
      const isAffTrack = state.housingTrack === 'affordable' || (state.fillLayer === 'affordable' && !L.rent && !L.commute && !L.trend);
      if (isAffTrack) {
        const list = plateAffList(row, state);
        const segs = [];
        if (list.length) segs.push(`${list.length}处保租`);
        if (L.commute && row.route) segs.push(`${row.route.minutes}分`);
        const txt = segs.join(' · ');
        return { plain: txt, svg: esc(txt) };
      }
      if (!row.eligible) return { plain: '', svg: '' };

      const plainSegs = [];
      const svgSegs = [];
      const tv = L.trend ? trendValFor(row, state) : null;
      const tStr = tv != null ? fmtTrendPct(tv) : '';
      const tCol = active ? (tv > 0 ? '#a8341c' : '#0f664f') : (tv > 0 ? '#ffb094' : tv < 0 ? '#72f0c5' : '#b8d4cc');

      if (L.rent) {
        const p = priceLabelFor(row, state);
        if (p) {
          if (tStr) {
            plainSegs.push(`${p}(${tStr})`);
            svgSegs.push(`${esc(p)}<tspan fill="${tCol}" font-weight="750">(${esc(tStr)})</tspan>`);
          } else {
            plainSegs.push(p);
            svgSegs.push(esc(p));
          }
        } else if (tStr) {
          plainSegs.push(tStr);
          svgSegs.push(`<tspan fill="${tCol}">${esc(tStr)}</tspan>`);
        }
      } else if (tStr) {
        plainSegs.push(tStr);
        svgSegs.push(`<tspan fill="${tCol}">${esc(tStr)}</tspan>`);
      }

      if (L.commute && row.route) {
        const cTxt = `${row.route.minutes}分`;
        plainSegs.push(cTxt);
        svgSegs.push(esc(cTxt));
      }

      if (!plainSegs.length && L.premium) {
        let pFallback = '';
        if (row.premium?.status === 'premium') pFallback = `↑溢价¥${Math.round(row.premium.extra)}`;
        else if (row.arbitrage.status === 'opportunity') pFallback = '↘可捡漏';
        else if (row.premium?.status === 'direct') pFallback = '可步行';
        else pFallback = priceLabelFor(row, state);
        if (pFallback) { plainSegs.push(pFallback); svgSegs.push(esc(pFallback)); }
      }

      return {
        plain: plainSegs.join(' · '),
        svg: svgSegs.join(active ? '<tspan fill="#557d71"> · </tspan>' : '<tspan fill="#5e8782"> · </tspan>'),
      };
    }

    function primaryMetric(row, state) {
      return primaryMetricParts(row, state, false).plain;
    }

    // 《文明 6》式城镇名牌：按当前已开启的多个图层开关自动组合呈现，绝不重复！
    function buildCivBanner(row, px, py, state, k, reserve, forceReserve) {
      const pl = row.plate;
      const L = activeLayers(state);
      const active = pl.id === state.selectedPlateId;
      const saved = row.mastery?.saved;
      const visited = row.mastery?.visited;
      const isPrem = row.premium?.status === 'premium';
      const isOpp = row.arbitrage.status === 'opportunity';
      const isWalk = row.premium?.status === 'direct';
      const affOnlyMode = state.housingTrack === 'affordable' || (L.affordable && !L.rent && !L.commute && !L.trend && !L.premium && !L.density);

      const nameStr = (saved ? '★' : '') + pl.name;
      const metricObj = primaryMetricParts(row, state, active);
      const headRight = metricObj.plain;
      const nameW = textWidth(nameStr, 11);
      const rightW = headRight ? textWidth(headRight, 10) + 9 : 0;
      const headW = Math.ceil(nameW + rightW + 16);
      const headH = 19;

      const shownOpp = headRight.includes('捡漏');
      const shownPrem = headRight.includes('↑溢价');
      const shownWalk = headRight.includes('步行');
      const wantDensityChip = !affOnlyMode && L.density && row.density != null;
      const wantPremStrip = !affOnlyMode && L.premium && (isPrem || isOpp || isWalk);
      const expanded = !affOnlyMode && (k >= 2.8 || active || wantPremStrip || wantDensityChip);

      let statusSvg = '', statusW = 0, statusH = 0;
      if (expanded && row.eligible) {
        const items = [];
        if (k >= 2.8 || active) {
          const mt = formatMetroTag(pl.lines);
          if (mt) {
            items.push({ kind: 'metro', text: mt.text, dot: mt.color, w: Math.ceil(textWidth(mt.text, 9) + 14) });
          }
          const cats = new Set(pl.facCats || []);
          for (const cKey of ['mall', 'park', 'health', 'school']) {
            if (cats.has(cKey)) items.push({ kind: 'glyph', g: BUFF_GLYPHS[cKey], w: 11 });
          }
        }
        if (wantDensityChip) {
          const dp = DENSITY_PILLS[densityTier(row.density)] || DENSITY_PILLS[1];
          const dTxt = `人口 ${fmtDensity(row.density)}`;
          items.push({ kind: 'density', text: dTxt, bg: dp.bg, tc: dp.tc, ic: dp.ic, w: Math.ceil(textWidth(dTxt, 9) + 18) });
        }
        if (isOpp && !shownOpp && (k >= 2.8 || active || L.premium)) items.push({ kind: 'pill', text: '↘可捡漏', bg: '#104438', tc: '#72f0c5', w: 42 });
        if (isWalk && !shownWalk && (k >= 2.8 || active || L.premium)) items.push({ kind: 'pill', text: '可步行', bg: '#453512', tc: '#ffe08a', w: 34 });
        if (visited && (k >= 2.8 || active)) {
          const vTxt = row.mastery.avgStar ? `✓${row.mastery.avgStar}` : '✓已看房';
          items.push({ kind: 'pill', text: vTxt, bg: '#174238', tc: '#92f5d1', w: Math.ceil(textWidth(vTxt, 9) + 8) });
        }

        const debuffs = [];
        if (isPrem && !shownPrem) {
          const pTxt = `↑溢价¥${Math.round(row.premium.extra)}`;
          debuffs.push({ kind: 'pill', text: pTxt, bg: '#5c2017', tc: '#ffd5c7', w: Math.ceil(textWidth(pTxt, 9) + 8) });
        }
        if (k >= 2.8 || active || L.risks) {
          for (const rk of row.risks) {
            const rt = eventTypeFor(rk);
            if (state.riskFilter && state.riskFilter !== rt) continue;
            debuffs.push({ kind: 'risk', type: rt, w: 12 });
            if (debuffs.length >= 3) break;
          }
        }

        if (items.length || debuffs.length) {
          let cx = 4;
          const slotParts = [];
          const drawItem = it => {
            if (it.kind === 'metro') {
              slotParts.push(
                `<rect x="${cx}" y="1.5" width="${it.w}" height="12.5" rx="3" fill="#153540"/>` +
                `<circle cx="${(cx + 5.2).toFixed(1)}" cy="7.7" r="2.6" fill="${it.dot}"/>` +
                `<text class="no-stroke" x="${(cx + 10).toFixed(1)}" y="10.5" fill="#d8f4f8" font-size="9" font-weight="650">${esc(it.text)}</text>`
              );
            } else if (it.kind === 'density') {
              slotParts.push(
                `<rect class="density-pill" x="${cx}" y="1.5" width="${it.w}" height="12.5" rx="3" fill="${it.bg}"/>` +
                `<g transform="translate(${(cx + 3.2).toFixed(1)} 2.8)" fill="none" stroke="${it.ic}" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round">` +
                  `<circle cx="3.3" cy="2.6" r="1.4"/><path d="M.8 8.2c0-1.45 1.1-2.35 2.5-2.35s2.5.9 2.5 2.35"/>` +
                  `<circle cx="7.1" cy="3.2" r="1.1"/><path d="M6.4 5.9c1.05.2 1.9.95 1.9 2.3"/>` +
                `</g>` +
                `<text class="no-stroke" x="${(cx + 14.2).toFixed(1)}" y="10.5" fill="${it.tc}" font-size="9" font-weight="700">${esc(it.text)}</text>`
              );
            } else if (it.kind === 'pill') {
              slotParts.push(`<rect x="${cx}" y="1.5" width="${it.w}" height="12.5" rx="3" fill="${it.bg}"/><text class="no-stroke" x="${(cx + it.w / 2).toFixed(1)}" y="10.5" text-anchor="middle" fill="${it.tc}" font-size="9" font-weight="700">${esc(it.text)}</text>`);
            } else if (it.kind === 'glyph') {
              slotParts.push(`<g transform="translate(${cx} 2.6)" fill="none" stroke="${it.g.color}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="${it.g.path}"/></g>`);
            } else if (it.kind === 'risk') {
              const info = EVENT_TYPES[it.type];
              slotParts.push(`<g transform="translate(${cx + 5.5} 7.7) scale(0.54)" fill="none" stroke="${info.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:${info.color}">${info.icon}</g>`);
            }
            cx += it.w + 4;
          };
          items.forEach(drawItem);
          if (items.length && debuffs.length) {
            slotParts.push(`<line x1="${cx - 1}" y1="2.5" x2="${cx - 1}" y2="13" stroke="#456563" stroke-width=".9"/>`);
            cx += 3;
          }
          debuffs.forEach(drawItem);
          statusW = cx + 1;
          statusH = 15.5;
          statusSvg = slotParts.join('');
        }
      } else if (!expanded && row.eligible && !affOnlyMode && isPrem && !shownPrem) {
        const pTxt = `↑溢价¥${Math.round(row.premium.extra)}`;
        statusW = Math.ceil(textWidth(pTxt, 9) + 10);
        statusH = 14;
        statusSvg = `<rect x="2" y="1" width="${statusW - 4}" height="12" rx="3" fill="#5c2017"/><text class="no-stroke" x="${(statusW / 2).toFixed(1)}" y="9.8" text-anchor="middle" fill="#ffd5c7" font-size="9" font-weight="700">${esc(pTxt)}</text>`;
      }

      const totalW = Math.max(headW, statusW);
      const totalH = headH + (statusH ? statusH + 1 : 0);
      const bx = px - totalW / 2, by = py - totalH / 2;

      if (!active && !reserve(bx, by, totalW, totalH)) return '';
      if (active) forceReserve(bx, by, totalW, totalH);

      const borderCol = active ? '#ffefaa' : isPrem ? '#f28f6e' : isOpp ? '#55e0b6' : visited ? '#7ef2c8' : 'rgba(136,184,174,0.38)';
      const headBg = active ? '#fff0ba' : row.eligible ? 'rgba(13, 30, 35, 0.88)' : 'rgba(22, 36, 40, 0.58)';
      const nameCol = active ? '#122924' : row.eligible ? '#f2f7f0' : '#7f9897';
      const rightCol = active ? '#185346' : (shownPrem ? '#ffb299' : shownOpp ? '#72f0c5' : (L.trend && !L.rent && !L.commute && trendValFor(row, state) > 0 ? '#ffb599' : '#a7e3cf'));

      const statusBar = statusH
        ? `<g transform="translate(${((totalW - statusW) / 2).toFixed(1)} ${headH})"><rect x="0" y="0" width="${statusW}" height="${statusH}" rx="4" fill="rgba(10, 23, 27, 0.92)" stroke="rgba(116,162,154,0.34)" stroke-width=".75"/>${statusSvg}</g>`
        : '';

      const curDestRaw = (state.work || '').replace(/板块$/, '');
      const isSameAsWork = !!curDestRaw && curDestRaw === pl.name;
      let mapDestBtn = '';
      if (active && !isSameAsWork) {
        const ctaTxt = '★ 设为目的地';
        const ctaW = Math.ceil(textWidth(ctaTxt, 9.5) + 12);
        const ctaY = headH + (statusH ? statusH + 3 : 3);
        const ctaX = (totalW - ctaW) / 2;
        mapDestBtn = `<g class="map-dest-cta" data-set-work="${esc(pl.name + '板块')}" role="button" tabindex="0" transform="translate(${ctaX.toFixed(1)} ${ctaY})">` +
          `<rect x="0" y="0" width="${ctaW}" height="17" rx="8.5" fill="#ffd86b" stroke="#fff6d1" stroke-width="1.1"/>` +
          `<text class="no-stroke" x="${(ctaW / 2).toFixed(1)}" y="11.6" text-anchor="middle" fill="#0d2220" font-size="9.5" font-weight="800">${ctaTxt}</text></g>`;
      }

      // 重要异动 / 重大事件「!」感叹号警示徽章（如石岩暴涨 +25.5%、新线通车、大跌回调等）
      let alertBadge = '';
      const showAlerts = !affOnlyMode && (state.mapFilter?.majorAlerts !== false);
      if (showAlerts && row.eligible && row.alerts?.length) {
        const top = row.alerts[0];
        const aFill = top.level === 'surge' ? '#e04f35' : top.level === 'drop' ? '#1c9e79' : '#e6b33c';
        const aStroke = top.level === 'surge' ? '#fff0d6' : top.level === 'drop' ? '#d4fff0' : '#fff7d4';
        const aInk = top.level === 'event' ? '#132622' : '#ffffff';
        const pulse = top.priority >= 3 ? `<circle class="alert-pulse-ring" r="10.5" fill="none" stroke="${aFill}" stroke-width="1.4"/>` : '';
        alertBadge = `<g class="alert-badge alert-${top.level}" transform="translate(${(totalW - 1).toFixed(1)} 1)" pointer-events="none">` +
          pulse +
          `<circle r="6.8" fill="${aFill}" stroke="${aStroke}" stroke-width="1.2"/>` +
          `<text class="no-stroke" x="0" y="3.5" text-anchor="middle" fill="${aInk}" font-size="10.2" font-weight="900">!</text>` +
          `<title>${esc(top.title)}</title></g>`;
      }

      return `<g class="civ-banner" data-plate="${esc(pl.id)}" role="button" tabindex="0" aria-label="${esc(pl.name + '片区 · ' + headRight)}" transform="translate(${bx.toFixed(1)} ${by.toFixed(1)})">` +
        `<rect x="0" y="0" width="${totalW}" height="${headH}" rx="5" fill="${headBg}" stroke="${borderCol}" stroke-width="${active ? 1.6 : 0.85}"/>` +
        `<text class="no-stroke" x="7" y="13" fill="${nameCol}" font-size="11" font-weight="${active ? 750 : 650}">${esc(nameStr)}</text>` +
        (headRight ? `<text class="no-stroke" x="${(totalW - 6).toFixed(1)}" y="12.8" text-anchor="end" fill="${rightCol}" font-size="10" font-weight="700">${metricObj.svg}</text>` : '') +
        statusBar + alertBadge + mapDestBtn + `</g>`;
    }

    const MACRO_META = {
      community: { title: '普通小区均价(元/㎡)', cuts: [50, 70, 95], labels: ['<50', '50–70', '70–95', '≥95'], val: d => d.community?.price ?? null, fmt: v => `${v}元/㎡` },
      apartment: { title: '集中式公寓(元/㎡)', cuts: [55, 80, 110], labels: ['<55', '55–80', '80–110', '≥110'], val: d => d.apartment?.price ?? null, fmt: v => `${v}元/㎡` },
      village:   { title: '城中村参考(元/㎡)', cuts: [40, 55, 75], labels: ['<40', '40–55', '55–75', '≥75'], val: d => d.village?.range ? Math.round((d.village.range[0] + d.village.range[1]) / 2) : null, fmt: (v, d) => d.village?.range ? `${d.village.range[0]}–${d.village.range[1]}` : '—' },
      listing:   { title: '挂牌综合(元/㎡)', cuts: [50, 70, 95], labels: ['<50', '50–70', '70–95', '≥95'], val: d => d.listingPrice ?? null, fmt: v => `${v}元/㎡` },
      ref2022:   { title: '2022参考(元/㎡)', cuts: [50, 70, 95], labels: ['<50', '50–70', '70–95', '≥95'], val: d => d.refs2022?.[0] ?? null, fmt: v => `${v}元/㎡` },
      density:   { title: '人口密度(区级·万人/km²)', cuts: DIST_DENSITY_CUTS, colors: DENSITY_COLORS, labels: ['低密 <0.5万', '适中 0.5–1.0万', '较密 1.0–1.3万', '高密 ≥1.3万'], val: d => d.density ?? null, fmt: v => `人口 ${fmtDensity(v)}` },
    };

    const FILL_LABELS = { rent: '按租金', commute: '按通勤', trend: '按涨跌', premium: '按捡漏/避贵', affordable: '按保租房', density: '按人口' };

    function legendMarkup(state) {
      const stop = (color, text) => `<span class="legend-item"><i class="legend-swatch" style="background:${color}"></i>${esc(text)}</span>`;
      if (state.macroOpen) {
        const m = MACRO_META[state.macroMetric] || MACRO_META.community;
        const pal = m.colors || ['#2c4050', '#3d5d73', '#5786a6', '#79a8c7'];
        return m.labels.map((l, i) => stop(pal[i], l)).join('') + '<span class="legend-item"><i class="legend-swatch swatch-hatch"></i>暂无数据</span>';
      }
      const fm = state.fillLayer;
      const L = activeLayers(state);
      const mf = state.mapFilter || { terrain: true, neutralEvents: true };
      const pool = state.housingTrack === 'affordable'
        ? ['affordable', 'commute'].filter(k => L[k])
        : ['rent', 'commute', 'trend', 'premium', 'density'].filter(k => L[k]);
      const fillSel = pool.length >= 2
        ? `<label class="legend-item">底色 <select class="legend-fill-sel" data-fill-select aria-label="地图底色着色维度">${pool.map(k =>
            `<option value="${k}"${fm === k ? ' selected' : ''}>${FILL_LABELS[k] || k}</option>`
          ).join('')}</select></label>`
        : '';
      const ringNote = (state.housingTrack !== 'affordable' && L.premium)
        ? '<span class="legend-item"><i class="swatch-ring-gold"></i>目的地步行圈</span><span class="legend-item"><i class="swatch-ring-red"></i>其他园区步行圈</span>'
        : '';
      const densityInline = (state.housingTrack !== 'affordable' && L.density && fm !== 'density')
        ? '<span class="legend-item" style="color:#a6dcf5;font-weight:650">· 街道人口密度</span>' +
          stop(DENSITY_COLORS[0], '<0.8万') + stop(DENSITY_COLORS[1], '0.8–1.5万') + stop(DENSITY_COLORS[2], '1.5–2.2万') + stop(DENSITY_COLORS[3], '≥2.2万/km²')
        : '';
      if (fm === 'commute') {
        const peakTag = state.peak ? '<span class="legend-item" style="color:#f5c573;font-weight:700">早高峰估算</span>' : '';
        return fillSel + peakTag + stop(COMMUTE_COLORS[0], '<25分') + stop(COMMUTE_COLORS[1], '25–39') + stop(COMMUTE_COLORS[2], '40–59') + stop(COMMUTE_COLORS[3], '≥60') +
          (state.layout === 'radial' ? '<span class="legend-item">· 每圈10分</span>' : '<span class="legend-item">· 虚线步行 / 实线地铁</span>') + ringNote + densityInline;
      }
      if (fm === 'premium') {
        return fillSel + stop(RADAR_COLORS.opportunity, '可捡漏/好谈价') + stop(RADAR_COLORS.premium, '高溢价(↑溢价¥X)') + stop(RADAR_COLORS.mixed, '有涨有跌') +
          ringNote + (mf.neutralEvents !== false ? '<span class="legend-item">⇢ 办公外迁</span>' : '') + densityInline;
      }
      if (fm === 'affordable') {
        return fillSel + stop('#1f9d7b', '申请中') + stop('#2c6f7a', '往期批次') + stop('#6058b8', '规划在建') + stop('#2c78b3', '现房+在建') +
          '<span class="legend-item">· 2026全市筹3万/供4万套</span>';
      }
      if (fm === 'trend') {
        const tags = state.trendKind === 'mom' ? ['<-3%', '-3~-0.5', '-0.5~+0.5', '+0.5~+3', '≥+3%'] : ['<-8%', '-8~-1', '-1~+1', '+1~+8', '≥+8%'];
        return fillSel + `<span class="legend-item" style="color:#a9d9f0;font-weight:650">${state.trendKind === 'mom' ? '近一月(环比)' : '近一年(同比)'}</span>` +
          tags.map((t, i) => stop(TREND_COLORS[i], t)).join('') + '<span class="legend-item"><i class="legend-swatch swatch-hatch"></i>暂无数据</span>' + densityInline;
      }
      if (fm === 'density') {
        return fillSel + `<span class="legend-item" style="color:#a6dcf5;font-weight:650">人口密度(街道级·七普·万人/km²)</span>` +
          stop(DENSITY_COLORS[0], '低密 <0.8万') + stop(DENSITY_COLORS[1], '适中 0.8–1.5万') + stop(DENSITY_COLORS[2], '较密 1.5–2.2万') + stop(DENSITY_COLORS[3], '高密 ≥2.2万');
      }
      if (state.sqm > 0) {
        const sq = state.sqm;
        return fillSel + `<span class="legend-item" style="color:#ffea9f;font-weight:700">按 ${sq}㎡ 估月租</span>` +
          stop(UNIT_COLORS[0], `<${fmtShortMoney(55 * sq)}`) +
          stop(UNIT_COLORS[1], `${fmtShortMoney(55 * sq)}–${fmtShortMoney(75 * sq)}`) +
          stop(UNIT_COLORS[2], `${fmtShortMoney(75 * sq)}–${fmtShortMoney(100 * sq)}`) +
          stop(UNIT_COLORS[3], `≥${fmtShortMoney(100 * sq)}`) + ringNote + densityInline;
      }
      const terrainLegend = mf.terrain !== false ? stop('#1b4639', '山体') + stop('#163d51', '水库') : '';
      return fillSel + stop(UNIT_COLORS[0], '<55元/㎡') + stop(UNIT_COLORS[1], '55–74') + stop(UNIT_COLORS[2], '75–99') + stop(UNIT_COLORS[3], '≥100') +
        terrainLegend + ringNote + densityInline;
    }

    function renderMacro(state) {
      const view = camera.viewport(), { w, h, k, tx, ty, pt } = view;
      const m = MACRO_META[state.macroMetric] || MACRO_META.community;
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      const parts = [
        `<defs><pattern id="v3-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="scale(${1 / k})"><rect width="7" height="7" fill="#273e42"/><path d="M-1 1L1 -1M0 7L7 0M6 8L8 6" stroke="#476362" stroke-width=".9"/></pattern></defs>`,
        `<g class="v3-geo" data-zoom-tier="${tierForZoom(k)}" data-base-k="${k}" data-base-tx="${tx}" data-base-ty="${ty}" transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${k})">`,
      ];
      const pal = m.colors || ['#2c4050', '#3d5d73', '#5786a6', '#79a8c7'];
      for (const d of atlas.districts) {
        const val = m.val(d);
        const fill = pickColor(val, m.cuts, pal) || 'url(#v3-hatch)';
        const active = state.selectedDistrict === d.n;
        const labelVal = val != null ? m.fmt(val, d) : '缺同口径';
        parts.push(`<path class="plate-shape" data-district="${esc(d.n)}" role="button" tabindex="0" aria-label="${esc(d.n + ' · ' + labelVal)}" d="${d.p}" fill="${fill}" stroke="${active ? '#ffefaa' : '#132d32'}" stroke-width="${active ? 2.6 : 1.2}" vector-effect="non-scaling-stroke"><title>${esc(d.n + ' · ' + labelVal)}</title></path>`);
      }
      parts.push('</g><g class="v3-overlay">');
      for (const d of atlas.districts) {
        const [x, y] = pt(d.a);
        if (x < 10 || x > w - 10 || y < 10 || y > h - 10) continue;
        const val = m.val(d);
        const txt = val != null ? m.fmt(val, d) : '—';
        parts.push(`<text x="${x.toFixed(1)}" y="${(y - 2).toFixed(1)}" text-anchor="middle" fill="#f5f4e6" font-size="12" font-weight="650">${esc(d.n.replace(/新区$|区$/, ''))}</text>`);
        parts.push(`<text x="${x.toFixed(1)}" y="${(y + 12).toFixed(1)}" text-anchor="middle" fill="#d9e8dd" font-size="10.5">${esc(txt)}</text>`);
      }
      parts.push('</g>');
      svg.innerHTML = parts.join('');
    }

    function renderRadial(state, evalResult) {
      const dest = evalResult.dest1;
      const rect = svg.getBoundingClientRect();
      const w = rect.width || 1100, h = rect.height || 660;
      const isCompact = w <= 820;
      const cx = w / 2, cy = h / 2 - (isCompact ? 34 : 14);
      const maxR = Math.min(w - (isCompact ? 28 : 48), h - (isCompact ? 156 : 100)) * 0.44;
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      const parts = [`<rect width="100%" height="100%" fill="#0f2328"/>`];
      const limit = state.limit;

      for (let m = 10; m <= limit; m += 10) {
        const r = (m / limit) * maxR;
        parts.push(`<circle cx="${cx}" cy="${cy}" r="${r.toFixed(1)}" fill="none" stroke="#305250" stroke-dasharray="3 4"/>`);
        parts.push(`<text x="${(cx - 5).toFixed(1)}" y="${(cy - r - 3).toFixed(1)}" text-anchor="end" fill="#8bb4a8" font-size="11">${m}分</text>`);
      }
      for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
        parts.push(`<line x1="${cx}" y1="${cy}" x2="${(cx + Math.cos(a) * maxR).toFixed(1)}" y2="${(cy + Math.sin(a) * maxR).toFixed(1)}" stroke="#24403e" stroke-width=".8"/>`);
      }

      const toXY = (coord, min) => {
        const dx = (coord[0] - dest.coord[0]) * Math.cos(dest.coord[1] * RAD);
        const dy = dest.coord[1] - coord[1];
        const ang = Math.atan2(dy, dx);
        const r = Math.min(1, min / limit) * maxR;
        return [cx + Math.cos(ang) * r, cy + Math.sin(ang) * r];
      };

      const occupied = [[cx - 20, cy - 18, cx + textWidth(dest.name, 13) + 24, cy + 18]];
      const canLabel = (x, y, bw, bh) => {
        if (x < 10 || x + bw > w - 10 || y < 10 || y + bh > h - 88) return false;
        if (occupied.some(b => x < b[2] + 3 && x + bw > b[0] - 3 && y < b[3] + 2 && y + bh > b[1] - 2)) return false;
        occupied.push([x, y, x + bw, y + bh]);
        return true;
      };

      const reachable = evalResult.plateRows.filter(r => r.route && r.route.minutes <= limit);
      reachable.sort((a, b) => Number(a.plate.id === state.selectedPlateId) - Number(b.plate.id === state.selectedPlateId));

      for (const row of reachable) {
        const [px, py] = toXY(row.plate.coord, row.route.minutes);
        const active = row.plate.id === state.selectedPlateId;
        const saved = row.mastery?.saved;
        const isOpp = row.arbitrage.status === 'opportunity';
        const isPrem = row.premium?.status === 'premium';
        const fill = !row.eligible ? '#3d5456' : (isPrem ? '#ef8e6c' : isOpp ? '#4be0b6' : pickColor(row.plate.unitPrice, UNIT_CUTS, UNIT_COLORS) || '#87a8a2');
        const aria = `${row.plate.name}板块 · ${row.route.minutes}分钟 · ${row.plate.unitPrice}元/㎡`;
        parts.push(`<g data-plate="${esc(row.plate.id)}" role="button" tabindex="0" aria-label="${esc(aria)}" transform="translate(${px.toFixed(1)} ${py.toFixed(1)})"><title>${esc(aria)}</title>${active || saved ? `<circle r="${active ? 9.5 : 7.5}" fill="none" stroke="${active ? '#ffe89c' : '#9ee8ca'}" stroke-width="1.6"/>` : ''}<circle r="${active ? 5.5 : isOpp || isPrem ? 4.8 : 3.8}" fill="${fill}" stroke="#0f2328" stroke-width="1.2"/></g>`);
        if (active || saved || (row.eligible && (isOpp || isPrem || reachable.length < 36))) {
          const text = row.plate.name + (isPrem ? ` ↑溢价¥${Math.round(row.premium.extra)}` : ` ${priceLabelFor(row, state)}`);
          const bw = textWidth(text, 11) + 6;
          if (canLabel(px + 7, py - 9, bw, 15)) {
            parts.push(`<text x="${(px + 7).toFixed(1)}" y="${(py + 3).toFixed(1)}" fill="${active ? '#ffea9f' : isPrem ? '#ffb096' : isOpp ? '#9ef5d8' : '#d2e5dc'}" font-size="11">${esc(text)}</text>`);
          }
        }
      }

      parts.push(`<g transform="translate(${cx} ${cy})"><circle r="11" fill="#1d3c3b" stroke="#f6cb78" stroke-width="1.6"/><path d="M0 -5L5 0L0 5L-5 0Z" fill="#ffd479"/></g>`);
      parts.push(`<text x="${cx + 14}" y="${cy + 4}" fill="#ffe4a1" font-size="13" font-weight="700">${esc(dest.name)}</text>`);
      svg.innerHTML = parts.join('');
    }

    function renderGeo(state, evalResult) {
      const view = camera.viewport(), { w, h, k, tx, ty, pt } = view;
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      const fmt = n => Number(n).toFixed(2);
      const inView = ([x0, y0, x1, y1]) => x1 * k + tx > -20 && x0 * k + tx < w + 20 && y1 * k + ty > -20 && y0 * k + ty < h + 20;

      // 《城市：天际线》选中聚焦 & 《文明 6》地标辐射圈状态
      const activeAff = state.selectedAffId ? evalResult.affRowById?.get(state.selectedAffId) : null;
      const focusedPlateId = state.selectedPlateId || (activeAff ? activeAff.project.plateId : '');
      const focusedRow = focusedPlateId ? evalResult.plateRowById.get(focusedPlateId) : null;
      const aura = state.selectedLandmarkId ? engine.landmarkAura(state.selectedLandmarkId) : null;

      const clipPathById = new Map(atlas.streetClips.map(c => [c.id, c.p]));
      const clipsMarkup = atlas.streetClips.map(c => `<clipPath id="${esc(c.id)}"><path d="${c.p}"/></clipPath>`).join('');
      let selFilterMarkup = '';
      if (focusedRow) {
        const fx0 = (-tx - 30) / k, fy0 = (-ty - 30) / k;
        const fw = (w + 60) / k, fh = (h + 60) / k;
        selFilterMarkup = `<filter id="v3-sel-glow" filterUnits="userSpaceOnUse" x="${fmt(fx0)}" y="${fmt(fy0)}" width="${fmt(fw)}" height="${fmt(fh)}" color-interpolation-filters="sRGB">` +
          `<feMorphology in="SourceAlpha" operator="dilate" radius="${(2.6 / k).toFixed(3)}" result="dil"/>` +
          `<feFlood flood-color="#ffe985" flood-opacity="1" result="gold"/>` +
          `<feComposite in="gold" in2="dil" operator="in" result="ring"/>` +
          `<feGaussianBlur in="ring" stdDeviation="${(4.0 / k).toFixed(3)}" result="glow"/>` +
          `<feMerge><feMergeNode in="glow"/><feMergeNode in="ring"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
      }
      const parts = [
        `<defs>` +
          `<pattern id="v3-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="scale(${1 / k})"><rect width="7" height="7" fill="#263d41"/><path d="M-1 1L1 -1M0 7L7 0M6 8L8 6" stroke="#456160" stroke-width=".9"/></pattern>` +
          `<marker id="v3-arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M1 1.5L8.5 5L1 8.5Z" fill="#ffd482"/></marker>` +
          selFilterMarkup + clipsMarkup +
        `</defs>`,
        `<g class="v3-geo" data-zoom-tier="${tierForZoom(k)}" data-base-k="${k}" data-base-tx="${tx}" data-base-ty="${ty}" transform="translate(${fmt(tx)} ${fmt(ty)}) scale(${k})">`,
      ];

      // 1. 行政区底轮廓
      for (const d of atlas.districts) {
        parts.push(`<path d="${d.p}" fill="#172d31" stroke="#30494c" vector-effect="non-scaling-stroke" pointer-events="none"/>`);
      }

      // 2. 全城 98 块无缝居住板块拼图（先画未选中底块并柔化内部切缝；选中板块置顶用精确剪裁外发光轮廓，彻底杜绝穿屏异线！）
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
        const fill = plateFill(row, state) || 'url(#v3-hatch)';
        const strokeCol = inAuraWalk ? '#ffda78' : inAura30 ? '#78e6ce' : (pl.clipId ? 'rgba(12,28,32,0.36)' : '#12282d');
        const strokeW = inAuraWalk ? 2.2 : inAura30 ? 1.6 : (pl.clipId ? 0.85 : 0.9);
        const metric = primaryMetric(row, state);
        const aria = `${pl.district}·${pl.name}板块${metric ? ' · ' + metric : ''}`;
        return `<path class="plate-shape" data-plate="${esc(pl.id)}" role="button" tabindex="0" aria-label="${esc(aria)}" d="${pl.p}" fill="${fill}" fill-opacity="${dimmed ? '0.34' : '1'}" fill-rule="evenodd" stroke="${strokeCol}" stroke-width="${strokeW}" vector-effect="non-scaling-stroke"/>`;
      };

      for (const row of unclipped) parts.push(drawPlatePath(row));
      for (const [clipId, rows] of byClip) {
        parts.push(`<g clip-path="url(#${esc(clipId)})">${rows.map(drawPlatePath).join('')}</g>`);
        const parentD = clipPathById.get(clipId);
        if (parentD) parts.push(`<path d="${parentD}" fill="none" stroke="#10252a" stroke-width="1.15" vector-effect="non-scaling-stroke" pointer-events="none"/>`);
      }

      // 3. 自然地形雕琢（受「地图物体 · 山体与水库」筛选开关控制）
      const mf = state.mapFilter || { hub: true, mall: true, transit: true, terrain: true, neutralEvents: true };
      if (mf.terrain !== false) {
        for (const m of atlas.terrain.mountains) {
          parts.push(`<path class="terrain-mtn" d="${m.p}" fill="#1b4639" fill-opacity="0.76" stroke="#2c6352" stroke-width="0.9" vector-effect="non-scaling-stroke" pointer-events="none"/>`);
        }
        for (const wt of atlas.terrain.water) {
          parts.push(`<path class="terrain-water" d="${wt.p}" fill="#163c4f" fill-opacity="0.72" stroke="#275e78" stroke-width="0.9" vector-effect="non-scaling-stroke" pointer-events="none"/>`);
        }
        if (atlas.terrain.airport) {
          parts.push(`<path d="${atlas.terrain.airport.p}" fill="#2b424c" fill-opacity="0.78" stroke="#5f8496" stroke-dasharray="3 2" stroke-width="0.9" vector-effect="non-scaling-stroke" pointer-events="none"/>`);
        }
      }

      // 4. 地铁底网极度克制：仅在开启「通勤」图层或近景放大(k>=2.6)时以极淡线条辅助
      const L = activeLayers(state);
      if (L.commute || k >= 2.6) {
        const metroAlpha = L.commute ? 0.14 : 0.09;
        parts.push(`<g class="metro-skeleton" fill="none" stroke="rgba(210,236,228,${metroAlpha})" stroke-width="${L.commute ? 0.85 : 0.75}" stroke-linecap="round" stroke-linejoin="round" pointer-events="none">`);
        for (const line of atlas.metroLines) parts.push(`<path d="${line.p}" vector-effect="non-scaling-stroke"/>`);
        parts.push('</g>');
      }

      // 5. 置顶渲染【当前选中片区】：剪裁后的真实边界外沿发光 + 暖金提亮
      if (focusedRow) {
        const fpl = focusedRow.plate;
        const fFill = plateFill(focusedRow, state) || '#2f585e';
        const fMetric = primaryMetric(focusedRow, state);
        const fAria = `${fpl.district}·${fpl.name}片区${fMetric ? ' · ' + fMetric : ''}`;
        const inner = `<path class="plate-shape plate-selected" data-plate="${esc(fpl.id)}" role="button" tabindex="0" aria-label="${esc(fAria)}" d="${fpl.p}" fill="${fFill}" fill-rule="evenodd" stroke="none"/>` +
          `<path d="${fpl.p}" fill="#fff7d0" fill-opacity="0.22" fill-rule="evenodd" stroke="none" pointer-events="none"/>`;
        parts.push(`<g class="plate-selected-wrap" filter="url(#v3-sel-glow)">${fpl.clipId ? `<g clip-path="url(#${esc(fpl.clipId)})">${inner}</g>` : inner}</g>`);
      }

      // 6. 15 分钟步行圈（地标选中时显示单地标亮圈；市场房开启「议价」图层时显示 10 大园区步行圈）
      if (aura) {
        const [lx, ly] = project(aura.landmark.coord);
        parts.push(`<circle class="landmark-aura-ring" cx="${fmt(lx)}" cy="${fmt(ly)}" r="${fmt(walkRadiusMapUnits)}" fill="rgba(120,230,206,0.16)" stroke="#78e6ce" stroke-width="2" stroke-dasharray="4 3" vector-effect="non-scaling-stroke" pointer-events="none"/>`);
      } else if (state.housingTrack !== 'affordable' && L.premium && evalResult.dest1 && engine.hubNodes?.length) {
        const usedSet = new Set(state.usedHubs || []);
        for (const hub of engine.hubNodes) {
          const [hx, hy] = project(hub.coord);
          const isOwn = hub.name === evalResult.dest1.name || hub.name === evalResult.dest2?.name;
          const isUsed = usedSet.has(hub.name);
          const fill = isOwn ? 'rgba(255,218,120,0.13)' : isUsed ? 'rgba(100,204,169,0.10)' : 'rgba(226,125,96,0.11)';
          const stroke = isOwn ? '#ffda78' : isUsed ? '#68d6b2' : '#e28363';
          parts.push(`<circle cx="${fmt(hx)}" cy="${fmt(hy)}" r="${fmt(walkRadiusMapUnits)}" fill="${fill}" stroke="${stroke}" stroke-width="${isOwn ? 1.8 : 1.25}" stroke-dasharray="4 3" vector-effect="non-scaling-stroke" pointer-events="none"/>`);
        }
      }
      parts.push('</g><g class="v3-overlay">');

      // 办公外迁走廊弧线（受「中立事件与外迁线」筛选开关控制）
      if (state.housingTrack !== 'affordable' && L.premium && mf.neutralEvents !== false && atlas.migrations?.length) {
        for (const mig of atlas.migrations) {
          const [x1, y1] = pt(mig.fromXy), [x2, y2] = pt(mig.toXy);
          const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 - 22;
          parts.push(`<path d="M${fmt(x1)},${fmt(y1)} Q${fmt(mx)},${fmt(my)} ${fmt(x2)},${fmt(y2)}" fill="none" stroke="#ffd482" stroke-width="1.8" stroke-dasharray="5 3" opacity="0.82" marker-end="url(#v3-arrow)" pointer-events="none"/>`);
          parts.push(`<text x="${fmt(mx)}" y="${fmt(my + 5)}" text-anchor="middle" fill="#ffe6a8" font-size="10.5" font-weight="650">${esc(mig.label)}</text>`);
        }
      }

      // 《城市：天际线》选中板块克制近距影响连线（严格限定 1.8km 商圈/设施与 2.2km 避坑，绝不乱射跨区长线！）
      const activePlace = state.selectedPlaceId ? evalResult.placeRowById.get(state.selectedPlaceId) : null;
      const activePlate = focusedRow;
      const skylinesLayer = [];
      if (activePlate) {
        const [ox, oy] = pt(activePlate.plate.xy);
        if (mf.neutralEvents !== false || L.facilities) {
          const greenTargets = [];
          const seenNames = new Set();
          for (const m of activePlate.plate.malls || []) {
            if (m.meters > 1800) continue;
            seenNames.add(m.name);
            greenTargets.push({ kind: 'landmark', id: m.id, name: m.name, dist: fmtDist(m.meters), coord: m.coord });
          }
          for (const f of activePlate.nearbyFacs || []) {
            if (f.meters > 1800 || seenNames.has(f.name)) continue;
            seenNames.add(f.name);
            greenTargets.push({ kind: 'fac', id: f.id, name: f.name, dist: fmtDist(f.meters), coord: f.location.gcj02 });
          }
          for (const gt of greenTargets.slice(0, 2)) {
            const [tx2, ty2] = pt(project(gt.coord));
            const mx = (ox + tx2) / 2, my = (oy + ty2) / 2 - 8;
            const attr = gt.kind === 'landmark' ? `data-landmark="${esc(gt.id)}"` : `data-fac="${esc(gt.id)}"`;
            const tagTxt = `${gt.name} ${gt.dist}`;
            const bw = Math.ceil(textWidth(tagTxt, 10) + 12);
            skylinesLayer.push(`<path class="influence-line-good" d="M${fmt(ox)},${fmt(oy)} Q${fmt(mx)},${fmt(my)} ${fmt(tx2)},${fmt(ty2)}" fill="none" stroke="#62e6ba" stroke-width="1.5" stroke-dasharray="3 3" opacity="0.76" pointer-events="none"/>`);
            skylinesLayer.push(`<g ${attr} role="button" tabindex="0" transform="translate(${fmt(tx2)} ${fmt(ty2)})">` +
              `<circle r="4.5" fill="#62e6ba" stroke="#0d2624" stroke-width="1.4"/>` +
              `<rect x="8" y="-9" width="${bw}" height="18" rx="4" fill="#0d312bf0" stroke="#62e6ba" stroke-width="1"/>` +
              `<text class="no-stroke" x="14" y="3.2" fill="#c7fce8" font-size="10" font-weight="650">${esc(tagTxt)}</text></g>`);
          }
        }

        const localRisks = (activePlate.risks || []).filter(rk =>
          distM(activePlate.plate.coord, rk.coord) <= 2200 &&
          (!state.riskFilter || eventTypeFor(rk) === state.riskFilter)
        ).slice(0, 2);
        for (const rk of localRisks) {
          const [rx, ry] = pt(project(rk.coord));
          const rt = eventTypeFor(rk);
          const info = EVENT_TYPES[rt];
          const mx = (ox + rx) / 2, my = (oy + ry) / 2 + 8;
          const tagTxt = `${info.label} · ${rk.name.split(' · ')[0]}`;
          const bw = Math.ceil(textWidth(tagTxt, 10) + 12);
          skylinesLayer.push(`<path class="influence-line-risk" d="M${fmt(ox)},${fmt(oy)} Q${fmt(mx)},${fmt(my)} ${fmt(rx)},${fmt(ry)}" fill="none" stroke="#f28466" stroke-width="1.5" stroke-dasharray="3 3" opacity="0.80" pointer-events="none"/>`);
          skylinesLayer.push(`<g class="event-marker" data-risk="${esc(rk.id)}" role="button" tabindex="0" transform="translate(${fmt(rx)} ${fmt(ry)})">` +
            `<circle class="marker-hit" r="10.5" fill="#2c1917" stroke="${info.color}" stroke-width="1.4"/>${eventGlyph(rt)}` +
            `<rect x="13" y="-9" width="${bw}" height="18" rx="4" fill="#3b1b17f0" stroke="#f28466" stroke-width="1"/>` +
            `<text class="no-stroke" x="19" y="3.2" fill="#ffd6c8" font-size="10" font-weight="650">${esc(tagTxt)}</text></g>`);
        }
      }

      // C. 金线 -> 门到门通勤路线
      const activeRoute = activeAff?.route || activePlace?.route || activePlate?.route || null;
      const originCoord = activeAff?.project.coord || activePlace?.place.coord || activePlate?.plate.coord || null;
      if (activeRoute && originCoord && evalResult.dest1) {
        const startXY = project(originCoord);
        const destXY = project(evalResult.dest1.coord);
        if (state.mode === 'rail' && activeRoute.legs?.length) {
          const railPts = [];
          for (const leg of activeRoute.legs) {
            const stList = timing.lines[leg.line]?.stations;
            if (stList) {
              const a = stList.indexOf(leg.from), b = stList.indexOf(leg.to);
              if (a >= 0 && b >= 0) {
                const seg = stList.slice(Math.min(a, b), Math.max(a, b) + 1);
                if (a > b) seg.reverse();
                for (const nm of seg) {
                  const p = stationXY(nm);
                  if (p && (!railPts.length || Math.hypot(p[0] - railPts.at(-1)[0], p[1] - railPts.at(-1)[1]) > 0.05)) railPts.push(p);
                }
              }
            }
          }
          if (railPts.length) {
            const [s1, s2] = [pt(startXY), pt(railPts[0])];
            if (Math.hypot(s1[0] - s2[0], s1[1] - s2[1]) > 3) {
              parts.push(`<line x1="${fmt(s1[0])}" y1="${fmt(s1[1])}" x2="${fmt(s2[0])}" y2="${fmt(s2[1])}" stroke="#122e32" stroke-width="4" pointer-events="none"/><line x1="${fmt(s1[0])}" y1="${fmt(s1[1])}" x2="${fmt(s2[0])}" y2="${fmt(s2[1])}" stroke="#8ee4c4" stroke-width="2" stroke-dasharray="4 4" pointer-events="none"/>`);
            }
            if (railPts.length > 1) {
              const rStr = railPts.map(p => pt(p).map(fmt).join(',')).join(' ');
              parts.push(`<polyline points="${rStr}" fill="none" stroke="#163433" stroke-width="5.2" stroke-linejoin="round" pointer-events="none"/><polyline points="${rStr}" fill="none" stroke="#ffe194" stroke-width="2.5" stroke-linejoin="round" pointer-events="none"/>`);
              const [bx, by] = pt(railPts[0]);
              parts.push(`<circle cx="${fmt(bx)}" cy="${fmt(by)}" r="3.5" fill="#8ee4c4" stroke="#122b2b" stroke-width="1.2" pointer-events="none"/>`);
            }
            const [e1, e2] = [pt(railPts.at(-1)), pt(destXY)];
            if (Math.hypot(e1[0] - e2[0], e1[1] - e2[1]) > 3) {
              parts.push(`<line x1="${fmt(e1[0])}" y1="${fmt(e1[1])}" x2="${fmt(e2[0])}" y2="${fmt(e2[1])}" stroke="#122e32" stroke-width="4" pointer-events="none"/><line x1="${fmt(e1[0])}" y1="${fmt(e1[1])}" x2="${fmt(e2[0])}" y2="${fmt(e2[1])}" stroke="#8ee4c4" stroke-width="2" stroke-dasharray="4 4" pointer-events="none"/>`);
            }
          }
        } else {
          const str = [startXY, destXY].map(p => pt(p).map(fmt).join(',')).join(' ');
          parts.push(`<polyline points="${str}" fill="none" stroke="#173534" stroke-width="4.5" pointer-events="none"/><polyline points="${str}" fill="none" stroke="#ffe194" stroke-width="2.2" stroke-dasharray="6 4" pointer-events="none"/>`);
        }
      }

      // 屏幕碰撞避让区（自适应桌面端与移动端底部滚动坞/顶部状态条）
      const isCompact = w <= 820;
      const occupied = isCompact
        ? [
            [0, 0, Math.min(250, w), 36],
            [0, h - 104, w, h],
            [w - 134, h - 224, w, h - 94],
          ]
        : [
            [w - 154, h - 196, w, h],
            [w / 2 - 230, h - 98, w / 2 + 230, h],
          ];
      const reserve = (x, y, bw, bh) => {
        if (x < 6 || y < 6 || x + bw > w - 6 || y + bh > h - 6) return false;
        if (occupied.some(b => x < b[2] + 4 && x + bw > b[0] - 4 && y < b[3] + 3 && y + bh > b[1] - 3)) return false;
        occupied.push([x, y, x + bw, y + bh]);
        return true;
      };
      const forceReserve = (x, y, bw, bh) => { occupied.push([x, y, x + bw, y + bh]); };

      // 1. 目的地「主城信标」最高优先级（脉冲双金环 + 高对比反色金标，一眼锁定！）
      const destLayer = [];
      const destScreenPts = [];
      let dest1ScreenPt = null;
      for (const [isPrimary, destObj, col, prefix] of [
        [true, evalResult.dest1, '#ffd86b', '★ 目的地 · '],
        [false, evalResult.dest2, '#7fd3ff', '◆ 二程 · '],
      ]) {
        if (!destObj) continue;
        const [wx, wy] = pt(project(destObj.coord));
        if (wx < -12 || wx > w + 12 || wy < -12 || wy > h + 12) continue;
        destScreenPts.push([wx, wy]);
        if (isPrimary) dest1ScreenPt = [wx, wy];
        forceReserve(wx - 16, wy - 16, 32, 32);
        const dispName = String(destObj.name || '').replace(/板块$/, '');
        const badgeTxt = prefix + dispName;
        const fs = isPrimary ? 12 : 11;
        const bw = Math.ceil(textWidth(badgeTxt, fs) + 16), bh = isPrimary ? 24 : 21;
        const offsets = [
          [-bw / 2, -bh - 15],
          [-bw / 2, 16],
          [16, -bh / 2],
          [-bw - 16, -bh / 2],
        ];
        const [dx, dy] = offsets.find(([ox, oy]) => reserve(wx + ox, wy + oy, bw, bh)) || offsets[0];
        forceReserve(wx + dx, wy + dy, bw, bh);
        const stemY2 = dy < 0 ? dy + bh : dy;
        const rings = isPrimary
          ? `<circle class="dest-pulse-ring" r="26" fill="rgba(255,216,107,0.16)" stroke="rgba(255,216,107,0.65)" stroke-width="1.3"/>` +
            `<circle r="13.5" fill="rgba(255,216,107,0.12)" stroke="${col}" stroke-width="1.6" stroke-dasharray="3 2.5"/>`
          : `<circle r="13" fill="rgba(127,211,255,0.14)" stroke="${col}" stroke-width="1.4" stroke-dasharray="3 2.5"/>`;
        destLayer.push(`<g class="dest-beacon" transform="translate(${fmt(wx)} ${fmt(wy)})" pointer-events="none">` +
          rings +
          `<line x1="0" y1="0" x2="${fmt(dx + bw / 2)}" y2="${fmt(stemY2)}" stroke="${col}" stroke-width="1.6"/>` +
          `<path d="M0 -8.5L8.5 0L0 8.5L-8.5 0Z" fill="${col}" stroke="#0d2220" stroke-width="1.8"/>` +
          `<circle r="2.8" fill="#ffffff"/>` +
          `<rect x="${fmt(dx)}" y="${fmt(dy)}" width="${bw}" height="${bh}" rx="6" fill="${col}" stroke="#fff8db" stroke-width="1.4"/>` +
          `<text class="no-stroke" x="${fmt(dx + bw / 2)}" y="${fmt(dy + (isPrimary ? 16 : 14))}" text-anchor="middle" fill="#0d2220" font-size="${fs}" font-weight="800">${esc(badgeTxt)}</text>` +
          `<title>${esc(badgeTxt)}</title></g>`);
      }

      // 1.5 保租房探索图层项目大头针（开启「保租房」即可与其他图层自由同屏叠加！）
      const affLayer = [];
      if (L.affordable) {
        const phaseRank = { active: 3, upcoming: 2, recent: 1 };
        const affItems = (evalResult.affordableRows || []).filter(r => !state.affFilter || r.project.phase === state.affFilter);
        affItems.sort((a, b) =>
          Number(b.project.id === state.selectedAffId) - Number(a.project.id === state.selectedAffId) ||
          (phaseRank[b.project.phase] || 0) - (phaseRank[a.project.phase] || 0) ||
          (b.project.units || 0) - (a.project.units || 0)
        );
        for (const r of affItems) {
          const pr = r.project;
          const [ax, ay] = pt(pr.xy);
          if (ax < 10 || ax > w - 10 || ay < 10 || ay > h - 10) continue;
          const active = state.selectedAffId === pr.id;
          const isUp = pr.phase === 'upcoming', isAct = pr.phase === 'active';
          const bg = active ? '#fff0ba' : isAct ? 'rgba(13, 68, 55, 0.94)' : isUp ? 'rgba(44, 38, 92, 0.94)' : 'rgba(18, 56, 66, 0.92)';
          const border = active ? '#ffefaa' : isAct ? '#5ef0c2' : isUp ? '#b5a8ff' : '#6ecbe0';
          const tc = active ? '#102422' : isAct ? '#d4fff0' : isUp ? '#e6e0ff' : '#d2f5fc';
          const subCol = active ? '#1b5346' : isAct ? '#7ef5cc' : isUp ? '#c4b8ff' : '#8ee4f5';
          const badge = isUp ? '◆ 未来' : isAct ? '● 申请中' : '○ 往期';
          const priceBit = r.estMonthly ? `约${fmtShortMoney(r.estMonthly)}` : pr.unitPrice ? `${pr.unitPrice}/㎡` : (pr.units ? `${pr.units}套` : pr.phaseLabel);
          const rightTxt = (L.commute && r.route) ? `${priceBit} · ${r.route.minutes}分` : priceBit;
          const leftTxt = `${badge} ${pr.shortName}`;
          const lw = textWidth(leftTxt, 10.5), rw = textWidth(rightTxt, 9.5) + 8;
          const bw = Math.ceil(lw + rw + 14), bh = 21;
          const offsets = [
            [0, 0], [0, -24], [0, 24], [bw / 2 + 8, 0], [-bw / 2 - 8, 0],
            [bw / 2 + 8, -24], [-bw / 2 - 8, -24], [bw / 2 + 8, 24], [-bw / 2 - 8, 24], [0, 48],
          ];
          const off = active ? [0, 0] : offsets.find(([ox, oy]) => reserve(ax + ox - bw / 2, ay + oy - bh / 2, bw, bh));
          if (!off) continue;
          if (active) forceReserve(ax - bw / 2, ay - bh / 2, bw, bh);
          const [ox, oy] = off;
          const aria = `保租房 · ${pr.name}（${pr.phaseLabel} · ${pr.unitsText}）`;
          const stem = (ox || oy) ? `<line x1="${fmt(-ox)}" y1="${fmt(-oy)}" x2="0" y2="0" stroke="${border}" stroke-width="1" stroke-dasharray="2 2" opacity="0.65" pointer-events="none"/><circle cx="${fmt(-ox)}" cy="${fmt(-oy)}" r="3" fill="${border}" stroke="#0d2224" stroke-width="1" pointer-events="none"/>` : '';
          affLayer.push(`<g class="aff-pin" data-aff="${esc(pr.id)}" role="button" tabindex="0" aria-label="${esc(aria)}" transform="translate(${fmt(ax + ox)} ${fmt(ay + oy)})">` +
            stem +
            `<rect x="${fmt(-bw / 2)}" y="${fmt(-bh / 2)}" width="${bw}" height="${bh}" rx="6" fill="${bg}" stroke="${border}" stroke-width="${active ? 1.8 : 1.1}"/>` +
            `<text class="no-stroke" x="${fmt(-bw / 2 + 7)}" y="3.5" fill="${tc}" font-size="10.5" font-weight="700">${esc(leftTxt)}</text>` +
            `<text class="no-stroke" x="${fmt(bw / 2 - 6)}" y="3.4" text-anchor="end" fill="${subCol}" font-size="9.5" font-weight="700">${esc(rightTxt)}</text></g>`);
        }
      }

      // 2. 《文明 6》式城镇状态栏优先于辅助地标（保租房专场下让保租房项目标唱主角，只保留无保租房片区的参考）
      const affOnly = state.housingTrack === 'affordable' || (L.affordable && !L.rent && !L.commute && !L.trend && !L.premium && !L.density);
      const bannerLayer = [];
      const visPlates = affOnly
        ? evalResult.plateRows.filter(r => inView(r.plate.bounds) && plateAffList(r, state).length === 0)
        : evalResult.plateRows.filter(r => inView(r.plate.bounds));
      visPlates.sort((a, b) =>
        Number(b.plate.id === focusedPlateId) - Number(a.plate.id === focusedPlateId) ||
        Number(b.mastery?.visited) - Number(a.mastery?.visited) ||
        Number(b.mastery?.saved) - Number(a.mastery?.saved) ||
        Number(b.premium?.status === 'premium') - Number(a.premium?.status === 'premium') ||
        Number(b.arbitrage.status === 'opportunity') - Number(a.arbitrage.status === 'opportunity') ||
        Number(!!b.plate.clipId) - Number(!!a.plate.clipId) ||
        (b.plate.bounds[2] - b.plate.bounds[0]) - (a.plate.bounds[2] - a.plate.bounds[0])
      );

      for (const row of visPlates) {
        let [px, py] = pt(row.plate.xy);
        if (px < 10 || px > w - 10 || py < 10 || py > h - 10) continue;
        // 选中板块恰好与主城目的地重合时，把城镇名牌柔和下移避让信标菱形，上下错落零重叠！
        if (row.plate.id === focusedPlateId && dest1ScreenPt && Math.hypot(px - dest1ScreenPt[0], py - dest1ScreenPt[1]) < 34) {
          py = Math.min(h - 76, dest1ScreenPt[1] + 34);
        }
        const banner = buildCivBanner(row, px, py, state, k, reserve, forceReserve);
        if (banner) bannerLayer.push(banner);
      }

      // 3. 山体 / 水库柔和地形标注（受「地图物体 · 山体与水库」筛选开关控制）
      const terrainLabels = [];
      if (mf.terrain !== false) {
        for (const m of atlas.terrain.mountains) {
          if (k < m.minZoom) continue;
          const [mx, my] = pt(m.xy);
          const bw = textWidth(m.name, 10.5) + 4;
          if (reserve(mx - bw / 2, my - 7, bw, 14)) {
            terrainLabels.push(`<text x="${fmt(mx)}" y="${fmt(my + 3.5)}" text-anchor="middle" fill="#7cb89b" font-size="10.5" font-weight="600" opacity="0.78">${esc(m.name)}</text>`);
          }
        }
        for (const wt of atlas.terrain.water) {
          if (k < wt.minZoom) continue;
          const [wx, wy] = pt(wt.xy);
          const bw = textWidth(wt.name, 10) + 4;
          if (reserve(wx - bw / 2, wy - 7, bw, 14)) {
            terrainLabels.push(`<text x="${fmt(wx)}" y="${fmt(wy + 3.5)}" text-anchor="middle" fill="#7ebad4" font-size="10" font-weight="550" opacity="0.78">${esc(wt.name)}</text>`);
          }
        }
      }

      // 4. 固定知名地标轻量化锚点（受「办公园区 / 商圈商场 / 交通枢纽」物体筛选开关控制）
      const lmLayer = [];
      const maxTier = k >= 4.2 ? 3 : k >= 2.5 ? 2 : 1;
      for (const lm of atlas.landmarks) {
        const active = state.selectedLandmarkId === lm.id;
        if (!active && mf[lm.kind] === false) continue;
        if (!active && lm.tier > maxTier) continue;
        if (lm.name === evalResult.dest1?.name || lm.name === evalResult.dest2?.name) continue;
        const [lx, ly] = pt(lm.xy);
        if (lx < 10 || lx > w - 10 || ly < 10 || ly > h - 10) continue;
        // 避让目的地信标周围 56px，防止近邻地标干扰主城辨识
        if (!active && destScreenPts.some(([dx, dy]) => Math.hypot(lx - dx, ly - dy) < 56)) continue;

        const col = lm.kind === 'hub' ? '#f2cc78' : lm.kind === 'mall' ? '#85daf2' : '#cbbbf8';
        const bw = Math.ceil(textWidth(lm.label, 10) + 16), bh = 16;
        const offsets = [[0, 0], [0, -16], [0, 16], [bw / 2 + 6, 0], [-bw / 2 - 6, 0]];
        const off = active ? [0, 0] : offsets.find(([ox, oy]) => reserve(lx + ox - bw / 2, ly + oy - bh / 2, bw, bh));
        if (!off) continue;
        if (active) forceReserve(lx - bw / 2, ly - bh / 2, bw, bh);
        const [ox, oy] = off;
        const aria = `地标 · ${lm.name}（${lm.note}）`;
        if (active) {
          const aw = Math.ceil(textWidth('◆ ' + lm.label, 10.5) + 14);
          const ctaW = Math.ceil(textWidth('★ 设为目的地', 9.5) + 12);
          lmLayer.push(`<g class="landmark-pin" data-landmark="${esc(lm.id)}" role="button" tabindex="0" aria-label="${esc(aria)}" transform="translate(${fmt(lx)} ${fmt(ly)})">` +
            `<rect x="${fmt(-aw / 2)}" y="-9.5" width="${aw}" height="19" rx="9.5" fill="#fff0ba" stroke="#e8c468" stroke-width="1.4"/>` +
            `<text class="no-stroke" x="0" y="3.5" text-anchor="middle" fill="#142a25" font-size="10.5" font-weight="700">${esc('◆ ' + lm.label)}</text>` +
            `<g class="map-dest-cta" data-set-work="${esc(lm.name)}" role="button" tabindex="0" transform="translate(${fmt(-ctaW / 2)} 13)">` +
            `<rect x="0" y="0" width="${ctaW}" height="17" rx="8.5" fill="#ffd86b" stroke="#fff6d1" stroke-width="1.1"/>` +
            `<text class="no-stroke" x="${fmt(ctaW / 2)}" y="11.6" text-anchor="middle" fill="#0d2220" font-size="9.5" font-weight="800">★ 设为目的地</text></g></g>`);
        } else {
          lmLayer.push(`<g class="landmark-pin" data-landmark="${esc(lm.id)}" role="button" tabindex="0" aria-label="${esc(aria)}" transform="translate(${fmt(lx + ox)} ${fmt(ly + oy)})">` +
            `<path d="M0 -3.8L3.8 0L0 3.8L-3.8 0Z" fill="${col}" stroke="#0d2226" stroke-width="1"/>` +
            `<text x="6" y="3.2" fill="${col}" font-size="10" font-weight="600" opacity="0.86">${esc(lm.label)}</text></g>`);
        }
      }

      // 5. 可选全图避坑/配套叠加层
      const riskLayer = [];
      if (L.risks) {
        for (const risk of atlas.publicEvents) {
          const rType = eventTypeFor(risk);
          if (state.riskFilter && state.riskFilter !== rType) continue;
          const [rx, ry] = pt(project(risk.coord));
          if (rx < -12 || rx > w + 12 || ry < -12 || ry > h + 12) continue;
          const active = state.selectedRiskId === risk.id;
          const info = EVENT_TYPES[rType];
          riskLayer.push(`<g class="event-marker" data-risk="${esc(risk.id)}" role="button" tabindex="0" aria-label="${esc(info.label + ' · ' + risk.name)}" transform="translate(${fmt(rx)} ${fmt(ry)})"><circle class="marker-hit" r="11" fill="#173039" stroke="${active ? '#fff2ba' : info.color}" stroke-width="${active ? 2.2 : 1.2}"/>${eventGlyph(rType)}</g>`);
        }
      }
      const facLayer = [];
      if (L.facilities) {
        const catCol = { mall: '#78d9f5', school: '#c8b8ff', park: '#7be0a7', health: '#ff9ea8' };
        for (const fac of atlas.facilities) {
          if (!fac.location?.gcj02) continue;
          if (state.facFilter && fac.category !== state.facFilter) continue;
          const [fx, fy] = pt(project(fac.location.gcj02));
          if (fx < -10 || fx > w + 10 || fy < -10 || fy > h + 10) continue;
          const col = catCol[fac.category] || '#8ce0cf';
          facLayer.push(`<g data-fac="${esc(fac.id)}" role="button" tabindex="0" aria-label="${esc('配套 · ' + fac.name)}" transform="translate(${fmt(fx)} ${fmt(fy)})"><circle r="8" fill="transparent"/><rect x="-4.5" y="-4.5" width="9" height="9" rx="2" fill="${col}" stroke="#10252a" stroke-width="1.3"/></g>`);
        }
      }

      parts.push(...terrainLabels, ...lmLayer, ...bannerLayer, ...affLayer, ...facLayer, ...riskLayer, ...skylinesLayer, ...destLayer, '</g>');
      svg.innerHTML = parts.join('');
    }

    function render(payload) {
      lastPayload = payload;
      const { state, evalResult } = payload;
      if (state.macroOpen) {
        renderMacro(state);
      } else if (activeLayers(state).commute && state.layout === 'radial' && evalResult.dest1) {
        renderRadial(state, evalResult);
      } else {
        renderGeo(state, evalResult);
      }
      return legendMarkup(state);
    }

    return { render, camera, project, world };
  }

  global.createV3Map = createMap;
})(typeof window !== 'undefined' ? window : globalThis);
