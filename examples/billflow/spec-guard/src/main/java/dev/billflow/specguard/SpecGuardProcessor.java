package dev.billflow.specguard;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.annotation.processing.AbstractProcessor;
import javax.annotation.processing.RoundEnvironment;
import javax.annotation.processing.SupportedAnnotationTypes;
import javax.annotation.processing.SupportedOptions;
import javax.lang.model.SourceVersion;
import javax.lang.model.element.Element;
import javax.lang.model.element.TypeElement;
import javax.tools.Diagnostic;

/**
 * 在编译期校验 {@link Ac} 里引用的规格编号确实存在于 {@code spec.md}。
 *
 * <p>为什么这件事值得做成编译器插件，而不是又一个 shell 脚本：
 *
 * <ul>
 *   <li><b>时机</b>：shell 门禁跑在 CI 的最后；编译期校验发生在**任何产物生成之前**。
 *       写错编号的人甚至拿不到一个 class 文件。</li>
 *   <li><b>不可能被绕过</b>：脚本可以被跳过（本地不跑、CI 加 <code>|| true</code>），
 *       而编译是必经之路。</li>
 *   <li><b>位置精确</b>：错误信息挂在具体元素上，IDE 里直接标红那行注解。</li>
 * </ul>
 *
 * <p><b>两条设计准则</b>（本处理器最重要的部分，比实现细节重要）：
 *
 * <ol>
 *   <li><b>无法读取规格时报 ERROR，而不是静默通过。</b>
 *       一个"读不到输入就当没问题"的检查，比没有检查更危险 —— 它会让团队相信
 *       有保护，而实际上什么都没查。</li>
 *   <li><b>「引用了不存在的编号」是 ERROR，「有编号没被引用」只是 NOTE。</b>
 *       前者的唯一解释是规格与代码已经脱节；后者存在大量合理例外
 *       （并非每条验收标准都对应一行产品代码）。把后者升级成错误，
 *       门禁就会频繁误报，然后被关掉 —— 连真话一起失去。</li>
 * </ol>
 */
@SupportedAnnotationTypes("dev.billflow.specguard.Ac")
@SupportedOptions(SpecGuardProcessor.SPEC_FILE_OPTION)
public final class SpecGuardProcessor extends AbstractProcessor {

    /** 编译参数名：{@code -Aspec.file=<spec.md 的路径>}。 */
    public static final String SPEC_FILE_OPTION = "spec.file";

    /**
     * 规格中的验收标准行，形如 {@code | 1.3 | ... |}。
     *
     * <p>⚠️ 这个正则必须与 {@code scripts/check-spec-coverage.sh} 的判定保持一致，
     * 否则会出现"脚本说覆盖完整、编译器说过不了"的分裂。两处规则不一致比两处都松更糟。
     */
    private static final Pattern AC_ROW = Pattern.compile("^\\s*\\|\\s*(\\d+\\.\\d+)\\s*\\|");

    /** 已加载的规格；null 表示尚未尝试加载。 */
    private Spec spec;

    /** 加载失败后不再重复报错 —— 每次编译报 200 遍同样的话只会淹没真正的问题。 */
    private boolean loadFailed;

    /** 收集到的引用，用于最后打印覆盖率摘要。 */
    private final Set<String> referenced = new TreeSet<>();

    @Override
    public SourceVersion getSupportedSourceVersion() {
        return SourceVersion.latestSupported();
    }

    @Override
    public boolean process(Set<? extends TypeElement> annotations, RoundEnvironment roundEnv) {
        if (roundEnv.processingOver()) {
            reportCoverage();
            return false;
        }

        Set<? extends Element> annotated = roundEnv.getElementsAnnotatedWith(Ac.class);
        if (annotated.isEmpty()) {
            return false;
        }

        Spec loaded = loadSpec();
        if (loaded == null) {
            return false; // 已经在 loadSpec 里报过错
        }

        for (Element element : annotated) {
            Ac ac = element.getAnnotation(Ac.class);
            if (ac == null) {
                continue;
            }
            for (String rawId : ac.value()) {
                String id = rawId.trim();
                referenced.add(id);
                if (!loaded.ids().contains(id)) {
                    processingEnv.getMessager().printMessage(
                            Diagnostic.Kind.ERROR,
                            "@Ac(\"" + id + "\") 在规格里不存在。\n"
                                    + "    规格文件：" + loaded.path() + "\n"
                                    + "    实际存在：" + loaded.summary() + "\n"
                                    + "    两种可能：① 规格改了但这里没跟着改；② 编号写错了。\n"
                                    + "    （这是编译期检查：不存在「下不为例」的例外，必须修正）",
                            element);
                }
            }
        }
        return false;
    }

