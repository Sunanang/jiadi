#!/bin/bash
# 家底自检脚本 —— 你自己跑，不经过任何 AI 转述
# 用法：bash ~/coding/jiadi/verify.sh
# 退出码 0 = 全部通过；非 0 = 有失败项

NAS=nas
FAIL=0
ok(){ printf '  \033[32m✓\033[0m %s\n' "$1"; }
no(){ printf '  \033[31m✗\033[0m %s\n' "$1"; FAIL=$((FAIL+1)); }
hdr(){ printf '\n\033[1m%s\033[0m\n' "$1"; }

hdr "1. 服务是否在跑"
PID=$(ssh $NAS "ps -ef | grep '[j]iadi/server.mjs' | awk '{print \$2}' | head -1")
if [ -n "$PID" ]; then ok "进程存在 PID=$PID"; else no "进程不存在"; fi
ST=$(ssh $NAS "sudo cat /vol1/@appdata/jiadi/runtime/server.pid 2>/dev/null" | tr -d '[:space:]')
[ "$ST" = "$PID" ] && ok "pid 文件与进程一致" || no "pid 文件($ST) ≠ 进程($PID)"

hdr "2. 网关是否响应"
CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "http://192.168.1.13:9527/app/jiadi")
[ "$CODE" = "200" ] && ok "网关 HTTP 200" || no "网关 HTTP $CODE"

hdr "3. 数据文件（你自己 cat 也能看到）"
ssh $NAS "sudo cat /vol1/@appdata/jiadi/data/ledger.json" > /tmp/_jd_live.json 2>/dev/null
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
SESS=$(ssh $NAS "curl -s --unix-socket /vol1/@appcenter/jiadi/app.sock -H 'x-trim-userid: 1000' http://localhost/app/jiadi/api/session" 2>/dev/null)
echo "$SESS" | grep -q '"locked":true' && ok "当前锁定 locked=true" || no "未锁定或读不到：$SESS"
for p in ledger draft; do
  C=$(ssh $NAS "curl -s --unix-socket /vol1/@appcenter/jiadi/app.sock -H 'x-trim-userid: 1000' -o /dev/null -w '%{http_code}' http://localhost/app/jiadi/api/$p")
  [ "$C" = "423" ] && ok "/api/$p → 423" || no "/api/$p → $C（应为 423）"
done

hdr "5. 桌面与市场图标（两套独立文件）"
for f in 16 32 48 64 128 256; do
  SZ=$(ssh $NAS "sudo stat -c %s /vol1/@appcenter/jiadi/ui/images/icon_$f.png 2>/dev/null")
  if [ "${SZ:-0}" -gt 500 ]; then ok "ui/images/icon_$f.png = ${SZ}B"; else no "ui/images/icon_$f.png 只有 ${SZ:-0}B（占位图？）"; fi
done
# 根图标由 fpk 包本身提供，安装后不会解压到运行目录 —— 必须在包里查
PKG=/Users/lando/coding/jiadi/jiadi-0.5.2-fnos-all.fpk
if [ -f "$PKG" ]; then
  for f in ICON.PNG ICON_256.PNG; do
    SZ=$(tar xzOf "$PKG" $f 2>/dev/null | wc -c | tr -d ' ')
    [ "${SZ:-0}" -gt 1000 ] && ok "包内 $f = ${SZ}B" || no "包内 $f 只有 ${SZ:-0}B"
  done
  ok "（说明：根图标由 fpk 包提供，不落地到 /vol1/@appcenter/jiadi/，这是 fnOS 的正常行为）"
fi

hdr "6. fpk 包与线上文件是否一致"
if [ -f /Users/lando/coding/jiadi/jiadi-0.5.2-fnos-all.fpk ]; then
  L=$(md5 -q /Users/lando/coding/jiadi/jiadi-0.5.2-fnos-all.fpk)
  R=$(ssh $NAS "md5sum /vol1/jiadi-0.5.2-fnos-all.fpk | cut -d' ' -f1")
  [ "$L" = "$R" ] && ok "本地=NAS md5 $L" || no "md5 不一致 本地=$L NAS=$R"
  T=/tmp/_jd_chk; rm -rf $T; mkdir -p $T; tar xzf /Users/lando/coding/jiadi/jiadi-0.5.2-fnos-all.fpk -C $T 2>/dev/null
  mkdir -p $T/app && tar xzf $T/app.tgz -C $T/app 2>/dev/null
  for f in jiadi-ui.html server.mjs shared-client.js ledger-domain.mjs; do
    A=$(md5 -q $T/app/$f 2>/dev/null)
    B=$(ssh $NAS "sudo md5sum /vol1/@appcenter/jiadi/$f | cut -d' ' -f1")
    [ "$A" = "$B" ] && ok "$f 包内=线上" || no "$f 不一致 包=$A 线上=$B"
  done
else
  no "本地找不到 0.5.2 的 fpk"
fi

hdr "7. 静态资源里有没有真实数据"
# 特征词取自线上真实数据本身：金额 1923049 + 真实独有账户名；不把 SEED 演示数据里本来就有的通用名当特征
HITS=$(ssh $NAS "sudo grep -c '1923049\|京东金融\|中信银行\|外借' /vol1/@appcenter/jiadi/jiadi-ui.html 2>/dev/null || true" | tr -d ' ')
if [ "${HITS:-0}" = "0" ]; then
  ok "jiadi-ui.html 不含真实金额/真实独有账户名（SEED 演示数据里的通用名如「支付宝余额」不算泄露）"
else
  no "jiadi-ui.html 里出现了 $HITS 处真实数据特征"
fi

hdr "8. 回滚点（2026-11-07 起历史 fpk 已按用户要求清理，回滚改用文件级快照）"
ROLLBACK=$(ssh $NAS "ls -dt /vol1/@appdata/jiadi/backup/app-* 2>/dev/null | head -1" | tr -d " ")   # 按修改时间取最新，别用版本字符串排序（0.4.9 会排到 0.4.10 后面）
if ssh $NAS "ls ${ROLLBACK:-/nonexistent}/server.mjs >/dev/null 2>&1"; then
  ok "文件级回滚快照在：$ROLLBACK"
else
  no "文件级回滚快照丢失（重建见 人工验收清单.md「回滚点重建」一节）"
fi
COUNT=$(ssh $NAS "ls /vol1/*.fpk 2>/dev/null | wc -l" | tr -d " ")
[ "${COUNT:-0}" = "1" ] && ok "NAS 上只保留当前版本 1 个 fpk" || no "NAS 上还有 $COUNT 个 fpk（应为 1）"

printf '\n\033[1m结果：%s\033[0m\n' "$([ $FAIL -eq 0 ] && echo '全部通过（0 失败）' || echo "$FAIL 项失败")"
exit $FAIL
