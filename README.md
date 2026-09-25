# SDD 实战精修课 —— 从 vibe coding 到规格驱动

> 一条主线：**GitHub Spec Kit**。五个案例：三个递进的严谨度等级，加上两根约束轴 —— **约束能放在多早**、**多晚**，
> 再加两节可选课 —— **把规格变成 agent 的考卷**、**让规格在生产里活着**。
> 目标不是学会打几个斜杠命令，而是**把「写清楚要什么」变成你最值钱的工程能力**。

---

## 1. 这门课要解决什么问题

2026 年，AI 写代码的速度已经不是瓶颈了。**歧义**才是。

你大概经历过这些场景：

- 提示词写了三百字，agent 交回来一个「能跑但不是我要的」系统，改起来比自己写还慢；
- 一个功能连着对了五轮，每次都「修好了 A、弄坏了 B」；
- 三个月后回来看自己的项目，没人知道当初为什么这么设计——包括你自己；
- 团队里每个人的 prompt 风格都不一样，产出质量像抽奖。

SDD（Spec-Driven Development，规范驱动开发）是对这套问题的系统性回答。它的核心主张只有一句：

> **把精确、可执行的规格当作唯一真相源，把代码当作由规格生成并被规格验证的产物。**

规格声明意图，代码实现意图。当 AI 承担了大部分敲代码的工作，**规格就成了人类最高杠杆的产物**——而写规格的能力，就是这门课要训练的能力。

---

## 2. 学完你会拿到什么

| # | 能力 | 可验证的证据 |
|---|------|------------|
| 1 | 能写出机器不会误解的规格 | 你的 `spec.md` 经 `/speckit-clarify` 后无需返工 |
| 2 | 能区分「规格问题」和「实现问题」 | 遇到 bug 时先判断该改 spec 还是改 code |
| 3 | 能运营 spec-anchored 流程 | 项目 B 的 CI 会在规格漂移时红灯 |
| 4 | 能看懂并评估各家 SDD 工具 | 能说清 Kiro / OpenSpec / BMAD / Tessl 的取舍 |
| 5 | 能推动团队落地 | 一份可执行的团队落地检查清单 |
| 6 | 能做「规格即源」实验 | 项目 C 中你只改 spec，代码全量再生 |
| 7 | 能把规格变成评测集 | 项目 A 的 23 条标准生成 23 张判定卡，逐条可重放 |
| 8 | 能判断哪些规格值得上生产探针 | 一份按三条判据筛选的探针清单，每条都回答「半夜响了谁起床」 |

**不承诺**：让 AI 完全自动写完后端。SDD 不消除工程判断，它把判断从「写代码」前移到「定意图」。

---

## 3. 学习地图

八个阶段、17 节课（含四节可选进阶），每节 **1–2 小时**，每节都有可提交的产出物。

> ⏱️ **时间预算分两层，别用错**：跟着教程走一遍约 **31 小时**；
> 五个项目都能端到端演示约 **62 小时**——差出来的 31 小时全在写代码、跑测试、跟 CI 打架上，**而那才是真正的价值所在**。
> 时间不够时的减法优先级见 [PLAN.md 附录](./PLAN.md)。

> 🔍 **计划经过四轮审阅修订（v2 修四个结构性缺陷、v3 加 L13/L14 两根约束轴、v4 补 L15 评测集、v5 补 L16 运行期与治理台账）**。
> 修订记录见 [PLAN.md 末尾](./PLAN.md)。
> 这件事本身也是课程的一部分：**规划也需要被审阅，不只是代码。**

