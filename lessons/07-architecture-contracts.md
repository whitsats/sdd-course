# L07 · 架构与契约规格：让 plan 有牙齿

> **时长** 120 min（实操通常 4 h）｜ **前置** [L06](./06-clarify-checklist.md) ｜ **产出** `plan.md` + ADR + 契约测试骨架 + 映射表

这一节是 **spec-anchored 的技术核心**。

> 📁 **本节的完整参考产出**（全部是可运行的真实文件，不是片段）：
>
> | 产物 | 文件 |
> |------|------|
> | 技术方案 | `examples/taskflow/specs/001-taskflow-mvp/plan.md`（含**三处范围蔓延的真实对照案例**） |
> | ADR | `examples/taskflow/docs/adr/ADR-002-并发冲突策略.md` |
> | 类型约束 | `examples/taskflow/src/domain/{state-machine,permissions,pagination}.ts` |
> | 契约测试 | `examples/taskflow/tests/contract/{auth-matrix,task-state,task-concurrency}.spec.ts` |
> | 映射表 | `examples/taskflow/docs/验收标准-测试映射.md`（**40 条，与 spec 机械对齐**） |
> | CI 门禁 | `examples/taskflow/.github/workflows/sdd-gate.yml` |
> | 覆盖率脚本 | `scripts/check-spec-coverage.sh`（**实测可用**） |
>
> `auth-matrix.spec.ts` 里的 14 格矩阵、`task-concurrency.spec.ts` 里的 20 并发写入用例，
> 都是可以直接拿去改的代码。

L05 你亲手证明了一个残酷的事实：**规格是有效的，但没有强制力。** 你唯一能发现漂移的方式是主动对照 spec——而现实中没人天天这么做。

L07 要回答的就是：

> **怎么把「验收标准」这种给人读的句子，变成会导致 CI 失败的可执行断言？**

---

## 1. `/speckit-plan`：把澄清结果变成结构

```
/speckit-plan 架构：

- Fastify + zod 校验 + Postgres（pg 驱动，不用 ORM）
- 分层：routes/（解析与序列化）→ services/（编排）→ domain/（纯规则）
  → repositories/（SQL）
- domain 层必须纯函数：状态机、权限判定、分页游标编码全部无 IO
- 数据库迁移用纯 SQL 文件，按序号命名
- 测试：vitest + testcontainers（或本地临时库），覆盖 domain 单测与 API 契约测试

非功能需求（只三条，都必须带数字）：
- 列表接口 P95 < 200ms（1000 条任务量级），单页 ≤ 100 条
- 并发冲突窗口：500ms 内对同一任务的两次状态写入，先到者胜
- 所有错误响应携带机器可读错误码，字段名固定为 `code`
```

**注意这里只写了三条非功能需求。** 不是懒——是**故意的**。

> 📌 非功能需求写多了会变成噪音。三条带数字的、会被测试覆盖的，胜过二十条「性能要好、安全可靠」。

**判断标准**：这条非功能需求，我**会为它写测试吗**？不会写的，就别写进 plan。

---

## 2. 写一份真正的 ADR ⭐

L04 你在 focuslog 里练过格式（存储选型）。这次写给**本项目最贵的那个决策**：

> **并发冲突用什么策略实现？**

```markdown
# ADR-002 · 并发冲突用乐观并发控制（版本号）

## 状态
已采纳（2026-09-22）

## 背景
spec 要求：500ms 内对同一任务的两次状态写入，先到者胜，后者返回 409 + 服务端当前状态。
这是本项目唯一涉及「正确性」而不只是「可用性」的需求。

## 决策
任务行上加 `version` 整数列。写入时带上客户端已知的 version，
SQL 用 `UPDATE ... WHERE id = ? AND version = ?`，返回影响行数。
- 影响 1 行 → 成功，version + 1
- 影响 0 行 → 冲突，读取当前行，返回 409 + 当前状态

## 代价（必须写）
- 客户端必须把 version 一路带回来（多一个字段的传播成本）
- 乐观锁在高冲突场景下会频繁失败并重试；本场景冲突率低，可接受
- **`updated_at` 时间戳方案被否决的原因：500ms 窗口内两个写入可能拿到相同
  的时间戳精度，无法区分先后**
- 悲观锁（SELECT FOR UPDATE）被否决：会持有事务锁并可能死锁，
  而本场景冲突是罕见事件，不值得常态化付出锁成本

## 什么时候该推翻
- 冲突率上升导致用户频繁看到 409
- 引入批量状态变更接口（乐观锁的逐行重试会变得很啰嗦）

## 影响范围
- 迁移文件增加 `version` 列
- 所有 PATCH 类接口的请求体与响应体都含 version
- 契约测试必须包含「两个并发写入」用例
```

