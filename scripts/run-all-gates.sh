#!/usr/bin/env bash
# 一键跑完本仓库的全部门禁 —— 课程的「总验收」
#
# 用法：
#   bash scripts/run-all-gates.sh              # 跑全部
#   bash scripts/run-all-gates.sh --quiet      # 只输出结论
#
# 退出码：0 = 全绿；1 = 有门禁变红
#
# ⛔ 重要：本脚本**不做任何写操作**（不生成、不改文件）。
#    需要重新生成的步骤交给 verify-generated.sh 自己在临时目录里做。
#    理由是「检查脚本不该有副作用」—— 有副作用的检查会在 CI 里制造假绿灯。

set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

QUIET=0
[ "${1:-}" = "--quiet" ] && QUIET=1

PASS=0
FAIL=0
declare -a FAILED_NAMES=()

# ── 输出工具 ──────────────────────────────────────────────────────────────
say()  { [ "$QUIET" = 1 ] || printf '%s\n' "$*"; }
head() { [ "$QUIET" = 1 ] || printf '\n\033[1m%s\033[0m\n' "$*"; }

# gate <名称> <命令...>
gate() {
  local name="$1"; shift
  local out
  if out="$("$@" 2>&1)"; then
    PASS=$((PASS + 1))
    printf '  \033[32m✔\033[0m %s\n' "$name"
  else
    FAIL=$((FAIL + 1))
    FAILED_NAMES+=("$name")
    printf '  \033[31m✖\033[0m %s\n' "$name"
    if [ "$QUIET" = 0 ]; then
      printf '%s\n' "$out" | sed 's/^/      /' | tail -12
    fi
  fi
}

# ══════════════════════════════════════════════════════════════════════════
head "① 门禁脚本自身可执行"
for f in scripts/*.sh; do
  gate "可执行性：$f" bash -n "$f"
done

# ══════════════════════════════════════════════════════════════════════════
# 覆盖率门禁 —— spec-anchored 的标志性门禁（L07 / L09）
#
# 它比对：spec.md 里的验收标准条数 与 映射表的行数。
# 不等 = 有标准没有测试 = 必须阻断。
# ══════════════════════════════════════════════════════════════════════════
head "② 验收标准覆盖率（spec ↔ 测试映射）"
for P in examples/focuslog examples/taskflow examples/rulesmith; do
  [ -d "$P" ] || continue
  gate "覆盖率：$P" bash scripts/check-spec-coverage.sh "$P"
done

# ══════════════════════════════════════════════════════════════════════════
# 分层边界 —— 把宪法的架构条款从 code review 变成机械检查（L02）
# ══════════════════════════════════════════════════════════════════════════
head "③ 分层边界"
gate "分层：taskflow (ts)"  bash scripts/check-layer-boundary.sh examples/taskflow ts
gate "分层：focuslog (py)"  bash scripts/check-layer-boundary.sh examples/focuslog py

# ══════════════════════════════════════════════════════════════════════════
# 生成物一致性 —— spec-as-source 的机械守卫（L10）
#
# ⚠️ 这个脚本会重新生成（在项目目录里），所以放在后面单独执行。
#    它的内部顺序是「先快照 → 再生成 → 再对比」，顺序不能反：
#    先生成会把手工修改静默覆盖掉，然后报「通过」。
# ══════════════════════════════════════════════════════════════════════════
head "④ 生成物可复现性（spec-as-source）"
if command -v node >/dev/null 2>&1; then
  gate "生成物：rulesmith" \
    bash scripts/verify-generated.sh examples/rulesmith "node tools/generator/index.ts" src/generated
else
  say "  \033[33m·\033[0m 跳过（未找到 node ≥ 23）"
fi

# ══════════════════════════════════════════════════════════════════════════
# 产物行为测试 —— 生成器的测试 + 生成代码的测试
# ══════════════════════════════════════════════════════════════════════════
head "⑤ 测试套件"
if command -v node >/dev/null 2>&1; then
  gate "测试：rulesmith（生成器 + 产物，含幂等性与构建期校验）" \
    bash -c 'cd examples/rulesmith && node --test tests/*.spec.ts'
else
  say "  \033[33m·\033[0m 跳过（未找到 node ≥ 23）"
fi

# ══════════════════════════════════════════════════════════════════════════
head "⑥ 密钥泄漏自查"
# 任何文件都不该包含 sk- 开头的长字符串
if grep -rn "sk-[A-Za-z0-9]\{20,\}" \
     --include='*.md' --include='*.ts' --include='*.sh' --include='*.py' --include='*.json' \
     . 2>/dev/null | grep -v '^\./\.git/' > /tmp/_leak.txt; then
  FAIL=$((FAIL + 1))
  FAILED_NAMES+=("密钥泄漏")
  printf '  \033[31m✖\033[0m 发现疑似密钥：\n'
  sed 's/^/      /' /tmp/_leak.txt
else
  PASS=$((PASS + 1))
  printf '  \033[32m✔\033[0m 无 sk- 形式的密钥'
fi

# ══════════════════════════════════════════════════════════════════════════
head "⑦ 文档内部链接"
gate "链接校验" bash -c '
  fail=0
  for f in $(find . -name "*.md" -not -path "./.git/*" -not -path "./.freebuff/*"); do
    d=$(dirname "$f")
    for link in $(grep -o "](\([^)]*\.md\)[^)]*)" "$f" 2>/dev/null \
                  | sed "s/](//; s/)$//; s/#.*//" | grep "\.md$" | grep -v "^http"); do
      case "$link" in
        /*) target=".$link" ;;
        *)  target="$d/$link" ;;
      esac
      [ -e "$target" ] || { echo "  断链: $f -> $link"; fail=1; }
    done
  done
  [ "$fail" = 0 ] && echo "  全部内部链接可解析"
  exit $fail
'

# ══════════════════════════════════════════════════════════════════════════
printf '\n\033[1m总结\033[0m\n'
printf '  通过 %d   失败 %d\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  printf '  失败项：\n'
  for n in "${FAILED_NAMES[@]}"; do printf '    - %s\n' "$n"; done
  printf '\n  ⚠️ 注意：**不要为了让这个脚本变绿而改它的期望值。**\n'
  printf '     若某个门禁是误报，正确做法是修它或删它 —— 见 reference/anti-patterns.md AP-18。\n'
  exit 1
fi

printf '  \033[32m✅ 全部门禁通过\033[0m\n'
exit 0