```
阶段一 · 认知与地基（3 节）
  L00 环境准备 ──► L01 为什么是 SDD ──► L02 Constitution 项目宪法
                                              │
阶段二 · 走通最短闭环（3 节）                  │  项目 A：focuslog（Python CLI）
  L03 Specify ──► L04 Plan & Tasks ──► L05 Implement & 手工验收
                                              │
阶段三 · 生产级规格锚定（4 节）                │  项目 B：taskflow（TS API）
  L06 Clarify & Checklist ──► L07 架构与契约规格
        │
        └──► L08 Analyze & 分批 Implement ──► L09 Converge & 漂移治理 ⭐**达标节点**
                                              │
阶段四 · 进阶与自主化（3 节 + 可选 1）        │  项目 C：rulesmith（规格即源）
  L10 规格即源 ──► L11 存量改造与工具对标 ──► L12 团队化落地
                                              │
阶段五 · 可选进阶（1 节）                      │  项目 D：billflow（Java · 约束前移）
  L13 把约束前移到构建期 ⭐**可选**
                                              │
阶段六 · 可选进阶（1 节）                      │  项目 E：stockflow（SQLite · 约束下沉）
  L14 把约束下沉到数据层 ⭐**可选**
                                              │
阶段七 · 可选进阶（1 节）                      │  复用项目 A focuslog 的规格
  L15 把验收标准变成评测集 ⭐**可选**
                                              │
阶段八 · 可选进阶（1 节）                      │  复用项目 E 巡检 + 项目 B 错误码投影
  L16 让规格在生产里活着 ⭐**可选**
```

⭐ **L09 是本课程的价值拐点**。走到那里，你就真正拥有了 spec-anchored 闭环——绝大多数团队宣称在做 SDD，实际停在 L05 的水平。

详细课时表见 **[PLAN.md](./PLAN.md)**，含每节的前置条件、交付物、验收标准和踩坑预警。

---

## 4. 五个案例项目（三等级 + 两根约束轴）

不搞玩具 demo。前三个项目是**同一件事的三个严谨度等级**，你会亲手体验「多花的那点规格成本」换来了什么。
后两个换轴：D 问「**同一个约束，能放在多早执行**」，E 问「**能放在多晚**」。

| 项目 | 一句话 | 技术栈 | 规格严谨度 | 在哪几节课 |
|------|--------|--------|-----------|-----------|
| **A. focuslog** | 开发者专注日志 CLI | Python 3.10+ · Typer · pytest · uv | **Spec-First** | L03–L05 |
| **B. taskflow** | 团队任务协作 API + 看板 | TypeScript · Fastify · zod · vitest | **Spec-Anchored** ⭐ | L06–L09 |
| | *范围已收紧：7 端点 / 2 角色* | | | |
| **C. rulesmith** | 报表规则引擎（规格即源） | TypeScript · Node · 代码生成器 | **Spec-as-Source** | L10 |
| **D. billflow** | 订阅计费引擎（约束前移到构建期） | Java 17 · Maven · JUnit 5 · ArchUnit | **Spec-Anchored · 构建期强化** | L13（可选） |
| **E. stockflow** | 库存预占引擎（约束下沉到 schema） | SQLite · Node（**零第三方依赖**） | **Spec-Anchored · 数据层强化** | L14（可选） |

> D 与 E 是**同一条轴的两端**，值得对照读：
>
> | | D · 构建期 | E · 数据层 |
> |---|---|---|
> | 拦住谁 | 写错代码的人 | **任何**写入者（含不经过应用的迁移脚本、DBA、另一个服务） |
> | 兑现动作 | 注解处理器被加载 | `PRAGMA foreign_keys` 被每一条连接启用 |
> | 没兑现时 | 构建绿、规格校验为零 | 测试绿、幽灵行入库 |
> | 检查它是否兑现 | `check-java-build.sh` 断言标记行 | `assertForeignKeys()` 读回断言 |

外加两个非项目练习：**L11 存量代码逆向补规格**（brownfield，最贴近你真实工作）与 **L12 团队流程设计**；
另有两节可选课：**L15 评测课**（复用项目 A 的规格）与 **L16 运行期课**（复用项目 E 的巡检与项目 B 的错误码投影），不新建项目。

选型理由与功能边界见 **[projects/README.md](./projects/README.md)**。

