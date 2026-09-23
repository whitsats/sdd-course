# feature 规格 · taskflow MVP

> **本文件是 L06 的完整参考产出（澄清后状态）。** 对照重点：
> ① 六类歧义区（状态流转 / 评论权限 / 并发冲突 / 鉴权边界 / 分页语义 / 审计日志）全部有显式定义
> ② 每条 `IF … THEN …` 都是澄清过程中问出来的
> ③ 搜不到技术栈词汇
>
> 范围：**7 个端点 / 2 个角色 / 4 个状态**（+ L09 追加的 `archived`）。

**Feature 分支**：`001-taskflow-mvp`
**状态**：已澄清，已评审 checklist，待规划
**端点清单**：`POST /projects`、`GET /projects/:id`、`POST /projects/:id/tasks`、`GET /projects/:id/tasks`、`PATCH /tasks/:id`、`POST /tasks/:id/comments`、`GET /tasks/:id/comments`

---

## 1. 概述

为 5 人以内的小团队提供一个共享任务看板的后端能力。成员能建项目、建任务、把任务在看板上推进、并就任务讨论。

**要解决的核心问题**：团队目前用群聊同步任务状态，导致「谁在做什么」和「事情推进到哪一步」不可见、不可追溯。

**不解决**：跨团队协作、通知推送、时间追踪、甘特图、附件、@提醒、移动端。

---

## 2. 角色与权限模型

只有 **2 个角色**：

| 角色 | 定义 |
|------|------|
| `owner` | 项目创建者或被指派的负责人。可管理成员、可删除项目 |
| `member` | 被加入项目的成员。可在项目内建任务、改任务状态、评论 |

**约束**：一个项目**至少保留一个 `owner`**。见标准 6.3。

---

## 3. 状态机

```
            ┌───────────────────────────────┐
            │                               │ 驳回
   todo ──► doing ──► in_review ──► done ──► archived
                      ◄──────┘
```

**合法流转（穷举）**：

| 从 | 到 | 允许 | 说明 |
|----|----|------|------|
| todo | doing | ✅ | 开始处理 |
| doing | in_review | ✅ | 提交审核 |
| in_review | doing | ✅ | 驳回 |
| in_review | done | ✅ | 通过 |
| todo | in_review | ❌ | 不允许跳过 |
| todo | done | ❌ | 不允许跳过 |
| done | *（除 archived） | ❌ | **`done` 之后不可回退** |
| archived | * | ❌ | **终态** |

**关于 `archived`**：由后台任务在任务进入 `done` 满 30 天后自动置入，**不是用户操作**。
此状态在 L09 作为**规格变更流程**的示例被追加（见 `notes/L09-规格变更.md`）。

---

## 4. 用户故事与验收标准

验收标准使用 EARS 句式，关键词保留英文。

### US1 · 创建与管理项目

**作为**团队负责人
**我想要**建一个项目并看它的信息
**以便**团队有共享的任务容器

#### 验收标准

| # | 标准 |
|---|------|
| 1.1 | WHEN `owner` 执行 `POST /projects` 且请求体合法 THE system SHALL 创建项目，返回 **201**，响应含项目 `id`、`name`、`created_at`。 |
| 1.2 | IF 请求者不是项目成员 THEN 对 `GET /projects/:id` THE system SHALL 返回 **404**（`PROJECT_NOT_FOUND`），**不区分「不存在」与「无权限」**。 |
| 1.3 | WHEN `member` 执行 `POST /projects` THE system SHALL 返回 **403**（`FORBIDDEN`）。 |
| 1.4 | IF `name` 为空、或长度超过 100 字符 THEN THE system SHALL 返回 **400**（`INVALID_NAME`）。 |
| 1.5 | THE system SHALL **不限制**同一 `name` 的项目数量（名称非唯一标识）。 |
| 1.6 | IF 未携带有效认证信息 THEN THE system SHALL 返回 **401**（`UNAUTHENTICATED`）。 |

