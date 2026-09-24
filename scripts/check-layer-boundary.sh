#!/usr/bin/env bash
# 分层边界检查 —— 把宪法的「架构边界」从 code review 变成机械检查
#
# 用法：
#   bash scripts/check-layer-boundary.sh <项目目录> <语言>
#   bash scripts/check-layer-boundary.sh examples/taskflow ts
#   bash scripts/check-layer-boundary.sh examples/focuslog py
#
# 退出码：0 = 边界完好；1 = 有越界；2 = 定位不到源码目录
#         3 = 项目尚未实现，没有可检查的对象（跳过，不是通过）
#            —— run-all-gates.sh 的 gate() 依据这个约定把跳过从「通过」里分出来。
#
# ⚠️ 实现要点（这一条是本脚本最容易被写错的地方）：
#   不能直接在源码里 grep 模块名 —— 那样会把**注释和文档字符串里的提及**也算成违规。
#   例：state-machine.ts 的注释里写着「本文件不得 import fastify」，
#       naive 的 grep 会把这句话判成违规，导致门禁**每次都红**。
#   → 一旦门禁经常误报，团队就会把它关掉，然后连真正的违规也一起失去。
#   → 正确做法：先过滤出**真实的 import/require 行**，再在其中查模块名。
#
#   注释行判定：去掉前导空白后，以 * / // / /* / # 开头。

set -uo pipefail

ROOT="${1:-.}"
LANG="${2:-ts}"

FAIL=0
report() {
  echo "::error file=$1::$2"
  FAIL=1
}

# 过滤掉注释行（保留真实代码行）
#
# ⚠️ 必须考虑 grep -rn 输出的 `path:lineno:` 前缀 —— 否则 `^[[:space:]]*//` 永远匹配不到，
#    注释行不会被过滤。这个坑已经撞过一次（同一个误报修了两轮）。
strip_comments() {
  grep -vE '^[^:]*(:[0-9]+)?:[[:space:]]*([*#]|//|/\*)'
}

# 判断该不该检查这一层。
#
# ⚠️ 必须先区分两种情况 —— 曾经把第一种当第二种报，造成一个真实的误报：
#
#   ① 项目**还没有代码**（只有 spec，spec-first 阶段的正常状态）
#      → 跳过，不是失败。分层检查是在检查实现，没有实现就没什么可检查的。
#   ② 项目**有 src，但层目录没按约定命名**
#      → 真错误，必须报。此时说明目录结构与宪法不一致。
#
# 判据必须是「$ROOT/src 是否存在」，而不是「层目录是否存在」——
# 后者会把情况 ① 误判为情况 ②。
require_layers() {
  local domain="$1"
  if [ ! -d "$ROOT/src" ]; then
    echo "· 跳过：$ROOT 下没有 src/ 目录（该项目目前只有规格，尚未实现）"
    echo "  分层边界检查的对象是实现，不是规格 —— 实现出现后本检查自动生效。"
    # 必须退出 3 而不是 0：0 在 run-all-gates 的总结里就是「通过」，
    # 而「跳过」和「通过」是两件事（见 examples/focuslog/README.md 的原文）。
    exit 3
  fi
  if [ ! -d "$domain" ]; then
    echo "::error::找不到 $domain（但 $ROOT/src 存在 → 目录结构不符合约定的分层）"
    echo "  约定：<项目>/src/<层>/…。若本项目采用其他结构，请同步本脚本与宪法。"
    exit 2
  fi
}

case "$LANG" in
  ts)
    DOMAIN="$ROOT/src/domain"
    require_layers "$DOMAIN"

    # ── 规则 1：domain 不得 import 框架或外层模块 ──
    # 先取出真实的 import/export-from/require 行，再在其中匹配模块说明符
    IMPORT_LINES=$(grep -rEn "^[[:space:]]*(import|export)[[:space:]]" "$DOMAIN" 2>/dev/null | strip_comments || true)
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      report "${line%%:*}" "domain 层越界 import：${line#*:*:}"
    done < <(printf '%s\n' "$IMPORT_LINES" \
             | grep -E "from[[:space:]]*['\"][^'\"]*(fastify|pg|repositories|services|routes)" || true)

    # ── 规则 2：domain 不得有 IO / 环境读取（排除注释）──
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      report "${line%%:*}" "domain 层出现 IO 或副作用：${line#*:*:}"
    done < <(grep -rEn '\b(process\.env|Date\.now|readFile|writeFile|createReadStream)\b' "$DOMAIN" 2>/dev/null \
             | strip_comments || true)

    # ── 规则 3：routes 不得直连 repositories ──
    ROUTES="$ROOT/src/routes"
    if [ -d "$ROUTES" ]; then
      while IFS= read -r line; do
        [ -z "$line" ] && continue
        report "${line%%:*}" "routes 层不得直接访问 repositories"
      done < <(grep -rEn "^[[:space:]]*import[[:space:]]" "$ROUTES" 2>/dev/null \
               | strip_comments \
               | grep -E "from[[:space:]]*['\"][^'\"]*repositories" || true)
    fi
    ;;

  py)
    DOMAIN="$ROOT/src/focuslog/domain"
    # 注意传入的是 `project/src` 而非层目录本身 —— require_layers 需要先判断 src 在不在
    PY_SRC="$ROOT/src"
    if [ ! -d "$PY_SRC" ]; then
      echo "· 跳过：$ROOT 下没有 src/ 目录（该项目目前只有规格，尚未实现）"
      echo "  分层边界检查的对象是实现，不是规格 —— 实现出现后本检查自动生效。"
      exit 3 # 同 require_layers：跳过必须能被 run-all-gates 识别，不能混进「通过」
    fi
    [ -d "$DOMAIN" ] || {
      echo "::error::找不到 $DOMAIN（但 $ROOT/src 存在 → 目录结构不符合约定的分层）"
      echo "  约定：examples/focuslog/src/focuslog/<层>/…"
      exit 2
    }

    # ── 规则 1：domain 不得有 IO（只匹配真实代码行，排除注释与 docstring）──
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      report "${line%%:*}" "domain 层出现 IO 调用：${line#*:*:}"
    done < <(grep -rEn '\b(open|Path|json\.load|json\.dump|os\.)\b' "$DOMAIN" 2>/dev/null \
             | strip_comments || true)

    # ── 规则 2：domain 不得 import storage / render / cli ──
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      report "${line%%:*}" "domain 层越界 import：${line#*:*:}"
    done < <(grep -rEn "^[[:space:]]*(from|import)[[:space:]]" "$DOMAIN" 2>/dev/null \
             | strip_comments \
             | grep -E '^[^:]+:[0-9]+:[[:space:]]*(from|import)[[:space:]]+.*(storage|render|cli)' || true)

    # ── 规则 3：domain 不得直接读系统时钟（宪法要求时间可注入）──
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      report "${line%%:*}" "调用系统时钟，违反「时间可注入」：${line#*:*:}"
    done < <(grep -rEn 'datetime\.now|time\.time' "$DOMAIN" 2>/dev/null \
             | strip_comments || true)
    ;;

  *)
    echo "::error::不支持的语言: $LANG（支持 ts / py）"
    exit 2
    ;;
esac

if [ "$FAIL" -eq 1 ]; then
  echo ""
  echo "❌ 分层边界被破坏。修复方式：把 IO / 框架依赖移到外层，domain 只保留纯函数。"
  echo "   参见宪法「架构边界」一节。"
  exit 1
fi

echo "✅ 分层边界完好（$LANG / $ROOT）"
exit 0