### 为什么这份 ADR 值得写

因为它记录了三件**代码里看不出来**的事：

1. **为什么不用时间戳** —— 这是三个月后最可能被重新提出的方案（「加个 updated_at 不就完了？」），而它的失败原因是**精度**，不是设计。不写下来就会被重新试一次。
2. **为什么不用悲观锁** —— 这是教科书上的标准答案，所以一定会有人建议。**否决理由和选择理由一样重要。**
3. **什么时候该推翻** —— 这是给未来的人的**触发条件**，而不是模糊的「必要时重构」。

> **不写代价的 ADR 是宣传材料。** 只写「我们选了 X，因为 X 好」，等于没写。

---

## 3. 三种「牙齿」⭐

规格要变成可执行约束，有三层武器。它们成本递增、覆盖面递减（越靠前越便宜、越能早发现）：

| 层 | 技术 | 能抓什么 | 抓不到什么 |
|----|------|---------|-----------|
| **① 类型约束** | zod schema | 字段类型、必填、取值范围、枚举 | 跨字段规则、状态流转 |
| **② 契约测试** | vitest 用例 | 行为、状态机、权限矩阵、并发 | 内部重构引入的偏差（不关心） |
| **③ CI 门禁** | GitHub Actions | **漂移**：任何让 ① ② 失败的改动 | 规格本身错了（那需要人） |

### ① 类型约束：把「输入格式」的规格变成代码

spec 里的这条：

```markdown
- IF 用户提供的状态不在 {todo, doing, in_review, done} 中
  THEN THE system SHALL 返回 400，错误码 INVALID_STATUS
```

直接变成 zod schema：

```typescript
import { z } from 'zod';

export const TaskStatus = z.enum(['todo', 'doing', 'in_review', 'done']);

export const PatchTaskBody = z.object({
  status: TaskStatus,
  version: z.number().int().nonnegative(),
});

// 非法输入由 Fastify 的校验钩子统一转成 400 INVALID_STATUS
```

**注意这里发生了什么**：`TaskStatus` 这个枚举**同时是** spec 里的合法性规则、plan 里的数据模型、实现里的类型。**一处定义，三处生效。** 这就是「可执行的规格」。

> 如果 L06 里你把状态定成了 5 个，这里就必须是 5 个。而如果你改了 spec 里的状态集合却忘了改这里——这就是 L08 的 `/speckit-analyze` 要抓的东西。

### ② 契约测试：把「行为」的规格变成断言

**这是本节工作量最大的部分，也是映射表的落点。**

### ③ CI 门禁：让失败变红灯

L09 专门做。现在先把 ① ② 建起来。

---

## 4. 验收标准 ↔ 测试用例映射表 ⭐⭐ 本节核心产物

**这是 spec-anchored 能够成立的技术基础。** 没有这张表，「规格驱动」只是一句口号。

建 `docs/验收标准-测试映射.md`：

```markdown
# 验收标准 ↔ 测试用例映射

| # | 验收标准（spec.md 原文简写） | 测试文件::用例名 | 类型 |
|---|---------------------------|----------------|------|
| 1 | WHEN 建项目 WHILE 用户已认证 THE system SHALL 创建并返回 201 | `projects.spec.ts::creates_project` | 行为 |
| 2 | IF 用户不是项目成员 THEN 访问项目返回 404 | `auth-matrix.spec.ts::non_member_gets_404` | 权限 |
| 3 | IF 非 owner 尝试建项目 THEN 返回 403 | `auth-matrix.spec.ts::member_cannot_create_project` | 权限 |
| 4 | WHEN 任务状态从 todo 改为 doing THE system SHALL 成功 | `task-state.spec.ts::todo_to_doing` | 状态机 |
| 5 | IF 任务状态从 todo 直接改为 done THEN 返回 422 INVALID_TRANSITION | `task-state.spec.ts::no_skip_transition` | 状态机 |
| 6 | IF 任务已是 done 再被改状态 THEN 返回 422 TERMINAL_STATUS | `task-state.spec.ts::done_is_terminal` | 状态机 |
| 7 | IF 500ms 内两次写入同一任务 THEN 先到者胜，后者返回 409 + 当前状态 | `task-concurrency.spec.ts::lost_update_gets_409` | 并发 |
| 8 | WHEN 列表请求 size=1000 THE system SHALL 截断为 100 并返回 next_cursor | `pagination.spec.ts::size_truncated_to_max` | 边界 |
| 9 | IF 移除最后一个 owner THEN 返回 422 LAST_OWNER | `members.spec.ts::cannot_remove_last_owner` | 边界 |
| 10 | THE system SHALL 为每个错误响应返回 `code` 字段 | `error-shape.spec.ts::every_error_has_code` | 契约 |
```