**1.2 为什么用 404 而不是 403**：403 会泄露「这个项目 ID 存在」这一信息，攻击者可据此枚举 ID。
**代价**：前端无法区分「项目不存在」和「无权限」，调试体验略差。这是有意识接受的取舍。

---

### US2 · 创建与列出任务

**作为**团队成员
**我想要**建任务并按条件列出
**以便**我知道有哪些事要做

#### 验收标准

| # | 标准 |
|---|------|
| 2.1 | WHEN `owner` 或 `member` 执行 `POST /projects/:id/tasks` 且请求体合法 THE system SHALL 创建任务，初始状态恒为 `todo`，返回 **201**。 |
| 2.2 | IF 请求体含 `status` 字段 THEN THE system SHALL **忽略**该字段（创建时状态不可指定），仍返回 201，响应中 `status` 为 `todo`。 |
| 2.3 | IF `title` 为空或长度超过 200 字符 THEN THE system SHALL 返回 **400**（`INVALID_TITLE`）。 |
| 2.4 | WHEN 请求者不是项目成员 AND 执行 `POST /projects/:id/tasks` THEN THE system SHALL 返回 **404**（`PROJECT_NOT_FOUND`）。 |
| 2.5 | IF 目标项目不存在 THEN THE system SHALL 返回 **404**（`PROJECT_NOT_FOUND`）。 |
| 2.6 | WHEN `GET /projects/:id/tasks` 且未指定分页参数 THE system SHALL 返回**默认 20 条**，按标准 2.9 排序，响应含 `next_cursor`（无更多数据时为 `null`）。 |
| 2.7 | IF `size` 参数 > 100 THEN THE system SHALL **截断为 100**（不报错），并在响应中以 `effective_size` 字段明示。 |
| 2.8 | IF `size` 参数 ≤ 0 或非整数 THEN THE system SHALL 返回 **400**（`INVALID_PAGINATION`）。 |
| 2.9 | THE system SHALL 按 `created_at` **降序**返回（新建的在前），WHEN 两个任务的 `created_at` 完全相同 THE system SHALL 以 `id` 降序作为次级排序键。 |

**2.9 的次级排序键不是装饰**：没有它，同一毫秒创建的两个任务在两次请求中可能顺序不同，
客户端翻页会漏数据或重复。**排序不确定性 = 无法写稳定测试。**

---

### US3 · 推进任务状态

**作为**团队成员
**我想要**把任务在看板上推进
**以便**团队看到进展

#### 验收标准

| # | 标准 |
|---|------|
| 3.1 | WHEN `owner` 或 `member` 执行 `PATCH /tasks/:id` 把一个**合法**转移写入（见 §3 状态机）AND 请求携带的 `version` 与当前一致 THE system SHALL 更新状态，返回 **200**，响应中 `version` 递增 1。 |
| 3.2 | IF 请求的转移不在 §3 的合法流转表内 THEN THE system SHALL 返回 **422**（`INVALID_TRANSITION`），响应含 `from` 与 `to` 字段。 |
| 3.3 | IF 目标任务当前状态为 `done` 且请求不是转为 `archived` THEN THE system SHALL 返回 **422**（`TERMINAL_STATUS`）。 |
| 3.4 | IF 目标任务当前状态为 `archived` THEN THE system SHALL 对任何状态修改返回 **422**（`TERMINAL_STATUS`）。 |
| 3.5 | IF 请求携带的 `version` 与当前不一致 THEN THE system SHALL 返回 **409**（`CONFLICT`），响应体含 `current` 对象，其内容为服务端当前的任务完整状态。 |
| 3.6 | WHEN 500ms 内两个请求尝试将同一任务改为不同状态 AND 二者携带相同 `version` THEN THE system SHALL 使**先到达者成功**，后到达者按 3.5 返回 409。 |
| 3.7 | IF 请求体缺少 `version` 字段 THEN THE system SHALL 返回 **400**（`VERSION_REQUIRED`）。 |
| 3.8 | IF 任务不存在 THEN THE system SHALL 返回 **404**（`TASK_NOT_FOUND`）。 |
| 3.9 | IF 请求者不是任务所属项目的成员 THEN THE system SHALL 返回 **404**（`TASK_NOT_FOUND`）。 |