---

## 5. 目录结构

```
.
├── README.md              ← 你在这里（课程主页）
├── PLAN.md                ← 详细学习计划：17 节全展开
├── lessons/               ← 教程正文，17 节全部就绪（17 个文件 / 6800+ 行）
│   ├── 00-setup.md        环境准备与首次 specify init
│   ├── 01-why-sdd.md      SDD 心智模型、三级成熟度、流水线全景
│   ├── 02-constitution.md 项目宪法怎么写
│   ├── 03-specify.md      Specify：用 EARS 把意图写成规格（focuslog）
│   ├── 04-plan-tasks.md   Plan & Tasks：可追溯性检查与人工重排
│   ├── 05-implement.md    Implement：验收纪律 + 漂移演练
│   ├── 06-clarify-checklist.md  Clarify：六类歧义区（taskflow）
│   ├── 07-architecture-contracts.md  三种牙齿 + 映射表 ⭐
│   ├── 08-analyze-implement.md  Analyze + 多 feature 工作流
│   ├── 09-converge-drift.md  Converge：CI 门禁与红蓝对抗 ⭐
│   ├── 10-spec-as-source.md  Spec-as-Source：生成器与边界感
│   ├── 11-brownfield.md   存量改造：逆向规格化与偏差归类
│   ├── 12-team-rollout.md 团队化落地、选型与退出策略
│   ├── 13-java-build-time.md ⭐ 可选：把约束前移到构建期
│   ├── 14-data-layer-constraints.md ⭐ 可选：把约束下沉到数据层
│   ├── 15-spec-evals.md   ⭐ 可选：把验收标准变成评测集
│   └── 16-runtime-spec.md ⭐ 可选：让规格在生产里活着
├── reference/             ← 随时查阅的速查手册
│   ├── ears.md            EARS 需求句式（写验收标准的语法）
│   ├── glossary.md        中英术语对照
│   ├── anti-patterns.md   SDD 反模式清单（29 条）
│   └── agnes-api.md       ⭐ LLM API 速查（含一个「地址陷阱」的完整暴露）
├── examples/              ← ⭐ 完整真实产物，不是片段
│   ├── focuslog/          项目 A 全套：constitution / spec / plan / tasks
│   │                       / ADR-001 / 映射表（23 条）/ 验收记录
│   │                       / notes：LLM 审阅记录（挖出 3 条真缺口）
│   ├── taskflow/          项目 B 全套：constitution 级 spec（40 条标准）
│   │                        / plan（含 3 处范围蔓延对照）/ ADR-002
│   │                        / 领域层 TS 源码 / 可执行契约测试（49 个，零依赖）/ CI 门禁
│   │                        / L08 与 L09 的四个 notes / 第二个 feature
│   ├── rulesmith/         项目 C 全套：spec-as-source
│   │                        / 生成器（手写层）/ 4 份产物 / 10 条映射
│   │                        / 67 个测试 / 两个 notes（边界感 + 演示记录）
│   ├── billflow/          项目 D 全套：Java 构建期强制（含 751 个测试的可构建工程）
│   │                        / 注解处理器 spec-guard / ArchUnit 架构测试
│   │                        / 21 条映射 / 六条元验证（含「校验零执行」）
│   └── stockflow/         项目 E 全套：约束下沉到 schema（零依赖，44 个测试）
│                            / migrations/001_init.sql（5 表 · 8 触发器 · 2 视图）
│                            / tests/schema.spec.mjs（16 个测试**不碰应用代码**）
│                            / 4 份 ADR / 26 条映射（含「保证者」列）/ 五条元验证
├── templates/             ← 14 份可直接拷用的模板
│   ├── constitution / spec / plan / tasks / adr / clarify-log
│   ├── acceptance-record / change-request / notes
│   ├── PR-template.md     SDD 版 PR 模板（含 spec 同步检查项）
│   ├── tool-selection / team-rollout-checklist / spec-governance  L12 的选型、落地与台账模板
│   └── agent-prompt-snippets.md  ⭐ 对 agent 说话的可用句式 + 反模式
├── scripts/               ← 可直接运行的脚本（均已实测）
│   ├── run-all-gates.sh         ⭐ 一键跑完全部门禁（课程总验收）
│   ├── check-spec-coverage.sh   覆盖率门禁 ⭐ spec-anchored 的分界线
│   ├── check-layer-boundary.sh  把宪法架构边界变成 CI 检查
│   ├── find-change-hotspots.sh  存量改造：决定给哪些模块补规格
│   ├── verify-generated.sh      spec-as-source 的可复现性守卫
│   ├── check-rendering.sh       折叠块真的被解析（构建绿但页面坏）
│   ├── check-java-build.sh      构建绿 ≠ 规格校验执行过（项目 D）
│   ├── check-sql-enforcement.sh 约束是否真的生效（项目 E）
│   ├── agnes-review.py          用 LLM 对规格做对抗式审阅
│   ├── generate-evals.py        把验收标准变成评测卡（L15）
│   └── check-error-codes.py     错误码投影：自造码即红（L07 / L16）
└── projects/
    └── README.md          五个案例项目的设计说明
```

