package dev.billflow.domain;

import dev.billflow.specguard.Ac;
import java.util.List;
import java.util.Objects;

/**
 * 账单：一个周期的全部明细与总额。
 *
 * <p><b>本类最重要的部分是构造器里的不变量校验</b>（规格 1.5、3.3、5.3）。
 * 它体现了本案例的核心主张之一：
 *
 * <blockquote>
 * 不变量应当在**构造时**强制，而不是在测试里检查。
 * </blockquote>
 *
 * <p>区别很实际：如果"Σ明细 == 总额"只写在测试里，那么任何新代码路径只要绕过那个测试，
 * 就能产出一张对不上的账单并流到用户手上；而放在构造器里，**这类账单根本无法被创建**。
 * 测试的覆盖是概率性的，不变量的强制是必然性的。
 *
 * <p>违反不变量抛 {@link IllegalStateException} 而不是 {@link BillingException} ——
 * 因为这不是"用户输入有问题"，而是"我们的算法写错了"，它没有可处理的业务分支，
 * 只有修（见 {@code BillingException} 的分工说明）。
 */
@Ac({"1.5", "3.3", "5.3"})
public record Invoice(MonthCycle cycle, List<LineItem> items, Money total) {

    public Invoice {
        Objects.requireNonNull(cycle, "cycle");
        Objects.requireNonNull(total, "total");
        items = List.copyOf(Objects.requireNonNull(items, "items"));

        // 规格 3.3：总额与明细都不得为负
        if (total.isNegative()) {
            throw new IllegalStateException("账单总额不得为负：" + total);
        }
        for (LineItem item : items) {
            if (item.cents() < 0) {
                throw new IllegalStateException("明细金额不得为负：" + item);
            }
        }

        // 规格 5.3：明细按日期升序，且连续无重复
        for (int i = 1; i < items.size(); i++) {
            LineItem previous = items.get(i - 1);
            LineItem current = items.get(i);
            if (!current.day().isAfter(previous.day())) {
                throw new IllegalStateException(
                        "明细必须按日期严格升序：第 " + (i - 1) + " 条是 " + previous.day()
                                + "，第 " + i + " 条是 " + current.day());
            }
            if (!current.day().equals(previous.day().plusDays(1))) {
                throw new IllegalStateException(
                        "明细日期必须连续：从 " + previous.day() + " 直接跳到 " + current.day());
            }
        }

        // 规格 1.5：不变量 Σ(明细) == 总额
        long sum = 0;
        for (LineItem item : items) {
            sum = Math.addExact(sum, item.cents());
        }
        if (sum != total.cents()) {
            long delta = total.cents() - sum;
            // 错误信息要能直接回答「差多少、哪边多」——排查这类问题时最需要的两个信息。
            // 只打印两个数字会逼着读日志的人自己算，而那正是容易出错的环节。
            throw new IllegalStateException(
                    "不变量被破坏：Σ明细 = " + sum + " 分，但账单总额 = " + total.cents() + " 分（差 "
                            + Math.abs(delta) + " 分，"
                            + (delta > 0 ? "总额大于明细合计" : "明细合计大于总额") + "）");
        }
    }

    /** 明细条数（规格 5.2）。 */
    @Ac("5.2")
    public int itemCount() {
        return items.size();
    }

    /** 是否为空账单（规格 1.6：无计费天数时的合法输出）。 */
    public boolean isEmpty() {
        return items.isEmpty();
    }
}
