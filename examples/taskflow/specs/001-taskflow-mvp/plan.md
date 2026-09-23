# 技术方案 · taskflow MVP

> **本文件是 L07 的完整参考产出。** 三个对照重点：
> ① **§3 的可追溯性表**里标出了 3 处范围蔓延及其处置 ② **§2 的 SQL** 用结构表达了状态机与不变量
> ③ **§5** 说明了为什么某些「看起来很专业」的技术选择被否决

**对应规格**：`specs/001-taskflow-mvp/spec.md`（7 端点 / 2 角色 / 4+1 状态）
**最后更新**：2026-09-22

---

## 1. 架构分层

```
src/
├── app.ts                     组装 Fastify 实例、注册插件与路由
├── routes/
│   ├── projects.ts            POST /projects、GET /projects/:id
│   ├── tasks.ts               POST/GET /projects/:id/tasks、PATCH /tasks/:id
│   └── comments.ts            POST/GET /tasks/:id/comments
├── services/
│   ├── project.service.ts     编排：鉴权 → 领域 → 仓储 → 审计
│   ├── task.service.ts
│   ├── comment.service.ts
│   └── audit.service.ts
├── domain/                    ⚠️ 纯函数，禁止任何 IO 与框架依赖
│   ├── state-machine.ts       合法流转表（标准 3.2–3.4）
│   ├── permissions.ts         权限矩阵（2 角色 × 7 端点）
│   ├── pagination.ts          游标编码/解码、size 截断（标准 2.6–2.9）
│   └── errors.ts              错误码常量
├── repositories/
│   ├── project.repo.ts
│   ├── task.repo.ts           ⚠️ 含乐观并发控制的 SQL（ADR-002）
│   └── comment.repo.ts
├── schemas/                   zod：请求/响应契约（类型约束层）
│   ├── project.schema.ts
│   ├── task.schema.ts
│   └── comment.schema.ts
└── plugins/
    ├── auth.ts                解析认证 → 注入 request.user
    └── error-handler.ts       统一错误 → 错误码 + 状态码
```

### 分层边界（宪法约束，CI 强制）

| 规则 | 违反示例 | 检测方式 |
|------|---------|---------|
| `domain/` 不得 import `repositories/`、`services/`、`routes/`、`fastify` | 在 `state-machine.ts` 里查数据库 | CI 中的 import 检查（§5） |
| `domain/` 必须是**纯函数** | 读 `process.env`、调 `Date.now()` | 同上 + 依赖注入评审 |
| `routes/` 只能调 `services/`，不得直连 `repositories/` | 路由里直接写 SQL | import 检查 |
| `repositories/` 不得包含业务规则 | 在 repo 里判断状态转移是否合法 | code review |

**`domain/` 纯函数的回报**：标准 3.2–3.4（状态机）与全部权限判定的测试**不需要数据库、不需要 HTTP**。
权限矩阵的 14 格可以在一秒内跑完——这是它敢把「14 格全覆盖」写进验收标准的前提。

---

## 2. 数据模型

### 迁移 `migrations/001_init.sql`

```sql
CREATE TABLE projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  created_at  TIMESTAMPTZ NOT NULL
);

CREATE TABLE members (
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  joined_at   TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE tasks (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title        TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  status       TEXT NOT NULL DEFAULT 'todo'
               CHECK (status IN ('todo','doing','in_review','done','archived')),
  version      INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at   TIMESTAMPTZ NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL
);

CREATE TABLE comments (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id   TEXT NOT NULL,
  body        TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  created_at  TIMESTAMPTZ NOT NULL
);

CREATE TABLE audit_entries (
  id          BIGSERIAL PRIMARY KEY,
  actor       TEXT NOT NULL,
  action      TEXT NOT NULL,
  target      TEXT NOT NULL,
  result      TEXT NOT NULL CHECK (result IN ('ok','denied','conflict','error')),
  at          TIMESTAMPTZ NOT NULL
);

-- 分页排序键（标准 2.9）：created_at DESC, id DESC
CREATE INDEX idx_tasks_project_created
  ON tasks (project_id, created_at DESC, id DESC);

CREATE INDEX idx_comments_task_created
  ON comments (task_id, created_at ASC, id ASC);

-- 审计查询（按项目追溯）
CREATE INDEX idx_audit_at ON audit_entries (at DESC);
```

### 四个用结构表达规格的设计

**① `status` 的 `CHECK` 约束把状态集合钉在数据库层。**

