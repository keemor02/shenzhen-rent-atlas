'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const base = JSON.parse(read('data/base.json'));
const fine = JSON.parse(read('data/fine.json'));
const facilities = JSON.parse(read('data/facilities.json'));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

test('local trend scale uses dedicated wide bins and places 0% in neutral middle tone', () => {
  const factory = vm.runInNewContext(read('src/regional-layers.js') + '\nmakeRegionalLayers;');
  const model = factory(base, esc);
  assert.equal(model.paint(-10, 'districtRent', 'local', 'yoy'), '#739ec2');
  assert.equal(model.paint(-4, 'districtRent', 'local', 'yoy'), '#517693');
  assert.equal(model.paint(0, 'districtRent', 'local', 'yoy'), '#344d60');
  assert.equal(model.paint(4, 'districtRent', 'local', 'yoy'), '#75543c');
  assert.equal(model.paint(10, 'districtRent', 'local', 'yoy'), '#a76e46');
  assert.equal(model.paint(0, 'districtRent', 'local', 'mom'), '#344d60');
  assert.match(model.legend('districtRent', 'local', 'yoy', [-10, 0, 5]), /片区同比（%）/);
  assert.match(model.legend('districtRent', 'local', 'mom', [-2, 0, 3]), /片区环比（%）/);
});

test('map themes expose explicit room-grain hint in local YoY/MoM mode', () => {
  const ctx = vm.createContext({ window: {} });
  for (const f of ['src/regional-layers.js', 'src/market-events.js', 'src/facilities.js', 'src/map-themes.js']) {
    vm.runInContext(read(f), ctx);
  }
  const themes = ctx.makeMapThemes(base, fine, facilities, esc);
  themes.state.layer = 'rent';
  themes.state.localMetric = 'yoy';
  assert.match(themes.controls(''), /居室不限时默认按一室样本展示/);
  assert.match(themes.controls('2'), /按二室同户型样本/);
  themes.state.localMetric = 'price';
  assert.doesNotMatch(themes.controls(''), /默认按一室/);
});

test('journal saveObservation and importText round-trip ratings and notes cleanly', () => {
  const store = new Map();
  const ctx = vm.createContext({
    document: { getElementById: () => null },
    localStorage: {
      getItem: k => store.get(k) ?? null,
      setItem: (k, v) => store.set(k, v)
    },
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} }
  });
  ctx.window = ctx;
  vm.runInContext(read('src/journal.js'), ctx);
  const book = ctx.makeJournal({ travel: { nodes: [] } });
  book.toggle('nsguanlong', '官龙村 · 官龙名苑');
  book.saveObservation('nsguanlong', '官龙村 · 官龙名苑', { environment: '4', convenience: '5', note: '晚间安静，菜场近' });
  const item = book.get('nsguanlong');
  assert.equal(item.saved, true);
  assert.equal(item.environment, 4);
  assert.equal(item.convenience, 5);
  assert.equal(item.note, '晚间安静，菜场近');
  const exported = JSON.stringify(book.pack());
  const book2 = ctx.makeJournal({ travel: { nodes: [] } });
  const count = book2.importText(exported);
  assert.equal(count, 1);
  assert.equal(book2.get('nsguanlong').environment, 4);
});

test('Qianhai market is anchored to Qianhaiwan station in Nanshan', () => {
  const qianhai = fine.hoods.find(h => h.n === '前海商圈');
  assert.ok(qianhai, '前海商圈 should be mapped in fine.hoods');
  assert.equal(qianhai.d, '南山区');
  assert.equal(qianhai.station, '前海湾');
  assert.equal(qianhai.street, '440305001000');
});
