# 技术方案 · focuslog MVP

> **本文件是 L04 的完整参考产出。** 对照重点：每一项技术决策都能指回 spec 的某条标准或宪法的某条约束。
>
> 对照你自己的产出时看两处：① **可追溯性表**里有没有指不回去的决策 ② **数据模型**有没有用结构表达不变量。

**对应规格**：`specs/001-focuslog-mvp/spec.md`
**最后更新**：2026-09-22

---

## 1. 架构分层

```
src/focuslog/
├── __init__.py
├── cli/
│   ├── main.py           Typer app 定义、子命令注册
│   ├── start_cmd.py      start 子命令：参数解析 + 输出渲染 + 退出码映射
│   ├── stop_cmd.py       stop 子命令
│   ├── report_cmd.py     report 子命令（含 --json）
│   └── stats_cmd.py      stats 子命令（含 --json）
├── services/
│   ├── session.py        start/stop 的业务编排（读存储 → 调 domain → 写存储）
│   ├── report.py         周报数据聚合
│   └── stats.py          标签累计统计
├── domain/               ⚠️ 纯逻辑，禁止任何 IO
│   ├── tags.py           标签校验（标准 1.4 / 1.5）
│   ├── durations.py      时长计算、取整、跨天归属（标准 2.4 / 2.5）
│   ├── weeks.py          ISO 周边界计算（标准 3.1）
│   └── sorting.py        稳定排序键（标准 3.5 / 4.2）
├── storage/
│   └── json_store.py     唯一允许读写文件的模块
├── render/
│   ├── markdown.py       周报 Markdown 渲染（标准 3.2）
│   └── json_out.py       JSON 输出（标准 3.4 / 4.5）
└── errors.py             错误码定义与异常类型
```

### 分层边界（宪法约束，须强制）

| 规则 | 违反示例 | 怎么发现 |
|------|---------|---------|
| `domain/` 不得 import `storage/`、`render/`、`cli/` | 在 `durations.py` 里 `open()` 读数据 | 在 CI 里加 import 检查（见 §6） |
| `cli/` 只能调用 `services/`，不得直接调 `storage/` | `start_cmd.py` 里直接读 JSON | code review + import 检查 |
| `storage/` 不得包含业务规则 | 在 `json_store.py` 里做标签校验 | code review |

**为什么这条边界值钱**：`domain/` 全是纯函数，这意味着标准 1.4–1.6、2.4–2.5、3.5 的测试**不需要临时文件、不需要 mock**，就是普通的输入输出断言。整个项目的测试成本因此下降一大截。

---

## 2. 数据模型

### 存储文件

路径：`$XDG_DATA_HOME/focuslog/sessions.json`（Windows：`%LOCALAPPDATA%\focuslog\sessions.json`）
所有人类可读、可手改。

```json
{
  "schema_version": 1,
  "sessions": [
    {
      "id": "01JCFK2M8XQ7YB3N4PQRSTVWXY",
      "tag": "reading",
      "started_at": "2026-09-22T09:15:00+08:00",
      "ended_at": "2026-09-22T10:05:00+08:00",
      "duration_minutes": 50,
      "note": null
    }
  ],
  "active_session": {
    "id": "01JCFK3N9YR8ZC4P5QRSTUVWXY",
    "tag": "coding",
    "started_at": "2026-09-22T14:00:00+08:00"
  }
}
```

### 三个关键设计决策

**① `schema_version` 从第一版就存在。**

第一版的成本是 6 个字符和一行校验；等要迁移时再加，成本是一个迁移脚本加一次数据风险。**这一条没有讨论余地。**

**② `active_session` 是独立的顶层可空对象，不是 `sessions` 数组里的一个标记位。**

spec 的术语表明确规定「同一时刻至多一个活跃会话」，这是一条**不变量**。用顶层单值对象表达它，数据结构本身就保证了这条不变量——你写不出「两个活跃会话」。若放进数组加 `"active": true`，则只能靠代码约定维护。

> 对应标准：1.2（已有活跃会话时拒绝）、1.6（幂等）

**③ `duration_minutes` 是**存下来的**，不是每次根据 `started_at`/`ended_at` 现算的。**

理由直接来自标准 2.5：跨天会话的归属规则如果把时长现算，那么**未来修改这条规则会让全部历史数据变样**。存下来则历史不变，规则变更只影响新数据。

> 对应标准：2.5。**这是「规格要求倒逼数据模型」的具体例子。**

### 不变量清单（需在 `json_store.py` 里校验）

| 不变量 | 违反时的行为 |
|--------|------------|
| `schema_version` 必须等于 1 | 报错 `STORE_VERSION_UNSUPPORTED`，拒绝启动 |
| `active_session` 至多为一个（结构保证） | — |
| 已完成会话的 `duration_minutes` 必须 ≥ 1 | 报错 `STORE_CORRUPT` |
| `started_at` / `ended_at` 必须带时区偏移 | 报错 `STORE_CORRUPT` |
| 用户手改坏了 JSON | 报错 `STORE_UNREADABLE`，**不得覆盖原文件** |

**最后一行很重要**：用户手改是 spec 明确支持的用法（「人类可读可手改」）。所以文件损坏时**绝不能静默重建**——那会毁掉用户的数据。

---

## 3. 技术决策与可追溯性 ⭐

