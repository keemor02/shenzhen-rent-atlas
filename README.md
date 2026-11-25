# 深圳租房板块探索地图

单文件可离线运行的深圳租房探索工具，直接双击根目录 [index.html](index.html) 即可在浏览器中使用。

## 核心设计

- **全城 98 块无缝居住板块拼图**：将深圳 15 个大街道按真实站区无缝切分，融入 9 座山体、5 座水库、机场与 16 条淡色地铁主干网，点击整块拼图探索。
- **两级租金展示**：地图概览统一按 **每平米参考均价（元/㎡·月）** 着色（跨户型公平对比、零空白）；点开板块抽屉再展开城中村 / 老小区 / 电梯小区 / 官方保租房的具体整套月租与小区/村落明细。
- **500+ 任意目的地通勤**：搜索或点击地图上的固定地标、知名商圈、351 个地铁站、30 个公交枢纽、居住板块或核验设施，一键设为目的地并支持 10 分钟时间圈与第二目的地。
- **议价雷达与非必要溢价**：地图直接画出 10 大园区 15 分钟步行光圈与办公外迁走廊；同程贵于圈外板块时以暖红标 `↑贵¥X` 警示，并支持一键标记「我常去这个园区」。
- **看房清单与兼容备份**：收藏与实地踩点记录保存在本机浏览器（自动兼容 `shenzhen-rent-atlas.journal.v1` 历史手记），支持随时导出/导入 JSON 备份。

## 目录结构（修改入口）

- `app/`：全部前端源码（`template.html`、`app.css`、`store.js`、`engine.js`、`map.js`、`ui.js`、`rail.js`、`bus.js`、`map-camera.js`）
- `sources/v3/`：板块切分定义（`plates.json`）、山体水库与固定地标（`geography.json`）、公开避坑事件（`public-events.json`）
- `sources/v2/`：核心走廊分形态租金与保租房样本（`corridor-rents.json`）、补充核验设施（`facilities-extra.json`）
- `tools/`：构建脚本
  - `node tools/build_data.cjs`：合并原始输入，生成 `data/atlas-v3.json`
  - `node tools/build.cjs`：打包生成离线单文件 `index.html`
  - `node tools/build.cjs --check`：校验 `index.html` 与源码是否一致
  - `node --test`：运行全部自动化测试
