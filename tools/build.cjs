#!/usr/bin/env node
'use strict';

// V3 单文件离线打包器：将 app/ 前端 + 压缩后的 data/atlas-v3.json + 交通矩阵打包为独立 index.html
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const TEMPLATE = path.join(ROOT, 'app', 'template.html');
const OUTPUT = path.join(ROOT, 'index.html');
const PLACEHOLDER = /\{\{([A-Za-z0-9_./-]+)\}\}/g;

function packMatrix(matrix) {
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
  return Buffer.from(bytes).toString('base64');
}

function inlinePayload(rel) {
  let content = fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
  if (rel.endsWith('.json')) {
    const parsed = JSON.parse(content);
    if (rel === 'data/journey.json' && parsed.driving?.durations && parsed.driving?.distances) {
      parsed.driving = {
        ...parsed.driving,
        packed: {
          n: parsed.driving.durations.length,
          durations: packMatrix(parsed.driving.durations),
          distances: packMatrix(parsed.driving.distances),
        },
      };
      delete parsed.driving.durations;
      delete parsed.driving.distances;
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

function main() {
  const check = process.argv.includes('--check');
  const built = assemble();
  if (check) {
    const current = fs.existsSync(OUTPUT) ? fs.readFileSync(OUTPUT, 'utf8').replace(/\r\n/g, '\n') : '';
    if (current !== built) {
      console.error('index.html 与 app/ 或 data/atlas-v3.json 不一致，请运行 node tools/build.cjs');
      process.exit(1);
    }
    console.log('OK index.html');
    return;
  }
  fs.writeFileSync(OUTPUT, built, 'utf8');
  console.log(`index.html · ${Buffer.byteLength(built, 'utf8').toLocaleString('en-US')} bytes`);
}

main();
