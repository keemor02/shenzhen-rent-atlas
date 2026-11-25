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
      total += (c < 128 || '¥–·↑↘◆◈✈★✓/'.includes(ch)) ? fontSize * 0.62 : fontSize * 1.02;
    }
    return total;
  }

  function tierForZoom(k) {
    return (k >= 0.9) + (k >= 1.85) + (k >= 3.2) + (k >= 5.5);
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
      () => !!lastPayload && !(lastPayload.state.lens === 'commute' && lastPayload.state.layout === 'radial' && lastPayload.evalResult.dest1),
      fastTransform
    );

    const pickColor = (val, cuts, colors) => Number.isFinite(val) ? colors[cuts.filter(c => val >= c).length] : null;
    const fmtDist = m => m < 100 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`;

    function plateFill(row, state) {
      if (!row.eligible) return '#1d3034';
      if (state.lens === 'commute') return pickColor(row.route?.minutes, COMMUTE_CUTS, COMMUTE_COLORS);
      if (state.lens === 'radar') {
        if (row.premium?.status === 'premium') return RADAR_COLORS.premium;
        return RADAR_COLORS[row.arbitrage.status] || RADAR_COLORS.neutral;
      }
      if (state.rentSub === 'yoy') return pickColor(row.trend?.yoy, YOY_CUTS, TREND_COLORS);
      if (state.rentSub === 'mom') return pickColor(row.trend?.mom, MOM_CUTS, TREND_COLORS);
      return pickColor(row.plate.unitPrice, UNIT_CUTS, UNIT_COLORS);
    }

    function primaryMetric(row, state) {
      if (!row.eligible) return '';
      if (state.lens === 'commute') return row.route ? `${row.route.minutes}分` : '';
      if (state.lens === 'radar') {
        if (row.premium?.status === 'premium') return `↑贵¥${Math.round(row.premium.extra)}`;
        if (row.arbitrage.status === 'opportunity') return '↘议价';
        if (row.premium?.status === 'direct') return '可步行';
        return `${row.plate.unitPrice}/㎡`;
      }
      if (state.rentSub === 'yoy') return row.trend?.yoy != null ? `${row.trend.yoy > 0 ? '+' : ''}${row.trend.yoy}%` : '';
      if (state.rentSub === 'mom') return row.trend?.mom != null ? `${row.trend.mom > 0 ? '+' : ''}${row.trend.mom}%` : '';
      return row.plate.unitPrice ? `${row.plate.unitPrice}/㎡` : '';
    }

    // 《文明 6》式城镇名牌（City Banner）构建器：
    // 远景(k<1.85) = 紧凑单行名牌 + 1枚核心印章；中近景(k>=1.85) = 名牌 + 下方附挂 Buff(地铁/商圈/公园/医疗/学校/实勘) & Debuff(↑贵/避坑) 状态条！
    function buildCivBanner(row, px, py, state, k, reserve, forceReserve) {
      const pl = row.plate;
      const active = pl.id === state.selectedPlateId;
      const expanded = k >= 1.85 || active;
      const saved = row.mastery?.saved;
      const visited = row.mastery?.visited;
      const isPrem = row.premium?.status === 'premium';
      const isOpp = row.arbitrage.status === 'opportunity';
      const isWalk = row.premium?.status === 'direct';

      const nameStr = (saved ? '★' : '') + pl.name;
      const metricStr = primaryMetric(row, state);
      const commExtra = expanded && state.lens === 'rent' && row.route ? `${row.route.minutes}分` : '';
      const headRight = [metricStr, commExtra].filter(Boolean).join('·');

      const nameW = textWidth(nameStr, 11);
      const rightW = headRight ? textWidth(headRight, 10) + 7 : 0;
      const headW = Math.ceil(nameW + rightW + 14);
      const headH = 19;

      // 构建附属状态栏 Buff / Debuff 槽（中近景或选中时展开；远景仅对高价值信号挂极简角标）
      let statusSvg = '', statusW = 0, statusH = 0;
      if (expanded && row.eligible) {
        const items = [];
        // Left Buffs: 真实地铁线号 + 商场 + 公园 + 医疗 + 学校 + 议价 + 实勘
        if (pl.lines?.length) {
          const lnTxt = 'M' + (pl.lines.length <= 2 ? pl.lines.join('·') : pl.lines.slice(0, 2).join('·') + '+');
          items.push({ kind: 'pill', text: lnTxt, bg: '#153a46', tc: '#8ee6f8', w: Math.ceil(textWidth(lnTxt, 9) + 6) });
        }
        const cats = new Set(pl.facCats || []);
        for (const cKey of ['mall', 'park', 'health', 'school']) {
          if (cats.has(cKey)) items.push({ kind: 'glyph', g: BUFF_GLYPHS[cKey], w: 11 });
        }
        if (isOpp) items.push({ kind: 'pill', text: '↘议价', bg: '#104438', tc: '#72f0c5', w: 32 });
        if (isWalk) items.push({ kind: 'pill', text: '步行', bg: '#453512', tc: '#ffe08a', w: 24 });
        if (visited) {
          const vTxt = row.mastery.avgStar ? `✓${row.mastery.avgStar}` : '✓实勘';
          items.push({ kind: 'pill', text: vTxt, bg: '#174238', tc: '#92f5d1', w: Math.ceil(textWidth(vTxt, 9) + 6) });
        }

        // Right Debuffs: ↑贵¥X 非必要溢价 + 6 类避坑微图标
        const debuffs = [];
        if (isPrem) {
          const pTxt = `↑贵¥${Math.round(row.premium.extra)}`;
          debuffs.push({ kind: 'pill', text: pTxt, bg: '#5c2017', tc: '#ffd5c7', w: Math.ceil(textWidth(pTxt, 9) + 7) });
        }
        for (const rk of row.risks.slice(0, 2)) {
          const rt = eventTypeFor(rk);
          debuffs.push({ kind: 'risk', type: rt, w: 12 });
        }

        if (items.length || debuffs.length) {
          let cx = 4;
          const slotParts = [];
          const drawItem = it => {
            if (it.kind === 'pill') {
              slotParts.push(`<rect x="${cx}" y="1.5" width="${it.w}" height="12" rx="3" fill="${it.bg}"/><text class="no-stroke" x="${(cx + it.w / 2).toFixed(1)}" y="10.2" text-anchor="middle" fill="${it.tc}" font-size="9" font-weight="700">${esc(it.text)}</text>`);
            } else if (it.kind === 'glyph') {
              slotParts.push(`<g transform="translate(${cx} 2.5)" fill="none" stroke="${it.g.color}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="${it.g.path}"/></g>`);
            } else if (it.kind === 'risk') {
              const info = EVENT_TYPES[it.type];
              slotParts.push(`<g transform="translate(${cx + 5.5} 7.5) scale(0.54)" fill="none" stroke="${info.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:${info.color}">${info.icon}</g>`);
            }
            cx += it.w + 3;
          };
          items.forEach(drawItem);
          if (items.length && debuffs.length) {
            slotParts.push(`<line x1="${cx}" y1="2.5" x2="${cx}" y2="12.5" stroke="#456563" stroke-width=".9"/>`);
            cx += 4;
          }
          debuffs.forEach(drawItem);
          statusW = cx + 2;
          statusH = 15;
          statusSvg = slotParts.join('');
        }
      } else if (!expanded && row.eligible) {
        // 远景只挂极简决定性角标，绝不堆字
        const tag = isPrem ? { t: `↑贵¥${Math.round(row.premium.extra)}`, bg: '#5c2017', tc: '#ffd5c7' }
          : isOpp ? { t: '↘议价', bg: '#104438', tc: '#72f0c5' }
          : visited ? { t: '✓实勘', bg: '#174238', tc: '#92f5d1' } : null;
        if (tag && state.lens !== 'radar') {
          statusW = Math.ceil(textWidth(tag.t, 9) + 10);
          statusH = 14;
          statusSvg = `<rect x="2" y="1" width="${statusW - 4}" height="12" rx="3" fill="${tag.bg}"/><text class="no-stroke" x="${(statusW / 2).toFixed(1)}" y="9.8" text-anchor="middle" fill="${tag.tc}" font-size="9" font-weight="700">${esc(tag.t)}</text>`;
        }
      }

      const totalW = Math.max(headW, statusW);
      const totalH = headH + (statusH ? statusH + 1 : 0);
      const bx = px - totalW / 2, by = py - totalH / 2;

      if (!active && !reserve(bx, by, totalW, totalH)) return '';
      if (active) forceReserve(bx, by, totalW, totalH);

      const borderCol = active ? '#ffefaa' : isPrem ? '#f28f6e' : isOpp ? '#55e0b6' : visited ? '#7ef2c8' : 'rgba(136,184,174,0.42)';
      const headBg = active ? '#fff0ba' : row.eligible ? 'rgba(13, 30, 35, 0.90)' : 'rgba(22, 36, 40, 0.65)';
      const nameCol = active ? '#122924' : row.eligible ? '#f2f7f0' : '#7f9897';
      const rightCol = active ? '#185346' : (state.lens === 'radar' && isPrem ? '#ffb299' : state.lens === 'radar' && isOpp ? '#72f0c5' : '#a7e3cf');

      const statusBar = statusH
        ? `<g transform="translate(${((totalW - statusW) / 2).toFixed(1)} ${headH})"><rect x="0" y="0" width="${statusW}" height="${statusH}" rx="4" fill="rgba(10, 23, 27, 0.92)" stroke="rgba(116,162,154,0.34)" stroke-width=".75"/>${statusSvg}</g>`
        : '';

      return `<g class="civ-banner" data-plate="${esc(pl.id)}" role="button" tabindex="0" aria-label="${esc(pl.name + '板块 · ' + metricStr)}" transform="translate(${bx.toFixed(1)} ${by.toFixed(1)})">` +
        `<rect x="0" y="0" width="${totalW}" height="${headH}" rx="5" fill="${headBg}" stroke="${borderCol}" stroke-width="${active ? 1.5 : 0.9}"/>` +
        `<text class="no-stroke" x="7" y="13" fill="${nameCol}" font-size="11" font-weight="${active ? 750 : 650}">${esc(nameStr)}</text>` +
        (headRight ? `<text class="no-stroke" x="${(totalW - 6).toFixed(1)}" y="12.8" text-anchor="end" fill="${rightCol}" font-size="10" font-weight="700">${esc(headRight)}</text>` : '') +
        statusBar + `</g>`;
    }

    const MACRO_META = {
      community: { title: '普通小区均价(元/㎡)', cuts: [50, 70, 95], labels: ['<50', '50–70', '70–95', '≥95'], val: d => d.community?.price ?? null, fmt: v => `${v}元/㎡` },
      apartment: { title: '集中式公寓(元/㎡)', cuts: [55, 80, 110], labels: ['<55', '55–80', '80–110', '≥110'], val: d => d.apartment?.price ?? null, fmt: v => `${v}元/㎡` },
      village:   { title: '城中村参考(元/㎡)', cuts: [40, 55, 75], labels: ['<40', '40–55', '55–75', '≥75'], val: d => d.village?.range ? Math.round((d.village.range[0] + d.village.range[1]) / 2) : null, fmt: (v, d) => d.village?.range ? `${d.village.range[0]}–${d.village.range[1]}` : '—' },
      listing:   { title: '挂牌综合(元/㎡)', cuts: [50, 70, 95], labels: ['<50', '50–70', '70–95', '≥95'], val: d => d.listingPrice ?? null, fmt: v => `${v}元/㎡` },
      ref2022:   { title: '2022参考(元/㎡)', cuts: [50, 70, 95], labels: ['<50', '50–70', '70–95', '≥95'], val: d => d.refs2022?.[0] ?? null, fmt: v => `${v}元/㎡` },
      density:   { title: '人口密度(人/km²)', cuts: [3000, 7000, 15000], labels: ['<3k', '3k–7k', '7k–15k', '≥15k'], val: d => d.density ?? null, fmt: v => v.toLocaleString('zh-CN') },
    };

    function legendMarkup(state) {
      const stop = (color, text) => `<span class="legend-item"><i class="legend-swatch" style="background:${color}"></i>${esc(text)}</span>`;
      if (state.lens === 'rent' && state.rentSub === 'macro') {
        const m = MACRO_META[state.macroMetric] || MACRO_META.community;
        const blues = ['#2c4050', '#3d5d73', '#5786a6', '#79a8c7'];
        return m.labels.map((l, i) => stop(blues[i], l)).join('') + '<span class="legend-item"><i class="legend-swatch swatch-hatch"></i>缺口径</span>';
      }
      if (state.lens === 'commute') {
        return stop(COMMUTE_COLORS[0], '<25分') + stop(COMMUTE_COLORS[1], '25–39') + stop(COMMUTE_COLORS[2], '40–59') + stop(COMMUTE_COLORS[3], '≥60') +
          (state.layout === 'radial' ? '<span class="legend-item">· 每圈10分</span>' : '<span class="legend-item">· 虚线步行 / 实线轨交</span>');
      }
      if (state.lens === 'radar') {
        return stop(RADAR_COLORS.opportunity, '可议价') + stop(RADAR_COLORS.premium, '同程溢价(↑贵)') + stop(RADAR_COLORS.mixed, '分歧') +
          '<span class="legend-item"><i class="swatch-ring-gold"></i>目的地步行圈</span>' +
          '<span class="legend-item"><i class="swatch-ring-red"></i>他园溢价圈</span>' +
          '<span class="legend-item">⇢ 办公外迁</span>';
      }
      if (state.rentSub === 'yoy' || state.rentSub === 'mom') {
        const tags = state.rentSub === 'yoy' ? ['<-8%', '-8~-1', '-1~+1', '+1~+8', '≥+8%'] : ['<-3%', '-3~-0.5', '-0.5~+0.5', '+0.5~+3', '≥+3%'];
        return tags.map((t, i) => stop(TREND_COLORS[i], t)).join('') + '<span class="legend-item"><i class="legend-swatch swatch-hatch"></i>缺趋势</span>';
      }
      return stop(UNIT_COLORS[0], '<55元/㎡') + stop(UNIT_COLORS[1], '55–74') + stop(UNIT_COLORS[2], '75–99') + stop(UNIT_COLORS[3], '≥100') +
        stop('#1b4639', '山体') + stop('#163d51', '水库') +
        '<span class="legend-item">· 放大展开状态栏(M线/配套/避坑)</span>';
    }

    function renderMacro(state) {
      const view = camera.viewport(), { w, h, k, tx, ty, pt } = view;
      const m = MACRO_META[state.macroMetric] || MACRO_META.community;
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      const parts = [
        `<defs><pattern id="v3-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="scale(${1 / k})"><rect width="7" height="7" fill="#273e42"/><path d="M-1 1L1 -1M0 7L7 0M6 8L8 6" stroke="#476362" stroke-width=".9"/></pattern></defs>`,
        `<g class="v3-geo" data-zoom-tier="${tierForZoom(k)}" data-base-k="${k}" data-base-tx="${tx}" data-base-ty="${ty}" transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${k})">`,
      ];
      const blues = ['#2c4050', '#3d5d73', '#5786a6', '#79a8c7'];
      for (const d of atlas.districts) {
        const val = m.val(d);
        const fill = pickColor(val, m.cuts, blues) || 'url(#v3-hatch)';
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
      const cx = w / 2, cy = h / 2 - 14, maxR = Math.min(w, h) * 0.39;
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
          const text = row.plate.name + (isPrem ? ` ↑贵¥${Math.round(row.premium.extra)}` : ` ${row.plate.unitPrice}/㎡`);
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
      const focusedPlateId = state.selectedPlateId || '';
      const aura = state.selectedLandmarkId ? engine.landmarkAura(state.selectedLandmarkId) : null;

      const clipsMarkup = atlas.streetClips.map(c => `<clipPath id="${esc(c.id)}"><path d="${c.p}"/></clipPath>`).join('');
      const parts = [
        `<defs>` +
          `<pattern id="v3-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="scale(${1 / k})"><rect width="7" height="7" fill="#263d41"/><path d="M-1 1L1 -1M0 7L7 0M6 8L8 6" stroke="#456160" stroke-width=".9"/></pattern>` +
          `<marker id="v3-arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M1 1.5L8.5 5L1 8.5Z" fill="#ffd482"/></marker>` +
          clipsMarkup +
        `</defs>`,
        `<g class="v3-geo" data-zoom-tier="${tierForZoom(k)}" data-base-k="${k}" data-base-tx="${tx}" data-base-ty="${ty}" transform="translate(${fmt(tx)} ${fmt(ty)}) scale(${k})">`,
      ];

      // 1. 行政区底轮廓
      for (const d of atlas.districts) {
        parts.push(`<path d="${d.p}" fill="#172d31" stroke="#365154" vector-effect="non-scaling-stroke" pointer-events="none"/>`);
      }

      // 2. 全城 98 块无缝居住板块拼图（带《天际线》选中聚焦压暗 & 《文明 6》地标 30 分钟辐射高亮！）
      const byClip = new Map(), unclipped = [];
      for (const row of evalResult.plateRows) {
        if (row.plate.clipId) {
          if (!byClip.has(row.plate.clipId)) byClip.set(row.plate.clipId, []);
          byClip.get(row.plate.clipId).push(row);
        } else unclipped.push(row);
      }

      const drawPlatePath = row => {
        const pl = row.plate;
        const active = focusedPlateId === pl.id;
        const inAuraWalk = aura?.walk15.has(pl.id);
        const inAura30 = aura?.rail30.has(pl.id);
        const dimmed = (focusedPlateId && !active) || (aura && !inAura30 && !inAuraWalk);
        const fill = plateFill(row, state) || 'url(#v3-hatch)';
        const strokeCol = active ? '#ffefaa' : inAuraWalk ? '#ffda78' : inAura30 ? '#78e6ce' : '#12282d';
        const strokeW = active ? 2.6 : inAuraWalk ? 2.2 : inAura30 ? 1.7 : (pl.clipId ? 1.05 : 0.9);
        const metric = primaryMetric(row, state);
        const aria = `${pl.district}·${pl.name}板块${metric ? ' · ' + metric : ''}`;
        return `<path class="plate-shape" data-plate="${esc(pl.id)}" role="button" tabindex="0" aria-label="${esc(aria)}" d="${pl.p}" fill="${fill}" fill-opacity="${dimmed ? '0.46' : '1'}" fill-rule="evenodd" stroke="${strokeCol}" stroke-width="${strokeW}" vector-effect="non-scaling-stroke"/>`;
      };

      for (const row of unclipped) parts.push(drawPlatePath(row));
      for (const [clipId, rows] of byClip) {
        rows.sort((a, b) => Number(a.plate.id === focusedPlateId) - Number(b.plate.id === focusedPlateId));
        parts.push(`<g clip-path="url(#${esc(clipId)})">${rows.map(drawPlatePath).join('')}</g>`);
      }

      // 3. 自然地形雕琢（山体森林绿 + 水库湖蓝 + 宝安机场）
      for (const m of atlas.terrain.mountains) {
        parts.push(`<path class="terrain-mtn" d="${m.p}" fill="#1b4639" fill-opacity="0.88" stroke="#2d6b57" stroke-width="1" vector-effect="non-scaling-stroke" pointer-events="none"/>`);
      }
      for (const wt of atlas.terrain.water) {
        parts.push(`<path class="terrain-water" d="${wt.p}" fill="#153c50" fill-opacity="0.92" stroke="#2b6e8e" stroke-width="1" vector-effect="non-scaling-stroke" pointer-events="none"/>`);
      }
      if (atlas.terrain.airport) {
        parts.push(`<path d="${atlas.terrain.airport.p}" fill="#2b424c" fill-opacity="0.86" stroke="#6c93a6" stroke-dasharray="3 2" stroke-width="1" vector-effect="non-scaling-stroke" pointer-events="none"/>`);
      }

      // 4. 淡色 16 条地铁主干网
      const metroAlpha = k >= 2.4 ? 0.36 : 0.22;
      parts.push(`<g class="metro-skeleton" fill="none" stroke="rgba(226,246,238,${metroAlpha})" stroke-width="${k >= 2.4 ? 1.35 : 0.95}" stroke-linecap="round" stroke-linejoin="round" pointer-events="none">`);
      for (const line of atlas.metroLines) parts.push(`<path d="${line.p}" vector-effect="non-scaling-stroke"/>`);
      parts.push('</g>');

      // 5. 15 分钟步行辐射光圈（地标选中时显示单地标亮圈；议价与溢价镜头下显示 10 大园区光圈）
      if (aura) {
        const [lx, ly] = project(aura.landmark.coord);
        parts.push(`<circle class="landmark-aura-ring" cx="${fmt(lx)}" cy="${fmt(ly)}" r="${fmt(walkRadiusMapUnits)}" fill="rgba(120,230,206,0.16)" stroke="#78e6ce" stroke-width="2" stroke-dasharray="4 3" vector-effect="non-scaling-stroke" pointer-events="none"/>`);
      } else if (state.lens === 'radar' && evalResult.dest1 && engine.hubNodes?.length) {
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

      // 办公外迁走廊弧线
      if (state.lens === 'radar' && atlas.migrations?.length) {
        for (const mig of atlas.migrations) {
          const [x1, y1] = pt(mig.fromXy), [x2, y2] = pt(mig.toXy);
          const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 - 22;
          parts.push(`<path d="M${fmt(x1)},${fmt(y1)} Q${fmt(mx)},${fmt(my)} ${fmt(x2)},${fmt(y2)}" fill="none" stroke="#ffd482" stroke-width="2" stroke-dasharray="5 3" marker-end="url(#v3-arrow)" pointer-events="none"/>`);
          parts.push(`<text x="${fmt(mx)}" y="${fmt(my + 5)}" text-anchor="middle" fill="#ffe6a8" font-size="10.5" font-weight="650">${esc(mig.label)}</text>`);
        }
      }

      // 《城市：天际线》选中板块放射状影响连线（绿线连向周边商圈/学校/公园，红线连向避坑源，金线连向通勤目的地！）
      const activePlace = state.selectedPlaceId ? evalResult.placeRowById.get(state.selectedPlaceId) : null;
      const activePlate = focusedPlateId ? evalResult.plateRowById.get(focusedPlateId) : null;
      const skylinesLayer = [];
      if (activePlate) {
        const [ox, oy] = pt(activePlate.plate.xy);
        // A. 绿线 -> 周边已定位商场 & 2.2km OSM 设施
        const greenTargets = [];
        const seenNames = new Set();
        for (const m of activePlate.plate.malls || []) {
          seenNames.add(m.name);
          greenTargets.push({ kind: 'landmark', id: m.id, name: m.name, dist: fmtDist(m.meters), coord: m.coord, icon: '◈' });
        }
        for (const f of activePlate.nearbyFacs || []) {
          if (seenNames.has(f.name)) continue;
          seenNames.add(f.name);
          greenTargets.push({ kind: 'fac', id: f.id, name: f.name, dist: fmtDist(f.meters), coord: f.location.gcj02, icon: f.category === 'school' ? '🏫' : '◈' });
        }
        for (const gt of greenTargets.slice(0, 4)) {
          const [tx2, ty2] = pt(project(gt.coord));
          const mx = (ox + tx2) / 2, my = (oy + ty2) / 2 - 10;
          const attr = gt.kind === 'landmark' ? `data-landmark="${esc(gt.id)}"` : `data-fac="${esc(gt.id)}"`;
          const tagTxt = `${gt.name} ${gt.dist}`;
          const bw = Math.ceil(textWidth(tagTxt, 10) + 12);
          skylinesLayer.push(`<path class="influence-line-good" d="M${fmt(ox)},${fmt(oy)} Q${fmt(mx)},${fmt(my)} ${fmt(tx2)},${fmt(ty2)}" fill="none" stroke="#62e6ba" stroke-width="1.8" stroke-dasharray="3 3" opacity="0.9" pointer-events="none"/>`);
          skylinesLayer.push(`<g ${attr} role="button" tabindex="0" transform="translate(${fmt(tx2)} ${fmt(ty2)})">` +
            `<circle r="5" fill="#62e6ba" stroke="#0d2624" stroke-width="1.5"/>` +
            `<rect x="8" y="-9" width="${bw}" height="18" rx="4" fill="#0d312bf0" stroke="#62e6ba" stroke-width="1"/>` +
            `<text class="no-stroke" x="14" y="3.2" fill="#c7fce8" font-size="10" font-weight="650">${esc(tagTxt)}</text></g>`);
        }

        // B. 红线 -> 影响本板块的公开避坑源（精确到事件坐标 + 6 类图形！）
        for (const rk of activePlate.risks || []) {
          const [rx, ry] = pt(project(rk.coord));
          const rt = eventTypeFor(rk);
          const info = EVENT_TYPES[rt];
          const mx = (ox + rx) / 2, my = (oy + ry) / 2 + 10;
          const tagTxt = `${info.label} · ${rk.name.split(' · ')[0]}`;
          const bw = Math.ceil(textWidth(tagTxt, 10) + 12);
          skylinesLayer.push(`<path class="influence-line-risk" d="M${fmt(ox)},${fmt(oy)} Q${fmt(mx)},${fmt(my)} ${fmt(rx)},${fmt(ry)}" fill="none" stroke="#f28466" stroke-width="1.8" stroke-dasharray="3 3" opacity="0.92" pointer-events="none"/>`);
          skylinesLayer.push(`<g class="event-marker" data-risk="${esc(rk.id)}" role="button" tabindex="0" transform="translate(${fmt(rx)} ${fmt(ry)})">` +
            `<circle class="marker-hit" r="11" fill="#2c1917" stroke="${info.color}" stroke-width="1.5"/>${eventGlyph(rt)}` +
            `<rect x="13" y="-9" width="${bw}" height="18" rx="4" fill="#3b1b17f0" stroke="#f28466" stroke-width="1"/>` +
            `<text class="no-stroke" x="19" y="3.2" fill="#ffd6c8" font-size="10" font-weight="650">${esc(tagTxt)}</text></g>`);
        }
      }

      // C. 金线 -> 门到门通勤路线
      const activeRoute = activePlace?.route || activePlate?.route || null;
      const originCoord = activePlace?.place.coord || activePlate?.plate.coord || null;
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

      // 屏幕碰撞避让区
      const occupied = [
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

      // 1. 目的地金标优先占位
      const destLayer = [];
      for (const [labelText, destObj, col] of [['目的地', evalResult.dest1, '#ffda78'], ['第二目的地', evalResult.dest2, '#8ed8ff']]) {
        if (!destObj) continue;
        const [wx, wy] = pt(project(destObj.coord));
        if (wx < -12 || wx > w + 12 || wy < -12 || wy > h + 12) continue;
        forceReserve(wx - 9, wy - 9, 18, 18);
        const bw = Math.ceil(textWidth(destObj.name, 11.5) + 12), bh = 20;
        const offsets = [[11, -10], [-bw - 11, -10], [11, -24], [-bw - 11, 8], [-bw / 2, -28]];
        const [dx, dy] = offsets.find(([ox, oy]) => reserve(wx + ox, wy + oy, bw, bh)) || [11, -10];
        destLayer.push(`<g transform="translate(${fmt(wx)} ${fmt(wy)})" pointer-events="none">` +
          `<path d="M0 -8.5L8.5 0L0 8.5L-8.5 0Z" fill="${col}" stroke="#122726" stroke-width="1.6"/>` +
          `<rect x="${fmt(dx)}" y="${fmt(dy)}" width="${bw}" height="${bh}" rx="5" fill="#152b2ef2" stroke="${col}" stroke-width="1.2"/>` +
          `<text class="no-stroke" x="${fmt(dx + 6)}" y="${fmt(dy + 13.5)}" fill="${col}" font-size="11.5" font-weight="700">${esc(destObj.name)}</text>` +
          `<title>${esc(labelText + ' · ' + destObj.name)}</title></g>`);
      }

      // 2. 山体 / 水库标签
      const terrainLabels = [];
      for (const m of atlas.terrain.mountains) {
        if (k < m.minZoom) continue;
        const [mx, my] = pt(m.xy);
        const bw = textWidth(m.name, 10.5) + 4;
        if (reserve(mx - bw / 2, my - 7, bw, 14)) {
          terrainLabels.push(`<text x="${fmt(mx)}" y="${fmt(my + 3.5)}" text-anchor="middle" fill="#8bc9ab" font-size="10.5" font-weight="600" opacity="0.86">${esc(m.name)}</text>`);
        }
      }
      for (const wt of atlas.terrain.water) {
        if (k < wt.minZoom) continue;
        const [wx, wy] = pt(wt.xy);
        const bw = textWidth(wt.name, 10) + 4;
        if (reserve(wx - bw / 2, wy - 7, bw, 14)) {
          terrainLabels.push(`<text x="${fmt(wx)}" y="${fmt(wy + 3.5)}" text-anchor="middle" fill="#89cbe6" font-size="10" font-weight="550" opacity="0.86">${esc(wt.name)}</text>`);
        }
      }

      // 3. 固定知名地标锚点（点击即亮起 30 分钟辐射圈 + 一键设为目的地）
      const lmLayer = [];
      const maxTier = k >= 3.0 ? 3 : k >= 1.7 ? 2 : 1;
      for (const lm of atlas.landmarks) {
        if (lm.tier > maxTier) continue;
        if (lm.name === evalResult.dest1?.name || lm.name === evalResult.dest2?.name) continue;
        const [lx, ly] = pt(lm.xy);
        if (lx < 10 || lx > w - 10 || ly < 10 || ly > h - 10) continue;
        const active = state.selectedLandmarkId === lm.id;
        const iconChar = lm.kind === 'hub' ? '◆' : lm.kind === 'mall' ? '◈' : (lm.id === 'lm-airport' ? '✈' : '✦');
        const col = lm.kind === 'hub' ? '#f5cf7a' : lm.kind === 'mall' ? '#8be0f7' : '#d2c2ff';
        const labelTxt = `${iconChar} ${lm.label}`;
        const bw = Math.ceil(textWidth(labelTxt, 10) + 10), bh = 17;
        const offsets = [[0, 0], [0, -18], [0, 18], [bw / 2 + 8, 0], [-bw / 2 - 8, 0]];
        const off = active ? [0, 0] : offsets.find(([ox, oy]) => reserve(lx + ox - bw / 2, ly + oy - bh / 2, bw, bh));
        if (!off) continue;
        if (active) forceReserve(lx - bw / 2, ly - bh / 2, bw, bh);
        const [ox, oy] = off;
        const aria = `地标 · ${lm.name}（${lm.note}）`;
        lmLayer.push(`<g class="landmark-pin" data-landmark="${esc(lm.id)}" role="button" tabindex="0" aria-label="${esc(aria)}" transform="translate(${fmt(lx + ox)} ${fmt(ly + oy)})">` +
          `<rect x="${fmt(-bw / 2)}" y="${fmt(-bh / 2)}" width="${bw}" height="${bh}" rx="9" fill="${active ? '#fff0ba' : 'rgba(13,30,35,0.88)'}" stroke="${active ? '#e8c468' : col}" stroke-width="${active ? 1.4 : 0.85}"/>` +
          `<text class="no-stroke" x="0" y="3.3" text-anchor="middle" fill="${active ? '#142a25' : col}" font-size="10" font-weight="650">${esc(labelTxt)}</text></g>`);
      }

      // 4. 《文明 6》式城镇状态栏（City Banners — 配套与避坑统一收归板块名牌下方！）
      const bannerLayer = [];
      const visPlates = evalResult.plateRows.filter(r => inView(r.plate.bounds));
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
        const [px, py] = pt(row.plate.xy);
        if (px < 10 || px > w - 10 || py < 10 || py > h - 10) continue;
        const banner = buildCivBanner(row, px, py, state, k, reserve, forceReserve);
        if (banner) bannerLayer.push(banner);
      }

      // 5. 可选全图避坑/设施叠加层（默认关闭，保持拼图整洁；开启后全局一览）
      const riskLayer = [];
      if (state.showRisks) {
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
      if (state.showFacilities) {
        const catCol = { mall: '#78d9f5', school: '#c8b8ff', park: '#7be0a7', health: '#ff9ea8' };
        for (const fac of atlas.facilities) {
          if (!fac.location?.gcj02) continue;
          if (state.facFilter && fac.category !== state.facFilter) continue;
          const [fx, fy] = pt(project(fac.location.gcj02));
          if (fx < -10 || fx > w + 10 || fy < -10 || fy > h + 10) continue;
          const col = catCol[fac.category] || '#8ce0cf';
          facLayer.push(`<g data-fac="${esc(fac.id)}" role="button" tabindex="0" aria-label="${esc('设施 · ' + fac.name)}" transform="translate(${fmt(fx)} ${fmt(fy)})"><circle r="8" fill="transparent"/><rect x="-4.5" y="-4.5" width="9" height="9" rx="2" fill="${col}" stroke="#10252a" stroke-width="1.3"/></g>`);
        }
      }

      parts.push(...terrainLabels, ...bannerLayer, ...lmLayer, ...facLayer, ...riskLayer, ...skylinesLayer, ...destLayer, '</g>');
      svg.innerHTML = parts.join('');
    }

    function render(payload) {
      lastPayload = payload;
      const { state, evalResult } = payload;
      if (state.lens === 'rent' && state.rentSub === 'macro') {
        renderMacro(state);
      } else if (state.lens === 'commute' && state.layout === 'radial' && evalResult.dest1) {
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
