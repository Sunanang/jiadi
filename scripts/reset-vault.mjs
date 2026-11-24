#!/usr/bin/env node
/**
 * 家底 · 忘记应用密码时的离线恢复工具
 *
 * 应用密码只存在账本文件的 vault 字段里（salt + hash），账本数据本身是明文。
 * 因此恢复方式只能是「清掉 vault」——不涉及任何数据解密，也不需要旧密码。
 *
 * 这个脚本故意不做成界面入口：能把命令敲到服务器上的人，本来就是有文件权限的人；
 * 界面上放一个自助重置按钮，等于让任何能打开应用的家庭成员绕过应用密码。
 *
 * 用法（在 NAS 上，以文件属主或 root）：
 *   node scripts/reset-vault.mjs                       # 只检查，不改文件
 *   node scripts/reset-vault.mjs --yes                 # 真的清掉密码
 *   node scripts/reset-vault.mjs --data-dir <目录> --yes
 *
 * 建议顺序：
 *   1) 先停应用（fnOS 应用中心里停掉「家底」，或 trim-cli app stop jiadi）
 *   2) 跑本脚本 --yes
 *   3) 再启动应用；打开后会重新走「先设一个应用密码」，账本数据原样还在
 */
import {readFile, writeFile, rename, mkdir, stat, open, chmod, chown} from 'node:fs/promises';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = name => argv.includes(name);
const value = name => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

if(flag('--help') || flag('-h')){
  console.log('用法: node scripts/reset-vault.mjs [--data-dir <账本目录>] [--yes]');
  process.exit(0);
}

/* 数据目录：显式参数 > 环境变量 > 常见安装位置里第一个真有 ledger.json 的 */
const candidates = [value('--data-dir'), process.env.JIADI_DATA_DIR,
  '/vol1/@appdata/jiadi/data', join(here, '..', 'data'), join(here, 'data'), join(process.cwd(), 'data')]
  .filter(Boolean).map(x => resolve(x));
let dataDir = candidates[0];
for(const candidate of candidates){
  try{ await stat(join(candidate, 'ledger.json')); dataDir = candidate; break; }catch{}
}
const ledgerPath = join(dataDir, 'ledger.json');
const keepDir = join(dataDir, '.jiadi-keep');
const dryRun = !flag('--yes');

function die(message){ console.error('✗ ' + message); process.exit(1); }

let raw;
try{ raw = await readFile(ledgerPath, 'utf8'); }
catch(e){ die('读不到账本文件 ' + ledgerPath + '（' + e.code + '）。已尝试：' + candidates.join('、') + ' —— 请用 --data-dir 指向应用的数据目录。'); }

let disk;
try{ disk = JSON.parse(raw); }
catch(e){ die('账本文件不是合法 JSON，已中止（不改动任何文件）：' + e.message); }

if(!disk || typeof disk !== 'object') die('账本文件结构异常，已中止。');
if(!disk.vault){
  console.log('这个账本还没有设置应用密码，不需要重置。');
  console.log('文件：' + ledgerPath);
  process.exit(0);
}

const accounts = Array.isArray(disk.ledger && disk.ledger.accounts) ? disk.ledger.accounts.length : 0;
console.log('账本：' + ledgerPath);
console.log('应用密码：已设置（将要清除）');
console.log('账本数据：' + accounts + ' 个账户 / revision ' + disk.revision + ' / 操作日志 ' + (Array.isArray(disk.logs) ? disk.logs.length : 0) + ' 条 —— 都不会改动');

if(dryRun){
  console.log('');
  console.log('这是检查模式，没有改动任何文件。确认要清除密码请加 --yes 再跑一次。');
  console.log('（建议先停掉应用再执行，否则运行中的进程还持有旧状态。）');
  process.exit(0);
}

/* 先记下原文件的属主与权限：脚本常以 root 跑，若写完把属主变成 root，
   应用（非 root 用户）就再也读不到账本 —— 这是最容易踩的坑。 */
const before = await stat(ledgerPath);
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
await mkdir(keepDir, {recursive: true});
const backupPath = join(keepDir, 'ledger-before-vault-reset-' + stamp + '.json');
await writeFile(backupPath, raw, {mode: 0o600});
console.log('已备份原文件：' + backupPath);

const next = {...disk, vault: null};
const tmpPath = ledgerPath + '.tmp-' + process.pid;
const handle = await open(tmpPath, 'w', before.mode & 0o777);
try{
  await handle.writeFile(JSON.stringify(next), 'utf8');
  await handle.sync();
}finally{ await handle.close(); }
await rename(tmpPath, ledgerPath);
/* 以 root 运行时把属主/权限恢复成原样；非 root 动不了属主，至少保证权限一致 */
try{
  if(process.getuid && process.getuid() === 0) await chown(ledgerPath, before.uid, before.gid);
  else if(typeof process.getuid === 'function' && process.getuid() !== before.uid) console.warn('⚠ 当前用户不是文件属主，账本属主仍是原用户，请确认应用能读到。');
  await chmod(ledgerPath, before.mode & 0o777);
}catch(e){ console.warn('⚠ 恢复属主/权限失败（' + ((e && e.message) || e) + '），请手动确认应用可读：' + ledgerPath); }

const check = JSON.parse(await readFile(ledgerPath, 'utf8'));
if(check.vault !== null) die('写入后校验失败（vault 仍然是设置状态），请用备份文件恢复：' + backupPath);
if((check.ledger && check.ledger.accounts ? check.ledger.accounts.length : -1) !== accounts) die('写入后校验失败（账户数变了），请用备份文件恢复：' + backupPath);

try{ const st = await stat(ledgerPath); console.log('账本文件写入完成（' + st.mode.toString(8).slice(-3) + '，' + st.size + ' 字节）'); }catch{}

console.log('');
console.log('✓ 应用密码已清除，账本数据保持原样。');
console.log('下一步：启动应用 → 打开后会要求「先设一个应用密码」→ 设完即可正常使用。');
console.log('回滚：把 ' + backupPath + ' 复制回 ' + ledgerPath + ' 即可恢复原来的密码状态。');
