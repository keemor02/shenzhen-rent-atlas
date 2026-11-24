(function (global) {
  'use strict';

  const KEY = 'shenzhen-rent-atlas.journal.v1';
  const FORMAT = 'shenzhen-rent-journal';
  const issues = ['噪声', '异味', '施工扬尘', '夜间照明', '道路安全', '积水', '其他'];
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
  const trim = (value, limit) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
  const number = (value, max) => {
    if (value === '' || value == null || !['number','string'].includes(typeof value)) return null;
    const n = Number(value);
    return Number.isFinite(n) && n >= 1 && n <= max ? n : null;
  };
  const validDate = value => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
    const timestamp = Date.parse(value + 'T12:00:00Z');
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value ? value : '';
  };
  function issueSelect(value) {
    return '<label>现场观察 <select data-jr="issue"><option value="">未记录</option>' +
      issues.map(s => '<option' + (value === s ? ' selected' : '') + '>' + escape(s) + '</option>').join('') +
      '</select></label>';
  }

  function fieldRating(k, title, value) {
    const labels = ['很不合适','不太合适','一般','满意','很满意'];
    return '<label>'+title+'<select data-jr="'+k+'"><option value="">尚未判断</option>'+
      labels.map((x,i)=>'<option value="'+(i+1)+'"'+(value===i+1?' selected':'')+'>'+(i+1)+' · '+x+'</option>').join('')+'</select></label>';
  }
  function readRating(value) {
    if (value == null || value === '') return null;
    const n = number(value,5);
    if (!Number.isInteger(n)) throw Error('现场感受需为 1 至 5 档');
    return n;
  }
  function makeJournal({travel, onChange = () => {}, navigate = () => {}, resolveStation = value => value} = {}) {
    const doc = global.document;
    const section = doc.getElementById('journal');
    const byId = id => doc.getElementById(id);
    const rows = new Map();
    const pendingDelete = new Set();
    const drafts = new Map();
    const sourceNodes = travel?.nodes ?? travel?.stations ?? travel ?? [];
    const stationNames = new Set((sourceNodes instanceof Map ? [...sourceNodes.values()] :
      Array.isArray(sourceNodes) ? sourceNodes : []).flatMap(node => {
      const name = typeof node === 'string' ? node : Array.isArray(node) ? node[0] : node?.name;
      return name && name !== '企鹅岛' && (!node?.kind || node.kind === '地铁站') ? [name] : [];
    }));
    let chosenId = '', storage = null, storageMessage = '', lastStatus = '';
    const fresh = (id, name) => ({id, name, saved:false, chosen:false, manual:false,
      station:'', monthly:null, sqm:null, rooms:null, environment:null, convenience:null, issue:'', note:'', observed:'', updatedAt:''});

    function normalize(item) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw Error('手记条目格式有误');
      const id = trim(item.id, 240), name = trim(item.name, 160);
      if (!id || !name) throw Error('有条目缺少名称或编号');
      const manual = item.manual === true, station = trim(item.station, 80);
      if (manual && (!id.startsWith('manual-') || !stationNames.has(station))) throw Error('手动片区缺少有效的地铁站或编号');
      if (!manual && id.startsWith('manual-')) throw Error('手动片区类型有误');
      const date = validDate(item.observed);
      if (item.observed && !date) throw Error('手记日期有误');
      const monthly = number(item.monthly, 1000000), sqm = number(item.sqm, 1000), rooms = number(item.rooms, 4);
      if ((item.monthly != null && item.monthly !== '' && monthly == null) ||
          (item.sqm != null && item.sqm !== '' && sqm == null) ||
          (item.rooms != null && item.rooms !== '' && (!rooms || !Number.isInteger(rooms)))) throw Error('月租、面积或居室数超出范围');
      const stamp = typeof item.updatedAt === 'string' && Number.isFinite(Date.parse(item.updatedAt))
        ? new Date(item.updatedAt).toISOString() : '';
      return {...fresh(id, name), manual, station, monthly, sqm, rooms, saved:item.saved === true,
        environment:readRating(item.environment), convenience:readRating(item.convenience),
        issue:issues.includes(item.issue) ? item.issue : '', note:trim(item.note, 1200), observed:date, updatedAt:stamp};
    }
    function unpack(value) {
      if (!value || value.format !== FORMAT || value.version !== 1 || !Array.isArray(value.entries)) {
        throw Error('请选择本地图导出的第一版手记 JSON');
      }
      const entries = new Map();
      for (const valueRow of value.entries) {
        const entry = normalize(valueRow);
        if (entries.has(entry.id)) throw Error('备份里有重复的条目编号');
        entries.set(entry.id, entry);
      }
      const chosen = typeof value.chosenId === 'string' && entries.has(value.chosenId) ? value.chosenId : '';
      return {entries, chosen};
    }
    function pack() {
      return {format:FORMAT, version:1, chosenId, entries:[...rows.values()].map(r => ({...r, chosen:r.id === chosenId}))};
    }
    function replace(book) {
      rows.clear();
      for (const [k, v] of book.entries) rows.set(k, v);
      chosenId = book.chosen;
    }
    function setStatus(text) {
      lastStatus = text;
      const status = byId('journal-status');
      if (status) status.textContent = [text, storageMessage].filter(Boolean).join(' ');
    }
    try {
      storage = global.localStorage;
      const raw = storage.getItem(KEY);
      if (raw) replace(unpack(JSON.parse(raw)));
    } catch {
      storageMessage = '当前无法读取本机手记，新记录可导出备份。';
      storage = null;
    }
    function commit(type, id, message) {
      if (storage) {
        try { storage.setItem(KEY, JSON.stringify(pack())); }
        catch { storageMessage = '本次未写入本机，关闭前请导出备份。'; }
      }
      setStatus(message);
      render();
      onChange({type, id});
    }
    function edit(id, name, mutate, type, message) {
      const item = rows.get(id) || fresh(id, trim(name, 160));
      mutate(item);
      item.updatedAt = new Date().toISOString();
      if (!item.saved && !item.note && !item.issue && !item.observed && !item.environment && !item.convenience && !item.manual && chosenId !== id) rows.delete(id);
      else rows.set(id, item);
      commit(type, id, message);
    }
    function toggle(id, name) {
      if (!id || !name) return false;
      const wasSaved = !!rows.get(id)?.saved;
      edit(id, name, item => { item.saved = !wasSaved; }, 'saved', wasSaved ? '已取消收藏。' : '已收藏。');
      return !wasSaved;
    }
    function choose(id, name) {
      const already = chosenId === id;
      chosenId = already ? '' : id;
      edit(id, name, item => { if (!already) item.saved = true; }, 'chosen',
        already ? '已取消落脚选择。' : '已选定落脚片区。');
    }
    function get(id) {
      const item = rows.get(id);
      return item ? {...item, chosen:id === chosenId} : null;
    }
    const entries = () => [...rows.keys()].map(get).sort((a, b) =>
      Number(b.chosen) - Number(a.chosen) || b.updatedAt.localeCompare(a.updatedAt));
    function card(id, name) {
      const item = get(id) || fresh(id, name);
      const form = drafts.get(id) || item;
      return '<div class="probe-actions"><button type="button" data-jr="save" aria-pressed="' + item.saved +
        '" class="' + (item.saved ? 'picked' : 'subtle') + '">' + (item.saved ? '取消收藏' : '收藏候选') +
        '</button><button type="button" data-jr="choose" aria-pressed="' + item.chosen + '" class="' +
        (item.chosen ? 'picked' : 'subtle') + '">' + (item.chosen ? '取消落脚选择' : '选为落脚片区') +
        '</button></div><details class="probe-detail" data-jr="details"' + (drafts.has(id) ? ' open' : '') +
        '><summary>' + (item.note || item.issue || item.observed ? '编辑现场手记' : '记一条现场观察') +
        '</summary><form class="noteform" data-jr="form"><div class="book-flags">' + issueSelect(form.issue) +
        fieldRating('environment','居住环境',form.environment)+fieldRating('convenience','生活便利',form.convenience)+
        '<label>观察日期 <input type="date" data-jr="date" value="' + escape(form.observed) +
        '"></label></div><label>看房记录<textarea class="notefield" data-jr="note" maxlength="1200" rows="2" ' +
        'placeholder="例如周二晚八点，卧室关窗后仍听得到高架车流">' + escape(form.note) +
        '</textarea></label><div><button class="subtle" type="submit">保存观察</button> ' +
        '<span data-jr="feedback" class="status-text" role="status"></span></div></form></details>';
    }
    function bind(container, id, name) {
      if (!container) return;
      const q = selector => container.querySelector('[data-jr="' + selector + '"]');
      const save = q('save'), select = q('choose'), form = q('form');
      function sync() {
        const item = get(id);
        for (const [button, active, yes, no] of [[save, !!item?.saved, '取消收藏', '收藏候选'],
          [select, !!item?.chosen, '取消落脚选择', '选为落脚片区']]) {
          if (!button) continue;
          button.setAttribute('aria-pressed', String(active));
          button.classList.toggle('picked', active);
          button.textContent = active ? yes : no;
        }
      }
      if (save) save.onclick = () => { toggle(id, name); sync(); };
      if (select) select.onclick = () => { choose(id, name); sync(); };
      if (!form) return;
      const values = () => ({note:trim(q('note').value,1200), issue:q('issue').value, observed:validDate(q('date').value),
        environment:readRating(q('environment')?.value), convenience:readRating(q('convenience')?.value)});
      form.oninput = () => drafts.set(id, values());
      form.onsubmit = event => {
        event.preventDefault();
        const v = values();
        drafts.delete(id);
        edit(id, name, item => Object.assign(item,v), 'note', '观察已保存。');
        if (q('feedback')) q('feedback').textContent = '已保存';
      };
    }
    function render() {
      const list = byId('journal-list');
      if (!list) return;
      const book = entries();
      list.innerHTML = book.length ? book.map(item => {
        const info = [item.station ? '参考站 ' + item.station : '', item.monthly != null ? item.monthly + ' 元/月' : '',
          item.sqm != null ? item.sqm + '㎡' : '', item.rooms ? item.rooms + '室' : ''].filter(Boolean).join(' · ');
        const observation = [item.observed, item.environment?'环境 '+item.environment+'/5':'',
          item.convenience?'便利 '+item.convenience+'/5':'', item.issue, item.note].filter(Boolean);
        return '<article class="journal-list-item" data-book-id="' + escape(item.id) + '"><div><strong>' +
          escape(item.name) + '</strong> ' + (item.chosen ? '<small>已选落脚</small> ' : '') +
          (item.manual ? '<small>自填片区</small>' : '') + '</div><div class="book-flags">' +
          '<button type="button" data-book-action="open">地图查看</button>' +
          '<button type="button" data-book-action="saved" aria-pressed="' + item.saved + '">' +
          (item.saved ? '取消收藏' : '收藏') + '</button><button type="button" data-book-action="chosen" aria-pressed="' +
          item.chosen + '">' + (item.chosen ? '取消落脚选择' : '选为落脚') + '</button>' +
          '<button type="button" data-book-action="edit">编辑观察</button><button type="button" data-book-action="delete">' +
          (pendingDelete.has(item.id) ? '确认删除记录' : '删除记录') + '</button>' +
          (pendingDelete.has(item.id) ? '<button type="button" data-book-action="cancel">保留</button>' : '') +
          '</div><div class="journal-body">' + (info ? '<p>' + escape(info) + '</p>' : '') +
          (observation.length ? '<p style="white-space:pre-wrap;overflow-wrap:anywhere">' +
            escape(observation.join(' · ')) + '</p>' : '') + '<div data-book-editor></div></div></article>';
      }).join('') : '<p>还没有手记。可以收藏地图上的候选，或补充实际看过的小区。</p>';
      setStatus(lastStatus);
    }
    const list = byId('journal-list');
    if (list) list.onclick = event => {
      const button = event.target.closest('[data-book-action]');
      if (!button || !list.contains(button)) return;
      const article = button.closest('[data-book-id]'), id = article.getAttribute('data-book-id'), item = get(id);
      if (!item) return;
      const action = button.getAttribute('data-book-action');
      if (action === 'open') { navigate(id); return; }
      if (action === 'saved') { toggle(id, item.name); return; }
      if (action === 'chosen') { choose(id, item.name); return; }
      if (action === 'edit') {
        const host = article.querySelector('[data-book-editor]');
        host.innerHTML = card(id, item.name);
        host.querySelector('.probe-actions').remove();
        host.querySelector('details').open = true;
        bind(host, id, item.name);
        host.querySelector('textarea').focus();
        return;
      }
      if (action === 'delete' && pendingDelete.has(id)) {
        rows.delete(id); drafts.delete(id); pendingDelete.delete(id);
        if (chosenId === id) chosenId = '';
        commit('delete', id, '记录已删除。');
      } else {
        if (action === 'delete') pendingDelete.add(id);
        if (action === 'cancel') pendingDelete.delete(id);
        render();
      }
    };

    const form = byId('custom-form');
    if (form) {
      byId('only-stations').innerHTML = [...stationNames].map(s => '<option value="' + escape(s) + '"></option>').join('');
      const extras = doc.createElement('div');
      extras.className = 'book-flags';
      extras.innerHTML = issueSelect('') + '<label>观察日期<input type="date" data-jr="date"></label>';
      form.insertBefore(extras, form.querySelector('button[type=submit]'));
      byId('custom-toggle').onclick = () => {
        form.hidden = !form.hidden;
        byId('custom-toggle').setAttribute('aria-expanded', String(!form.hidden));
        if (!form.hidden) byId('custom-name').focus();
      };
      form.onsubmit = event => {
        event.preventDefault();
        const name = trim(byId('custom-name').value, 60), station = resolveStation(trim(byId('custom-station').value, 80));
        const error = byId('custom-error');
        if (!name || !stationNames.has(station)) {
          error.textContent = name ? '请选择列表中的地铁站。' : '请填写片区或小区名。';
          return;
        }
        const random = global.crypto?.randomUUID?.() || (Date.now().toString(36) + '-' + Math.random().toString(36).slice(2));
        const id = 'manual-' + random;
        let item;
        try {
          item = normalize({...fresh(id,name), manual:true, station, monthly:byId('custom-price').value,
            sqm:byId('custom-area').value, rooms:byId('custom-room').value, note:byId('custom-note').value,
            observed:form.querySelector('[data-jr=date]').value, issue:form.querySelector('[data-jr=issue]').value,
            saved:true, updatedAt:new Date().toISOString()});
        } catch (e) { error.textContent = e.message; return; }
        rows.set(id,item); error.textContent = ''; form.reset(); form.hidden = true;
        byId('custom-toggle').setAttribute('aria-expanded','false');
        commit('manual', id, '已加入手记，可在地图中查看。');
      };
    }
    if (byId('export-book')) byId('export-book').onclick = () => {
      const url = global.URL.createObjectURL(new Blob([JSON.stringify(pack(), null, 2)], {type:'application/json;charset=utf-8'}));
      const a = doc.createElement('a');
      a.href = url; a.download = '深圳寻房手记-' + new Date().toISOString().slice(0,10) + '.json';
      doc.body.appendChild(a); a.click(); a.remove();
      global.setTimeout(() => global.URL.revokeObjectURL(url), 1000);
      setStatus('已生成手记备份。');
    };
    if (byId('import-book')) byId('import-book').onchange = async event => {
      const input = event.target, file = input.files?.[0];
      if (!file) return;
      try {
        const incoming = unpack(JSON.parse(await file.text()));
        for (const [id, row] of incoming.entries) {
          const current = rows.get(id);
          if (!current || row.updatedAt > current.updatedAt) rows.set(id, row);
        }
        if (!chosenId) chosenId = incoming.chosen;
        commit('import', '', '手记已合并。同一条目保留较新的记录。');
      } catch (error) { setStatus('导入失败。' + (error instanceof SyntaxError ? '文件不是有效的 JSON。' : error.message)); }
      input.value = '';
    };
    global.addEventListener?.('storage', event => {
      if (event.key !== KEY || !event.newValue) return;
      try { replace(unpack(JSON.parse(event.newValue))); render(); onChange({type:'sync',id:''}); }
      catch { setStatus('其他窗口的手记格式有误。'); }
    });
    render();
    function saveObservation(id, name, values) {
      if (!id || !name) return false;
      const clean = {
        environment: readRating(values?.environment),
        convenience: readRating(values?.convenience),
        note: trim(values?.note ?? '', 1200),
        observed: values?.observed ? validDate(values.observed) : (rows.get(id)?.observed || new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10))
      };
      edit(id, name, item => Object.assign(item, clean), 'note', '看房备注已保存。');
      return true;
    }
    function importText(text) {
      const incoming = unpack(JSON.parse(text));
      for (const [id, row] of incoming.entries) {
        const current = rows.get(id);
        if (!current || row.updatedAt > current.updatedAt) rows.set(id, row);
      }
      if (!chosenId) chosenId = incoming.chosen;
      commit('import', '', '收藏与备注已合并，同一条目保留较新记录。');
      return incoming.entries.size;
    }
    return {saved:id => !!rows.get(id)?.saved, entries, manual:() => entries().filter(r => r.manual),
      toggle, saveObservation, pack, importText, card, bind, show:() => { if (section) section.hidden = false; render(); }, get};
  }
  global.makeJournal = makeJournal;
})(typeof window !== 'undefined' ? window : globalThis);
