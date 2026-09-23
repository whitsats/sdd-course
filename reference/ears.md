# EARS 句式速查

> **EARS = Easy Approach to Requirements Syntax**
> 用途：把「自然语言需求」翻译成**机器不会误解、且能被测试**的语句。
> 它是元要求（meta-requirement）语法，不是编程语言——你不需要工具，只需要句式纪律。

SDD 里最脆弱的一环就是验收标准。写成「导出功能要正常工作」，agent 会给你一个「看起来正常」的实现，然后你们对「正常」的理解差了三层楼。EARS 用五个句式解决这件事。

---

## 核心句式总览

| # | 类型 | 句式 | 中文语感 | 用在什么场景 |
|---|------|------|---------|------------|
| 1 | **普遍式** Ubiquitous | `THE <系统> SHALL <响应>` | 系统**始终**要… | 不依赖任何触发的恒定约束 |
| 2 | **事件驱动** Event-driven | `WHEN <触发> THE <系统> SHALL <响应>` | **当**…发生，系统要… | 由动作/事件触发的行为（最常用） |
| 3 | **状态驱动** State-driven | `WHILE <状态> THE <系统> SHALL <响应>` | **在**…状态下，系统要… | 只在某持续状态下成立的行为 |
| 4 | **可选特性** Optional feature | `WHERE <特性已启用> THE <系统> SHALL <响应>` | **若启用**…，系统要… | 可配置/可插拔的功能 |
| 5 | **非期望行为** Unwanted behaviour | `IF <异常条件> THEN THE <系统> SHALL <响应>` | **如果**…出错，系统要… | 错误处理、边界、防护 |
| 6 | **复合式** Complex | `WHILE <状态> WHEN <触发> THE <系统> SHALL…` | 组合起来 | 状态 + 事件同时成立时 |

**记忆点**：`WHEN` 是**瞬间事件**，`WHILE` 是**持续状态**，`WHERE` 是**配置开关**，`IF...THEN` 是**异常分支**。混用这四个词是最常见的错误。

---

## ① 普遍式：THE … SHALL …

用于恒定不变的约束。**数量要少**——写多了说明你在写架构而非需求。

```markdown
- THE system SHALL store all timestamps in ISO 8601 format with an explicit offset.
- THE system SHALL reject any task status value outside {todo, doing, done}.
```

**什么时候用**：这条要求与「发生了什么」无关，系统永远处于这个状态。

**反例**：「系统要快」——它连 SHALL 的宾语都没有。改成 `WHEN a list endpoint is called THE system SHALL return within 200ms at P95`。

---

## ② 事件驱动：WHEN … SHALL …

最常用的一类。用来描述「用户/系统某个动作之后应该发生什么」。

```markdown
- WHEN the user runs `focuslog stop`, THE system SHALL record the session end time
  and print the session duration in minutes.
- WHEN a task is moved to `done`, THE system SHALL record the completion timestamp.
```

**关键**：`WHEN` 后面必须是**可以明确指出发生时刻的事件**。如果你写的是「当用户在使用系统时」，那其实是状态而不是事件 → 该用 `WHILE`。

---

## ③ 状态驱动：WHILE … SHALL …

```markdown
- WHILE a session is active, THE system SHALL reject any new `start` command
  with error code SESSION_ALREADY_ACTIVE.
- WHILE the user is offline, THE system SHALL queue mutations locally
  and replay them on reconnect.
```

**关键**：`WHILE` 描述的是一个**可以持续一段时间的条件**。「有活跃会话」是一个状态；「用户点了停止」是一个事件。区分清楚，测试用例的写法就完全不同（状态驱动要测「期间」的多次交互，事件驱动只测「之后」）。

---

## ④ 可选特性：WHERE … SHALL …

```markdown
- WHERE the `--json` flag is provided, THE system SHALL emit machine-readable output
  instead of human-readable text.
- WHERE multi-user mode is enabled, THE system SHALL require authentication on all write endpoints.
```

**关键**：`WHERE` 描述的是**配置/环境维度**，不是运行时发生的动作。它是「这个部署形态下才成立」。

---

## ⑤ 非期望行为：IF … THEN … SHALL …

**这一类是绝大多数规格最欠缺的部分，也是它最值钱的部分。** 因为「正常路径」agent 自己就会想到，异常路径才是需求真正含糊的地方。

```markdown
- IF the report is requested for a week with no sessions,
  THEN THE system SHALL print "no sessions recorded" and exit with code 0.
- IF two users move the same task to different columns within 500ms of each other,
  THEN THE system SHALL accept the first write and reject the second with CONFLICT,
  returning the current server state in the response body.
```

**注意上面第二条**：它把「并发冲突怎么办」这个通常被一句「处理好并发」糊过去的问题，变成了一个**可以写出测试的判据**。这就是 L06 clarify 阶段要产出的东西。

### 异常分支检查清单

写每条需求时，逐个过一遍这几个问题，缺哪个补哪个：

- 输入是空 / 只有一个元素 / 巨大时？
- 依赖的服务超时 / 返回错误时？
- 两个操作同时发生，或者同一个操作重复提交时？
- 用户没有权限时？
- 数据处于中间状态（半完成）时？

