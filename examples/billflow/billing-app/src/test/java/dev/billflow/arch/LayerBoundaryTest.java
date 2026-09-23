package dev.billflow.arch;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.tngtech.archunit.core.domain.JavaClass;
import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.domain.JavaField;
import com.tngtech.archunit.core.domain.JavaMethod;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * 架构约束的机械检查。
 *
 * <p>本项目把它放在**测试**里，而不是像前面的案例那样用一个自制 shell 脚本。三个理由：
 *
 * <ol>
 *   <li><b>输入是字节码，不是源码文本。</b> 自制 grep 脚本会把注释和字符串里的模块名算成违规
 *       （课程前面的 <code>check-layer-boundary.sh</code> 就为此误报过两轮），而字节码里没有注释。</li>
 *   <li><b>失败信息是结构化的。</b> 它告诉你「类 A 通过字段 f 依赖了 类 B」，而不是「某一行匹配到了某个词」。</li>
 *   <li><b>它随 <code>mvn verify</code> 一起跑。</b> 没人需要记得单独执行它 —— 这就是"门禁"与"工具"的区别。</li>
 * </ol>
 *
 * <p>⚠️ {@code DO_NOT_INCLUDE_TESTS} 不是可选项：测试类与被测类在同一个包里（Java 惯例），
 * 不排除的话本测试类自己会被当成 domain 类来检查，于是"domain 不得依赖 JUnit"立刻失败 ——
 * 一个把自己绊倒的门禁。
 */
@DisplayName("架构边界（非功能需求：依赖方向）")
class LayerBoundaryTest {

    private static final JavaClasses ALL = new ClassFileImporter()
            .withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
            .importPackages("dev.billflow");

    private static List<JavaClass> classesInDomain() {
        List<JavaClass> domain = new ArrayList<>();
        for (JavaClass javaClass : ALL) {
            if (javaClass.getPackageName().endsWith(".domain")) {
                domain.add(javaClass);
            }
        }
        return domain;
    }

    @Test
    @DisplayName("依赖方向：domain 不得依赖 app 层")
    void domainMustNotDependOnAppLayer() {
        noClasses()
                .that().resideInAPackage("..domain..")
                .should().dependOnClassesThat().resideInAPackage("..app..")
                .check(ALL);
    }

    @Test
    @DisplayName("domain 不得触碰 I/O、网络、持久化与序列化")
    void domainMustStayFreeOfInfrastructure() {
        noClasses()
                .that().resideInAPackage("..domain..")
                .should().dependOnClassesThat().resideInAnyPackage(
                        "java.io..",
                        "java.nio..",
                        "java.net..",
                        "java.sql..",
                        "javax.sql..",
                        "com.fasterxml..")
                .check(ALL);
    }

    @Test
    @DisplayName("domain 不得引用旧时间类型、时钟或 System（否则账单结果依赖运行时刻）")
    void domainMustNotUseLegacyTimeOrClock() {
        Set<String> forbidden = Set.of(
                "java.util.Date",
                "java.util.Calendar",
                "java.util.GregorianCalendar",
                "java.time.Clock",
                "java.lang.System",
                "java.lang.ThreadLocal");

        List<String> violations = new ArrayList<>();
        for (JavaClass javaClass : classesInDomain()) {
            // ⚠️ getDirectDependenciesFromSelf() 返回的是 Dependency，不是 JavaClass。
            //    要拿目标类得走 getTargetClass() —— 这一步的意图是「依赖关系本身是对象」，
            //    所以它还能告诉你依赖发生在哪个成员上（getDescription()）。
            for (com.tngtech.archunit.core.domain.Dependency dependency
                    : javaClass.getDirectDependenciesFromSelf()) {
                String target = dependency.getTargetClass().getName();
                if (forbidden.contains(target)) {
                    violations.add(javaClass.getSimpleName() + " → " + target);
                }
            }
        }

        assertTrue(violations.isEmpty(),
                "domain 不得依赖时钟或旧时间类型（规格 4.1、4.2 要求日历天计算是显式且确定的）：\n"
                        + String.join("\n", violations));
    }

    @Test
    @DisplayName("domain 不得读时钟（否则账单结果依赖运行时刻，账单不可复现）")
    void domainMustNotReadTheClock() {
        // ⚠️ 这条规则**无法**用「依赖了哪些类」表达：
        //    java.lang.System 可以被依赖规则抓到，但 LocalDate.now() 的 owner 是 LocalDate ——
        //    它同时是合法的领域类型。同一个意图（「不得读时钟」）必须按**方法调用**去查。
        //    这是本案例里「约束要表达成可机械判定的形式」最具体的一次示范：
        //    规则写不清，就只能靠 code review 记忆。
        Set<String> clockReaders = Set.of(
                "java.time.LocalDate#now",
                "java.time.LocalDateTime#now",
                "java.time.Instant#now",
                "java.time.Clock#instant",
                "java.lang.System#currentTimeMillis",
                "java.lang.System#nanoTime");

        List<String> violations = new ArrayList<>();
        for (JavaClass javaClass : classesInDomain()) {
            for (JavaMethod method : javaClass.getMethods()) {
                for (com.tngtech.archunit.core.domain.JavaMethodCall call : method.getMethodCallsFromSelf()) {
                    String target = call.getTarget().getOwner().getName() + "#" + call.getTarget().getName();
                    if (clockReaders.contains(target)) {
                        violations.add(javaClass.getSimpleName() + "#" + method.getName() + " 调用了 " + target);
                    }
                }
            }
        }

        assertTrue(violations.isEmpty(),
                "domain 不得读时钟（相同输入必须产生逐字节相同的账单）：\n" + String.join("\n", violations));
    }

    @Test
    @DisplayName("domain 不得出现 double / float（规格 3.1：金额必须是整数分）")
    void domainMustNotDeclareFloatingPoint() {
        List<String> violations = new ArrayList<>();

        for (JavaClass javaClass : classesInDomain()) {
            String owner = javaClass.getSimpleName();

            for (JavaField field : javaClass.getFields()) {
                if (isFloating(field.getRawType().getName())) {
                    violations.add(owner + "." + field.getName() + " 的类型是 " + field.getRawType().getName());
                }
            }
            for (JavaMethod method : javaClass.getMethods()) {
                if (isFloating(method.getRawReturnType().getName())) {
                    violations.add(owner + "#" + method.getName() + " 返回 "
                            + method.getRawReturnType().getName());
                }
                for (JavaClass parameter : method.getRawParameterTypes()) {
                    if (isFloating(parameter.getName())) {
                        violations.add(owner + "#" + method.getName() + " 的参数是 " + parameter.getName());
                    }
                }
            }
        }

        assertTrue(violations.isEmpty(),
                "金额计算不得使用浮点（ADR-003 决策 1）：\n" + String.join("\n", violations));
    }

    private static boolean isFloating(String typeName) {
        return "double".equals(typeName) || "float".equals(typeName);
    }
}
