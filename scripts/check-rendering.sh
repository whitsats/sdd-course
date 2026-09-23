#!/usr/bin/env bash
# 渲染完整性检查 —— 抓「构建绿、页面坏」的那一类问题
#
# 用法：
#   bash scripts/check-rendering.sh           # 查源码（site-out/ 存在时顺带查产物）
#   bash scripts/check-rendering.sh --site    # 强制要求产物，缺 site-out/ 直接失败
#
# 退出码：0 = 通过；1 = 有问题
#
# ⛔ 与其它门禁一样，本脚本**只读**：不构建、不写文件。

# ────────────────────────────────────────────────────────────────────────────
# 为什么需要这个门禁
#
# 折叠块（`<details>`）在 Zensical / CommonMark 下有一个致命细节：
#
#   <details>               ← 内容**不解析 markdown**，原样输出
#   <details markdown="1">  ← 内容正常解析
#
# 这个坑的危险之处在于它的形状 ——
#   构建 ✅ 通过（--strict 也不报）→ 产物 ✅ 生成 → CI ✅ 全绿
#   而页面上是一整块没格式的文本，`**加粗**` 的星号肉眼可见。
#   **没有任何自动化环节会报警，只有人打开页面才看得见。**
#
# 实测对照（同一份内容、四种写法，看生成的 HTML）：
#
#   A  <details>                     → 内容原样输出，`**缺口**` 的星号留在页面上 ❌
#   B  <details markdown="1">        → <ol><li>因为<strong>缺口</strong>…</li></ol> ✅
#   C  ??? note "答案"（缩进 4 空格） → <details class="note">… 内容解析 ✅ 且有主题样式
#   D  ???+ note "答案"              → 同上，且 open（默认展开）✅
#
# 三种正确写法都行，但**必须是有意选择的一种**，不能是「随手写了 <details>」。
# 本脚本只强制一条：裸 `<details>` 不允许出现 —— 它一定是漏了，不可能是故意。
#
# 已核对：本仓库 12 节课的「自测答案」折叠块当初全部是写法 A，
# 站点上线后才在页面上发现。这个门禁就是那次事故留下的。
# ────────────────────────────────────────────────────────────────────────────
#
# 写这个脚本时自己踩的两个 awk 坑（都留在这里，因为很容易再犯）：
#
#   ① 状态变量会**跨文件泄漏**。awk 处理完 file1 接着处理 file2，
#      `fence` 之类的变量不会自动归零。本仓库
#      `examples/rulesmith/specs/001-rulesmith-dsl/plan.md` 恰好有 7 行围栏标记（奇数），
#      处理完后 `fence` 停在 1 —— 于是**它之后的所有文件都被当成「代码块内」跳过**，
#      包括全部 12 节讲义，脚本报「一切正常」。
#      → 必须 `FNR == 1 { 重置 }`。
#      这个 bug 的形状值得记住：**它让检查静默失效，而不是报错。**
#
#   ② `END` 块里的 `FILENAME` 是**最后一个文件**，不是报错的那个。
#      于是在 END 里 print FILENAME 会把所有问题都算到最后一个文件头上
#      （实测把 12 条问题全挂在 `templates/tasks-template/index.html` 上，
#      而那页里一个 `<details>` 都没有 —— 差点让我去改错的文件）。
#      → 在 `FNR == 1` 时把文件名存进自己的变量。
#
#   ③ **`close` 是 awk 的内建函数名，不能拿来当变量。**
#      写 `close += gsub(...)` 会让 awk 直接语法错误退出；
#      而脚本里习惯性的 `2>/dev/null` 把错误吞了 —— 于是那段检查**从未运行过**，
#      `UNCLOSED` 永远是空字符串，看着像「一切正常」。
#      实测：把一节讲义的折叠块改成只开不闭，门禁依然绿灯。
#      → 变量改用 `n_open` / `n_close`。
#
#      ③ 比 ①② 更值钱的地方在于：它演示了门禁最危险的失效模式 ——
#      不是误报（误报会被人发现并修掉），而是**静默不检查**：
#      它每次都绿，而且看起来在工作。唯一的防御是「故意弄坏，看它红不红」。

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1

WANT_SITE=0
[ "${1:-}" = "--site" ] && WANT_SITE=1

FAIL=0

# ── 让「检查自己坏了」变成红灯，而不是静默绿灯 ───────────────────────────────
# 这个兜底是必需的：本脚本的初版把 awk 的报错丢给了 2>/dev/null，
# 而那段 awk 恰好因为变量名撞上内建函数（close）而语法错误 ——
# 结果它**从未运行过**，却每次都返回「通过」。
# 门禁最危险的失效模式不是误报，是静默不检查。
AWK_ERR=$(mktemp)
trap 'rm -f "$AWK_ERR"' EXIT

awk_guard() {  # awk_guard <这是什么检查>
  if [ -s "$AWK_ERR" ]; then
    printf '::error::检查自身出错（%s）—— awk 报错了，下面的结论不可信：\n' "$1"
    sed 's/^/    /' "$AWK_ERR"
    FAIL=1
  fi
  : > "$AWK_ERR"
}

SRC_FILES=$(find lessons reference projects templates examples scripts \
              -name '*.md' 2>/dev/null | sort)

