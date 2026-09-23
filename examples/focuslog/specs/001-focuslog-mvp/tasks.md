# 任务清单 · focuslog MVP

> **本文件是 L04 的完整参考产出。** 三个对照重点：
> ① 每个任务都能映射回验收标准 ② 粒度明显不均等 ③ 有**人工重排**的痕迹（§4）
>
> 路径约定：`S=` spec 标准编号，`D=` plan 决策编号。

---

## 1. 任务列表（已人工重排后的顺序）

### 阶段 A · 基础（无依赖，必须先做）

- [ ] **T001** 定义错误码与异常层次 · `src/focuslog/errors.py`
  - 内容：`FocuslogError` 基类 + 子类 `TagRequiredError` / `TagInvalidError` / `SessionAlreadyActiveError` / `NoActiveSessionError` / `StoreUnreadableError` / `StoreCorruptError` / `StoreVersionUnsupportedError`
  - 每个错误携带 `code: str` 与 `exit_code: int`
  - 映射：S1.3, S1.4, S1.5, S1.2, S2.2, S1.3/D10
  - 验收：单元测试断言每个异常的 `code` 与 `exit_code` 值

- [ ] **T002** 实现 `Clock` 协议与 `SystemClock` / `FixedClock` · `src/focuslog/clock.py`
  - 映射：D6（宪法「时间可注入」）
  - 验收：`FixedClock.advance(minutes=90)` 后 `now()` 正确
  - **注意**：此文件放在顶层而非 `domain/`，因为 `SystemClock` 有副作用（读系统时钟），不能进 domain

### 阶段 B · 领域层（纯逻辑，依赖 T001）

- [ ] **T003** 标签校验 · `src/focuslog/domain/tags.py`
  - `validate_tag(raw: str | None) -> str`：`None`/空 → `TAG_REQUIRED`；空白或长度 >32 → `TAG_INVALID`；含非法字符 → `TAG_INVALID`
  - 合法字符集：`[A-Za-z0-9\-_/]`
  - 映射：S1.4, S1.5
  - 验收：参数化测试覆盖 `None`, `""`, `"   "`, `"a"*33`, `"a b"`, `"a@b"`, `"中文"`, `"reading"`, `"a-b_c/d"`

- [ ] **T004** 时长计算与跨天归属 · `src/focuslog/domain/durations.py`
  - `compute_session(started: datetime, ended: datetime) -> SessionResult`
  - 返回 `SessionResult(duration_minutes, attributed_date, crossed_day, rounded)`
  - 时长 = `floor((ended-started)/1min)`，不足 1 分钟记为 1 并置 `rounded=True`
  - 跨天判定与归属：按**本地日期**比较 `started` 与 `ended`，归属 `started` 的日期
  - 映射：S2.4, S2.5, D9
  - 验收：边界用例 —— 59 秒、61 秒、整 60 秒、跨午夜、跨午夜且不足 1 分钟、跨夏令时（用 `ZoneInfo`）

  > ⚠️ **本任务是阶段 B 里最大的一个。** 接受「本地日期」「时区偏移」「DST」三重交叉。
  > 如果实现中发现它超过 1 小时，**就地拆成 T004a（纯时长与取整）和 T004b（日期归属与跨天判定）**。

- [ ] **T005** ISO 周边界计算 · `src/focuslog/domain/weeks.py`
  - `iso_week_bounds(d: date) -> tuple[date, date]` 返回该 ISO 周的周一与周日
  - `iso_week_label(d: date) -> str` 返回如 `2026 第 39 周`
  - 映射：S3.1
  - 验收：**必须包含这一年最容易出错的三个日期** —— 1 月 1 日（可能属上一年最后一周）、12 月 31 日（可能属下一年第 1 周）、闰年 2 月 29 日

  > 📌 用 `datetime.date.isocalendar()` 而不是手算。手算 ISO 周的边界极易出错，且错误只在年末年初暴露。

- [ ] **T006** 稳定排序键 · `src/focuslog/domain/sorting.py`
  - `duration_sort_key(item) -> tuple[int, str]` 返回 `(-duration, tag)`
  - 映射：S3.5, S4.2
  - 验收：构造两个时长相等的标签，断言顺序为字典序升序；构造 `"Reading"` 与 `"reading"`，断言按 Unicode 码点（`"Reading"` 在前，因为 `R`=U+0052 < `r`=U+0072）