**3.5 的 `current` 字段是必须的**：没有它，客户端收到 409 后不知道服务端的当前状态，
只能重新拉取整个任务——多一次往返，且在弱网下可能拿到更新的版本，陷入无意义的冲突循环。

**3.6 的「先到者胜」是有代价的选择**：另一种合理设计是「后到者胜」（last-write-wins），
实现更简单（无版本号），但会静默丢失用户的输入。**我们选择让用户看到冲突，而不是让改动无声消失。**

---

### US4 · 任务评论

**作为**团队成员
**我想要**就任务讨论
**以便**决策过程留在上下文里

#### 验收标准

| # | 标准 |
|---|------|
| 4.1 | WHEN 项目成员执行 `POST /tasks/:id/comments` 且 `body` 长度 1–2000 THE system SHALL 创建评论，返回 **201**，响应含 `id`、`author_id`、`created_at`。 |
| 4.2 | IF `body` 为空或全为空白字符 THEN THE system SHALL 返回 **400**（`INVALID_COMMENT_BODY`）。 |
| 4.3 | IF `body` 长度超过 2000 字符 THEN THE system SHALL 返回 **400**（`INVALID_COMMENT_BODY`）。 |
| 4.4 | WHEN `GET /tasks/:id/comments` THE system SHALL 按 `created_at` **升序**返回（最早的在前，符合对话阅读顺序），分页规则同 2.6–2.9。 |
| 4.5 | IF 请求者不是任务所属项目成员 THEN THE system SHALL 对两个评论端点均返回 **404**（`TASK_NOT_FOUND`）。 |
| 4.6 | THE system SHALL **不提供**评论的编辑或删除能力（本次范围内）。 |

**4.4 与 2.9 的排序方向刻意相反**：任务列表是「最新在前」（关心最近动态），
评论是「最早在前」（阅读对话顺序）。**这个不一致是业务决定的，不是疏漏——所以必须写下来。**

---

### US5 · 审计日志

**作为**团队负责人
**我想要**看到谁做了什么
**以便**出问题时能追溯

#### 验收标准

| # | 标准 |
|---|------|
| 5.1 | THE system SHALL 为以下动作记录审计条目：项目创建、任务创建、任务状态变更、评论创建、成员加入/移除。 |
| 5.2 | THE system SHALL 保证每条审计条目含固定五字段：`actor` / `action` / `target` / `result` / `timestamp`。 |
| 5.3 | IF 操作因权限不足而被拒绝 THEN THE system SHALL **仍然记录**该尝试，`result` 为 `denied`。 |
| 5.4 | IF 操作因并发冲突而被拒绝 THEN THE system SHALL 记录该尝试，`result` 为 `conflict`。 |
| 5.5 | THE system SHALL 保证审计条目**不被任何业务 API 修改或删除**（本次范围内无删除审计的接口）。 |

**5.3 与 5.4 是最容易被漏掉的两条**：如果只记录成功操作，
就无法发现「有人在反复尝试越权访问」——而这恰恰是审计最有价值的场景。

---

### US6 · 成员管理

**作为**项目负责人
**我想要**增减成员
**以便**控制项目访问范围

#### 验收标准

| # | 标准 |
|---|------|
| 6.1 | WHEN `owner` 执行成员加入操作 THE system SHALL 添加成员，返回 **200**。 |
| 6.2 | IF `member` 尝试加入或移除成员 THEN THE system SHALL 返回 **403**（`FORBIDDEN`）。 |
| 6.3 | IF 操作将导致项目**没有任何 `owner`** THEN THE system SHALL 拒绝并返回 **422**（`LAST_OWNER`）。 |
| 6.4 | IF 目标用户已是成员 THEN THE system SHALL 返回 **200**（幂等，不报错）。 |
| 6.5 | WHEN 成员被移除 THE system SHALL **保留**该成员此前创建的任务与评论，`author_id` 不变。 |

