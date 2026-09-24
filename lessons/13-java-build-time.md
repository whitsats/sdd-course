# L13 · 把约束前移到构建期 ⭐

| 项 | 内容 |
|----|------|
| **时长** | 120 min（含实操通常 4 h） |
| **前置** | L09（你已经在项目 B 里体会过"测试 + CI"这一级强制力） |
| **案例** | 项目 D · [billflow](../examples/billflow/README.md)（Java 17 · Maven 多模块） |
| **产出** | 一个"规格违背就编译不过"的工程 + 六条元验证记录（A–F） |
| **验收** | ① `mvn verify` 全绿 ② 注入未知规格编号 → **编译失败** ③ 让 domain 依赖被禁类型 → **架构测试失败** ④ 你能说清这套约束**不该**用在什么场合 |

> 📁 **本节的完整参考产出**（全部实测跑过）：
>
> | 产物 | 文件 |
> |------|------|
> | 功能规格（21 条 EARS） | [`examples/billflow/specs/001-billing-mvp/spec.md`](../examples/billflow/specs/001-billing-mvp/spec.md) |
> | 技术方案（含追溯表与 ArchUnit 决策） | [`examples/billflow/specs/001-billing-mvp/plan.md`](../examples/billflow/specs/001-billing-mvp/plan.md) |
> | 精度与取整的取舍记录 | [`examples/billflow/docs/adr/ADR-003-金额精度与取整.md`](../examples/billflow/docs/adr/ADR-003-金额精度与取整.md) |
> | 21 条标准 ↔ 测试映射 | [`examples/billflow/docs/验收标准-测试映射.md`](../examples/billflow/docs/验收标准-测试映射.md) |
> | 编译期守卫（注解处理器） | [`examples/billflow/spec-guard/`](../examples/billflow/spec-guard) |
> | 真实运行输出与六条元验证 | [`examples/billflow/notes/L13-构建期强制.md`](../examples/billflow/notes/L13-构建期强制.md) |

---

## 1. 这一节在整门课里的位置

前面的项目 B 已经建立了"规格有牙齿"这件事：类型约束、契约测试、CI 门禁。但那三颗牙齿有一个共同点——**它们都在测试阶段或之后才咬人**。

```
强制力光谱（越往右，违背代价暴露得越早）

  无强制力          测试红灯         CI 红灯        编译失败        无法构造
  ────────────────────────────────────────────────────────────────────────►
  spec-first       spec-anchored              构建期强化（本节）
  项目 A           项目 B                    项目 D
```

往右移动的价值不是"更严格"，而是**反馈更快、绕过更难**：

| | 测试红灯 | CI 红灯 | 编译失败 |
|---|---|---|---|
| 谁知道 | 跑了测试的人 | 推到远端之后 | **任何一次编译** |
| 能不能绕过 | 本地不跑就行 | CI 加 `\|\| true` 就行 | 拿不到 class 文件 |
| 定位成本 | 读到断言行 | 读到日志 | 错误挂在**具体那行注解**上 |

本节要做的是把三条约束分别推到更右边：规格编号 → 编译期；架构边界 → 字节码级检查；金额不变量 → 对象构造时。

---

## 2. 为什么又是"钱"的领域

项目 D 是一个订阅计费引擎。选它不是为了"再做一个后端"——是因为**金额领域天然需要精确的规格**：

按月费率按天分摊时，`M / D` 几乎总是不整除。100 元 / 31 天 = 322.580645… 分。于是规格必须回答三个问题，而且**必须由人回答**：

1. 中间结果用什么表示？（小数？整数分？）
2. 什么时候取整？（先乘后除，还是先除后乘？）
3. 余数归谁？（丢掉？堆到一天？按规则分配？）

这三个问题的不同组合会产生"看起来都合理、但金额不一致"的结果。生产环境的症状是"客户说少收了 1 分"，而且**几乎无法复现**——差异只出现在特定天数与特定费率的组合上。

规格里最关键的三条（`spec.md` US1）：

| 编号 | 规则 | 如果由实现者顺手决定会怎样 |
|------|------|--------------------------|
| 1.3 | 先乘后除 `⌊M × N / D⌋` | 写成 `M / D × N`：28 天月、14 天覆盖时得 4998 而不是 5000，**差 2 分**且随天数放大 |
| 1.4 | 余数从段首日按日顺序各加 1 分 | 余数全给最后一天 → 那天金额突兀；丢弃 → 违反不变量 1.5 |
| 1.7 | 跨费率变更**逐段独立**取整 | 全程一次取整：2026 年 3 月得 12580 而不是 12579，多收的 1 分**无法归因到任何一版费率** |

