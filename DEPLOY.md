# 深圳租房地图 · 零元全自动上线操作清单

本项目已完成全部线上打包、手机 PWA 离线缓存与免费云端定时更新配置。你只需按下面步骤点几下鼠标，即可 **¥0 成本** 上线并自动保持数据更新。

---

## 一、推荐上线方案（二选一，全程免费）

### 方案 A（强烈推荐）：GitHub 私有仓库 ＋ 腾讯云 EdgeOne Pages 免费版
> 优点：**代码私密不公开**、**深圳手机打开秒开**、**数据更新后自动重新部署**、**全程 ¥0**。

1. **建 GitHub 仓库（2 分钟）**
   - 登录 [github.com](https://github.com/) → 右上角 `+` → **New repository**。
   - 仓库名填如 `shenzhen-rent-atlas`，选 **Private（私有）**，不要勾选 README/gitignore，点 **Create repository**。
2. **把本地代码推上去（1 分钟）**
   - 在项目根目录终端运行（把 `<你的仓库地址>` 换成刚建好的 `https://github.com/你的用户名/shenzhen-rent-atlas.git`）：
     ```powershell
     git remote add origin <你的仓库地址>
     git push -u origin HEAD:main
     ```
   - 第一次推送会弹出 GitHub 浏览器授权登录，点允许即可。
3. **绑定腾讯云 EdgeOne Pages（3 分钟）**
   - 打开腾讯云 **EdgeOne Pages** 控制台（微信扫码即可免费使用）。
   - 点「新建项目」→「导入 Git 仓库」→ 授权并选择 `shenzhen-rent-atlas`。
   - 填写以下两行构建配置，其余保持默认：
     - **构建命令 (Build Command)**：`npm run build && npm run build:web`
     - **输出目录 (Output Directory)**：`dist`
   - 点「开始部署」，等约 30 秒拿到免费的 `https://...` 访问链接即可使用！
4. **（可选）避免 GitHub Pages 报错提示**
   - 如果你选了私有仓库 + EdgeOne Pages（不使用 GitHub Pages），在 GitHub 仓库进入 **Settings → Secrets and variables → Actions → Variables → New repository variable**，新增：
     - Name：`DISABLE_GH_PAGES`
     - Value：`true`

---

### 方案 B（最简零额外注册）：GitHub 公开仓库 ＋ GitHub Pages
> 优点：**只需一个 GitHub 账号**；缺点：代码公开，国内手机偶发访问稍慢。

1. 在 GitHub 新建 **Public（公开）** 仓库，按上面第 2 步推送代码到 `main` 分支。
2. 打开仓库的 **Settings → Pages**：
   - **Build and deployment → Source** 选择 **GitHub Actions**。
3. 切到仓库顶部 **Actions** 标签页，点开 **Build & Deploy Web** → 点一次 **Run workflow**，约 40 秒后即可看到生成的 `https://你的用户名.github.io/仓库名/` 网址。

---

## 二、手机看房最佳用法 & 老手记迁移

- **手机桌面全屏 + 地铁断网可用（PWA）**：用手机 Safari / Chrome 打开上线后的 `https://` 网址 → 点浏览器菜单 **「添加到主屏幕」**。平时有网自动拉最新版本，进地铁无信号时也能直接秒开地图。
- **迁移以前记过的看房笔记**：如果之前在电脑双击本地 `index.html` 收藏过地点，先在旧页面点「★ 看房清单 → 导出备份」，再打开新上线网址「导入备份」即可无损合并。

---

## 三、全自动定时任务如何工作（部署完不用管）

仓库已内置两条免费云端机器人（见 `.github/workflows/`）：

- **每周一 09:00（北京时间）**：自动检查 `sources/v3/affordable-housing.json` 中的保租房截止日期，过期自动从「受理中」流转为「已截止·盯下批」；同时巡检深圳市/南山区/宝安区住建局官网，发现未收录的新保租房配租通告自动发一条 **GitHub Issue** 提醒你。
- **每月 5 号 09:30（北京时间）**：自动拉取并严格核验中国房价行情网（creprice.cn）深圳十区月度租金、礼貌探测 58 商圈月度趋势；若遇验证码或改版，自动跳过并保留旧快照，绝不写入脏数据。
- **全套测试兜底**：每次自动更新都必须通过 `npm run build && npm run check && npm test && npm run deploy:check` 才会自动提交并触发线上网站刷新。
- **随时手动更新**：打开 GitHub 仓库 → **Actions → Auto Update Rental Data → Run workflow**，手机上点一下即可立刻跑一次。

---

## 四、给执行会话的配合建议（后续演进可选）

本次上线改造严格保持了与业务代码零冲突（未改动 `app/` 与 `tools/build_data.cjs`）。如执行会话后续有空，建议顺手补齐以下 4 个小优化，让线上自动更新链路更彻底：

1. **移除 `tools/build_data.cjs` 的硬编码日期**：
   - `latest58()` 中的 `p < '2026-11'`（第 171/176/177 行）建议改为自动读取当前完整月份（或允许最新月份参与比较），否则 2026-12 及以后自动更新的新月份 58 行情会被跳过。
   - 第 743 行 `asOf: '2026-11-25'` 建议改为取 `affSpec.asOf`、`base.listingCheckedAt`、`fine.asof` 三者中的最新日期，让前端页面自动显示最新核验日期。
   - `base.districts` 已有自动更新写入的 `base.listingMonth` 字段，建议在各区总览与帮助浮层里动态展示该期数，而非写死「2026-10」。
2. **线上角标展示最近自动更新日期**：
   - 在顶部 `?` 数据说明或底部图例增加一行「数据核验：`atlas.asOf`」，方便手机端一眼确认自动任务是否已生效。
3. **（可选）高频人工数据热叠加**：
   - 若未来想在不重新构建的情况下秒级更新避坑事件/新保租房，可在 `app/` 启动阶段增加一次可选的 `fetch('./live-overlay.json')` 合并逻辑（离线/404 时静默忽略）。
4. **（可选）高德实时堵车路况**：
   - 若需要在线上替代本地 `launcher.py` 的 `/api/drive`，只需在 EdgeOne Pages Functions / Cloudflare Workers 增加一个 40 行的 `/api/drive` 代理函数（读取平台环境变量 `AMAP_WEB_KEY`），并在板块抽屉里加一个按需点击的「查实时路况」按钮即可。
