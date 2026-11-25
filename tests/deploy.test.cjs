'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildWeb, enhanceHtmlForWeb } = require('../tools/build_web.cjs');
const {
  extractAffordableDeadline,
  updateAffordablePhases,
  parseCrepriceDistrictTable,
  applyCrepriceToBase,
  parse58MarketTrend,
  extractHousingNotices,
} = require('../tools/update_data.cjs');

test('build_web.cjs outputs clean dist/ bundle with PWA manifest, offline-fallback SW and strict CSP', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sz-rent-dist-'));
  try {
    const res = buildWeb({ outDir: tmpDir });
    assert.match(res.versionHash, /^[a-f0-9]{10}$/);

    for (const rel of ['index.html', 'manifest.webmanifest', 'icon.svg', 'sw.js', '_headers', '.nojekyll', 'meta.json']) {
      assert.ok(fs.existsSync(path.join(tmpDir, rel)), `dist/${rel} should exist`);
    }

    const webHtml = fs.readFileSync(path.join(tmpDir, 'index.html'), 'utf8');
    assert.match(webHtml, /rel="manifest" href="\.\/manifest\.webmanifest"/);
    assert.match(webHtml, /worker-src 'self'/);
    assert.match(webHtml, /manifest-src 'self'/);
    assert.match(webHtml, /navigator\.serviceWorker\.register\('\.\/sw\.js'/);

    const manifest = JSON.parse(fs.readFileSync(path.join(tmpDir, 'manifest.webmanifest'), 'utf8'));
    assert.equal(manifest.start_url, './');
    assert.equal(manifest.display, 'standalone');

    const sw = fs.readFileSync(path.join(tmpDir, 'sw.js'), 'utf8');
    assert.match(sw, new RegExp(`sz-rent-atlas-${res.versionHash}`));

    const meta = JSON.parse(fs.readFileSync(path.join(tmpDir, 'meta.json'), 'utf8'));
    assert.equal(meta.version, res.versionHash);
    assert.ok(meta.plateCount >= 95);
    assert.ok(meta.gzipBytes > 0 && meta.gzipBytes < meta.rawBytes);

    // Check mode should pass cleanly against freshly generated dist
    const verified = buildWeb({ outDir: tmpDir, check: true });
    assert.equal(verified.versionHash, res.versionHash);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('enhanceHtmlForWeb preserves single-file behavior while adding only same-origin PWA capabilities', () => {
  const sample = '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; connect-src \'self\'"></head><body><main></main></body></html>';
  const enhanced = enhanceHtmlForWeb(sample);
  assert.match(enhanced, /img-src data: 'self';/);
  assert.match(enhanced, /worker-src 'self'/);
  assert.doesNotMatch(enhanced, /https?:\/\//, 'Enhanced web HTML must not introduce third-party origins');
});

test('update_data.cjs accurately parses deadlines and transitions expired affordable projects safely', () => {
  assert.equal(extractAffordableDeadline({ phaseLabel: '受理中', timeline: '2026-11-21 至 11-29 受理' }), '2026-11-29');
  assert.equal(extractAffordableDeadline({ phaseLabel: '受理中', timeline: '2026-11-23 至 12-02 18:00 线上认租' }), '2026-12-02');
  assert.equal(extractAffordableDeadline({ phaseLabel: '受理中', timeline: '2026-12-20 至 01-05 受理' }), '2027-01-05');
  assert.equal(extractAffordableDeadline({ phaseLabel: '常态配租', timeline: '2026 年分批常态化配租' }), null);

  const sample = {
    asOf: '2026-11-25',
    projects: [
      { id: 'p1', name: '项目A', phase: 'active', phaseLabel: '受理中', timeline: '2026-11-21 至 11-29 受理' },
      { id: 'p2', name: '项目B', phase: 'active', phaseLabel: '受理中', timeline: '2026-11-23 至 12-02 18:00 线上认租' },
      { id: 'p3', name: '常态项目', phase: 'active', phaseLabel: '常态配租', timeline: '2026 年分批常态化配租' },
    ],
  };

  // On deadline day 2026-11-29, p1 must remain active
  const onDay = updateAffordablePhases(structuredClone(sample), '2026-11-29');
  assert.equal(onDay.changed, false);

  // On 2026-11-30, only p1 transitions to recent; p2 and p3 remain active
  const nextDay = structuredClone(sample);
  const res = updateAffordablePhases(nextDay, '2026-11-30');
  assert.equal(res.changed, true);
  assert.equal(res.transitioned.length, 1);
  assert.equal(res.transitioned[0].id, 'p1');
  assert.equal(nextDay.projects[0].phase, 'recent');
  assert.equal(nextDay.projects[0].phaseLabel, '已截止·盯下批');
  assert.equal(nextDay.projects[1].phase, 'active');
  assert.equal(nextDay.projects[2].phase, 'active');
  assert.equal(nextDay.asOf, '2026-11-30');
});

test('update_data.cjs strictly validates creprice monthly district tables and avoids downgrading snapshots', () => {
  const html = `
    <html><body>
      <p>2026年11月，深圳房租为 79.8 元/㎡·月</p>
      <table>
        <tr><th>排名</th><th>行政区</th><th>11月租金(元/㎡·月)</th></tr>
        <tr><td>1</td><td>南山区</td><td>106.5</td></tr>
        <tr><td>2</td><td>福田区</td><td>99.2</td></tr>
        <tr><td>3</td><td>罗湖区</td><td>80.8</td></tr>
        <tr><td>4</td><td>宝安区</td><td>67.1</td></tr>
        <tr><td>5</td><td>龙华区</td><td>62.4</td></tr>
        <tr><td>6</td><td>盐田区</td><td>58.9</td></tr>
        <tr><td>7</td><td>龙岗区</td><td>49.3</td></tr>
        <tr><td>8</td><td>光明区</td><td>46.2</td></tr>
        <tr><td>9</td><td>坪山区</td><td>41.5</td></tr>
        <tr><td>10</td><td>大鹏新区</td><td>38.0</td></tr>
      </table>
    </body></html>
  `;
  const rows = parseCrepriceDistrictTable(html, 2026, 11);
  assert.equal(rows['南山区'], 106.5);
  assert.equal(Object.keys(rows).length, 10);

  const mockBase = {
    listingMonth: '2026-10',
    districts: Object.keys(rows).map(n => ({ n, oct2026: 50, oct2025: 50, yoy_pct: 0 })),
  };
  const applied = applyCrepriceToBase(mockBase, {
    month: '2026-11',
    priorMonth: '2025-11',
    url: 'https://www.creprice.cn/report/sz/2026-11.html',
    rows,
    priorRows: { 南山区: 110 },
  }, '2026-12-05');
  assert.equal(applied.changed, true);
  assert.equal(mockBase.listingMonth, '2026-11');
  assert.equal(mockBase.districts.find(d => d.n === '南山区').oct2026, 106.5);
  assert.equal(mockBase.districts.find(d => d.n === '南山区').yoy_pct, -3.18);

  // Older or equal month must not overwrite
  const skipped = applyCrepriceToBase(mockBase, { month: '2026-11', rows }, '2026-12-06');
  assert.equal(skipped.changed, false);
});

test('update_data.cjs parses 58 SSR_DATA safely and filters new housing notices', () => {
  const html58 = `<script>window.SSR_DATA = {"other":{"sqInfo":{"localName":"西乡"}},"rentTrend":{"1":{"list":[{"data_year":"2026年","data_month":"10月","price":1500,"month_year_rate":-0.0625},{"data_year":"2026年","data_month":"11月","price":1480,"month_year_rate":-0.1294}]}}};</script>`;
  const parsed = parse58MarketTrend(html58, '西乡', '2026-11');
  assert.equal(parsed['2026-11']['1'].price, 1480);
  assert.equal(parsed['2026-11']['1'].yoy, -12.94);
  assert.throws(() => parse58MarketTrend(html58, '新安', '2026-11'));

  const noticeHtml = `
    <a href="/xxgk/tzgg/content/post_13071336.html">深圳市住房保障署关于面向个人配租894套保障性租赁住房的通告</a>
    <a href="/xxgk/tzgg/content/post_13099999.html">深圳市住建局关于2026年12月新一批保障性租赁住房配租通告</a>
    <a href="/xxgk/tzgg/content/post_other.html">关于施工安全检查的日常通知</a>
  `;
  const known = new Set(['https://zjj.sz.gov.cn/xxgk/tzgg/content/post_13071336.html']);
  const found = extractHousingNotices(noticeHtml, 'https://zjj.sz.gov.cn/xxgk/tzgg/index.html', known);
  assert.equal(found.length, 1);
  assert.equal(found[0].url, 'https://zjj.sz.gov.cn/xxgk/tzgg/content/post_13099999.html');
});