spec §3 定义了 5 个状态的集合。放进 `CHECK` 意味着**任何绕过 domain 层的写入都写不进非法状态**。
配上 zod 的 `z.enum`（§1），同一个集合在类型层与存储层各有一道锁。

> 对应标准：3.2、3.3、3.4

**② `members.role` 的 `CHECK` 把「只有 2 个角色」写进 schema。**

这直接对应 spec §2 的「只有 2 个角色」。如果有人日后加 `viewer`，他会先撞上这条约束——
**这是一个提醒他需要先改 spec 的机制**。

**③ `tasks.version` 是乐观并发控制的核心，且 `CHECK (version >= 1)` 防止出现 0 或负数。**

> 对应标准：3.1（`version` 递增）、3.5–3.7、ADR-002

**④ 排序索引的列顺序与标准 2.9 / 4.4 完全一致，且包含 `id` 作为末列。**

```sql
-- 任务：created_at DESC, id DESC（标准 2.9）
CREATE INDEX idx_tasks_project_created ON tasks (project_id, created_at DESC, id DESC);
```

**索引里包含 `id` 不是多余的**：它让「`created_at` 相同的次级排序」也能走索引，
而不是在应用层做不稳定排序。**规格里的排序规则，直接决定了索引的定义。**

### 「至少一个 owner」为什么不在数据库层强制

标准 6.3 要求项目至少保留一个 `owner`。这**无法**用简单的 `CHECK` 表达（它是一条跨行的聚合约束）。
可选方案：
- 触发器 / 部分唯一索引 —— 能在 DB 层做，但可读性差、迁移复杂
- **应用层事务内校验 —— 我们选这个**

**代价必须记录**：并发移除两个 owner（当前恰好 2 个）时，两个事务可能都通过校验，
最终留下 0 个 owner。缓解手段是移除操作时对 `members` 行加 `FOR UPDATE` 锁。

> ⚠️ **这条已知缺口写在 plan 里、而不是留在代码注释里** —— 因为它是**规格级**的风险，
> 评审 plan 的人需要看到它。这也是 L08 的 `/speckit-analyze` 应该能发现的类型。

---

## 3. 技术决策与可追溯性 ⭐

### 3.1 可追溯的决策

| # | 决策 | 服务的 spec / 宪法条目 | 判定 |
|---|------|---------------------|------|
| D1 | TypeScript strict、禁 `any` | 宪法「语言与运行时」 | ✅ |
| D2 | Fastify + zod | 宪法「HTTP 框架 / 输入校验」 | ✅ |
| D3 | 分层 `routes → services → domain → repositories` | 宪法「架构边界」 | ✅ |
| D4 | 状态机用**显式流转表**而非 if-else | 标准 3.2（需穷举合法流转） | ✅ |
| D5 | 权限判定为纯函数矩阵 | 标准 1.2/1.3/2.4/3.9/4.5/6.2 六处鉴权 | ✅ |
| D6 | 乐观并发控制（`version` 列） | 标准 3.1、3.5–3.7、3.6 | ✅ |
| D7 | 冲突响应含 `current` 对象 | 标准 3.5 | ✅ |
| D8 | cursor 分页（非 offset） | 标准 2.9（排序确定性）+ 宪法性能预算 | ✅ |
| D9 | `size` 超限截断并返回 `effective_size` | 标准 2.7 | ✅ |
| D10 | 非成员访问一律 404 | 标准 1.2、2.4、3.9、4.5、6 | ✅ |
| D11 | 审计记录拒绝操作（`denied` / `conflict`） | 标准 5.3、5.4 | ✅ |
| D12 | 错误码集中在 `domain/errors.ts` | 宪法「可观测性」 | ✅ |
| D13 | 成员移除保留 `author_id` | 标准 6.5 | ✅ |
| D14 | `updated_at` 每次写入刷新 | 标准 5.1（审计需要时间戳基准） | ✅ |
| D15 | 迁移用纯 SQL 文件 | 宪法「数据库迁移」 | ✅ |

**31 条验收标准，15 项决策，全部可追溯。** 没有孤儿决策。

---

### 3.2 范围蔓延对照案例 ⭐ 这是本节最该看的部分

以下是**真实会出现在 plan 里**的东西。它们都有一个共同特征：**看起来很专业**。
这让它们在 plan review 时极容易被放过。

#### 🔴 蔓延 1 · Redis 缓存层

```markdown
（agent 原始 plan 中的一条）
- 引入 Redis 缓存任务列表查询结果，TTL 60 秒，降低数据库压力
```

**为什么它看起来合理**：任务列表是最高频的端点；缓存是最标准的优化手段；量级上确实说得通。

