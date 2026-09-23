package dev.billflow.domain;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.Currency;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("US3 · 金额与精度")
class MoneyTest {

    private static final Currency CNY = Currency.getInstance("CNY");
    private static final Currency USD = Currency.getInstance("USD");

    @Test
    @DisplayName("3.1 金额只有整数分，没有小数入口")
    void keepsAmountsAsIntegerCents() {
        Money money = Money.of(5000, CNY);

        assertEquals(5000L, money.cents());
        assertEquals(CNY, money.currency());

        // 规格 3.1 在类型层面就成立：下面这行写不出来（也编译不过）。
        //   Money.of(50.00, CNY);
        // 这就是"把约束编码进类型"与"把约束写进注释"的差别 ——
        // 注释会被忽略，类型不会。
    }

    @Test
    @DisplayName("3.2 不同币种相加被拒绝，错误码 CURRENCY_MISMATCH")
    void rejectsMixingCurrencies() {
        BillingException thrown = assertThrows(
                BillingException.class,
                () -> Money.of(100, CNY).plus(Money.of(100, USD)));

        assertEquals(BillingException.CURRENCY_MISMATCH, thrown.code());
    }

    @Test
    @DisplayName("3.2 求和同样逐项校验币种")
    void sumRejectsMixedCurrencies() {
        List<Money> parts = List.of(Money.of(100, CNY), Money.of(1, USD));

        BillingException thrown = assertThrows(
                BillingException.class, () -> Money.sum(parts, CNY));

        assertEquals(BillingException.CURRENCY_MISMATCH, thrown.code());
    }

    @Test
    @DisplayName("3.2 同币种求和正常")
    void sumsSameCurrency() {
        Money total = Money.sum(List.of(Money.of(4838, CNY), Money.of(7741, CNY)), CNY);

        assertEquals(12579L, total.cents());
    }

    @Test
    @DisplayName("金额溢出必须显式失败，而不是静默变成负数")
    void throwsOnOverflowInsteadOfSilentlyWrapping() {
        Money huge = Money.of(Long.MAX_VALUE, CNY);

        assertThrows(ArithmeticException.class, () -> huge.plus(Money.of(1, CNY)));
    }
}