> 💡 **先读 ADR，再读代码。** `ADR-003` 记录了这三种算法的取舍、被否决的方案、以及代价。
> 代码只说明"怎么算"，ADR 说明"为什么这么算、以及另一种算法错在哪"。

---

## 3. 机制一：把规格编号变成编译器的符号

### 做法

代码里标注实现点：

```java
@Ac({"1.3", "1.4"})
public static List<LineItem> dailyItems(Segment segment, int daysInMonth) { ... }
```

编译时，我们自己的注解处理器读取 `spec.md`，若编号不存在就**报错并终止编译**。

### 关键代码

```java
@SupportedAnnotationTypes("dev.billflow.specguard.Ac")
@SupportedOptions(SpecGuardProcessor.SPEC_FILE_OPTION)   // "spec.file"
public final class SpecGuardProcessor extends AbstractProcessor {

    /** 与 scripts/check-spec-coverage.sh 使用同一条判定规则 —— 两处规则必须一致。 */
    private static final Pattern AC_ROW = Pattern.compile("^\\s*\\|\\s*(\\d+\\.\\d+)\\s*\\|");
```

完整实现见 [`spec-guard/.../SpecGuardProcessor.java`](../examples/billflow/spec-guard/src/main/java/dev/billflow/specguard/SpecGuardProcessor.java)。它只有 ~200 行，但有三条设计准则值得逐条记住：

### 准则 1：读不到规格时**报错**，绝不静默通过

处理器需要 `-Aspec.file=...` 才知道规格在哪。如果这个参数缺失，最"温和"的做法是跳过校验——**而那是错的**。

> 一个"读不到输入就当没问题"的检查，比没有检查更危险：它让团队相信有保护，而实际什么都没查。

所以缺参数、路径不存在、文件里解析不出任何编号——三种情况全部报 ERROR 并终止编译。

### 准则 2：ERROR 必须满足「绝不可能是故意的」

`@Ac("9.9")` 而规格里只有 1.1–5.3，这不是风格问题，是**规格与代码已经脱节**。没有一种合理解释，所以它是 ERROR。

对比 L09 里 `check-rendering.sh` 的取舍：那里"有编号没被引用"只报 NOTE —— 因为存在大量合理例外（不是每条验收标准都对应一行产品代码）。**把这种情况升级成错误，门禁就会频繁误报，然后被关掉，连真话一起失去。**

### 准则 3：错误信息要能替代一次文档翻阅

实测输出（元验证 A）：

```
[ERROR] .../DateRange.java:[21,8] @Ac("9.9") 在规格里不存在。
      规格文件：D:\Code\SDD\examples\billflow\specs\001-billing-mvp\spec.md
      实际存在：1.1–1.7, 2.1–2.4, 3.1–3.3, 4.1–4.4, 5.1–5.3
      两种可能：① 规格改了但这里没跟着改；② 编号写错了。
```

只说"编号不存在"会让人去翻 spec.md 手工对照；列出**实际范围**之后，多数情况下一眼就能判断是笔误还是规格真改了。

### 元验证 A（必做）

```bash
cd examples/billflow
# 把 DateRange 的注解改成 @Ac({"4.1", "4.3", "9.9"})，然后：
MAVEN_OPTS="-Dfile.encoding=UTF-8" mvn -B verify
# → COMPILATION ERROR，连 class 文件都不生成
```

**注意它失败在哪一步**：不是测试阶段，不是 CI 的最后一步，而是编译器。写错编号的人拿不到任何可运行产物。

---

## 4. 机制二：架构检查用字节码，不用 grep

### 这门课前面犯过的错

L02/L07 用自制脚本 `scripts/check-layer-boundary.sh` 检查分层边界。它在实际使用中**误报了两轮**——因为 naive 的 grep 把注释里的模块名算成了违规：

```java
// state-machine.ts 的注释里写着「本文件不得 import fastify」
// → 脚本把这句话判成了违规，门禁每次都红
```

修法（先过滤出真实的 import 行）能救回来，但这暴露了一件事：**源码文本不是约束的正确输入**。

### 换成 ArchUnit

