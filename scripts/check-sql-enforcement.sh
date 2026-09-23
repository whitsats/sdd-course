#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
#  check-sql-enforcement.sh —— 证明「约束真的住在数据层」
#
#  用法：
#    bash scripts/check-sql-enforcement.sh
#
#  退出码：0 = 通过；1 = 有检查变红；2 = 缺少必需工具链
#
#  与 check-java-build.sh 同源的一条原则：
#  **它验证的不是「有没有约束」，而是「约束这次到底有没有生效」。**
#
#  四段检查：
#    ① 反假绿：经由应用的**合法**写入必须成功
#       （少了这一段，「所有写入都被拒绝」也能让②全绿 ——
#         一个把整库写成只读的 schema 同样能拦住脏数据）
#    ② 经由应用的非法写入必须被拒绝，且返回**稳定错误码**
#    ③ 不经应用的写入（裸客户端直写）：约束必须仍然生效
#    ④ 守恒等式与巡检查询必须为零行
#
#  ⚠️ ③ 的判定**依赖客户端**，这是本案例的核心发现（docs/adr/ADR-002）：
#     FOREIGN KEY 是唯一一种「schema 里有、但可能不生效」的约束 ——
#     PRAGMA foreign_keys 是每连接的，且不同客户端默认值不同。
#     所以本脚本**先读该客户端的 PRAGMA，再按实际值决定预期结果** ——
#     门禁编码的是**事实**，不是愿望。
#     如果它把「外键一定生效」写成预期，那它在 Python 与 sqlite3 CLI 上
#     会给出一个假红灯，然后被下一个人用 || true 关掉。
# ════════════════════════════════════════════════════════════════════════════

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

PROJ=examples/stockflow
PASS=0
FAIL=0

ok()  { PASS=$((PASS + 1)); printf '  \033[32m✔\033[0m %s\n' "$*"; }
bad() { FAIL=$((FAIL + 1)); printf '  \033[31m✖\033[0m %s\n' "$*"; }
say() { printf '%b\n' "$*"; }   # %b：让下面的 \033 转义真的生效

# ── §0  工具链 ─────────────────────────────────────────────────────────────
# node 是本门禁的必需工具链（缺了就无法运行），因此这里是**报错退出**，
# 不是「跳过」。跳过只适用于「这项检查依赖可选工具链」，见下面的裸客户端。
if ! command -v node >/dev/null 2>&1; then
  say "::error::未找到 node —— 本门禁无法运行（缺少必需工具链，不是跳过）"
  exit 2
fi
if ! node -e "try{require('node:sqlite')}catch(e){process.exit(3)}" 2>/dev/null; then
  say "::error::当前 node 不支持 node:sqlite（需要 ≥ 22.5）：$(node --version)"
  exit 2
fi

TMP=$(mktemp -d)
DB="$TMP/demo.db"
trap 'rm -rf "$TMP"' EXIT

# 两个包装器，差别在 stderr：
#   cli_out —— 只取 stdout，用于解析数值（node:sqlite 的 ExperimentalWarning 走 stderr）
#   cli     —— 连 stderr 一起取，用于检查错误码（AC 5.3 的错误码是打到 stderr 的）
# 最初只写了一个并带 2>/dev/null，结果错误码检查全部读到空字符串 ——
# 门禁自己踩了一次「输出被吞掉」的坑，与它要防的东西同形。
NODE="node --no-warnings"
cli_out() { $NODE "$PROJ/src/cli.mjs" "$@" --db="$DB" 2>/dev/null; }
cli()     { $NODE "$PROJ/src/cli.mjs" "$@" --db="$DB" 2>&1; }
run_cli() { cli_out "$@"; }

say "════ §1  准备一个确定的库（时刻钉在 1000）════"
run_cli add-sku SKU-1 --at=1000 >/dev/null || bad "建 SKU 失败"
run_cli receive SKU-1 10 --at=1000 >/dev/null || bad "入账失败"
say "  库：$DB"

# ── §2  反假绿：合法写入必须成功 ────────────────────────────────────────────
say ""
say "════ §2  反假绿：合法的写入必须真的写进去 ════"
# 这一段不是形式主义。下面 §3 会把「拒绝」当成好消息，
# 而一个把整库写成只读的 schema 能让 §3 全绿。必须先钉住「能写」。
# --res= 固定标识：门禁后面要按 id 直写脏数据，随机 id 会让「id 写错」
# 变成「WHERE 匹配 0 行」，于是「什么都没发生」被读成「写入成功」。
if run_cli reserve SKU-1 4 --at=1000 --ttl=200 --req=REQ-A --res=R-DEMO >/dev/null; then
  ok "合法预占成功"
else
  bad "合法预占被拒绝 —— 库可能是只读的，后面的「全拒绝」不能算通过"
fi

AVAIL=$(run_cli available SKU-1 --at=1000 | tr -d '\r')
if [ "$AVAIL" = "6" ]; then
  ok "可用量 = 6（在手 10 − 生效中预占 4）"
else
  bad "可用量应为 6，实际 '$AVAIL'"
fi

