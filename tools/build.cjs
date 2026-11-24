#!/usr/bin/env node
'use strict';

// 从项目内的模板、模块与快照构建单文件地图。仅使用 Node.js 标准库，与 tools/build.py 输出逐字节一致。
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const TEMPLATE = path.join(ROOT, 'src', 'index.template.html');
const TOKEN = /\{\{(json:launcher\.py|(?:src|data)\/[\w.-]+)\}\}/g;

function readText(filePath) {
  // Match Python Path.read_text(encoding="utf-8") universal-newline normalization.
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
      drv.durations.length === drv.distances.length &&
      drv.durations.every(r => Array.isArray(r) && r.length === drv.durations.length && r.every(Number.isInteger)) &&
      drv.distances.every(r => Array.isArray(r) && r.length === drv.distances.length && r.every(Number.isInteger))) {
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

function renderTemplate(filePath, parents = []) {
  if (parents.includes(filePath)) {
    throw new Error(`模板发生循环引用 ${path.basename(filePath)}`);
  }
  const source = readText(filePath);
  return source.replace(TOKEN, (_, name) => {
    if (name === 'json:launcher.py') {
      return JSON.stringify(readText(path.join(ROOT, 'launcher.py'))).replace(/</g, '\\u003c');
    }
    const part = path.join(ROOT, name);
    const ext = path.extname(part).toLowerCase();
    if (ext === '.html') {
      return renderTemplate(part, [...parents, filePath]);
    }
    const payload = readText(part);
    if (ext === '.json') {
      if (name === 'data/journey.json') {
        return packJourneyJson(payload).replace(/</g, '\\u003c');
      }
      JSON.parse(payload);
      return payload.trim().replace(/</g, '\\u003c');
    }
    if (ext === '.js' && payload.toLowerCase().includes('</script')) {
      throw new Error(`${name} 含有会提前闭合脚本的 HTML 标签`);
    }
    return payload;
  });
}

function parseArgs(argv) {
  let check = false;
  let output = path.join(ROOT, 'index.html');
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--check') {
      check = true;
    } else if (arg === '--output') {
      if (i + 1 >= argv.length) throw new Error('--output 需要指定路径');
      output = path.resolve(argv[++i]);
    } else if (arg === '-h' || arg === '--help') {
      console.log('Usage: node tools/build.cjs [--check] [--output <path>]');
      process.exit(0);
    } else {
      throw new Error(`未知参数: ${arg}`);
    }
  }
  return { check, output };
}

function main() {
  const { check, output } = parseArgs(process.argv.slice(2));
  const packed = Buffer.from(renderTemplate(TEMPLATE), 'utf8');
  if (check) {
    if (!fs.existsSync(output) || !fs.readFileSync(output).equals(packed)) {
      process.stderr.write('成品与源码不同，请运行 node tools/build.cjs。\n');
      process.exit(1);
    }
    console.log(`OK ${path.basename(output)}`);
    return;
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const tempPath = `${output}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tempPath, packed);
    fs.renameSync(tempPath, output);
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
  console.log(`${path.basename(output)} · ${packed.length.toLocaleString('en-US')} bytes`);
}

if (require.main === module) {
  main();
}
module.exports = { renderTemplate };