### 阶段 C · 存储层（依赖 T001）

- [ ] **T007** JSON 存储读写与不变量校验 · `src/focuslog/storage/json_store.py`
  - `load() -> Store`：文件不存在 → 返回空 Store（不是错误）；JSON 解析失败 → `STORE_UNREADABLE`；`schema_version != 1` → `STORE_VERSION_UNSUPPORTED`；不变量违反 → `STORE_CORRUPT`
  - `save(store: Store) -> None`：**原子写入**（写临时文件 + `os.replace`）
  - 路径解析：Windows 用 `%LOCALAPPDATA%`，其他用 `$XDG_DATA_HOME` 回退 `~/.local/share`
  - 映射：D7, D8, S「人类可读可手改」
  - 验收：损坏文件时断言**原文件未被修改**（这是最重要的一条）；并发写入不产生半截文件

### 阶段 D · 服务层（依赖 B、C）

- [ ] **T008** `start` 编排 · `src/focuslog/services/session.py::start_session`
  - 读 Store → 若 `active_session` 非 None 抛 `SessionAlreadyActiveError` → 校验标签 → 创建活跃会话 → 原子保存
  - 映射：S1.1, S1.2, S1.3, S1.4, S1.5
  - 验收：**幂等测试** —— 连续两次 start，第二次抛错且首次的 `started_at` 不变（S1.6）

- [ ] **T009** `stop` 编排 · `src/focuslog/services/session.py::stop_session`
  - 读 Store → 若 `active_session` 为 None 抛 `NoActiveSessionError` → 计算时长 → 移入 `sessions`、清空 `active_session` → 原子保存
  - 映射：S2.1, S2.2, S2.3, S2.4, S2.5
  - 验收：连续两次 stop，第二次抛错且首次 `ended_at` 不变（S2.3）

- [ ] **T010** 周报聚合 · `src/focuslog/services/report.py`
  - 输入：Store + 目标周（由 T005 计算）→ 输出：`WeeklyReport` 数据对象
  - 过滤：仅已完成会话，且归属日期落在周区间内
  - 聚合：按日汇总时长与条数；按标签汇总时长
  - **不包含活跃会话**，但返回 `has_active: bool`
  - 映射：S3.2, S3.6
  - 验收：周报在活跃会话存在时结果稳定（同一分钟内执行两次结果相同）

- [ ] **T011** 累计统计 · `src/focuslog/services/stats.py::compute_stats`
  - 按标签聚合已完成的会话，应用 T006 的排序键
  - 映射：S4.1, S4.2, S4.4
  - 验收：无记录时返回空列表（由 CLI 层渲染"暂无记录"），不抛错

### 阶段 E · 渲染层（依赖 D）

- [ ] **T012** 周报 Markdown 渲染 · `src/focuslog/render/markdown.py`
  - 渲染 `WeeklyReport` → 表格形式；空周报渲染"本周没有记录"；`has_active=True` 时末尾追加提示
  - 映射：S3.2, S3.3, S3.6
  - 验收：快照测试（首次运行把输出写进 `tests/snapshots/`，人工确认后作为基线）

- [ ] **T013** JSON 输出 · `src/focuslog/render/json_out.py`
  - 周报与统计的机器可读格式
  - 映射：S3.4, S4.5
  - 验收：断言 JSON 输出包含 spec §3.2 与 §4.4 列出的**每一个字段**

### 阶段 F · CLI 层（依赖 E）

- [ ] **T014** Typer app 与 `start` / `stop` 子命令 · `src/focuslog/cli/`
  - 参数解析、调用 service、捕获异常 → 映射退出码（1 = 参数错误 / 2 = 运行期错误）、打印输出
  - 映射：D10, S1.1–S1.5, S2.1–S2.5
  - 验收：用 `typer.testing.CliRunner` 断言每条错误路径的退出码与 stdout 中的错误码