# ── §3  经由应用：非法写入必须被拒绝，且带稳定错误码 ────────────────────────
say ""
say "════ §3  经由应用：拒绝必须带稳定错误码（AC 5.3）════"

# 调用处显式传 --at：默认值会让「已过期」这条用例在 t=1000 时提前成功。
expect_code() { # expect_code <期望错误码> <说明> <CLI 参数...>
  local want="$1" desc="$2"; shift 2
  local out
  out=$(cli "$@" 2>/dev/null || true)
  if printf '%s' "$out" | grep -q "^$want\$"; then
    ok "$desc → $want"
  else
    bad "$desc 期望 $want，实际：$(printf '%s' "$out" | head -1)"
  fi
}

expect_code INSUFFICIENT_STOCK "超卖（AC 1.2）"       reserve SKU-1 7 --req=REQ-B --at=1000
expect_code INVALID_QTY        "数量为 0（AC 1.5）"   reserve SKU-1 0 --req=REQ-C --at=1000
expect_code UNKNOWN_SKU        "SKU 不存在（AC 1.6）" reserve GHOST 1 --req=REQ-D --at=1000

# 幂等：同一 request_id 再来一次必须是「重放」，而不是新预占
REPLAY_OUT=$(run_cli reserve SKU-1 4 --at=1000 --ttl=200 --req=REQ-A)
if printf '%s' "$REPLAY_OUT" | grep -q "重放"; then
  ok "同一 request_id 重放（AC 1.4）"
else
  bad "同一 request_id 未识别为幂等重放"
fi

# 过期后：可用量恢复，但兑现必须被拒
AVAIL_EXPIRED=$(run_cli available SKU-1 --at=1300 | tr -d '\r')
if [ "$AVAIL_EXPIRED" = "10" ]; then
  ok "过期未收割时可用量回到 10（AC 3.2 —— 收割不是生意的前提）"
else
  bad "过期后可用量应为 10，实际 '$AVAIL_EXPIRED'"
fi

RID=R-DEMO
# 防的手是：RID 写错 → WHERE 匹配 0 行 → 后面的「直写被拒」因为没报错而变成假绿。
# 所以先断言这一行真的在，而且处于预期的状态。
ROW_STATE=$(cli_out state "$RID" | tr -d '\r')
if [ "$ROW_STATE" = "held" ]; then
  ok "目标预占存在且为 held（$RID）"
else
  bad "目标预占 $RID 的状态应为 held，实际 '$ROW_STATE' —— 后续直写用例会失去意义"
fi
expect_code EXPIRED "兑现已过期的预占（AC 2.6）" commit "$RID" --at=1300

REAPED=$(run_cli reap --at=1300 | tr -d '\r' | awk '{print $NF}')
if [ "$REAPED" = "1" ]; then
  ok "收割 1 条（AC 3.3）"
else
  bad "收割条数应为 1，实际 '$REAPED'"
fi

# ── §4  不经应用：裸客户端直写 ─────────────────────────────────────────────
say ""
say "════ §4  不经应用：裸客户端直写（本案例的招牌验证）════"

RAW_KIND=""
if command -v sqlite3 >/dev/null 2>&1; then
  RAW_KIND="sqlite3"
elif command -v python >/dev/null 2>&1 && python -c 'import sqlite3' 2>/dev/null; then
  RAW_KIND="python"
else
  # 明确的告警，而不是静默跳过 —— 这一段是本案例最有说服力的证据，
  # 少了它必须被看见。「没有输出」和「跑了没发现问题」不能长得一样。
  say "  \033[33m⚠\033[0m 未找到 sqlite3 CLI 或 python —— 跳过了「裸客户端」这一段。"
  say "     这是本案例最有说服力的证据，请在有其中任一工具的机器上重跑。"
fi

