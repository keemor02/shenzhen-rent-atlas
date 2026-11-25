/* V2.5 静默降噪探索地图：3大镜头 + 10园区15分钟光圈 + ↑贵¥800红标 + 独立设施/避坑叠加 + 零冗余非零3图标 */
(function (global) {
  'use strict';

  const RENT_COLORS = ['#2e856e', '#6ea98d', '#c9b174', '#b86f50'];
  const RENT_CUTS = [2000, 3500, 5500];
  const TREND_COLORS = ['#739ec2', '#517693', '#344d60', '#8a6244', '#b86f46'];
  const YOY_CUTS = [-8, -1, 1, 8];
  const MOM_CUTS = [-3, -0.5, 0.5, 3];
  const COMMUTE_COLORS = ['#2e856e', '#6ea98d', '#c9b174', '#b86f50'];
  const COMMUTE_CUTS = [25, 40, 60];
  const RADAR_COLORS = {
    opportunity: '#2a987b',
    premium: '#b85c42',
    tight: '#a35640',
    mixed: '#a68d4e',
    watch: '#3c6e67',
    neutral: '#243c40',
  };

  // 6 类可辨认公共避坑事件 SVG 图标
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

  const INSIGHT_ICONS = {
    event:  'M1.5 3.5h9v7h-9z M3.5 1.5v3m5-3v3m-5 2h5',
    policy: 'M3 1h4.5L10 3.5V11H3z M7.5 1v3h2 M5 6h3m-3 2h3',
    up:     'M1.5 9l3.5-4 2 2 3.5-5M7 2h3.5v3.5',
    down:   'M1.5 3l3.5 4 2-2 3.5 5M7 10h3.5V6.5',
    mixed:  'M1 8l3-4 3 4 4-5M8 3h3v3',
  };

  function textWidth(str, fontSize) {
    let total = 0;
    for (const ch of String(str || '')) {
      const code = ch.charCodeAt(0);
      total += (code < 128 || ch === '¥' || ch === '–' || ch === '·' || ch === '↑' || ch === '↘') ? fontSize * 0.62 : fontSize * 1.02;
    }
    return total;
  }

  function formatCompactK(n) {
    return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  }

  // 诚实口径：实采精确单价，参考带显示区间（1.4k–2.5k），永不造假
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
    // 15 分钟步行半径（约 900 米直线）在 SVG 地图坐标系下的精确像素半径
    const walkRadiusMapUnits = Math.abs((900 / 102700) * lonScale);

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
      () => !!lastPayload && !(lastPayload.state.lens === 'commute' && lastPayload.state.layout === 'radial' && lastPayload.evalResult.work),
      fastTransform
    );

    const pickColor = (val, cuts, colors) => Number.isFinite(val) ? colors[cuts.filter(c => val >= c).length] : null;

    function streetFill(sum, state) {
      if (sum.outside) return '#203336';
      if (state.lens === 'commute') return pickColor(sum.bestMinutes, COMMUTE_CUTS, COMMUTE_COLORS);
      if (state.lens === 'radar') {
        if (sum.bestPremiumRow?.premium?.status === 'premium') return RADAR_COLORS.premium;
        if (sum.oppCount > 0) return RADAR_COLORS.opportunity;
        if (sum.members.some(m => m.arbitrage.status === 'mixed')) return RADAR_COLORS.mixed;
        if (sum.members.some(m => m.arbitrage.status === 'tight')) return RADAR_COLORS.tight;
        if (sum.members.some(m => m.arbitrage.status === 'watch')) return RADAR_COLORS.watch;
        return sum.members.length ? RADAR_COLORS.neutral : null;
      }
      if (state.rentSub === 'yoy') return pickColor(sum.yoy, YOY_CUTS, TREND_COLORS);
      if (state.rentSub === 'mom') return pickColor(sum.mom, MOM_CUTS, TREND_COLORS);
      if (sum.bestRent != null) return pickColor(sum.bestRent, RENT_CUTS, RENT_COLORS);
      if (!state.verifiedOnly && sum.refUnit) return pickColor(sum.refUnit * 35, RENT_CUTS, RENT_COLORS);
      return null;
    }

    function placeFill(row, state) {
      if (!row.eligible && (state.budget > 0 || state.work || state.oppOnly || state.housingTypes.length < 4)) return '#203336';
      if (state.lens === 'commute') return pickColor(row.route?.minutes, COMMUTE_CUTS, COMMUTE_COLORS);
      if (state.lens === 'radar') {
        if (row.premium?.status === 'premium') return RADAR_COLORS.premium;
        return RADAR_COLORS[row.arbitrage.status] || RADAR_COLORS.neutral;
      }
      if (state.rentSub === 'yoy') return pickColor(row.trend?.yoy, YOY_CUTS, TREND_COLORS);
      if (state.rentSub === 'mom') return pickColor(row.trend?.mom, MOM_CUTS, TREND_COLORS);
      return pickColor(row.rent?.median, RENT_CUTS, RENT_COLORS);
    }

    // 静默降噪原则：返回 { text, tone }；普通/圈外状态 text 为空字符串，绝不刷屏写「圈外」「常规供需」！
    function placeSignalTag(row, state) {
      if (state.lens === 'commute') {
        return row.route ? { text: `${row.route.minutes}分`, tone: 'neutral' } : { text: '', tone: 'neutral' };
      }
      if (state.lens === 'radar') {
        if (row.premium?.status === 'premium') {
          // 明确写「↑贵¥800」，暖红底色，彻底避免被误读成“房租只要 800”！
          return { text: `↑贵¥${Math.round(row.premium.extra)}`, tone: 'prem' };
        }
        if (row.arbitrage.status === 'opportunity') {
          return { text: '↘可议价', tone: 'opp' };
        }
        if (row.premium?.status === 'direct') {
          return { text: '可步行', tone: 'walk' };
        }
        return { text: '', tone: 'neutral' }; // 圈外或普通供需：保持静默！
      }
      if (state.rentSub === 'yoy') {
        return row.trend?.yoy != null ? { text: `${row.trend.yoy > 0 ? '+' : ''}${row.trend.yoy}%`, tone: 'neutral' } : { text: '', tone: 'neutral' };
      }
      if (state.rentSub === 'mom') {
        return row.trend?.mom != null ? { text: `${row.trend.mom > 0 ? '+' : ''}${row.trend.mom}%`, tone: 'neutral' } : { text: '', tone: 'neutral' };
      }
      return { text: formatMapPrice(row.rent), tone: 'neutral' };
    }

    function streetMetricLabel(sum, state) {
      if (state.lens === 'commute') return sum.bestMinutes != null ? `${sum.bestMinutes}分` : '';
      if (state.lens === 'radar') {
        if (sum.bestPremiumRow?.premium?.status === 'premium') return `↑贵¥${Math.round(sum.bestPremiumRow.premium.extra)}`;
        if (sum.oppCount > 0) return `${sum.oppCount}处议价`;
        return '';
      }
      if (state.rentSub === 'yoy') return sum.yoy != null ? `${sum.yoy > 0 ? '+' : ''}${sum.yoy}%` : '';
      if (state.rentSub === 'mom') return sum.mom != null ? `${sum.mom > 0 ? '+' : ''}${sum.mom}%` : '';
      if (sum.bestRentRow) return formatMapPrice(sum.bestRentRow.rent);
      if (!state.verifiedOnly && sum.refUnit) return `${sum.refUnit}元/㎡`;
      return '';
    }

    const MACRO_META = {
      community: { title: '普通小区均价(元/㎡)', cuts: [50, 70, 95], labels: ['<50', '50–70', '70–95', '≥95'], val: d => d.community?.price ?? null, fmt: v => `${v}元/㎡` },
      apartment: { title: '集中式公寓(元/㎡)', cuts: [55, 80, 110], labels: ['<55', '55–80', '80–110', '≥110'], val: d => d.apartment?.price ?? null, fmt: v => `${v}元/㎡` },
      village:   { title: '城中村参考(元/㎡)', cuts: [40, 55, 75], labels: ['<40', '40–55', '55–75', '≥75'], val: d => d.village?.range ? Math.round((d.village.range[0] + d.village.range[1]) / 2) : null, fmt: (v, d) => d.village?.range ? `${d.village.range[0]}–${d.village.range[1]}` : '—' },
      listing:   { title: '挂牌综合(元/㎡)', cuts: [50, 70, 95], labels: ['<50', '50–70', '70–95', '≥95'], val: d => d.listingPrice ?? null, fmt: v => `${v}元/㎡` },
      ref2022:   { title: '2022官方参考(元/㎡)', cuts: [50, 70, 95], labels: ['<50', '50–70', '70–95', '≥95'], val: d => d.refs2022?.[0] ?? null, fmt: v => `${v}元/㎡` },
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
          (state.layout === 'radial' ? '<span class="legend-item">· 每圈10分</span>' : '<span class="legend-item">· 虚线步行 / 实线乘车</span>');
      }
      if (state.lens === 'radar') {
        return stop(RADAR_COLORS.opportunity, '可议价') + stop(RADAR_COLORS.premium, '同程溢价(↑贵)') + stop(RADAR_COLORS.mixed, '分歧') +
          '<span class="legend-item"><i class="swatch-ring-gold"></i>你工作地步行圈</span>' +
          '<span class="legend-item"><i class="swatch-ring-red"></i>他园溢价圈</span>' +
          '<span class="legend-item">⇢ 办公外迁</span>';
      }
      if (state.rentSub === 'yoy' || state.rentSub === 'mom') {
        const tags = state.rentSub === 'yoy' ? ['<-8%', '-8~-1', '-1~+1', '+1~+8', '≥+8%'] : ['<-3%', '-3~-0.5', '-0.5~+0.5', '+0.5~+3', '≥+3%'];
        return tags.map((t, i) => stop(TREND_COLORS[i], t)).join('') + '<span class="legend-item"><i class="legend-swatch swatch-hatch"></i>缺数据</span>';
      }
      return stop(RENT_COLORS[0], '<2k') + stop(RENT_COLORS[1], '2–3.5k') + stop(RENT_COLORS[2], '3.5–5.5k') + stop(RENT_COLORS[3], '≥5.5k') +
        '<span class="legend-item"><i class="legend-swatch swatch-dots"></i>参考带</span>' +
        '<span class="legend-item"><i class="legend-swatch swatch-hatch"></i>待补</span>' +
        '<span class="legend-item"><i class="legend-swatch swatch-outside"></i>筛外</span>';
    }

    // 地块内嵌极简富标注：严守「零值不画」原则，彻底消灭 📅0 👁 噪点！
    function buildAreaInsightBadge(item, sx, sy, insight, reserve) {
      const evCount = insight?.events?.length || 0;
      const polCount = insight?.localPolicyCount ?? insight?.policies?.length ?? 0;
      const outlook = insight?.outlook || { direction: 'watch', label: '' };
      const hasDir = ['down', 'up', 'mixed'].includes(outlook.direction);
      const valStr = item.value || '';

      const bits = [];
      if (evCount > 0) bits.push(['events', 'event', String(evCount), `关联事件 ${evCount} 项`, '']);
      if (hasDir) bits.push(['outlook', outlook.direction, '', `走势：${outlook.label}`, `dir-${outlook.direction}`]);
      if (polCount > 0) bits.push(['policies', 'policy', String(polCount), `本地政策 ${polCount} 项`, '']);

      let stripSvg = '', stripW = 0;
      if (bits.length) {
        let x = 0;
        const gs = bits.map(([part, key, caption, hint, extraCls]) => {
          const wPart = 12 + (caption ? 2 + textWidth(caption, 10) : 0);
          const g = `<g data-insight-part="${part}" data-area-kind="${item.kind}" data-area-id="${esc(item.id)}" transform="translate(${x.toFixed(1)} 0)"><title>${esc(hint)}</title><rect class="insight-part-hit" x="-2" y="-2" width="${(wPart + 4).toFixed(1)}" height="16" rx="3" fill="transparent"/><path class="insight-icon ${extraCls}" d="${INSIGHT_ICONS[key]}"/>${caption ? `<text class="insight-stat no-stroke" x="13.5" y="9.5">${esc(caption)}</text>` : ''}</g>`;
          x += wPart + 5;
          return g;
        });
        stripW = x - 5;
        stripSvg = `<g class="insight-strip" transform="translate(${(-stripW / 2).toFixed(1)} ${valStr ? 14 : 4})"><rect class="insight-back" x="-4" y="-1.5" width="${(stripW + 8).toFixed(1)}" height="15" rx="4"/>${gs.join('')}</g>`;
      }

      const nameW = textWidth(item.name, 12);
      const valW = valStr ? textWidth(valStr, 10.5) : 0;
      const bw = Math.ceil(Math.max(nameW, valW, stripW + 8) + 8);
      const bh = (valStr ? 26 : 15) + (bits.length ? 18 : 0);

      if (!reserve(sx - bw / 2, sy - 11, bw, bh)) return '';
      const valFill = item.tone === 'prem' ? '#ff9d7e' : item.tone === 'opp' ? '#6ee7be' : '#c6f0df';
      const spoken = [item.name, valStr, evCount ? `事件 ${evCount}` : '', polCount ? `政策 ${polCount}` : ''].filter(Boolean).join(' · ');
      return `<g class="area-insight" data-area-insight="${item.kind}" data-area-id="${esc(item.id)}" role="button" tabindex="0" aria-label="${esc(spoken)}" transform="translate(${sx.toFixed(1)} ${sy.toFixed(1)})">` +
        `<title>${esc(spoken)}</title>` +
        `<rect class="insight-hit" x="${(-bw / 2).toFixed(1)}" y="-11" width="${bw}" height="${bh}" rx="4" fill="transparent"/>` +
        `<text class="insight-name" text-anchor="middle" y="0">${esc(item.name)}</text>` +
        (valStr ? `<text class="insight-value" text-anchor="middle" y="12" fill="${valFill}">${esc(valStr)}</text>` : '') +
        stripSvg + `</g>`;
    }

    function renderMacro(state) {
      const view = camera.viewport(), { w, h, k, tx, ty, pt } = view;
      const m = MACRO_META[state.macroMetric] || MACRO_META.community;
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
      const w = rect.width || 960, h = rect.height || 620;
      const cx = w / 2, cy = h / 2 - 14, maxR = Math.min(w, h) * 0.39;
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      const parts = [`<rect width="100%" height="100%" fill="#102429"/>`];
      const limit = state.limit;

      for (let m = 10; m <= limit; m += 10) {
        const r = (m / limit) * maxR;
        parts.push(`<circle cx="${cx}" cy="${cy}" r="${r.toFixed(1)}" fill="none" stroke="#345653" stroke-dasharray="3 4"/>`);
        parts.push(`<text x="${(cx - 5).toFixed(1)}" y="${(cy - r - 3).toFixed(1)}" text-anchor="end" fill="#8fb7aa" font-size="11">${m}分</text>`);
      }
      for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
        parts.push(`<line x1="${cx}" y1="${cy}" x2="${(cx + Math.cos(a) * maxR).toFixed(1)}" y2="${(cy + Math.sin(a) * maxR).toFixed(1)}" stroke="#264340" stroke-width=".8"/>`);
      }

      const toXY = (coord, min) => {
        const dx = (coord[0] - target.coord[0]) * Math.cos(target.coord[1] * RAD);
        const dy = target.coord[1] - coord[1];
        const ang = Math.atan2(dy, dx);
        const r = Math.min(1, min / limit) * maxR;
        return [cx + Math.cos(ang) * r, cy + Math.sin(ang) * r];
      };

      const occupied = [[cx - 18, cy - 16, cx + textWidth(work, 13) + 22, cy + 16]];
      const canLabel = (x, y, bw, bh) => {
        if (x < 10 || x + bw > w - 10 || y < 10 || y + bh > h - 86) return false;
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
        const isPrem = row.premium?.status === 'premium';
        const fill = !row.eligible ? '#405859' : (isPrem ? '#ef8e6c' : isOpp ? '#4be0b6' : pickColor(row.rent?.median, RENT_CUTS, RENT_COLORS) || '#87a8a2');
        const aria = `${row.place.name} · ${row.route.minutes}分钟${row.rent ? ' · ' + formatMapPrice(row.rent) : ''}`;
        parts.push(`<g data-place="${esc(row.place.id)}" role="button" tabindex="0" aria-label="${esc(aria)}" transform="translate(${px.toFixed(1)} ${py.toFixed(1)})"><title>${esc(aria)}</title>${active || saved || isRef ? `<circle r="${active ? 9 : 7}" fill="none" stroke="${active || isRef ? '#ffe89c' : '#9ee8ca'}" stroke-width="1.6"/>` : ''}<circle r="${active ? 5.2 : isOpp || isPrem ? 4.5 : 3.5}" fill="${fill}" stroke="#102429" stroke-width="1"/></g>`);
        if (active || saved || isRef || (row.eligible && (isOpp || isPrem || reachable.length < 30))) {
          const text = row.place.shortName + (isPrem ? ` ↑贵¥${Math.round(row.premium.extra)}` : '');
          const bw = textWidth(text, 11) + 6;
          if (canLabel(px + 7, py - 9, bw, 15)) {
            parts.push(`<text x="${(px + 7).toFixed(1)}" y="${(py + 3).toFixed(1)}" fill="${active ? '#ffea9f' : isPrem ? '#ffb096' : isOpp ? '#9ef5d8' : '#d2e5dc'}" font-size="11">${esc(text)}</text>`);
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
          `<pattern id="v2-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="scale(${1 / k})"><rect width="7" height="7" fill="#283f42"/><path d="M-1 1L1 -1M0 7L7 0M6 8L8 6" stroke="#476362" stroke-width=".9"/></pattern>` +
          `<pattern id="v2-dots" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="scale(${1 / k})"><circle cx="3" cy="3" r="1.1" fill="#123035" opacity=".68"/></pattern>` +
          `<marker id="v2-arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M1 1.5L8.5 5L1 8.5Z" fill="#ffd482"/></marker>` +
        `</defs>`,
        `<g class="v2-geo" data-zoom-tier="${tierForZoom(k)}" data-base-k="${k}" data-base-tx="${tx}" data-base-ty="${ty}" transform="translate(${fmt(tx)} ${fmt(ty)}) scale(${k})">`,
      ];

      // District base silhouette
      for (const d of atlas.districts) {
        parts.push(`<path d="${d.p}" fill="#1b3236" stroke="#3c5657" vector-effect="non-scaling-stroke" pointer-events="none"/>`);
      }

      // 74 Streets
      for (const s of atlas.streets) {
        const sum = evalResult.streetSummary.get(s.id);
        const fill = streetFill(sum, state) || 'url(#v2-hatch)';
        const active = state.selectedStreetId === s.id;
        const statText = streetMetricLabel(sum, state);
        const aria = `${s.d}·${s.n}${statText ? ' · ' + statText : (sum.outside ? ' · 超出当前筛选' : '')}`;
        parts.push(`<path class="street-shape" data-street="${esc(s.id)}" role="button" tabindex="0" aria-label="${esc(aria)}" d="${s.p}" fill="${fill}" fill-rule="evenodd" stroke="${active ? '#fff0b2' : '#183033'}" stroke-width="${active ? 2.4 : 0.85}" vector-effect="non-scaling-stroke"><title>${esc(aria)}</title></path>`);
        if (state.lens === 'rent' && state.rentSub === 'now' && sum.bandOnly && !sum.outside) {
          parts.push(`<path d="${s.p}" fill="url(#v2-dots)" pointer-events="none"/>`);
        }
      }

      // Xixiang 3 zones + 17 footprints
      const visibleZones = [];
      const visibleFootprints = [];
      if (showZones && atlas.zones?.length) {
        const westStreet = atlas.streets.find(s => s.id === atlas.zones[0].street);
        if (westStreet && inView(westStreet.bounds)) {
          parts.push(`<defs><clipPath id="v2-west-clip"><path d="${westStreet.p}"/></clipPath></defs><g clip-path="url(#v2-west-clip)">`);
          for (const z of atlas.zones) {
            if (!inView(z.bounds)) continue;
            visibleZones.push(z);
            parts.push(`<path class="zone-shape" data-zone="${esc(z.id)}" role="button" tabindex="0" aria-label="${esc(z.n + '站参考区')}" d="${z.p}" fill="rgba(22,52,55,.15)" stroke="#9ec0b2" stroke-dasharray="4 3" stroke-width="1.15" vector-effect="non-scaling-stroke"><title>${esc(z.n + '站参考区')}</title></path>`);
          }
          if (showFootprints) {
            for (const row of evalResult.rows) {
              const fp = row.place.footprint;
              if (!fp || !inView(fp.bounds)) continue;
              visibleFootprints.push(row);
              const active = state.selectedPlaceId === row.place.id;
              const fill = placeFill(row, state) || 'url(#v2-hatch)';
              const isVillage = fp.kind === '城中村';
              const tag = placeSignalTag(row, state);
              const aria = `${fp.name}（${fp.kind}）${tag.text ? ' · ' + tag.text : ''}${row.route ? ' · ' + row.route.minutes + '分' : ''}`;
              parts.push(`<path class="footprint-shape" data-place="${esc(row.place.id)}" role="button" tabindex="0" aria-label="${esc(aria)}" d="${fp.p}" fill="${fill}" fill-rule="evenodd" stroke="${active ? '#fff2b0' : isVillage ? '#ebd093' : '#94d5e6'}" stroke-width="${active ? 2.5 : 1.3}" stroke-dasharray="${!active && isVillage ? '3 2' : 'none'}" vector-effect="non-scaling-stroke"><title>${esc(aria)}</title></path>`);
              if (state.lens === 'rent' && row.rent?.grain === 'band' && row.eligible) {
                parts.push(`<path d="${fp.p}" fill="url(#v2-dots)" pointer-events="none"/>`);
              }
            }
          }
          parts.push('</g>');
        }
      }

      // 10 大园区 15 分钟步行光圈（在「议价与溢价」镜头下直接用几何视觉说明溢价圈，零文字废话！）
      if (state.lens === 'radar' && evalResult.work && engine.hubNodes?.length) {
        const usedSet = new Set(state.usedHubs || []);
        for (const hub of engine.hubNodes) {
          const [hx, hy] = project(hub.coord);
          const isOwn = hub.name === evalResult.work || hub.name === evalResult.work2;
          const isUsed = usedSet.has(hub.name);
          const fill = isOwn ? 'rgba(255,218,120,0.13)' : isUsed ? 'rgba(100,204,169,0.10)' : 'rgba(226,125,96,0.10)';
          const stroke = isOwn ? '#ffda78' : isUsed ? '#68d6b2' : '#e28363';
          parts.push(`<circle cx="${fmt(hx)}" cy="${fmt(hy)}" r="${fmt(walkRadiusMapUnits)}" fill="${fill}" stroke="${stroke}" stroke-width="${isOwn ? 1.8 : 1.25}" stroke-dasharray="4 3" vector-effect="non-scaling-stroke" pointer-events="none"/>`);
        }
      }
      parts.push('</g><g class="v2-overlay">');

      // 办公迁移走廊弧线（在「议价与溢价」镜头下自然展现）
      if (state.lens === 'radar' && atlas.migrations?.length) {
        for (const mig of atlas.migrations) {
          const [x1, y1] = pt(mig.fromXy), [x2, y2] = pt(mig.toXy);
          const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 - 22;
          parts.push(`<path d="M${fmt(x1)},${fmt(y1)} Q${fmt(mx)},${fmt(my)} ${fmt(x2)},${fmt(y2)}" fill="none" stroke="#ffd482" stroke-width="2" stroke-dasharray="5 3" marker-end="url(#v2-arrow)" pointer-events="none"/>`);
          parts.push(`<text x="${fmt(mx)}" y="${fmt(my + 5)}" text-anchor="middle" fill="#ffe6a8" font-size="10.5" font-weight="600">${esc(mig.label)}</text>`);
        }
      }

      // 选中片区的通勤路线（虚线步行接驳 + 实线轨交乘车）
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
            const [s1, s2] = [pt(startXY), pt(railPts[0])];
            if (Math.hypot(s1[0] - s2[0], s1[1] - s2[1]) > 3) {
              parts.push(`<line x1="${fmt(s1[0])}" y1="${fmt(s1[1])}" x2="${fmt(s2[0])}" y2="${fmt(s2[1])}" stroke="#143235" stroke-width="4" pointer-events="none"/><line x1="${fmt(s1[0])}" y1="${fmt(s1[1])}" x2="${fmt(s2[0])}" y2="${fmt(s2[1])}" stroke="#8ee4c4" stroke-width="2" stroke-dasharray="4 4" pointer-events="none"/>`);
            }
            if (railPts.length > 1) {
              const rStr = railPts.map(p => pt(p).map(fmt).join(',')).join(' ');
              parts.push(`<polyline points="${rStr}" fill="none" stroke="#183836" stroke-width="5.2" stroke-linejoin="round" pointer-events="none"/><polyline points="${rStr}" fill="none" stroke="#ffe194" stroke-width="2.5" stroke-linejoin="round" pointer-events="none"/>`);
              const [bx, by] = pt(railPts[0]);
              parts.push(`<circle cx="${fmt(bx)}" cy="${fmt(by)}" r="3.5" fill="#8ee4c4" stroke="#162e2d" stroke-width="1.2" pointer-events="none"/>`);
            }
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

      // 碰撞避让区：自动避开底部镜头坞与右下角按钮栈，视野更呼吸！
      const occupied = [
        [w - 150, h - 190, w, h],
        [w / 2 - 220, h - 98, w / 2 + 220, h],
      ];
      const reserve = (x, y, bw, bh) => {
        if (x < 6 || y < 6 || x + bw > w - 6 || y + bh > h - 6) return false;
        if (occupied.some(b => x < b[2] + 4 && x + bw > b[0] - 4 && y < b[3] + 3 && y + bh > b[1] - 3)) return false;
        occupied.push([x, y, x + bw, y + bh]);
        return true;
      };
      const forceReserve = (x, y, bw, bh) => { occupied.push([x, y, x + bw, y + bh]); };

      // 1. 工作地金标优先占位（绝不被片区气泡遮挡）
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
        const [dx, dy] = offsets.find(([ox, oy]) => reserve(wx + ox, wy + oy, bw, bh)) || [11, -10];
        workLayer.push(`<g transform="translate(${fmt(wx)} ${fmt(wy)})" pointer-events="none">` +
          `<path d="M0 -8L8 0L0 8L-8 0Z" fill="${col}" stroke="#162d2a" stroke-width="1.6"/>` +
          `<rect x="${fmt(dx)}" y="${fmt(dy)}" width="${bw}" height="${bh}" rx="4" fill="#172c2ef0" stroke="${col}" stroke-width="1.15"/>` +
          `<text class="no-stroke" x="${fmt(dx + 6)}" y="${fmt(dy + 13.5)}" fill="${col}" font-size="11.5" font-weight="700">${esc(wName)}</text>` +
          `<title>${esc(labelText + ' · ' + wName)}</title></g>`);
      }

      // 2. 独立叠加图层 A：6 类公共避坑图标
      const riskLayer = [];
      if (state.showRisks && (k >= 1.6 || !!state.riskFilter)) {
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

      // 3. 独立叠加图层 B：OSM 定位设施点（商场/学校等，可叠加在租金/通勤/议价任意视角上！）
      const facLayer = [];
      if (state.showFacilities) {
        const catCol = { mall: '#78d9f5', school: '#c8b8ff', park: '#7be0a7', health: '#ff9ea8' };
        for (const fac of atlas.facilities) {
          if (!fac.location?.gcj02) continue;
          if (state.facFilter && fac.category !== state.facFilter) continue;
          const [fx, fy] = pt(project(fac.location.gcj02));
          if (fx < -10 || fx > w + 10 || fy < -10 || fy > h + 10) continue;
          const active = state.selectedFacilityId === fac.id;
          const col = catCol[fac.category] || '#8ce0cf';
          const aria = `设施 · ${fac.name}`;
          let chip = '';
          if (k >= 2.2 || active) {
            const bw = Math.ceil(textWidth(fac.name, 10.5) + 10), bh = 17;
            if (reserve(fx + 8, fy - 8.5, bw, bh)) {
              chip = `<rect x="8" y="-8.5" width="${bw}" height="${bh}" rx="4" fill="#112c33ec" stroke="${col}" stroke-width=".9"/><text class="no-stroke" x="13" y="3" fill="${col}" font-size="10.5" font-weight="600">${esc(fac.name)}</text>`;
            }
          }
          facLayer.push(`<g data-fac="${esc(fac.id)}" role="button" tabindex="0" aria-label="${esc(aria)}" transform="translate(${fmt(fx)} ${fmt(fy)})"><title>${esc(aria)}</title><circle r="9" fill="transparent"/><rect x="-4.5" y="-4.5" width="9" height="9" rx="2" fill="${active ? '#fff2b0' : col}" stroke="#10252a" stroke-width="1.3"/>${chip}</g>`);
        }
      }

      // 4. 片区点位与高信噪比气泡（静默原则：没异常/非选中时不堆黑框！）
      const markerRows = evalResult.rows.filter(r => {
        if (showFootprints && r.place.footprint) return false;
        if (r.place.id === state.selectedPlaceId || store.isSaved(r.place.id) || state.referencePlaceId === r.place.id) return true;
        if (state.lens === 'radar' && (r.arbitrage.status === 'opportunity' || r.premium?.status === 'premium' || r.premium?.status === 'direct')) return true;
        if (k >= 2.0 && r.eligible) return true;
        if (k >= 1.2 && (r.arbitrage.status === 'opportunity' || r.premium?.status === 'premium') && r.eligible) return true;
        return false;
      });

      const priorityRank = r =>
        (r.place.id === state.selectedPlaceId ? 1000 : 0) +
        (state.referencePlaceId === r.place.id ? 500 : 0) +
        (store.isSaved(r.place.id) ? 300 : 0) +
        (r.premium?.status === 'premium' ? 180 : 0) +
        (r.arbitrage.status === 'opportunity' ? 120 : 0) +
        r.arbitrage.score * 10;
      markerRows.sort((a, b) => priorityRank(b) - priorityRank(a));

      let labelCount = 0;
      const labelCap = k >= 4 ? (w < 540 ? 6 : 12) : (w < 540 ? 4 : 8);
      const placeLayer = [];

      for (const row of markerRows) {
        const [sx, sy] = pt(row.place.xy);
        if (sx < -10 || sx > w + 10 || sy < -10 || sy > h + 10) continue;
        const active = row.place.id === state.selectedPlaceId;
        const saved = store.isSaved(row.place.id);
        const isRef = state.referencePlaceId === row.place.id;
        const sig = placeSignalTag(row, state);
        const isPrem = sig.tone === 'prem';
        const isOpp = sig.tone === 'opp';
        const isWalk = sig.tone === 'walk';
        const dotColor = active ? '#fff1b3' : isPrem ? '#f28f6e' : isOpp ? '#4be0b6' : isWalk ? '#f5cd74' : saved ? '#9de7ca' : '#c9dfd5';
        const aria = `${row.place.name}${sig.text ? ' · ' + sig.text : ''}${row.route ? ' · ' + row.route.minutes + '分' : ''}`;

        // 仅高价值点位或当前选中/收藏展开气泡；在「议价与溢价」下普通圈外片区只留清爽圆点，绝不刷屏！
        const shouldChip = active || saved || isRef || isPrem || isOpp || isWalk || (state.lens !== 'radar' && k >= 2.6);
        let chip = '';
        if (shouldChip && labelCount < labelCap) {
          const showTag = sig.text && (active || isPrem || isOpp || isWalk || k >= 2.2);
          const namePart = row.place.shortName;
          const fullText = showTag ? `${namePart} · ${sig.text}` : namePart;
          const bw = Math.ceil(textWidth(fullText, 11) + 14), bh = 20;
          const offsets = [[9, -10], [-bw - 9, -10], [9, -24], [-bw - 9, 5], [9, 6], [-bw / 2, -26], [14, 18], [-bw - 14, -26], [14, -34], [-bw - 14, 18]];
          const loc = offsets.find(([dx, dy]) => reserve(sx + dx, sy + dy, bw, bh)) || (active ? [14, -28] : null);
          if (loc) {
            labelCount++;
            const [dx, dy] = loc;
            const needLead = Math.abs(dy + bh / 2) > 4;
            const lx = dx < 0 ? dx + bw : dx, ly = dy + bh / 2;
            const bgFill = active ? '#ffefb8' : isPrem ? '#562119f5' : isOpp ? '#0f3932f2' : isWalk ? '#3a2f14f2' : '#142f34ee';
            const bdStroke = active ? '#e6c875' : isPrem ? '#f28f6e' : isOpp ? '#52e0b6' : isWalk ? '#f5cd74' : '#5b7e7a';
            const txtColor = active ? '#152e29' : isPrem ? '#ffd7c9' : isOpp ? '#c2fae6' : isWalk ? '#ffebb8' : '#ebf4ea';
            chip = (needLead ? `<path d="M0 0L${fmt(lx)},${fmt(ly)}" stroke="#9bbab0" stroke-width=".9" pointer-events="none"/>` : '') +
              `<rect x="${fmt(dx)}" y="${fmt(dy)}" width="${bw}" height="${bh}" rx="5" fill="${bgFill}" stroke="${bdStroke}" stroke-width="${isPrem || active ? 1.2 : 0.95}"/>` +
              `<text class="no-stroke" x="${fmt(dx + 7)}" y="${fmt(dy + 13.5)}" fill="${txtColor}" font-size="11" font-weight="${active || isPrem ? 700 : 550}">${esc(fullText)}</text>`;
          }
        }
        placeLayer.push({
          active,
          svg: `<g data-place="${esc(row.place.id)}" role="button" tabindex="0" aria-label="${esc(aria)}" transform="translate(${fmt(sx)} ${fmt(sy)})"><title>${esc(aria)}</title><circle r="9" fill="transparent"/>${isOpp && !active ? '<circle r="8.5" fill="none" stroke="#4be0b6" stroke-opacity=".45" stroke-width="1.4"/>' : ''}${isRef ? '<circle r="9.5" fill="none" stroke="#ffdf85" stroke-dasharray="2 2" stroke-width="1.3"/>' : ''}${saved ? '<circle r="7.2" fill="none" stroke="#9de7ca" stroke-width="1.3"/>' : ''}<circle r="${active ? 5.5 : isOpp || isPrem ? 4.8 : 3.4}" fill="${dotColor}" stroke="#102429" stroke-width="1.4"/>${chip}</g>`,
        });
      }
      placeLayer.sort((a, b) => Number(a.active) - Number(b.active));

      // 5. 街道 / 行政区 / 西乡住宅轮廓标注（内嵌仅非零信号图标）
      const labelLayer = [];
      if (k < 0.9) {
        for (const d of atlas.districts) {
          const [dx, dy] = pt(d.a);
          const nm = d.n.replace(/新区$|区$/, '');
          const bw = textWidth(nm, 12) + 4;
          if (reserve(dx - bw / 2, dy - 8, bw, 16)) {
            labelLayer.push(`<text x="${fmt(dx)}" y="${fmt(dy + 4)}" text-anchor="middle" fill="#e6efe4" font-size="12" font-weight="600">${esc(nm)}</text>`);
          }
        }
      } else if (showFootprints) {
        const sortedFp = visibleFootprints.slice().sort((a, b) =>
          Number(b.place.id === state.selectedPlaceId) - Number(a.place.id === state.selectedPlaceId) ||
          (b.events.length + b.policies.length) - (a.events.length + a.policies.length)
        );
        for (const row of sortedFp) {
          const [fx, fy] = pt(row.place.xy);
          const insight = evalResult.getAreaInsight('place', row.place.id);
          const sig = placeSignalTag(row, state);
          const badge = buildAreaInsightBadge(
            { kind: 'place', id: row.place.id, name: row.place.footprint.name, value: sig.text, tone: sig.tone },
            fx, fy, insight, reserve
          );
          if (badge) labelLayer.push(badge);
        }
      } else if (k >= 2.2) {
        let richCount = 0;
        const richCap = w < 540 ? 4 : 8;
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
              labelLayer.push(`<text x="${fmt(sx)}" y="${fmt(sy + 4)}" text-anchor="middle" fill="#d9e7e0" font-size="11">${esc(s.short)}</text>`);
            }
          }
        }
      } else {
        for (const s of atlas.streets) {
          if (!inView(s.bounds)) continue;
          const [sx, sy] = pt(s.xy);
          const bw = textWidth(s.short, 11) + 6;
          if (!reserve(sx - bw / 2, sy - 8, bw, 16)) continue;
          labelLayer.push(`<text x="${fmt(sx)}" y="${fmt(sy + 4)}" text-anchor="middle" fill="#d9e7e0" font-size="11">${esc(s.short)}</text>`);
        }
      }

      parts.push(...labelLayer, ...facLayer, ...placeLayer.map(x => x.svg), ...riskLayer, ...workLayer, '</g>');
      svg.innerHTML = parts.join('');
    }

    function render(payload) {
      lastPayload = payload;
      const { state, evalResult, store } = payload;
      if (state.lens === 'rent' && state.rentSub === 'macro') {
        renderMacro(state);
      } else if (state.lens === 'commute' && state.layout === 'radial' && evalResult.work) {
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
