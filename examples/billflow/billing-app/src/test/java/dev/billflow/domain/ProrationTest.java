package dev.billflow.domain;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Currency;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;

@DisplayName("US1 · 按天分摊")
class ProrationTest {

    private static final Currency CNY = Currency.getInstance("CNY");

    private static RateTable.Version version(String id, String effectiveFrom, long cents) {
        return new RateTable.Version(id, LocalDate.parse(effectiveFrom), cents);
    }

    private static DateRange range(String start, String end) {
        return new DateRange(LocalDate.parse(start), LocalDate.parse(end));
    }

    @Test
    @DisplayName("1.3 先乘后除：2026-02 的 14 天 / 10000 分 → 5000 分（而不是 4998）")
    void multipliesBeforeDividing() {
        assertEquals(5000L, Proration.amountDue(10000, 14, 28));

        // 反面参照：先除后乘会先把 ⌊10000/28⌋ = 357 截断，再乘 14 天 = 4998。
        // 差的 2 分不是舍入误差，而是**顺序错误**；它会随覆盖天数放大，
        // 且用户无法解释这 2 分从哪来。ADR-003 决策 2 记录了这条取舍。
        assertEquals(4998L, (10000L / 28) * 14);
    }

    @Test
    @DisplayName("1.4 余数从段首日按日顺序各加 1 分")
    void allocatesRemainderFromSegmentStart() {
        RateTable rates = RateTable.of(CNY, List.of(version("R1", "2026-01-01", 10000)));
        // 2 月 28 天，覆盖前 14 天：应付 5000，每日基数 357，余数 2
        List<LineItem> items = Proration.items(range("2026-02-01", "2026-02-15"), rates, 28);

        assertEquals(14, items.size());
        assertEquals(358L, items.get(0).cents(), "段首日拿到第 1 分余数");
        assertEquals(358L, items.get(1).cents(), "次日拿到第 2 分余数");
        assertEquals(357L, items.get(2).cents(), "余数用完，回到基数");
        assertEquals(357L, items.get(13).cents());

        assertEquals(5000L, items.stream().mapToLong(LineItem::cents).sum());
        assertEquals(LocalDate.parse("2026-02-01"), items.get(0).day());
        assertEquals(LocalDate.parse("2026-02-14"), items.get(13).day());
    }

    /** 不变量测试的参数矩阵：月天数 × 月费率 × 覆盖天数。 */
    static Stream<Arguments> invariantCases() {
        List<Arguments> cases = new ArrayList<>();
        for (int daysInMonth : new int[]{28, 29, 30, 31}) {
            for (long monthly : new long[]{1L, 7L, 99L, 999L, 10000L, 1234567L}) {
                for (int covered = 1; covered <= daysInMonth; covered++) {
                    cases.add(Arguments.of(daysInMonth, monthly, covered));
                }
            }
        }
        return cases.stream();
    }

    @ParameterizedTest(name = "D={0} M={1} N={2}")
    @MethodSource("invariantCases")
    @DisplayName("1.5 不变量：Σ明细 == ⌊M×N/D⌋，对任意 N ∈ [1, D] 成立")
    void sumInvariantHoldsForAllInputs(int daysInMonth, long monthlyCents, int coveredDays) {
        RateTable.Version version = version("R1", "2026-01-01", monthlyCents);
        DateRange coveredRange = new DateRange(
                LocalDate.of(2026, 3, 1), LocalDate.of(2026, 3, 1).plusDays(coveredDays));
        Proration.Segment segment = new Proration.Segment(version, coveredRange, coveredDays);

        List<LineItem> items = Proration.dailyItems(segment, daysInMonth);

        long expectedTotal = Proration.amountDue(monthlyCents, coveredDays, daysInMonth);
        long base = expectedTotal / coveredDays;
        long remainder = expectedTotal - base * coveredDays;

        assertEquals(coveredDays, items.size());
        assertEquals(expectedTotal, items.stream().mapToLong(LineItem::cents).sum(),
                "Σ明细 必须等于应付总额");

        for (int i = 0; i < coveredDays; i++) {
            assertEquals(base + (i < remainder ? 1 : 0), items.get(i).cents(), "第 " + i + " 天金额");
            assertTrue(items.get(i).cents() >= 0, "金额不得为负");
            assertEquals("R1", items.get(i).rateVersionId(), "每条明细都要能追溯到费率版本");
        }
    }

    @Test
    @DisplayName("1.7 跨费率变更逐段独立取整：2026-03 得 12579，而不是 12580")
    void proratesEachSegmentIndependently() {
        RateTable rates = RateTable.of(CNY, List.of(
                version("R1", "2026-01-01", 10000),
                version("R2", "2026-03-16", 15000)));
        DateRange march = range("2026-03-01", "2026-04-01");

        List<Proration.Segment> segments = Proration.segments(march, rates);
        assertEquals(2, segments.size());
        assertEquals("R1", segments.get(0).version().id());
        assertEquals(15, segments.get(0).days());
        assertEquals("R2", segments.get(1).version().id());
        assertEquals(16, segments.get(1).days());

        List<LineItem> items = Proration.items(march, rates, 31);

        assertEquals(31, items.size(), "两段明细合起来必须覆盖整个 3 月");
        assertEquals(4838L, items.subList(0, 15).stream().mapToLong(LineItem::cents).sum());
        assertEquals(7741L, items.subList(15, 31).stream().mapToLong(LineItem::cents).sum());
        assertEquals(12579L, items.stream().mapToLong(LineItem::cents).sum());

        // 反面参照：全程一次取整会得到 12580 —— 多收 1 分，且这 1 分无法归因到任何一版费率。
        assertEquals(12580L, (10000L * 15 + 15000L * 16) / 31);

        // 明细跨段但必须日期连续、版本标识随之切换（规格 5.3 与 5.1）
        assertEquals(LocalDate.parse("2026-03-01"), items.get(0).day());
        assertEquals("R1", items.get(14).rateVersionId());
        assertEquals("R2", items.get(15).rateVersionId());
        assertEquals(LocalDate.parse("2026-03-31"), items.get(30).day());
    }

    @Test
    @DisplayName("2.3 计费范围早于最早费率版本 → RATE_MISSING，而不是按 0 计费")
    void propagatesMissingRateInsteadOfChargingZero() {
        RateTable rates = RateTable.of(CNY, List.of(version("R1", "2026-03-01", 10000)));

        BillingException thrown = assertThrows(BillingException.class,
                () -> Proration.items(range("2026-02-01", "2026-03-01"), rates, 28));

        assertEquals(BillingException.RATE_MISSING, thrown.code());
    }
}
