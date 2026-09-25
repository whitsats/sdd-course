# 术语表 · 中英对照

按主题分组。**「出现在」列指向首次正式讲解的课时。**

---

## 一、方法论核心

| 中文 | English | 含义 | 出现在 |
|------|---------|------|--------|
| 规范驱动开发 | Spec-Driven Development (SDD) | 把可执行的规格当作唯一真相源、代码当作被规格验证的产物 | L01 |
| 氛围编程 | vibe coding | 松散提示 AI、拿到什么用什么；原型可用，维护灾难 | L01 |
| 规格优先 | Spec-First | 规格只做初始种子，之后允许代码漂移。成本低、无长期保证 | L01 |
| 规格锚定 | Spec-Anchored | 🎯 规格与代码共同演化，测试强制对齐。生产系统的甜点区 | L01 |
| 规格即源 | Spec-as-Source | 人只改规格，代码 100% 生成、永不手改 | L01 |
| 漂移 | drift | 实现与规格/意图逐渐背离且无人察觉。SDD 要解决的头号问题 | L01 |
| 可追溯性 | traceability | 每条技术决策、每个任务都能回溯到某条规格要求 | L04 |
| 收敛 | convergence | 代码与 spec/plan/tasks 达到一致的状态 | L09 |
| 绿野项目 | greenfield | 从零开始的新项目 | L03 |
| 存量项目 | brownfield | 已有代码、需要接入 SDD 的项目 | L11 |

---

## 二、Spec Kit 流程阶段

| 中文 | 命令 / English | 含义 | 出现在 |
|------|---------------|------|--------|
| 项目宪法 | `/speckit-constitution` / constitution | 跨 feature 的长期约束；agent 的常驻判据 | L02 |
| 规格化 | `/speckit-specify` / specify | 从自然语言描述生成 feature 规格（是什么、为什么） | L03 |
| 澄清 | `/speckit-clarify` / clarify | 让 agent 追问歧义点并回写规格 | L06 |
| 规划 | `/speckit-plan` / plan | 从规格生成设计产物；技术决策的唯一合法位置 | L04 |
| 清单 | `/speckit-checklist` / checklist | 需求质量评审清单——「要求的单元测试」 | L06 |
| 任务拆解 | `/speckit-tasks` / tasks | 生成可执行、有依赖顺序的任务列表 | L04 |
| 一致性分析 | `/speckit-analyze` / analyze | 只读检查 spec ↔ plan ↔ tasks 的矛盾、缺口、歧义 | L08 |
| 实现 | `/speckit-implement` / implement | 按依赖顺序执行任务；会读取 checklist 状态作为门禁 | L05 |
| 收敛验证 | `/speckit-converge` / converge | 比对代码与三份文档；有缺口则向 tasks.md 回填新任务 | L09 |

---

## 三、工件与产物

| 中文 | English | 含义 | 出现在 |
|------|---------|------|--------|
| 用户故事 | user story | 「作为某角色，我想要某能力，以便某价值」 | L03 |
| 验收标准 | acceptance criteria | 判定一条需求是否满足的判据。**必须能被测试** | L03 |
| 需求句式 | EARS | Easy Approach to Requirements Syntax；六种句式（见 [ears.md](./ears.md)） | L03 |
| 范围外声明 | out of scope | 显式写明本次不做什么，防范围蔓延 | L03 |
| 架构决策记录 | ADR (Architecture Decision Record) | 记录「选了什么、为什么、代价是什么」 | L07 |
| 契约测试 | contract test | 把接口/状态机的规格变成自动化断言 | L07 |
| 非功能需求 | non-functional requirement | 性能、安全、可观测性等带数字的约束 | L07 |
| 生成的产物 | generated artifact | 由生成器产出、禁止手改的文件 | L10 |

---

## 四、工具与生态

| 中文 | English | 含义 | 出现在 |
|------|---------|------|--------|
| 集成 | integration | 把某个 coding agent 接入 Spec Kit 的适配层 | L00 |
| 技能 | skill | agent 聊天里可调用的流程步骤（斜杠命令） | L00 |
| 预设 | preset | 调整核心流程的配置包 | L12 |
| 扩展 | extension | 给流程增加能力的插件（如 CI Guard、Architecture Guard） | L12 |
| 工作流 | workflow | 把多个步骤编排起来 | L12 |
| 捆绑包 | bundle | 打包分享的一整套配置 | L12 |
| 特性目录 | `.specify/feature.json` | 记录当前活跃 feature 的状态文件；命令靠它解析上下文，不依赖 git 分支 | L00 |