```java
noClasses()
    .that().resideInAPackage("..domain..")
    .should().dependOnClassesThat().resideInAnyPackage("java.io..", "java.sql..")
    .check(ALL);   // ALL 来自 new ClassFileImporter()...
```

| | 自制 grep 脚本 | ArchUnit |
|---|---|---|
| 输入 | 源码文本 | **编译后的字节码** |
| 注释/字符串里的词 | 会误报（实测两轮） | 不受影响 |
| 失败信息 | 「文件:行号 + 匹配到的行」 | 「`DateRange#hasStarted` 调用了 `java.time.LocalDate#now`」 |
| 新增约束 | 改正则（容易越改越松） | 加一行规则 |
| 何时跑 | 记得手动跑 / CI 里跑 | **随 `mvn verify` 一起跑** |

> 自制脚本适用于"生态里没有对应工具"的场景。一旦有成熟检查，自制脚本就从资产变成了负债 —— 因为你需要维护它的误报，而**误报会让团队关掉门禁**（AP-18）。

### 一个必须单独记住的教训

本案例有三条架构规则，其中一条是"domain 不得读时钟"。第一版只用「类依赖」表达，结果 `LocalDate.now()` 从旁边溜过去了：

| 违规写法 | 能被依赖规则抓到？ | 原因 |
|---------|-----------------|------|
| `System.currentTimeMillis()` | ✅ | `java.lang.System` 是一个类依赖 |
| `LocalDate.now()` | ❌ | owner 是 `java.time.LocalDate` —— 一个**完全合法的领域类型** |

必须再写一条按**方法调用**查的规则：

```java
for (JavaMethodCall call : method.getMethodCallsFromSelf()) {
    String target = call.getTarget().getOwner().getName() + "#" + call.getTarget().getName();
    if (clockReaders.contains(target)) { ... }   // "java.time.LocalDate#now", ...
}
```

> **约束的表达形式决定了它的覆盖范围。**
> 同一个意图"不得读时钟"，用"依赖了哪些类"表达就漏一半；只有按"调用了哪些方法"表达才是完整的。
> 说不清的规则，等于没有规则 —— 只能靠 code review 的记忆，而记忆不是门禁。

### 元验证 B / C（必做）

注入两处违规，然后跑构建：

```
[ERROR] LayerBoundaryTest.domainMustNotDeclareFloatingPoint:163 金额计算不得使用浮点（ADR-003 决策 1）：
[ERROR] LayerBoundaryTest.domainMustNotReadTheClock:133 domain 不得读时钟（相同输入必须产生逐字节相同的账单）：
[ERROR] LayerBoundaryTest.domainMustNotUseLegacyTimeOrClock:100 domain 不得依赖时钟或旧时间类型：

# surefire 报告里的明细：
DateRange#hasStarted 调用了 java.time.LocalDate#now
DateRange#hasStarted 调用了 java.lang.System#currentTimeMillis
DateRange → java.lang.System
Money#toYuan 返回 double
```

**违规定位到方法**，而不是"某一行匹配到了某个词"。这就是换工具的收益。

---

## 5. 机制三：不变量在构造时强制

第三种约束既不在编译期也不在测试里，而是**根本不让你构造出非法对象**：

```java
public record Invoice(MonthCycle cycle, List<LineItem> items, Money total) {
    public Invoice {
        // ... 规格 5.3：明细必须日期升序且连续
        // ... 规格 1.5：Σ(明细) == 总额
        long sum = ...;
        if (sum != total.cents()) {
            throw new IllegalStateException("不变量被破坏：Σ明细 = " + sum + " 分，但账单总额 = ...");
        }
    }
}
```

为什么这比"写一条测试断言 Σ明细 == 总额"更强：

| | 测试断言 | 构造器强制 |
|---|---|---|
| 保证 | 跑过的那些**用例**里不变量成立 | 不存在违反不变量的**对象** |
| 新代码路径 | 只要没覆盖到，就能违反 | 绕不过去 |
| 性质 | **概率性** | **必然性** |

> 一句话：**测试证明"我试过的情况是对的"，构造器证明"错的情况不存在"。**

### 一个容易混的分工（本案例严格区分）

| 异常类型 | 含义 | 例子 | 有没有可处理的业务分支 |
|---------|------|------|---------------------|
| `BillingException` + 错误码 | **输入世界的错** | `RATE_OVERLAP`、`CURRENCY_MISMATCH` | 有——调用方要分支、要告警 |
| `IllegalStateException` | **我们自己写错了** | Σ明细 ≠ 总额 | 没有——只有修 |

