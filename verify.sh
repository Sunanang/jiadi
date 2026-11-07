#!/bin/bash
# 家底部署自检脚本 —— 部署后在本机跑，逐项核对线上状态
# 用法：
#   JIADI_SSH_HOST=<ssh 别名或 user@host>  JIADI_NAS_URL=http://<NAS>:<端口>/app/jiadi  bash verify.sh
# 可选：
#   JIADI_APP_DIR     线上运行目录，默认 /vol1/@appcenter/jiadi
#   JIADI_APP_DATA    线上数据目录，默认 /vol1/@appdata/jiadi
#   JIADI_LEAK_TERMS  逗号分隔的「真实数据特征词」，用于第 7 段泄露检查；不设则跳过
# 退出码 0 = 全部通过；非 0 = 有失败项

ROOT="$(cd "$(dirname "$0")" && pwd)"
NAS="${JIADI_SSH_HOST:-}"
NAS_URL="${JIADI_NAS_URL:-}"
APP_DIR="${JIADI_APP_DIR:-/vol1/@appcenter/jiadi}"
APP_DATA="${JIADI_APP_DATA:-/vol1/@appdata/jiadi}"
LEAK_TERMS="${JIADI_LEAK_TERMS:-}"
VER="$(node -p "require('$ROOT/package.json').version" 2>/dev/null)"
PKG="$ROOT/dist/jiadi-${VER}-fnos-all.fpk"

if [[ -z "$NAS" ]]; then
  echo "缺少 JIADI_SSH_HOST（ssh 别名或 user@host），远程项无法核对。" >&2
  exit 2
fi

FAIL=0
ok(){ printf '  \033[32m✓\033[0m %s\n' "$1"; }
no(){ printf '  \033[31m✗\033[0m %s\n' "$1"; FAIL=$((FAIL+1)); }
skip(){ printf '  \033[33m–\033[0m %s\n' "$1"; }
hdr(){ printf '\n\033[1m%s\033[0m\n' "$1"; }

hdr "1. 服务是否在跑"
PID=$(ssh "$NAS" "ps -ef | grep '[j]iadi/server.mjs' | awk '{print \$2}' | head -1")
if [ -n "$PID" ]; then ok "进程存在 PID=$PID"; else no "进程不存在"; fi
ST=$(ssh "$NAS" "sudo cat $APP_DATA/runtime/server.pid 2>/dev/null" | tr -d '[:space:]')
[ "$ST" = "$PID" ] && ok "pid 文件与进程一致" || no "pid 文件($ST) ≠ 进程($PID)"

hdr "2. 网关是否响应"
if [ -n "$NAS_URL" ]; then
  CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$NAS_URL")
  [ "$CODE" = "200" ] && ok "网关 HTTP 200" || no "网关 HTTP $CODE"
else
  skip "未设置 JIADI_NAS_URL，跳过"
fi

hdr "3. 数据文件自洽"
ssh "$NAS" "sudo cat $APP_DATA/data/ledger.json" > /tmp/_jd_live.json 2>/dev/null
if [ -s /tmp/_jd_live.json ]; then
  python3 - <<'PY'
import json,sys
try:
    d=json.load(open('/tmp/_jd_live.json'))
except Exception as e:
    print('  ✗ JSON 解析失败:',e); sys.exit(1)
L=d.get('ledger',{})
a=len(L.get('accounts',[])); s=len(L.get('snapshots',[])); lg=len(d.get('logs',[]))
print(f'  ✓ JSON 合法 · revision={d.get("revision")} 账户={a} 快照={s} 日志={lg} vault={"有" if d.get("vault") else "无"}')
bad=[]
for x in L.get('accounts',[]):
    h=x.get('history') or []
    if not h: bad.append(x['name']+':无history'); continue
    if abs(h[-1]['amount']-x['amount'])>0.005: bad.append(x['name']+':amount≠history末')
    if h[-1]['date']!=x['date']: bad.append(x['name']+':date≠history末')
names={m['name'] for m in L.get('members',[])}
orph=[x['name'] for x in L.get('accounts',[]) if x['member'] not in names]
if orph: bad.append('孤儿归属:'+','.join(orph))
print('  ✓ 账户自洽（amount/date/history/归属）' if not bad else '  ✗ '+'; '.join(bad))
sys.exit(1 if bad else 0)
PY
  [ $? -ne 0 ] && FAIL=$((FAIL+1))
else
  no "读不到 ledger.json"
fi

