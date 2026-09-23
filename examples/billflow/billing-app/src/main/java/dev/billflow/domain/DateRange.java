package dev.billflow.domain;

import dev.billflow.specguard.Ac;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.Objects;
import java.util.Optional;
import java.util.stream.Stream;

/**
 * 日期区间，**半开区间** {@code [startInclusive, endExclusive)}（规格 4.1）。
 *
 * <p>为什么全项目统一用半开区间：闭区间在每一处都要 {@code +1}，而 off-by-one
 * 是计费系统里最难发现的一类错误 —— 它只在月末、年末、订阅恰好当天生效/失效时出现，
 * 测试很容易刚好绕开。半开区间让"天数 = 结束 − 开始"直接成立，不需要任何加减。
 *
 * @param startInclusive 起始日（含）
 * @param endExclusive   结束日（不含）
 */
@Ac({"4.1", "4.3"})
public record DateRange(LocalDate startInclusive, LocalDate endExclusive) {

    public DateRange {
        Objects.requireNonNull(startInclusive, "startInclusive");
        Objects.requireNonNull(endExclusive, "endExclusive");
        if (!endExclusive.isAfter(startInclusive)) {
            // 规格 4.3：结束日必须晚于起始日。注意"相等"也被拒绝 —— 空区间不是一个合法输入，
            // 它应该在上游被处理成"没有计费范围"（规格 1.6），而不是一路传进来。
            throw BillingException.invalidPeriod(
                    "结束日必须晚于起始日：[" + startInclusive + ", " + endExclusive + ")");
        }
    }

    /** 天数 = 结束日 − 起始日（按日历天，含闰年 2 月 29 日；规格 4.2）。 */
    @Ac("4.2")
    public int days() {
        return (int) ChronoUnit.DAYS.between(startInclusive, endExclusive);
    }

    /** 半开区间的包含判定：结束日**不在**区间内（规格 4.1）。 */
    public boolean contains(LocalDate day) {
        Objects.requireNonNull(day, "day");
        return !day.isBefore(startInclusive) && day.isBefore(endExclusive);
    }

    /** 求交。无交集返回 {@link Optional#empty()} —— 调用方必须显式处理，不能默默得到 0 天区间。 */
    public Optional<DateRange> intersect(DateRange other) {
        Objects.requireNonNull(other, "other");
        LocalDate start = startInclusive.isAfter(other.startInclusive) ? startInclusive : other.startInclusive;
        LocalDate end = endExclusive.isBefore(other.endExclusive) ? endExclusive : other.endExclusive;
        return end.isAfter(start) ? Optional.of(new DateRange(start, end)) : Optional.empty();
    }

    public Stream<LocalDate> dayStream() {
        return startInclusive.datesUntil(endExclusive);
    }

    @Override
    public String toString() {
        return "[" + startInclusive + ", " + endExclusive + ")";
    }
}
