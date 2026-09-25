# 模板库

> **这些不是「最佳实践模板」，是「最低要求的骨架」。**
>
> 每个模板里的 ⛔ 和 📌 标记的不是风格建议，而是**踩过的坑**。
> 抄之前请读那些标注 —— 它们解释了为什么这张表要长这样。

---

## 一张表看懂什么时候用哪个

| 模板 | 什么时候用 | 配套章节 | 核心作用 |
|------|-----------|---------|---------|
| [`constitution-template.md`](constitution-template.md) | 项目启动，或团队级规则变动时 | L02 | 把「我们永远怎么做事」写下来，**每条都带验证方式** |
| [`spec-template.md`](spec-template.md) | 每个 feature 开始前 | L03 / L06 | 定义「要什么」，**并显式回答六类歧义区** |
| [`clarify-log-template.md`](clarify-log-template.md) | 规格出现歧义时（`/speckit-clarify`） | L06 | 记录**当初为什么这么理解**，将来判断假设是否失效 |
| [`plan-template.md`](plan-template.md) | 规格确认后（`/speckit-plan`） | L07 | 定义「怎么做」，**核心是可追溯性表（范围蔓延检测器）** |
| [`adr-template.md`](adr-template.md) | 决策返工成本高 / 会引发争论 / 反直觉 | L07 | 留住**否决理由**与**推翻条件**，别让讨论重来一遍 |
| [`tasks-template.md`](tasks-template.md) | 方案确认后（`/speckit-tasks`） | L04 | 按可独立交付的批次组织，**并做反向覆盖检查** |
| [`acceptance-record-template.md`](acceptance-record-template.md) | 实现完成后逐条验收 | L05 | 每一条都留**可被他人复现**的证据 |
| [`change-request-template.md`](change-request-template.md) | **改已有行为**时 | L09 | 补上「删规格容易、改规格难」这个缺口：影响分析 + 强制先让测试变红 |
| [`notes-template.md`](notes-template.md) | 每节学完后 | 全课程 | 记「最出乎意料的一点」，不记摘要 |
| [`PR-template.md`](PR-template.md) | 提 PR 时 | L12 | 让 review 能看出「规格改了没」「测试红了没」 |
| [`agent-prompt-snippets.md`](agent-prompt-snippets.md) | 对 AI agent 下指令时 | 全课程 | 可直接抄的约束句式 + **反面清单** |
| [`tool-selection-template.md`](tool-selection-template.md) | 团队引入 SDD、要做工具选型时 | L12 | 判据与权重**先于**对比确定 + 分场景建议 + **推翻条件**，防「先有结论再找理由」 |
| [`team-rollout-checklist-template.md`](team-rollout-checklist-template.md) | 团队化落地启动时 | L12 | 三段时间盒（周 / 月 / 季）+ 每个勾都要有证据 + **预先写下的退出信号** |
| [`spec-governance-template.md`](spec-governance-template.md) | spec 超过三份 / 多仓库 / 多 agent 并行时 | L12 | 一张表回答「归谁、还活着吗、谁在消费」；**owner 是人名不是团队名**，deprecated 不删除 |

---

## 三个模板的使用密度最高

如果时间有限，优先用这三个：

### 1. `plan-template.md` 的可追溯性表

> **每一行回答：这个技术决策服务于哪条验收标准？填不出来的标 ❌。**

这一张表是**范围蔓延的机械检测器**。它把「顺手多做一点」
从「感觉上不太对」变成了「表里有 ❌ 行」。

实测有效：项目 B 的原始设计里，我加了 Redis 缓存、事件总线、Prometheus 三样东西，
**每一处都填不出它服务哪条标准** —— 于是被砍掉了。见 `examples/taskflow/specs/001-taskflow-mvp/plan.md`。

### 2. `spec-template.md` 的六类歧义区

> **每格都要有答案。「本期不涉及」也是答案。留空不是。**

留空的格子**就是将来返工的地方**。而且返工发生时，你会以为是实现出了问题，
实际上是规格从未定义过那个格子。

### 3. `change-request-template.md` 的第 4 节

> **「先让测试变红」这一步不能跳。**

改规格 → 改映射 → 跑门禁（红）→ 改测试 → **跑测试（必须红）** → 改实现 → 绿

第五步是整条链路的关键：**如果它直接绿了，说明你的测试没有覆盖这条标准。**
跳过它，你永远不知道「改的测试」是不是真的在测这条标准。

---

## 模板里反复出现的三条原则

| 原则 | 在哪几个模板里 | 为什么 |
|------|--------------|--------|
| **每条都要能被判定为遵守/违反** | constitution / spec / plan / acceptance-record | 判定不了的条款会稀释其他条款的分量 |
| **必须写代价** | constitution / adr / plan | 没有代价的方案，通常意味着还没想清它的边界 |
| **必须写推翻条件** | adr / spec（被否决的方案）/ change-request | 把「否决」从永久封杀变成「当前条件下不选」，将来知道该看哪个信号 |

---

## 明确**不**提供的模板

| 没提供 | 为什么 |
|--------|--------|
| 代码风格模板 | 用 linter / formatter。写进文档没人读，写进宪法会稀释条款 |
| 排期 / 甘特图 | 项目管理系统的事，与 SDD 无关 |
| 测试代码模板 | 测试的形态取决于被测对象，给模板会引导写出「形式正确但断言很松」的测试 |
| 「高质量代码检查清单」 | 同上。清单会变成勾选仪式，而真正的质量问题在具体场景里 |

> 📌 **最后两条值得多想一会。** 模板的**最大风险不是不够全，而是让人以为勾完就完了**。
> 一个 30 项的检查清单，实际效果往往不如 3 个强制性的机械门禁。
