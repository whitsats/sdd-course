# rulesmith —— L10 `spec-as-source` 演示项目

> **本项目的唯一真相源是 `specs/001-rulesmith-dsl/spec.md`。**
>
> 人只改那一份文件，其余四份产物由生成器发射。**没有第二种改法。**

---

## 30 秒上手（零依赖，不需要 `npm install`）

环境要求：**Node ≥ 23**（用到原生 TypeScript 类型擦除，无构建步骤）。

```bash
cd examples/rulesmith

node tools/generator/index.ts          # 生成（等价于 pnpm generate）
node tools/generator/index.ts --check  # 只校验产物是否与规格一致（CI 快速路径）
node --test tests/*.spec.ts            # 跑全部测试（Node 内置测试运行器，零依赖）
```

预期输出（生成）：

```
规格: specs/001-rulesmith-dsl/spec.md
产生式: 11   词法 token 类型: 3   关键字: 10   符号: 14   错误码: 8
起始产生式: program

  · 未变  src/generated/lexer.ts  (144 行)
  · 未变  src/generated/parser.ts  (412 行)
  · 未变  src/generated/validator.ts  (74 行)
  · 未变  docs/rules-dsl.md  (99 行)

✅ 无变更（幂等）
```

预期输出（测试）：`pass 67  fail 0`

---

## 亲自验一下「这是真的生成器，不是手写成品」

**这是本节唯一必须动手的验证。** 只读代码判断不出来 ——
一份写得很漂亮的 `parser.ts` 可能是生成的，也可能是手写的。

```bash
# ① 先证明当前是干净的
node tools/generator/index.ts --check        # → ✅ 一致

# ② 手改一个生成产物（模拟「有人忍不住手改了」）
echo '// 手动加的' >> src/generated/lexer.ts

# ③ 校验应当立刻变红
node tools/generator/index.ts --check        # → ✗ 需重新生成，退出码 1

# ④ 恢复
node tools/generator/index.ts
```

第 ③ 步的完整输出：

```
  ✗ 需重新生成  src/generated/lexer.ts  (144 行)
  ...
生成产物与规格不一致（1 个文件）。
  两种情况：① 有人手改了生成物 ② 改了 spec 但忘了重新生成
  修复：运行 `pnpm generate` 并提交结果
```

**这一条红灯就是 spec-as-source 与「先写文档」的分界线。**
文档可以腐烂而无人报警；这里改了规格不改产物，CI 立刻拦住。

---

## 目录结构

```
rulesmith/
├── specs/001-rulesmith-dsl/
│   ├── spec.md               ← ⭐ 唯一真相源（含 EBNF 块、示例块、错误码表）
│   └── plan.md               ← 实现策略与决策记录（**规格里不写策略**）
├── tools/generator/          ← ⚠️ 手写代码：spec-as-source 的递归边界
│   ├── index.ts              CLI：读 spec → 发射 → 写盘 / --check
│   ├── ebnf.ts               EBNF 解析 + **分层与引用校验**
│   ├── spec-reader.ts        从 spec.md 提取 EBNF / 示例 / 错误码表 / 产物表
│   └── emit.ts               四类产物的发射器
├── src/generated/            ← ⛔ 禁止手改：产物
│   ├── lexer.ts              关键字表 + 符号表 + TOKEN_KINDS + 扫描器
│   ├── parser.ts             PRODUCTIONS 表 + 表驱动回溯解析器
│   └── validator.ts          错误码 / 运算符分类 + 校验骨架
├── docs/rules-dsl.md         ← ⛔ 禁止手改：面向业务方的文档
├── tests/
│   ├── generator.spec.ts     生成器自身的测试（幂等性 / 构建期校验 / 回归）
│   └── validator.spec.ts     产物行为测试 + 属性测试 + **规格示例自检**
└── notes/
    ├── L10-边界感.md          ← ⭐ 本节真正的考核产出
    └── L10-只改spec演示.md    ← 核心演示的真实输出记录
```

