/* V3 统一状态中心与本地持久化：自动兼容旧版收藏/看房手记，支持任意板块、楼盘与地标目的地 */
(function (global) {
  'use strict';

  const SESSION_KEY = 'shenzhen-rent-atlas.v3.session';
  const JOURNAL_KEY = 'shenzhen-rent-atlas.journal.v1'; // 保持与历代版本相同 Key，老收藏和踩点笔记零丢失
  const FORMAT = 'shenzhen-rent-journal';

  function createStore(onChange) {
    const MARKET_COLOR_LAYERS = ['rent', 'commute', 'trend', 'premium', 'density'];
    const COLOR_LAYERS = ['rent', 'commute', 'trend', 'premium', 'affordable', 'density'];
    const ALL_LAYERS = [...COLOR_LAYERS, 'facilities', 'risks'];
    const MAP_FILTER_KEYS = ['hub', 'mall', 'transit', 'terrain', 'neutralEvents', 'majorAlerts'];
    const DEFAULT_MAP_FILTER = { hub: true, mall: true, transit: true, terrain: true, neutralEvents: true, majorAlerts: true };

    const state = {
      housingTrack: 'market',   // 'market'（民房/小区/公寓市场租房）| 'affordable'（政府保租房专场）
      layers: {
        rent: true,             // 租金（单价或按面积估月租）
        commute: false,         // 通勤时长（设目的地后自动开启）
        trend: false,           // 过去涨跌（近一年同比 / 近一月环比）
        premium: false,         // 议价与溢价（园区15分步行圈 + 外迁线 + 可议价/偏贵）
        affordable: false,      // 保租房（申请中 / 往期批次 / 规划在建）
        density: false,         // 人口密度（区级官方密度）
        facilities: false,      // 配套（商场 / 学校 / 公园标点）
        risks: false,           // 避坑（6 类公开风险标点）
      },
      mapFilter: { ...DEFAULT_MAP_FILTER }, // 地图物体与中立事件显隐筛选
      fillLayer: 'rent',        // 当前负责底图着色的主图层
      lastMarketFill: 'rent',   // 切回市场房时恢复的底色图层
      trendKind: 'yoy',         // yoy (近一年/同比) | mom (近一月/环比)
      macroOpen: false,         // 是否进入各区均价全景
      macroMetric: 'community', // community | apartment | village | listing | ref2022 | density
      affFilter: '',            // '' | active | recent | upcoming
      layout: 'geo',            // geo | radial (通勤时间圈)
      facFilter: '',
      riskFilter: '',
      watchlistOpen: false,
      work: '',                 // 任意地标/商圈/地铁站/公交站/小区/片区名
      work2: '',
      mode: 'rail',             // rail | bus | drive
      peak: false,              // false=平峰 | true=早高峰（含限流排队与潮汐拥堵估算）
      limit: 50,
      limit2: 0,
      access: 5,
      egress: 5,
      budget: 0,                // 月租预算上限
      room: '1',
      sqm: 0,                   // 期望居住面积（㎡）：填写后全图实时换算预估月租
      housingTypes: ['village', 'oldEstate', 'modernEstate', 'apartment'],
      verifiedOnly: false,
      oppOnly: false,
      usedHubs: [],
      referenceId: '',          // 对比片区或小区 ID
      weights: { commute: 1, rent: 1, environment: 1, convenience: 1 },
      selectedPlateId: '',
      selectedPlaceId: '',
      selectedLandmarkId: '',
      selectedDistrict: '',
      selectedRiskId: '',
      selectedFacilityId: '',
      selectedAffId: '',
      focusSection: '',
      seen: new Set(),
      status: '',
    };

    const journal = new Map();
    let chosenId = '';

    const readLS = k => { try { return global.localStorage?.getItem(k) ?? null; } catch { return null; } };
    const writeLS = (k, v) => { try { global.localStorage?.setItem(k, v); return true; } catch { return false; } };

    function loadJournal() {
      const raw = readLS(JOURNAL_KEY);
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw);
        if (parsed?.format !== FORMAT || !Array.isArray(parsed.entries)) return;
        for (const e of parsed.entries) {
          if (!e?.id || !e?.name) continue;
          journal.set(e.id, {
            id: String(e.id),
            name: String(e.name),
            saved: e.saved === true,
            chosen: e.chosen === true,
            manual: e.manual === true,
            station: String(e.station || ''),
            monthly: Number.isFinite(Number(e.monthly)) && e.monthly !== '' && e.monthly != null ? Number(e.monthly) : null,
            sqm: Number.isFinite(Number(e.sqm)) && e.sqm !== '' && e.sqm != null ? Number(e.sqm) : null,
            rooms: Number.isInteger(Number(e.rooms)) && Number(e.rooms) > 0 ? Number(e.rooms) : null,
            environment: Number.isInteger(e.environment) && e.environment >= 1 && e.environment <= 5 ? e.environment : null,
            convenience: Number.isInteger(e.convenience) && e.convenience >= 1 && e.convenience <= 5 ? e.convenience : null,
            issue: String(e.issue || ''),
            note: String(e.note || '').slice(0, 1200),
            observed: String(e.observed || ''),
            updatedAt: String(e.updatedAt || ''),
          });
        }
        chosenId = typeof parsed.chosenId === 'string' && journal.has(parsed.chosenId) ? parsed.chosenId : '';
      } catch {}
    }

    function saveJournal() {
      writeLS(JOURNAL_KEY, JSON.stringify({
        format: FORMAT,
        version: 1,
        chosenId,
        entries: [...journal.values()].map(e => ({ ...e, chosen: e.id === chosenId })),
      }));
    }

    function loadSession() {
      const raw = readLS(SESSION_KEY);
      if (!raw) return;
      try {
        const s = JSON.parse(raw);
        if (!s || typeof s !== 'object') return;
        if (s.layers && typeof s.layers === 'object') {
          for (const k of ALL_LAYERS) {
            if (typeof s.layers[k] === 'boolean') state.layers[k] = s.layers[k];
          }
        } else if (typeof s.lens === 'string') {
          // 自动兼容旧版单选视角会话
          state.layers.rent = s.lens === 'rent';
          state.layers.commute = s.lens === 'commute';
          state.layers.premium = s.lens === 'radar';
          state.layers.affordable = s.lens === 'affordable';
          state.layers.facilities = s.showFacilities === true;
          state.layers.risks = s.showRisks === true;
          if (s.rentSub === 'yoy' || s.rentSub === 'mom') {
            state.layers.trend = true;
            state.trendKind = s.rentSub;
            state.fillLayer = 'trend';
          } else {
            state.fillLayer = s.lens === 'radar' ? 'premium' : (COLOR_LAYERS.includes(s.lens) ? s.lens : 'rent');
          }
          if (s.rentSub === 'macro') state.macroOpen = true;
        }
        if (['market', 'affordable'].includes(s.housingTrack)) state.housingTrack = s.housingTrack;
        if (s.mapFilter && typeof s.mapFilter === 'object') {
          for (const k of MAP_FILTER_KEYS) {
            if (typeof s.mapFilter[k] === 'boolean') state.mapFilter[k] = s.mapFilter[k];
          }
        }
        if (COLOR_LAYERS.includes(s.fillLayer)) state.fillLayer = s.fillLayer;
        if (MARKET_COLOR_LAYERS.includes(s.lastMarketFill)) state.lastMarketFill = s.lastMarketFill;
        if (state.housingTrack === 'affordable') state.layers.affordable = true;
        if (['yoy', 'mom'].includes(s.trendKind)) state.trendKind = s.trendKind;
        if (typeof s.macroOpen === 'boolean') state.macroOpen = s.macroOpen;
        if (['', 'active', 'recent', 'upcoming'].includes(s.affFilter)) state.affFilter = s.affFilter;
        if (['community', 'apartment', 'village', 'listing', 'ref2022', 'density'].includes(s.macroMetric)) state.macroMetric = s.macroMetric;
        if (['geo', 'radial'].includes(s.layout)) state.layout = s.layout;
        if (typeof s.facFilter === 'string') state.facFilter = s.facFilter;
        if (typeof s.riskFilter === 'string') state.riskFilter = s.riskFilter;
        if (typeof s.work === 'string') state.work = s.work;
        if (typeof s.work2 === 'string') state.work2 = s.work2;
        if (['rail', 'bus', 'drive'].includes(s.mode)) state.mode = s.mode;
        if (typeof s.peak === 'boolean') state.peak = s.peak;
        if (Number.isFinite(s.limit) && s.limit >= 15 && s.limit <= 90) state.limit = s.limit;
        if (Number.isFinite(s.limit2) && s.limit2 >= 0) state.limit2 = s.limit2;
        if (Number.isFinite(s.access) && s.access >= 0) state.access = s.access;
        if (Number.isFinite(s.egress) && s.egress >= 0) state.egress = s.egress;
        if (Number.isFinite(s.budget) && s.budget >= 0) state.budget = s.budget;
        if (['', '1', '2', '3'].includes(String(s.room ?? ''))) state.room = String(s.room ?? '');
        if (Number.isFinite(s.sqm) && s.sqm >= 0) state.sqm = s.sqm;
        if (Array.isArray(s.housingTypes) && s.housingTypes.length) state.housingTypes = s.housingTypes;
        state.verifiedOnly = s.verifiedOnly === true;
        state.oppOnly = s.oppOnly === true;
        if (Array.isArray(s.usedHubs)) state.usedHubs = [...new Set(s.usedHubs.filter(x => typeof x === 'string'))];
        if (typeof s.referenceId === 'string') state.referenceId = s.referenceId;
        if (s.weights && typeof s.weights === 'object') {
          for (const k of ['commute', 'rent', 'environment', 'convenience']) {
            if ([1, 2, 3].includes(Number(s.weights[k]))) state.weights[k] = Number(s.weights[k]);
          }
        }
        if (Array.isArray(s.seen)) state.seen = new Set(s.seen.filter(x => typeof x === 'string'));
      } catch {}
    }

    function saveSession() {
      writeLS(SESSION_KEY, JSON.stringify({
        housingTrack: state.housingTrack, mapFilter: state.mapFilter, lastMarketFill: state.lastMarketFill,
        layers: state.layers, fillLayer: state.fillLayer, trendKind: state.trendKind, macroOpen: state.macroOpen,
        affFilter: state.affFilter, macroMetric: state.macroMetric, layout: state.layout,
        facFilter: state.facFilter, riskFilter: state.riskFilter,
        work: state.work, work2: state.work2, mode: state.mode, peak: state.peak, limit: state.limit, limit2: state.limit2,
        access: state.access, egress: state.egress, budget: state.budget, room: state.room, sqm: state.sqm,
        housingTypes: state.housingTypes, verifiedOnly: state.verifiedOnly, oppOnly: state.oppOnly,
        usedHubs: state.usedHubs, referenceId: state.referenceId, weights: state.weights,
        seen: [...state.seen],
      }));
    }

    // 切换房源轨道：市场房（城中村/民房/老小区/电梯小区/商业公寓）vs 政府保租房（独立专场，绝不混杂）
    function setHousingTrack(track) {
      if (!['market', 'affordable'].includes(track) || track === state.housingTrack) return;
      const nextLayers = { ...state.layers };
      if (track === 'affordable') {
        const prevFill = MARKET_COLOR_LAYERS.includes(state.fillLayer) ? state.fillLayer : state.lastMarketFill;
        nextLayers.affordable = true;
        patch({
          housingTrack: 'affordable',
          layers: nextLayers,
          lastMarketFill: prevFill || 'rent',
          fillLayer: 'affordable',
          macroOpen: false,
          layout: 'geo',
          status: '已切至「政府保租房」专场（与民房/小区/公寓市场房独立分开）',
        });
      } else {
        nextLayers.affordable = false;
        const activeMarket = MARKET_COLOR_LAYERS.filter(k => nextLayers[k]);
        if (!activeMarket.length) nextLayers.rent = true;
        const restoreFill = nextLayers[state.lastMarketFill] ? state.lastMarketFill : (MARKET_COLOR_LAYERS.find(k => nextLayers[k]) || 'rent');
        patch({
          housingTrack: 'market',
          layers: nextLayers,
          fillLayer: restoreFill,
          macroOpen: false,
          selectedAffId: '',
          status: '已切回「市场租房」（民房 / 小区 / 商业公寓）',
        });
      }
    }

    function toggleMapFilter(key) {
      if (!MAP_FILTER_KEYS.includes(key)) return;
      patch({ mapFilter: { ...state.mapFilter, [key]: !state.mapFilter[key] }, status: '' });
    }

    function applyMapPreset(mode) {
      if (mode === 'minimal') {
        patch({
          mapFilter: { hub: false, mall: false, transit: false, terrain: false, neutralEvents: false, majorAlerts: false },
          layers: { ...state.layers, facilities: false, risks: false },
          facFilter: '', riskFilter: '',
          status: '已开启极简地图：隐藏中立物体与事件，只专注片区数据',
        });
      } else {
        patch({
          mapFilter: { ...DEFAULT_MAP_FILTER },
          layers: { ...state.layers, facilities: false, risks: false },
          facFilter: '', riskFilter: '',
          status: '已恢复默认地图标点显示',
        });
      }
    }

    // 自由组合多图层开关：打开某数据层时自动接管底色，关闭时自动顺延给下一个已开主图层
    function toggleLayer(name, extra = {}) {
      if (!ALL_LAYERS.includes(name)) return;
      const next = { ...state.layers, [name]: !state.layers[name] };
      let nextFill = state.fillLayer;
      const pool = state.housingTrack === 'affordable' ? ['affordable', 'commute'] : COLOR_LAYERS;
      const isColor = pool.includes(name);
      if (next[name]) {
        if (isColor) nextFill = name;
      } else if (isColor && nextFill === name) {
        const fallback = pool.find(k => next[k]);
        nextFill = fallback || (state.housingTrack === 'affordable' ? 'affordable' : '');
      }
      const nextLayout = (!next.commute && state.layout === 'radial') ? 'geo' : state.layout;
      const nextMarketFill = MARKET_COLOR_LAYERS.includes(nextFill) ? nextFill : state.lastMarketFill;
      patch({ layers: next, fillLayer: nextFill, lastMarketFill: nextMarketFill, macroOpen: false, layout: nextLayout, ...extra });
    }

    function setFillLayer(name) {
      if (!COLOR_LAYERS.includes(name)) return;
      const next = { ...state.layers, [name]: true };
      const nextMarketFill = MARKET_COLOR_LAYERS.includes(name) ? name : state.lastMarketFill;
      patch({ layers: next, fillLayer: name, lastMarketFill: nextMarketFill, macroOpen: false, status: '' });
    }

    function patch(next, silent = false) {
      Object.assign(state, next);
      saveSession();
      if (!silent) onChange?.();
    }

    function toggleUsedHub(hubName) {
      if (!hubName) return false;
      const cur = new Set(state.usedHubs);
      const added = !cur.has(hubName);
      if (added) cur.add(hubName);
      else cur.delete(hubName);
      state.usedHubs = [...cur];
      state.status = added ? `已标记常去「${hubName}」，取消溢价扣分` : `已取消常去「${hubName}」`;
      saveSession();
      onChange?.();
      return added;
    }

    function getEntry(id) {
      const e = journal.get(id);
      return e ? { ...e, chosen: id === chosenId } : null;
    }

    function isSaved(id) {
      return !!journal.get(id)?.saved;
    }

    function toggleSave(id, name) {
      const prev = journal.get(id) || {
        id, name, saved: false, chosen: false, manual: false, station: '',
        monthly: null, sqm: null, rooms: null, environment: null, convenience: null,
        issue: '', note: '', observed: '', updatedAt: '',
      };
      prev.saved = !prev.saved;
      prev.name = name || prev.name;
      prev.updatedAt = new Date().toISOString();
      if (!prev.saved && !prev.note && !prev.environment && !prev.convenience && !prev.monthly && chosenId !== id) {
        journal.delete(id);
      } else {
        journal.set(id, prev);
      }
      saveJournal();
      state.status = prev.saved ? `已收藏：${prev.name}` : `已移除：${prev.name}`;
      onChange?.();
      return prev.saved;
    }

    function saveNote(id, name, fields) {
      const prev = journal.get(id) || {
        id, name, saved: true, chosen: false, manual: false, station: '',
        monthly: null, sqm: null, rooms: null, environment: null, convenience: null,
        issue: '', note: '', observed: '', updatedAt: '',
      };
      const numOrNull = (v, min, max) => {
        if (v === '' || v == null) return null;
        const n = Number(v);
        return Number.isFinite(n) && n >= min && n <= max ? n : null;
      };
      prev.name = name || prev.name;
      prev.environment = numOrNull(fields.environment, 1, 5);
      prev.convenience = numOrNull(fields.convenience, 1, 5);
      prev.monthly = numOrNull(fields.monthly, 100, 200000);
      prev.note = String(fields.note || '').trim().slice(0, 1200);
      prev.observed = fields.observed || prev.observed || new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
      prev.updatedAt = new Date().toISOString();
      journal.set(id, prev);
      saveJournal();
      state.status = `已保存踩点记录：${prev.name}`;
      onChange?.();
    }

    function exportBackup() {
      return JSON.stringify({
        format: FORMAT, version: 1, chosenId,
        entries: [...journal.values()].map(e => ({ ...e, chosen: e.id === chosenId })),
      }, null, 2);
    }

    function importBackup(jsonText) {
      const parsed = JSON.parse(jsonText);
      if (parsed?.format !== FORMAT || parsed?.version !== 1 || !Array.isArray(parsed.entries)) {
        throw new Error('请选择本工具导出的看房手记/收藏 JSON 文件。');
      }
      let merged = 0;
      for (const item of parsed.entries) {
        if (!item?.id || !item?.name) continue;
        const existing = journal.get(item.id);
        if (!existing || String(item.updatedAt || '') >= String(existing.updatedAt || '')) {
          journal.set(item.id, {
            id: String(item.id), name: String(item.name),
            saved: item.saved === true, chosen: item.chosen === true, manual: item.manual === true,
            station: String(item.station || ''),
            monthly: Number.isFinite(Number(item.monthly)) && item.monthly != null && item.monthly !== '' ? Number(item.monthly) : null,
            sqm: Number.isFinite(Number(item.sqm)) && item.sqm != null && item.sqm !== '' ? Number(item.sqm) : null,
            rooms: Number.isInteger(Number(item.rooms)) ? Number(item.rooms) : null,
            environment: Number.isInteger(item.environment) && item.environment >= 1 && item.environment <= 5 ? item.environment : null,
            convenience: Number.isInteger(item.convenience) && item.convenience >= 1 && item.convenience <= 5 ? item.convenience : null,
            issue: String(item.issue || ''), note: String(item.note || '').slice(0, 1200),
            observed: String(item.observed || ''), updatedAt: String(item.updatedAt || new Date().toISOString()),
          });
          merged++;
        }
      }
      if (!chosenId && typeof parsed.chosenId === 'string' && journal.has(parsed.chosenId)) chosenId = parsed.chosenId;
      saveJournal();
      state.status = `已导入并合并 ${merged} 条记录`;
      onChange?.();
      return merged;
    }

    function savedEntries() {
      return [...journal.values()]
        .filter(e => e.saved || e.note || e.environment || e.convenience)
        .sort((a, b) => Number(b.saved) - Number(a.saved) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
    }

    loadJournal();
    loadSession();

    return {
      state, patch, toggleLayer, setFillLayer, setHousingTrack, toggleMapFilter, applyMapPreset,
      toggleUsedHub, getEntry, isSaved, toggleSave, saveNote,
      exportBackup, importBackup, savedEntries, saveSession, COLOR_LAYERS, MARKET_COLOR_LAYERS,
    };
  }

  global.createV3Store = createStore;
})(typeof window !== 'undefined' ? window : globalThis);
