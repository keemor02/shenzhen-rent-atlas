#!/usr/bin/env node
'use strict';

// 新版消费级 UI 单文件离线打包器：复用 build.cjs 核心逻辑打包为独立 next.html
const path = require('node:path');
const { buildSingle } = require('./build.cjs');

const ROOT = path.resolve(__dirname, '..');
buildSingle({
  template: path.join(ROOT, 'app', 'next', 'template.html'),
  output: path.join(ROOT, 'next.html'),
  checkCmd: 'node tools/build_next.cjs',
  check: process.argv.includes('--check'),
});
