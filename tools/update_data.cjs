#!/usr/bin/env node
'use strict';

// 免费定时数据自动更新与核验工具（仅使用 Node.js 20+ 原生 API，零外部依赖）：
// 1) --affordable : 保租房截止日期自动流转（过期 active -> recent）+ 巡检深圳/区住建局新公告
// 2) --districts  : 抓取并严格核验中国房价行情网（creprice.cn）深圳各区最新月度租金
// 3) --markets    : 礼貌限速核验 58 同城商圈月度租金趋势（遇风控自动优雅跳过，保留快照）
// 4) --osm        : 可选调用 tools/sync_osm.cjs 同步 OSM 新增设施
// 5) --dry-run    : 只做校验和报告，不回写项目 JSON 文件
// 原则：校验不过绝不写脏数据；所有在线更新保留原始来源链接与核验日期；输出 update-report.md。

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DISTRICTS = new Set(['南山区', '福田区', '罗湖区', '宝安区', '龙华区', '盐田区', '龙岗区', '光明区', '坪山区', '大鹏新区']);
const CREPRICE_REPORT = 'https://www.creprice.cn/report/sz/';
const USER_AGENT = 'Mozilla/5.0 (compatible; ShenzhenRentAtlasBot/1.0; +https://github.com/)';

const HOUSING_NOTICE_SOURCES = [
  {
    name: '深圳市住建局通知公告',
    url: 'https://zjj.sz.gov.cn/xxgk/tzgg/index.html',
  },
  {
    name: '南山区住建局配租公告',
    url: 'https://www.szns.gov.cn/bsfw/ztfw/zflyfwzt/xmfpjtcgg/index.html',
  },
  {
    name: '宝安区住建局信息公开',
    url: 'https://www.baoan.gov.cn/bajshej/gkmlpt/index',
  },
];

function nowCstDate() {
  return new Date(Date.now() + 8 * 3600000);
}

function todayCstString(date = nowCstDate()) {
  return date.toISOString().slice(0, 10);
}

function ymString(year, month) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

function prevYearMonth(year, month) {
  return month === 1 ? [year - 1, 12] : [year, month - 1];
}

function pad2(n) {
  return String(Number(n)).padStart(2, '0');
}

