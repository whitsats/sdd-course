package dev.billflow.domain;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.time.LocalDate;
import java.time.YearMonth;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("US1/US4 · 账单周期的定义与校验")
class MonthCycleTest {

    @Test
    @DisplayName("1.1 周期区间为 [月首日, 次月首日)")
    void rangeIsWholeMonth() {
        MonthCycle cycle = MonthCycle.of(YearMonth.of(2026, 2));

        assertEquals(LocalDate.of(2026, 2, 1), cycle.range().startInclusive());
        assertEquals(LocalDate.of(2026, 3, 1), cycle.range().endExclusive());
        assertEquals(28, cycle.range().days());
    }

    @Test
    @DisplayName("4.4 非整月区间被拒绝 → INVALID_PERIOD")
    void rejectsNonMonthRange() {
        for (LocalDate[] pair : new LocalDate[][]{
                {LocalDate.of(2026, 2, 5), LocalDate.of(2026, 3, 1)},   // 起始不是月首
                {LocalDate.of(2026, 2, 1), LocalDate.of(2026, 2, 28)},  // 结束不是次月首
                {LocalDate.of(2026, 2, 1), LocalDate.of(2026, 3, 2)},   // 结束越过了次月首
                {LocalDate.of(2026, 1, 31), LocalDate.of(2026, 3, 1)}   // 跨两个月
        }) {
            BillingException thrown = assertThrows(
                    BillingException.class, () -> MonthCycle.of(pair[0], pair[1]),
                    "应拒绝：" + pair[0] + " → " + pair[1]);
            assertEquals(BillingException.INVALID_PERIOD, thrown.code());
        }
    }

    @Test
    @DisplayName("4.4 合法的「月首 → 次月首」被接受")
    void acceptsValidMonthFromExternalDates() {
        MonthCycle cycle = MonthCycle.of(LocalDate.of(2026, 2, 1), LocalDate.of(2026, 3, 1));

        assertEquals(YearMonth.of(2026, 2), cycle.month());
    }

    @Test
    @DisplayName("4.2 天数取该月实际天数（平年 28 / 闰年 29 / 大月 31）")
    void usesActualMonthLength() {
        assertEquals(28, MonthCycle.of(YearMonth.of(2026, 2)).daysInMonth());
        assertEquals(29, MonthCycle.of(YearMonth.of(2024, 2)).daysInMonth());
        assertEquals(31, MonthCycle.of(YearMonth.of(2026, 3)).daysInMonth());
        assertEquals(30, MonthCycle.of(YearMonth.of(2026, 4)).daysInMonth());
    }

    @Test
    @DisplayName("12 月的次月首必须跨到次年 1 月 1 日")
    void handlesYearBoundary() {
        MonthCycle cycle = MonthCycle.of(YearMonth.of(2026, 12));

        assertEquals(LocalDate.of(2026, 12, 1), cycle.range().startInclusive());
        assertEquals(LocalDate.of(2027, 1, 1), cycle.range().endExclusive());
        assertEquals(31, cycle.range().days());
    }
}
