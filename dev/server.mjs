/**
 * 开发目录入口：避免与根目录 server.mjs 双份漂移。
 * 推送 / 会话 / 加解密等逻辑一律走仓库根的实现；这里只负责启动。
 */
import {createServer} from 'node:http';
import {existsSync, unlinkSync, mkdirSync} from 'node:fs';
import {resolve, dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createLedgerApp, encryptBackup, decryptBackup} from '../server.mjs';

export {createLedgerApp, encryptBackup, decryptBackup};

const root = dirname(fileURLToPath(import.meta.url));

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const socketPath = process.env.FNOS_SOCKET_PATH || process.env.JIADI_GATEWAY_SOCKET || '';
  const gatewayPrefix = process.env.FNOS_GATEWAY_PREFIX || process.env.JIADI_GATEWAY_PREFIX || (socketPath ? '/app/jiadi' : '');
  const trustGateway = Boolean(socketPath) || process.env.JIADI_TRUST_GATEWAY === '1';
  /* 静态资源与数据仍相对本目录，便于在 dev/ 下单独起服务；业务逻辑已与根 server 对齐（含 notify） */
  const app = await createLedgerApp({
    dataDir: resolve(process.env.JIADI_DATA_DIR || join(root, 'data')),
    secureCookie: process.env.JIADI_SECURE_COOKIE === '1',
    trustGateway,
    gatewayPrefix
  });
  const server = createServer(app.handler);
  server.on('error', async e => { console.error('共享服务启动失败：' + e.message); await app.close(); process.exitCode = 1; });
  const stop = () => { server.close(async () => { await app.close(); process.exit(); }); try { server.closeIdleConnections(); } catch {} };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  if (socketPath) {
    try { if (existsSync(socketPath)) unlinkSync(socketPath); } catch {}
    try { mkdirSync(dirname(socketPath), { recursive: true }); } catch {}
    server.listen(socketPath, () => {
      import('node:fs').then(fs => { try { fs.chmodSync(socketPath, 0o777); } catch {} });
      console.log(`家底共享服务已启动（飞牛统一网关）socket=${socketPath} prefix=${gatewayPrefix || '/'}`);
    });
  } else {
    server.listen(Number(process.env.PORT || 8080), process.env.HOST || '0.0.0.0', () =>
      console.log(`家底共享服务已启动，端口 ${server.address().port}；电脑和手机请访问同一服务地址。`));
  }
}