    /**
     * 报告覆盖率摘要（NOTE 级别，不阻断构建）。
     *
     * <p>注意它只能在最后一轮调用 —— {@code AbstractProcessor} 没有 {@code close()} 钩子，
     * 而 {@code roundEnv.processingOver()} 是唯一可靠的「编译收尾」时机。
     */
    private void reportCoverage() {
        if (spec == null || loadFailed || referenced.isEmpty()) {
            return;
        }
        List<String> unannotated = new ArrayList<>(spec.ids());
        unannotated.removeAll(referenced);
        String message = "规格校验：spec.md 共 " + spec.ids().size() + " 条验收标准，"
                + "代码标注了 " + referenced.size() + " 条";
        if (!unannotated.isEmpty()) {
            message += "；未被标注的是 " + String.join(", ", unannotated)
                    + "（NOTE 而非 ERROR：并非每条标准都对应产品代码，例如输出顺序可能由数据结构天然保证）";
        }
        processingEnv.getMessager().printMessage(Diagnostic.Kind.NOTE, message);
    }

    // ── 规格加载 ─────────────────────────────────────────────────────────────

    private Spec loadSpec() {
        if (spec != null) {
            return spec;
        }
        if (loadFailed) {
            return null;
        }

        String configured = processingEnv.getOptions().get(SPEC_FILE_OPTION);
        if (configured == null || configured.isBlank()) {
            processingEnv.getMessager().printMessage(
                    Diagnostic.Kind.ERROR,
                    "缺少编译参数 -A" + SPEC_FILE_OPTION + "=<spec.md 路径>。\n"
                            + "    这不是可选项：没有它，规格校验会变成「什么都不检查」的摆设，\n"
                            + "    而构建依然全绿 —— 那种状态比没有校验更危险。\n"
                            + "    修复方式见 billing-app/pom.xml 的 maven-compiler-plugin 配置。");
            loadFailed = true;
            return null;
        }

        Path path = Path.of(configured).toAbsolutePath().normalize();
        if (!Files.isRegularFile(path)) {
            processingEnv.getMessager().printMessage(
                    Diagnostic.Kind.ERROR,
                    "规格文件不存在：" + path + "\n"
                            + "    路径来自 -A" + SPEC_FILE_OPTION + "。检查 pom 里的相对路径是否写对。");
            loadFailed = true;
            return null;
        }

        try {
            LinkedHashSet<String> ids = new LinkedHashSet<>();
            for (String line : Files.readAllLines(path, StandardCharsets.UTF_8)) {
                Matcher matcher = AC_ROW.matcher(line);
                if (matcher.find()) {
                    ids.add(matcher.group(1));
                }
            }
            if (ids.isEmpty()) {
                processingEnv.getMessager().printMessage(
                        Diagnostic.Kind.ERROR,
                        "规格里没解析出任何验收标准编号：" + path + "\n"
                                + "    期望的行形如：| 1.3 | WHEN … THE SYSTEM SHALL … |\n"
                                + "    若是格式变了（比如改成了 checkbox），请同步修改本处理器与\n"
                                + "    scripts/check-spec-coverage.sh —— 规格得先能被机器读到，才能被机器强制。");
                loadFailed = true;
                return null;
            }
            spec = new Spec(path, ids, summarize(ids));
            return spec;
        } catch (IOException e) {
            processingEnv.getMessager().printMessage(
                    Diagnostic.Kind.ERROR, "读取规格失败：" + path + "（" + e.getMessage() + "）");
            loadFailed = true;
            return null;
        }
    }

    /** 把编号集合压成 {@code 1.1–1.7, 2.1–2.4} 这样的紧凑形式，便于塞进错误信息。 */
    private static String summarize(Set<String> ids) {
        List<String> sorted = new ArrayList<>(ids);
        sorted.sort((a, b) -> {
            int cmp = Integer.compare(story(a), story(b));
            return cmp != 0 ? cmp : Integer.compare(index(a), index(b));
        });

        List<String> parts = new ArrayList<>();
        int i = 0;
        while (i < sorted.size()) {
            int start = i;
            String startId = sorted.get(i);
            while (i + 1 < sorted.size()
                    && story(sorted.get(i + 1)) == story(startId)
                    && index(sorted.get(i + 1)) == index(sorted.get(i)) + 1) {
                i++;
            }
            String endId = sorted.get(i);
            parts.add(startId.equals(endId) ? startId : startId + "–" + endId);
            i++;
        }
        return String.join(", ", parts);
    }

    private static int story(String id) {
        return Integer.parseInt(id.substring(0, id.indexOf('.')));
    }

    private static int index(String id) {
        return Integer.parseInt(id.substring(id.indexOf('.') + 1));
    }

    /** 已加载规格的不可变视图。 */
    private record Spec(Path path, Set<String> ids, String summary) {
    }
}