function isValidDateYmd(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * 从保租房项目条目中安全提取明确的受理截止日期（YYYY-MM-DD）。
 * 常态化配租、模糊年份范围、未来规划均返回 null（绝不误判过期）。
 */
function extractAffordableDeadline(project) {
  if (!project || typeof project !== 'object') return null;
  if (project.deadline && /^\d{4}-\d{2}-\d{2}$/.test(project.deadline)) {
    return project.deadline;
  }
  const label = String(project.phaseLabel || '');
  const tl = String(project.timeline || '');
  if (/常态|持续|滚动|长期/.test(label + ' ' + tl)) return null;

  // 模式 1：2026-11-21 至 2026-12-05
  let m = tl.match(/(\d{4})-(\d{1,2})-(\d{1,2})\s*[至到~—–-]\s*(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const [, , , , y2, m2, d2] = m.map(Number);
    if (isValidDateYmd(y2, m2, d2)) return `${y2}-${pad2(m2)}-${pad2(d2)}`;
  }

  // 模式 2：2026-11-21 至 11-29 或 2026-11-23 至 12-02 18:00
  m = tl.match(/(\d{4})-(\d{1,2})-(\d{1,2})\s*[至到~—–-]\s*(\d{1,2})-(\d{1,2})/);
  if (m) {
    const [, y1, m1, , m2, d2] = m.map(Number);
    const y2 = m2 < m1 ? y1 + 1 : y1;
    if (isValidDateYmd(y2, m2, d2)) return `${y2}-${pad2(m2)}-${pad2(d2)}`;
  }

  // 模式 3：截止 2026-12-10 / 2026-12-10 截止
  m = tl.match(/(?:截止(?:至|日期)?\s*[:：]?\s*)(\d{4})-(\d{1,2})-(\d{1,2})/)
    || tl.match(/(\d{4})-(\d{1,2})-(\d{1,2})\s*(?:\d{1,2}:\d{2}\s*)?截止/);
  if (m) {
    const [, y, mo, d] = m.map(Number);
    if (isValidDateYmd(y, mo, d)) return `${y}-${pad2(mo)}-${pad2(d)}`;
  }

  return null;
}

/**
 * 自动流转过期保租房批次（active -> recent），仅在今天严格晚于截止日期后切换。
 */
function updateAffordablePhases(affData, todayStr = todayCstString()) {
  const transitioned = [];
  if (!affData || !Array.isArray(affData.projects)) return { changed: false, transitioned };

  for (const pr of affData.projects) {
    if (pr.phase !== 'active') continue;
    const deadline = extractAffordableDeadline(pr);
    if (!deadline) continue;
    if (todayStr > deadline) {
      pr.phase = 'recent';
      pr.phaseLabel = '已截止·盯下批';
      if (!/已截止|已结束/.test(String(pr.timeline || ''))) {
        pr.timeline = `${pr.timeline}（已于 ${deadline} 截止）`;
      }
      transitioned.push({ id: pr.id, name: pr.name, deadline });
    }
  }

  if (transitioned.length > 0) {
    affData.asOf = todayStr;
  }
  return { changed: transitioned.length > 0, transitioned };
}

async function fetchText(url, { timeoutMs = 10000, maxBytes = 4_000_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const reqHost = new URL(url).hostname;
    const finalHost = new URL(res.url || url).hostname;
    if (finalHost !== reqHost) {
      throw new Error(`目标域名跳转 (${reqHost} -> ${finalHost})，可能存在验证页`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) {
      throw new Error(`响应体超出限制 (${buf.length} bytes)`);
    }
    return buf.toString('utf8');
  } finally {
    clearTimeout(timer);
  }
}

function stripTags(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractHtmlTables(html) {
  const tables = [];
  for (const tm of String(html || '').matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    const rows = [];
    for (const rm of tm[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [];
      for (const cm of rm[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)) {
        cells.push(stripTags(cm[1]));
      }
      if (cells.length) rows.push(cells);
    }
    if (rows.length) tables.push(rows);
  }
  return tables;
}

/**
 * 严格校验中国房价行情网（creprice.cn）深圳各区月度租金表。
 */
function parseCrepriceDistrictTable(htmlText, year, monthNo) {
  const summary = stripTags(htmlText);
  const summaryRe = new RegExp(`${year}年0?${monthNo}月[，,]\\s*深圳房租为\\s*\\d`);
  if (!summaryRe.test(summary)) {
    throw new Error(`未命中 ${year}年${monthNo}月 深圳房租核验摘要`);
  }
  const tables = extractHtmlTables(htmlText);
  for (const table of tables) {
    if (!table.length) continue;
    const headerOk = table[0].some(c => c.includes('月') && (c.includes('㎡') || c.includes('平方米')));
    if (!headerOk) continue;
    const rows = {};
    for (const r of table.slice(1)) {
      if (r.length < 3) continue;
      const dist = r[1];
      const rawPrice = r[2];
      if (!DISTRICTS.has(dist)) continue;
      if (!/^\d+(?:\.\d+)?$/.test(rawPrice)) continue;
      const price = Number(rawPrice);
      if (Number.isFinite(price) && price > 5 && price < 1000) {
        rows[dist] = price;
      }
    }
    if (Object.keys(rows).length >= 8) {
      return rows;
    }
  }
  throw new Error('分区租金表缺失或结构已变更');
}

async function fetchLatestCrepriceReport(nowDate = nowCstDate()) {
  let y = nowDate.getUTCFullYear();
  let m = nowDate.getUTCMonth() + 1;
  [y, m] = prevYearMonth(y, m);

  let found = null;
  const errors = [];
  for (let i = 0; i < 3; i++) {
    const ym = ymString(y, m);
    const url = `${CREPRICE_REPORT}${ym}.html`;
    try {
      const html = await fetchText(url, { timeoutMs: 10000 });
      const rows = parseCrepriceDistrictTable(html, y, m);
      found = { month: ym, year: y, monthNo: m, url, rows };
      break;
    } catch (err) {
      errors.push(`${ym}: ${err.message}`);
      [y, m] = prevYearMonth(y, m);
    }
  }
  if (!found) {
    throw new Error(`最近三期 creprice 月报均未核验通过 (${errors.join('; ')})`);
  }

  const priorYm = ymString(found.year - 1, found.monthNo);
  let priorRows = {};
  try {
    const priorHtml = await fetchText(`${CREPRICE_REPORT}${priorYm}.html`, { timeoutMs: 10000 });
    priorRows = parseCrepriceDistrictTable(priorHtml, found.year - 1, found.monthNo);
  } catch {
    priorRows = {};
  }

  return {
    ...found,
    priorMonth: priorYm,
    priorUrl: `${CREPRICE_REPORT}${priorYm}.html`,
    priorRows,
  };
}

function applyCrepriceToBase(baseData, report, todayStr = todayCstString()) {
  const currentMonth = baseData.listingMonth || '2026-10';
  if (report.month <= currentMonth) {
    return { changed: false, skippedReason: `线源最新为 ${report.month}，未新于本地快照 ${currentMonth}`, updatedDistricts: 0 };
  }
  let updatedDistricts = 0;
  for (const d of baseData.districts || []) {
    const nextPrice = report.rows[d.n];
    if (!Number.isFinite(nextPrice)) continue;
    d.oct2026 = nextPrice;
    const prior = report.priorRows?.[d.n];
    if (Number.isFinite(prior) && prior > 0) {
      d.oct2025 = prior;
      d.yoy_pct = Math.round(((nextPrice / prior) - 1) * 10000) / 100;
    }
    updatedDistricts++;
  }
  if (updatedDistricts >= 8) {
    baseData.listingMonth = report.month;
    baseData.listingPriorMonth = report.priorMonth;
    baseData.listingUrl = report.url;
    baseData.listingCheckedAt = todayStr;
    return { changed: true, updatedDistricts };
  }
  return { changed: false, skippedReason: `命中行政区不足 (${updatedDistricts}/10)`, updatedDistricts };
}

/**
 * 解析 58 同城商圈页 SSR_DATA 租金趋势，带名称、年份与价格区间强校验。
 */
function parse58MarketTrend(htmlText, expectedName, upperYm) {
  const marker = htmlText.match(/(?:window\.)?SSR_DATA\s*=\s*/);
  if (!marker) throw new Error('未找到 SSR_DATA（可能触发验证页或改版）');
  const start = marker.index + marker[0].length;
  const tail = htmlText.slice(start).trimStart();
  if (!tail.startsWith('{')) throw new Error('SSR_DATA 起始格式异常');

  // 平衡大括号抽取 JSON 对象（兼容字符串内转义引号）
  let depth = 0;
  let inStr = false;
  let esc = false;
  let end = -1;
  for (let i = 0; i < tail.length; i++) {
    const ch = tail[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) throw new Error('SSR_DATA JSON 未闭合');

  const data = JSON.parse(tail.slice(0, end));
  const loc = data?.other?.sqInfo?.localName;
  if (loc !== expectedName) {
    throw new Error(`商圈名称不一致 (期望 ${expectedName}, 实际 ${loc || '空'})`);
  }

  const months = {};
  for (const room of ['1', '2', '3', '4', '5']) {
    const list = data?.rentTrend?.[room]?.list;
    if (!Array.isArray(list)) continue;
    for (const obs of list) {
      const ymMatchY = String(obs?.data_year ?? '').match(/^(20\d\d)年?$/);
      const ymMatchM = String(obs?.data_month ?? '').match(/^(\d{1,2})月?$/);
      if (!ymMatchY || !ymMatchM) continue;
      const mo = Number(ymMatchM[1]);
      if (mo < 1 || mo > 12) continue;
      const ym = `${ymMatchY[1]}-${pad2(mo)}`;
      if (upperYm && ym > upperYm) continue;
      const price = Number(obs?.price);
      if (!Number.isFinite(price) || price < 50 || price > 1_000_000) continue;
      const yoyRaw = obs?.month_year_rate == null || obs?.month_year_rate === '' ? null : Number(obs.month_year_rate);
      const yoy = Number.isFinite(yoyRaw) ? Math.round(yoyRaw * 10000) / 100 : null;
      if (!months[ym]) months[ym] = {};
      months[ym][room] = { price, yoy };
    }
  }
  if (Object.keys(months).length < 2) {
    throw new Error('有效租金月份少于 2 个');
  }
  return months;
}

function extractHousingNotices(htmlText, pageUrl, knownUrls) {
  const found = [];
  const seen = new Set();
  for (const m of String(htmlText || '').matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1].trim();
    const title = stripTags(m[2]);
    if (!title || title.length < 8) continue;
    if (!/(保障性租赁住房|保租房|公共租赁住房|公租房)/.test(title)) continue;
    if (!/(配租|认租|通告|公告|申领|选房)/.test(title)) continue;
    let absUrl;
    try {
      absUrl = new URL(href, pageUrl).toString();
    } catch {
      continue;
    }
    if (seen.has(absUrl) || knownUrls.has(absUrl)) continue;
    seen.add(absUrl);
    found.push({ title, url: absUrl });
  }
  return found.slice(0, 8);
}

async function checkHousingNotices(affData) {
  const knownUrls = new Set((affData?.projects || []).map(p => p.source).filter(Boolean));
  const discoveries = [];
  const errors = [];

  for (const src of HOUSING_NOTICE_SOURCES) {
    try {
      const html = await fetchText(src.url, { timeoutMs: 10000 });
      const items = extractHousingNotices(html, src.url, knownUrls);
      for (const item of items) {
        discoveries.push({ sourceName: src.name, ...item });
      }
    } catch (err) {
      errors.push(`${src.name}: ${err.message}`);
    }
  }
  return { discoveries: discoveries.slice(0, 12), errors };
}

async function update58Markets(fineData, { limit = 15, delayMs = 1200, upperYm = todayCstString().slice(0, 7) } = {}) {
  const markets = Array.isArray(fineData?.markets) ? fineData.markets : [];
  let updatedCount = 0;
  let checkedCount = 0;
  let consecutiveFailures = 0;
  const failures = [];
  const validUrlRe = /^https:\/\/sz\.zf\.58\.com\/zujin\/[a-z0-9_-]+\/?$/i;

  for (const m of markets) {
    if (checkedCount >= limit) break;
    if (!m?.url || !validUrlRe.test(m.url)) continue;
    checkedCount++;
    try {
      const html = await fetchText(m.url, { timeoutMs: 9000 });
      const freshMonths = parse58MarketTrend(html, m.name, upperYm);
      consecutiveFailures = 0;
      const existing = m.months || {};
      let hasNewer = false;
      for (const [ym, rooms] of Object.entries(freshMonths)) {
        if (!existing[ym] || JSON.stringify(existing[ym]) !== JSON.stringify(rooms)) {
          existing[ym] = rooms;
          hasNewer = true;
        }
      }
      if (hasNewer) {
        m.months = existing;
        updatedCount++;
      }
    } catch (err) {
      consecutiveFailures++;
      failures.push(`${m.name}: ${err.message}`);
      if (consecutiveFailures >= 3) {
        failures.push('连续 3 个商圈触发风控/异常，本轮礼貌中止，保留既有快照');
        break;
      }
    }
    if (delayMs > 0 && checkedCount < limit) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }

  if (updatedCount > 0) {
    fineData.asof = todayCstString();
  }
  return { changed: updatedCount > 0, updatedCount, checkedCount, failures };
}

function runOsmSync() {
  const scriptPath = path.join(ROOT, 'tools', 'sync_osm.cjs');
  if (!fs.existsSync(scriptPath)) {
    return { ok: false, message: '未找到 tools/sync_osm.cjs' };
  }
  const proc = spawnSync(process.execPath, [scriptPath, '--write'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 90_000,
  });
  return {
    ok: proc.status === 0,
    message: (proc.stdout || proc.stderr || '').trim().slice(0, 400),
  };
}

function buildMarkdownReport(summary) {
  const lines = [
    `# 深圳租房地图 · 自动数据更新报告 (${summary.date})`,
    '',
    `- 模式：${summary.dryRun ? '演练模式 (--dry-run，未写入文件)' : '正式更新模式'}`,
    `- 是否有数据文件更新：${summary.anyDataChanged ? '**是**' : '否（维持既有稳定快照）'}`,
    '',
  ];

  if (summary.affordable) {
    lines.push('## 1. 官方保租房批次状态与公告巡检');
    if (summary.affordable.transitioned.length) {
      lines.push(`- 已自动流转过期批次 **${summary.affordable.transitioned.length}** 个（受理中 → 已截止）：`);
      for (const t of summary.affordable.transitioned) {
        lines.push(`  - \`${t.id}\` ${t.name}（截止 ${t.deadline}）`);
      }
    } else {
      lines.push('- 当前无新增过期批次。');
    }
    if (summary.affordable.discoveries.length) {
      lines.push(`- 巡检发现 **${summary.affordable.discoveries.length}** 条住建局候选新公告（待人工核验后录入 \`sources/v3/affordable-housing.json\`）：`);
      for (const d of summary.affordable.discoveries) {
        lines.push(`  - [${d.title}](${d.url})（${d.sourceName}）`);
      }
    }
    if (summary.affordable.errors.length) {
      lines.push(`- 巡检跳过站点：${summary.affordable.errors.join('；')}`);
    }
    lines.push('');
  }

  if (summary.districts) {
    lines.push('## 2. 深圳十区月度租金行情 (creprice.cn)');
    lines.push(`- 结果：${summary.districts.status}`);
    lines.push('');
  }

  if (summary.markets) {
    lines.push('## 3. 58 商圈月度租金趋势');
    lines.push(`- 探测 ${summary.markets.checkedCount} 个商圈，更新 ${summary.markets.updatedCount} 个。`);
    if (summary.markets.failures.length) {
      lines.push(`- 跳过/风控记录：${summary.markets.failures.slice(0, 5).join('；')}`);
    }
    lines.push('');
  }

  if (summary.osm) {
    lines.push('## 4. OpenStreetMap 设施增量同步');
    lines.push(`- 状态：${summary.osm.ok ? '成功' : '跳过/失败'} — ${summary.osm.message || '无输出'}`);
    lines.push('');
  }

  return lines.join('\n');
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has('--dry-run');
  const explicitTask = args.has('--affordable') || args.has('--districts') || args.has('--markets') || args.has('--osm');
  const doAffordable = args.has('--affordable') || !explicitTask || args.has('--all');
  const doDistricts = args.has('--districts') || !explicitTask || args.has('--all');
  const doMarkets = args.has('--markets') || args.has('--all');
  const doOsm = args.has('--osm');
  const skipNetwork = args.has('--offline');

  const today = todayCstString();
  const summary = { date: today, dryRun, anyDataChanged: false };

  // 1. 保租房状态流转 + 公告巡检
  if (doAffordable) {
    const affPath = path.join(ROOT, 'sources', 'v3', 'affordable-housing.json');
    const affData = JSON.parse(fs.readFileSync(affPath, 'utf8'));
    const phaseRes = updateAffordablePhases(affData, today);
    let noticeRes = { discoveries: [], errors: [] };
    if (!skipNetwork) {
      noticeRes = await checkHousingNotices(affData);
    }
    if (phaseRes.changed) {
      summary.anyDataChanged = true;
      if (!dryRun) {
        fs.writeFileSync(affPath, JSON.stringify(affData, null, 2) + '\n', 'utf8');
      }
    }
    summary.affordable = {
      transitioned: phaseRes.transitioned,
      discoveries: noticeRes.discoveries,
      errors: noticeRes.errors,
    };
  }

  // 2. 各区月度租金行情
  if (doDistricts && !skipNetwork) {
    const basePath = path.join(ROOT, 'data', 'base.json');
    const baseData = JSON.parse(fs.readFileSync(basePath, 'utf8'));
    try {
      const report = await fetchLatestCrepriceReport();
      const applyRes = applyCrepriceToBase(baseData, report, today);
      if (applyRes.changed) {
        summary.anyDataChanged = true;
        if (!dryRun) {
          fs.writeFileSync(basePath, JSON.stringify(baseData, null, 2) + '\n', 'utf8');
        }
        summary.districts = { status: `已更新至 ${report.month}（${applyRes.updatedDistricts}/10 区，来源 ${report.url}）` };
      } else {
        summary.districts = { status: `未改动：${applyRes.skippedReason}` };
      }
    } catch (err) {
      summary.districts = { status: `拉取校验未通过，保留旧快照（${err.message}）` };
    }
  } else if (doDistricts) {
    summary.districts = { status: '已跳过（--offline 模式）' };
  }

  // 3. 58 商圈趋势
  if (doMarkets && !skipNetwork) {
    const finePath = path.join(ROOT, 'data', 'fine.json');
    const fineData = JSON.parse(fs.readFileSync(finePath, 'utf8'));
    const limitArg = process.argv.find(a => a.startsWith('--markets-limit='));
    const limit = limitArg ? Math.max(1, Number(limitArg.split('=')[1]) || 15) : 15;
    const mRes = await update58Markets(fineData, { limit });
    if (mRes.changed) {
      summary.anyDataChanged = true;
      if (!dryRun) {
        fs.writeFileSync(finePath, JSON.stringify(fineData) + '\n', 'utf8');
      }
    }
    summary.markets = mRes;
  }

  // 4. OSM 设施同步
  if (doOsm && !skipNetwork && !dryRun) {
    summary.osm = runOsmSync();
  }

  const reportMd = buildMarkdownReport(summary);
  fs.writeFileSync(path.join(ROOT, 'update-report.md'), reportMd, 'utf8');
  console.log(reportMd);
}

if (require.main === module) {
  main().catch(err => {
    console.error('[update_data] unexpected error:', err);
    process.exit(1);
  });
}

module.exports = {
  extractAffordableDeadline,
  updateAffordablePhases,
  parseCrepriceDistrictTable,
  applyCrepriceToBase,
  parse58MarketTrend,
  extractHousingNotices,
  buildMarkdownReport,
};
