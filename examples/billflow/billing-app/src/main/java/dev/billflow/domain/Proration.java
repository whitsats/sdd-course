package dev.billflow.domain;

import dev.billflow.specguard.Ac;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

/**
 * 按天分摊。本案例的核心算法，全部是纯函数（无状态、无 I/O、无时钟）。
 *
 * <p>三条规则来自规格，且每一条都在这里有一个明确的落点：
 *
 * <ol>
 *   <li><b>先乘后除</b>（1.3）—— 见 {@link #amountDue}</li>
 *   <li><b>余数从段首日按日顺序分配</b>（1.4）—— 见 {@link #dailyItems}</li>
 *   <li><b>跨费率变更逐段独立取整</b>（1.7）—— 见 {@link #segments}</li>
 * </ol>
 *
 * <p>三者的取舍与代价记录在 {@code docs/adr/ADR-003-金额精度与取整.md}。
 * 读那一份文档比读这里的代码更重要：代码说明"怎么算"，ADR 说明"为什么这么算、
 * 以及另一种算法错在哪"。
 */
public final class Proration {

    private Proration() {
    }

    /**
     * 一个连续段：段内每天适用同一个费率版本。
     *
     * @param version 该段适用的费率版本
     * @param range   段的日期区间（半开）
     * @param days    段的天数 N
     */
    public record Segment(RateTable.Version version, DateRange range, int days) {
    }

    /**
     * 规格 1.3：应付 = ⌊M × N / D⌋。
     *
     * <p><b>必须先乘后除。</b> 写成 {@code M / D * N} 会先把 {@code M / D} 截断，
     * 丢掉的部分再乘以 N 就放大成了可观的误差：10000 分 / 28 天 × 14 天 = 4998，
     * 而正确答案是 5000 —— 差 2 分，用户无法解释这 2 分从哪来。
     *
     * <p>用 {@link Math#multiplyExact} 而不是裸的 {@code *}：超大费率（分）× 天数
     * 在 int 上会静默溢出，而在金额上溢出是**灾难性**的 —— 它不会抛异常，只会算出一个
     * 荒谬但"看起来正常"的数字。
     */
    @Ac("1.3")
    public static long amountDue(long monthlyCents, int coveredDays, int daysInMonth) {
        if (coveredDays <= 0 || coveredDays > daysInMonth) {
            throw new IllegalArgumentException(
                    "覆盖天数必须在 (0, 月天数] 内：coveredDays=" + coveredDays + ", daysInMonth=" + daysInMonth);
        }
        if (daysInMonth <= 0) {
            throw new IllegalArgumentException("月天数必须为正：" + daysInMonth);
        }
        return Math.multiplyExact(monthlyCents, coveredDays) / daysInMonth;
    }

    /**
     * 规格 1.7：按费率生效日把计费范围切成若干连续段。
     *
     * <p>切段的必要性在于"逐段独立取整"：整段一次算与分两段各算一次，结果可能相差
     * 1 分（段数 − 1 分）。规格选择了逐段独立，因为它让每一分钱都能**归因到某个费率版本** ——
     * 审计时能回答"这 4838 分是按哪一版费率算的"。
     */
    @Ac("1.7")
    public static List<Segment> segments(DateRange covered, RateTable rates) {
        Objects.requireNonNull(covered, "covered");
        Objects.requireNonNull(rates, "rates");

        List<Segment> segments = new ArrayList<>();
        LocalDate cursor = covered.startInclusive();
        while (cursor.isBefore(covered.endExclusive())) {
            // 可能是 RATE_MISSING（规格 2.3）—— 由 RateTable 抛出，这里不捕获也不兜底：
            // 兜底成 0 费率会产出"看起来正常但少收钱"的账单，那是本领域最危险的失败模式。
            RateTable.Version version = rates.at(cursor);
            LocalDate segmentEnd = rates.nextChangeAfter(cursor)
                    .filter(change -> change.isBefore(covered.endExclusive()))
                    .orElse(covered.endExclusive());
            DateRange range = new DateRange(cursor, segmentEnd);
            segments.add(new Segment(version, range, range.days()));
            cursor = segmentEnd;
        }
        return segments;
    }

    /** 规格 1.4 + 1.5 + 1.7：某段内逐日金额，并自检段内不变量。 */
    @Ac({"1.4", "1.5"})
    public static List<LineItem> dailyItems(Segment segment, int daysInMonth) {
        int days = segment.days();
        long due = amountDue(segment.version().monthlyCents(), days, daysInMonth);
        long base = due / days;
        long remainder = due - base * days;

        List<LineItem> items = new ArrayList<>(days);
        LocalDate day = segment.range().startInclusive();
        for (int i = 0; i < days; i++) {
            // 余数从段首日按日顺序各加 1 分。方向固定，因此账单可复现。
            long cents = base + (i < remainder ? 1 : 0);
            items.add(new LineItem(day, cents, segment.version().id()));
            day = day.plusDays(1);
        }

        // 段内自检：把 1.5 的不变量放在"产生它的地方"检查，
        // 这样一旦失败，栈顶就是出错的那一段，而不是最后构造账单的地方。
        long sum = items.stream().mapToLong(LineItem::cents).sum();
        if (sum != due) {
            throw new IllegalStateException(
                    "段内不变量被破坏：Σ明细 = " + sum + "，应付 = " + due
                            + "（版本 " + segment.version().id() + "，段 " + segment.range() + "）");
        }
        return items;
    }

    /** 整个计费范围的逐日明细：切段 → 各段逐日 → 按日期拼接。 */
    @Ac({"1.4", "1.7"})
    public static List<LineItem> items(DateRange covered, RateTable rates, int daysInMonth) {
        List<LineItem> items = new ArrayList<>();
        for (Segment segment : segments(covered, rates)) {
            items.addAll(dailyItems(segment, daysInMonth));
        }
        return items;
    }
}
