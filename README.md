<div align="center">
  <img src="fnos/ICON_256.PNG" width="88" alt="家底" />
  <h1>家底</h1>
  <p><strong>不记流水、不做预算、不连银行的家庭总账。</strong></p>
  <p>没有一笔笔的收入支出，只有固定周期的资金盘点：这个月家里有多少钱，一眼看得见它怎么涨。</p>
  <p>
    <a href="https://www.jiadi.lndo.top/">官网</a> ·
    <a href="https://github.com/Sunanang/jiadi/releases">获取安装包</a> ·
    <a href="#开始使用">快速开始</a> ·
    <a href="#共享密码与备份">数据与备份</a> ·
    <a href="https://github.com/Sunanang/jiadi/issues">反馈问题</a>
  </p>
  <p>
    <img src="https://img.shields.io/badge/fnOS-%E5%BE%AE%E5%BA%94%E7%94%A8-1F6FEB" alt="fnOS 微应用" />
    <img src="https://img.shields.io/badge/Node.js-22%2B-339933?logo=node.js&logoColor=white" alt="Node.js 22+" />
    <img src="https://img.shields.io/badge/Docker-%E5%8F%AF%E9%80%89-2496ED?logo=docker&logoColor=white" alt="Docker" />
    <img src="https://img.shields.io/badge/%E4%BE%9D%E8%B5%96-%E9%9B%B6-35c58b" alt="零依赖" />
    <img src="https://img.shields.io/badge/License-MIT-35c58b" alt="MIT" />
  </p>
</div>

![家底首页](docs/screenshots/01-home-dark.png)

<p align="center"><sub>全部截图来自仓库内置的演示数据（SEED），不是任何人的真实账本。</sub></p>

## 一个台账，回答一个问题

记账软件问「这笔钱花在哪」，家底只问「现在家里有多少钱」。

| 视图 | 能做什么 |
| --- | --- |
| **首页总览** | 总资产、总负债、净资产一行等式看完，旁边是较上次记录的变化与负债率 |
| **趋势** | 净值 / 资产负债 / 结构三种口径，按月或按年成图，悬停查看当月数值 |
| **按人归属** | 每位家庭成员各占多少、占比多少，圆环分段可直接对照列表 |
| **按类明细** | 现金 / 存款 / 投资 / 固定资产 / 负债分组，小计与占比同排对齐 |
| **盘点流** | 一次盘点只填余额，不填流水；跳变过大的要单独确认，可撤销 |
| **只读报告** | 纯静态 HTML 报告，适合导出留档或发给家人看 |
| **隐私遮罩** | 一键把金额换成圆点、图表虚化，适合在别人旁边打开 |

## 界面

| 首页 · 深色 | 首页 · 浅色 | 趋势 |
| --- | --- | --- |
| ![首页深色](docs/screenshots/01-home-dark.png) | ![首页浅色](docs/screenshots/02-home-light.png) | ![趋势](docs/screenshots/03-trend.png) |

| 按人归属 | 按类明细 | 盘点流 |
| --- | --- | --- |
| ![归属](docs/screenshots/04-people.png) | ![明细](docs/screenshots/05-detail.png) | ![盘点流](docs/screenshots/06-checkin.png) |

| 只读报告 | 设置 | 账户抽屉 |
| --- | --- | --- |
| ![报告](docs/screenshots/07-report.png) | ![设置](docs/screenshots/08-settings.png) | ![抽屉](docs/screenshots/09-drawer.png) |

手机 390px：<img src="docs/screenshots/10-mobile-home.png" width="240" alt="手机首页">

截图由 `npm run shots` 重新生成（无头 Chrome + 演示数据，不接触真实账本）。

## 功能特性

