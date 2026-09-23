package dev.billflow.domain;

import java.util.Currency;
import java.util.Objects;

/**
 * 订阅：一段生效区间 + 币种。
 *
 * <p>本 MVP 刻意只支持**有明确结束日**的订阅（规格 §6 待澄清第 1 条）。
 * 持续订阅（无结束日）在真实产品里很常见，但它会让"计费范围求交"的上界变成
 * "取决于今天是哪天" —— 那会让账单结果依赖运行时刻，违反"相同输入逐字节相同输出"。
 * 要支持它，正确做法是把"结算截止日"作为**显式输入**，而不是在内部读时钟。
 *
 * @param id          订阅标识
 * @param activeRange 订阅生效区间（半开）
 * @param currency    结算币种
 */
public record Subscription(String id, DateRange activeRange, Currency currency) {

    public Subscription {
        Objects.requireNonNull(id, "id");
        Objects.requireNonNull(activeRange, "activeRange");
        Objects.requireNonNull(currency, "currency");
    }
}