hdr "4. 门禁（锁定态应返回 423）"
SESS=$(ssh "$NAS" "curl -s --unix-socket $APP_DIR/app.sock -H 'x-trim-userid: 1000' http://localhost/app/jiadi/api/session" 2>/dev/null)
echo "$SESS" | grep -q '"locked":true' && ok "当前锁定 locked=true" || no "未锁定或读不到：$SESS"
for p in ledger log draft; do
  C=$(ssh "$NAS" "curl -s --unix-socket $APP_DIR/app.sock -H 'x-trim-userid: 1000' -o /dev/null -w '%{http_code}' http://localhost/app/jiadi/api/$p")
  [ "$C" = "423" ] && ok "/api/$p → 423" || no "/api/$p → $C（应为 423）"
done

hdr "5. 桌面与市场图标（两套独立文件）"
for f in 16 32 48 64 128 256; do
  SZ=$(ssh "$NAS" "sudo stat -c %s $APP_DIR/ui/images/icon_$f.png 2>/dev/null")
  if [ "${SZ:-0}" -gt 500 ]; then ok "ui/images/icon_$f.png = ${SZ}B"; else no "ui/images/icon_$f.png 只有 ${SZ:-0}B（占位图？）"; fi
done
# 根图标由 fpk 包本身提供，安装后不会解压到运行目录 —— 必须在包里查
if [ -f "$PKG" ]; then
  for f in ICON.PNG ICON_256.PNG; do
    SZ=$(tar xzOf "$PKG" $f 2>/dev/null | wc -c | tr -d ' ')
    [ "${SZ:-0}" -gt 1000 ] && ok "包内 $f = ${SZ}B" || no "包内 $f 只有 ${SZ:-0}B"
  done
  ok "（说明：根图标由 fpk 包提供，不落地到 $APP_DIR/，这是 fnOS 的正常行为）"
fi

hdr "6. fpk 包与线上文件是否一致"
if [ -f "$PKG" ]; then
  L=$(md5 -q "$PKG" 2>/dev/null || md5sum "$PKG" | cut -d' ' -f1)
  R=$(ssh "$NAS" "md5sum /vol1/$(basename "$PKG") | cut -d' ' -f1")
  [ "$L" = "$R" ] && ok "本地=NAS md5 $L" || no "md5 不一致 本地=$L NAS=$R"
  T=$(mktemp -d "${TMPDIR:-/tmp}/jd_chk.XXXXXX"); tar xzf "$PKG" -C "$T" 2>/dev/null
  mkdir -p "$T/app" && tar xzf "$T/app.tgz" -C "$T/app" 2>/dev/null
  for f in jiadi-ui.html server.mjs shared-client.js ledger-domain.mjs; do
    A=$(md5 -q "$T/app/$f" 2>/dev/null || md5sum "$T/app/$f" 2>/dev/null | cut -d' ' -f1)
    B=$(ssh "$NAS" "sudo md5sum $APP_DIR/$f | cut -d' ' -f1")
    [ "$A" = "$B" ] && ok "$f 包内=线上" || no "$f 不一致 包=$A 线上=$B"
  done
  rm -rf "$T"
else
  no "本地找不到 $VER 的 fpk（$PKG）"
fi

hdr "7. 静态资源里有没有真实数据"
if [ -n "$LEAK_TERMS" ]; then
  PAT=$(printf '%s' "$LEAK_TERMS" | tr ',' '|')
  HITS=$(ssh "$NAS" "sudo grep -c '$PAT' $APP_DIR/jiadi-ui.html 2>/dev/null || true" | tr -d ' ')
  if [ "${HITS:-0}" = "0" ]; then ok "jiadi-ui.html 不含特征词（$LEAK_TERMS）"
  else no "jiadi-ui.html 里出现了 $HITS 处真实数据特征"; fi
else
  skip "未设置 JIADI_LEAK_TERMS，跳过（建议填入自家真实金额/独有账户名作为特征词）"
fi

hdr "8. 回滚点"
ROLLBACK=$(ssh "$NAS" "ls -dt $APP_DATA/backup/app-* 2>/dev/null | head -1" | tr -d " ")   # 按修改时间取最新，别用版本字符串排序（0.4.9 会排到 0.4.10 后面）
if ssh "$NAS" "ls ${ROLLBACK:-/nonexistent}/server.mjs >/dev/null 2>&1"; then
  ok "文件级回滚快照在：$ROLLBACK"
else
  no "文件级回滚快照丢失（重建见 人工验收清单.md「回滚点重建」一节）"
fi
COUNT=$(ssh "$NAS" "ls /vol1/*.fpk 2>/dev/null | wc -l" | tr -d " ")
[ "${COUNT:-0}" = "1" ] && ok "NAS 上只保留当前版本 1 个 fpk" || no "NAS 上还有 $COUNT 个 fpk（应为 1）"

printf '\n\033[1m结果：%s\033[0m\n' "$([ $FAIL -eq 0 ] && echo '全部通过（0 失败）' || echo "$FAIL 项失败")"
exit $FAIL