- [ ] **T015** `report` / `stats` 子命令（含 `--json`）· `src/focuslog/cli/`
  - 映射：S3.1–S3.6, S4.1–S4.5
  - 验收：`report --week` 在空存储下退出码为 **0**（不是错误码），stdout 含"本周没有记录"

### 阶段 G · 收口

- [ ] **T016** EARS 标准 ↔ 测试用例映射表 · `docs/验收标准-测试映射.md`
  - 覆盖 spec §2 全部 **22** 条标准（US1: 6 / US2: 5 / US3: 6 / US4: 5）
  - 映射：宪法「测试与质量门禁」
  - 验收：`grep` 两个数字相等（见 §3）

- [ ] **T017** CI 配置 · `.github/workflows/ci.yml`
  - 跑 pytest + 分层边界检查
  - 映射：D4（宪法架构边界）、D5
  - 验收：故意在 `domain/` 里加一行 `open()`，确认 CI 变红

---

## 2. 任务 → 验收标准 覆盖校验

| spec 标准 | 覆盖任务 |
|-----------|---------|
| US1 · 1.1–1.6 | T003, T008, T014, T001 |
| US2 · 2.1–2.5 | T004, T009, T014, T001 |
| US3 · 3.1–3.6 | T005, T010, T012, T013, T015 |
| US4 · 4.1–4.5 | T006, T011, T013, T015 |

**没有孤儿标准，也没有孤儿任务。** 这一节就是 L04 验收项「每个任务能映射回一条验收标准」的机械化检查。

---

## 3. 覆盖率自检命令

```bash
# spec 里的验收标准条数（表格行以 | 数字. 开头）
$ grep -cE '^\| [0-9]+\.[0-9]+' specs/001-focuslog-mvp/spec.md
22

# 映射表里的行数
$ grep -cE '^\| [0-9]+\.[0-9]+' docs/验收标准-测试映射.md
22
```

**两个数字必须相等。** 不相等就是有验收标准没有测试用例。这个命令会在 L09 被搬进 CI 作为阻断门禁。

---

## 4. 人工重排记录 ⭐

**这一步不要交给 agent。** 以下是本次的人工重排，含理由。

| 项 | agent 的原始顺序 | 重排后 | 理由 |
|----|---------------|-------|------|
| R1 | T008 `start` 在 T007 存储之前 | T007 先 | `start` 依赖存储的不变量校验；反了会导致存储层返工 |
| R2 | T009 `stop` 在 T008 `start` 之前 | T008 先 | `stop` 的幂等测试（S2.3）需要先能创建会话 |
| R3 | T010 周报在 T005 ISO 周之前 | T005 先 | 周报的过滤依赖周边界计算 |
| R4 | 全部测试任务置于最后 | 与实现任务同级 | 测试放最后 = 验收标准放最后 = 偏差留到最后才发现 |
| R5 | T006 排序键在 T010 周报之后 | T006 先 | 周报与统计都依赖同一排序键；提前做可避免两处重复实现 |

### 拆解动作

| 项 | 动作 |
|----|------|
| T004 | **标明为超大连贯任务**，并预先给了拆分预案（T004a/T004b）。这是本清单里**唯一粒度明显偏大**的任务——诚实标注而不是假装它和其他任务一样大 |
| T017 | 拆出「故意制造违反让 CI 变红」作为独立验收项，而不是笼统地「配置 CI」 |

> 📌 **粒度不均等才是诚实的拆解。** 如果本清单里每个任务看起来都差不多大，说明没有真正拆解，
> 只是把 agent 的输出按段落切了一刀。

---

## 5. 与 plan.md 的决策对应

| plan 决策 | 落地的任务 |
|-----------|----------|
| D5（domain 纯函数无 IO） | T003–T006（全部是纯函数）+ T017（CI 检查） |
| D6（时间可注入） | T002 + T004 的签名设计 |
| D8（`schema_version`） | T007 |
| D9（`duration_minutes` 持久化） | T004 产出 + T009 写入 |
| D11（排序键） | T006 |
| D12（错误码集中） | T001 + T014/T015 的映射 |

**每个 plan 决策都有落地任务。** 反之，本清单里**没有任何一个任务指不回 plan 决策或 spec 标准**——这是范围蔓延的反向检查。
