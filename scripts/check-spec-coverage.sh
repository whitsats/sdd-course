#!/usr/bin/env bash
# 验收标准覆盖率校验 —— spec-anchored 的标志性门禁
#
# 用途：比对 spec.md 中的验收标准条数与「验收标准-测试映射.md」的行数。
#      两者不等 = 有验收标准没有测试 = 阻断合并。
#
# 用法：
#   bash scripts/check-spec-coverage.sh <项目目录>            # 只查活跃 feature
#   bash scripts/check-spec-coverage.sh <项目目录> --all      # 查全部 feature
#   bash scripts/check-spec-coverage.sh examples/taskflow
#
# 多 feature 处理（默认模式）：
#   检查「活跃 feature」——即 .specify/feature.json 指向的那个；
#   若没有该文件，则取编号最小的。理由：Spec Kit 本身也是靠这个状态文件解析上下文。
#
# 映射表归属规则：
#   ① 优先用 feature 目录自己的  <feature>/docs/验收标准-测试映射.md
#   ② 否则用项目级的           <项目>/docs/验收标准-测试映射.md
#      但**仅当该文件明确声明了对应本 feature 时**才使用
#      （判定方式：文件内容中出现本 feature 的目录名，如 "001-taskflow-mvp"）
#   ③ 都不满足 → 报「该 feature 尚未规划」，视为失败
#   这条规则防的是：第二个 feature 拿第一个 feature 的映射表去比对，
#   得出一个看起来像覆盖率问题、实际是归属错乱的结论。
#
# 退出码：0 = 覆盖完整；1 = 不完整；2 = 配置问题

set -uo pipefail

ROOT="${1:-.}"
MODE="${2:-active}"

if [ ! -d "$ROOT/specs" ]; then
  echo "::error::$ROOT/specs 不存在"
  exit 2
fi

# ── 定位要检查的 feature 目录（find 返回的路径已含 $ROOT，不要再拼一次）──
FEATURES=()
if [ "$MODE" = "--all" ]; then
  while IFS= read -r d; do [ -n "$d" ] && FEATURES+=("$d"); done \
    < <(find "$ROOT/specs" -mindepth 1 -maxdepth 1 -type d | sort)
else
  ACTIVE=""
  if [ -f "$ROOT/.specify/feature.json" ]; then
    ACTIVE=$(grep -o '"feature_directory"[^,}]*' "$ROOT/.specify/feature.json" \
             | sed 's/.*: *"//; s/"$//' || true)
  fi
  if [ -n "$ACTIVE" ] && [ -d "$ROOT/$ACTIVE" ]; then
    FEATURES+=("$ROOT/$ACTIVE")
  elif [ -n "$ACTIVE" ] && [ -d "$ACTIVE" ]; then
    FEATURES+=("$ACTIVE")
  else
    FIRST=$(find "$ROOT/specs" -mindepth 1 -maxdepth 1 -type d | sort | head -n 1 || true)
    [ -n "$FIRST" ] && FEATURES+=("$FIRST")
  fi
fi

if [ "${#FEATURES[@]}" -eq 0 ]; then
  echo "::error::在 $ROOT/specs 下找不到任何 feature 目录"
  exit 2
fi

FAIL=0

for FEAT in "${FEATURES[@]}"; do
  NAME=$(basename "$FEAT")
  SPEC="$FEAT/spec.md"

  echo "── $NAME ──"

  if [ ! -f "$SPEC" ]; then
    echo "::error::$FEAT 下找不到 spec.md"
    FAIL=1; echo ""; continue
  fi

  # ── 解析映射表（含归属校验）──
  MAP=""
  if [ -f "$FEAT/docs/验收标准-测试映射.md" ]; then
    MAP="$FEAT/docs/验收标准-测试映射.md"
  elif [ -f "$ROOT/docs/验收标准-测试映射.md" ]; then
    CANDIDATE="$ROOT/docs/验收标准-测试映射.md"
    if grep -q "$NAME" "$CANDIDATE"; then
      MAP="$CANDIDATE"
    else
      echo "::warning::$CANDIDATE 未声明对应 $NAME，跳过（不拿别人的映射表比对）"
    fi
  fi

  if [ -z "$MAP" ]; then
    echo "::error::$NAME 尚未规划：找不到对应它的验收标准-测试映射.md"
    echo "          （这是预期行为，若该 feature 还没走到 /speckit-plan）"
    FAIL=1; echo ""; continue
  fi

  SPEC_COUNT=$(grep -cE '^\|[[:space:]]*[0-9]+\.[0-9]+[[:space:]]*\|' "$SPEC" || true)
  MAP_COUNT=$(grep -cE '^\|[[:space:]]*[0-9]+\.[0-9]+[[:space:]]*\|' "$MAP" || true)

  echo "spec:  $(realpath --relative-to=. "$SPEC" 2>/dev/null || echo "$SPEC")"
  echo "map:   $(realpath --relative-to=. "$MAP"  2>/dev/null || echo "$MAP")"
  echo "标准条数: $SPEC_COUNT   映射行数: $MAP_COUNT"

  if [ "$SPEC_COUNT" -eq "$MAP_COUNT" ]; then
    echo "✅ 覆盖完整"
    echo ""
    continue
  fi

  FAIL=1
  echo ""
  echo "::error::覆盖率不完整：spec 有 $SPEC_COUNT 条标准，映射表有 $MAP_COUNT 行。"

  TMP_SPEC=$(mktemp); TMP_MAP=$(mktemp)
  grep -oE '^\|[[:space:]]*[0-9]+\.[0-9]+' "$SPEC" | tr -d '| ' | sort -u > "$TMP_SPEC"
  grep -oE '^\|[[:space:]]*[0-9]+\.[0-9]+' "$MAP"  | tr -d '| ' | sort -u > "$TMP_MAP"

  MISSING=$(comm -23 "$TMP_SPEC" "$TMP_MAP" || true)
  EXTRA=$(comm -13 "$TMP_SPEC" "$TMP_MAP" || true)

  [ -n "$MISSING" ] && { echo "缺少测试映射的标准编号："; echo "$MISSING" | sed 's/^/  - /'; }
  [ -n "$EXTRA" ]   && { echo "映射表有、spec 没有的编号（spec 改了但映射表没跟上？）："; echo "$EXTRA" | sed 's/^/  - /'; }

  rm -f "$TMP_SPEC" "$TMP_MAP"
  echo ""
done

if [ "$FAIL" -eq 0 ]; then
  echo "✅ 全部 feature 覆盖完整"
fi
exit "$FAIL"
