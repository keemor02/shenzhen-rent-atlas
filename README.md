# 深圳租房地图

在一张地图上选择工作地和预算，探索可通勤的街区、城中村和小区。地图可缩放、拖动，用颜色显示租金、通勤或当前主题的数值。

## 地图怎么用

- 从「片区月租」开始。点街道看具体住处，或直接选「同比」「环比」看同户型的涨跌样本。在西乡继续放大，可看西乡、坪洲、固戍三个站点参考区和住宅轮廓。
- 放大到地块能容纳标注时，名称和主指标下面会出现事件、走势线索与政策标记。点标记看时间、适用范围和原文。街道里的同名商圈样本会保留商圈口径。
- 「租金行情」切换住房类型和区级指标，「人口密度」看行政区统计。「片区事件」可以从迁出地点追到迁入地点，再在选定位置找房。
- 「生活便利」按公开名录和地址展示设施，可以选择菜市场、超市、医疗、公园或药店。「环境」提供可定位的公园和公共环境事件。工作地、住房条件和已收藏的地点随探索保留。
- 设定工作地后，点「发现下一处」查看候选相较预算和通勤上限的余量。点「收藏」后可用「只看收藏」再次找到它。玩法和验收要点见 [玩法与开发路线](PRODUCT.md)。

## 打开项目

将压缩包内容解压到已建的「深圳租房地图」项目文件夹。在 Windows 上双击 `开始审查.html`，确认显示的是该文件夹，点「打开 Codex 审查对话」后发送预填指令。也可直接在 Codex 打开包含本文件和 `AGENTS.md` 的目录。已安装 Codex CLI 时，也可在该目录运行 `codex`。新对话可以从「读取 AGENTS.md 和 README.md，继续开发这张深圳租房地图」开始。

双击根目录的 `index.html` 即可使用离线版。收藏和探索设置保存在当前浏览器。同一浏览器和地址可沿用旧版收藏、现场评价及手动补充的租金记录。更换浏览器、文件路径或本机服务地址可能使用不同的存储空间。

## 本地开发

命令在项目根目录执行。构建和可选的联网启动器使用 Python 3。模型测试和重建街道数据使用 Node.js（已用 Python 3.12、Node.js 24 验证）。离线地图本身只需浏览器。

| 操作 | 命令 |
| --- | --- |
| 修改源码后生成单文件地图 | `node tools/build.cjs`（或 `python tools/build.py`） |
| 检查成品是否与源码一致 | `node tools/build.cjs --check`（或 `python tools/build.py --check`） |
| 运行地图模型和界面逻辑测试 | `node --test` |
| 检验联网数据解析及错误回退 | `python -m unittest discover -s tests -p "test_*.py"` |
| 从收录的街道资料重新生成细分数据 | `node tools/rebuild_fine.cjs` |
| 打开支持本机联网更新的地图 | `python launcher.py index.html` |

Windows 也可用 `py -3` 代替 `python`。启动器默认通过 `http://127.0.0.1:8765/` 提供地图，按 Ctrl+C 停止。普通租金核验读取公开月报。在本机设置高德 Web 服务密钥环境变量 `AMAP_WEB_KEY` 后，可在驾车卡片查询当前路线耗时。租金来源要求验证或暂时不可用时，保留已核验的快照。地图也提供直接前往高德复核路线的链接。

## 修改入口

| 想改什么 | 从哪里开始 |
| --- | --- |
| 首页、筛选、主题联动与地点卡 | `src/game.html`、`src/game.js`、`src/main.js` |
| 地图缩放、分级标注、住宅轮廓和时间圈 | `src/map-camera.js`、`src/block-map.js`、`src/orbit.js` |
| 区级租金和人口、片区事件、生活设施 | `src/map-themes.js`、`src/regional-layers.js`、`src/market-events.js`、`src/facilities.js` |
| 片区涨跌、事件判断与政策适用范围 | `src/area-insights.js`、`data/policies.json` |
| 四维评分、发现理由和收藏 | `src/fit.js`、`src/fit-view.js`、`src/journal.js` |
| 住房样本、可达范围与路线估算 | `src/explore-model.js`、`src/rail.js`、`src/bus.js` |
| 行政街道、站点参考区、住宅范围与公开事件 | `sources/fine/`、`data/fine.json`、`src/world.js` |
| 联网数据与离线构建 | `launcher.py`、`src/index.template.html`、`tools/build.py` |

## 本次交接时的数据

租金与交通快照截至 2026-11-23。地图覆盖深圳 74 个街道、81 个代表片区和 382 个通勤参照点。各指标拥有各自的统计期。地图提供了不同详细程度的数据，新安和西丽的项目与房型样本较多。

- `data/base.json` 收录分区租金、人口密度、路网、线路、产业与住房事件及链接。人口密度按分区展示。
- 西部 17 个住宅范围来自 2026-11-24 的 OpenStreetMap，具名地块保留原始 way 编号。三个站点参考区按 1.8 公里内最近的站点划分，并裁剪至西乡街道。区域内缺少的租金在地图上标为待核。[OpenStreetMap 署名与许可](https://www.openstreetmap.org/copyright)
- `data/fine.json` 汇总街道边界、商圈月报和项目样本。编辑对应输入后运行细分数据重建命令，再重新生成 HTML。
- `data/journey.json` 包含静态驾车矩阵、公交站序、接驳与定位信息，以及来源和授权标注。`data/timing.json` 保存分线地铁时长、换乘假设和出处。两者是可独立替换的已核验快照。常规构建可完全离线。
- `src/world.js` 收录 7 条公共环境或运行事件。图例按施工、工业气味、轨道噪声、航空噪声、枢纽客流和生活噪声筛选。每条保留日期、处理结果、来源、位置参照和踩点建议。

- `data/facilities.json` 收录具名设施和可追溯地址。[设施资料与覆盖范围](sources/livability.md)
- `data/policies.json` 收录与项目区域或深圳租户有关的政策、配租公告和适用条件。[政策原文和空间口径](sources/policies-sources.md)

### 浏览器验收

在 `tools/browser` 目录运行 `npm install`。用 `npm run check:exploration` 检查离线成品的状态恢复、指标切换、来源与评分；用 `npx playwright install chromium`、`npm run check` 在桌面和手机尺寸核对手势、区块、事件跳转、设施与收藏。已有 Chromium 时，可设置环境变量 `ATLAS_CHROMIUM_PATH` 指向其可执行文件。早期版本的审查记录见 REVIEW.md 和 AUDIT.md。
