#!/usr/bin/env bash
# Java 构建门禁（examples/billflow）—— 并且**自证「规格校验真的跑了」**
#
# 用法：
#   bash scripts/check-java-build.sh
#
# 退出码：0 = 通过；1 = 失败（构建失败，**或注解处理器根本没运行**）
#
# 需要：JDK 17 + Maven（run-all-gates.sh 用 gate_soft 检查，缺工具链时计入跳过项）
#
# ────────────────────────────────────────────────────────────────────────────
# 为什么需要这个脚本，而不是一行 `mvn -q verify`：
#
#   项目 D 的核心机制是注解处理器在编译期校验 @Ac 引用的规格编号。
#   但「处理器跑了且没发现问题」与「处理器压根没跑」在输出上**完全一样**：
#   CI 全绿、测试全过、什么警告都没有。
#
#   实测过这条路径：进 billing-app 子目录单独跑构建时，编译器找不到 spec-guard，
#   会跳过注解处理 —— 构建依然成功。也就是说，**构建绿 ≠ 规格校验执行过**。
#
#   所以本脚本做三件事，顺序不能变：
#     ① 捕获完整输出（不用 -q，否则标记行会被吞掉）
#     ② 断言处理器打印的标记行存在 —— 不存在就直接失败，不管退出码是多少
#     ③ 再看退出码
#
#   ── 为什么是 `clean verify` 而不是 `verify` ──────────────────────────────
#
#   这条门禁**自己先踩了一次**：第一版写的是 `mvn -B verify`，在本地是绿的、
#   在干净 CI 上也是绿的 —— 但第二次在本地跑就红了。原因不是代码坏了，而是
#   Maven 的增量编译：
#
#       [INFO] Nothing to compile - all classes are up to date.
#
#   一个字节码都没重新生成，javac 自然没有加载注解处理器，标记行也就没有出现。
#   换句话说，「处理器跑了没发现问题」与「处理器没跑」的差别，在这里取决于
#   **上一次构建有没有留下 target/** —— 一个与本门禁意图完全无关的状态。
#
#   这类门禁必须自己保证「被检查的东西有机会发生」。`clean` 就是那个保证：
#   每次从零编译，处理器必然执行一次。代价是几秒钟，换来的是结论可比。
#   同理，CI 上也不要复用 target/ 缓存到这个步骤。
#
#   这是「门禁最危险的失效不是报错，而是沉默」在本案例里的具体形态，
#   也是本仓库第三次遇到同一类问题（前两次：覆盖率脚本静默覆盖手改、
#   渲染检查因 awk 变量名而静默不执行）。
# ────────────────────────────────────────────────────────────────────────────

set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

PROJECT="examples/billflow"
MARKER="规格校验：spec.md"

if [ ! -d "$PROJECT" ]; then
  echo "::error::$PROJECT 不存在（是不是只克隆了部分内容？）"
  exit 1
fi

LOG=$(mktemp)
trap 'rm -f "$LOG"' EXIT

# 必须在聚合根（examples/billflow）上跑，不要进子模块 —— 见文件头说明。
(
  cd "$PROJECT" || exit 1
  MAVEN_OPTS="-Dfile.encoding=UTF-8" mvn -B clean verify
) > "$LOG" 2>&1
RC=$?

# ── ② 先证明处理器运行过（与退出码无关）────────────────────────────────────
if ! grep -q "$MARKER" "$LOG"; then
  echo "::error::注解处理器没有运行，本次构建的「规格校验」等于没做。"
  echo "    构建退出码：$RC（可能仍是 0 —— 那正是危险之处）"
  echo "    常见原因（两种，都是静默的）："
  echo "      ① 没有在聚合根 examples/billflow 上跑构建。单独进 billing-app 目录时，"
  echo "         编译器找不到 spec-guard，会跳过注解处理。"
  echo "      ② 增量编译：本次一个字节码都没重新生成（日志里是 'Nothing to compile'），"
  echo "         于是处理器的校验也一次都没跑。本脚本用 clean 排除了这种可能，"
  echo "         若仍出现本提示，检查日志里有没有 Recompiling/Compiling。"
  echo "    输出末尾："
  tail -5 "$LOG" | sed 's/^/      /'
  exit 1
fi

grep -E "规格校验|Tests run: [0-9]+, Failures" "$LOG" | tail -3 | sed 's/^/  /'

# ── ③ 再看退出码 ──────────────────────────────────────────────────────────
if [ "$RC" -ne 0 ]; then
  echo "::error::构建失败（退出码 $RC）："
  grep -E "\[ERROR\]" "$LOG" | head -12 | sed 's/^/      /'
  exit 1
fi

echo "  ✅ Java 构建门禁通过（编译期规格校验确实运行过）"
exit 0