---

## 五、生态里的其他工具（L11 详解）

| 名称 | 定位 |
|------|------|
| **GitHub Spec Kit** | 开源、模型无关的参考实现。本课程主线 |
| **AWS Kiro** | Agentic IDE，带 hooks 自动护栏，AWS/Serverless 亲和 |
| **Claude Code (cc-sdd)** | 终端优先，`/sdd:*` 命令族 |
| **Cursor Plan Mode** | IDE 优先，内联 diff 审阅 |
| **OpenSpec** | 轻量，Markdown + YAML，框架无关 |
| **BMAD-METHOD** | 社区方法论，宪法 + 多角色扮演 |
| **Tessl** | 合规导向，审计轨迹，面向受监管行业 |
| **Google Antigravity** | 规格约束下的 agent 自主性探索 |

---

## 六、质量与度量

| 中文 | English | 含义 | 出现在 |
|------|---------|------|--------|
| 质量门禁 | quality gate | 进入下一阶段前必须通过的检查 | L01 |
| 护栏 | guardrail | 限制 agent 行为边界的约束 | L02 |
| 可判定性 | decidability | 一条原则能否被机械判断「违反了没有」；宪法质量的唯一标准 | L02 |
| 人类检查点 | human checkpoint | 阶段边界上人类强制review的节点 | L08 |
| 规格覆盖率 | spec coverage | 有多少实现行为被规格显式描述 | L12 |
| 漂移率 | drift rate | 单位时间内规格与实现背离的次数 | L12 |
| 返工率 | rework rate | 每 10 个任务里有几个因「理解错了」而重做；成本量化最实用的指标 | L09 |
| 规格变更 | spec change / delta spec | 功能上线后修正验收标准的完整流程：先改规格，再让测试变红，最后改实现 | L09 |
| 变更热点 | change hotspot | 被频繁修改的模块；存量改造时**只给这些模块补规格** | L11 |
| 上下文切换 | feature context switching | 靠 `.specify/feature.json` 在多个 feature 间切换；与 git 分支无关 | L08 |
| 幂等再生 | idempotent regeneration | 同一规格重复生成得到相同产物 | L10 |
| 逆向规格化 | reverse specification | 从存量代码反推规格 | L11 |
| 规格漂移审计 | spec drift audit | 系统排查「代码有规格没写」与「规格有代码没做」两类偏差 | L11 |
| 规格台账 | spec register | 记录每份规格的 owner、状态、消费者与复审周期的资产清单；owner 是人名不是团队名 | L12 |
| 评测集 | eval set | 每条验收标准一张判定卡的集合；测试断言代码，评测对照标准原文 | L15 |
| 判定卡 | verifier card | 标准原文 + 待判定行为 + 判定要求；判定者可以是模型，也可以是人 | L15 |
| 评审模型 | judge | 执行判定卡结论的模型；判定有方差，所以**永远不进门禁** | L15 |
| 翻转 | flip | 同一张卡两次判定（或两轮版本间）结论不同；翻转是标准的信号，不是失败 | L15 |
| 生产探针 | probe | 把验收标准翻译成对生产遥测的查询；违反后静默、高频、可用现有遥测表达的标准才值得上 | L16 |
| 消费方驱动契约 | consumer-driven contract | 由消费方写下最小断言集并交叉验证；多份实现对同一份规格的理解分歧靠它暴露 | L16 |
| 特性开关 | feature flag | 规格的运行期开关；flag 后面的行为必须指回一条标准或一行非目标 | L16 |
| 呼叫预算 | on-call budget | 告警噪声的计量；每条探针都要回答「半夜响了谁起床、起床干什么」 | L16 |

---

## 易混淆对照

**spec vs plan vs tasks**

| | 回答 | 禁止出现 |
|---|---|---|
| spec | 是什么、为什么 | ❌ 技术栈、框架名 |
| plan | 怎么做 | ❌ 规格里没有的需求（范围蔓延） |
| tasks | 按什么顺序做 | ❌ 无法独立验证的巨型任务 |

**clarify vs checklist**

| | 做什么 |
|---|---|
| clarify | 消灭 spec 里的**歧义**（追问 → 用户回答 → 回写） |
| checklist | 评审 spec 里的**质量**（打勾 = 我认为这条写清楚了） |

**spec-first vs spec-anchored 的唯一区别**

前者**没有强制力**，后者有（测试 + CI）。就这一点，价值天差地别。
