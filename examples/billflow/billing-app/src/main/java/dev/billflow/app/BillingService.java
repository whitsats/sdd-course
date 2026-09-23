package dev.billflow.app;

import dev.billflow.domain.BillingException;
import dev.billflow.domain.DateRange;
import dev.billflow.domain.Invoice;
import dev.billflow.domain.LineItem;
import dev.billflow.domain.Money;
import dev.billflow.domain.MonthCycle;
import dev.billflow.domain.Proration;
import dev.billflow.domain.RateTable;
import dev.billflow.domain.Subscription;
import dev.billflow.specguard.Ac;
import java.util.List;
import java.util.Optional;

/**
 * 计费服务：把「订阅 + 账单周期 + 费率表」编排成一张账单。
 *
 * <p>这一层刻意非常薄 —— 它只做三件事：校验币种、求交、把明细交给领域层算。
 * 所有算法都在 {@code domain} 里。这么分的原因是可测性：
 * {@code BillingService} 的测试只需要验证"编排对不对"，
 * 而金额规则的正确性由领域层的测试与不变量保证，两边互不干扰。
 */
public final class BillingService {

    /**
     * 生成账单。
     *
     * @param subscription 订阅（提供生效区间与币种）
     * @param cycle        账单周期（一个自然月）
     * @param rates        费率表
     * @return 账单；订阅与周期无交集时返回**空账单**而不是报错（规格 1.6）
     */
    @Ac({"1.2", "1.6", "5.2"})
    public Invoice bill(Subscription subscription, MonthCycle cycle, RateTable rates) {
        // 规格 3.2：币种不一致直接拒绝。这里是唯一能发现它的地方 ——
        // 领域层只会算数字，不知道数字属于哪个币种。
        if (!rates.currency().equals(subscription.currency())) {
            throw BillingException.currencyMismatch(
                    "订阅币种 " + subscription.currency().getCurrencyCode()
                            + " 与费率表币种 " + rates.currency().getCurrencyCode() + " 不一致");
        }

        DateRange month = cycle.range();
        Optional<DateRange> covered = month.intersect(subscription.activeRange());

        // 规格 1.6：没有一天在计费范围内 → 空账单，总额 0，不报错。
        // 用 Optional 而不是"长度 0 的区间"，是因为空区间在类型上根本不合法（规格 4.3），
        // 强制调用方显式处理"没有交集"这一情形。
        if (covered.isEmpty()) {
            return new Invoice(cycle, List.of(), Money.zero(subscription.currency()));
        }

        List<LineItem> items = Proration.items(covered.get(), rates, cycle.daysInMonth());
        Money total = Money.sumOfItems(items, subscription.currency());
        return new Invoice(cycle, items, total);
    }
}
