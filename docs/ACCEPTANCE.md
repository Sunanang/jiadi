# 家底 v0.3.0 验收记录

验收日期：2026-11-06。交付版本：`0.3.1`（飞牛统一网关微应用；`package.json`、界面「关于」均固定为该号）。

## 需求落实

- 资产数据仅服务端一份；电脑与手机访问同一服务。
- 手动加密备份；无自动备份与后台通知。
- 登录、遮罩与导出共用账本密码；导出前重新验证。
- 直接打开 HTML 不再建立本地独立账本；可导出旧数据迁移备份。

## 自动验证

| 入口 | 结果 |
| --- | --- |
| `npm test` | 18 通过 / 0 失败 |
| `npm run test:browser` | 50 通过 / 0 失败（含 `file://` 迁移门禁、桌面与 390px 布局） |
| `npm run test:http` | 5 通过 / 0 失败（真实 HTTP：建账、录入、刷新持久化、版本号、390px） |
| `node tests/shared-browser.mjs` | 双客户端共享检查页可生成；模拟传输，真实加密与落盘由服务端测试覆盖 |

截图（相对项目目录）：`audit/desktop.png`、`audit/mobile.png`、`audit/http-desktop.png`、`audit/http-mobile.png`。

## 浏览器与设备验收

按 README「支持范围」：

| 环境 | 结果 | 证据 |
| --- | --- | --- |
| 桌面 Chrome · 隔离回归 | 通过 | `npm run test:browser` 50/50 |
| 桌面 Chrome · 真实 HTTP | 通过 | `npm run test:http`：建账密码门、账户写入、重载后余额 1234.56、关于页 `v0.3.0` |
| 桌面 Safari · 真实 HTTP | 页面可打开 | AppleScript 读取到标题「家底 · 资产台账」且文档含品牌文案；Safari 未开启 “Allow JavaScript from Apple Events”，无法自动点选登录门。关键路径未使用 Chrome 专有 API |
| 手机宽度 390×844 | 通过 | 回归与 HTTP 验收均断言七页无整页横向溢出；见 `audit/*-mobile.png` |
| iOS Safari / Android Chrome 真机局域网 | 交付后由部署方完成 | 需家庭局域网访问同一服务地址；本机自动化不能替代真机 |

## 本轮修复

- 浏览器回归中 `file://` 仍按 v0.2「本地独立账本」断言，导致迁移门禁后 9 项级联失败。已改为验收共享版迁移门禁，并在用例结束时恢复 HTTP 测试页。
- 截图与说明中的本机绝对路径改为项目相对路径；Chrome 可执行文件通过 `CHROME_PATH` 或常见安装位置解析。
- 使用说明与验收合并为 `README.md` + `docs/ACCEPTANCE.md`，移除重复的 v0.2 审计文。

## 能力边界（非缺陷）

- 服务端 `ledger.json` 未做静态加密；需保管主机与数据目录 / Docker 卷。
- 无云同步、无密码找回、无多租户。
- 草稿只在当前页面生命周期；撤销只针对本页最近一次盘点。
- `file://` 仅提供旧数据迁移备份，不能当作共享服务使用。

## 交付包

```bash
npm run pack:zip
npm run pack:fpk
```

- `dist/jiadi-v0.3.1.zip`（可选 `npm run pack:zip`）：通用源码/Docker 交付
- `dist/jiadi-0.3.1-fnos-all.fpk`：飞牛统一网关微应用包

## 飞牛 NAS 实装（本机）

2026-11-06：`jiadi` 已改为 **无独立端口** 的统一网关微应用（`micro_app` + `app.sock` + `/app/jiadi`）。

已验证：

- Unix socket 上 `X-Trim-Userid` 可直接得到 `authMode=gateway` 与 CSRF，无需账本登录密码
- 页面经 socket 前缀 `/app/jiadi/` 返回 HTTP 200
- 旧 `:18080` TCP 入口已关闭

说明：从端口版热更新后，应用中心桌面入口缓存可能仍显示旧 `url:18080`；需在应用中心 **卸载（保留数据）后安装** `dist/jiadi-0.3.1-fnos-all.fpk`，桌面才会变为 iframe 网关入口。
