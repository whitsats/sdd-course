#!/usr/bin/env bash
# 变更热点排序 —— 存量改造（L11）时决定「给哪些模块补规格」
#
# 核心原则：规格的价值 ≈ 该意图被复用的次数 × 违背它的代价。
#          半年不动的模块，规格优先级是 0。
#
# 用法：
#   bash scripts/find-change-hotspots.sh [仓库路径] [月数] [Top N]
#   bash scripts/find-change-hotspots.sh . 6 20
#
# 输出：按提交数降序的模块清单 + 建议的补规格范围（前 20%）

set -euo pipefail

REPO="${1:-.}"
MONTHS="${2:-6}"
TOP="${3:-20}"

cd "$REPO"

if [ ! -d .git ]; then
  echo "::error::$REPO 不是 git 仓库"
  exit 2
fi

SINCE=$(date -d "$MONTHS months ago" +%Y-%m-%d 2>/dev/null \
     || date -v-${MONTHS}m +%Y-%m-%d 2>/dev/null \
     || echo "")

if [ -z "$SINCE" ]; then
  echo "::error::无法计算起始日期，请手动传入"
  exit 2
fi

echo "统计窗口：$SINCE 起（$MONTHS 个月）"
echo ""

# 取每个文件的改动次数，按顶层两级目录聚合
git log --since="$SINCE" --name-only --pretty=format: \
  | grep -v '^$' \
  | awk -F'/' '{
      if (NF >= 3) print $1"/"$2"/";
      else if (NF == 2) print $1"/";
      else print "(root)/";
    }' \
  | sort | uniq -c | sort -rn > /tmp/hotspots_all.txt

TOTAL=$(awk '{s+=$1} END {print s+0}' /tmp/hotspots_all.txt)
if [ "$TOTAL" -eq 0 ]; then
  echo "窗口内没有提交。结论：这个仓库不需要补规格 —— 优先级为 0。"
  exit 0
fi

echo "=== Top $TOP 变更热点模块 ==="
printf "%-44s %6s %7s\n" "模块" "提交数" "占比"
head -n "$TOP" /tmp/hotspots_all.txt | while read -r count module; do
  pct=$(awk -v c="$count" -v t="$TOTAL" 'BEGIN{printf "%.1f%%", c*100/t}')
  printf "%-44s %6s %7s\n" "$module" "$count" "$pct"
done

# 前 20%
N20=$(awk -v n="$(wc -l < /tmp/hotspots_all.txt)" 'BEGIN{m=int(n*0.2); if(m<1) m=1; print m}')

echo ""
echo "=== 建议补规格范围（前 20%，共 $N20 个模块）==="
head -n "$N20" /tmp/hotspots_all.txt | awk '{print "  ✅ "$2"  ("$1" 次提交)"}'

echo ""
echo "=== 明确不补规格（长尾）==="
tail -n +$((N20 + 1)) /tmp/hotspots_all.txt | head -n 10 \
  | awk '{print "  ❌ "$2"  ("$1" 次提交) —— 优先级 0，等要改它时再补"}'

echo ""
echo "提示：长尾里出现 0 次提交的模块（在用 git log 全量统计时可见）永远不补规格。"
rm -f /tmp/hotspots_all.txt
