package dev.billflow.domain;

import dev.billflow.specguard.Ac;
import java.time.LocalDate;
import java.util.Objects;

/**
 * 账单明细：某一天的金额，以及它**依据哪一版费率**算出来（规格 5.1）。
 *
 * <p>为什么要记录 {@code rateVersionId}：
 * 半年后有人问"这 357 分是怎么来的"，账面上必须能回答。没有它，唯一的手段是拿当时的
 * 费率表重算一遍 —— 而费率表会变，你可能连当时那一版都找不到了。
 *
 * @param day            该明细对应的日期
 * @param cents          金额（分），非负
 * @param rateVersionId  适用的费率版本标识
 */
@Ac("5.1")
public record LineItem(LocalDate day, long cents, String rateVersionId) {

    public LineItem {
        Objects.requireNonNull(day, "day");
        Objects.requireNonNull(rateVersionId, "rateVersionId");
        // 规格 3.3：明细金额不得为负。校验放在**产生这个值的地方**，
        // 而不是等到组装账单时 —— 错误离它的源头越近，定位成本越低。
        if (cents < 0) {
            throw new IllegalStateException("明细金额不得为负：" + day + " → " + cents + " 分");
        }
    }
}
