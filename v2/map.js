/* V2 60fps 双层地图引擎：无碰撞标注、6类避坑图标、随缩放展开3图标地块标注、非必要溢价图层、办公迁移箭头与10分钟时间圈 */
(function (global) {
  'use strict';

  const RENT_COLORS = ['#2e856e', '#6ea98d', '#c9b174', '#b86f50'];
  const RENT_CUTS = [2000, 3500, 5500];
  const TREND_COLORS = ['#739ec2', '#517693', '#344d60', '#8a6244', '#b86f46'];
  const YOY_CUTS = [-8, -1, 1, 8];
  const MOM_CUTS = [-3, -0.5, 0.5, 3];
  const COMMUTE_COLORS = ['#2e856e', '#6ea98d', '#c9b174', '#b86f50'];
  const COMMUTE_CUTS = [25, 40, 60];
  const ARB_COLORS = { opportunity: '#2d9d7f', watch: '#4e7e73', mixed: '#b8914f', tight: '#a75c43', neutral: '#30494c' };
  const FAC_COLORS = ['#395658', '#487d76', '#5e9e89', '#88ba9f'];

  // 与 Codex location-premium 视觉口径一致的「非必要溢价」5色阶
  const PREMIUM_BANDS = [
    { key: 'direct', label: '步行可用', color: '#398471' },
    { key: 'no-extra', label: '未见多付', color: '#68959b' },
    { key: 'unknown', label: '需核价/权衡', color: '#bbab79' },
    { key: 'premium', label: '有同程溢价', color: '#bd7758' },
    { key: 'no-hub', label: '园区圈外', color: '#486774' },
  ];
  const PREMIUM_COLOR = {
    direct: '#398471', used: '#398471', 'no-extra': '#68959b',
    unknown: '#bbab79', tradeoff: '#bbab79', premium: '#bd7758', 'no-hub': '#486774',
  };

  // V1/Codex 6 类可辨认公共避坑事件图标（不再使用笼统的橙色三角！）
  const EVENT_TYPES = {
    works:  { label: '施工绕行', color: '#efb677', icon: '<path d="M-8 -4H8V2H-8ZM-5 2V7M5 2V7M-6 0l3-4M0 0l3-4M6 0l2-3"/>' },
    air:    { label: '工业气味', color: '#b7c98c', icon: '<path d="M-8 6V-1l5 2v-4l6 3v-5h3l1 11ZM3-8q-2-2 1-3m1 3q3-1 3-3"/>' },
    rail:   { label: '轨道噪声', color: '#b5aceb', icon: '<rect x="-8" y="-7" width="9" height="12" rx="2"/><path d="M-7-3H0M-6 7l2-2m4 2-2-2M4-3q4 3 0 6m3-9q7 6 0 12"/>' },
    flight: { label: '航空噪声', color: '#94cfeb', icon: '<path d="M0-9c1 0 1.5 1.2 1.5 3.2V-2L8 3v2L1.5 2.2v3.5L4 8v1L0 7.5-4 9V8l2.5-2.3V2.2L-8 5V3l6.5-5v-3.8C-1.5-7.8-1-9 0-9Z" fill="currentColor" stroke="none"/>' },
    crowd:  { label: '枢纽客流', color: '#e7cf86', icon: '<circle cx="-2" cy="-4.5" r="2.6"/><path d="M-8 6V4a6 6 0 0 1 12 0v2ZM4-6a2.5 2.5 0 0 1 0 5m2 2q3 .5 3 5"/>' },
    noise:  { label: '生活噪声', color: '#e5959f', icon: '<path d="M-8-3h4l5-4V7l-5-4h-4ZM4-3q3 3 0 6m3-9q6 6 0 12"/>' },
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
  global.V2EventIcons = { EVENT_TYPES, eventTypeFor, eventIconSvg };

  // 地块内嵌 3 图标路径（事件 / 政策 / 走势方向）
  const INSIGHT_ICONS = {
    event:  'M1.5 3.5h9v7h-9z M3.5 1.5v3m5-3v3m-5 2h5',
    policy: 'M3 1h4.5L10 3.5V11H3z M7.5 1v3h2 M5 6h3m-3 2h3',
    up:     'M1.5 9l3.5-4 2 2 3.5-5M7 2h3.5v3.5',
    down:   'M1.5 3l3.5 4 2-2 3.5 5M7 10h3.5V6.5',
    mixed:  'M1 8l3-4 3 4 4-5M8 3h3v3',
    watch:  'M1 6s2-3.5 5-3.5S11 6 11 6s-2 3.5-5 3.5S1 6 1 6z M6 5v2',
  };

  // 精确中英数字宽度估算（彻底消除过宽黑框与右侧大块空白）
  function textWidth(str, fontSize) {
    let total = 0;
    for (const ch of String(str || '')) {
      const code = ch.charCodeAt(0);
      total += (code < 128 || ch === '¥' || ch === '–' || ch === '·') ? fontSize * 0.60 : fontSize * 1.02;
    }
    return total;
  }

  function formatCompactK(n) {
    return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  }

  // 诚实口径价格标注：实采显示精确单价（¥4,117），参考带显示真实区间（1.4–2.5k），不再把区间中位数伪装成楼栋单一报价！
  function formatMapPrice(rent) {
    if (!rent) return '';
    if (rent.grain === 'band' && rent.low !== rent.high) {
      return `${formatCompactK(rent.low)}–${formatCompactK(rent.high)}`;
    }
    return '¥' + Math.round(rent.median).toLocaleString('zh-CN');
  }

  function tierForZoom(k) {
    return (k >= 0.8) + (k >= 2.0) + (k >= 4.0) + (k >= 6.5);
  }

  function createMap(svg, atlas, engine, timing, esc) {
    const world = global.atlasExtent(atlas.streets.map(s => s.bounds));
    let lastPayload = null;

    // Exact Mercator matching base.json
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

    function fastTransform(view) {
      if (typeof svg.querySelector !== 'function') return false;
      const geo = svg.querySelector('.v2-geo');
      if (!geo || !geo.dataset?.baseK) return false;
      if (Number(geo.dataset.zoomTier) !== tierForZoom(view.k)) return false;
      const baseK = Number(geo.dataset.baseK), btx = Number(geo.dataset.baseTx), bty = Number(geo.dataset.baseTy);
      geo.setAttribute('transform', `translate(${view.tx.toFixed(2)} ${view.ty.toFixed(2)}) scale(${view.k})`);
      const ov = svg.querySelector('.v2-overlay');
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
      () => !!lastPayload && !(lastPayload.state.view === 'commute' && lastPayload.state.layout === 'radial' && lastPayload.evalResult.work && !lastPayload.state.macroMode),
      fastTransform
    );

    const pickColor = (val, cuts, colors) => Number.isFinite(val) ? colors[cuts.filter(c => val >= c).length] : null;
    const money = n => '¥' + Math.round(n).toLocaleString('zh-CN');

    function streetFill(sum, state) {
      if (sum.outside && state.view !== 'livability') return '#263a3d';
      if (state.view === 'commute') return pickColor(sum.bestMinutes, COMMUTE_CUTS, COMMUTE_COLORS);
      if (state.view === 'livability') {
        if (!sum.facilityCount) return null;
        return sum.facilityCount >= 7 ? FAC_COLORS[3] : sum.facilityCount >= 4 ? FAC_COLORS[2] : sum.facilityCount >= 2 ? FAC_COLORS[1] : FAC_COLORS[0];
      }
      if (state.subMode === 'arbitrage') {
        if (sum.oppCount > 0) return ARB_COLORS.opportunity;
        if (sum.members.some(m => m.arbitrage.status === 'mixed')) return ARB_COLORS.mixed;
        if (sum.members.some(m => m.arbitrage.status === 'tight')) return ARB_COLORS.tight;
        return sum.members.length ? ARB_COLORS.neutral : null;
      }
      if (state.subMode === 'premium') {
        const st = sum.bestPremiumRow?.premium?.status;
        return PREMIUM_COLOR[st] || null;
      }
      if (state.subMode === 'yoy') return pickColor(sum.yoy, YOY_CUTS, TREND_COLORS);
      if (state.subMode === 'mom') return pickColor(sum.mom, MOM_CUTS, TREND_COLORS);
      if (sum.bestRent != null) return pickColor(sum.bestRent, RENT_CUTS, RENT_COLORS);
      if (!state.verifiedOnly && sum.refUnit) return pickColor(sum.refUnit * 35, RENT_CUTS, RENT_COLORS);
      return null;
    }

    function placeFill(row, state) {
      if (!row.eligible && (state.budget > 0 || state.work || state.oppOnly || state.housingTypes.length < 4)) return '#263a3d';
      if (state.view === 'commute') return pickColor(row.route?.minutes, COMMUTE_CUTS, COMMUTE_COLORS);
      if (state.subMode === 'arbitrage') return ARB_COLORS[row.arbitrage.status] || ARB_COLORS.neutral;
      if (state.subMode === 'premium') return PREMIUM_COLOR[row.premium?.status] || null;
      if (state.subMode === 'yoy') return pickColor(row.trend?.yoy, YOY_CUTS, TREND_COLORS);
      if (state.subMode === 'mom') return pickColor(row.trend?.mom, MOM_CUTS, TREND_COLORS);
      return pickColor(row.rent?.median, RENT_CUTS, RENT_COLORS);
    }

    function placeMetricLabel(row, state) {
      if (state.view === 'commute') return row.route ? `${row.route.minutes}分` : '—';
      if (state.subMode === 'arbitrage') return row.arbitrage.status === 'opportunity' ? '可议价' : row.arbitrage.status === 'tight' ? '偏紧' : formatMapPrice(row.rent);
      if (state.subMode === 'premium') {
        const p = row.premium;
        if (!p) return '—';
        if (p.status === 'premium') return `+¥${Math.round(p.extra)}`;
        return ({ direct: '可步行', used: '常去', 'no-extra': '未多付', tradeoff: '有权衡', unknown: '待核', 'no-hub': '圈外' })[p.status] || '—';
      }
      if (state.subMode === 'yoy') return row.trend?.yoy != null ? `${row.trend.yoy > 0 ? '+' : ''}${row.trend.yoy}%` : '—';
      if (state.subMode === 'mom') return row.trend?.mom != null ? `${row.trend.mom > 0 ? '+' : ''}${row.trend.mom}%` : '—';
      return formatMapPrice(row.rent);
    }

    function streetMetricLabel(sum, state) {
      if (state.view === 'commute') return sum.bestMinutes != null ? `${sum.bestMinutes}分` : '';
      if (state.view === 'livability') return sum.facilityCount ? `${sum.facilityCount}处` : '';
      if (state.subMode === 'arbitrage') return sum.oppCount ? `${sum.oppCount}处议价` : '';
      if (state.subMode === 'premium') return sum.bestPremiumRow ? placeMetricLabel(sum.bestPremiumRow, state) : '';
      if (state.subMode === 'yoy') return sum.yoy != null ? `${sum.yoy > 0 ? '+' : ''}${sum.yoy}%` : '';
      if (state.subMode === 'mom') return sum.mom != null ? `${sum.mom > 0 ? '+' : ''}${sum.mom}%` : '';
      if (sum.bestRentRow) return formatMapPrice(sum.bestRentRow.rent);
      if (!state.verifiedOnly && sum.refUnit) return `${sum.refUnit}元/㎡`;
      return '';
    }

    const MACRO_META = {
      community: { title: '普通小区均价(元/㎡·月)', cuts: [50, 70, 95], labels: ['<50', '50–70', '70–95', '≥95'], val: d => d.community?.price ?? null, fmt: v => `${v}元/㎡` },
      apartment: { title: '集中式公寓均价(元/㎡·月)', cuts: [55, 80, 110], labels: ['<55', '55–80', '80–110', '≥110'], val: d => d.apartment?.price ?? null, fmt: v => `${v}元/㎡` },
      village:   { title: '城中村单间参考(元/㎡·月)', cuts: [40, 55, 75], labels: ['<40', '40–55', '55–75', '≥75'], val: d => d.village?.range ? Math.round((d.village.range[0] + d.village.range[1]) / 2) : null, fmt: (v, d) => d.village?.range ? `${d.village.range[0]}–${d.village.range[1]}` : '—' },
      listing:   { title: '住宅挂牌综合(元/㎡·月)', cuts: [50, 70, 95], labels: ['<50', '50–70', '70–95', '≥95'], val: d => d.listingPrice ?? null, fmt: v => `${v}元/㎡` },
      ref2022:   { title: '2022官方参考小区(元/㎡·月)', cuts: [50, 70, 95], labels: ['<50', '50–70', '70–95', '≥95'], val: d => d.refs2022?.[0] ?? null, fmt: v => `${v}元/㎡` },
      density:   { title: '人口密度(人/km²)', cuts: [3000, 7000, 15000], labels: ['<3k', '3k–7k', '7k–15k', '≥15k'], val: d => d.density ?? null, fmt: v => v.toLocaleString('zh-CN') },
    };

    function legendMarkup(state) {
      const stop = (color, text) => `<span class="legend-item"><i class="legend-swatch" style="background:${color}"></i>${esc(text)}</span>`;
      const specialTail = '<span class="legend-item"><i class="legend-swatch swatch-hatch"></i>缺资料</span>' +
        '<span class="legend-item"><i class="legend-swatch swatch-outside"></i>筛选外</span>' +
        '<span class="legend-item"><i class="legend-swatch swatch-dots"></i>参考带/待核</span>';

      if (state.macroMode) {
        const m = MACRO_META[state.macroMode] || MACRO_META.community;
        const blues = ['#2c4050', '#3d5d73', '#5786a6', '#79a8c7'];
        return `<strong>${esc(m.title)}</strong>` + m.labels.map((l, i) => stop(blues[i], l)).join('') + '<span class="legend-item"><i class="legend-swatch swatch-hatch"></i>缺同口径</span>';
      }
      if (state.view === 'commute') {
        return '<strong>单程通勤(分钟)</strong>' +
          stop(COMMUTE_COLORS[0], '<25') + stop(COMMUTE_COLORS[1], '25–39') + stop(COMMUTE_COLORS[2], '40–59') + stop(COMMUTE_COLORS[3], '≥60') +
          (state.layout === 'radial' ? '<span>· 每圈 10 分钟</span>' : ' · <span class="legend-item">虚线=步行接驳</span> <span class="legend-item">实线=轨交乘车</span>');
      }
      if (state.view === 'livability') {
        const riskBtns = Object.entries(EVENT_TYPES).map(([k, info]) =>
          `<button type="button" class="legend-btn" data-risk-filter="${k}" aria-pressed="${state.riskFilter === k}">${eventIconSvg(k)}${esc(info.label)}</button>`
        ).join('');
        return '<strong>核验设施(处)</strong>' +
          stop(FAC_COLORS[0], '1') + stop(FAC_COLORS[1], '2–3') + stop(FAC_COLORS[2], '4–6') + stop(FAC_COLORS[3], '≥7') +
          '<span class="legend-item"><i class="legend-swatch swatch-hatch"></i>待收录</span>' +
          `<span class="legend-item" style="margin-left:4px">避坑筛选：</span>${riskBtns}`;
      }
      if (state.subMode === 'arbitrage') {
        return '<strong>议价雷达</strong>' +
          stop(ARB_COLORS.opportunity, '议价机会') + stop(ARB_COLORS.watch, '值得留意') + stop(ARB_COLORS.mixed, '供需分歧') + stop(ARB_COLORS.tight, '需求偏紧') +
          '<span class="legend-item">⇢ 办公迁移方向</span>' + specialTail;
      }
      if (state.subMode === 'premium') {
        return '<strong>非必要溢价(15分步行圈)</strong>' +
          PREMIUM_BANDS.map(b => stop(b.color, b.label)).join('') +
          '<span class="legend-item"><i class="legend-swatch swatch-hatch"></i>先选工作地/待补</span>';
      }
      if (state.subMode === 'yoy' || state.subMode === 'mom') {
        const label = state.subMode === 'yoy' ? '片区同户型同比(%)' : '片区同户型环比(%)';
        const tags = state.subMode === 'yoy' ? ['<-8', '-8~-1', '-1~+1', '+1~+8', '≥+8'] : ['<-3', '-3~-0.5', '-0.5~+0.5', '+0.5~+3', '≥+3'];
        return `<strong>${label}</strong>` + tags.map((t, i) => stop(TREND_COLORS[i], t)).join('') + '<span class="legend-item"><i class="legend-swatch swatch-hatch"></i>缺数据</span>';
      }
      return '<strong>分形态月租(元/月)</strong>' +
        stop(RENT_COLORS[0], '<2k') + stop(RENT_COLORS[1], '2k–3.5k') + stop(RENT_COLORS[2], '3.5k–5.5k') + stop(RENT_COLORS[3], '≥5.5k') +
        specialTail;
    }

    // 地块内嵌 3 图标富标注渲染器（放大小区/街道时直接显示 事件数 + 走势图标 + 本地政策数，点击可直达对应依据！）
    function buildAreaInsightBadge(item, sx, sy, insight, reserve) {
      const evCount = insight?.events?.length || 0;
      const polCount = insight?.localPolicyCount ?? insight?.policies?.length ?? 0;
      const hasStrip = evCount > 0 || polCount > 0;
      const outlook = insight?.outlook || { direction: 'watch', label: '待察' };
      const dir = INSIGHT_ICONS[outlook.direction] ? outlook.direction : 'watch';
      const valStr = item.value || '';

      let stripSvg = '', stripW = 0;
      if (hasStrip) {
        const bits = [
          ['events', 'event', String(evCount), `关联事件 ${evCount} 项`, ''],
          ['outlook', dir, '', `租金走势：${outlook.label}`, `dir-${dir}`],
          ['policies', 'policy', String(polCount), `本地政策 ${polCount} 项`, ''],
        ];
        let x = 0;
        const gs = bits.map(([part, key, caption, hint, extraCls]) => {
          const wPart = 12 + (caption ? 2 + textWidth(caption, 10) : 0);
          const g = `<g data-insight-part="${part}" data-area-kind="${item.kind}" data-area-id="${esc(item.id)}" transform="translate(${x.toFixed(1)} 0)"><title>${esc(hint)}</title><rect class="insight-part-hit" x="-2" y="-2" width="${(wPart + 4).toFixed(1)}" height="16" rx="3" fill="transparent"/><path class="insight-icon ${extraCls}" d="${INSIGHT_ICONS[key]}"/><text class="insight-stat no-stroke" x="13.5" y="9.5">${esc(caption)}</text></g>`;
          x += wPart + 5;
          return g;
        });
        stripW = x - 5;
        stripSvg = `<g class="insight-strip" transform="translate(${(-stripW / 2).toFixed(1)} ${valStr ? 14 : 4})"><rect class="insight-back" x="-4" y="-1.5" width="${(stripW + 8).toFixed(1)}" height="15" rx="4"/>${gs.join('')}</g>`;
      }

      const nameW = textWidth(item.name, 12);
      const valW = valStr ? textWidth(valStr, 10.5) : 0;
      const bw = Math.ceil(Math.max(nameW, valW, stripW + 8) + 8);
      const bh = (valStr ? 26 : 15) + (hasStrip ? 18 : 0);

      if (!reserve(sx - bw / 2, sy - 11, bw, bh)) return '';
      const spoken = `${item.name}${valStr ? ' ' + valStr : ''} · 事件 ${evCount} · 走势 ${outlook.label} · 政策 ${polCount}`;
      return `<g class="area-insight" data-area-insight="${item.kind}" data-area-id="${esc(item.id)}" role="button" tabindex="0" aria-label="${esc(spoken)}" transform="translate(${sx.toFixed(1)} ${sy.toFixed(1)})">` +
        `<title>${esc(spoken)}</title>` +
        `<rect class="insight-hit" x="${(-bw / 2).toFixed(1)}" y="-11" width="${bw}" height="${bh}" rx="4" fill="transparent"/>` +
        `<text class="insight-name" text-anchor="middle" y="0">${esc(item.name)}</text>` +
        (valStr ? `<text class="insight-value" text-anchor="middle" y="12">${esc(valStr)}</text>` : '') +
        stripSvg + `</g>`;
    }

    function renderMacro(state) {
      const view = camera.viewport(), { w, h, k, tx, ty, pt } = view;
      const m = MACRO_META[state.macroMode] || MACRO_META.community;
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      const parts = [
        `<defs><pattern id="v2-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="scale(${1 / k})"><rect width="7" height="7" fill="#2c4548"/><path d="M-1 1L1 -1M0 7L7 0M6 8L8 6" stroke="#4f6c6a" stroke-width=".9"/></pattern></defs>`,
        `<g class="v2-geo" data-zoom-tier="${tierForZoom(k)}" data-base-k="${k}" data-base-tx="${tx}" data-base-ty="${ty}" transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${k})">`,
      ];
      const blues = ['#2c4050', '#3d5d73', '#5786a6', '#79a8c7'];
      for (const d of atlas.districts) {
        const val = m.val(d);
        const fill = pickColor(val, m.cuts, blues) || 'url(#v2-hatch)';
        const active = state.selectedDistrict === d.n;
        const labelVal = val != null ? m.fmt(val, d) : '缺同口径';
        parts.push(`<path class="street-shape" data-district="${esc(d.n)}" role="button" tabindex="0" aria-label="${esc(d.n + ' · ' + labelVal)}" d="${d.p}" fill="${fill}" stroke="${active ? '#fff0b0' : '#16353a'}" stroke-width="${active ? 2.6 : 1.2}" vector-effect="non-scaling-stroke"><title>${esc(d.n + ' · ' + labelVal)}</title></path>`);
      }
      parts.push('</g><g class="v2-overlay">');
      for (const d of atlas.districts) {
        const [x, y] = pt(d.a);
        if (x < 10 || x > w - 10 || y < 10 || y > h - 10) continue;
        const val = m.val(d);
        const txt = val != null ? m.fmt(val, d) : '—';
        parts.push(`<text x="${x.toFixed(1)}" y="${(y - 2).toFixed(1)}" text-anchor="middle" fill="#f5f4e6" font-size="12" font-weight="600">${esc(d.n.replace(/新区$|区$/, ''))}</text>`);
        parts.push(`<text x="${x.toFixed(1)}" y="${(y + 12).toFixed(1)}" text-anchor="middle" fill="#d9e8dd" font-size="10.5">${esc(txt)}</text>`);
      }
      parts.push('</g>');
      svg.innerHTML = parts.join('');
    }

    function renderRadial(state, evalResult, store) {
      const work = evalResult.work;
      const target = engine.nodes.get(work);
      const rect = svg.getBoundingClientRect();
      const w = rect.width || 760, h = rect.height || 460;
      const cx = w / 2, cy = h / 2, maxR = Math.min(w, h) * 0.42;
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      const parts = [`<rect width="100%" height="100%" fill="#10252a"/>`];
      const limit = state.limit;

      for (let m = 10; m <= limit; m += 10) {
        const r = (m / limit) * maxR;
        parts.push(`<circle cx="${cx}" cy="${cy}" r="${r.toFixed(1)}" fill="none" stroke="#3c5e5a" stroke-dasharray="3 4"/>`);
        parts.push(`<text x="${(cx - 4).toFixed(1)}" y="${(cy - r - 3).toFixed(1)}" text-anchor="end" fill="#9bc0b3" font-size="11">${m}分</text>`);
      }
      for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
        parts.push(`<line x1="${cx}" y1="${cy}" x2="${(cx + Math.cos(a) * maxR).toFixed(1)}" y2="${(cy + Math.sin(a) * maxR).toFixed(1)}" stroke="#2e4d4a" stroke-width=".8"/>`);
      }

      const toXY = (coord, min) => {
        const dx = (coord[0] - target.coord[0]) * Math.cos(target.coord[1] * RAD);
        const dy = target.coord[1] - coord[1];
        const ang = Math.atan2(dy, dx);
        const r = Math.min(1, min / limit) * maxR;
        return [cx + Math.cos(ang) * r, cy + Math.sin(ang) * r];
      };

      const occupied = [[cx - 16, cy - 16, cx + textWidth(work, 13) + 20, cy + 16]];
      const canLabel = (x, y, bw, bh) => {
        if (x < 6 || x + bw > w - 6 || y < 6 || y + bh > h - 6) return false;
        if (occupied.some(b => x < b[2] + 3 && x + bw > b[0] - 3 && y < b[3] + 2 && y + bh > b[1] - 2)) return false;
        occupied.push([x, y, x + bw, y + bh]);
        return true;
      };

      const reachable = evalResult.rows.filter(r => r.route && r.route.minutes <= limit);
      reachable.sort((a, b) => Number(a.place.id === state.selectedPlaceId) - Number(b.place.id === state.selectedPlaceId));

      for (const row of reachable) {
        const [px, py] = toXY(row.place.coord, row.route.minutes);
        const active = row.place.id === state.selectedPlaceId;
        const saved = store.isSaved(row.place.id);
        const isRef = state.referencePlaceId === row.place.id;
        const isOpp = row.arbitrage.status === 'opportunity';
        const fill = !row.eligible ? '#4b6364' : (isOpp ? '#46e0b3' : pickColor(row.rent?.median, RENT_CUTS, RENT_COLORS) || '#87a8a2');
        const aria = `${row.place.name} · ${row.route.minutes}分钟 · ${row.rent ? formatMapPrice(row.rent) : '租金待补'} · ${row.arbitrage.label}`;
        parts.push(`<g data-place="${esc(row.place.id)}" role="button" tabindex="0" aria-label="${esc(aria)}" transform="translate(${px.toFixed(1)} ${py.toFixed(1)})"><title>${esc(aria)}</title>${active || saved || isRef ? `<circle r="${active ? 9 : 7}" fill="none" stroke="${active || isRef ? '#ffe89c' : '#9ee8ca'}" stroke-width="1.6"/>` : ''}<circle r="${active ? 5 : isOpp ? 4.5 : 3.5}" fill="${fill}" stroke="#10252a" stroke-width="1"/></g>`);
        if (active || saved || isRef || (row.eligible && (isOpp || reachable.length < 30))) {
          const text = row.place.shortName;
          const bw = textWidth(text, 11) + 6;
          if (canLabel(px + 7, py - 9, bw, 15)) {
            parts.push(`<text x="${(px + 7).toFixed(1)}" y="${(py + 3).toFixed(1)}" fill="${active ? '#ffea9f' : isOpp ? '#9ef5d8' : '#d2e5dc'}" font-size="11">${esc(text)}</text>`);
          }
        }
      }

      parts.push(`<g transform="translate(${cx} ${cy})"><circle r="11" fill="#1d3c3b" stroke="#f6cb78" stroke-width="1.6"/><path d="M0 -5L5 0L0 5L-5 0Z" fill="#ffd479"/></g>`);
      parts.push(`<text x="${cx + 14}" y="${cy + 4}" fill="#ffe4a1" font-size="13" font-weight="700">${esc(work)}</text>`);
      svg.innerHTML = parts.join('');
    }

    function renderGeo(state, evalResult, store) {
      const view = camera.viewport(), { w, h, k, tx, ty, pt } = view;
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      const showZones = k >= 2.2;
      const showFootprints = k >= 6.5;
      const fmt = n => Number(n).toFixed(2);
      const inView = ([x0, y0, x1, y1]) => x1 * k + tx > 0 && x0 * k + tx < w && y1 * k + ty > 0 && y0 * k + ty < h;

      const parts = [
        `<defs>` +
          `<pattern id="v2-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="scale(${1 / k})"><rect width="7" height="7" fill="#2c4548"/><path d="M-1 1L1 -1M0 7L7 0M6 8L8 6" stroke="#4f6c6a" stroke-width=".9"/></pattern>` +
          `<pattern id="v2-dots" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="scale(${1 / k})"><circle cx="3" cy="3" r="1.1" fill="#133338" opacity=".68"/></pattern>` +
          `<marker id="v2-arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M1 1.5L8.5 5L1 8.5Z" fill="#ffd482"/></marker>` +
        `</defs>`,
        `<g class="v2-geo" data-zoom-tier="${tierForZoom(k)}" data-base-k="${k}" data-base-tx="${tx}" data-base-ty="${ty}" transform="translate(${fmt(tx)} ${fmt(ty)}) scale(${k})">`,
      ];

      // District base silhouette
      for (const d of atlas.districts) {
        parts.push(`<path d="${d.p}" fill="#1f383b" stroke="#425d5d" vector-effect="non-scaling-stroke" pointer-events="none"/>`);
      }

      // 74 Streets
      for (const s of atlas.streets) {
        const sum = evalResult.streetSummary.get(s.id);
        const fill = streetFill(sum, state) || 'url(#v2-hatch)';
        const active = state.selectedStreetId === s.id;
        const statText = streetMetricLabel(sum, state) || (sum.outside ? '超出当前筛选' : '待补');
        const aria = `${s.d}·${s.n} · ${statText}`;
        parts.push(`<path class="street-shape" data-street="${esc(s.id)}" role="button" tabindex="0" aria-label="${esc(aria)}" d="${s.p}" fill="${fill}" fill-rule="evenodd" stroke="${active ? '#fff0b2' : '#1b3336'}" stroke-width="${active ? 2.4 : 0.9}" vector-effect="non-scaling-stroke"><title>${esc(aria)}</title></path>`);
        if (state.view === 'explore' && state.subMode === 'rent' && sum.bandOnly && !sum.outside) {
          parts.push(`<path d="${s.p}" fill="url(#v2-dots)" pointer-events="none"/>`);
        }
      }

      // Xixiang 3 zones + 17 residential footprints
      const visibleZones = [];
      const visibleFootprints = [];
      if (showZones && atlas.zones?.length) {
        const westStreet = atlas.streets.find(s => s.id === atlas.zones[0].street);
        if (westStreet && inView(westStreet.bounds)) {
          parts.push(`<defs><clipPath id="v2-west-clip"><path d="${westStreet.p}"/></clipPath></defs><g clip-path="url(#v2-west-clip)">`);
          for (const z of atlas.zones) {
            if (!inView(z.bounds)) continue;
            visibleZones.push(z);
            parts.push(`<path class="zone-shape" data-zone="${esc(z.id)}" role="button" tabindex="0" aria-label="${esc(z.n + '站参考区')}" d="${z.p}" fill="rgba(22,52,55,.16)" stroke="#a8c7b8" stroke-dasharray="4 3" stroke-width="1.2" vector-effect="non-scaling-stroke"><title>${esc(z.n + '站参考区')}</title></path>`);
          }
          if (showFootprints) {
            for (const row of evalResult.rows) {
              const fp = row.place.footprint;
              if (!fp || !inView(fp.bounds)) continue;
              visibleFootprints.push(row);
              const active = state.selectedPlaceId === row.place.id;
              const fill = placeFill(row, state) || 'url(#v2-hatch)';
              const isVillage = fp.kind === '城中村';
              const priceLabel = formatMapPrice(row.rent) || '待补';
              const aria = `${fp.name}（${fp.kind}）· ${priceLabel}${row.route ? ' · ' + row.route.minutes + '分' : ''} · ${row.arbitrage.label}`;
              parts.push(`<path class="footprint-shape" data-place="${esc(row.place.id)}" role="button" tabindex="0" aria-label="${esc(aria)}" d="${fp.p}" fill="${fill}" fill-rule="evenodd" stroke="${active ? '#fff2b0' : isVillage ? '#ebd093' : '#94d5e6'}" stroke-width="${active ? 2.5 : 1.3}" stroke-dasharray="${!active && isVillage ? '3 2' : 'none'}" vector-effect="non-scaling-stroke"><title>${esc(aria)}</title></path>`);
              if (row.rent?.grain === 'band' && row.eligible) {
                parts.push(`<path d="${fp.p}" fill="url(#v2-dots)" pointer-events="none"/>`);
              }
            }
          }
          parts.push('</g>');
        }
      }
      parts.push('</g><g class="v2-overlay">');

      // Migration arrows in 议价雷达 mode (科兴→企鹅岛, 后海→桂湾)
      if (state.view === 'explore' && state.subMode === 'arbitrage' && atlas.migrations?.length) {
        for (const mig of atlas.migrations) {
          const [x1, y1] = pt(mig.fromXy), [x2, y2] = pt(mig.toXy);
          const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 - 22;
          parts.push(`<path d="M${fmt(x1)},${fmt(y1)} Q${fmt(mx)},${fmt(my)} ${fmt(x2)},${fmt(y2)}" fill="none" stroke="#ffd482" stroke-width="2" stroke-dasharray="5 3" marker-end="url(#v2-arrow)" pointer-events="none"/>`);
          parts.push(`<text x="${fmt(mx)}" y="${fmt(my + 5)}" text-anchor="middle" fill="#ffe6a8" font-size="10.5" font-weight="600">${esc(mig.label)}</text>`);
        }
      }

      // Route polyline for selected place: separate WALK legs (dashed mint) vs RAIL legs (solid gold) so access to nearest station never looks like a drawing glitch!
      const selRow = evalResult.rowById.get(state.selectedPlaceId);
      if (selRow && selRow.route && evalResult.work) {
        const startXY = project(selRow.place.coord);
        const destXY = stationXY(evalResult.work);
        if (state.mode === 'rail' && selRow.route.legs?.length) {
          const railPts = [];
          for (const leg of selRow.route.legs) {
            const stList = timing.lines[leg.line]?.stations;
            if (stList) {
              const a = stList.indexOf(leg.from), b = stList.indexOf(leg.to);
              if (a >= 0 && b >= 0) {
                const seg = stList.slice(Math.min(a, b), Math.max(a, b) + 1);
                if (a > b) seg.reverse();
                for (const nm of seg) {
                  const p = stationXY(nm);
                  if (p && (!railPts.length || Math.hypot(p[0] - railPts.at(-1)[0], p[1] - railPts.at(-1)[1]) > 0.05)) {
                    railPts.push(p);
                  }
                }
              }
            }
          }
          if (railPts.length > 0) {
            // Walk leg: place -> boarding station (dashed mint)
            const [s1, s2] = [pt(startXY), pt(railPts[0])];
            if (Math.hypot(s1[0] - s2[0], s1[1] - s2[1]) > 3) {
              parts.push(`<line x1="${fmt(s1[0])}" y1="${fmt(s1[1])}" x2="${fmt(s2[0])}" y2="${fmt(s2[1])}" stroke="#143235" stroke-width="4" pointer-events="none"/><line x1="${fmt(s1[0])}" y1="${fmt(s1[1])}" x2="${fmt(s2[0])}" y2="${fmt(s2[1])}" stroke="#8ee4c4" stroke-width="2" stroke-dasharray="4 4" pointer-events="none"/>`);
            }
            // Rail ride polyline (solid warm gold)
            if (railPts.length > 1) {
              const rStr = railPts.map(p => pt(p).map(fmt).join(',')).join(' ');
              parts.push(`<polyline points="${rStr}" fill="none" stroke="#183836" stroke-width="5.2" stroke-linejoin="round" pointer-events="none"/><polyline points="${rStr}" fill="none" stroke="#ffe194" stroke-width="2.5" stroke-linejoin="round" pointer-events="none"/>`);
              const [bx, by] = pt(railPts[0]);
              parts.push(`<circle cx="${fmt(bx)}" cy="${fmt(by)}" r="3.5" fill="#8ee4c4" stroke="#162e2d" stroke-width="1.2" pointer-events="none"/>`);
            }
            // Walk leg: alighting station -> destination workplace (dashed mint)
            if (destXY) {
              const [e1, e2] = [pt(railPts.at(-1)), pt(destXY)];
              if (Math.hypot(e1[0] - e2[0], e1[1] - e2[1]) > 3) {
                parts.push(`<line x1="${fmt(e1[0])}" y1="${fmt(e1[1])}" x2="${fmt(e2[0])}" y2="${fmt(e2[1])}" stroke="#143235" stroke-width="4" pointer-events="none"/><line x1="${fmt(e1[0])}" y1="${fmt(e1[1])}" x2="${fmt(e2[0])}" y2="${fmt(e2[1])}" stroke="#8ee4c4" stroke-width="2" stroke-dasharray="4 4" pointer-events="none"/>`);
              }
            }
          }
        } else if (destXY) {
          const str = [startXY, destXY].map(p => pt(p).map(fmt).join(',')).join(' ');
          parts.push(`<polyline points="${str}" fill="none" stroke="#193b37" stroke-width="4.5" pointer-events="none"/><polyline points="${str}" fill="none" stroke="#ffe194" stroke-width="2.2" stroke-dasharray="6 4" pointer-events="none"/>`);
        }
      }

      // Collision engine: strict priority order (Zoom Box > Workplace Pins > Event Icons > Selected/Saved Chips > Zoomed-in Area Insight Badges > Casual Labels)
      const occupied = [[w - 46, 4, w, 112]];
      const reserve = (x, y, bw, bh) => {
        if (x < 4 || y < 4 || x + bw > w - 4 || y + bh > h - 4) return false;
        if (occupied.some(b => x < b[2] + 3 && x + bw > b[0] - 3 && y < b[3] + 2 && y + bh > b[1] - 2)) return false;
        occupied.push([x, y, x + bw, y + bh]);
        return true;
      };
      const forceReserve = (x, y, bw, bh) => { occupied.push([x, y, x + bw, y + bh]); };

      // 1. Workplace pins FIRST (reserves space so NO place chip ever collides with 大疆天空之城!)
      const workLayer = [];
      for (const [labelText, wName, col] of [['工作地', evalResult.work, '#ffda78'], ['第二工作地', evalResult.work2, '#91d8ff']]) {
        if (!wName) continue;
        const xy = stationXY(wName);
        if (!xy) continue;
        const [wx, wy] = pt(xy);
        if (wx < -10 || wx > w + 10 || wy < -10 || wy > h + 10) continue;
        forceReserve(wx - 9, wy - 9, 18, 18);
        const bw = Math.ceil(textWidth(wName, 11.5) + 12), bh = 20;
        const offsets = [[11, -10], [-bw - 11, -10], [11, -24], [-bw - 11, 8], [-bw / 2, -28]];
        const loc = offsets.find(([dx, dy]) => reserve(wx + dx, wy + dy, bw, bh)) || [11, -10];
        const [dx, dy] = loc;
        workLayer.push(`<g transform="translate(${fmt(wx)} ${fmt(wy)})" pointer-events="none">` +
          `<path d="M0 -8L8 0L0 8L-8 0Z" fill="${col}" stroke="#162d2a" stroke-width="1.6"/>` +
          `<rect x="${fmt(dx)}" y="${fmt(dy)}" width="${bw}" height="${bh}" rx="4" fill="#172c2eee" stroke="${col}" stroke-width="1.1"/>` +
          `<text class="no-stroke" x="${fmt(dx + 6)}" y="${fmt(dy + 13.5)}" fill="${col}" font-size="11.5" font-weight="700">${esc(wName)}</text>` +
          `<title>${esc(labelText + ' · ' + wName)}</title></g>`);
      }

      // 2. Public environment risk markers (6 distinct SVG pictograms, reserved BEFORE street labels!)
      const riskLayer = [];
      if (state.view === 'livability' || k >= 2.2) {
        for (const risk of atlas.publicEvents) {
          const rType = eventTypeFor(risk);
          if (state.riskFilter && state.riskFilter !== rType) continue;
          const [rx, ry] = pt(project(risk.coord));
          if (rx < -12 || rx > w + 12 || ry < -12 || ry > h + 12) continue;
          const active = state.selectedRiskId === risk.id;
          const info = EVENT_TYPES[rType];
          const offsets = [[0, 0], [18, -16], [-18, -16], [18, 16], [-18, 16]];
          const [dx, dy] = offsets.find(([ox, oy]) => reserve(rx + ox - 12, ry + oy - 12, 24, 24)) || [0, 0];
          const lead = dx || dy ? `<path d="M${-dx} ${-dy}L0 0" stroke="${info.color}" stroke-width="1" pointer-events="none"/>` : '';
          const aria = `${info.label} · ${risk.name}`;
          riskLayer.push(`<g class="event-marker" data-risk="${esc(risk.id)}" role="button" tabindex="0" aria-label="${esc(aria)}" transform="translate(${fmt(rx + dx)} ${fmt(ry + dy)})">` +
            `<title>${esc(aria)}</title>${lead}` +
            `<circle class="marker-hit" r="11.5" fill="#173039" stroke="${active ? '#fff2ba' : info.color}" stroke-width="${active ? 2.4 : 1.15}"/>` +
            `${eventGlyph(rType)}</g>`);
        }
      }

      // 3. Place markers & crisp collision-free chips (with .no-stroke + accurate width + multi-offset placement!)
      const markerRows = evalResult.rows.filter(r => {
        if (showFootprints && r.place.footprint) return false;
        if (r.place.id === state.selectedPlaceId || store.isSaved(r.place.id) || state.referencePlaceId === r.place.id) return true;
        if (state.subMode === 'arbitrage' && (r.arbitrage.status === 'opportunity' || r.arbitrage.status === 'mixed')) return true;
        if (state.subMode === 'premium' && ['premium', 'direct', 'used'].includes(r.premium.status)) return true;
        if (k >= 1.8 && r.eligible) return true;
        if (k >= 1.1 && r.arbitrage.status === 'opportunity' && r.eligible) return true;
        return false;
      });

      // Highest priority reserves labels first!
      const priorityRank = r =>
        (r.place.id === state.selectedPlaceId ? 1000 : 0) +
        (state.referencePlaceId === r.place.id ? 500 : 0) +
        (store.isSaved(r.place.id) ? 300 : 0) +
        (r.arbitrage.status === 'opportunity' ? 100 : 0) +
        (r.premium?.status === 'premium' ? 80 : 0) +
        r.arbitrage.score * 10;
      markerRows.sort((a, b) => priorityRank(b) - priorityRank(a));

      let labelCount = 0;
      const labelCap = k >= 4 ? (w < 500 ? 7 : 14) : (w < 500 ? 4 : 9);
      const placeLayer = [];

      for (const row of markerRows) {
        const [sx, sy] = pt(row.place.xy);
        if (sx < -10 || sx > w + 10 || sy < -10 || sy > h + 10) continue;
        const active = row.place.id === state.selectedPlaceId;
        const saved = store.isSaved(row.place.id);
        const isRef = state.referencePlaceId === row.place.id;
        const isOpp = row.arbitrage.status === 'opportunity';
        const isPrem = state.subMode === 'premium' && row.premium?.status === 'premium';
        const dotColor = active ? '#fff1b3' : isPrem ? '#f09d75' : isOpp ? '#4be0b6' : saved ? '#9de7ca' : '#d5e6db';
        const metric = placeMetricLabel(row, state);
        const aria = `${row.place.name}${metric ? ' · ' + metric : ''}${row.route ? ' · ' + row.route.minutes + '分' : ''} · ${row.arbitrage.label}`;
        let chip = '';
        if ((active || saved || isRef || isOpp || isPrem || k >= 2.4) && labelCount < labelCap) {
          const showMetric = metric && (active || k >= 2.0 || state.subMode === 'premium');
          const text = row.place.shortName + (showMetric ? ' ' + metric : '');
          const bw = Math.ceil(textWidth(text, 11) + 12), bh = 19;
          const offsets = [[9, -9.5], [-bw - 9, -9.5], [9, -23], [-bw - 9, 5], [9, 6], [-bw / 2, -25]];
          const loc = offsets.find(([dx, dy]) => reserve(sx + dx, sy + dy, bw, bh));
          if (loc) {
            labelCount++;
            const [dx, dy] = loc;
            const needLead = Math.abs(dy + bh / 2) > 4;
            const lx = dx < 0 ? dx + bw : dx, ly = dy + bh / 2;
            chip = (needLead ? `<path d="M0 0L${fmt(lx)},${fmt(ly)}" stroke="#a4c1b8" stroke-width=".9" pointer-events="none"/>` : '') +
              `<rect x="${fmt(dx)}" y="${fmt(dy)}" width="${bw}" height="${bh}" rx="4" fill="${active ? '#ffefb8' : '#153438f0'}" stroke="${active ? '#e6c875' : isPrem ? '#e8956b' : isOpp ? '#4be0b6' : '#658682'}" stroke-width=".95"/>` +
              `<text class="no-stroke" x="${fmt(dx + 6)}" y="${fmt(dy + 13)}" fill="${active ? '#162f2a' : '#eef5e9'}" font-size="11" font-weight="${active ? 700 : 500}">${esc(text)}</text>`;
          }
        }
        placeLayer.push({
          active,
          svg: `<g data-place="${esc(row.place.id)}" role="button" tabindex="0" aria-label="${esc(aria)}" transform="translate(${fmt(sx)} ${fmt(sy)})"><title>${esc(aria)}</title><circle r="9" fill="transparent"/>${isRef ? '<circle r="9.5" fill="none" stroke="#ffdf85" stroke-dasharray="2 2" stroke-width="1.3"/>' : ''}${saved ? '<circle r="7.2" fill="none" stroke="#9de7ca" stroke-width="1.3"/>' : ''}<circle r="${active ? 5.5 : isOpp || isPrem ? 4.8 : 3.5}" fill="${dotColor}" stroke="#12292d" stroke-width="1.4"/>${chip}</g>`,
        });
      }
      // Paint active place on top so its chip is never hidden behind neighbors
      placeLayer.sort((a, b) => Number(a.active) - Number(b.active));

      // 4. Zoomed-in Area Insight Badges (Name + Honest Metric + clickable 3-icon strip: 事件/走势/政策) & Street/District labels
      const labelLayer = [];
      if (k < 0.85) {
        for (const d of atlas.districts) {
          const [dx, dy] = pt(d.a);
          const nm = d.n.replace(/新区$|区$/, '');
          const bw = textWidth(nm, 12) + 4;
          if (reserve(dx - bw / 2, dy - 8, bw, 16)) {
            labelLayer.push(`<text x="${fmt(dx)}" y="${fmt(dy + 4)}" text-anchor="middle" fill="#e6efe4" font-size="12" font-weight="600">${esc(nm)}</text>`);
          }
        }
      } else if (showFootprints) {
        // 17 西乡住宅轮廓：诚实区间（1.4–2.5k / 3.3–4.6k）+ 可点击 3 图标条（事件/走势/政策）！
        const sortedFp = visibleFootprints.slice().sort((a, b) =>
          Number(b.place.id === state.selectedPlaceId) - Number(a.place.id === state.selectedPlaceId) ||
          (b.events.length + b.policies.length) - (a.events.length + a.policies.length)
        );
        for (const row of sortedFp) {
          const [fx, fy] = pt(row.place.xy);
          const insight = evalResult.getAreaInsight('place', row.place.id);
          const badge = buildAreaInsightBadge(
            { kind: 'place', id: row.place.id, name: row.place.footprint.name, value: placeMetricLabel(row, state) },
            fx, fy, insight, reserve
          );
          if (badge) labelLayer.push(badge);
        }
      } else if (k >= 2.0) {
        // 放大街道 / 西乡站区：优先展示有事件或政策的地块内嵌 3 图标富标注
        let richCount = 0;
        const richCap = w < 500 ? 5 : 10;
        const namedStreets = new Set();

        for (const z of visibleZones) {
          const [zx, zy] = pt(z.xy);
          const insight = evalResult.getAreaInsight('zone', z.id);
          const badge = buildAreaInsightBadge({ kind: 'zone', id: z.id, name: z.n + '站区', value: '' }, zx, zy, insight, reserve);
          if (badge) { labelLayer.push(badge); richCount++; }
        }

        const visStreets = atlas.streets.filter(s => inView(s.bounds)).map(s => ({
          s, sum: evalResult.streetSummary.get(s.id),
        })).sort((a, b) =>
          Number(b.s.id === state.selectedStreetId) - Number(a.s.id === state.selectedStreetId) ||
          (b.sum.events.length + b.sum.policies.length) - (a.sum.events.length + a.sum.policies.length)
        );

        for (const { s, sum } of visStreets) {
          if (visibleZones.length && s.id === visibleZones[0].street) continue;
          const [sx, sy] = pt(s.xy);
          const insight = evalResult.getAreaInsight('street', s.id);
          const hasEvidence = (insight?.events?.length || 0) + (insight?.localPolicyCount || 0) > 0;
          if (hasEvidence && richCount < richCap) {
            const badge = buildAreaInsightBadge(
              { kind: 'street', id: s.id, name: s.short, value: streetMetricLabel(sum, state) },
              sx, sy, insight, reserve
            );
            if (badge) { labelLayer.push(badge); namedStreets.add(s.id); richCount++; continue; }
          }
          if (!namedStreets.has(s.id)) {
            const bw = textWidth(s.short, 11) + 6;
            if (reserve(sx - bw / 2, sy - 8, bw, 16)) {
              labelLayer.push(`<text x="${fmt(sx)}" y="${fmt(sy + 4)}" text-anchor="middle" fill="#e2ede6" font-size="11">${esc(s.short)}</text>`);
            }
          }
        }
      } else {
        for (const s of atlas.streets) {
          if (!inView(s.bounds)) continue;
          const [sx, sy] = pt(s.xy);
          const bw = textWidth(s.short, 11) + 6;
          if (!reserve(sx - bw / 2, sy - 8, bw, 16)) continue;
          labelLayer.push(`<text x="${fmt(sx)}" y="${fmt(sy + 4)}" text-anchor="middle" fill="#e2ede6" font-size="11">${esc(s.short)}</text>`);
        }
      }

      // Layer order: labels < places < risks < workplaces (workplace pin always crisp on top!)
      parts.push(...labelLayer, ...placeLayer.map(x => x.svg), ...riskLayer, ...workLayer, '</g>');
      svg.innerHTML = parts.join('');
    }

    function render(payload) {
      lastPayload = payload;
      const { state, evalResult, store } = payload;
      if (state.macroMode) {
        renderMacro(state);
      } else if (state.view === 'commute' && state.layout === 'radial' && evalResult.work) {
        renderRadial(state, evalResult, store);
      } else {
        renderGeo(state, evalResult, store);
      }
      return legendMarkup(state);
    }

    return { render, camera, project, world };
  }

  global.createV2Map = createMap;
})(typeof window !== 'undefined' ? window : globalThis);
