package dev.billflow.domain;

/**
 * 领域错误：**用户输入或外部数据**不满足规格，带稳定错误码。
 *
 * <p>与 {@link IllegalStateException} 的分工必须严格区分：
 *
 * <ul>
 *   <li>{@code BillingException} = 输入世界的错（费率表重叠、日期区间非法、币种不一致）。
 *       它们在生产环境**会发生**，因此需要有稳定错误码供调用方判断与告警。</li>
 *   <li>{@code IllegalStateException} = 我们自己写错了（明细之和不等于总额）。
 *       它**不应该发生**；一旦发生就是 bug，没有"处理"一说，只有修。</li>
 * </ul>
 *
 * <p>混淆这两者会让系统出现"用错误码掩饰 bug"的代码：把不变量违背包装成一个可捕获的
 * 业务异常，于是它变成了"已知情况"，再也没人去修。
 */
public final class BillingException extends RuntimeException {

    /** 同一天出现两条费率版本（规格 2.2）。 */
    public static final String RATE_OVERLAP = "RATE_OVERLAP";
    /** 计费日期早于最早费率版本，且不允许回退（规格 2.3）。 */
    public static final String RATE_MISSING = "RATE_MISSING";
    /** 费率不是正整数分（规格 2.4）。 */
    public static final String INVALID_RATE = "INVALID_RATE";
    /** 两个金额币种不同（规格 3.2）。 */
    public static final String CURRENCY_MISMATCH = "CURRENCY_MISMATCH";
    /** 日期区间非法（规格 4.3、4.4）。 */
    public static final String INVALID_PERIOD = "INVALID_PERIOD";

    private final String code;

    private BillingException(String code, String detail) {
        // 关闭栈回溯与抑制：这是可预期的领域错误，不是崩溃现场。
        // 账单服务可能每秒处理大量输入，为每一个非法输入抓栈是不必要的开销。
        super(code + " · " + detail, null, false, false);
        this.code = code;
    }

    /** 稳定错误码。调用方按它分支，不要按 message 文案分支。 */
    public String code() {
        return code;
    }

    public static BillingException rateOverlap(String detail) {
        return new BillingException(RATE_OVERLAP, detail);
    }

    public static BillingException rateMissing(String detail) {
        return new BillingException(RATE_MISSING, detail);
    }

    public static BillingException invalidRate(String detail) {
        return new BillingException(INVALID_RATE, detail);
    }

    public static BillingException currencyMismatch(String detail) {
        return new BillingException(CURRENCY_MISMATCH, detail);
    }

    public static BillingException invalidPeriod(String detail) {
        return new BillingException(INVALID_PERIOD, detail);
    }
}
