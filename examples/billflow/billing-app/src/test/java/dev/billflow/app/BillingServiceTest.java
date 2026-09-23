package dev.billflow.app;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.billflow.domain.BillingException;
import dev.billflow.domain.DateRange;
import dev.billflow.domain.Invoice;
import dev.billflow.domain.MonthCycle;
import dev.billflow.domain.RateTable;
import dev.billflow.domain.Subscription;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.Currency;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("端到端 · 从订阅到账单")
class BillingServiceTest {

    private static final Currency CNY = Currency.getInstance("CNY");
    private static final Currency USD = Currency.getInstance("USD");

    private final BillingService service = new BillingService();

    private static Subscription subscription(String from, String to, Currency currency) {
        return new Subscription("S-1", new DateRange(LocalDate.parse(from), LocalDate.parse(to)), currency);
    }

    private static RateTable flatRates(long monthlyCents) {
        return RateTable.of(CNY, List.of(
                new RateTable.Version("R1", LocalDate.of(2026, 1, 1), monthlyCents)));
    }

    @Test
    @DisplayName("1.2 只对「订阅 ∩ 周期」的天数计费")
    void billsOnlyCoveredDays() {
        Invoice invoice = service.bill(
                subscription("2026-02-05", "2027-01-01", CNY),
                MonthCycle.of(YearMonth.of(2026, 2)),
                flatRates(10000));

        assertEquals(24, invoice.itemCount(), "2/5 到 2/28 共 24 天");
        assertEquals(LocalDate.of(2026, 2, 5), invoice.items().get(0).day());
        assertEquals(LocalDate.of(2026, 2, 28), invoice.items().get(23).day());
        // ⌊10000 × 24 / 28⌋ = 8571
        assertEquals(8571L, invoice.total().cents());
    }

    @Test
    @DisplayName("整月订阅 = 月度费率原值（分摊不产生零头）")
    void fullMonthChargesExactMonthlyRate() {
        Invoice invoice = service.bill(
                subscription("2026-02-01", "2026-03-01", CNY),
                MonthCycle.of(YearMonth.of(2026, 2)),
                flatRates(10000));

        assertEquals(28, invoice.itemCount());
        assertEquals(10000L, invoice.total().cents());
        // 28 天分 10000 分：基数 357，余数 4 → 前 4 天 358
        assertEquals(358L, invoice.items().get(0).cents());
        assertEquals(357L, invoice.items().get(27).cents());
    }

    @Test
    @DisplayName("1.6 订阅与周期无交集 → 空账单，总额 0，不报错")
    void returnsEmptyInvoiceWhenNoOverlap() {
        Invoice invoice = service.bill(
                subscription("2026-04-01", "2026-05-01", CNY),
                MonthCycle.of(YearMonth.of(2026, 2)),
                flatRates(10000));

        assertTrue(invoice.isEmpty());
        assertEquals(0, invoice.itemCount());
        assertEquals(0L, invoice.total().cents());
    }

    @Test
    @DisplayName("1.7 月中变更费率 → 账单跨两段，总额 12579")
    void billsAcrossMidMonthRateChange() {
        RateTable rates = RateTable.of(CNY, List.of(
                new RateTable.Version("R1", LocalDate.of(2026, 1, 1), 10000),
                new RateTable.Version("R2", LocalDate.of(2026, 3, 16), 15000)));

        Invoice invoice = service.bill(
                subscription("2026-01-01", "2027-01-01", CNY),
                MonthCycle.of(YearMonth.of(2026, 3)),
                rates);

        assertEquals(31, invoice.itemCount());
        assertEquals(12579L, invoice.total().cents());
        // 可追溯：账单里能看出哪几天用了哪一版费率（规格 5.1）
        assertEquals("R1", invoice.items().get(14).rateVersionId());
        assertEquals("R2", invoice.items().get(15).rateVersionId());
    }

    @Test
    @DisplayName("3.2 订阅币种与费率表币种不一致 → CURRENCY_MISMATCH")
    void rejectsCurrencyMismatch() {
        BillingException thrown = assertThrows(BillingException.class, () -> service.bill(
                subscription("2026-02-01", "2026-03-01", USD),
                MonthCycle.of(YearMonth.of(2026, 2)),
                flatRates(10000)));

        assertEquals(BillingException.CURRENCY_MISMATCH, thrown.code());
    }

    @Test
    @DisplayName("2.3 计费范围早于最早费率版本 → RATE_MISSING，绝不产出错误账单")
    void reportsMissingRateInsteadOfMisbilling() {
        RateTable rates = RateTable.of(CNY, List.of(
                new RateTable.Version("R1", LocalDate.of(2026, 3, 1), 10000)));

        BillingException thrown = assertThrows(BillingException.class, () -> service.bill(
                subscription("2026-01-01", "2027-01-01", CNY),
                MonthCycle.of(YearMonth.of(2026, 2)),
                rates));

        assertEquals(BillingException.RATE_MISSING, thrown.code());
    }

    @Test
    @DisplayName("确定性：相同输入必须产生逐字段相同的结果")
    void isDeterministic() {
        Subscription subscription = subscription("2026-02-05", "2027-01-01", CNY);
        MonthCycle cycle = MonthCycle.of(YearMonth.of(2026, 2));
        RateTable rates = flatRates(10000);

        Invoice first = service.bill(subscription, cycle, rates);
        Invoice second = service.bill(subscription, cycle, rates);

        assertEquals(first.items(), second.items());
        assertEquals(first.total(), second.total());
    }
}
