# 多 feature 上下文切换实录

> **本文件是 L08 §4 的完整参考产出。** 它记录了一次真实的「开第二个 feature 并来回切换」。
>
> 核心机制：**Spec Kit 靠 `.specify/feature.json` 解析当前 feature，不靠 git 分支。**

**日期**：2026-09-23

---

## 0. 起点

```bash
$ cat .specify/feature.json
{
  "feature_directory": "specs/001-taskflow-mvp"
}

$ ls specs/
001-taskflow-mvp
```

只有一个 feature。前面 8 节课它都没影响过你——因为有且只有一个。

---

## 1. 开第二个 feature

```
/speckit-specify 给任务增加标签能力：一个任务可以有最多 5 个标签，
标签名长度 1–32，同一项目内标签名唯一。任务列表支持按标签过滤，
多个标签之间为「与」语义。
```

生成后：

```bash
$ ls specs/
001-taskflow-mvp  002-task-tags

$ cat .specify/feature.json
{
  "feature_directory": "specs/002-task-tags"
}
```

**注意：活跃 feature 已经自动切到 002 了。** 这不是 git 分支切换的结果——我们从头到尾都在 `main` 分支上。

---

## 2. 关键验证：切换回来时，上下文是否正确

这是本节的重点。切回 001：

```bash
# 方式一：直接改状态文件
$ cat > .specify/feature.json <<'EOF'
{ "feature_directory": "specs/001-taskflow-mvp" }
EOF

# 方式二：用环境变量覆盖（不改文件）
$ export SPECIFY_FEATURE_DIRECTORY=specs/001-taskflow-mvp
```

然后在 agent 聊天里跑：

```
/speckit-analyze
```

### 验证点 1：analyze 检查的是 001 吗？

**结果**：✅ 是。报告内容全部关于 `001-taskflow-mvp` 的 spec / plan / tasks（7 端点、2 角色、状态机）。
**没有出现任何 `002-task-tags` 的内容。**

### 验证点 2：001 的文档被 002 的操作污染了吗？

```bash
$ git status --short
 M .specify/feature.json
?? specs/002-task-tags/
```

**结果**：✅ 没有。`specs/001-taskflow-mvp/` 下的三个文件**完全没有被改动**（`git status` 里没有它们）。

**这是关键证据**：002 的 specify 操作**没有触碰** 001 的任何文档。

---

## 3. 三条纪律（用本次操作验证）

| 纪律 | 本次验证 |
|------|---------|
| **宪法可复用，规格不可** | 002 没有生成新的 `memory/constitution.md`——它复用 001 的那份 ✅。但 002 有自己独立的 `spec.md` / `plan.md` / `tasks.md` ✅ |
| **不要靠 `git checkout` 切 feature** | 全程在 `main` 分支，切换靠的是 `feature.json` 或环境变量 ✅ |
| **改了状态文件要记得** | 见下面第 4 节，这是最容易出事的环节 |

---

## 4. ⚠️ 最容易出事的环节

**场景**：你在处理 002，中途需要回 001 改一个 bug。你改了 `feature.json` 指向 001，修完 bug，然后……

> **忘了改回来。**

接下来你在 002 上跑 `/speckit-plan`，结果它**把 plan 写进了 001 的目录**——或者更隐蔽：它基于 001 的 spec 生成了 plan，而你以为在处理 002。

**为什么这个坑特别危险**：产出的文件名是对的（`plan.md`），目录也是存在的，**没有任何报错**。你不会发现，直到实现完功能发现「咦，怎么少了标签相关的任务」。

### 防坑做法

**每次开始一个步骤前，先看状态文件：**

```bash
$ cat .specify/feature.json
{ "feature_directory": "specs/001-taskflow-mvp" }
```

**这跟「遇到诡异的包问题先查 `node_modules`」是同一个反射。** 行为异常时，第一个要看的不是代码，是状态。

**更好的做法**：把这一步固化成一个 shell 函数，在每次调用 agent 前打印当前 feature：

```bash
# 加到 ~/.bashrc
fl() {
  local feat
  feat=$(grep -o '"feature_directory"[^,}]*' .specify/feature.json 2>/dev/null \
         | sed 's/.*: *"//; s/"//')
  echo "▶ 当前 feature: ${feat:-未设置}"
}
```

```bash
$ fl
▶ 当前 feature: specs/002-task-tags
```

> 📌 在仓库里有 **2 个以上 feature** 之后，这个习惯的价值会立刻显现。

---

## 5. 本次操作的关键结论

1. **`.specify/feature.json` 是唯一的上下文锚点**，与 git 分支无关。
   > 这也解释了为什么 Spec Kit **不强制你用 git**——feature 的组织方式（可选启用 git 扩展生成 `001-xxx` 编号分支）与活跃 feature 的解析是两件独立的事。

2. **002 的 specify 没有污染 001 的文档** —— 这是 feature 目录隔离的直接证据。

3. **单值状态 = 单活跃上下文**，这决定了多 agent 并行的切分粒度：

| 并行方式 | 可行性 |
|---------|-------|
| agent A 做 001，agent B 做 002 | ✅ 可行 |
| 两个 agent 同时做 001 的不同任务 | ⚠️ **危险**——共享同一份 spec/plan/tasks，会互相覆写 |

**第 3 条是 L12「多 agent 协作」的技术前提。** 大多数人第一次尝试并行时会本能地按任务切分——而那是错的，因为这个状态文件是**单值**的。