### 这张表的三个作用

1. **可验证性证明** —— 每条验收标准都有落点。**空着的行就是漏洞，一眼可见。**
2. **变更影响面计算** —— 改一条验收标准，看它对应几行，就知道要动几个测试。（这是 L09 成本量化的输入）
3. **反向检查 spec** —— 某条验收标准**写不出测试**？说明它不可验收，回 L06 重写。

### 覆盖率自检

```bash
# spec 里的验收标准条数
grep -cE '^- (WHEN|WHILE|WHERE|IF|THE)' specs/*/spec.md

# 映射表里的行数
grep -c '^| [0-9]' docs/验收标准-测试映射.md
```

**两个数字必须相等。** 不相等就是有验收标准没有测试。

---

## 5. 写几个真的会失败的测试

**不要只写 happy path。** 从映射表里挑三个最容易翻车的写完整：

### 状态机测试

```typescript
describe('任务状态流转', () => {
  it('允许 todo → doing', async () => {
    const res = await patchTask(task.id, { status: 'doing', version: 1 });
    expect(res.status).toBe(200);
    expect(res.json.version).toBe(2);
  });

  it('拒绝跳过中间状态的流转', async () => {
    const res = await patchTask(task.id, { status: 'done', version: 1 });
    expect(res.status).toBe(422);
    expect(res.json.code).toBe('INVALID_TRANSITION');
  });

  it('done 是终态', async () => {
    const done = await finishTask(task);          // todo→doing→in_review→done
    const res = await patchTask(task.id, { status: 'doing', version: done.version });
    expect(res.status).toBe(422);
    expect(res.json.code).toBe('TERMINAL_STATUS');
  });
});
```

### 并发冲突测试 ⚠️ 最难写，也最值钱

```typescript
it('500ms 内并发写入：先到者胜，后者 409 并返回当前状态', async () => {
  // 两个客户端持相同的 version，同时写入不同状态
  const [a, b] = await Promise.all([
    patchTask(task.id, { status: 'doing',     version: task.version }),
    patchTask(task.id, { status: 'in_review', version: task.version }),
  ]);

  const ok  = [a, b].filter(r => r.status === 200);
  const con = [a, b].filter(r => r.status === 409);

  expect(ok).toHaveLength(1);
  expect(con).toHaveLength(1);
  // 关键：输的一方必须拿到服务端的当前状态，否则客户端无法自行恢复
  expect(con[0].json.current.status).toBe(ok[0].json.status);
  expect(con[0].json.code).toBe('CONFLICT');
});
```

**这个测试同时验证了 ADR-002 的决策和 spec 的验收标准。** 如果实现改成了「后到者胜」，它会红；如果响应里忘了带 `current`，它也会红。

### 权限矩阵测试

2 角色 × 7 端点 = 14 格。**用表格驱动，别手写 14 个 `it`：**

```typescript
const matrix = [
  // [角色, 方法, 路径, 期望]
  ['owner',  'POST', '/projects',                 201],
  ['member', 'POST', '/projects',                 403],  // ← 映射表第 3 行
  ['owner',  'GET',  '/projects/:id',             200],
  ['member', 'GET',  '/projects/:id',             200],  // ← 映射表第 2 行
  ['member', 'GET',  '/projects/other-id',        404],  // ← 非成员，不暴露存在性
  // ...
] as const;

it.each(matrix)('%s %s %s → %i', async (role, method, path, expected) => {
  const res = await request(method, resolve(path), { as: role });
  expect(res.status).toBe(expected);
});
```

**这 14 格是「契约测试只测 happy path」（[AP-14](../reference/anti-patterns.md)）最容易翻车的地方。** 表格驱动让漏测变得**肉眼可见**——如果是 13 行而不是 14 行，你一眼就看出来了。

