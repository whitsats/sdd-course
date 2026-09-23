# L00 · 环境准备与首次空跑

> **时长** 60 min ｜ **前置** 无 ｜ **产出** 可用的 `specify` + 跑通的 `hello-sdd`

这一节我们**不写任何业务代码**。目的很反直觉：先让你对「产物流」(artifact flow) 建立肌肉记忆，再谈实现。

如果你跳过这节直接看 L03，你会把 Spec Kit 当成「生成代码的另一个按钮」——那是最大的误解。

---

## 0. 开始前：检查你的环境

打开终端（Windows 上推荐 **Git Bash** 或 PowerShell 均可；本教程的命令两种都能跑）。

```bash
node -v             # 需要 >= 18，推荐 20+
python --version    # 需要 3.9+（spec-kit 的辅助脚本用）
uv --version        # 需要它来安装 specify-cli
git --version
```

> ⚠️ **注意是 `python` 而不是 `python3`。** 见下面第 2 条的 Windows 坑。

你的机器上实测结果是：

```
Windows (MINGW64 / Git Bash)
Node v24.12.0 ✔
Python 3.10.6 ✔  （用 `python`，不是 `python3`）
uv 0.11.7     ✔
git 2.54.0    ✔
```

### ⚠️ Windows 特有的两个坑（你的机器上已经确认踩到）

**坑 1：`python3` 命令是个坏掉的存根。**

在你的 PATH 里，`python3` **优先命中 Windows 应用商店的转发存根**：

```
/c/Users/<你>/AppData/Local/Microsoft/WindowsApps/python3   ← 假货，静默失败
/d/SoftWares/Python310/python                                ← 真货
```

这个存根的行为很阴险：`python3 --version` 之类的命令会**静默失败**（退出码非零、无输出），而如果你写成 `python3 --version 2>/dev/null || python --version`，输出看起来完全正常——**因为结果其实来自后面的回退分支**，你会误以为 `python3` 是好的。

但它一旦执行脚本就会坏：

```bash
python3 -c "print('hi')"   # 退出码 49，什么都不打印
python  -c "print('hi')"   # hi   ← 用这个
```

**后果**：这会直接坑到 Spec Kit 的 `--script py` 变体（它调用的解释器可能解析到那个存根）。

**坑 2：所以脚本风格优先选 `ps`。**

三种脚本变体的可靠性在本机是：

| 变体 | 本机可用性 | 说明 |
|------|-----------|------|
| `--script ps` | ✅ **推荐** | PowerShell 原生，不受 Python/PATH 问题影响 |
| `--script sh` | ✅ 可用 | Git Bash；你日常就在用 bash，也顺手 |
| `--script py` | ⚠️ **风险** | 可能命中坏掉的 `python3` 存根；除非你先修好 PATH |

如果你确实想用 `py` 变体，先修 PATH 优先级，或者确认 `uv run python` 能正常执行（这条在你的机器上是通的）。

**修复 `python3` 的两种做法**（可选，不做也不影响课程）：

1. **设置 → 应用 → 高级应用设置 → 应用执行别名**，关掉 `python3.exe` 和 `python.exe` 两个别名；
2. 或者把真实 Python 目录在 PATH 中排到 `WindowsApps` 之前。

如果某台机器上 `uv` 缺失，先装 uv（Windows）：

```bash
# PowerShell
powershell -c "irm https://astral.sh/uv/install.ps1 | iex"
```

```bash
# 或者用 pip（注意是 python，不是 python3——原因见上面坑 1）
python -m pip install --user uv
```

装完**重开终端**让 PATH 生效，再 `uv --version` 确认。

---

## 1. 安装 specify CLI

```bash
uv tool install specify-cli
```

`uv tool install` 会把 CLI 装到独立环境里，不污染任何项目的依赖——这点很重要，因为你会把它当成一个**全局命令**用。

验证：

```bash
specify --version
specify --help
```

**先看 `--help` 的输出，把它当成权威。** SDD 生态迭代很快，命令参数可能和我写教程时不同。以你本地的输出为准；若发现冲突，告诉我，我会同步修正教程。

---

## 2. 选择你的 coding agent integration

