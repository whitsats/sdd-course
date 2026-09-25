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
SKIP=0
declare -a FAILED_NAMES=()
declare -a SKIPPED_NAMES=()

# ── 输出工具 ──────────────────────────────────────────────────────────────
say()  { [ "$QUIET" = 1 ] || printf '%s\n' "$*"; }
head() { [ "$QUIET" = 1 ] || printf '\n\033[1m%s\033[0m\n' "$*"; }

# gate <名称> <命令...>
#
# 退出码约定：
#   0 = 通过；1（或其它） = 检查失败；3 = 这项检查**没有对象**（跳过）。
# 「3」由被调用的门禁自己声明（目前是 check-layer-boundary.sh 的「尚未实现」分支），
# 本函数只负责把它从「通过」里分出来。理由与 gate_soft 相同：
#   门禁最危险的失效不是报错，是沉默。跳过若被计成 ✔，
#   「没跑」与「跑过了」在总结行里就长得一模一样。
gate() {
  local name="$1"; shift
  local out rc
  out="$("$@" 2>&1)"; rc=$?
  if [ "$rc" -eq 0 ]; then
    PASS=$((PASS + 1))
    printf '  \033[32m✔\033[0m %s\n' "$name"
  elif [ "$rc" -eq 3 ]; then
    SKIP=$((SKIP + 1))
    # ⚠️ 取首行不能用 `head -n 1`：本脚本把 head 定义成了章节标题函数（见上），
    #    同名调用会吞掉管道输入。用 sed 取第一行。
    local reason
    reason=$(printf '%s\n' "$out" | sed -n 's/^·[[:space:]]*跳过[:：][[:space:]]*//p' | sed -n '1p')
    reason="${reason:-该项检查报告没有可检查的对象}"
    SKIPPED_NAMES+=("$name（$reason）")
    printf '  \033[33m○\033[0m %s —— 跳过：%s\n' "$name" "$reason"
  else
    FAIL=$((FAIL + 1))
    FAILED_NAMES+=("$name")
    printf '  \033[31m✖\033[0m %s\n' "$name"
    if [ "$QUIET" = 0 ]; then
      printf '%s\n' "$out" | sed 's/^/      /' | tail -12
    fi
  fi
}