混淆两者会产出"用错误码掩饰 bug"的代码：把不变量违背包装成一个可捕获的业务异常，于是它变成"已知情况"，再也没人修。

---

## 6. 元验证：门禁必须自证会红 ⭐

**这是本节的核心，也是整门课反复出现的那条纪律。** 六条全部实测，原始输出在 `notes/L13-构建期强制.md`：

| # | 注入的违规 | 预期 | 实际 |
|---|-----------|------|------|
| A | `@Ac("9.9")`（规格里没有） | 编译失败 | ✅ 编译失败，列出实际编号范围 |
| B | `Money` 里加 `static double toYuan(long)` | 架构测试失败 | ✅ `Money#toYuan 返回 double` |
| C | `DateRange` 里调用 `LocalDate.now()` / `System.currentTimeMillis()` | 两条规则失败 | ✅ 定位到 `DateRange#hasStarted` |
| D | 从映射表删掉 `1.5` 那一行 | 覆盖率门禁变红并指出缺哪条 | ✅ `标准条数: 21  映射行数: 20` / `缺少测试映射的标准编号：- 1.5` |
| **E** | 用 `<proc>none</proc>` 关掉注解处理 | 能区分「校验跑了」与「校验没跑」 | ✅ `mvn verify` 退出码 0、测试全过，但 `check-java-build.sh` 抓住并失败 |
| F | 不注入任何东西，只在**温热的 worktree** 上跑 `mvn verify` | 门禁不能把环境状态误报成代码问题 | ✅ 报红，且错误信息同时列出「聚合根」与「增量编译」两种原因 |

> **A 是本节的招牌演示。** 它证明的不是"我们有个检查"，而是"这件事**不可能蒙混过去**"——
> 编号对不上，你连一份能跑的产物都拿不到。

### 元验证 E（最重要的一条）：门禁到底有没有在跑

前四条验证的都是"注入违规 → 变红"。第五条要验证的东西完全不同：**绿灯是不是空的。**

在 `billing-app/pom.xml` 的编译器配置里加一行 `<proc>none</proc>`（关掉注解处理 —— 现实中
完全可能有人为了构建提速而这么做），然后：

```bash
cd examples/billflow && MAVEN_OPTS="-Dfile.encoding=UTF-8" mvn -B verify; echo $?
# BUILD SUCCESS
# 751 个测试全过，一条警告都没有
# 0            ← 退出码 0
#
# 而规格校验一次都没执行。
```

我们自己的门禁脚本能拦住它：

```
$ bash scripts/check-java-build.sh
::error::注解处理器没有运行，本次构建的「规格校验」等于没做。
    构建退出码：0（可能仍是 0 —— 那正是危险之处）
    输出末尾：
      [INFO] BUILD SUCCESS
退出码 1
```

它凭什么知道？因为它在**捕获的输出里断言了注解处理器打印的那行标记**，而不是看退出码。

> 一个会报错的门禁会被修；一个**沉默不查**的门禁会一直绿下去，而所有人都以为有保护。
> **绿灯不等于有检查，绿灯只等于没报警。**

同一个形态在本仓库已出现**四次** —— 值得作为本节的收尾记住：

| 出现位置 | 沉默的方式 | 症状 |
|---------|-----------|------|
| `verify-generated.sh`（初版） | 先重新生成再 diff，把手改覆盖掉 | 它**修好了问题却报告没事** |
| `check-rendering.sh`（初版） | awk 变量名撞上内建函数 `close`，报错被 `2>/dev/null` 吞掉 | 那段检查**从未运行过**，却每次都返回通过 |
| `mvn verify`（本节） | 处理器不在 classpath 或被 `proc:none` 关掉 | 构建全绿、测试全过，**规格校验为零** |
| **`mvn verify`（增量构建）** | 一个字节码都没重新生成 | 日志里是 `Nothing to compile`，处理器**一次都没跑** —— 而门禁只断言标记行，于是报红。**这次红得对，但它红的原因和上次不是同一个**（见 §7 ①） |

四次的修法一致：**不要相信「没有输出就是没问题」，要主动断言那个「我确实做了」的证据。**

