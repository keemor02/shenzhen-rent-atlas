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

const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#1e293b"/>
    </linearGradient>
    <linearGradient id="land" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#38bdf8"/>
      <stop offset="100%" stop-color="#10b981"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#bg)"/>
  <path d="M84 316 C128 242, 186 218, 252 214 C318 210, 384 182, 430 144 L440 248 C394 294, 344 336, 266 352 C196 366, 134 362, 84 316 Z" fill="url(#land)" opacity="0.28"/>
  <path d="M98 308 L178 238 L254 258 L334 196 L418 214" fill="none" stroke="#38bdf8" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="178" cy="238" r="14" fill="#e0f2fe"/>
  <circle cx="334" cy="196" r="14" fill="#e0f2fe"/>
  <circle cx="254" cy="258" r="30" fill="#f59e0b"/>
  <circle cx="254" cy="258" r="13" fill="#0f172a"/>
  <text x="256" y="434" text-anchor="middle" font-family="system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif" font-size="60" font-weight="700" fill="#f8fafc">深圳租房</text>
</svg>
`;

function buildManifest() {
  return JSON.stringify({
    name: '深圳租房板块探索地图',
    short_name: '深圳租房地图',
    description: '全深圳 98 块居住板块拼图、通勤时间圈、分形态租金与官方保租房探索地图',
    start_url: './',
    scope: './',
    display: 'standalone',
    orientation: 'any',
    background_color: '#0f172a',
    theme_color: '#0f172a',
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
`;
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

  const pwaHead = [
    '<meta name="theme-color" content="#0f172a">',
    '<meta name="apple-mobile-web-app-capable" content="yes">',
    '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
    '<meta name="apple-mobile-web-app-title" content="深圳租房地图">',
    '<link rel="manifest" href="./manifest.webmanifest">',
    '<link rel="icon" type="image/svg+xml" href="./icon.svg">',
  ].join('\n');

  if (!out.includes('rel="manifest"')) {
    out = out.replace('</head>', `${pwaHead}\n</head>`);
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
  const webHtml = enhanceHtmlForWeb(rawHtml);
  const manifest = buildManifest();
  const sw = buildServiceWorker(versionHash);
  const headers = buildHeadersFile();
  const meta = collectMeta(webHtml, versionHash);

  const files = {
    'index.html': webHtml,
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