---

## 6. 故意留一条会失败的测试 ⭐

验收标准里有一条：

> **存在至少一条故意写成会失败的测试，用来证明测试真的能抓到偏离。**

这不是自虐，是**元验证**：**你得先证明你的检测手段有效，才能信任它。**

做法：加一个测试，断言一个规格里**没有**的行为：

```typescript
it('[元验证] 测试确实会抓到偏离', async () => {
  // 这个断言是错的：规格规定 todo → done 非法
  // 如果它居然通过了，说明测试环境或断言根本没生效
  const res = await patchTask(task.id, { status: 'done', version: 1 });
  expect(res.status).toBe(200);   // ← 故意写错，应该失败
});
```

**跑一次，确认它变红。** 然后把它标记为 `it.skip` 或删掉，并在映射表里注明：

```markdown
| — | [元验证] 测试有效性 | `meta.spec.ts::sanity_fails` | 已确认 |
```

> 📌 **这个练习在 L09 会放大成「红蓝对抗」。** 现在先在单元测试层面建立这个习惯：**任何检测机制，都必须先被证明能检测到东西。**

---

## 7. 三条非功能需求怎么测

| 非功能需求 | 怎么测 |
|-----------|-------|
| 列表接口 P95 < 200ms（1000 条）| 基准测试脚本，造 1000 条数据跑 100 次，断言 P95 阈值；**在 CI 里标记为「只警告不阻断」**（见下） |
| 并发窗口 500ms | 并发契约测试（第 5 节那个）。**这是行为测试，不是性能测试** |
| 每个错误响应有 `code` | `error-shape.spec.ts`：遍历所有已知错误路径，断言 `code` 存在 |

**注意第一条的处置**：性能测试在 CI 里**容易抖动**（共享 runner），如果设成硬性阻断，你会得到一个「随机变红的 CI」——然后团队就会把它关掉（[AP-18](../reference/anti-patterns.md)）。

> **原则：只把「确定性失败」设成阻断门禁，把「概率性失败」设成警告。**

### 把错误码表变成机器可读投影

错误码表是三种牙齿之外的第四种形态：**spec 的机器可读投影**。spec 的表格是人读的；
实现里散落的 `'CONFLICT'` 字符串是机器写的。两个表示会漂移——而实现顺手发明一个
spec 里没有的错误码时，**没有任何测试会红**：错误路径通常没人断言到那么细。

[`scripts/check-error-codes.py`](../scripts/README.md) 把这件事变成门禁，规则刻意单向：

> **实现引用的每个错误码，都必须能在 spec 里指回一条标准。**
> 反向不查 —— spec 声明了完整 API 的码，实现可能尚未提交；查了会红在本该绿的地方。

`--json` 输出投影（`code → 引用它的标准编号列表`），这就是 spec 的机器可读表示：
监控、文档、告警探针（L16）都从它取数，不再各自手抄一份。

实测案例在本仓库里就有一个：`examples/taskflow` 的 harness 在未知路由上曾返回自造的
`NOT_FOUND` —— 这道门禁接上时抓出的第一件事就是它（现改为不带错误码的 404）。
**实现不得发明 spec 里没有的错误码**；要先有 spec 的那一行，才有实现里的那个字符串。

---

## 8. 交付物与验收

### 交付物

1. `plan.md`（含架构分层、数据模型含 `version` 列、3 条非功能需求）
2. `docs/adr/ADR-002-并发冲突策略.md`
3. `zod` schema 文件（类型约束层）
4. 契约测试骨架：状态机 / 权限矩阵 / 并发 / 分页 / 错误形状
5. **`docs/验收标准-测试映射.md`**（覆盖率达 100%）
6. 一条已确认会失败的元验证测试记录

### 验收清单

**plan**

- [ ] 每项技术决策能指回 spec 或宪法；**至少抓到并处理一条范围蔓延**
- [ ] 数据模型含 `version` 列，且与 ADR-002 一致
- [ ] 非功能需求**只有 3 条**，且每条都带数字、都能写出测试

**ADR**

- [ ] 「代价」小节列出至少 3 条
- [ ] 「被否决的选项」**包含教科书标准答案**（悲观锁）并说明否决理由
- [ ] 有「什么时候该推翻」的**具体触发条件**

**契约测试**