# gate_soft <名称> <必需命令> <命令...>
#
# 用于「依赖可选工具链」的门禁（本项目里是 JDK/Maven）。它做一件事，而且只做一件事：
#   **工具链缺失时把跳过摆到台面上**，而不是让它从「通过」里静静消失。
#
# 为什么单独写一个函数，而不是在调用处 if 一下：
#   在调用处写 if，跳过就只是一个 printf —— 它不计入任何统计，总结行依然说「全绿」。
#   于是「没跑」与「跑过了」在输出上长得一模一样。这是本项目反复踩到的同一类问题：
#   **门禁最危险的失效不是报错，是沉默。**
#   所以跳过必须计入 SKIP，并在总结里单独占一行。
gate_soft() {
  local name="$1"; shift
  local requires="$1"; shift
  if ! command -v "$requires" >/dev/null 2>&1; then
    SKIP=$((SKIP + 1))
    SKIPPED_NAMES+=("$name（未找到 $requires）")
    printf '  \033[33m○\033[0m %s —— 跳过：未找到 %s\n' "$name" "$requires"
    return 0
  fi
  gate "$name" "$@"
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
# billflow 也在列：虽然 java-gate.yml 在 CI 里会跑它，但这个检查是纯文本比对，
# 不需要 JDK —— 本地总验收没有理由少验一个项目。
for P in examples/focuslog examples/taskflow examples/rulesmith examples/billflow examples/stockflow; do
  [ -d "$P" ] || continue
  gate "覆盖率：$P" bash scripts/check-spec-coverage.sh "$P"
done

# ══════════════════════════════════════════════════════════════════════════
# 分层边界 —— 把宪法的架构条款从 code review 变成机械检查（L02）
# 错误码投影 —— 机器可读规格层：实现不得发明 spec 里没有的错误码（L07 §7）
# ══════════════════════════════════════════════════════════════════════════
head "③ 分层边界与机器可读投影"
gate "分层：taskflow (ts)"  bash scripts/check-layer-boundary.sh examples/taskflow ts
gate "分层：focuslog (py)"  bash scripts/check-layer-boundary.sh examples/focuslog py
# 刻意单向：spec 声明了完整 API 的错误码，本仓库只提交了领域层 —— 反向查会红在本该绿的地方。
gate_soft "错误码投影：taskflow（自造码即红）" python \
  python scripts/check-error-codes.py examples/taskflow --impl examples/taskflow/src --impl examples/taskflow/tests

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

  # taskflow 的契约测试是可执行的：node:test + 领域层内存实现（tests/fixtures/harness.ts），
  # 零第三方依赖。每一条规则判定都走 src/domain/，harness 自己不实现规则。
  # ⚠️ 只点名这三个文件 —— 同目录的 drift-drill.spec.ts 是**故意失败**的漂移演练
  #    （L07 验收 ②：证明测试真的会红）。把它放进门禁 = 一条永远红的门禁
  #    = 必然被团队关掉，然后连真正的违规一起失去（AP-18）。
  gate "测试：taskflow（契约测试：14 格权限矩阵 + 状态机穷举 + 20 路并发冲突）" \
    bash -c 'cd examples/taskflow && node --no-warnings --test tests/contract/auth-matrix.spec.ts tests/contract/task-state.spec.ts tests/contract/task-concurrency.spec.ts'
else
  SKIP=$((SKIP + 1))
  SKIPPED_NAMES+=("测试：rulesmith（未找到 node）")
  say "  \033[33m○\033[0m 测试：rulesmith —— 跳过：未找到 node"
fi

# 项目 D（L13）：Java 侧的四层约束全部在 mvn verify 里 ——
# 编译期规格校验（注解处理器）+ ArchUnit 架构检查 + 751 个测试 + 构造器不变量。
# 它依赖 JDK 17 与 Maven，所以用 gate_soft：缺工具链时明确跳过，而不是假装通过。
# 走 check-java-build.sh 而不是直接 mvn：它会断言注解处理器真的执行过。
# 「处理器没跑」与「跑了没发现问题」在输出上完全一样（见脚本头部注释）。
gate_soft "测试：billflow（Java 编译期规格校验 + 架构 + 751 测试）" mvn \
  bash scripts/check-java-build.sh

# 项目 E（L14）：stockflow 的门禁分两条，因为它们验的不是同一件事。
#
# ① 测试套件（44 个）—— 验的是「行为符合规格」。
#    其中 16 个**不 import 应用代码**：它们直接用裸 SQL 打这个库，
#    证明的是「不经过我们的代码也拦得住」。
# ② 数据层强制力门禁 —— 验的是「约束这次到底有没有生效」。
#    它用命令行客户端直写 8 条脏数据（完全不加载 JS），
#    并且**先断言合法写入能成功** —— 否则一个只读的库也能让它全绿。
#
# 两条都要。只有 ① 不知道绕过路径上会发生什么；
# 只有 ② 不知道调用方拿到的是什么。
gate_soft "测试：stockflow（数据层 + 应用层，含 40 路并发争抢）" node \
  bash -c 'cd examples/stockflow && node --no-warnings --test tests/*.spec.mjs'
# 注意 node 的版本门：node:sqlite 需要 ≥ 22.5。
# 版本不够时「跑不了」与「跑了没问题」在输出上差别巨大，不能混为一谈 ——
# 所以 gate_soft 只在缺 node 时跳过；版本不够时本脚本会以 2 退出并说明原因。
gate_soft "数据层强制力：stockflow（八条直写 + 反假绿 + 守恒 + 巡检）" node \
  bash scripts/check-sql-enforcement.sh

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
  printf '  \033[32m✔\033[0m 无 sk- 形式的密钥\n'
fi

# ══════════════════════════════════════════════════════════════════════════
head "⑦ 渲染完整性"
# 这一条抓的是「构建绿、页面坏」：裸 <details> 会让折叠块内容不被解析成 markdown，
# 而构建、--strict、其它所有门禁**都不会报警**。上线后才在页面上发现过。
gate "折叠块写法" bash scripts/check-rendering.sh

# ══════════════════════════════════════════════════════════════════════════
head "⑧ 文档内部链接"
# ⚠ 判据两件事，都和①一致：
#   ① 先剥掉**代码围栏与行内代码** —— 文档里「提到」一个链接不是「写了」一个链接。
#      初版直接用 grep 拓，于是本节自己的说明文字（行内代码里 写着那个坏链接）
#      被当成了断链。**误报会让人关掉门禁（AP-18）**，所以先把判据修准。
#   ② 只扫源文件，不扫 `site-src/`（那是构建产物，同一处断链会被报两次）。
#
# ⚠ 本门禁验的是「文件在不在」，它会把 `#锚点` 先去掉 ——
#   所以它**不能**证明锚点是对的。实测就有一个手写的中文锚点直接跳不过去，
#   而这道门禁报「全部内部链接可解析」。
#   锚点的校验放在 check-rendering.sh ④：它对照 zensical 真实生成的 id
#   （中文标题的 id 是 `_N` 位置编号，不是中文 slug），且必须在构建之后跑。
gate "链接校验" bash -c '
  LINKS=$(find . -name "*.md" -not -path "./.git/*" -not -path "./.freebuff/*" \
            -not -path "./site-src/*" -not -path "./site-out/*" -print0 \
    | xargs -0 awk '"'"'
        FNR == 1 { fence = 0 }
        /^[[:space:]]*(```|~~~)/ { fence = !fence; next }
        fence { next }
        {
          line = $0
          gsub(/`[^`]*`/, "", line)        # 去掉行内代码片段
          while (match(line, /\]\([^)]*\.md[^)]*\)/)) {
            print FILENAME ":" FNR ":" substr(line, RSTART + 2, RLENGTH - 3)
            line = substr(line, RSTART + RLENGTH)
          }
        }'"'"')
  fail=0
  while IFS= read -r rec; do
    [ -n "$rec" ] || continue
    f=${rec%%:*}; rest=${rec#*:}; body=${rest#*:}
    case "$body" in http*) continue ;; esac
    link=${body%%#*}
    case "$link" in
      /*) target=".$link" ;;
      *)  target="$(dirname "$f")/$link" ;;
    esac
    [ -e "$target" ] || { echo "  断链: $f -> $body"; fail=1; }
  done <<< "$LINKS"
  [ "$fail" = 0 ] && echo "  全部内部链接可解析"
  exit $fail
'

# ══════════════════════════════════════════════════════════════════════════
printf '\n\033[1m总结\033[0m\n'
printf '  通过 %d   失败 %d   跳过 %d\n' "$PASS" "$FAIL" "$SKIP"

if [ "$SKIP" -gt 0 ]; then
  printf '  跳过项（**不等于通过**，原因见上）：\n'
  for n in "${SKIPPED_NAMES[@]}"; do printf '    - %s\n' "$n"; done
fi

if [ "$FAIL" -gt 0 ]; then
  printf '  失败项：\n'
  for n in "${FAILED_NAMES[@]}"; do printf '    - %s\n' "$n"; done
  printf '\n  ⚠️ 注意：**不要为了让这个脚本变绿而改它的期望值。**\n'
  printf '     若某个门禁是误报，正确做法是修它或删它 —— 见 reference/anti-patterns.md AP-18。\n'
  exit 1
fi

if [ "$SKIP" -gt 0 ]; then
  printf '  \033[32m✅ 已跑的门禁全部通过\033[0m（有 %d 项跳过 —— 每一项的原因见上）\n' "$SKIP"
else
  printf '  \033[32m✅ 全部门禁通过\033[0m\n'
fi
exit 0