而最后一条还多教了一件事：**同一个绿灯/红灯可能来自两个完全不同的原因**，
所以门禁必须在两种情况下都能给出正确结论 —— 而不是碰巧对。

---

## 7. 踩坑预警（全部是真实撞到的）

### ① 必须在聚合根上跑 `mvn verify` —— 否则它会**静默跳过**

`spec-guard` 是独立的 Maven 模块（注解处理器必须先构建，鸡生蛋问题）。因此：

```bash
cd examples/billflow        # 聚合根 ✅ 处理器会生效
MAVEN_OPTS="-Dfile.encoding=UTF-8" mvn -B verify

cd examples/billflow/billing-app   # ❌ 处理器不在，静默跳过规格校验
mvn -B verify                      # 构建全绿，但什么规格检查都没做
```

这是本案例最值得警惕的失败模式，也是"门禁的失效往往不是报错，而是沉默"的又一个实例。

### ①′ 还有第二种静默跳过：**增量编译**（门禁自己踩过）

`check-java-build.sh` 的第一版写的是 `mvn -B verify`，第一次跑是绿的，
**第二次跑就红了** —— 而代码一行没改。原因是 Maven 的增量编译：

```
[INFO] Nothing to compile - all classes are up to date.
```

一个字节码都没重新生成，`javac` 自然没有加载注解处理器，标记行也就没出现。
换句话说，「处理器跑了没发现问题」与「处理器没跑」的差别，
在这里取决于**上一次构建有没有留下 `target/`** —— 一个与本门禁意图完全无关的状态。

```bash
mvn -B verify        # 温热的工作区：Nothing to compile → 处理器不执行
mvn -B clean verify  # 强制重新编译：Recompiling... → 处理器必然执行一次
```

修法是 `clean verify`（脚本里已改）。**差别不只是多跑几秒：**

> **一道门禁必须自己保证「被检查的东西有机会发生」。**
> 如果它的结论取决于上一次构建留下的缓存，那它的绿灯和红灯都不代表任何东西。
>
> 同理：CI 上不要把 `target/` 缓存复用到这一步。缓存让构建更快，
> 但在这一步它会静默改变被检查的内容 —— **这一步的结论比它的速度重要**。

### ② 注解处理器**没有** `close()` 钩子

`AbstractProcessor` 只实现 `init / process / getSupported*`，**没有** `close()`。想写"编译收尾"逻辑，只能靠 `roundEnv.processingOver()`：

```java
@Override
public boolean process(Set<? extends TypeElement> annotations, RoundEnvironment roundEnv) {
    if (roundEnv.processingOver()) { reportCoverage(); return false; }
    ...
}
```

（第一版就写了 `@Override public void close()`，直接编译不过。）

### ③ ArchUnit 的 API 细节：依赖不是类

```java
javaClass.getDirectDependenciesFromSelf()   // 返回 Set<Dependency>，不是 JavaClass
dependency.getTargetClass().getName()       // 目标类要走这一步
```

这个 API 形状本身是有意的：依赖关系是**对象**，所以它还能告诉你这个依赖发生在哪个成员上（`getDescription()`）。

### ④ Windows 上 `MAVEN_OPTS="-Dfile.encoding=UTF-8"` 不是可选项

不带它，构建日志里的中文（包括你自己写的编译期错误信息）会变成 `�������Ḳ...`。那会让你以为编译器的消息本身有问题，而实际上只是控制台代码页不匹配。

### ⑤ 我的两个测试写错了，而它们是"知识点纠错"

第一次 `mvn verify` 跑出 **750 个测试、2 个失败**——**两个失败都在测试里，代码是对的**：

| 失败 | 我原来的想法 | 正确的事实 |
|------|------------|-----------|
| 相邻区间的边界日 | 以为 `[2/1, 2/15)` 与 `[2/15, 3/1)` 都不含 2/15 | 2/15 **属于第二个区间** —— 这正是半开区间的意义：边界日恰好归属一个区间，不会两边都不算 |
| 不变量报错信息 | 断言里写"差 1 分" | 实际输出"差 **-1** 分" —— 差值有方向，错误信息必须说清**哪边多** |

第二条顺带改进了代码：现在 `Invoice` 的消息会写"差 1 分，明细合计大于总额"。**错误信息要能直接回答"差多少、哪边多"，而不是把两个数字丢出来让人自己算。**

### ⑥ Java 17 能用的"编译期强制"手段比 Java 21 少

课程选 Java 17（最普遍的 LTS），但要注意：