- **零依赖、零构建**：Node.js 22 标准库 + 单文件前端，没有 `node_modules`，没有打包步骤，克隆下来就能跑
- **一份账本，多端共用**：电脑与手机访问同一服务，共用账户、成员、历史与月度快照；不再是每台浏览器各存一份
- **盘点而非流水**：按日/周/月盘点余额，自动补齐历史曲线；十几种账户类型与「是否计入净值」开关按需取舍
- **密码门禁**：账本登录、遮罩解锁、改密、导出共用一个应用密码；15 分钟无操作自动上锁，锁定态接口一律 423
- **加密导出**：JSON 备份、CSV、操作日志、HTML 报告都在服务端 AES-256-GCM 加密后下载；明文只能在「导入 / 解密」里还原
- **写入不会半截**：临时文件 + 同步落盘 + 原子替换，`server.lock` 阻止多进程同时写；并发保存按 revision 拒绝旧页面（409）
- **飞牛 NAS 原生集成**：FPK 微应用走飞牛统一网关 `/app/jiadi`，用 NAS 统一登录，不占独立端口
- **全本地**：无账号、无云同步、无遥测、无第三方请求；服务端账本文件也不做静态加密以外的任何外发
- **暗色 / 浅色**、**隐私遮罩**、**移动端 390px 布局**、**飞牛桌面图标**成套齐备
- **严格校验**：所有导入与草稿都过 `normalizeData`，字段级畸形输入整份拒绝，不会写坏账本

## 开始使用

三种方式选一种。同一套服务不要重复启动多个进程指向不同数据目录。

### 1. 飞牛 NAS（FPK 微应用，推荐）

**不占用独立端口**，经飞牛统一网关 `/app/jiadi` 打开，使用 **飞牛 NAS 统一登录**（`X-Trim-*`）。日常进入账本不再要求二次登录；首次进入只需设置一次「备份与遮罩密码」。

前置：应用中心已安装 **Node.js v22**。

