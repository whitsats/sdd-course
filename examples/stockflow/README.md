# 案例 E · stockflow — 把规格放进数据层

> **一句话**：库存预占引擎。它的主角不是 JavaScript，是 `.sql`。
> 26 条验收标准里，**20 条的强制力落在 schema 上**（`CHECK` / `UNIQUE` / `FK` / `TRIGGER` / `STRICT` / 视图），
> 而这 20 条拦的是**所有**写入者 —— 包括那些**不经过这个应用**的写入。
>
> 剩下的 6 条里：3 条**只能**靠事务（1.3 / 3.4 / 4.4），2 条降级为巡检（4.1 / 5.4），
> 1 条取决于连接前提（4.5）。这 6 条就是数据层强制的边界，见
> [`docs/adr/ADR-004-数据层做不到的事.md`](docs/adr/ADR-004-数据层做不到的事.md)。
>
> 📌 逐条归属见 [`docs/验收标准-测试映射.md`](docs/验收标准-测试映射.md) 的**保证者**一列 ——
> 它是本案例唯一的事实来源，本页与讲义里的每个数字都从那一列数出来。

**对应讲义**：[`lessons/14-data-layer-constraints.md`](../../lessons/14-data-layer-constraints.md)
**运行记录**：[`notes/L14-数据层强制.md`](notes/L14-数据层强制.md)
**规模**：26 条验收标准 · 44 个测试（其中 16 个**不碰应用代码**）· 20 项门禁检查 · **零第三方依赖**
**schema**：5 张表 · 8 个触发器 · 2 个视图 · 3 个索引

---

## 这个案例在讲什么

前四个案例的约束都放在**代码路径上**，它们有一个共同的隐含前提：
**所有写入都会经过这段代码**。库存系统不满足这个前提 ——
运维手工补数据、迁移脚本、监控系统、另一个服务的直连、DBA 的一条 `UPDATE`，
每一条都是绕过应用的写入路径。

于是问题变成：

> **一条规格，如果要拦住「不经过你的代码的写入」，它必须住在哪里？**

答案是**数据层**。但本案例的一半价值在于这件事成立，另一半在于它的**代价与边界**。

### 招牌演示：零 JS 加载，八条直写

```bash
sqlite3 var/stockflow.db "UPDATE sku SET on_hand = -1;"     # rejected: CHECK constraint failed
sqlite3 var/stockflow.db "INSERT INTO reservation ... 'GHOST' ..."   # ACCEPTED  ← 唯一漏掉的
```

**7 拦 1 漏，而漏掉的那一条恰好是强制力挂在 `PRAGMA foreign_keys` 上的那一条** ——
该 PRAGMA 是**每连接**的，且不同客户端默认值不同（实测：Node 默认开，Python 与命令行默认关）。

**同一个库、同一条语句、三个客户端，结果不同。** 这就是本案例的核心发现，
展开在 [`docs/adr/ADR-002-外键可能不生效.md`](docs/adr/ADR-002-外键可能不生效.md)。

---

## 目录

```
migrations/001_init.sql      ← 实现的主体：规格住在这里
queries/patrol.sql           ← 强制不了的规则 → 降级为可观测
src/db.mjs                   ← 连接前提（设置 + 读回断言）+ 可重入事务
src/store.mjs                ← 刻意「薄」到不正常：不含任何业务条件判断
src/errors.mjs               ← 稳定错误码（以及它的精度上限）
src/cli.mjs                  ← 人工演示入口，时刻可控
specs/001-stockflow-mvp/     ← spec.md（26 条）+ plan.md
docs/adr/                    ← 4 份决策记录，第 2 份是本案例的核心
docs/验收标准-测试映射.md       ← 26 行 +「保证者」列 + 元验证记录
tests/                       ← 44 个测试，其中 16 个**不 import 应用代码**
```

---

## 怎么跑

```bash
# 测试（零依赖，只需要 Node ≥ 22.5）
node --test tests/*.spec.mjs

# 数据层强制力门禁（八条直写 + 反假绿 + 守恒 + 巡检）
bash ../../scripts/check-sql-enforcement.sh

# 覆盖率门禁（规格条数 == 映射行数）
bash ../../scripts/check-spec-coverage.sh examples/stockflow

# 人工演示：时刻可控，所以过期与收割都是可复现的实验，不是需要等待的现象
node src/cli.mjs add-sku SKU-1 --at=1000
node src/cli.mjs receive SKU-1 10 --at=1000
node src/cli.mjs reserve SKU-1 4  --at=1000 --ttl=200 --req=REQ-A --res=R1
node src/cli.mjs show --at=1000        # 可用量 6
node src/cli.mjs show --at=1300        # REQ-A 过期 → 可用量回到 10（AC 3.2）
node src/cli.mjs commit R1 --at=1300   # EXPIRED（AC 2.6）
node src/cli.mjs reap --at=1300        # 收割 1 条
node src/cli.mjs patrol                # 0 行
```

`var/stockflow.db` 是本地库文件，可以随时删掉重建。

---

## 与案例 D（billflow）的关系

两者都在扩展**「约束能放在多早」**这条轴，但方向相反：

| | D · billflow（Java） | E · stockflow（SQL-first） |
|---|---|---|
| 约束放在 | 编译期（注解处理器）、字节码（ArchUnit）、构造器 | schema（CHECK / UNIQUE / FK / TRIGGER） |
| 拦住谁 | **写错代码的人** | **任何写入者，包括不经过代码的** |
| 是否需要前提 | 编译配置（`proc:none` 会让它静默消失） | 连接前提（`PRAGMA foreign_keys` 同上） |
| 失效形态 | 构建全绿、规格校验零执行 | 测试全绿、幽灵行写进去 |
| 分层 | 分 domain / app，架构测试强制方向 | **刻意不分层** —— 规则不在代码里，造空的 domain 目录会让结构说谎 |

**两者共同的失效形态**：**代码在，但什么都没发生，而且不报错。**
这是整个课程反复出现的一条线，在 [`notes/L14-数据层强制.md`](notes/L14-数据层强制.md) §5.5
里记录了它在本案例里出现的 4 次，以及**两次「元验证本身出错」**。

---

## 门禁的可信度

`scripts/check-sql-enforcement.sh` 里有三条**反假绿**设计，缺了任何一条它都会变成装饰：

1. **合法的写入必须成功** —— 否则一个把整库写成只读的 schema 也能让「脏数据被拒绝」全绿。
2. **断言目标行存在** —— 否则空 `WHERE` 匹配 0 行，「什么都没发生」会被读成「写入成功」。
3. **按实测的 PRAGMA 决定预期** —— 外键那一条的预期结果随客户端变化，
   若写死成「一定拒绝」，它在 Python 与命令行客户端上会给出**假红灯**，
   而假红灯的下场通常是被人用 `|| true` 关掉。

五条元验证（A–E）全部实际执行并记录在
[`docs/验收标准-测试映射.md`](docs/验收标准-测试映射.md) 的结尾「元验证记录」一节，
其中 **C1 / C2 的对照**（有断言 → 连接就炸；没断言 → 静默放行脏数据）是本案例最值钱的一组。

> 📌 这里原本写的是 `...#元验证记录本表不是承诺是实测` —— **跳不过去**。
> 中文标题在 Zensical 下拿到的 id 是 `_N` 这种位置编号，不是中文 slug，
> 而且位置编号会随小节顺序变化。所以本站的规矩是：**站内链接不手写锚点。**
> 这条现在由 `scripts/check-rendering.sh` 对着构建产物真实生成的 id 检查（它就是这么发现本条的）。