- `record`：Java 16+ ✅
- `sealed interface`：Java 17 ✅
- **穷尽性 `switch` 模式匹配（JEP 441）：Java 21 才转正**，17 上还是预览特性（要 `--enable-preview`，不适合教学环境）

所以本案例选了**注解处理器**这条路来表达"编译期强制"，而不是"用 sealed + 穷尽 switch 让编译器强制你处理所有状态"（那是 Java 21 上更漂亮的写法）。**这是环境约束下的取舍，不是唯一解**——记录在此，免得你以为"编译期强制只有这一种形态"。

---

## 8. 这套约束**不该**用在什么场合

和 L10 的边界感一样，这一节的真价值在这里。

| 信号 | 说明 |
|------|------|
| **构建时间已经很长** | 注解处理器参与每次编译。它必须足够快、足够可靠 —— 一个会拖慢所有人日常循环的门禁，会被绕过 |
| **团队还没稳定在 spec-anchored** | 连映射表都还没建立，先上编译期守卫是本末倒置。**顺序是：覆盖率门禁 → 架构检查 → 编译期守卫** |
| **规格本身在剧烈变动** | 规格每周大改时，`@Ac` 标注会变成纯粹的维护负担。等编号体系稳定了再上 |
| **只有一个人在做的探索性项目** | 收益有限。这级约束的价值随**参与人数**增长 —— 它防的是"别人不知道而写错" |

还有一条更根本的：**注解处理器参与构建，所以它出错会阻断所有人。** 这就是为什么本案例的处理器只做一件事（校验编号存在性），而且读不到规格时宁可失败也不静默通过。**一个功能很多的构建期守卫，是一个随时会拦下整个团队的构建期守卫。**

---

## 9. 术语

| 术语 | 含义 |
|------|------|
| **Annotation Processor** | `javax.annotation.processing` 提供的编译期插件机制，可在编译过程中检查源码、生成代码、报错终止编译 |
| **ArchUnit** | 以字节码为输入的架构约束检查库；约束用流式 Java API 表达，随测试一起跑 |
| **构建期强制（build-time enforcement）** | 把规格约束放在编译或构建阶段执行，使违背无法进入产物 |
| **构造器不变量** | 在对象创建时校验的不变量；不满足即无法构造，因此非法状态在系统中不存在 |
| **强制力光谱** | 本课程用于描述约束"多早咬人"的模型：无强制 → 测试 → CI → 编译期/构造期 |

---

## 10. 交付物与验收

**交付物**：

- 一个 Maven 多模块工程，`mvn verify` 全绿（含编译期规格校验、架构检查、测试）
- 六条元验证（A–F）的真实现象记录

**验收标准**：

- [ ] `bash scripts/check-java-build.sh` 通过（它同时断言了**规格校验确实运行过**）
- [ ] 注入规格里不存在的编号 → **编译失败**，且错误信息列出规格实际范围
- [ ] 让 `domain` 依赖被禁用类型（`double` / 时钟 / I/O）→ **架构测试失败**，且违规定位到方法
- [ ] `bash scripts/check-spec-coverage.sh examples/billflow` 报「21/21 覆盖完整」
- [ ] 你能说出这套约束**不适合**自己手头哪个项目，以及原因 ← **这一条最重要**

> ⚠️ 第 5 条是刻意的。本节考核的不是"你成功用上了编译期守卫"，而是"你有了**时机判断力**"。
> 见过太多项目在规格体系还没建立时先上最重的门禁，结果三个月后整套被绕过 —— 比从没上过更糟。

---

## 11. 这是最后一节的功能课

走到这里，你已经完整走过三个维度：

| 维度 | 项目 | 你练到的判断力 |
|------|------|--------------|
| **规格有多强** | A → B → C | 什么时候值得写规格、要写到什么程度、什么时候让代码生成 |
| **约束有多早** | D（本节） | 同一个约束放在哪一层执行，代价与收益各是什么 |
| **存量怎么办** | L11 | 没有规格的代码库里，怎么反推出规格并分类每一处偏差 |
| **团队怎么办** | L12 | 什么信号意味着该收手 |

**下节预告（L12 已在前面）**：如果你还没读 L12，现在读它会有完全不同的感受 —— 因为你会意识到，"落地"的本质不是推行流程，而是**在正确的时机选择正确的强制层级**，并在无效时果断撤掉。
