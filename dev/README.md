# dev/ · 开发壳与探针页

**这里不放业务代码副本。** UI / 领域逻辑 / 服务端一律用仓库根目录的那份：

- `dev/server.mjs` 只做一件事：从 `../server.mjs` 引入 `createLedgerApp` 再启动（保证与根目录不漂移）。
- `dev/jiadi-ui.html`、`dev/ledger-domain.mjs`、`dev/package.json` 是 0.5.x 早期的旧副本，**已过期且没有任何脚本引用**，别在这上面改东西（改了不会生效，跑起来的是根目录那份）。
- `dev/probe*.html`、`dev/shot.html` 是临时探针页。

打包（`scripts/build-fpk.sh`）只从根目录取文件，dev/ 不参与出包。
