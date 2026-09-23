package dev.billflow.domain;

import dev.billflow.specguard.Ac;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Currency;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;

/**
 * 月度费率表：按**生效日**版本化（规格 US2），加载即校验、加载后不可变。
 *
 * <p>三条校验全部在 {@link #of} 里完成，而不是在使用时发现：
 *
 * <ul>
 *   <li>费率必须为正（2.4）</li>
 *   <li>生效日不可重复（2.2）</li>
 *   <li>（隐含）版本数不可为零 —— 空表意味着任何日期都无费率，那是配置错误</li>
 * </ul>
 *
 * <p><b>为什么"尽早报错"在这里格外重要</b>：如果这些校验推迟到计费时，
 * 错误就发生在生成账单的过程中，而账单是**有时间窗口**的业务动作 ——
 * 上午跑批失败、下午才发现费率表配错了，代价远高于在加载费率表时直接拒绝。
 */
public final class RateTable {

    /**
     * 一个费率版本。
     *
     * @param id           版本标识，会写进账单明细（规格 5.1：可追溯）
     * @param effectiveFrom 生效日，**含当日**（规格 2.1）
     * @param monthlyCents  月度费率（分），正整数
     */
    public record Version(String id, LocalDate effectiveFrom, long monthlyCents) {

        public Version {
            Objects.requireNonNull(id, "id");
            Objects.requireNonNull(effectiveFrom, "effectiveFrom");
        }
    }

    private final Currency currency;
    private final List<Version> versions;

    private RateTable(Currency currency, List<Version> versions) {
        this.currency = currency;
        this.versions = List.copyOf(versions);
    }

    @Ac({"2.2", "2.4"})
    public static RateTable of(Currency currency, List<Version> input) {
        Objects.requireNonNull(currency, "currency");
        if (input == null || input.isEmpty()) {
            throw BillingException.invalidRate("费率表不能为空：没有任何版本意味着任何日期都无费率可用");
        }

        List<Version> sorted = new ArrayList<>(input);
        sorted.sort(Comparator.comparing(Version::effectiveFrom));

        Set<LocalDate> effectiveDates = new HashSet<>();
        for (Version version : sorted) {
            if (version.monthlyCents() <= 0) {
                throw BillingException.invalidRate(
                        "版本 " + version.id() + " 的月度费率必须为正：收到 " + version.monthlyCents() + " 分");
            }
            if (!effectiveDates.add(version.effectiveFrom())) {
                throw BillingException.rateOverlap(
                        "生效日 " + version.effectiveFrom() + " 存在两个版本；"
                                + "无法判定该日适用哪一个 —— 生效日必须唯一");
            }
        }
        return new RateTable(currency, sorted);
    }

    public Currency currency() {
        return currency;
    }

    public List<Version> versions() {
        return versions;
    }

    /**
     * 某日适用的版本：取**生效日 ≤ 该日的最晚一个**（规格 2.1）。
     *
     * <p>若该日早于最早版本，抛 {@code RATE_MISSING}（规格 2.3）。
     * <b>刻意不做静默回退</b>：回退会产出"看起来正常但少收钱"的账单，
     * 而这类账单不会触发任何告警 —— 是本领域最危险的失败模式。
     */
    @Ac({"2.1", "2.3"})
    public Version at(LocalDate day) {
        Objects.requireNonNull(day, "day");
        Version found = null;
        for (Version version : versions) {
            if (version.effectiveFrom().isAfter(day)) {
                break;
            }
            found = version;
        }
        if (found == null) {
            throw BillingException.rateMissing(
                    "日期 " + day + " 早于最早的费率版本 " + versions.get(0).effectiveFrom()
                            + "（版本 " + versions.get(0).id() + "）。不接受回退到最近版本。");
        }
        return found;
    }

    /** 严格晚于 {@code day} 的下一个版本生效日。用于把计费范围按费率变更切成段（规格 1.7）。 */
    @Ac("1.7")
    public Optional<LocalDate> nextChangeAfter(LocalDate day) {
        Objects.requireNonNull(day, "day");
        for (Version version : versions) {
            if (version.effectiveFrom().isAfter(day)) {
                return Optional.of(version.effectiveFrom());
            }
        }
        return Optional.empty();
    }
}
