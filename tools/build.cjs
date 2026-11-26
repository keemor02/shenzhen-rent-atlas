#!/usr/bin/env node
'use strict';

// V6 单文件离线打包器：将 app/ 前端 + 简化预裁剪 atlas-v3.json + gzip 懒加载交通矩阵打包为极轻离线 index.html
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.resolve(__dirname, '..');
const TEMPLATE = path.join(ROOT, 'app', 'next', 'template.html');
const OUTPUT = path.join(ROOT, 'index.html');
const PLACEHOLDER = /\{\{([A-Za-z0-9_./-]+)\}\}/g;

function packMatrixBuf(matrix) {
  const bytes = [];
  for (const row of matrix) {
    let prev = 0;
    for (const val of row) {
      const delta = val - prev;
      prev = val;
      let z = delta < 0 ? ((-delta) << 1) - 1 : (delta << 1);
      while (z >= 128) { bytes.push((z & 127) | 128); z >>>= 7; }
      bytes.push(z);
    }
  }
  return Buffer.from(bytes);
}

function packMatrix(matrix) {
  return packMatrixBuf(matrix).toString('base64');
}

function gzipBase64(buf) {
  return zlib.gzipSync(buf, { level: 9 }).toString('base64');
}

function inlinePayload(rel) {
  let content = fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
  if (rel.endsWith('.json')) {
    const parsed = JSON.parse(content);
    if (rel === 'data/atlas-v3.json' && Array.isArray(parsed.plates)) {
      // 公开消费版打包剥离品牌公寓商业报价与商业平台来源，符合 DESIGN.md 合规红线并进一步减重
      for (const pl of parsed.plates) delete pl.multiSourceRents;
    }
    if (rel === 'data/journey.json') {
      if (parsed.driving?.durations && parsed.driving?.distances) {
        parsed.driving = {
          ...parsed.driving,
          packed: {
            n: parsed.driving.durations.length,
            gz: true,
            durations: gzipBase64(packMatrixBuf(parsed.driving.durations)),
            distances: gzipBase64(packMatrixBuf(parsed.driving.distances)),
          },
        };
        delete parsed.driving.durations;
        delete parsed.driving.distances;
      }
      if (parsed.bus && parsed.bus.stops) {
        parsed.bus = { gz: gzipBase64(Buffer.from(JSON.stringify(parsed.bus), 'utf8')) };
      }
    }
    content = JSON.stringify(parsed).replace(/</g, '\\u003c');
  } else {
    content = content.replace(/\n+$/, '');
  }
  return content;
}

function assemble() {
  const tpl = fs.readFileSync(TEMPLATE, 'utf8').replace(/\r\n/g, '\n');
  return tpl.replace(PLACEHOLDER, (_, rel) => inlinePayload(rel));
}

function buildSingle({ template, output, checkCmd, check = false }) {
  const tpl = fs.readFileSync(template, 'utf8').replace(/\r\n/g, '\n');
  const built = tpl.replace(PLACEHOLDER, (_, rel) => inlinePayload(rel));
  const outName = path.basename(output);
  if (check) {
    const current = fs.existsSync(output) ? fs.readFileSync(output, 'utf8').replace(/\r\n/g, '\n') : '';
    if (current !== built) {
      console.error(`${outName} 与源码或数据不一致，请运行 ${checkCmd}`);
      process.exit(1);
    }
    console.log(`OK ${outName}`);
    return;
  }
  fs.writeFileSync(output, built, 'utf8');
  console.log(`${outName} · ${Buffer.byteLength(built, 'utf8').toLocaleString('en-US')} bytes`);
}

function main() {
  const check = process.argv.includes('--check');
  buildSingle({ template: TEMPLATE, output: OUTPUT, checkCmd: 'node tools/build.cjs', check });
}

if (require.main === module) main();
module.exports = { packMatrix, inlinePayload, assemble, buildSingle };
