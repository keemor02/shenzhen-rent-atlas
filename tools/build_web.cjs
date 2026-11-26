#!/usr/bin/env node
'use strict';

// 纯净线上发布产物构建器：
// 基于已校验的根目录离线单文件 index.html，输出独立可部署的 dist/ 目录，
// 零侵入增加手机 PWA（「添加到主屏幕」+ 地铁断网离线兜底）与静态平台缓存头，
// 不对外暴露仓库源码、构建脚本或配置文档。
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.resolve(__dirname, '..');
const SOURCE_HTML = path.join(ROOT, 'index.html');
const DIST_DIR = path.join(ROOT, 'dist');
const ICON_PATH = path.join(ROOT, 'icon.svg');

const ICON_SVG = fs.readFileSync(ICON_PATH, 'utf8').replace(/\r\n/g, '\n');

function buildManifest() {
  return JSON.stringify({
    name: '租房地图 · 深圳',
    short_name: '租房地图',
    description: '全深圳 117 片区探索地图、早高峰通勤估时、个性推荐分与一房一卡看房 PK',
    start_url: './',
    scope: './',
    display: 'standalone',
    orientation: 'any',
    background_color: '#ebe0c5',
    theme_color: '#ebe0c5',
    lang: 'zh-CN',
    icons: [
      {
        src: './icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any maskable',
      },
    ],
  }, null, 2) + '\n';
}

function buildServiceWorker(versionHash) {
  return `/* Shenzhen Rent Atlas PWA Service Worker (auto-generated) */
const CACHE_NAME = 'sz-rent-atlas-${versionHash}';
const PRECACHE_URLS = ['./', './index.html', './manifest.webmanifest', './icon.svg'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const isDocOrMeta = req.mode === 'navigate'
    || url.pathname.endsWith('/')
    || url.pathname.endsWith('.html')
    || url.pathname.endsWith('/meta.json');

  if (isDocOrMeta) {
    event.respondWith(
      fetch(req)
        .then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req).then(hit => hit || caches.match('./index.html') || caches.match('./')))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(cached => {
      const fresh = fetch(req).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => cached);
      return cached || fresh;
    })
  );
});
`;
}

function buildHeadersFile() {
  return `# Static host caching & security headers (EdgeOne Pages / Cloudflare Pages / Netlify)
/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: SAMEORIGIN
  Referrer-Policy: no-referrer

/
  Cache-Control: public, max-age=0, must-revalidate

/index.html
  Cache-Control: public, max-age=0, must-revalidate

/sw.js
  Cache-Control: public, max-age=0, must-revalidate

/meta.json
  Cache-Control: public, max-age=0, must-revalidate

/icon.svg
  Cache-Control: public, max-age=86400

/manifest.webmanifest
  Cache-Control: public, max-age=86400

/chunk-bus.json
  Cache-Control: public, max-age=86400

/chunk-drive.json
  Cache-Control: public, max-age=86400
`;
}

// 线上 PWA 拆包：将公交全网与驾车矩阵拆分为同源懒加载块（点「公交/驾车」时才按需拉取并进 SW 缓存），首屏体积骤降 75%！
function extractWebChunks(webHtml) {
  const marker = '<script type="application/json" id="journey-data">';
  const start = webHtml.indexOf(marker);
  if (start < 0) return { html: webHtml, chunks: {} };
  const bodyStart = start + marker.length;
  const end = webHtml.indexOf('</script>', bodyStart);
  if (end < 0) return { html: webHtml, chunks: {} };

  const journey = JSON.parse(webHtml.slice(bodyStart, end));
  const chunks = {};
  if (journey.bus?.gz) {
    chunks['chunk-bus.json'] = zlib.gunzipSync(Buffer.from(journey.bus.gz, 'base64')).toString('utf8');
    journey.bus = { chunk: './chunk-bus.json' };
  }
  if (journey.driving?.packed?.gz) {
    const rawDur = zlib.gunzipSync(Buffer.from(journey.driving.packed.durations, 'base64')).toString('base64');
    const rawDist = zlib.gunzipSync(Buffer.from(journey.driving.packed.distances, 'base64')).toString('base64');
    const driveObj = {
      ...journey.driving,
      packed: { n: journey.driving.packed.n, durations: rawDur, distances: rawDist },
    };
    chunks['chunk-drive.json'] = JSON.stringify(driveObj);
    journey.driving = { chunk: './chunk-drive.json' };
  }
  if (!Object.keys(chunks).length) return { html: webHtml, chunks };
  const slimJourney = JSON.stringify(journey).replace(/</g, '\\u003c');
  const html = webHtml.slice(0, bodyStart) + slimJourney + webHtml.slice(end);
  return { html, chunks };
}

