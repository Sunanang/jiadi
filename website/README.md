# 家底官网

单文件静态站，放在仓库 `website/`，和主项目一样**零依赖、零构建**：`index.html` 里内联全部 CSS，图标与截图放在 `assets/`，没有任何脚本、字体或第三方请求。

设计沿用应用本身的配色与排版（同一套深色/浅色 token、同一字体栈、同样的 12px 圆角），首屏的等式卡是按应用首页用 HTML 复刻的，所以任何分辨率下都清晰。动效只有 hover 与 `details` 展开，并遵循 `prefers-reduced-motion`。

## 本地预览

```bash
cd website
python3 -m http.server 8080
# 打开 http://127.0.0.1:8080
```

也可以直接双击 `index.html`，截图与图标都是相对路径。

## 结构

```
website/
├── index.html       # 整站（HTML + 内联 CSS，无 JS）
├── assets/
│   ├── icon.png     # 应用图标，取自 fnos/ICON_256.PNG
│   ├── home-dark.png / people.png / detail.png / checkin.png / trend.png / settings.png / mobile-home.png
└── README.md
```

截图取自 `docs/screenshots/`（`npm run shots` 用演示数据生成），拷进来是为了让 `website/` 能单独部署。更新截图后同步一次即可：

```bash
cp docs/screenshots/01-home-dark.png website/assets/home-dark.png
# 其余同名对应：04-people / 05-detail / 06-checkin / 03-trend / 08-settings / 10-mobile-home
```

## 自检项

官网没脚本，所以「测」就是量。以下每项都在本机（`python3 -m http.server`）与线上 Pages 各跑一遍：

| 项 | 判据 |
| --- | --- |
| 横向溢出 | 320 / 360 / 390 / 768 / 1024 / 1280 / 1440 / 1920 下 `documentElement.scrollWidth === innerWidth` |
| 锚点跳转 | 点导航后目标小节标题的 `getBoundingClientRect().top` ≥ 吸顶栏高度（不会被挡住） |
| 移动导航 | ≤600px 隐藏「为什么不记流水」、≤760px 隐藏 GitHub 文字，其余链接完整可见不被裁切 |
| 图片 | 滚动到底后每张 `img.complete && naturalWidth > 0`（截图是 `loading="lazy"`，不滚到底量不到） |
| 控制台 | 无 error、无失败请求 |
| 对比度 | 正文/说明/小标/页脚在深浅两主题下 ≥ 4.5:1（浅色 `--mut:#5B6B7E`、`--ink-2:#4E5F75` 是为此定的） |
| 结构 | 唯一 `h1`、无重复 `id`、所有 `img` 有 `alt`、`lang="zh-CN"` |
| FAQ | `<details>` 可展开且内容可见 |

窄屏必须用 CDP 的 `Emulation.setDeviceMetricsOverride` 量，macOS 上 `chrome --headless=new --window-size=390` 的视口会被窗口最小宽度顶到 730px。

## 部署

仓库自带 [`.github/workflows/pages.yml`](../.github/workflows/pages.yml)：推送到 `main` 且 `website/` 有改动时，自动把这套静态文件发布到 GitHub Pages（`https://sunanang.github.io/jiadi/`）。也可以把 `website/` 整个目录拖到任意静态托管（Cloudflare Pages / Vercel / 自己的 NAS 上都行），不需要构建步骤。

## 内容维护

- 版本号出现在首屏徽章与页脚，发版时与 `package.json` 一起改。
- 下载按钮指向 `https://github.com/Sunanang/jiadi/releases/latest`，不需要每次发版改地址。
- 文案口径与 README 保持一致：不承诺自动备份、不承诺公网安全、不承诺通知必达。