| # | 决策 | 服务的 spec / 宪法条目 | 判定 |
|---|------|---------------------|------|
| D1 | Python 3.10+ | 宪法「技术栈」 | ✅ |
| D2 | uv 管理依赖 | 宪法「依赖管理」 | ✅ |
| D3 | 第三方依赖仅 Typer | 宪法「依赖仅允许 Typer」 | ✅ |
| D4 | 分层 `cli → services → domain → storage` | 宪法「架构边界」 | ✅ |
| D5 | `domain/` 纯函数、无 IO | 宪法「domain 不得读文件」+ 标准 2.4/2.5/3.5 的可测性 | ✅ |
| D6 | 时间来源通过 `Clock` 协议注入 | 宪法「时间必须可注入」 | ✅ |
| D7 | 存储用单个 JSON 文件 | 标准「人类可读可手改」（见 ADR-001） | ✅ |
| D8 | `schema_version` 字段 | 数据模型可迁移性（无 spec 条目，**记为前瞻性投资**） | ⚠️ 说明见下 |
| D9 | `duration_minutes` 持久化 | 标准 2.5（历史数据不受规则变更影响） | ✅ |
| D10 | 退出码 0 / 1 / 2 | 标准 1.3（退码 1）、1.2（退码 2）、3.3（退码 0） | ✅ |
| D11 | 排序键 = `(-duration, tag)` | 标准 3.5 / 4.2 | ✅ |
| D12 | 错误码集中定义在 `errors.py` | 宪法「所有错误携带机器可读错误码」 | ✅ |

### D8 是唯一一条「指不回 spec」的决策 —— 这是诚实标注的示范

`schema_version` 不对应 spec 里任何一条验收标准。按 L04 的规则，它应该被处理成两种之一：**删掉**，或**显式承认是追加的范围**。

**我们的处理**：保留，并显式记录理由是「数据模型可迁移性」。这不是范围蔓延（范围蔓延指的是**功能**蔓延），而是 spec 层面的**非功能缺失**。

> 📌 **这是 L04 可追溯性检查里最容易被搞错的地方**：
> 「指不回 spec」≠ 一定是错的。但**必须显式标注并给出理由**，不能默默留着。
> 如果你找了半天理由也说不清一项决策为什么存在——那才是范围蔓延。

### 对照练习

在你自己的 `plan.md` 里找一项「指不回任何 spec 条目」的决策：

- 能给出理由 → 像 D8 一样标注
- 给不出 → 删掉

**本项目里没有出现真正的范围蔓延实例**（因为项目足够小）。真正的范围蔓延长什么样，见 `examples/taskflow/specs/001-taskflow-mvp/plan.md` 的 §3 对照案例。

---

## 4. 时间来源注入的设计

宪法要求「时间必须可注入」。具体做法：

```python
# src/focuslog/clock.py
from typing import Protocol
from datetime import datetime

class Clock(Protocol):
    def now(self) -> datetime: ...

class SystemClock:
    def now(self) -> datetime:
        return datetime.now().astimezone()   # 带本地时区偏移

class FixedClock:
    """测试用：返回预设时刻，可手动推进。"""
    def __init__(self, current: datetime) -> None:
        self._current = current
    def now(self) -> datetime:
        return self._current
    def advance(self, **kwargs) -> None:
        from datetime import timedelta
        self._current += timedelta(**kwargs)
```

**调用链**：`cli/` 构造 `SystemClock()` → `services/` → `domain/` 函数签名接收 `now: datetime`（**不是 Clock 对象**）。

> **为什么 domain 收 `datetime` 而不是 `Clock`**：domain 是纯函数，收具体值更容易测试，也避免它偷偷多次取时间。多次取时间会导致「同一逻辑里两个不同的 now」，这是跨天判断出 bug 的常见原因。

**测试因此长这样**（标准 2.5 跨天）：

```python
def test_cross_day_session_counts_to_start_date():
    started = datetime(2026, 9, 22, 23, 30, tzinfo=ZoneInfo("Asia/Shanghai"))
    ended   = datetime(2026, 9, 23, 0, 45, tzinfo=ZoneInfo("Asia/Shanghai"))
    result = compute_session(started, ended)
    assert result.attributed_date == date(2026, 9, 22)   # 归属开始日
    assert result.duration_minutes == 75
    assert result.crossed_day is True
```

**没有 mock、没有 patch、没有临时文件。** 这就是 §1 那条分层边界的回报。

---

## 5. 依赖

```toml
# pyproject.toml
[project]
name = "focuslog"
requires-python = ">=3.10"
dependencies = [
    "typer>=0.12",
]

[dependency-groups]
dev = [
    "pytest>=8.0",
    "pytest-cov>=5.0",
]
```

**依赖策略**：生产依赖仅 1 个（Typer）。具体解析到的版本由 `uv.lock` 锁定，`uv sync --frozen` 保证可复现。

> 版本号以 `uv lock` 解析到的实际情况为准；本文件只记录**约束下限**，不记录精确版本（避免与 lock 文件冲突产生双真相源）。

---

## 6. CI 检查项

```yaml
# .github/workflows/ci.yml
name: ci
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v3
      - run: uv sync --frozen
      - run: uv run pytest -q
      - name: 分层边界检查（domain 不得有 IO）
        run: |
          if grep -rEn '\b(open|Path|json\.load|json\.dump|os\.)\b' src/focuslog/domain/; then
            echo "::error::domain 层出现 IO 调用，违反宪法分层约束"
            exit 1
          fi
```

**第二个 step 是宪法「架构边界」的机械化执行。** 它把一条靠 code review 维持的约定变成了 CI 检查——这是 L09「让靠自觉的事变成靠机器」在最小规模上的一次预演。

---

## 7. 本方案未包含（与 spec 的非目标对齐）

- 任何形式的持久化之外的缓存 —— **spec 无性能要求，缓存会引入失效复杂度且可能让 `stop` 后的 `stats` 读到旧数据（违背标准 4.1）**
- 配置文件的用户自定义（时间格式、周起始日）—— spec 未要求，且周起始日固定为 ISO 8601
- 数据导入功能 —— 超出非目标范围