> 💡 **`examples/` 与 `scripts/` 是这份教程里最不「笼统」的部分**：
> 它们是完整、可运行、并且**实际跑过**的产物。
>
> **一条命令验完全部**：
>
> ```bash
> bash scripts/run-all-gates.sh
> # ① 门禁脚本自身可执行      ✔ ×8          语法检查每一个脚本
> # ② 验收标准覆盖率          ✔ ×5          focuslog 23 / taskflow 40 / rulesmith 10 / billflow 21 / stockflow 26
> # ③ 分层与投影              ✔ ×2  ○ ×1    taskflow 分层 + 错误码投影；focuslog 分层跳过（无实现）
> # ④ 生成物可复现性          ✔ rulesmith
> # ⑤ 测试套件                ✔ ×4          rulesmith 67 / taskflow 49 / billflow 751 / stockflow 44
> # ⑥ 密钥泄漏自查            ✔
> # ⑦ 渲染完整性              ✔ 折叠块写法
> # ⑧ 文档内部链接            ✔
> # 总结  通过 24   失败 0   跳过 1
> # 跳过项：分层：focuslog (py)（examples/focuslog 下没有 src/ 目录（该项目目前只有规格，尚未实现））
> # ✅ 已跑的门禁全部通过（有 1 项跳过 —— 每一项的原因见上）
> ```
>
> **跳过永远不会混进「通过」里**：缺 JDK/Maven/Node 的门禁计入**跳过**（单独一行列出）；
> focuslog 的分层检查因为「项目只有规格、还没有实现」也计入跳过 —— 「没跑」与「跑过了」
> 在输出上必须能区分开（`check-layer-boundary.sh` 用退出码 3 声明跳过）。
>
> 也可以单独跑某一个：
>
> ```bash
> bash scripts/check-spec-coverage.sh examples/taskflow
> # ── 001-taskflow-mvp ──
> # 标准条数: 40   映射行数: 40
> # ✅ 覆盖完整
> ```

教材正文里的 `projects/` 是你自己动手建的项目目录；`examples/` 是给你的对照答案。

---

## 6. 怎么跟着学（重要）

这不是一份读完就能会的文档。**跟学协议**如下，照着走效率最高：

**每节课的循环**

1. 我给出本节目标 + 前置检查，你确认环境 OK；
2. 你**先自己按教程做**，不要跳过动手步骤；
3. 卡住了，把**原始报错**或**agent 的输出**贴给我，我带你定位；
4. 做完跑一遍本节的**验收清单**；
5. 我把产出物 review 一遍，指出「这里是规格问题还是实现问题」；
6. 更新下方进度表，进入下一节。

**几条纪律**（这些是 SDD 的精髓，不是流程形式主义）