---

## ⑥ 复合式

```markdown
- WHILE a user has an unsaved draft
  WHEN they navigate away from the page
  THE system SHALL show a confirmation dialog.
```

**顺序固定：`WHILE`（状态）在前，`WHEN`（事件）在后。** 反了会影响可读性和一致性检查。

---

## 中英取舍：教程里用哪种写？

EARS 的规范形式是英文（`THE … SHALL …`），因为它在语法上最不容易产生歧义（`SHALL` 表示强制，`SHOULD` 表示建议——中文里这个区别很容易丢掉）。

**推荐做法：**

- **关键词用英文**，把 `SHALL` / `WHEN` / `WHILE` / `WHERE` / `IF…THEN` 保留原样；
- **内容用中文**，方便团队阅读与评审。

```markdown
- WHEN 用户执行 `focuslog stop`
  THE system SHALL 记录会话结束时间，并以分钟为单位输出该会话时长。

- IF 被请求的周报区间内没有任何会话记录
  THEN THE system SHALL 输出"本周无记录"并以退出码 0 结束。
```

这样既保留了**歧义消除能力**（关键词的强制性是明确的），又保证了**评审时人能读懂**。团队全英文环境就直接全英文。

---

## 改写对照：坏 → 好

这是本节最实用的部分。左边是你脑子里的话，右边是 EARS 版本。

| 坏（自然语言） | 好（EARS） | 问题诊断 |
|---|---|---|
| 支持导出周报 | `WHEN 用户执行 \`report --week\` THE system SHALL 输出当前 ISO 周的 Markdown 报告，含每天的会话总时长与标签分布` | 「支持」没有任何可观测行为 |
| 性能要好 | `WHEN 列表接口被调用 THE system SHALL 在 P95 下 200ms 内返回，单页至多 100 条` | 无阈值、无上下文 |
| 处理并发冲突 | `IF 同一任务在 500ms 内被两个用户写入不同状态 THEN THE system SHALL 接受先到者并以 CONFLICT 拒绝后者` | 「处理」不可验收 |
| 用户界面要友好 | <删除此条> → 改写到组件库/视觉回归测试里 | 属于 L01 第 5 节的「高频变更 UI 细节」，不该进规格 |
| 数据要安全 | `THE system SHALL 校验所有外部输入后才进入领域逻辑；日志中 SHALL NOT 出现用户标识符明文` | 拆成两条可判定的约束 |
| 任务可以标记完成 | `WHEN 任务被移动到 done THE system SHALL 记录完成时间戳；IF 任务已是 done THEN THE system SHALL 忽略该操作且不重复记录时间戳` | 补上了幂等性这个最常被漏掉的异常分支 |
| 支持多个项目 | `THE system SHALL 允许一个用户属于多个项目；WHILE 用户在项目 A 的上下文中 THE system SHALL 只在任务列表中显示 A 的任务` | 「支持」→ 拆成普遍式 + 状态驱动 |

### 从改写里能提炼出的三条规律

1. **动词换成可观测行为**：「支持」「处理」「优化」→ 具体输出、具体记录、具体错误码。
2. **主动补异常分支**：正常路径 agent 会自己补，异常路径必须你给。
3. **凡是带形容词的要求，多半属于不该进规格的那一类**（友好、健壮、高效）——要么改成数字，要么移到别处。

---

## 批量转换工作流

L03 里你会拿到 agent 生成的一整份 `spec.md`。按这个流程把它的验收标准全部重写一遍：

```
1. 通读 spec，把每条验收标准摘出来列成一列
2. 对每条问：它属于六种句式里的哪一种？
   ├─ 答不出来 → 这条要求本身不清楚，退回 clarify
   └─ 答得出来 → 用对应句式重写
3. 对每条补三问：
   ├─ 有数字/明确判据吗？
   ├─ 异常分支写了吗？（对照⑤的清单）
   └─ 我能为它写出一个"会失败"的测试吗？
4. 重写后自检：
   ├─ 关键词用法对吗？（WHEN 事件 / WHILE 状态 / WHERE 配置 / IF 异常）
   ├─ 有没有一条里塞了两个 SHALL？（有就拆开）
   └─ 有没有形容词残留？
5. 交给 agent 复核：让它指出"哪条仍然无法被测试"
```

### 第 5 步很重要

让 agent 来审你的规格，它往往能挑出你自己看不见的模糊处。这是**用同一个工具反向验证自己输入质量**的技巧，整门课里会反复用到。

---

## 一句话自检

写完一条验收标准，念一遍这个句子：

> **「什么样的观察结果会证明这条要求被违背了？」**

- 你能立刻说出一个具体的观察结果 → ✅ 合格
- 你要想一下、或者说「大概就是…」 → ❌ 重写
- 你说不出来 → ❌ 这条不是需求，是感想

---

## 相关

- [术语表](./glossary.md)
- [反模式清单](./anti-patterns.md) —— 第 3、8 条专门讲验收标准的常见错误
- 课程正文：[L03 · Specify](../lessons/03-specify.md)（本节句式的主战场）
