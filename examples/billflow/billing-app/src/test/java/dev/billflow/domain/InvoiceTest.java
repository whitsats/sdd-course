package dev.billflow.domain;

import static org.junit.jupiter.api.Assertions.assertEquals;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.LocalDate;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.Currency;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("US5 · 可追溯与账单不变量")
class InvoiceTest {

    private static final Currency CNY = Currency.getInstance("CNY");
    private static final MonthCycle FEB = MonthCycle.of(YearMonth.of(2026, 2));

    private static LineItem item(int day, long cents) {
        return new LineItem(LocalDate.of(2026, 2, day), cents, "R1");
    }

    private static List<LineItem> consecutiveItems(int fromDay, int count, long cents) {
        List<LineItem> items = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            items.add(item(fromDay + i, cents));
        }
        return items;
    }

    @Test
    @DisplayName("5.1 每条明细都带费率版本标识，且不可为空")
    void everyItemCarriesRateVersion() {
        Invoice invoice = new Invoice(FEB, consecutiveItems(1, 3, 100), Money.of(300, CNY));

        for (LineItem lineItem : invoice.items()) {
            assertEquals("R1", lineItem.rateVersionId());
        }
        assertThrows(NullPointerException.class, () -> new LineItem(LocalDate.of(2026, 2, 1), 1L, null));
    }

    @Test
    @DisplayName("5.2 账单记录周期、总额与明细条数")
    void exposesCycleTotalAndItemCount() {
        Invoice invoice = new Invoice(FEB, consecutiveItems(1, 4, 250), Money.of(1000, CNY));

        assertEquals(YearMonth.of(2026, 2), invoice.cycle().month());
        assertEquals(1000L, invoice.total().cents());
        assertEquals(4, invoice.itemCount());
    }

    @Test
    @DisplayName("5.3 明细必须按日期严格升序且连续")
    void rejectsOutOfOrderOrGappedItems() {
        IllegalStateException outOfOrder = assertThrows(IllegalStateException.class,
                () -> new Invoice(FEB, List.of(item(3, 100), item(2, 100)), Money.of(200, CNY)));
        assertTrue(outOfOrder.getMessage().contains("升序"));

        IllegalStateException gapped = assertThrows(IllegalStateException.class,
                () -> new Invoice(FEB, List.of(item(1, 100), item(3, 100)), Money.of(200, CNY)));
        assertTrue(gapped.getMessage().contains("连续"));
    }

    @Test
    @DisplayName("3.3 总额与明细金额都不得为负（校验在产生该值的地方）")
    void rejectsNegativeAmounts() {
        // 明细金额为负：在 LineItem 构造时就被拦住，而不是等到组装账单
        IllegalStateException negativeItem = assertThrows(IllegalStateException.class,
                () -> new LineItem(LocalDate.of(2026, 2, 1), -1L, "R1"));
        assertTrue(negativeItem.getMessage().contains("明细金额不得为负"));

        // 总额为负：即使明细全为正，也不允许
        IllegalStateException negativeTotal = assertThrows(IllegalStateException.class,
                () -> new Invoice(FEB, consecutiveItems(1, 2, 100), Money.of(-200, CNY)));
        assertTrue(negativeTotal.getMessage().contains("账单总额不得为负"));
    }

    @Test
    @DisplayName("1.5 Σ明细 ≠ 总额 → 构造即失败（不变量在构造时强制，而不是靠测试）")
    void rejectsInconsistentTotal() {
        IllegalStateException thrown = assertThrows(IllegalStateException.class,
                () -> new Invoice(FEB, consecutiveItems(1, 3, 100), Money.of(299, CNY)));

        assertTrue(thrown.getMessage().contains("不变量被破坏"));
        assertTrue(thrown.getMessage().contains("差 1 分"), "错误信息要直接说明差了多少：" + thrown.getMessage());
        // 这条测试本身就是本案例的核心主张：
        // 如果"Σ明细 == 总额"只写在测试里，任何绕过测试的新代码路径都能产出对不上的账单；
        // 放在构造器里，这类账单**根本无法被创建**。
    }

    @Test
    @DisplayName("1.6 空账单是合法输出（无计费天数时）")
    void allowsEmptyInvoice() {
        Invoice invoice = new Invoice(FEB, List.of(), Money.zero(CNY));

        assertTrue(invoice.isEmpty());
        assertEquals(0, invoice.itemCount());
        assertEquals(0L, invoice.total().cents());
    }
}