从 [Releases](https://github.com/Sunanang/jiadi/releases/latest) 取 `jiadi-<版本>-fnos-all.fpk`，在应用中心「手动安装」。若已装旧的端口版，请先在应用中心卸载（保留数据）再装新包。

也可以用命令安装：

```bash
trim-cli --profile home --host <NAS> app install-fpk dist/jiadi-<版本>-fnos-all.fpk \
  --volume-id <卷ID> --custom-parameters '[]' --yes
```

打开方式：飞牛桌面 / 应用中心点「家底」（iframe 网关）。手机请通过已登录的飞牛网页或客户端进入同一应用，不要再使用 `:端口` 直连。

### 2. Docker Compose

```bash
git clone https://github.com/Sunanang/jiadi.git
cd jiadi
docker compose up -d --build
```

Docker 使用持久化卷 `jiadi-data`。升级时保留该卷；删除卷会删除服务端数据。

### 3. 源码直接运行

```bash
git clone https://github.com/Sunanang/jiadi.git
cd jiadi
npm start
```

电脑打开 `http://localhost:8080`，手机与其他电脑访问 `http://<运行服务的主机局域网 IP>:8080`。服务需保持运行；首次访问设置账本密码，其他设备使用同一密码登录。

部署在家庭网络内。远程访问请使用 HTTPS 或已有私有网络入口；反向代理需保留 Host，并从站点根路径提供本应用。

### 配置

| 环境变量 | 默认 | 用途 |
| --- | --- | --- |
| `PORT` | `8080` | 服务端口 |
| `HOST` | `0.0.0.0` | 监听地址（仅本机访问可设 `127.0.0.1`） |
| `JIADI_DATA_DIR` | 项目下 `data/` | 账本数据目录 |
| `JIADI_SECURE_COOKIE` | 未启用 | 经 HTTPS 反向代理时设为 `1` |

## 共享、密码与备份

- **唯一账本文件**：`data/ledger.json`（账户、成员、归档、历史、月度快照、操作日志、密码哈希）。
- **并发**：每次保存核对服务端版本，另一设备已更新时旧页面保存会被拒绝；页面约每 5 秒检查更新，回到前台也会检查，有未提交输入时保留输入并提示刷新。保存失败回滚界面；若响应中断、无法确认是否落盘，须先刷新核对。
- **浏览器只存偏好**：主题、显示偏好、备份提醒日期和引导状态；账本不进 localStorage。
- **密码**：账本登录、遮罩解锁、修改密码和导出共用一个密码（4–8 位，含字母和数字）。服务端只保存加盐哈希。改密后其他设备会话失效，旧备份仍用导出时的旧密码。
- **加密备份**：设置 → 数据 → 导出 JSON，下载 `.encrypted.json`（AES-256-GCM）；CSV / 日志 / 自检 / HTML 报告导出前同样验密并加密。
- **恢复与解密**：「导入 / 解密」里导入加密 JSON 会先验密再二次确认覆盖共享账本（密码错误、文件损坏或取消都不会覆盖）；「解密」只还原明文下载，绝不改账本。
- **没有自动备份**：服务端账本文件本身不做静态加密，也没有云端副本或后台推送。请自行每月导出一次加密备份，存在服务之外。

## 从旧版迁移

旧版浏览器数据不会自动覆盖服务端账本，也不会被删除。

1. 若曾直接双击旧版 `jiadi-ui.html`：升级后仍双击同一文件，可下载旧账本加密迁移备份。
2. 启动共享服务，首次设置账本密码（可沿用旧密码）。
3. 登录后从「导入 / 解密」恢复迁移文件。普通 JSON 备份也可导入。

`home-ledger.html` 与 `home-ledger.glass-v1.html` 为早期参考稿，不是共享版入口。

## 支持范围

| 类别 | 约定支持 | 说明 |
| --- | --- | --- |
| 桌面浏览器 | Chrome 最新稳定版、Safari 最新稳定版 | 主功能与布局 |
| 手机浏览器 | iOS Safari、Android Chrome | 经局域网访问同一服务；宽度约 390px 布局 |
| 运行时 | Node.js 22+，或 Docker（`compose.yaml`） | 需常驻一台主机 |
| 平台 | 飞牛 OS 微应用（FPK）或任意常驻主机 | 家庭内网使用 |
| 不在范围 | Firefox 专项、打印服务、公网裸 HTTP、多账本多租户 | 未承诺 |

## 项目结构

```
├── server.mjs          # Node 22 服务：网关 socket / 统一登录 / 账本读写 / 密码门禁 / 草稿暂存
├── jiadi-ui.html       # 单文件前端（逻辑在 <script id="ledgerApp"> 内，由 shared-client.js 注入执行）
├── shared-client.js    # 会话、密码页、空闲锁、轮询、草稿存取
├── ledger-domain.mjs   # normalizeData 严格校验
├── fnos/               # 飞牛 OS 打包骨架（manifest / cmd / wizard / config / 图标）
├── scripts/            # build-fpk.sh 打包、pack.sh 通用包、shots.mjs 截图
├── tests/              # 服务端、浏览器回归、HTTP 验收、网关首用流程
├── test/               # 畸形输入探针与本地截图页
├── website/            # 官网（单文件静态站，零依赖零构建）
├── docs/               # 验收记录、界面截图、捐赠二维码
├── verify.sh           # 部署后线上自检（环境变量驱动）
├── 人工验收清单.md      # 发版人工验收步骤
├── dist/               # 打包产物（不入库）
├── Dockerfile
├── compose.yaml
└── package.json
```

## 开发与测试

```bash
npm test               # 服务端：临时磁盘、接口、并发版本、会话、密码与加密恢复
npm run test:browser   # 浏览器回归 54 项（隔离 Chrome 配置，含桌面与 390px 渲染）
npm run test:http      # 真实 HTTP 验收
npm run test:gateway   # 模拟飞牛网关首用流程
npm run shots          # 用演示数据重新生成 docs/screenshots/
```

- 浏览器测试走 `tests/browser.mjs` 自带的无头会话，不碰你正在用的浏览器配置；可用环境变量 `CHROME_PATH` 指定可执行文件。
- 打包：`npm run pack:fpk`（需 `fnpack`，PATH 或 `~/.local/bin`），产物在 `dist/`；`scripts/build-fpk.sh` 会校验 `package.json`、`fnos/manifest`、`APP_VERSION` 三处版本号一致才出包。
- 部署后自检：`JIADI_SSH_HOST=<NAS> JIADI_NAS_URL=http://<NAS>:<端口>/app/jiadi bash verify.sh`（详见文件头注释）。
- 验收结论与边界见 [验收记录](docs/ACCEPTANCE.md)，人工发版步骤见 [人工验收清单](人工验收清单.md)。

## 常见问题

- **打开是空白 / 提示设置服务**：先确认服务在跑（`npm start` 或容器 `Up`），再确认访问的是同一台主机的 `:8080`，而不是双击本地文件。
- **另一台设备保存被拒**：别的设备已更新账本，刷新页面后重新录入；页面上有未提交输入时不会静默丢弃。
- **忘记应用密码**：账本密码不可找回。旧加密备份仍可用导出时的密码解开；请按备份恢复，而不是删 `ledger.json`。
- **上锁后草稿没了**：锁定时未提交的输入不会保留，只有空闲顺延缓冲（最多 2 次、累计约 45 分钟），解锁页已写明这一行为。
- **飞牛里桌面图标空白**：桌面图标读 `app.tgz` 内 `ui/images/icon_{16,32,48,64,128,256}.png`，应用市场读包根目录的 `ICON.PNG` / `ICON_256.PNG`，两套文件必须都在。
- **数据在哪个目录**：源码/Docker 默认项目下 `data/`（卷 `jiadi-data`），飞牛应用在应用数据目录；备份的永远是 `ledger.json`。

## 官网

官网源码在 [`website/`](website/)，单文件静态站，零依赖零构建（`index.html` 里内联全部 CSS，无脚本）。推送到 `main` 且 `website/` 有改动时，由 [GitHub Actions](.github/workflows/pages.yml) 发布到 <https://www.jiadi.lndo.top/>。

本地预览：

```bash
cd website
python3 -m http.server 8080
```

## 捐赠

创作不易，为了项目的稳定和可持续发展，欢迎大家捐赠支持

<table>
  <tr>
    <td><img src="docs/images/wechat_pay.jpg" width="300" alt="微信" /></td>
    <td><img src="docs/images/ali_pay.jpg" width="300" alt="支付宝" /></td>
  </tr>
</table>

## Star History

<a href="https://www.star-history.com/?repos=Sunanang%2Fjiadi&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=Sunanang/jiadi&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=Sunanang/jiadi&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=Sunanang/jiadi&type=date&legend=top-left" />
 </picture>
</a>

## 免责声明

- **非官方项目**：本仓库为独立开源作品，与飞牛 NAS 主体**无隶属、赞助或背书关系**；相关产品名称与商标归权利人所有。
- **按现状提供**：除开源许可证另有约定外，作者不对本软件的**正确性、完整性、安全性或持续可用性**作任何明示或默示担保；详见 [`LICENSE`](LICENSE) 中的免责声明条款。
- **数据责任**：账本只存在你自己的机器上，没有云端副本。**请自行定期导出加密备份并放在服务之外**；因硬盘损坏、误删、忘记密码或未做备份导致的数据丢失，作者不承担责任。
- **使用风险自负**：部署、开放端口、反向代理暴露到公网等行为由使用者自行评估与承担。本应用按家庭内网使用设计，不建议直接公网裸 HTTP 暴露。
- **合规**：使用本软件时请遵守所在地法律法规。

## 许可证

本项目采用 [MIT License](https://opensource.org/licenses/MIT)，全文见仓库根目录 [`LICENSE`](LICENSE)。

```
MIT License

Copyright (c) 2026 Lando

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
