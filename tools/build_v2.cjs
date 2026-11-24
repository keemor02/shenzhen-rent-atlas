#!/usr/bin/env node
'use strict';

// V2 单文件离线构建脚本（零外部依赖，支持 --check 与无损驾车矩阵压缩）。
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const TEMPLATE = path.join(ROOT, 'v2', 'template.html');
const TOKEN = /\{\{((?:v2|src|data)\/[\w.-]+)\}\}/g;

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8').replace(/\r\n?/g, '\n');
}

function packIntMatrix(matrix) {
  const bytes = [];
  for (const row of matrix) {
    let prev = 0;
    for (const val of row) {
      const diff = val - prev;
      prev = val;
      let z = diff >= 0 ? diff * 2 : (-diff) * 2 - 1;
      while (z >= 128) {
        bytes.push((z & 127) | 128);
        z >>>= 7;
      }
      bytes.push(z);
    }
  }
  return Buffer.from(bytes).toString('base64');
}

function packJourneyJson(payload) {
  const obj = JSON.parse(payload);
  const drv = obj?.driving;
  if (drv && Array.isArray(drv.durations) && Array.isArray(drv.distances) && drv.durations.length > 0 &&
      drv.durations.length === drv.distances.length) {
    drv.packed = {
      n: drv.durations.length,
      durations: packIntMatrix(drv.durations),
      distances: packIntMatrix(drv.distances),
    };
    delete drv.durations;
    delete drv.distances;
    return JSON.stringify(obj);
  }
  return payload.trim();
}

function renderV2() {
  return readText(TEMPLATE).replace(TOKEN, (_, rel) => {
    const full = path.join(ROOT, rel);
    const ext = path.extname(full).toLowerCase();
    const raw = readText(full);
    if (ext === '.json') {
      if (rel === 'data/journey.json') return packJourneyJson(raw).replace(/</g, '\\u003c');
      JSON.parse(raw);
      return raw.trim().replace(/</g, '\\u003c');
    }
    if (ext === '.js' && raw.toLowerCase().includes('</script')) {
      throw new Error(`${rel} 含有提前闭合脚本标签`);
    }
    return raw;
  });
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const outIdx = args.indexOf('--output');
  const output = outIdx >= 0 ? path.resolve(args[outIdx + 1]) : path.join(ROOT, 'index.html');
  const packed = Buffer.from(renderV2(), 'utf8');

  if (check) {
    if (!fs.existsSync(output) || !fs.readFileSync(output).equals(packed)) {
      process.stderr.write('V2 成品与源码不同，请运行 npm run build。\n');
      process.exit(1);
    }
    console.log(`OK ${path.basename(output)} (V2)`);
    return;
  }

  fs.mkdirSync(path.dirname(output), { recursive: true });
  const tmp = `${output}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, packed);
    fs.renameSync(tmp, output);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  console.log(`${path.basename(output)} (V2) · ${packed.length.toLocaleString('en-US')} bytes`);
}

if (require.main === module) main();
module.exports = { renderV2 };
