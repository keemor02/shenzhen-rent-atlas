/* V2 60fps 双层地图与 10 分钟等时时间圈引擎 */
(function (global) {
  'use strict';

  const RENT_COLORS = ['#2e856e', '#6ea98d', '#c9b174', '#b86f50'];
  const RENT_CUTS = [2000, 3500, 5500];
  const YOY_COLORS = ['#739ec2', '#517693', '#344d60', '#8a6244', '#b86f46'];
  const YOY_CUTS = [-8, -1, 1, 8];
  const COMMUTE_COLORS = ['#2e856e', '#6ea98d', '#c9b174', '#b86f50'];
  const COMMUTE_CUTS = [25, 40, 60];
  const ARB_COLORS = { opportunity: '#2d9d7f', watch: '#4e7e73', mixed: '#b8914f', tight: '#a75c43', neutral: '#30494c' };
  const FAC_COLORS = ['#395658', '#487d76', '#5e9e89', '#88ba9f'];

  function tierForZoom(k) {
    return (k >= 0.8) + (k >= 2.2) + (k >= 4) + (k >= 6.5);
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
      if (state.view === 'commute') {
        return pickColor(sum.bestMinutes, COMMUTE_CUTS, COMMUTE_COLORS);
      }
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
      if (state.subMode === 'yoy') {
        return pickColor(sum.yoy, YOY_CUTS, YOY_COLORS);
      }
      // Default: rent
      if (sum.bestRent != null) return pickColor(sum.bestRent, RENT_CUTS, RENT_COLORS);
      // Soft fallback using official 2022 reference unit price * 35sqm for empty streets
      if (!state.verifiedOnly && sum.refUnit) return pickColor(sum.refUnit * 35, RENT_CUTS, RENT_COLORS);
      return null;
    }

    function placeFill(row, state) {
      if (!row.eligible && state.budget > 0) return '#273d40';
      if (state.view === 'commute') return pickColor(row.route?.minutes, COMMUTE_CUTS, COMMUTE_COLORS);
      if (state.subMode === 'arbitrage') return ARB_COLORS[row.arbitrage.status] || ARB_COLORS.neutral;
      if (state.subMode === 'yoy') return pickColor(row.trend?.yoy, YOY_CUTS, YOY_COLORS);
      return pickColor(row.rent?.median, RENT_CUTS, RENT_COLORS);
    }

    function legendMarkup(state) {
      const stop = (color, text) => `<span class="legend-item"><i class="legend-swatch" style="background:${color}"></i>${esc(text)}</span>`;
      if (state.macroMode === 'density') {
        return '<strong>人口密度(人/km²)</strong>' +
          stop('#2c4050', '<3k') + stop('#3d5d73', '3k–7k') + stop('#5786a6', '7k–15k') + stop('#79a8c7', '≥15k');
      }
      if (state.macroMode === 'districtRent') {
        return '<strong>区级普通小区均价(元/㎡·月)</strong>' +
          stop('#2c4050', '<50') + stop('#3d5d73', '50–70') + stop('#5786a6', '70–95') + stop('#79a8c7', '≥95');
      }
      if (state.view === 'commute') {
        return '<strong>单程通勤(分钟)</strong>' +
          stop(COMMUTE_COLORS[0], '<25') + stop(COMMUTE_COLORS[1], '25–39') + stop(COMMUTE_COLORS[2], '40–59') + stop(COMMUTE_COLORS[3], '≥60') +
          (state.layout === 'radial' ? '<span>· 每圈 10 分钟</span>' : '');
      }
      if (state.view === 'livability') {
        return '<strong>已核实设施(处)</strong>' +
          stop(FAC_COLORS[0], '1') + stop(FAC_COLORS[1], '2–3') + stop(FAC_COLORS[2], '4–6') + stop(FAC_COLORS[3], '≥7') +
          '<span class="legend-item"><i class="legend-swatch swatch-hatch"></i>待收录</span>' +
          '<span class="legend-item">▲ 公开环境避坑点</span>';
      }
      if (state.subMode === 'arbitrage') {
        return '<strong>议价雷达</strong>' +
          stop(ARB_COLORS.opportunity, '议价机会') + stop(ARB_COLORS.watch, '值得留意') + stop(ARB_COLORS.mixed, '供需分歧') + stop(ARB_COLORS.tight, '需求偏紧');
      }
      if (state.subMode === 'yoy') {
        return '<strong>片区同户型同比(%)</strong>' +
          stop(YOY_COLORS[0], '<-8') + stop(YOY_COLORS[1], '-8~-1') + stop(YOY_COLORS[2], '-1~+1') + stop(YOY_COLORS[3], '+1~+8') + stop(YOY_COLORS[4], '≥+8');
      }
      return '<strong>分形态月租中位(元/月)</strong>' +
        stop(RENT_COLORS[0], '<2k') + stop(RENT_COLORS[1], '2k–3.5k') + stop(RENT_COLORS[2], '3.5k–5.5k') + stop(RENT_COLORS[3], '≥5.5k') +
        '<span class="legend-item"><i class="legend-swatch swatch-hatch"></i>待补</span>';
    }

    function renderMacro(state) {
      const view = camera.viewport(), { w, h, k, tx, ty, pt } = view;
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      const parts = [
        `<defs><pattern id="v2-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="scale(${1 / k})"><rect width="7" height="7" fill="#2c4548"/><path d="M-1 1L1 -1M0 7L7 0M6 8L8 6" stroke="#4f6c6a" stroke-width=".9"/></pattern></defs>`,
        `<g class="v2-geo" data-zoom-tier="${tierForZoom(k)}" data-base-k="${k}" data-base-tx="${tx}" data-base-ty="${ty}" transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${k})">`,
      ];
      const blues = ['#2c4050', '#3d5d73', '#5786a6', '#79a8c7'];
      for (const d of atlas.districts) {
        const val = state.macroMode === 'density' ? d.density : d.community?.price;
        const cuts = state.macroMode === 'density' ? [3000, 7000, 15000] : [50, 70, 95];
        const fill = pickColor(val, cuts, blues) || 'url(#v2-hatch)';
        const active = state.selectedDistrict === d.n;
        const labelVal = val != null ? (state.macroMode === 'density' ? `${val.toLocaleString('zh-CN')} 人/km²` : `${val} 元/㎡·月`) : '缺同口径';
        parts.push(`<path class="street-shape" data-district="${esc(d.n)}" role="button" tabindex="0" aria-label="${esc(d.n + ' · ' + labelVal)}" d="${d.p}" fill="${fill}" stroke="${active ? '#fff0b0' : '#16353a'}" stroke-width="${active ? 2.6 : 1.2}" vector-effect="non-scaling-stroke"><title>${esc(d.n + ' · ' + labelVal)}</title></path>`);
      }
      parts.push('</g><g class="v2-overlay">');
      for (const d of atlas.districts) {
        const [x, y] = pt(d.a);
        if (x < 10 || x > w - 10 || y < 10 || y > h - 10) continue;
        const val = state.macroMode === 'density' ? d.density : d.community?.price;
        const txt = val != null ? (state.macroMode === 'density' ? val.toLocaleString('zh-CN') : `${val}元/㎡`) : '—';
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

      const occupied = [];
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
        const isOpp = row.arbitrage.status === 'opportunity';
        const fill = !row.eligible ? '#4b6364' : (isOpp ? '#46e0b3' : pickColor(row.rent?.median, RENT_CUTS, RENT_COLORS) || '#87a8a2');
        const aria = `${row.place.name} · ${row.route.minutes}分钟 · ${row.rent ? money(row.rent.median) : '租金待补'} · ${row.arbitrage.label}`;
        parts.push(`<g data-place="${esc(row.place.id)}" role="button" tabindex="0" aria-label="${esc(aria)}" transform="translate(${px.toFixed(1)} ${py.toFixed(1)})"><title>${esc(aria)}</title>${active || saved ? `<circle r="${active ? 9 : 7}" fill="none" stroke="${active ? '#ffe89c' : '#9ee8ca'}" stroke-width="1.6"/>` : ''}<circle r="${active ? 5 : isOpp ? 4.5 : 3.5}" fill="${fill}" stroke="#10252a" stroke-width="1"/></g>`);
        if (active || saved || (row.eligible && (isOpp || reachable.length < 30))) {
          const text = row.place.shortName;
          const bw = text.length * 11 + 6;
          if (canLabel(px + 7, py - 10, bw, 15)) {
            parts.push(`<text x="${(px + 7).toFixed(1)}" y="${(py + 3).toFixed(1)}" fill="${active ? '#ffea9f' : isOpp ? '#9ef5d8' : '#d2e5dc'}" font-size="11">${esc(text)}</text>`);
          }
        }
      }

      // Center workplace diamond
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

      const parts = [
        `<defs><pattern id="v2-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="scale(${1 / k})"><rect width="7" height="7" fill="#2c4548"/><path d="M-1 1L1 -1M0 7L7 0M6 8L8 6" stroke="#4f6c6a" stroke-width=".9"/></pattern></defs>`,
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
        const statText = state.view === 'commute'
          ? (sum.bestMinutes != null ? `最短 ${sum.bestMinutes} 分钟` : '待选工作地')
          : state.view === 'livability'
            ? (sum.facilityCount ? `已核实 ${sum.facilityCount} 处设施` : '设施待补')
            : state.subMode === 'arbitrage'
              ? (sum.oppCount ? `${sum.oppCount} 处议价线索` : '常规')
              : state.subMode === 'yoy'
                ? (sum.yoy != null ? `同比 ${sum.yoy > 0 ? '+' : ''}${sum.yoy}%` : '缺同比')
                : (sum.bestRent != null ? `中位起 ${money(sum.bestRent)}` : sum.refUnit ? `官方参考 ${sum.refUnit}元/㎡` : '待补');
        const aria = `${s.d}·${s.n} · ${statText}`;
        parts.push(`<path class="street-shape" data-street="${esc(s.id)}" role="button" tabindex="0" aria-label="${esc(aria)}" d="${s.p}" fill="${fill}" fill-rule="evenodd" stroke="${active ? '#fff0b2' : '#1b3336'}" stroke-width="${active ? 2.4 : 0.9}" vector-effect="non-scaling-stroke"><title>${esc(aria)}</title></path>`);
      }

      // Xixiang 3 zones + 17 residential footprints (NOW 17/17 HAVE REAL BY-TYPE RENT!)
      if (showZones && atlas.zones?.length) {
        const westStreet = atlas.streets.find(s => s.id === atlas.zones[0].street);
        if (westStreet) {
          parts.push(`<defs><clipPath id="v2-west-clip"><path d="${westStreet.p}"/></clipPath></defs><g clip-path="url(#v2-west-clip)">`);
          for (const z of atlas.zones) {
            parts.push(`<path data-zone="${esc(z.id)}" d="${z.p}" fill="rgba(22,52,55,.16)" stroke="#a8c7b8" stroke-dasharray="4 3" stroke-width="1.2" vector-effect="non-scaling-stroke"><title>${esc(z.n + '站参考区')}</title></path>`);
          }
          if (showFootprints) {
            for (const row of evalResult.rows) {
              const fp = row.place.footprint;
              if (!fp) continue;
              const active = state.selectedPlaceId === row.place.id;
              const fill = placeFill(row, state) || 'url(#v2-hatch)';
              const isVillage = fp.kind === '城中村';
              const aria = `${fp.name}（${fp.kind}）· ${row.rent ? money(row.rent.median) : '待补'}${row.route ? ' · ' + row.route.minutes + '分' : ''} · ${row.arbitrage.label}`;
              parts.push(`<path class="footprint-shape" data-place="${esc(row.place.id)}" role="button" tabindex="0" aria-label="${esc(aria)}" d="${fp.p}" fill="${fill}" fill-rule="evenodd" stroke="${active ? '#fff2b0' : isVillage ? '#ebd093' : '#94d5e6'}" stroke-width="${active ? 2.5 : 1.3}" stroke-dasharray="${!active && isVillage ? '3 2' : 'none'}" vector-effect="non-scaling-stroke"><title>${esc(aria)}</title></path>`);
            }
          }
          parts.push('</g>');
        }
      }
      parts.push('</g><g class="v2-overlay">');

      // Route polyline for selected place
      const selRow = evalResult.rowById.get(state.selectedPlaceId);
      if (selRow && selRow.route && evalResult.work) {
        const pts = [project(selRow.place.coord)];
        if (state.mode === 'rail') {
          for (const leg of selRow.route.legs || []) {
            const stList = timing.lines[leg.line]?.stations;
            if (stList) {
              const a = stList.indexOf(leg.from), b = stList.indexOf(leg.to);
              if (a >= 0 && b >= 0) {
                const seg = stList.slice(Math.min(a, b), Math.max(a, b) + 1);
                if (a > b) seg.reverse();
                seg.forEach(nm => { const p = stationXY(nm); if (p) pts.push(p); });
              }
            }
          }
        }
        const destXY = stationXY(evalResult.work);
        if (destXY) pts.push(destXY);
        if (pts.length > 1) {
          const str = pts.map(p => pt(p).map(fmt).join(',')).join(' ');
          parts.push(`<polyline points="${str}" fill="none" stroke="#193b37" stroke-width="5" pointer-events="none"/><polyline points="${str}" fill="none" stroke="#ffe194" stroke-width="2.2" stroke-linejoin="round" pointer-events="none"/>`);
        }
      }

      // Collision grid for crisp screen-space labels
      const occupied = [[w - 44, 4, w, 108]];
      const reserve = (x, y, bw, bh) => {
        if (x < 4 || y < 4 || x + bw > w - 4 || y + bh > h - 4) return false;
        if (occupied.some(b => x < b[2] + 3 && x + bw > b[0] - 3 && y < b[3] + 2 && y + bh > b[1] - 2)) return false;
        occupied.push([x, y, x + bw, y + bh]);
        return true;
      };

      // Place markers (prioritize: selected > saved > arbitrage opportunities > eligible places when zoomed in)
      const markerRows = evalResult.rows.filter(r => {
        if (showFootprints && r.place.footprint) return false; // Footprint itself is clickable
        if (r.place.id === state.selectedPlaceId || store.isSaved(r.place.id)) return true;
        if (state.subMode === 'arbitrage' && (r.arbitrage.status === 'opportunity' || r.arbitrage.status === 'mixed')) return true;
        if (k >= 1.8 && r.eligible) return true;
        if (k >= 1.1 && r.arbitrage.status === 'opportunity' && r.eligible) return true;
        return false;
      });

      markerRows.sort((a, b) =>
        Number(a.place.id === state.selectedPlaceId) - Number(b.place.id === state.selectedPlaceId) ||
        Number(store.isSaved(a.place.id)) - Number(store.isSaved(b.place.id)) ||
        a.arbitrage.score - b.arbitrage.score
      );

      let labelCount = 0;
      const labelCap = k >= 4 ? (w < 500 ? 7 : 14) : (w < 500 ? 4 : 8);

      for (const row of markerRows) {
        const [sx, sy] = pt(row.place.xy);
        if (sx < -10 || sx > w + 10 || sy < -10 || sy > h + 10) continue;
        const active = row.place.id === state.selectedPlaceId;
        const saved = store.isSaved(row.place.id);
        const isOpp = row.arbitrage.status === 'opportunity';
        const dotColor = active ? '#fff1b3' : isOpp ? '#4be0b6' : saved ? '#9de7ca' : '#d5e6db';
        const aria = `${row.place.name} · ${row.rent ? money(row.rent.median) : '待补'}${row.route ? ' · ' + row.route.minutes + '分' : ''} · ${row.arbitrage.label}`;
        let chip = '';
        if ((active || saved || isOpp || k >= 2.4) && labelCount < labelCap) {
          const text = row.place.shortName + (row.rent && k >= 2.2 ? ' ' + money(row.rent.median) : '');
          const bw = text.length * 10.5 + 10;
          if (reserve(sx + 8, sy - 10, bw, 19)) {
            labelCount++;
            chip = `<rect x="8" y="-10" width="${bw}" height="19" rx="4" fill="${active ? '#ffefb8' : '#153438ee'}" stroke="${active ? '#e6c875' : isOpp ? '#4be0b6' : '#658682'}" stroke-width=".9"/><text x="13" y="3" fill="${active ? '#162f2a' : '#eef5e9'}" stroke="none" font-size="11" font-weight="${active ? 700 : 500}">${esc(text)}</text>`;
          }
        }
        parts.push(`<g data-place="${esc(row.place.id)}" role="button" tabindex="0" aria-label="${esc(aria)}" transform="translate(${fmt(sx)} ${fmt(sy)})"><title>${esc(aria)}</title><circle r="9" fill="transparent"/>${saved ? '<circle r="7.5" fill="none" stroke="#9de7ca" stroke-width="1.3"/>' : ''}<circle r="${active ? 5.5 : isOpp ? 4.8 : 3.5}" fill="${dotColor}" stroke="#12292d" stroke-width="1.4"/>${chip}</g>`);
      }

      // Public environment risk markers in livability view (or when zoomed in)
      if (state.view === 'livability' || k >= 2.4) {
        for (const risk of atlas.publicEvents) {
          const [rx, ry] = pt(project(risk.coord));
          if (rx < 0 || rx > w || ry < 0 || ry > h) continue;
          const active = state.selectedRiskId === risk.id;
          const aria = `避坑提醒 · ${risk.kind} · ${risk.name}`;
          parts.push(`<g data-risk="${esc(risk.id)}" role="button" tabindex="0" aria-label="${esc(aria)}" transform="translate(${fmt(rx)} ${fmt(ry)})"><title>${esc(aria)}</title><path d="M0 -8L7.5 6H-7.5Z" fill="${active ? '#fff0b3' : '#e59467'}" stroke="#16292d" stroke-width="1.3"/></g>`);
        }
      }

      // Workplace pins
      for (const [labelText, wName, col] of [['工作地', evalResult.work, '#ffda78'], ['第二工作地', evalResult.work2, '#91d8ff']]) {
        if (!wName) continue;
        const xy = stationXY(wName);
        if (!xy) continue;
        const [wx, wy] = pt(xy);
        if (wx < -10 || wx > w + 10 || wy < -10 || wy > h + 10) continue;
        parts.push(`<g transform="translate(${fmt(wx)} ${fmt(wy)})" pointer-events="none"><path d="M0 -8L8 0L0 8L-8 0Z" fill="${col}" stroke="#162d2a" stroke-width="1.5"/><text x="11" y="4" fill="${col}" font-size="12" font-weight="700">${esc(wName)}</text><title>${esc(labelText + ' · ' + wName)}</title></g>`);
      }

      // Street / District / Footprint text labels
      if (k < 0.85) {
        for (const d of atlas.districts) {
          const [dx, dy] = pt(d.a);
          const nm = d.n.replace(/新区$|区$/, '');
          if (reserve(dx - 18, dy - 8, 36, 16)) {
            parts.push(`<text x="${fmt(dx)}" y="${fmt(dy + 4)}" text-anchor="middle" fill="#e6efe4" font-size="12" font-weight="600">${esc(nm)}</text>`);
          }
        }
      } else if (showFootprints) {
        for (const row of evalResult.rows) {
          if (!row.place.footprint) continue;
          const [fx, fy] = pt(row.place.xy);
          const nm = row.place.footprint.name;
          const bw = nm.length * 11 + 8;
          if (reserve(fx - bw / 2, fy - 12, bw, 24)) {
            parts.push(`<text x="${fmt(fx)}" y="${fmt(fy - 1)}" text-anchor="middle" fill="#fbf5dc" font-size="11.5" font-weight="600">${esc(nm)}</text>`);
            if (row.rent) parts.push(`<text x="${fmt(fx)}" y="${fmt(fy + 11)}" text-anchor="middle" fill="#c6f0df" font-size="10">${esc(money(row.rent.median))}</text>`);
          }
        }
      } else {
        for (const s of atlas.streets) {
          const [sx, sy] = pt(s.xy);
          const bw = s.short.length * 11 + 6;
          if (!reserve(sx - bw / 2, sy - 8, bw, 16)) continue;
          parts.push(`<text x="${fmt(sx)}" y="${fmt(sy + 4)}" text-anchor="middle" fill="#e2ede6" font-size="11">${esc(s.short)}</text>`);
        }
      }

      parts.push('</g>');
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