**诊断**：

| 检查项 | 结果 |
|--------|------|
| 服务哪条 spec 标准？ | ❌ 无。spec 里只有一条性能要求：「列表接口 P95 < 200ms（1000 条任务量级）」——**这是宪法里的预算，不是 spec 的功能要求** |
| 这个预算需要缓存吗？ | 1000 条任务、一个索引查询，Postgres 在本地毫秒级返回。**不需要** |
| 引入的新复杂度 | 缓存失效、一致性窗口、部署依赖、测试需要 Redis 实例 |
| **会违背哪条标准？** | ⚠️ **标准 3.1/3.6**：写操作后立刻读，60 秒内可能读到旧状态。**这会直接让并发冲突的 409 响应带上过期的 `current` 对象** |

**处置**：**删除。**

> 📌 **注意最后一行的诊断方式。** 蔓延不只是「多做了不必要的事」，
> 它常常**与已有规格直接冲突**。发现这一点的唯一方法是逐条追问「它服务哪条标准」。

---

#### 🔴 蔓延 2 · 事件总线（用于未来的通知）

```markdown
- 引入事件总线，任务状态变更发布 `task.status_changed` 事件，为后续通知功能预留扩展点
```

**为什么它看起来合理**：「为未来预留」听起来是好的架构判断；事件驱动是主流模式。

**诊断**：

| 检查项 | 结果 |
|--------|------|
| 服务哪条 spec 标准？ | ❌ 无。标准 5.1 要求**记录**审计条目，没要求**发布事件** |
| spec 里通知相关 | ❌ 明确在**非目标**列表里：「通知推送（邮件 / webhook / 站内信）」 |
| 它与已有要求的关系 | 标准 5.2 要求审计五字段固定。事件总线是**另一条并行的记录路径**，会造成两处真相源 |

**处置**：**删除。** 并在 plan 中显式记录：

```markdown
### 未包含项（与 spec 非目标对齐）
- 事件总线 / 通知预留：spec 非目标明确排除通知推送。
  「为未来预留」不构成当前实现的理由——它引入第二条记录路径，
  与标准 5.2「审计五字段固定」形成双真相源风险。
  未来若要做通知，从 `audit_entries` 读取即可，无需现在建总线。
```

> 📌 **「为未来预留」是范围蔓延最常见的外衣。** 判断方法很简单：
> **未来的需求写进 spec 了吗？** 没写就不要现在做。

---

#### 🔴 蔓延 3 · Prometheus 指标导出

```markdown
- 暴露 `/metrics` 端点，导出请求延迟、错误率、冲突次数等 Prometheus 指标
```

**为什么它看起来合理**：「可观测性」在宪法里有专门一节，看起来很契合。

**诊断**：

| 检查项 | 结果 |
|--------|------|
| 服务哪条 spec 标准？ | ❌ 无 |
| 服务宪法的「可观测性」条目吗？ | ❌ **不。** 宪法该条要求的是「每个错误响应携带机器可读错误码」+「审计日志五字段固定」。**两者都已由 D12 与标准 5.2 满足** |
| 额外复杂度 | 多一个端点（**违反标准 8「7 个端点全部实现，无第 8 个」**）、指标库依赖、部署配置 |

**处置**：**删除**，并记录理由：

```markdown
### 未包含项
- Prometheus `/metrics`：① 违反「端点不超过 7 个」的成功标准
  ② 宪法的「可观测性」要求已由错误码（D12）与审计日志（标准 5.2）满足。
  「可观测性」不等于「必须有 metrics 端点」——**这是把宪法条目做了过度解读**。
```

> 📌 **过度解读宪法**是一种隐蔽的蔓延。宪法说「要有可观测性」，
> 不等于「要上监控栈」。**宪法条目和它的具体实现方式之间，需要用 spec 做桥接。**

---

### 3.3 三条蔓延的共同点（值得记下来）

| 共同特征 | 说明 |
|---------|------|
| 都**看起来很专业** | 缓存、事件驱动、指标导出——都是「好架构」的标志 |
| 都**找不到 spec 依据** | 逐条追问「服务哪条标准」时会卡住 |
| 都**引入了新的失败模式** | 缓存→读到旧数据；事件总线→双真相源；metrics→多一个端点 |
| 通常**只有蔓延 1 会与已有规格显式冲突** | 这也是为什么「追问服务哪条标准」比「分析是否合理」更有效 |

**处理规则只有两条，没有第三条**：
1. **删掉**（上例全部适用）
2. 或者**显式补进 `spec.md`**，并承认范围扩大了