Spec Kit 是**模型无关**的——它把工作流描述成一组 **agent skills**（斜杠命令），由你用的 coding agent 来执行。

当前支持 38 种集成。初始化时要么交互式选，要么显式指定：

```bash
specify init hello-sdd --integration copilot
```

常见的取值：`copilot`、`claude`、`cursor`、`codex`、`gemini`、`kiro` 等。**如果你的 agent 不在列表里，用通用的兜底集成。**

> 🔑 **关键认知**：集成之后，`/speckit-*` 这些**不是终端命令**，而是你在 **agent 聊天框里**输入的命令。终端只负责两件事：安装 CLI、初始化项目。

### Windows 上的脚本风格

Spec Kit 会生成一套自动化脚本，有 Bash (`.sh`)、PowerShell (`.ps1`)、Python (`.py`) 三个变体：

- 交互式 init 会问你选哪个；
- 在无 TTY 的环境（CI、或某些 agent harness）里，它默认按系统选，**可能卡在箭头选择器上**。

所以推荐显式指定：

```bash
specify init hello-sdd --integration copilot --script ps
```

- 你主要在 **PowerShell** 里工作 → `ps` ✅ **本机推荐**
- 你主要在 **Git Bash** 里工作 → `sh` ✅ 也可用（你日常就在 bash 里）
- 想要跨平台一致 → `py` ⚠️ **本机有风险**：它可能解析到坏掉的 `python3` 存根（见上节坑 1），除非你先修好 PATH

选 `ps` 或 `sh` 都可以，**避开 `py`** 就对了。

如果是脚本化场景，再加 `--non-interactive`，让未指定的选项走文档化默认值，而不是挂在选择器上。

**看看当前有哪些集成可用：**

```bash
specify --help
```

（子命令的准确名字随版本变化，以 `--help` 为准。）

---

## 3. 初始化并观察目录结构

```bash
specify init hello-sdd --integration copilot --script ps
cd hello-sdd
ls -a
```

你会看到类似这样的东西：

```
.specify/          ← Spec Kit 的工作区（流程状态 + 模板）
  feature.json     ← 记录「当前活跃的是哪个 feature」
  templates/       ← 各级产物的模板（constitution/spec/plan/tasks...）
memory/            ← 项目级长期记忆（宪法通常落在这里）
<agent 专属目录>    ← 例如 .github/ 下的 prompt/skill 文件，由 integration 决定
```

几个要点：

1. **`.specify/feature.json` 是流程状态的锚点。** 所有命令都靠它解析「当前在做哪个 feature」，**不依赖 git 分支**。你也可以用环境变量 `SPECIFY_FEATURE_DIRECTORY` 覆盖它。
2. 如果你想让每个 feature 有独立的编号分支（`001-feature-name` 这种），可以启用可选的 **git 扩展**——但注意：即使切了 git 分支，**活跃 feature 仍由 `feature.json` 决定**。
3. `templates/` 里的模板是**可读可改的**。这是 Spec Kit 不是黑盒的证据——流程本身就是这些 Markdown 文件。

**动手检查一下：**

```bash
cat .specify/feature.json
ls .specify/templates/
```

---

## 4. 空跑一次流水线（本节的核心）

现在启动你的 coding agent，**在项目目录里**打开它的聊天。依次调用下面的 skill，**一次一个，每次都要先看产出再往下走**：

```
1. /speckit-constitution
2. /speckit-specify
3. /speckit-plan
4. /speckit-tasks
```

**先不要调用 `/speckit-implement`。** 本节故意停在「任务清单已经生成、一行代码还没写」的位置——请你亲自体会这个状态。

### 每一小步该给什么输入

**① constitution** —— 传入你的原则。hello-sdd 这种练习项目用一句话就够：

```
/speckit-constitution hello-sdd 是一个纯本地实验项目。不引入任何持久化存储，不依赖网络，
所有产物必须可以直接删除重建。
```

**② specify** —— 描述 what 和 why，**不要提技术栈**：

```
/speckit-specify 构建一个 hello-sdd 工具：用户在终端输入姓名，程序输出一条带时间戳的
问候语，并把这次问候记在当天的历史里，用户可以查看今天问候过的所有姓名。
```

