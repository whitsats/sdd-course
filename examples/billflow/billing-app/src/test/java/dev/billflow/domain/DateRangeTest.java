package dev.billflow.domain;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.time.LocalDate;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("US4 · 周期与边界")
class DateRangeTest {

    @Test
    @DisplayName("4.1 半开区间：含起始日、不含结束日")
    void isHalfOpen() {
        DateRange range = new DateRange(LocalDate.of(2026, 2, 1), LocalDate.of(2026, 2, 15));

        assertTrue(range.contains(LocalDate.of(2026, 2, 1)), "起始日必须包含");
        assertTrue(range.contains(LocalDate.of(2026, 2, 14)), "结束日前一天必须包含");
        assertFalse(range.contains(LocalDate.of(2026, 2, 15)), "结束日必须不包含");
        assertEquals(14, range.days());
    }

    @Test
    @DisplayName("4.1 相邻区间不重叠（这正是半开区间的意义）")
    void adjacentRangesDoNotOverlap() {
        DateRange first = new DateRange(LocalDate.of(2026, 2, 1), LocalDate.of(2026, 2, 15));
        DateRange second = new DateRange(LocalDate.of(2026, 2, 15), LocalDate.of(2026, 3, 1));

        // 2/15 这一天**恰好属于第二个区间**，不属于第一个 ——
        // 这正是半开区间的作用：边界日只归属恰好一个区间，不会既属于又不属于，也不会两边都不算。
        // （初版测试把断言写成了 second 也不包含 2/15，被这条断言当场纠错。）
        assertFalse(first.contains(LocalDate.of(2026, 2, 15)));
        assertTrue(second.contains(LocalDate.of(2026, 2, 15)));
        assertTrue(first.intersect(second).isEmpty(), "相邻但不重叠的区间求交必须为空");
    }

    @Test
    @DisplayName("4.3 结束日不晚于起始日 → INVALID_PERIOD")
    void rejectsRangeWhoseEndIsNotAfterStart() {
        for (LocalDate[] pair : new LocalDate[][]{
                {LocalDate.of(2026, 2, 15), LocalDate.of(2026, 2, 1)},   // 结束早于开始
                {LocalDate.of(2026, 2, 1), LocalDate.of(2026, 2, 1)}     // 结束等于开始（空区间）
        }) {
            BillingException thrown = assertThrows(
                    BillingException.class, () -> new DateRange(pair[0], pair[1]),
                    "应拒绝：" + pair[0] + " → " + pair[1]);
            assertEquals(BillingException.INVALID_PERIOD, thrown.code());
        }
    }

    @Test
    @DisplayName("4.2 闰年 2 月按 29 天计算")
    void countsLeapDay() {
        assertEquals(29, new DateRange(LocalDate.of(2024, 2, 1), LocalDate.of(2024, 3, 1)).days());
        assertEquals(28, new DateRange(LocalDate.of(2026, 2, 1), LocalDate.of(2026, 3, 1)).days());
    }

    @Test
    @DisplayName("1.2 求交：取重叠部分的天数")
    void intersectsCorrectly() {
        DateRange month = new DateRange(LocalDate.of(2026, 2, 1), LocalDate.of(2026, 3, 1));
        DateRange subscription = new DateRange(LocalDate.of(2026, 2, 5), LocalDate.of(2026, 4, 1));

        DateRange covered = month.intersect(subscription).orElseThrow();

        assertEquals(LocalDate.of(2026, 2, 5), covered.startInclusive());
        assertEquals(LocalDate.of(2026, 3, 1), covered.endExclusive());
        assertEquals(24, covered.days());
    }
}