function enhanceHtmlForWeb(rawHtml) {
  let out = rawHtml.replace(/\r\n/g, '\n');

  // Extend CSP strictly for same-origin PWA manifest, icon, and Service Worker (zero third-party origins)
  out = out.replace(
    /(<meta http-equiv="Content-Security-Policy" content=")([^"]+)(")/,
    (_, prefix, policy, suffix) => {
      let next = policy;
      next = next.replace(/img-src\s+data:;/, "img-src data: 'self';");
      if (!/worker-src/.test(next)) next += "; worker-src 'self'";
      if (!/manifest-src/.test(next)) next += "; manifest-src 'self'";
      return prefix + next + suffix;
    }
  );

  const pwaLines = [];
  if (!/name="theme-color"/i.test(out)) pwaLines.push('<meta name="theme-color" content="#ebe0c5">');
  if (!/name="apple-mobile-web-app-capable"/i.test(out)) pwaLines.push('<meta name="apple-mobile-web-app-capable" content="yes">');
  if (!/name="apple-mobile-web-app-status-bar-style"/i.test(out)) pwaLines.push('<meta name="apple-mobile-web-app-status-bar-style" content="default">');
  if (!/name="apple-mobile-web-app-title"/i.test(out)) pwaLines.push('<meta name="apple-mobile-web-app-title" content="租房地图">');
  if (!out.includes('rel="manifest"')) pwaLines.push('<link rel="manifest" href="./manifest.webmanifest">');
  if (!out.includes('rel="icon"')) pwaLines.push('<link rel="icon" type="image/svg+xml" href="./icon.svg">');

  if (pwaLines.length) {
    out = out.replace('</head>', `${pwaLines.join('\n')}\n</head>`);
  }

  const swBoot = `<script>
(function(){
  if (!('serviceWorker' in navigator)) return;
  var p = location.protocol;
  if (p !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
  window.addEventListener('load', function(){
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(function(){});
  });
})();
</script>`;

  if (!out.includes("navigator.serviceWorker.register('./sw.js'")) {
    out = out.replace('</body>', `${swBoot}\n</body>`);
  }

  return out;
}

function readOptionalJson(rel) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return null;
  try {
    return JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch {
    return null;
  }
}

function collectMeta(webHtml, versionHash) {
  const atlas = readOptionalJson('data/atlas-v3.json');
  const base = readOptionalJson('data/base.json');
  const aff = readOptionalJson('sources/v3/affordable-housing.json');
  const buf = Buffer.from(webHtml, 'utf8');
  const gz = zlib.gzipSync(buf, { level: 9 });
  const projects = aff?.projects || atlas?.affordableProjects || [];
  return {
    name: 'shenzhen-rent-atlas',
    version: versionHash,
    builtAt: new Date(Date.now() + 8 * 3600000).toISOString().replace('Z', '+08:00'),
    dataAsOf: aff?.asOf || atlas?.asOf || null,
    listingMonth: base?.listingMonth || '2026-10',
    plateCount: atlas?.plates?.length || 0,
    affordableTotalCount: projects.length,
    affordableActiveCount: projects.filter(p => p.phase === 'active').length,
    rawBytes: buf.length,
    gzipBytes: gz.length,
  };
}

function buildWeb({ sourceHtmlPath = SOURCE_HTML, outDir = DIST_DIR, check = false } = {}) {
  if (!fs.existsSync(sourceHtmlPath)) {
    throw new Error(`找不到 ${sourceHtmlPath}，请先运行 npm run build`);
  }
  const rawHtml = fs.readFileSync(sourceHtmlPath, 'utf8');
  const versionHash = crypto.createHash('sha256').update(rawHtml).digest('hex').slice(0, 10);
  const { html: webHtml, chunks } = extractWebChunks(enhanceHtmlForWeb(rawHtml));
  const manifest = buildManifest();
  const sw = buildServiceWorker(versionHash);
  const headers = buildHeadersFile();
  const meta = collectMeta(webHtml, versionHash);

  const files = {
    'index.html': webHtml,
    ...chunks,
    'manifest.webmanifest': manifest,
    'icon.svg': ICON_SVG,
    'sw.js': sw,
    '_headers': headers,
    '.nojekyll': '',
    'meta.json': JSON.stringify(meta, null, 2) + '\n',
  };

  if (check) {
    for (const [name, expected] of Object.entries(files)) {
      if (name === 'meta.json') {
        const fp = path.join(outDir, name);
        if (!fs.existsSync(fp)) throw new Error(`dist/${name} 缺失，请运行 npm run build:web`);
        const currentMeta = JSON.parse(fs.readFileSync(fp, 'utf8'));
        if (currentMeta.version !== versionHash) {
          throw new Error(`dist/ 版本 (${currentMeta.version}) 与当前 index.html (${versionHash}) 不一致，请运行 npm run build:web`);
        }
        continue;
      }
      const fp = path.join(outDir, name);
      if (!fs.existsSync(fp)) throw new Error(`dist/${name} 缺失，请运行 npm run build:web`);
      const actual = fs.readFileSync(fp, 'utf8').replace(/\r\n/g, '\n');
      if (actual !== expected.replace(/\r\n/g, '\n')) {
        throw new Error(`dist/${name} 与当前源码不一致，请运行 npm run build:web`);
      }
    }
    return { versionHash, meta, outDir };
  }

  fs.mkdirSync(outDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(outDir, name), content, 'utf8');
  }
  return { versionHash, meta, outDir };
}

if (require.main === module) {
  const check = process.argv.includes('--check');
  try {
    const res = buildWeb({ check });
    if (check) {
      console.log(`OK dist/ (${res.versionHash})`);
    } else {
      console.log(
        `dist/ ready · v=${res.versionHash} · index.html=${res.meta.rawBytes.toLocaleString('en-US')} B (gzip ${res.meta.gzipBytes.toLocaleString('en-US')} B)`
      );
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

module.exports = {
  ICON_SVG,
  buildManifest,
  buildServiceWorker,
  buildHeadersFile,
  enhanceHtmlForWeb,
  buildWeb,
};