- [ ] 映射表覆盖率达到 **100%**（`grep` 两个数字相等）
- [ ] 权限矩阵用**表格驱动**，14 格完整
- [ ] 并发测试断言了「输的一方拿到服务端当前状态」
- [ ] 状态机测试覆盖：合法流转、非法流转、终态
- [ ] 有一条**故意失败**的测试，且你**亲眼确认它变红过**

**自测题**

1. 为什么 zod 里的状态枚举「同时是」规格和实现？这有什么好处？
2. ADR 里为什么必须记录「被否决的选项」，哪怕它看起来很蠢？
3. 为什么性能测试在 CI 里应该「只警告不阻断」？

<details markdown="1">
<summary>答案</summary>

1. 因为 `TaskStatus` 这一个定义同时承担了三种角色：spec 里的合法性规则、plan 里的数据模型、TypeScript 里的类型。好处是**改一处即全生效**——不存在「文档说了 4 个状态、代码里写了 5 个」这种不一致。这正是「可执行的规格」的字面含义。
2. 因为**被否决的理由往往比选择的理由更容易被遗忘**。「为什么不用悲观锁」在三个月后会变成一个很合理的新提议，而它的否决理由（常态化锁成本、死锁风险）如果没记下来，就会被重新试一遍。**ADR 真正的价值是固化「为什么没选」。**
3. 因为共享 CI runner 的性能抖动会导致**随机红灯**。而随机红灯的必然结局是团队把它关掉——**然后你连其他门禁也一起失去了**。门禁的价值建立在「红灯必有意义」之上，破坏这个前提比少一道门禁更糟。

</details>

---

## 9. 踩坑预警

| 坑 | 症状 | 解法 |
|----|------|------|
| **契约测试只测 happy path** | CI 全绿，生产出事 | 权限矩阵表格驱动 + 状态机覆盖终态 + 并发用例（[AP-14](../reference/anti-patterns.md)） |
| **映射表不维护** | 表里全是旧用例名，覆盖率和实际不符 | 映射表是**活的**。新增验收标准必须同时加行 |
| **ADR 只写选择理由** | 「我们选了乐观锁，因为乐观锁好」 | 必须写代价 + 被否决选项 + 推翻条件 |
| **非功能需求写成形容词** | 「性能要好」「安全可靠」 | 带数字。写不出测试的就别写 |
| **想把 ADR 写全** | 给每个决策都写 ADR，时间不够 | **只写给最贵的那个**（[AP 补充](../reference/anti-patterns.md)） |
| **没做元验证** | 假设测试有效，但实际断言写错了、根本没生效 | 故意写一条会失败的测试，确认它真的红 |
| **性能测试设成硬阻断** | CI 随机变红 | 只把「确定性失败」设成阻断 |
| **zod 枚举与 spec 不一致** | spec 说 4 个状态，代码里 5 个 | 这正是 L08 的 `/speckit-analyze` 要抓的；现在先把枚举来源标注在注释里指向 spec |

---

## 10. 本节术语

| 术语 | 含义 |
|------|------|
| 可执行的规格 | 规格同时是文档和断言；偏离即测试失败 |
| 类型约束 | 用 schema/类型系统表达规格中的输入合法性规则 |
| 契约测试 | 把行为规格变成自动化断言的测试 |
| 映射表 | 验收标准 ↔ 测试用例的显式对应；spec-anchored 的技术基础 |
| 乐观并发控制 | 用版本号检测冲突，冲突罕见时成本最低 |
| 元验证 | 先证明检测机制有效，再信任它 |
| 表格驱动测试 | 用数据表代替重复的测试代码，让漏测可见 |

---

## 11. 下一节预告

你现在有了一份带牙齿的 plan：类型约束、契约测试、100% 映射表。

但**还没验证过它们之间是否自相矛盾**。真实情况里，可能性很大——spec 定的状态集合、plan 画的状态机、tasks 里拆的任务，三者不一致是常态而非例外。

**L08 就是一致性检查 + 分批实现。** 而且我要求你做一件反直觉的事：**先故意制造一处矛盾，验证 `/speckit-analyze` 能抓出来。**

同时 L08 会补上本课程此前一直缺的一个真实技能：**多 feature 工作流**。

---

**上一节** ← [L06 · Clarify & Checklist](./06-clarify-checklist.md)
**下一节** → [L08 · Analyze 与分批实现](./08-analyze-implement.md)
**参考** → [反模式清单](../reference/anti-patterns.md) ｜ [术语表](../reference/glossary.md)
