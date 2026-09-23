package dev.billflow.domain;

import dev.billflow.specguard.Ac;
import java.util.Collection;
import java.util.Currency;
import java.util.List;
import java.util.Objects;

/**
 * 金额：**最小货币单位的整数** + 币种。
 *
 * <p>规格 3.1 要求"以分为唯一单位、不得使用浮点"。这条在类型层面就体现为：
 * 这里只有 {@code long cents}，**没有任何接受小数或 double 的构造入口** ——
 * 想写错都写不出来。
 *
 * <p>这正是本案例的一个通用套路：<b>把规格要求编码进类型，而不是写在注释里。</b>
 * 注释会被忽略，类型不会被忽略。
 *
 * @param cents    金额（分）
 * @param currency 币种
 */
@Ac("3.1")
public record Money(long cents, Currency currency) implements Comparable<Money> {

    public Money {
        Objects.requireNonNull(currency, "currency");
    }

    public static Money of(long cents, Currency currency) {
        return new Money(cents, currency);
    }

    public static Money zero(Currency currency) {
        return new Money(0, currency);
    }

    /** 相加。币种不同直接拒绝（规格 3.2）—— 不换算、不猜测、不忽略。 */
    @Ac("3.2")
    public Money plus(Money other) {
        Objects.requireNonNull(other, "other");
        if (!currency.equals(other.currency)) {
            throw BillingException.currencyMismatch(
                    "不同币种的金额不能相加：" + currency.getCurrencyCode()
                            + " + " + other.currency.getCurrencyCode()
                            + "（本 MVP 不做汇率换算，见 ADR-003 的取舍记录）");
        }
        return new Money(Math.addExact(cents, other.cents), currency);
    }

    /** 求和。空集合返回该币种的 0。 */
    public static Money sum(Collection<Money> parts, Currency currency) {
        Money total = zero(currency);
        for (Money part : parts) {
            total = total.plus(part);
        }
        return total;
    }

    public static Money sumOfItems(List<LineItem> items, Currency currency) {
        long total = 0;
        for (LineItem item : items) {
            total = Math.addExact(total, item.cents());
        }
        return new Money(total, currency);
    }

    public boolean isNegative() {
        return cents < 0;
    }

    @Override
    public int compareTo(Money other) {
        if (!currency.equals(other.currency)) {
            throw BillingException.currencyMismatch("不能比较不同币种的金额");
        }
        return Long.compare(cents, other.cents);
    }

    /** 只用于日志与测试可读性；账单的正式输出格式不在本 MVP 范围内。 */
    @Override
    public String toString() {
        return cents + " 分 " + currency.getCurrencyCode();
    }
}
