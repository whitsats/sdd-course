# taskflow —— 项目 B · spec-anchored

> **一个多租户任务协作 API 的最小版本。** 7 个端点、2 种角色（owner / member）、
> 6 个用户故事、游标分页、乐观并发、审计日志。
>
> 它的教学目标是**演示强制力**，不是建一个生产级平台。所以端点数被刻意砍过：
> **端点多不会让「漂移变红灯」这件事更清楚，只会加噪音。**

## 这个项目演示什么

**spec-anchored** —— 三级成熟度里的第二级，也是**绝大多数团队宣称做到、实际没做到的那一级**：

> 规格不是写给人看的文档，而是**能被脚本读取、能被 CI 强制**的输入。
> 代码偏离规格时，**流水线变红，无法合并**。

三级成熟度的差别不在规格的详细程度，而在**偏离时会不会有人报警**：

| 等级 | 偏离规格时 | 本仓库里的体现 |
|------|-----------|--------------|
| spec-first | 没人报警，靠人比对 | focuslog |
| **spec-anchored** | **CI 变红，阻断合并** | **taskflow（本项目）** |
| spec-as-source | 根本不可能偏离 —— 产物由规格生成 | rulesmith |

## 三种「牙齿」

这是本项目最核心的设计。**光有规格没有牙齿，等于没有规格** ——
而牙齿可以有三副，各自覆盖不同的失效模式：

| 牙齿 | 实现 | 拦住什么 |
|------|------|---------|
| **类型约束** | [src/domain/state-machine.ts](src/domain/state-machine.ts) · [permissions.ts](src/domain/permissions.ts) · [pagination.ts](src/domain/pagination.ts) | 非法状态流转、越权组合、分页参数越界 —— **编译期** |
| **契约测试** | [tests/contract/](tests/contract/) | 行为偏离规格 —— **测试期** |
| **CI 门禁** | [.github/workflows/sdd-gate.yml](.github/workflows/sdd-gate.yml) | 规格与映射表脱节、分层越界 —— **合并前** |

## 产物清单

| 阶段 | 产物 | 看什么 |
|------|------|--------|
| L03 | [specs/001-taskflow-mvp/spec.md](specs/001-taskflow-mvp/spec.md) | **40 条验收标准**（US1:6 / US2:9 / US3:9 / US4:6 / US5:5 / US6:5），六类歧义区全部显式定义 |
| L04 | [specs/001-taskflow-mvp/plan.md](specs/001-taskflow-mvp/plan.md) | **§3.2 是本仓库最值得逐行读的一节**：三处范围蔓延的对照案例 |
| L04 | [specs/002-task-tags/spec.md](specs/002-task-tags/spec.md) | 第二个 feature —— 它在 L06 里被明确列为**非目标**，示范「非目标不是永远不做」 |
| L06 | [docs/adr/ADR-002-并发冲突策略.md](docs/adr/ADR-002-并发冲突策略.md) | 为什么是乐观锁而不是悲观锁，以及**什么条件下该推翻它** |
| L07 | [docs/验收标准-测试映射.md](docs/验收标准-测试映射.md) | **40 / 40 对齐**：权限 7 · 边界 10 · 参数 6 · 契约 4 · 状态机 3 · 并发 2 · 幂等 1 · 行为 7 |
| L07 | [tests/contract/](tests/contract/) | 三份契约测试范式：14 格权限矩阵（表格驱动）· 状态机参数化 · 20 次并发写入 |
| L08 | [notes/L08-feature切换.md](notes/L08-feature切换.md) | 多 feature 切换的**真实操作记录**，含状态文件内容与一个防坑 shell 函数 |
| L09 | [notes/L09-不收敛分流.md](notes/L09-不收敛分流.md) | 循环报 gap 时怎么判断「是缺口还是工具盲区」—— **含两轮误判后找到根因的全过程** |
| L09 | [notes/L09-规格变更.md](notes/L09-规格变更.md) | 改**已上线**行为的六步链路，含「先让测试变红」的真实输出 |
| L09 | [notes/L09-成本账.md](notes/L09-成本账.md) | 投入产出表，以及「这 8.7 小时换回了什么」的回答 |

## 读 `plan.md` §3.2 的正确方式

那三处范围蔓延（Redis 缓存 / 事件总线 / Prometheus 导出）的价值不在于「它们被拒绝了」，
而在于**每一处都给出了「它服务哪条标准」的诊断，并且诊断结果是「没有」**：

> 蔓延不只是「多做了不必要的事」，而是**做了没有任何验收标准需要的事**。
> 一个人说「我觉得这样更好」时，问一句「它服务哪条标准」就够了。

第三处（Prometheus 导出）最隐蔽：它是**过度解读宪法**的结果 —— 宪法说「要有可观测性」，
于是有人把它读成「上指标系统」。**把原则读成具体技术选型**，是最难被察觉的一类蔓延。

## 两条必须说清的边界

**① 契约测试是范式，不是可执行套件。**
它们指向一个**尚未提交的 API 实现**，仓库里没有该项目的 `package.json`，
所以 `pnpm vitest run` 在这里跑不起来。它们示范的是「把验收标准写成契约测试」的
**形状与颗粒度**，不是一套能绿能红的套件。真正端到端可跑的是
[rulesmith](../rulesmith/README.md)。

**② 映射表引用了 9 个测试文件，仓库里只提交了 3 个。**

这不是疏忽，而是把门禁的边界摆在明面上：`scripts/check-spec-coverage.sh` 校验的是
**spec ↔ 映射表 的一致性**（条数与编号两两对应），**不校验测试文件是否真的存在**。

> 📌 **门禁的覆盖范围，就是它的盲区范围。**
> 一个全绿的门禁不等于「一切都对」，只等于「它检查的那些事是对的」。
> 这不是本门禁的缺陷 —— **任何门禁都有盲区**，缺陷是以为自己没有。

## 怎么验证

```bash
# 覆盖率：40 条标准 vs 40 行映射
bash scripts/check-spec-coverage.sh examples/taskflow

# 分层边界：domain 层不许 import fastify
bash scripts/check-layer-boundary.sh examples/taskflow ts
```

分层脚本值得单独试一次：往 `src/domain/state-machine.ts` 里加一行
`import fastify from "fastify"`，然后看它变红。**加在注释里不会变红** ——
这个区别是脚本被人改过两轮的产物，理由见 [scripts/index.md](../../scripts/index.md)。