# ── ① 源码：不允许裸 <details> ───────────────────────────────────────────────
# 两类不算数，否则就是误报：
#   · 代码围栏内的示例（讲义就在教怎么写）
#   · **行内代码里的提及** —— 本文件自己就写着 「`<details>` 折叠块」，
#     第一版没过滤它，于是文档把自己报成了错。
#     误报的代价见 L09 §3：经常误报的门禁会被关掉，然后连真话也一起失去。
BARE=$(printf '%s\n' "$SRC_FILES" | tr '\n' '\0' | xargs -0 awk '
  FNR == 1 { fence = 0 }                       # ← 不重置就会静默失效（见头部注释①）
  /^[[:space:]]*(```|~~~)/ { fence = !fence; next }
  fence { next }
  {
    line = $0
    gsub(/`[^`]*`/, "", line)                # 去掉行内代码片段
    gsub(/&lt;[^&]*&gt;/, "", line)            # 去掉已转义的写法 &lt;details&gt;
    if (line ~ /<details[^>]*>/ && line !~ /markdown=/) print FILENAME ":" FNR ": " $0
  }
' 2>"$AWK_ERR")
awk_guard "裸 <details> 检查"

# ── ② 源码：折叠块开闭必须成对 ───────────────────────────────────────────────
# 只开不闭会把后面整页内容吞进折叠块里 —— 同样是「构建不报、页面变形」。
UNCLOSED=$(printf '%s\n' "$SRC_FILES" | tr '\n' '\0' | xargs -0 awk '
  FNR == 1 {
    if (NR > 1 && n_open != n_close) print prev ": 开 " n_open " / 闭 " n_close
    prev = FILENAME; n_open = 0; n_close = 0   # ← 逐文件结算，不用 END 的 FILENAME
    fence = 0
  }
  /^[[:space:]]*(```|~~~)/ { fence = !fence; next }
  fence { next }
  {
    line = $0
    gsub(/`[^`]*`/, "", line)                # 同上：行内代码里的提及不算
    n_open  += gsub(/<details[^>]*>/, "&", line)
    n_close += gsub(/<\/details>/, "&", line)  # ⚠️ 不能叫 close：awk 内建函数名
  }
  END { if (n_open != n_close) print prev ": 开 " n_open " / 闭 " n_close }
' 2>"$AWK_ERR")
awk_guard "折叠块成对检查"

# ── ③ 产物：折叠块内容必须真的被解析（内容里应出现块级标签） ─────────────────
SITE_ISSUES=""
SITE_CHECKED=0
if [ "$WANT_SITE" = 1 ] && [ ! -d site-out ]; then
  echo "::error::--site 要求先构建，但缺 site-out/。先跑："
  echo "    python tools/build_site.py && uvx --with-requirements requirements-docs.txt zensical build --clean"
  FAIL=1
elif [ -d site-out ]; then
  SITE_CHECKED=1
  SITE_ISSUES=$(find site-out -name '*.html' -print0 | xargs -0 awk '
    # ⚠️ all 必须逐文件清空：它与 fence 是同一类坑（见头部注释①）。
    #    清了 fname 却不清内容，上一页的折叠块会被算到下一页头上 ——
    #    报错位置指向错误的文件，比不报还难查。
    FNR == 1 { fname = FILENAME; all = "" }   # ← 见头部注释②
    { all = all $0 "\n" }
    END {
      pos = 1
      while ((i = index(substr(all, pos), "<details")) > 0) {
        start = pos + i - 1
        j = index(substr(all, start), "</details>")
        if (j == 0) { print fname ": 折叠块未闭合"; break }
        block = substr(all, start, j + 9)
        if (block !~ /<(p|ol|ul|pre|table|blockquote|div)[ >]/) {
          print fname ": 折叠块内容未被解析（内容里没有任何块级标签）"
        }
        pos = start + j + 9
      }
    }
  ' 2>"$AWK_ERR")
  awk_guard "构建产物折叠块检查"
fi

# ── 汇总 ─────────────────────────────────────────────────────────────────────
if [ -n "$BARE" ]; then
  echo "::error::发现裸 <details>（内容不会被解析成 markdown）—— 改成 <details markdown=\"1\">"
  printf '%s\n' "$BARE" | sed 's/^/    /'
  FAIL=1
fi

if [ -n "$UNCLOSED" ]; then
  echo "::error::折叠块数量不配对："
  printf '%s\n' "$UNCLOSED" | sed 's/^/    /'
  FAIL=1
fi

if [ -n "$SITE_ISSUES" ]; then
  echo "::error::构建产物里有未解析的折叠块（源码已修但没重新构建？）"
  printf '%s\n' "$SITE_ISSUES" | sed 's/^/    /'
  FAIL=1
fi

if [ "$FAIL" = 0 ]; then
  # 计数必须用**和检查同一套规则**（跳过围栏、剔掉行内代码里的提及），
  # 否则会报出一个虚高的数字 —— 数字错了，进度感就假了。
  n=$(printf '%s\n' "$SRC_FILES" | tr '\n' '\0' | xargs -0 awk '
    FNR == 1 { fence = 0 }
    /^[[:space:]]*(```|~~~)/ { fence = !fence; next }
    fence { next }
    { line = $0; gsub(/`[^`]*`/, "", line); n += gsub(/<details[^>]*>/, "&", line) }
    END { print n+0 }
  ' 2>/dev/null)
  n=${n:-?}
  echo "✅ 渲染完整性：$n 个折叠块写法正确" \
       "$([ "$SITE_CHECKED" = 1 ] && echo '· 产物已检查' || echo '· 产物未构建，已跳过')"
fi

exit "$FAIL"