> ⛔ **绝对不允许的处理方式**：在 plan 里留着，但不说清它服务什么。
> 那等于把范围蔓延**藏进了实现**。

---

### 3.4 唯一一处「指不回 spec 但保留」的决策

| 决策 | 处置 |
|------|------|
| D15（迁移用纯 SQL 文件） | 不对应任何 spec 标准，对应的是**宪法**「数据库迁移用纯 SQL 文件，按序号命名」。**服务宪法条文，可追溯 ✅** |

**结论：本 plan 里 15 项决策全部可追溯到 spec 或宪法，3 处蔓延已全部删除。**
这与 `examples/focuslog` 的 plan 形成对照——focuslog 的 D8（`schema_version`）是一条「无 spec 依据但有理由」的决策，
而这里的三处蔓延是「无 spec 依据且无理由」的。**区别不在于能不能找到理由，而在于理由是否成立。**

---

## 4. 三个必须写进 plan 的横向决策

这三项在 spec 里都不存在，但如果不在这里定下来，实现时会随手选一个。

### 4.1 认证方式

spec 只要求 401/403 语义（标准 1.6），**没有定义认证机制**。plan 定为：

- 请求头 `Authorization: Bearer <token>`，token 为不透明字符串
- 本次实现：从环境变量读取一组预置 token → `user_id` 的映射（**不实现登录流程**，spec 非目标未包含用户注册）

**代价**：无法演示真实的令牌轮换与过期；`user_id` 的获取依赖测试夹具。

### 4.2 冲突窗口的实现方式

标准 3.6 说「500ms 内两个请求携带相同 `version`」。

**关键澄清**：这个 500ms **不是**需要计时器实现的窗口，而是**对并发语义的描述**。
实现就是 ADR-002 的乐观锁——**任何 `version` 不匹配的写入都返回 409，无论间隔多久。**

```markdown
> ⚠️ **这是 spec 文本容易造成的误解，必须在 plan 里澄清：**
> 「500ms 内」描述的是**测试场景**（两个请求几乎同时发出），
> 而不是实现里要判断的时间窗。实现判定条件只有一个：`version` 是否匹配。
```

> 📌 **如果你的 plan 里出现了 `setTimeout(500)` 之类的逻辑，说明你误解了规格。**
> 这类误解是 L08 的 `/speckit-analyze` 和 L09 的 converge 都会抓到的典型问题。

### 4.3 游标编码格式

标准 2.6/4.4 要求返回 `next_cursor`，但**没定义它的内容**（spec 术语表只说「不透明字符串，客户端不应解析」）。

plan 定为：`base64("{created_at_iso}|{id}")`。不加密（里面没有敏感信息），但**客户端不得依赖其格式**。

**为什么必须写下来**：不定义格式时，实现者可能随手返回一个自增序号——
那在 `created_at` 有并列的情况下会漏数据。**「不透明」是指对客户端，不是指对我们自己。**

---

## 5. 依赖与 CI

### 依赖

```json
{
  "dependencies": {
    "fastify": "^5",
    "zod": "^3",
    "pg": "^8"
  },
  "devDependencies": {
    "vitest": "^2",
    "@testcontainers/postgresql": "^10",
    "typescript": "^5"
  }
}
```

生产依赖 3 个，符合宪法「最小必要」。**不使用 ORM** —— 决策理由：本项目 SQL 极简单，
而乐观并发控制需要精确控制 `UPDATE ... WHERE version = ?` 的返回行数，ORM 会把这层弄模糊（详见 ADR-002）。

### CI 门禁

```yaml
# .github/workflows/sdd-gate.yml 摘要
- Type check                # 阻断：tsc --noEmit
- Contract tests            # 阻断：vitest run --project contract
- Spec coverage             # 阻断：spec 标准条数 == 映射表行数
- Layer boundary check      # 阻断：domain/ 不得 import fastify/pg/repositories
- Perf baseline             # 只警告
```

完整文件见 `examples/taskflow/.github/workflows/sdd-gate.yml`。
覆盖率与分层检查的脚本见 `scripts/`。

---

## 6. 本方案未包含（与 spec 非目标对齐）

- Redis 缓存（蔓延 1，删除）
- 事件总线 / 通知预留（蔓延 2，删除）
- Prometheus `/metrics`（蔓延 3，删除）
- ORM（理由见 §5）
- 软删除 / 回收站（spec 非目标）
- 用户注册与登录流程（spec 非目标；本轮用预置 token）
