package dev.billflow.specguard;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 把一段实现绑定到规格里的验收标准编号上。
 *
 * <pre>
 *   &#64;Ac({"1.3", "1.4"})
 *   List&lt;LineItem&gt; prorate(...) { ... }
 * </pre>
 *
 * <p>它本身什么也不做 —— 真正干活的是 {@link SpecGuardProcessor}：编译时读取 {@code spec.md}，
 * 若这里写的编号在规格里不存在，**编译直接失败**。
 *
 * <p>为什么用 {@code RetentionPolicy.SOURCE}：这个标记只在编译期有意义，不该进入字节码。
 * 保留到 class 文件里会让它看起来像运行期元数据，从而引出"能不能反射读它"这类无用问题。
 */
@Documented
@Retention(RetentionPolicy.SOURCE)
@Target({
        ElementType.TYPE,
        ElementType.METHOD,
        ElementType.CONSTRUCTOR,
        ElementType.FIELD
})
public @interface Ac {

    /** 规格中的验收标准编号，例如 {@code "1.3"}。可写多个。 */
    String[] value();
}
