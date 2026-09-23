package dev.billflow.domain;

import dev.billflow.specguard.Ac;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.Objects;

/**
 * 账单周期：一个**自然月**（规格 1.1、4.4）。
 *
 * <p>为什么用一个专门的类型，而不是到处传 {@code DateRange}：
 * 规格 4.4 要求"账单周期必须是月首到次月首"，而 {@code DateRange} 能表示任意区间。
 * 如果服务签名收 {@code DateRange}，那么"传了一个非法区间"就是一个**只能靠运行时校验**
 * 才能发现的问题。改成收 {@code MonthCycle} 之后，非法状态**无法表达** ——
 * 构造它的唯一合法路径是 {@link YearMonth}，或经过校验的 {@link #of(LocalDate, LocalDate)}。
 *
 * <p>这就是"把约束编码进类型"与"把约束写成 if 判断"的差别：前者在编译期就排除了，
 * 后者要靠每个调用点都记得写。
 */
public record MonthCycle(YearMonth month) {

    public MonthCycle {
        Objects.requireNonNull(month, "month");
    }

    public static MonthCycle of(YearMonth month) {
        return new MonthCycle(month);
    }

    /**
     * 从外部传入的起止日解析账单周期。
     *
     * <p>存在这个入口是因为账单周期可能来自外部系统（对账文件、上游调度），
     * 那些数据**不受我们的类型系统约束**，必须校验。校验失败即 {@code INVALID_PERIOD}（规格 4.4）。
     */
    @Ac("4.4")
    public static MonthCycle of(LocalDate startInclusive, LocalDate endExclusive) {
        Objects.requireNonNull(startInclusive, "startInclusive");
        Objects.requireNonNull(endExclusive, "endExclusive");
        if (startInclusive.getDayOfMonth() != 1 || !endExclusive.equals(startInclusive.plusMonths(1))) {
            throw BillingException.invalidPeriod(
                    "账单周期必须是「月首日 → 次月首日」：收到 [" + startInclusive + ", " + endExclusive + ")");
        }
        return new MonthCycle(YearMonth.from(startInclusive));
    }

    /** 对应的半开区间 {@code [月首日, 次月首日)}。 */
    public DateRange range() {
        LocalDate start = month.atDay(1);
        return new DateRange(start, start.plusMonths(1));
    }

    /** 该月天数 D（28–31；闰年 2 月为 29）。分摊公式里的分母。 */
    @Ac("1.1")
    public int daysInMonth() {
        return month.lengthOfMonth();
    }

    @Override
    public String toString() {
        return month.toString();
    }
}
