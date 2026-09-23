package dev.billflow.domain;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.LocalDate;
import java.util.Currency;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("US2 · 费率生效规则")
class RateTableTest {

    private static final Currency CNY = Currency.getInstance("CNY");

    private static RateTable.Version version(String id, String effectiveFrom, long cents) {
        return new RateTable.Version(id, LocalDate.parse(effectiveFrom), cents);
    }

    @Test
    @DisplayName("2.1 生效日含当日；取「生效日 ≤ 该日」的最晚一个版本")
    void picksLatestVersionEffectiveOnThatDay() {
        RateTable table = RateTable.of(CNY, List.of(
                version("R1", "2026-01-01", 10000),
                version("R2", "2026-03-16", 15000)));

        assertEquals("R1", table.at(LocalDate.parse("2026-01-01")).id(), "生效日当天即适用");
        assertEquals("R1", table.at(LocalDate.parse("2026-03-15")).id(), "变更前一天仍是旧版本");
        assertEquals("R2", table.at(LocalDate.parse("2026-03-16")).id(), "变更当天立即适用新版本");
        assertEquals("R2", table.at(LocalDate.parse("2027-06-01")).id(), "之后的日期沿用最后一个版本");
    }

    @Test
    @DisplayName("2.1 两个版本之间没有空档：中间的日期沿用较早版本")
    void keepsEarlierVersionUntilNextEffectiveDate() {
        RateTable table = RateTable.of(CNY, List.of(
                version("R1", "2026-01-01", 10000),
                version("R2", "2026-06-01", 12000)));

        assertEquals("R1", table.at(LocalDate.parse("2026-03-01")).id());
    }

    @Test
    @DisplayName("2.2 同一天两个版本 → RATE_OVERLAP（拒绝加载）")
    void rejectsOverlappingEffectiveDates() {
        BillingException thrown = assertThrows(BillingException.class, () -> RateTable.of(CNY, List.of(
                version("R1", "2026-01-01", 10000),
                version("R2", "2026-01-01", 12000))));

        assertEquals(BillingException.RATE_OVERLAP, thrown.code());
    }

    @Test
    @DisplayName("2.3 早于最早版本 → RATE_MISSING，绝不回退")
    void reportsMissingRateInsteadOfFallingBack() {
        RateTable table = RateTable.of(CNY, List.of(version("R1", "2026-01-01", 10000)));

        BillingException thrown = assertThrows(
                BillingException.class, () -> table.at(LocalDate.parse("2025-12-31")));

        assertEquals(BillingException.RATE_MISSING, thrown.code());
        // 关键是"不回退"：静默按 10000 计费会产出一张看起来正常、实则少收钱的账单，
        // 而那种账单不会触发任何告警 —— 这才是最难发现的失败模式。
        assertTrue(thrown.getMessage().contains("不接受回退"));
    }

    @Test
    @DisplayName("2.4 非正费率与空费率表 → INVALID_RATE")
    void rejectsNonPositiveOrEmptyRateTable() {
        for (long bad : new long[]{0L, -1L}) {
            BillingException thrown = assertThrows(BillingException.class,
                    () -> RateTable.of(CNY, List.of(version("R1", "2026-01-01", bad))),
                    "费率 " + bad + " 应被拒绝");
            assertEquals(BillingException.INVALID_RATE, thrown.code());
        }

        BillingException empty = assertThrows(BillingException.class,
                () -> RateTable.of(CNY, List.of()));
        assertEquals(BillingException.INVALID_RATE, empty.code());
    }

    @Test
    @DisplayName("1.7 下一个变更点：严格晚于给定日")
    void findsNextChangeStrictlyAfterDay() {
        RateTable table = RateTable.of(CNY, List.of(
                version("R1", "2026-01-01", 10000),
                version("R2", "2026-03-16", 15000)));

        assertEquals(LocalDate.parse("2026-03-16"),
                table.nextChangeAfter(LocalDate.parse("2026-03-01")).orElseThrow());
        assertEquals(LocalDate.parse("2026-03-16"),
                table.nextChangeAfter(LocalDate.parse("2026-03-15")).orElseThrow());
        assertTrue(table.nextChangeAfter(LocalDate.parse("2026-03-16")).isEmpty(),
                "变更日当天之后没有下一个变更点");
    }
}
