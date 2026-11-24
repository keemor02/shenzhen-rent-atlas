/* V2 统一状态中心与本地持久化：自动兼容并无损迁移旧版收藏和看房手记 */
(function (global) {
  'use strict';

  const SESSION_KEY = 'shenzhen-rent-atlas.v2.session';
  const JOURNAL_KEY = 'shenzhen-rent-atlas.journal.v1'; // 保持与旧版完全同一个 Key，老收藏和看房记录自动延续！
  const FORMAT = 'shenzhen-rent-journal';

  function createStore(onChange) {
    const state = {
      view: 'explore',          // explore | commute | livability | watchlist
      subMode: 'rent',          // explore: rent | arbitrage | premium | yoy | mom; livability: all | mall | school | park | market | supermarket | health | pharmacy
      macroMode: '',            // '' | community | apartment | village | listing | ref2022 | density
      layout: 'geo',            // geo | radial
      work: '',
      work2: '',
      mode: 'rail',             // rail | bus | drive
      limit: 50,
      limit2: 0,
      access: 5,
      egress: 5,
      budget: 0,
      room: '1',
      sqm: 0,
      housingTypes: ['village', 'oldEstate', 'modernEstate', 'apartment'],
      verifiedOnly: false,
      oppOnly: false,
      usedHubs: [],             // 用户点击「我常去这个园区」的园区名称列表
      riskFilter: '',           // '' 或 6 类公共事件之一 (works/air/rail/flight/crowd/noise)
      referencePlaceId: '',     // 用户点击「设为参照」的片区 ID
      weights: { commute: 1, rent: 1, environment: 1, convenience: 1 },
      selectedPlaceId: '',
      selectedStreetId: '',
      selectedDistrict: '',
      selectedRiskId: '',
      placeTab: 'overview',     // overview | arbitrage | notes
      seen: new Set(),
      status: '',
    };

    // Journal entries keyed by placeId (backward compatible with v1 format!)
    const journal = new Map();
    let chosenId = '';

    function readLS(k) {
      try { return global.localStorage?.getItem(k) ?? null; } catch { return null; }
    }
    function writeLS(k, v) {
      try { global.localStorage?.setItem(k, v); return true; } catch { return false; }
    }

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
      const payload = {
        format: FORMAT,
        version: 1,
        chosenId,
        entries: [...journal.values()].map(e => ({ ...e, chosen: e.id === chosenId })),
      };
      writeLS(JOURNAL_KEY, JSON.stringify(payload));
    }

    function loadSession() {
      const raw = readLS(SESSION_KEY);
      if (!raw) return;
      try {
        const s = JSON.parse(raw);
        if (!s || typeof s !== 'object') return;
        if (['explore', 'commute', 'livability', 'watchlist'].includes(s.view)) state.view = s.view;
        if (typeof s.subMode === 'string') state.subMode = s.subMode;
        const macroAliases = { districtRent: 'community' };
        const mm = macroAliases[s.macroMode] ?? s.macroMode;
        if (['', 'community', 'apartment', 'village', 'listing', 'ref2022', 'density'].includes(mm)) state.macroMode = mm;
        if (['geo', 'radial'].includes(s.layout)) state.layout = s.layout;
        if (typeof s.work === 'string') state.work = s.work;
        if (typeof s.work2 === 'string') state.work2 = s.work2;
        if (['rail', 'bus', 'drive'].includes(s.mode)) state.mode = s.mode;
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
        if (typeof s.riskFilter === 'string') state.riskFilter = s.riskFilter;
        if (typeof s.referencePlaceId === 'string') state.referencePlaceId = s.referencePlaceId;
        if (s.weights && typeof s.weights === 'object') {
          for (const k of ['commute', 'rent', 'environment', 'convenience']) {
            if ([1, 2, 3].includes(Number(s.weights[k]))) state.weights[k] = Number(s.weights[k]);
          }
        }
        if (typeof s.selectedPlaceId === 'string') state.selectedPlaceId = s.selectedPlaceId;
        if (typeof s.selectedStreetId === 'string') state.selectedStreetId = s.selectedStreetId;
        if (Array.isArray(s.seen)) state.seen = new Set(s.seen.filter(x => typeof x === 'string'));
      } catch {}
    }

    function saveSession() {
      writeLS(SESSION_KEY, JSON.stringify({
        ...state,
        seen: [...state.seen],
      }));
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
      state.status = added ? `已标记常去「${hubName}」，该园区周边不再计入非必要溢价扣分。` : `已取消常去「${hubName}」。`;
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
      state.status = prev.saved ? `已收藏 ${prev.name}，可在「看房清单」对比。` : `已取消收藏 ${prev.name}。`;
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
      state.status = `已保存 ${prev.name} 的实地踩点记录。`;
      onChange?.();
    }

    function exportBackup() {
      return JSON.stringify({
        format: FORMAT,
        version: 1,
        chosenId,
        entries: [...journal.values()].map(e => ({ ...e, chosen: e.id === chosenId })),
      }, null, 2);
    }

    function importBackup(jsonText) {
      const parsed = JSON.parse(jsonText);
      if (parsed?.format !== FORMAT || parsed?.version !== 1 || !Array.isArray(parsed.entries)) {
        throw new Error('请选择本工具导出的第一版手记/收藏 JSON 文件。');
      }
      let merged = 0;
      for (const item of parsed.entries) {
        if (!item?.id || !item?.name) continue;
        const existing = journal.get(item.id);
        if (!existing || String(item.updatedAt || '') >= String(existing.updatedAt || '')) {
          journal.set(item.id, {
            id: String(item.id),
            name: String(item.name),
            saved: item.saved === true,
            chosen: item.chosen === true,
            manual: item.manual === true,
            station: String(item.station || ''),
            monthly: Number.isFinite(Number(item.monthly)) && item.monthly != null && item.monthly !== '' ? Number(item.monthly) : null,
            sqm: Number.isFinite(Number(item.sqm)) && item.sqm != null && item.sqm !== '' ? Number(item.sqm) : null,
            rooms: Number.isInteger(Number(item.rooms)) ? Number(item.rooms) : null,
            environment: Number.isInteger(item.environment) && item.environment >= 1 && item.environment <= 5 ? item.environment : null,
            convenience: Number.isInteger(item.convenience) && item.convenience >= 1 && item.convenience <= 5 ? item.convenience : null,
            issue: String(item.issue || ''),
            note: String(item.note || '').slice(0, 1200),
            observed: String(item.observed || ''),
            updatedAt: String(item.updatedAt || new Date().toISOString()),
          });
          merged++;
        }
      }
      if (!chosenId && typeof parsed.chosenId === 'string' && journal.has(parsed.chosenId)) {
        chosenId = parsed.chosenId;
      }
      saveJournal();
      state.status = `已导入并合并 ${merged} 条收藏/踩点记录。`;
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
      state, patch, toggleUsedHub, getEntry, isSaved, toggleSave, saveNote,
      exportBackup, importBackup, savedEntries, saveSession,
    };
  }

  global.createV2Store = createStore;
})(typeof window !== 'undefined' ? window : globalThis);