**③ plan** —— 技术细节属于这里：

```
/speckit-plan 使用 Python 3.10 + 标准库实现，不要第三方依赖。单个 CLI 入口文件。
当天历史保存在用户家目录下的一个 JSON 文件里。
```

**④ tasks** —— 不带参数，让它从设计产物拆解：

```
/speckit-tasks
```

### 观察这三件事

1. **spec.md 里搜不到任何技术词**。搜一下，确认没有 "Python"、"JSON"、"CLI"。
2. **plan.md 里的每个技术决策，都能追溯到 spec 里的某条要求**。追不上的，就是凭空出现的依赖。
3. **tasks.md 的每个任务，都能映射回一条验收标准**。映射不上的任务，就是范围蔓延。

这三条检查，会贯穿你后面全部的 SDD 工作。

---

## 5. 交付物与验收

### 交付物

```
hello-sdd/
├── .specify/            流程状态与模板
├── memory/              宪法等长期约束
└── specs/001-.../       spec.md / plan.md / tasks.md
```

### 验收清单

- [ ] `specify --version` 有输出
- [ ] `hello-sdd/` 初始化成功，`.specify/feature.json` 存在且内容你读过
- [ ] 你知道**下一阶段要实现的哪个任务**在哪个文件里
- [ ] 你能不看文档画出工作流：`Specify → Plan → Tasks → Implement → Converge`
- [ ] 你能解释 `.specify/feature.json` 的作用（提示：它决定「当前 feature」，而不是 git 分支）

### 自问自答（验收的核心）

> **Q：`.specify/feature.json` 是干什么的？**
> A：它是流程的上下文锚点。所有 `/speckit-*` 命令靠它解析当前活跃的 feature 目录，而不是靠 `git checkout` 的状态——所以 Spec Kit 不强制你用 git。

> **Q：下一阶段要做什么，看哪个文件？**
> A：`tasks.md`。而且它是由 `plan.md` 派生的，`plan.md` 又是由 `spec.md` 派生的——这条链就是你后续查问题时用的「追溯路径」。

---

## 6. 踩坑预警

| 坑 | 现象 | 解法 |
|----|------|------|
| **把斜杠命令当终端命令** | 在 shell 里敲 `/speckit-specify` 报 command not found | 它们只在 **agent 聊天**里有效 |
| **init 卡住不动** | 停在箭头选择器上等输入 | 加 `--non-interactive`，并用 `--script` 显式指定脚本风格 |
| **脚本风格选错** | Windows 下生成的 `.sh` 无法执行 | `--script ps`（PowerShell）或 `sh`（Git Bash） |
| **找不到活跃 feature** | 命令报错说无法定位 feature | 检查 `.specify/feature.json`，或设 `SPECIFY_FEATURE_DIRECTORY` |
| **以为必须用 git branch** | 手动建 `001-xxx` 分支后命令行为没变 | 活跃 feature 由 `feature.json` 决定，git 扩展只是组织形式 |

---

## 7. 本节术语

| 术语 | 含义 |
|------|------|
| `specify init` | 唯一的**终端命令**，用于生成项目骨架与 agent skill 文件 |
| integration | 把你的 coding agent 接进来的适配层；决定生成哪套 `/speckit-*` 命令文件 |
| skill | agent 聊天里的一个流程步骤（如 `/speckit-plan`），不是 shell 命令 |
| `.specify/feature.json` | 活跃 feature 的状态文件，流程上下文的唯一锚点 |
| `SPECIFY_FEATURE_DIRECTORY` | 覆盖上述状态的环境变量，用于切换目标 feature |

---

## 8. 进入下一节前

检查一遍：你现在应该有一个**有完整 spec/plan/tasks、但一行代码都没有**的项目。请盯着这个状态想一个问题：

> **这三个 Markdown 文件，到底解决了什么问题？为什么不直接跟 agent 说「给我写个 hello-sdd」？**

带着这个问题去 **L01**。

---

**下一节** → [L01 · 为什么是 SDD：心智模型与成熟度模型](./01-why-sdd.md)
**参考** → [EARS 句式速查](../reference/ears.md) ｜ [术语表](../reference/glossary.md)