---

## 四条硬约束（`spec.md` §6）

1. `src/generated/*` 与 `docs/rules-dsl.md` 由 `pnpm generate` 产出，**任何人不得手工编辑**
2. 每个产物头部带 `DO NOT EDIT` 标记
3. CI 重新生成并校验 `git diff` 为空；非空即失败
4. 生成器**幂等**：同一份 spec 连续生成两次，输出字节级相同

**第 4 条为什么必须有：** 没有它，CI 的 `git diff` 校验会随机变红，
团队会开始无视红灯，最后把它注释掉 —— 见 `reference/anti-patterns.md` 的 AP-18。

---

## 本项目的边界（读这一段比读代码重要）

### 生成器是手写的，这是**必然**的

生成器不能被规格生成 —— 否则生成器的生成器又是谁写的？
**每一层 spec-as-source 都有一个手写基底。** 所以：

> spec-as-source 的实质**不是消灭手写代码**，
> 而是**把人的手写工作集中推到变更频率最低的那一层**。

| 层 | 谁写 | 变更频率 |
|----|------|---------|
| DSL 语法 / 校验器 / 文档 | **生成** | 高（每月数次） |
| `tools/generator/` | 手写 | 极低 |
| 运行期求值引擎 | 手写 | 低 |
| 测试（含属性测试） | 手写 | 中 |

### 已知缺口：语义检查尚未实现

`src/generated/validator.ts` 的 `validate()` 只做语法检查，
字段路径（`UNKNOWN_FIELD`）、类型（`TYPE_MISMATCH`）、重复规则名（`DUPLICATE_RULE`）、
冲突检测（`PRIORITY_CONFLICT`）都是 TODO。

**原因不是没时间，而是踩到了 spec-as-source 的真实边界：**
通用表驱动解析器能覆盖**语法**，但语义检查需要针对本语法的访问器
（要能问出「这个 AST 节点的字段路径是什么」）。

这个缺口被**显式记录**在两处，而不是藏在注释里：
- `tests/validator.spec.ts` 的 `describe('已知缺口（TODO —— 语义层尚未实现）')`
- `spec.md` §7 的「被否决的设计 ③」

> **让缺口在测试报告里可见**，是它不被悄悄遗忘的唯一办法。

### 什么时候该放弃 spec-as-source

完整分析见 `notes/L10-边界感.md`，摘要：

| 触发条件 | 改用什么 |
|---------|---------|
| 变更频率超过生成器维护能力 | 退回 spec-anchored |
| 产物形态开始分化（不同 DSL 要不同产物） | 模板 + 手写 |
| 语法复杂度超过 LL(1) | ANTLR 类工具 |
| 语义检查需要外部运行时信息 | 部分退回手写 |

---

## 用开源模板试一遍（可选）

本项目栈刻意与主课程一致。若想对比主流工具的做法：

```bash
# 在别的目录里，用同样的 spec.md 试一次 Spec Kit 的流水线
uvx --from git+https://github.com/github/spec-kit.git specify init rulesmith-alt
```

> ⚠️ 本机 `python3` 命中 Windows 应用商店存根会静默失败（退出码 49），
> Spec Kit 的 `--script py` 会因此失效。用 `--script ps` 或 `--script sh`。
> 详见 `lessons/00-setup.md` 的环境章节。

---

## 相关课程章节

| 章节 | 与本项目的关系 |
|------|--------------|
| L10 `spec-as-source` | 本节主课；`spec.md` / `plan.md` / 两个 notes 都是本节产出 |
| L05 实现 | 演示「亲手制造漂移」的地方；本项目里漂移的形态是**手改生成物** |
| L09 收敛与漂移 | 门禁设计（红灯必有意义）；本项目门禁是字节级的 |
| `reference/anti-patterns.md` | AP-18 误报门禁 / AP-19 生成物手改 / AP-28 技术规模冒充教学价值 |