if [ -n "$RAW_KIND" ]; then
  raw() { # 执行一段 SQL，输出为空 = 写入成功
    if [ "$RAW_KIND" = "sqlite3" ]; then
      sqlite3 "$DB" "$1" 2>&1
    else
      PYTHONUTF8=1 python -c "import sqlite3,sys
c=sqlite3.connect('$DB')
try:
    c.executescript('''$1'''); c.commit()
except Exception as e:
    print(e)" 2>&1
    fi
  }
  raw_pragma() {
    if [ "$RAW_KIND" = "sqlite3" ]; then
      sqlite3 "$DB" "PRAGMA foreign_keys;"
    else
      PYTHONUTF8=1 python -c "import sqlite3;print(sqlite3.connect('$DB').execute('PRAGMA foreign_keys').fetchone()[0])"
    fi
  }

  if [ "$RAW_KIND" = "sqlite3" ]; then
    RAW_VER=$(sqlite3 --version | cut -d' ' -f1)
  else
    RAW_VER=$(python -c 'import sqlite3;print(sqlite3.sqlite_version)')
  fi
  RAW_FK=$(raw_pragma | tr -d '\r')
  say "  裸客户端：${RAW_KIND}（SQLite ${RAW_VER}）  PRAGMA foreign_keys = ${RAW_FK}"
  say ""

  # 这一批**与客户端无关**：CHECK / STRICT / 触发器都是 schema 的一部分，
  # 它们不依赖任何 PRAGMA。任何客户端都必须被拦住。
  reject_case() { # reject_case <编号> <说明> <SQL>
    local out
    out=$(raw "$3")
    if [ -n "$out" ]; then
      ok "$1 直写被拒（与客户端无关）：$2"
    else
      bad "$1 直写**成功**了：$2 —— 这条约束没有生效"
    fi
  }

  reject_case "①" "在手量改负（AC 4.3①）"        "UPDATE sku SET on_hand = -1;"
  reject_case "②" "数量为 0（AC 4.3②）"          "INSERT INTO reservation VALUES ('x1','qx1','SKU-1',0,'held',1000,2000,NULL);"
  reject_case "③" "超量预占（AC 4.3⑥）"          "INSERT INTO reservation VALUES ('x3','qx3','SKU-1',999,'held',1000,9000,NULL);"
  reject_case "④" "从终结态复活（AC 4.3⑤）"       "UPDATE reservation SET state='held' WHERE res_id='$RID';"
  reject_case "⑤" "改动已兑现记录的 qty（AC 5.1）" "UPDATE reservation SET qty=0 WHERE res_id='$RID';"
  reject_case "⑥" "非整数进入 INTEGER 列（AC 5.1）" "INSERT INTO reservation VALUES ('x6','qx6','SKU-1','abc','held',1000,2000,NULL);"
  reject_case "⑦" "过期时刻早于创建时刻（AC 3.1）"   "INSERT INTO reservation VALUES ('x7','qx7','SKU-1',1,'held',2000,1000,NULL);"

  # 这一条**依赖客户端** —— 判定必须按实测的 PRAGMA 走，否则会造出假红灯。
  GHOST_OUT=$(raw "INSERT INTO reservation VALUES ('x8','qx8','GHOST',1,'held',1000,2000,NULL);")
  if [ "$RAW_FK" = "1" ]; then
    if [ -n "$GHOST_OUT" ]; then
      ok "⑧ 引用不存在的 SKU 被拒（AC 4.3③，客户端已启用外键）"
    else
      bad "⑧ 客户端启用了外键，幽灵行却写进去了"
    fi
  else
    if [ -n "$GHOST_OUT" ]; then
      ok "⑧ 幽灵行被拒（AC 4.3③）"
    else
      printf '  \033[33m⚠\033[0m %s\n' "⑧ 引用不存在的 SKU **写进去了** —— 因为该客户端默认关闭外键。"
      printf '     %s\n' "AC 4.3③ 在本客户端下**没有被强制**。这不是本项目的缺陷，而是数据层强制的固有代价："
      printf '     %s\n' "强制力取决于「谁来连接」。对策是 src/db.mjs 的设置 + 读回断言（AC 4.5），"
      printf '     %s\n' "它保证**我们的**连接永远处于启用状态。详见 docs/adr/ADR-002。"
      printf '     %s\n' "（本条不计为失败：它是被记录、被断言、被测试的已知边界。）"
    fi
    # 同一段检查在**我们的**连接上必须仍然成立 —— 这才是我们敢继续用外键的理由
    # ⚠️ 不能写成 `cli ... | grep -q ...` —— `set -o pipefail` 会让管道的退出码
    #    取自**被检查的命令**（它会以 1 退出），而不是取自 grep。
    #    于是「我预期它会失败」的检查变成永远失败，而被检查的行为其实是对的。
    #    凡是「断言某命令失败」的地方都必须先落变量再匹配。
    GHOST_APP_OUT=$(cli reserve GHOST 1 --req=REQ-GHOST --at=1000)
    if printf '%s' "$GHOST_APP_OUT" | grep -q UNKNOWN_SKU; then
      ok "⑧-b 同一写入经由应用仍被拒绝（AC 1.6 由 db.mjs 的断言保证）"
    else
      bad "⑧-b 同一写入经由应用**没有**被拒绝 —— 外键在我们的连接上也没生效"
    fi
  fi
fi

# ── §5  守恒与巡检 ─────────────────────────────────────────────────────────
say ""
say "════ §5  守恒等式与巡检必须为零行（AC 4.1 / 4.3 / ADR-004）════"
# 注意时序：if 的退出码取自最后一次命令（grep），所以这里必须先落变量再判。
CONS=$(run_cli show --at=1300 | grep -c "全部平账" || true)
if [ "$CONS" = "1" ]; then
  ok "库存守恒：所有 SKU delta = 0"
else
  bad "库存守恒被破坏"
fi

PATROL_OUT=$(run_cli patrol --at=1300 2>&1 || true)
if printf '%s' "$PATROL_OUT" | grep -q "0 行"; then
  ok "巡检 0 行"
else
  bad "巡检发现违规行：$(printf '%s' "$PATROL_OUT" | tail -3)"
fi

# ── 结论 ───────────────────────────────────────────────────────────────────
say ""
if [ "$FAIL" -eq 0 ]; then
  say "\033[32m通过\033[0m：$PASS 项检查"
  exit 0
fi
say "\033[31m失败\033[0m：$FAIL 项（通过 $PASS 项）"
exit 1
