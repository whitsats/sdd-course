#!/usr/bin/env bash
# 生成物可复现性校验 —— spec-as-source 的机械守卫
#
# 用法：
#   bash scripts/verify-generated.sh <项目目录> <生成命令> <生成物目录>
#   bash scripts/verify-generated.sh examples/rulesmith "node tools/generator/index.ts" src/generated
#
# 它要抓住的三件事（L10 §5）：
#   ① 有人手改了生成产物
#   ② 有人改了 spec 但忘了重新生成（git 里的产物是旧的）
#   ③ 生成不幂等（同一 spec 两次生成结果不同）
#
# ⚠️⚠️ 顺序至关重要：**必须先检测，再重新生成。**
#
#   第一版脚本是「先重新生成，再 git diff」—— 这是错的。
#   因为重新生成会**把手改直接覆盖掉**，于是 git diff 变空，脚本报告「✅ 通过」。
#   → 它**修好了问题却报告没事**：手改被静默吞掉，作者永远不知道发生过。
#   这类「看起来在工作、实际什么都没检测」的门禁，比没有门禁更危险。
#
#   正确顺序：
#     a. 快照当前产物
#     b. 重新生成
#     c. 对比「快照」与「重新生成的结果」 → 不同 = 手改 或 产物已过期（真信号）
#     d. 再 git diff → 非空 = 重新生成的结果没被提交（另一个真信号）
#
# 退出码：0 = 一切正常；1 = 检出问题；2 = 配置问题（不是生成物不一致）

set -uo pipefail

ROOT="${1:?用法: verify-generated.sh <项目目录> <生成命令> <生成物目录>}"
GEN_CMD="${2:?缺少生成命令}"
GEN_DIR="${3:?缺少生成物目录}"

cd "$ROOT"

# ── 前置检查：目录 ────────────────────────────────────────────────
if [ ! -d "$GEN_DIR" ]; then
  echo "::error::生成物目录不存在: $GEN_DIR"
  echo "   这是**配置问题**，不是生成物不一致。"
  exit 2
fi

FAIL=0

# ── ① DO NOT EDIT 标记（仅警告）─────────────────────────────────
echo "① 检查生成物的「不可手改」标记"
MISSING=0
while IFS= read -r f; do
  if ! head -n 5 "$f" | grep -qE 'DO NOT EDIT|请勿手动编辑|请勿手动修改'; then
    echo "::warning file=$f::缺少 DO NOT EDIT 标记，容易被误编辑"
    MISSING=1
  fi
done < <(find "$GEN_DIR" -type f)
[ "$MISSING" -eq 0 ] && echo "   ✅ 全部文件均带标记"

# ── ② 快照（在重新生成之前！）──────────────────────────────────
echo ""
echo "② 快照当前产物（在重新生成之前）"
SNAP=$(mktemp -d)
cp -r "$GEN_DIR/." "$SNAP/"
SNAP_FILES=$(find "$SNAP" -type f | wc -l | tr -d ' ')
echo "   已快照 $SNAP_FILES 个文件到临时目录"

# ── ③ 重新生成 ─────────────────────────────────────────────────
echo ""
echo "③ 重新生成"
if ! eval "$GEN_CMD"; then
  echo "::error::生成命令失败：$GEN_CMD"
  rm -rf "$SNAP"
  exit 1
fi

# ── ④ 核心检测：快照 vs 重新生成的结果 ──────────────────────────
echo ""
echo "④ 对比「快照」与「重新生成的结果」—— 这一步才真正检测手改"
if diff -r "$SNAP" "$GEN_DIR" > /tmp/gen_diff.txt 2>&1; then
  echo "   ✅ 产物与 spec 输出一致（无手改、无过期）"
else
  FAIL=1
  echo "::error::产物与 spec 输出**不一致**。两种可能："
  echo "       A. 有人手动编辑了 $GEN_DIR 下的文件（违反 spec-as-source）"
  echo "       B. 有人在改 spec 之前就手改了产物"
  echo ""
  echo "   差异详情（前 30 行）："
  head -30 /tmp/gen_diff.txt | sed 's/^/     /'
  echo ""
  echo "   修复（按情况 A 处理最稳）："
  echo "     git checkout -- $GEN_DIR    # 丢弃手改"
  echo "     # 若确实需要这个行为变更，请改 spec.md 再重新生成"
fi
rm -rf "$SNAP"

# ── ⑤ git 一致性：重新生成的结果有没有被提交 ────────────────────
echo ""
echo "⑤ 检查重新生成的结果是否已被提交"
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "::warning::$ROOT 不是 git 仓库，跳过此步（不影响上面的检测结果）"
else
  if git diff --quiet -- "$GEN_DIR"; then
    echo "   ✅ git 中的产物与当前 spec 一致"
  else
    FAIL=1
    echo "::error::重新生成的结果未被提交 —— 说明改了 spec 却没提交产物"
    git --no-pager diff --stat -- "$GEN_DIR" | sed 's/^/     /'
    echo "     修复：把重新生成的结果一并提交"
  fi
fi

# ── 结论 ──────────────────────────────────────────────────────
echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "✅ 生成物可复现，且未被手改"
  exit 0
fi
echo "❌ 检出问题，见上方 ::error:: 项"
exit 1