**6.3 是本类最经典的陷阱**：没有这条，负责人可以把自己移出项目，
然后**项目永远无法再次管理**——没有 owner 就不能加 owner。这个洞只能用恢复脚本补。

**6.5 的取舍**：另一种做法是匿名化（显示为「已退出的成员」）。
我们选择保留 `author_id`——**代价是已离开的成员仍可被关联**，收益是审计链路完整。

---

## 5. 非目标（Out of Scope）

以下明确不在范围内，实现中出现即为范围蔓延：

- 通知推送（邮件 / webhook / 站内信）
- 评论的编辑与删除
- 任务附件、@提及、富文本
- 跨项目的任务移动
- 项目归档与删除的软删除回收站
- 角色超过 2 种（如 `viewer`、`admin`）
- 端点超过 7 个
- 任务的优先级、截止日期、预估工时
- 标签（在 `002-task-tags` 中处理，见 `examples/taskflow/notes/L08-feature切换.md`）

---

## 6. 边界条件汇总

| 场景 | 期望行为 | 标准 |
|------|---------|------|
| 未认证请求 | 401 `UNAUTHENTICATED` | 1.6 |
| 非成员访问项目 | 404 `PROJECT_NOT_FOUND` | 1.2 |
| `member` 建项目 | 403 `FORBIDDEN` | 1.3 |
| 创建时指定 status | 忽略该字段，仍为 `todo` | 2.2 |
| `size` > 100 | 截断为 100，返回 `effective_size` | 2.7 |
| `size` ≤ 0 或非整数 | 400 `INVALID_PAGINATION` | 2.8 |
| 非法状态转移 | 422 `INVALID_TRANSITION` | 3.2 |
| `done` 后回退 | 422 `TERMINAL_STATUS` | 3.3 |
| `archived` 后任何修改 | 422 `TERMINAL_STATUS` | 3.4 |
| version 不匹配 | 409 `CONFLICT` + `current` | 3.5 |
| 500ms 内并发同 version | 先到者胜，后者 409 | 3.6 |
| 缺少 version | 400 `VERSION_REQUIRED` | 3.7 |
| 非成员操作任务 | 404 `TASK_NOT_FOUND` | 3.9 / 4.5 |
| 评论 body 全空白 | 400 `INVALID_COMMENT_BODY` | 4.2 |
| 越权尝试被拒 | **仍记审计，`result=denied`** | 5.3 |
| 并发冲突被拒 | **仍记审计，`result=conflict`** | 5.4 |
| 移除最后一个 owner | 422 `LAST_OWNER` | 6.3 |
| 重复加成员 | 200（幂等） | 6.4 |
| 成员被移除 | 其任务与评论保留 | 6.5 |

---

## 7. 术语

| 术语 | 定义 |
|------|------|
| 项目（project） | 任务与成员的容器。有唯一的 `id`，`name` 非唯一 |
| 任务（task） | 项目内的工作项。有状态、标题、创建者 |
| 版本号（version） | 任务的整数版本。每次成功修改递增 1，用于乐观并发控制 |
| 游标（cursor） | 分页游标。不透明字符串，客户端不应解析其内容 |
| 审计条目（audit entry） | 一条不可变的操作记录，五字段固定 |
| `owner` / `member` | 项目内的两种角色。**项目至少保留一个 `owner`** |

---

## 8. 成功标准（可验证）

- [ ] 7 个端点全部实现，无第 8 个
- [ ] 全部 6 个用户故事可**各自独立**演示
- [ ] §6「边界条件汇总」表中**每一行**都有对应的验证记录
- [ ] 权限矩阵（2 角色 × 7 端点 = **14 格**）**每一格**都有测试用例
- [ ] 每条验收标准都有对应的自动化测试（映射表 100% 覆盖）
