#!/usr/bin/env bash
# 把最新 Release 的安装包同步进官网，并生成 website/downloads/version.json。
#
# 官网的「下载」区走的是本站直连（EdgeOne 国内节点），不依赖 GitHub 的下载速度；
# 所以每次发版后跑一次这个脚本，把新包搬进 website/downloads/ 并提交。
#
#   用法： ./scripts/sync-website-downloads.sh
#   依赖： gh（已登录）、python3
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="website/downloads"
mkdir -p "$OUT"

TAG=$(gh release view --json tagName -q .tagName)
echo "最新 Release: $TAG"

# 先清掉旧版本的包，避免仓库里越堆越大（sha256 与 version.json 一起重建）
find "$OUT" -maxdepth 1 \( -name '*.fpk' -o -name '*.sha256' -o -name 'version.json' \) -delete

gh release download "$TAG" --dir "$OUT" --clobber
echo "已下载到 $OUT"

gh release view "$TAG" --json tagName,name,publishedAt,assets,url | python3 -c '
import sys, json, hashlib, os
d = json.load(sys.stdin)
out_dir = "website/downloads"
data = {
    "tag": d["tagName"],
    "name": d["name"],
    "publishedAt": d["publishedAt"][:10],
    "releasePage": d["url"],
    "assets": [],
}
for a in d["assets"]:
    if a["name"].endswith(".sha256"):
        continue
    p = os.path.join(out_dir, a["name"])
    if not os.path.exists(p):
        continue
    data["assets"].append({
        "name": a["name"],
        "size": os.path.getsize(p),
        "sha256": hashlib.sha256(open(p, "rb").read()).hexdigest(),
    })
with open(os.path.join(out_dir, "version.json"), "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
print("version.json:", data["tag"], "→", ", ".join(a["name"] for a in data["assets"]))
'

# 2) 把官网 HTML 里的静态兜底值也改掉。
# 这一步必须自动做：scripts 里会删掉旧版本的包，如果 index.html 还指着旧文件名，
# 一旦 version.json 拉不到（无脚本、断网、首帧未水合）下载按钮就成了 404。
python3 - <<'PY'
import json, re, sys

data = json.load(open("website/downloads/version.json", encoding="utf-8"))
assets = [a for a in data.get("assets", []) if a.get("name", "").endswith(".fpk")]
if not assets:
    sys.exit("官网同步失败：version.json 里没有安装包记录")
asset = assets[-1]
tag, name, sha, date = data["tag"], asset["name"], asset["sha256"], data["publishedAt"]

path = "website/index.html"
html = open(path, encoding="utf-8").read()
edits = [
    (r"<b>v[0-9][0-9.]*</b>(?= · 开源 · 零依赖)", "<b>%s</b>" % tag, 1),
    (r'(href=")downloads/[^"]*\.fpk(")', "\\g<1>downloads/%s\\g<2>" % name, 2),
    (r"<span data-ver>v[0-9][0-9.]*</span>", "<span data-ver>%s</span>" % tag, 1),
    (r"<span data-date>[0-9][0-9-]*</span>", "<span data-date>%s</span>" % date, 1),
    (r'<code data-name="all">[^<]*</code>', '<code data-name="all">%s</code>' % name, 1),
    (r"<pre data-sha>[^<]*</pre>", "<pre data-sha>%s  %s</pre>" % (sha, name), 1),
]
for pattern, repl, expected in edits:
    html, hits = re.subn(pattern, repl, html)
    if hits != expected:
        sys.exit("官网静态兜底改写失败：%s 命中 %d 次，预期 %d 次" % (pattern, hits, expected))
open(path, "w", encoding="utf-8").write(html)
print("index.html 静态兜底已同步到", tag, "→", name)
PY

echo
echo "别忘了提交： git add website/downloads website/index.html"
