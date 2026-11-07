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

## 部署

仓库自带 [`.github/workflows/pages.yml`](../.github/workflows/pages.yml)：推送到 `main` 且 `website/` 有改动时，自动把这套静态文件发布到 GitHub Pages（`https://sunanang.github.io/jiadi/`）。也可以把 `website/` 整个目录拖到任意静态托管（Cloudflare Pages / Vercel / 自己的 NAS 上都行），不需要构建步骤。

## 内容维护

- 版本号出现在首屏徽章与页脚，发版时与 `package.json` 一起改。
- 下载按钮指向 `https://github.com/Sunanang/jiadi/releases/latest`，不需要每次发版改地址。
- 文案口径与 README 保持一致：不承诺自动备份、不承诺公网安全、不承诺通知必达。