- ⛔ **永远不要从 spec 直接跳到 code。** 计划必须过目，任务必须过目。
- ⛔ **Specify 阶段不许出现技术栈。** 一写「用 Postgres」就污染了 what/why 层面的思考。
- ✅ **每次让 agent 产出，都问一句「这条要求可验收吗？」** 不可验收的要求等于没写。
- ✅ **报错先分类**：规格不清 → 改 spec；规划有误 → 改 plan；实现跑偏 → 改 code。三类修复路径完全不同。

**进度追踪表**（做完一节自己打勾）

| 节 | 主题 | 产出物 | 完成 |
|----|------|--------|------|
| L00 | 环境准备 | `specify` 可用 + hello-sdd 跑通 | ☐ |
| L01 | 为什么是 SDD | 一页心智模型笔记 | ☐ |
| L02 | Constitution | `constitution.md` | ☐ |
| L03 | Specify | `spec.md`（focuslog） | ☐ |
| L04 | Plan & Tasks | `plan.md` + `tasks.md` | ☐ |
| L05 | Implement | 可运行的 `focuslog` | ☐ |
| L06 | Clarify & Checklist | 澄清后的 spec + `checklist.md` | ☐ |
| L07 | 架构与契约 | ADR + 契约测试骨架 | ☐ |
| L08 | Analyze & 分批实现 | 无冲突报告 + 分阶段 PR | ☐ |
| L09 | Converge & 漂移治理 | CI 红灯演示 + 达标报告 | ☐ |
| L10 | 规格即源 | `rulesmith` 全量再生成 | ☐ |
| L11 | 存量改造 | 存量仓库偏差清单（每处已归类） | ☐ |
| L12 | 团队化落地 + 选型 | 工具选型表 + 落地检查清单 | ☐ |
| **L13**（可选） | 约束前移到构建期 | 注入未知编号 → **编译失败** | ☐ |
| **L14**（可选） | 约束下沉到数据层 | 命令行直写脏数据 → **被引擎拒绝** | ☐ |
| **L15**（可选） | 规格变评测集 | 23 张判定卡 + 一轮翻转记录 | ☐ |
| **L16**（可选） | 上线之后的规格 | 探针清单 + flag 对账 | ☐ |

---

## 7. 环境前置（本机实测）

你的实际环境（已核实）：

```
Windows (Git Bash / MINGW64)
Node v24.12.0     npm 11.6.2     pnpm 10.33.2
Python 3.10.6     uv 0.11.7      git 2.54.0
specify: 尚未安装  ← L00 会装
```

整体是齐全的，但**有一处已确认的本地坑**：PATH 里的 `python3` 优先命中 Windows 应用商店的转发存根，会**静默失败**（无输出、退出码 49）。真正可用的是 `python` / `py` / `uv run python`。

因此 Spec Kit 的脚本变体请用 `--script ps`（或 `sh`），**避开 `--script py`**。

完整排查与修复步骤见 **[lessons/00-setup.md](./lessons/00-setup.md)** 的「Windows 特有的两个坑」。

---

## 8. 参考来源

- GitHub Spec Kit 官方文档：<https://github.github.com/spec-kit/>（2026-09 更新，SDD 核心流程为 `Specify → Plan → Tasks → Implement → Converge`）
- Spec Kit 快速上手（Taskify 官方示例）：<https://github.github.com/spec-kit/quickstart.html>
- Piskala, *Spec-Driven Development: From Code to Contract in the Age of AI Coding Assistants*, arXiv 2602.00180 (2026-01) —— 三级严谨度框架的学术出处
- 2026 年 SDD 生态综述与工具横评（Spec Kit / Kiro / cc-sdd / OpenSpec / BMAD / Tessl）

> 注：SDD 生态迭代很快，命令名与配置路径以你本地 `specify --help` 的输出为准。教程中如与该输出冲突，**以本地输出为准**，并告诉我，我会同步修正教程。
