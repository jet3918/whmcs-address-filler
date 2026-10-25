
// ==UserScript==
// @name         WHMCS 一键下单 (全路由自适应版 V2.5)
// @namespace    http://tampermonkey.net/
// @version      2.5
// @description  自动结账、智能支付方式优先级：支付宝 > Crypto > 银联 > 银行卡 > 银行转账 > PayPal
// @author       JET
// @match        *://*/*cart.php*
// @match        *://*/*order.php*
// @match        *://*/store/*
// @match        *://*/index.php/store/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    function generateString(length) {
        var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        var result = "";
        for (var i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    var isChinese = !!document.title.match(/[\u4E00-\u9FA5]/);
    var urlParams = new URLSearchParams(window.location.search);

    // ==========================================
    // 支付方式优先级
    // ==========================================

    // 数字越小，优先级越高
    var gatewayRules = [
        {
            priority: 1,
            name: "Alipay / 支付宝",
            keywords: ["alipay", "支付宝", "支付寶"]
        },
        {
            priority: 2,
            name: "Crypto / 加密货币",
            keywords: [
                "crypto", "cryptocurrency",
                "usdt", "btc", "bitcoin",
                "ethereum", "eth", "bnb",
                "trc-20", "trc20",
                "coin", "加密货币", "加密貨幣"
            ]
        },
        {
            priority: 3,
            name: "UnionPay / 银联",
            keywords: ["unionpay", "银联", "銀聯"]
        },
        {
            priority: 4,
            name: "Credit / Debit Card",
            keywords: [
                "credit/debit", "credit card",
                "debit card", "信用卡", "借记卡"
            ]
        },
        {
            priority: 5,
            name: "Bank Transfer",
            keywords: [
                "bank transfer", "stripe ach",
                "wire transfer", "银行转账",
                "銀行轉帳"
            ]
        },
        {
            priority: 6,
            name: "PayPal",
            keywords: [
                "paypal basic", "paypal subscription",
                "paypal", "one time", "one-time"
            ]
        }
    ];

    // ==========================================
    // 智能选择支付方式
    // ==========================================

    function selectPreferredGateway() {

        var candidates = [];

        // 只查找支付网关，不误选其他单选框
        var radios = jQuery(
            'input[type="radio"][name="paymentmethod"],' +
            'input[type="radio"][name="gateway"]'
        );

        radios.each(function () {

            var radio = jQuery(this);

            if (radio.prop("disabled")) return;

            var id = radio.attr("id");
            var value = radio.val() || "";

            var labelText = "";

            // 匹配 for 属性对应的 label
            if (id) {
                labelText += jQuery("label").filter(function () {
                    return jQuery(this).attr("for") === id;
                }).text() + " ";
            }

            // 匹配包裹 radio 的 label
            labelText += radio.closest("label").text() + " ";

            // WHMCS 常见支付方式容器
            var container = radio.closest(
                ".payment-method, .payment-method-option, " +
                ".gateway, .gateway-option, .radio-inline, .radio"
            );

            if (container.length) {
                labelText += container.text();
            }

            var searchText = (value + " " + labelText)
                .toLowerCase()
                .replace(/\s+/g, " ")
                .trim();

            var matchedRule = null;

            for (var i = 0; i < gatewayRules.length; i++) {
                var rule = gatewayRules[i];

                var matched = rule.keywords.some(function (keyword) {
                    return searchText.includes(keyword.toLowerCase());
                });

                if (matched) {
                    matchedRule = rule;
                    break;
                }
            }

            if (matchedRule) {
                candidates.push({
                    element: radio,
                    priority: matchedRule.priority,
                    name: matchedRule.name,
                    text: searchText
                });
            }
        });

        // 按优先级排序
        candidates.sort(function (a, b) {
            return a.priority - b.priority;
        });

        if (candidates.length === 0) {
            console.log("WHMCS：未识别支付方式，保留网站默认选择");
            return false;
        }

        var selected = candidates[0];
        var radio = selected.element;

        if (!radio.prop("checked")) {

            // 优先触发原生 radio 事件
            var nativeRadio = radio.get(0);

            if (nativeRadio) {
                nativeRadio.click();
            }

            // 兼容部分 WHMCS 自定义选择器
            if (!radio.prop("checked")) {
                var label = jQuery("label").filter(function () {
                    return jQuery(this).attr("for") === radio.attr("id");
                }).first();

                if (label.length) {
                    label.trigger("click");
                }
            }
        }

        console.log(
            "WHMCS：自动选择支付方式 → " +
            selected.name +
            "（优先级 " + selected.priority + "）"
        );

        return radio.prop("checked");
    }

    // ==========================================
    // 阶段 1：自动结账提交逻辑
    // ==========================================

    if (urlParams.get("a") === "checkout") {

        setTimeout(function () {

            // 自动勾选服务条款
            var tosLabel = isChinese ? "服務條款" : "Terms of Service";
            var tosElement = jQuery('label:contains("' + tosLabel + '")');

            if (tosElement.length) tosElement.click();

            var tosCheckbox = jQuery(
                "#iCheck-accepttos, input[name='accepttos']"
            );

            if (tosCheckbox.length && !tosCheckbox.prop("checked")) {
                tosCheckbox.click();
            }

            // 新增：按照优先级选择支付方式
            selectPreferredGateway();

            if (urlParams.get("f") === "ext") {

                var recaptcha = jQuery(".recaptcha-container").length;
                var turnstile = jQuery(".cf-turnstile").length;

                if (recaptcha || turnstile) {

                    if (recaptcha) {
                        jQuery(".recaptcha-container")
                            .get(0).scrollIntoView();
                    }

                    if (turnstile) {
                        jQuery(".cf-turnstile")
                            .get(0).scrollIntoView();
                    }

                } else {

                    var loadingMask = jQuery(
                        `<div style="
                            position: fixed;
                            top: 0;
                            bottom: 0;
                            left: 0;
                            right: 0;
                            z-index: 999999999;
                            background: rgba(0, 0, 0, 0.6);
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            color: white;
                            font-weight: bold;
                            height: 100vh;
                            width: 100vw;
                            font-size: 1.5rem;
                        ">
                            <i class="fa fas fa-spinner fa-spin fa-2x fa-fw"
                               style="margin-right:10px;"></i>
                            提交中...
                        </div>`
                    );

                    jQuery("body").append(loadingMask);

                    var finalSubmitBtn = jQuery(
                        "#checkout.btn-checkout, " +
                        "#btnCompleteOrder, " +
                        "button[name='checkout']"
                    ).last();

                    if (finalSubmitBtn.length) {
                        finalSubmitBtn.click();
                    }
                }
            }

        }, 500);

    // ==========================================
    // 阶段 2：插入按钮逻辑
    // ==========================================

    } else {

        var isClicked = false;
        var btnText = isChinese ? "一键下单" : "One Click Checkout";
        var loginTip = isChinese ? "登入后使用" : "Login to Use";

        var performQuickOrder = function (buttonElement) {

            if (isClicked) return;
            isClicked = true;

            jQuery(buttonElement).find("i")
                .removeClass()
                .addClass("fa fas fa-spinner fa-spin");

            var baseUrl = "";

            try {
                baseUrl = whmcsBaseUrl;
            } catch (e) {}

            var targetUrl = (baseUrl || "") + "/cart.php";

            var successRedirect = function () {
                window.location.href =
                    targetUrl + "?a=checkout&f=ext";
            };

            var configForm = jQuery("#frmConfigureProduct");

            if (configForm.length > 0) {

                var formData =
                    "a=confproduct&" + configForm.serialize();

                if (
                    window.WHMCS &&
                    window.WHMCS.http &&
                    window.WHMCS.http.jqClient
                ) {

                    WHMCS.http.jqClient
                        .post(targetUrl, "ajax=1&" + formData)
                        .done(successRedirect);

                } else {

                    jQuery.ajax({
                        type: "POST",
                        url: targetUrl,
                        data: "ajax=1&" + formData,
                        success: successRedirect
                    });
                }

            } else {
                successRedirect();
            }
        };

        var autoFillForm = function () {

            var hostname = jQuery("[name=hostname]");

            if (
                hostname.length &&
                !hostname.attr("readonly") &&
                hostname.val() === ""
            ) {
                hostname.val(
                    (location.hostname.split(".").reverse()[1] || "vps") +
                    "." + generateString(6)
                );
            }

            var rootpw = jQuery("[name=rootpw]");

            if (
                rootpw.length &&
                rootpw.attr("type") !== "hidden" &&
                !rootpw.attr("readonly") &&
                rootpw.val() === ""
            ) {
                rootpw.val(
                    window.WHMCS && window.WHMCS.utils
                        ? WHMCS.utils.generatePassword(12)
                        : generateString(12)
                );
            }

            jQuery("label[for^=customfield]").each(function () {
                jQuery(this).click();
            });
        };

        var injectButton = function () {

            if (jQuery("#btn-occ").length > 0) return;

            var nativeBtn = jQuery(
                "#checkout.btn-checkout, " +
                "#checkout, " +
                ".btn-checkout, " +
                "#btnCompleteProductConfig"
            ).last();

            if (nativeBtn.length === 0) {

                nativeBtn = jQuery("button.btn, a.btn")
                    .filter(function () {

                        var txt = jQuery(this).text().trim();

                        return (
                            txt.includes("继续") ||
                            txt.includes("Continue") ||
                            txt.includes("结账")
                        );

                    }).last();
            }

            if (nativeBtn.length === 0) return;

            var isLoggedIn =
                jQuery('a[href*="logout"]').length > 0 ||
                jQuery(".btn-active-client").length > 0;

            var btnContainer = jQuery(
                '<div class="text-center" ' +
                'style="margin-top:15px;width:100%;"></div>'
            );

            var nativeClasses =
                nativeBtn.attr("class") ||
                "btn btn-success btn-lg btn-block";

            nativeClasses = nativeClasses
                .replace("btn-primary", "btn-success")
                .replace("btn-default", "btn-success");

            var quickBtn = jQuery(
                `<button id="btn-occ" type="button"
                    class="${nativeClasses}"
                    style="width:100%;">
                    ${btnText}&nbsp;
                    <i class="fas fa-arrow-circle-right"></i>
                </button>`
            );

            var lockedBtn = jQuery(
                `<button id="btn-occ" type="button"
                    class="${nativeClasses} disabled"
                    data-toggle="tooltip"
                    data-placement="bottom"
                    title="${loginTip}"
                    style="width:100%;">
                    ${btnText}&nbsp;
                    <i class="fas fa-lock"></i>
                </button>`
            );

            quickBtn.on("click", function () {
                performQuickOrder(this);
            });

            if (isLoggedIn) {
                btnContainer.append(quickBtn);
            } else {
                lockedBtn.tooltip();
                btnContainer.append(lockedBtn);
            }

            autoFillForm();

            var wrapperDiv = nativeBtn.parent();

            if (
                wrapperDiv.hasClass("text-right") ||
                wrapperDiv.hasClass("text-center")
            ) {
                wrapperDiv.after(btnContainer);
            } else {
                nativeBtn.after(btnContainer);
            }

            console.log(
                "WHMCS 一键下单 V2.5：按钮已成功注入！"
            );
        };

        var observer = new MutationObserver(function () {

            if (jQuery("#btn-occ").length === 0) {
                injectButton();
            }

        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        jQuery(document).ready(function () {
            setTimeout(injectButton, 300);
        });
    }

})();
