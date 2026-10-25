// ==UserScript==
// @name         StockVPS 下单助手
// @namespace    StockVPS
// @version      1.0.0
// @author       StockVPS
// @description  WHMCS 自动生成并填充注册表单，支持 WHMCS 购物车一键下单，直达账单。
// @license      GPL-3.0-only
// @icon         https://stockvps.org/icon.svg
// @homepage     https://stockvps.org
// @match        *://*/*
// @connect      randomuser.me
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @run-at       document-start
// @downloadURL https://update.greasyfork.org/scripts/588076/StockVPS%20%E4%B8%8B%E5%8D%95%E5%8A%A9%E6%89%8B.user.js
// @updateURL https://update.greasyfork.org/scripts/588076/StockVPS%20%E4%B8%8B%E5%8D%95%E5%8A%A9%E6%89%8B.meta.js
// ==/UserScript==

(function() {
  'use strict';
	var _GM_getValue = typeof GM_getValue != "undefined" ? GM_getValue : void 0;
	var _GM_setValue = typeof GM_setValue != "undefined" ? GM_setValue : void 0;
	var _GM_xmlhttpRequest = typeof GM_xmlhttpRequest != "undefined" ? GM_xmlhttpRequest : void 0;
	var CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	function generateRandomString(length) {
		return Array.from({ length }, () => CHARS[Math.floor(Math.random() * 62)]).join("");
	}
	function isChineseText(text) {
		return /[\u2E80-\u2E99\u2E9B-\u2EF3\u2F00-\u2FD5\u3005\u3007\u3021-\u3029\u3038-\u303B\u3400-\u4DB5\u4E00-\u9FD5\uF900-\uFA6D\uFA70-\uFAD9]/.test(text);
	}
	var _pageIsChineseMemo;
	function pageIsChinese() {
		if (_pageIsChineseMemo === void 0) _pageIsChineseMemo = isChineseText(document.title);
		return _pageIsChineseMemo;
	}
	function waitForReady() {
		return new Promise((resolve) => {
			if (document.readyState !== "loading") resolve();
			else document.addEventListener("DOMContentLoaded", () => resolve());
		});
	}
	function getWhmcsBaseUrl() {
		try {
			return window.whmcsBaseUrl || "";
		} catch {
			return "";
		}
	}
	function getParam(name) {
		return new URLSearchParams(window.location.search).get(name);
	}
	function escapeHtml(str) {
		if (typeof str !== "string") return String(str);
		return str.replace(/[&<>"']/g, (match) => {
			return {
				"&": "&amp;",
				"<": "&lt;",
				">": "&gt;",
				"\"": "&quot;",
				"'": "&#39;"
			}[match];
		});
	}
	function debounce(fn, delay) {
		let timer = null;
		return function(...args) {
			if (timer) clearTimeout(timer);
			timer = setTimeout(() => {
				fn.apply(this, args);
				timer = null;
			}, delay);
		};
	}
	function getRootDomain(hostname = window.location.hostname) {
		if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return hostname;
		const parts = hostname.split(".");
		if (parts.length <= 2) return hostname;
		const ccSldReg = /^(com|co|net|org|gov|edu|mil)\.[a-z]{2}$/i;
		const lastTwo = parts.slice(-2).join(".");
		if (ccSldReg.test(lastTwo)) return parts.slice(-3).join(".");
		return lastTwo;
	}
	var PAYMENT_METHODS = [
		{
			label: "Alipay",
			selector: ":contains(\"Alipay\")"
		},
		{
			label: "支付宝",
			selector: ":contains(\"支付宝\")"
		},
		{
			label: "银联",
			selector: ":contains(\"银联\")"
		},
		{
			label: "Crypto",
			selector: ":contains(\"Crypto\")"
		},
		{
			label: "PayPal Basic",
			selector: ":contains(\"PayPal Basic\")"
		},
		{
			label: "PayPal",
			selector: ":contains(\"PayPal\")"
		},
		{
			label: "Stripe",
			selector: ":contains(\"Stripe\")"
		},
		{
			label: "Credit Card",
			selector: ":contains(\"Credit Card\")"
		},
		{
			label: "Credit/Debit Card",
			selector: ":contains(\"Credit/Debit Card\")"
		},
		{
			label: "Unionpay",
			selector: ":contains(\"Unionpay\")"
		},
		{
			label: "Bank Transfer",
			selector: ":contains(\"Bank Transfer\")"
		},
		{
			label: "Wire Transfer",
			selector: ":contains(\"Wire Transfer\")"
		}
	];
	var DEFAULT_FIELDS = [
		{
			name: "hostname",
			defaultValue: () => {
				const domain = getRootDomain();
				return `${generateRandomString(6).toLowerCase()}.${domain}`;
			},
			condition: (input) => !input.readOnly
		},
		{
			name: "ns1prefix",
			defaultValue: "ns1",
			condition: (input) => input.type !== "hidden"
		},
		{
			name: "ns2prefix",
			defaultValue: "ns2",
			condition: (input) => input.type !== "hidden"
		},
		{
			name: "rootpw",
			defaultValue: () => {
				try {
					return window.WHMCS?.utils?.generatePassword?.(16) || generateRandomString(16);
				} catch {
					return generateRandomString(16);
				}
			},
			condition: (input) => input.type !== "hidden" && !input.readOnly
		}
	];
	var CONFIG_KEYS = {
		SELECTED_COUNTRY: "selected_country",
		FORCE_SHOW_BUTTON: "force_show_button"
	};
	var DEFAULT_CONFIG = {
		[CONFIG_KEYS.SELECTED_COUNTRY]: "US",
		[CONFIG_KEYS.FORCE_SHOW_BUTTON]: false
	};
	var SESSION_KEYS = { QUICK_CHECKOUT: "stockvps_quick_checkout" };
	var ELEMENT_IDS = {
		OCC_BTN: "stockvps-btn-occ",
		RANDOM_USER_BTN: "stockvps-random-user-btn",
		RANDOM_USER_PANEL: "stockvps-random-user-panel"
	};
	var _shadowRoot = null;
	function getShadowRoot() {
		if (_shadowRoot) return _shadowRoot;
		const host = document.createElement("div");
		host.id = "stockvps-shadow-host";
		host.setAttribute("style", [
			"position: fixed",
			"top: 0",
			"left: 0",
			"width: 0",
			"height: 0",
			"overflow: visible",
			"pointer-events: none",
			"z-index: 2147483647",
			"border: none",
			"margin: 0",
			"padding: 0",
			"background: transparent",
			"display: block"
		].join("; "));
		_shadowRoot = host.attachShadow({ mode: "open" });
		document.body.appendChild(host);
		return _shadowRoot;
	}
	var COLORS = {
		background: "#ffffff",
		foreground: "#09090b",
		primary: "#18181b",
		primaryForeground: "#fafafa",
		secondary: "#f4f4f5",
		secondaryForeground: "#18181b",
		muted: "#f4f4f5",
		mutedForeground: "#71717a",
		border: "#e4e4e7",
		input: "#e4e4e7",
		ring: "#18181b",
		destructive: "#ef4444",
		destructiveForeground: "#fafafa",
		success: "#22c55e",
		warning: "#f59e0b",
		info: "#3b82f6"
	};
	var SHADOWS = {
		sm: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
		md: "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
		lg: "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)",
		xl: "0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)"
	};
	function injectStyles(target = getShadowRoot()) {
		if (target.querySelector("#stockvps-styles")) return;
		const style = document.createElement("style");
		style.id = "stockvps-styles";
		style.textContent = `
    :host {
      all: initial;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      color: #09090b;
      text-align: left;
      text-transform: none;
    }
    *, *::before, *::after {
      box-sizing: border-box;
    }

    /* 基础动画 */
    @keyframes stockvps-spin {
      to { transform: rotate(360deg); }
    }
    @keyframes stockvps-in {
      from { opacity: 0; transform: translateY(-4px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes stockvps-out {
      from { opacity: 1; transform: translateY(0); }
      to { opacity: 0; transform: translateY(-4px); }
    }
    @keyframes stockvps-slide-in-right {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    @keyframes stockvps-slide-out-right {
      from { transform: translateX(0); opacity: 1; }
      to { transform: translateX(100%); opacity: 0; }
    }
    @keyframes stockvps-toast-in {
      from { transform: translateY(-20px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
    @keyframes stockvps-toast-out {
      from { transform: translateY(0); opacity: 1; }
      to { transform: translateY(-20px); opacity: 0; }
    }

    /* 按钮基础样式 */
    .stockvps-btn {
      all: unset;
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      white-space: nowrap;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      line-height: 1;
      transition: all 150ms cubic-bezier(0.4, 0, 0.2, 1);
      outline: none;
      cursor: pointer;
      user-select: none;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .stockvps-btn svg {
      width: 16px;
      height: 16px;
      flex-shrink: 0;
    }
    .stockvps-btn:focus-visible {
      box-shadow: 0 0 0 2px ${COLORS.background}, 0 0 0 4px ${COLORS.ring};
    }
    .stockvps-btn:disabled {
      pointer-events: none;
      opacity: 0.5;
    }

    /* Primary 按钮 */
    .stockvps-btn-primary {
      background-color: ${COLORS.primary};
      color: ${COLORS.primaryForeground};
      border: 1px solid ${COLORS.primary};
      padding: 9px 17px;
    }
    .stockvps-btn-primary:hover {
      background-color: ${COLORS.primary}dd;
    }
    .stockvps-btn-primary:active {
      background-color: ${COLORS.primary}cc;
    }

    /* Secondary 按钮 */
    .stockvps-btn-secondary {
      background-color: ${COLORS.secondary};
      color: ${COLORS.secondaryForeground};
      border: 1px solid ${COLORS.border};
      padding: 9px 17px;
    }
    .stockvps-btn-secondary:hover {
      background-color: ${COLORS.secondary}cc;
    }

    /* Outline 按钮 */
    .stockvps-btn-outline {
      background-color: transparent;
      color: ${COLORS.foreground};
      border: 1px solid ${COLORS.border};
      padding: 9px 17px;
    }
    .stockvps-btn-outline:hover {
      background-color: ${COLORS.secondary};
    }

    /* Ghost 按钮 */
    .stockvps-btn-ghost {
      background-color: transparent;
      color: ${COLORS.foreground};
      border: 1px solid transparent;
      padding: 9px 17px;
    }
    .stockvps-btn-ghost:hover {
      background-color: ${COLORS.secondary};
    }

    /* 图标按钮 */
    .stockvps-btn-icon {
      padding: 9px;
    }

    /* 加载动画 */
    .stockvps-spinner {
      width: 16px;
      height: 16px;
      border: 2px solid currentColor;
      border-right-color: transparent;
      border-radius: 50%;
      animation: stockvps-spin 0.6s linear infinite;
      opacity: 0.6;
    }

    /* Toast 容器 */
    .stockvps-toast-container {
      position: fixed;
      top: 16px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 999999;
      display: flex;
      flex-direction: column;
      gap: 8px;
      align-items: center;
      pointer-events: none;
    }

    /* Toast 样式 */
    .stockvps-toast {
      box-sizing: border-box;
      pointer-events: auto;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 16px;
      border-radius: 6px;
      border: 1px solid ${COLORS.border};
      background: ${COLORS.background};
      box-shadow: ${SHADOWS.xl};
      font-size: 14px;
      color: ${COLORS.foreground};
      max-width: 420px;
      width: max-content;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      animation: stockvps-toast-in 200ms ease-out forwards;
    }
    .stockvps-toast.stockvps-toast-exit {
      animation: stockvps-toast-out 150ms ease-in forwards;
    }

    /* Toast 图标 */
    .stockvps-toast-icon {
      flex-shrink: 0;
      width: 18px;
      height: 18px;
    }

    /* Toast 内容 */
    .stockvps-toast-content {
      flex: 1;
      font-size: 14px;
      line-height: 1.5;
    }

    /* Toast 关闭按钮 */
    .stockvps-toast-close {
      all: unset;
      box-sizing: border-box;
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      border-radius: 4px;
      border: none;
      background: transparent;
      color: ${COLORS.mutedForeground};
      cursor: pointer;
      transition: all 150ms;
    }
    .stockvps-toast-close:hover {
      background: ${COLORS.secondary};
      color: ${COLORS.foreground};
    }

    /* 遮罩层 */
    .stockvps-overlay {
      box-sizing: border-box;
      position: fixed;
      inset: 0;
      z-index: 999999;
      background: rgba(0, 0, 0, 0.8);
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      animation: stockvps-in 150ms ease-out;
    }

    /* 遮罩层内容卡片 */
    .stockvps-overlay-card {
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
      padding: 24px;
      background: ${COLORS.background};
      border: 1px solid ${COLORS.border};
      border-radius: 8px;
      box-shadow: ${SHADOWS.lg};
      animation: stockvps-in 200ms ease-out;
    }

    /* 遮罩层文字 */
    .stockvps-overlay-text {
      box-sizing: border-box;
      font-size: 14px;
      font-weight: 500;
      color: ${COLORS.foreground};
    }

    /* Badge 样式 */
    .stockvps-badge {
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      padding: 2px 10px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 500;
      line-height: 1;
      transition: all 150ms;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .stockvps-badge-success {
      background: ${COLORS.success}1a;
      color: ${COLORS.success};
      border: 1px solid ${COLORS.success}33;
    }
    .stockvps-badge-warning {
      background: ${COLORS.warning}1a;
      color: ${COLORS.warning};
      border: 1px solid ${COLORS.warning}33;
    }
    .stockvps-badge-error {
      background: ${COLORS.destructive}1a;
      color: ${COLORS.destructive};
      border: 1px solid ${COLORS.destructive}33;
    }
    .stockvps-badge-info {
      background: ${COLORS.info}1a;
      color: ${COLORS.info};
      border: 1px solid ${COLORS.info}33;
    }

    /* 分隔线 */
    .stockvps-separator {
      box-sizing: border-box;
      height: 1px;
      width: 100%;
      background: ${COLORS.border};
      margin: 12px 0;
    }
  `;
		target.appendChild(style);
	}
	function createIcon(name) {
		return {
			"check-circle": "<svg width=\"16\" height=\"16\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M22 11.08V12a10 10 0 1 1-5.93-9.14\"/><polyline points=\"22 4 12 14.01 9 11.01\"/></svg>",
			"info": "<svg width=\"16\" height=\"16\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"12\" r=\"10\"/><line x1=\"12\" y1=\"16\" x2=\"12\" y2=\"12\"/><line x1=\"12\" y1=\"8\" x2=\"12.01\" y2=\"8\"/></svg>",
			"alert-triangle": "<svg width=\"16\" height=\"16\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z\"/><line x1=\"12\" y1=\"9\" x2=\"12\" y2=\"13\"/><line x1=\"12\" y1=\"17\" x2=\"12.01\" y2=\"17\"/></svg>",
			"x-circle": "<svg width=\"16\" height=\"16\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"12\" r=\"10\"/><line x1=\"15\" y1=\"9\" x2=\"9\" y2=\"15\"/><line x1=\"9\" y1=\"9\" x2=\"15\" y2=\"15\"/></svg>",
			"x": "<svg width=\"16\" height=\"16\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><line x1=\"18\" y1=\"6\" x2=\"6\" y2=\"18\"/><line x1=\"6\" y1=\"6\" x2=\"18\" y2=\"18\"/></svg>",
			"zap": "<svg width=\"16\" height=\"16\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><polygon points=\"13 2 3 14 12 14 11 22 21 10 12 10 13 2\"/></svg>",
			"lock": "<svg width=\"16\" height=\"16\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect width=\"18\" height=\"11\" x=\"3\" y=\"11\" rx=\"2\" ry=\"2\"/><path d=\"M7 11V7a5 5 0 0 1 10 0v4\"/></svg>",
			"loader": "<svg width=\"16\" height=\"16\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><line x1=\"12\" y1=\"2\" x2=\"12\" y2=\"6\"/><line x1=\"12\" y1=\"18\" x2=\"12\" y2=\"22\"/><line x1=\"4.93\" y1=\"4.93\" x2=\"7.76\" y2=\"7.76\"/><line x1=\"16.24\" y1=\"16.24\" x2=\"19.07\" y2=\"19.07\"/><line x1=\"2\" y1=\"12\" x2=\"6\" y2=\"12\"/><line x1=\"18\" y1=\"12\" x2=\"22\" y2=\"12\"/><line x1=\"4.93\" y1=\"19.07\" x2=\"7.76\" y2=\"16.24\"/><line x1=\"16.24\" y1=\"7.76\" x2=\"19.07\" y2=\"4.93\"/></svg>"
		}[name] || "";
	}
	function showToast(message, type = "info", duration = 3e3) {
		injectStyles();
		const shadow = getShadowRoot();
		let container = shadow.querySelector(".stockvps-toast-container");
		if (!container) {
			container = document.createElement("div");
			container.className = "stockvps-toast-container";
			shadow.appendChild(container);
		}
		const iconMap = {
			success: "check-circle",
			info: "info",
			warning: "alert-triangle",
			error: "x-circle"
		};
		const colorMap = {
			success: COLORS.success,
			info: COLORS.info,
			warning: COLORS.warning,
			error: COLORS.destructive
		};
		const toast = document.createElement("div");
		toast.className = "stockvps-toast";
		toast.innerHTML = `
    <span class="stockvps-toast-icon" style="color: ${colorMap[type]}">
      ${createIcon(iconMap[type])}
    </span>
    <span class="stockvps-toast-content">${escapeHtml(message)}</span>
    <button class="stockvps-toast-close">
      ${createIcon("x")}
    </button>
  `;
		const removeToast = () => {
			toast.remove();
			if (container && container.childElementCount === 0) container.remove();
		};
		toast.querySelector(".stockvps-toast-close")?.addEventListener("click", () => {
			toast.classList.add("stockvps-toast-exit");
			setTimeout(removeToast, 150);
		});
		container.appendChild(toast);
		setTimeout(() => {
			if (toast.parentNode) {
				toast.classList.add("stockvps-toast-exit");
				setTimeout(removeToast, 150);
			}
		}, duration);
	}
	function createOneClickButton() {
		const container = document.createElement("div");
		container.id = "stockvps-btn-occ";
		container.style.cssText = "margin: 16px 0; text-align: center; display: block;";
		const shadow = container.attachShadow({ mode: "open" });
		injectStyles(shadow);
		const btnText = isChineseText(document.title) ? "一键下单" : "One Click Checkout";
		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = "stockvps-btn stockvps-btn-primary";
		btn.innerHTML = `
    ${createIcon("zap")}
    <span>${btnText}</span>
  `;
		shadow.appendChild(btn);
		return container;
	}
	function setButtonLoading(btn, loading) {
		const icon = btn.querySelector("svg");
		const text = btn.querySelector("span");
		if (!icon && !loading) return;
		if (loading) {
			btn.disabled = true;
			btn.style.opacity = "0.7";
			const iconContainer = btn.querySelector("span:first-child, svg:first-child");
			if (iconContainer) {
				const spinner = document.createElement("span");
				spinner.className = "stockvps-spinner";
				iconContainer.replaceWith(spinner);
			}
			if (text) text.textContent = isChineseText(document.title) ? "提交中…" : "Submitting...";
		} else {
			btn.disabled = false;
			btn.style.opacity = "1";
			const spinner = btn.querySelector(".stockvps-spinner");
			if (spinner) {
				const newIcon = document.createElement("span");
				newIcon.innerHTML = createIcon("zap");
				spinner.replaceWith(newIcon.firstElementChild);
			}
			if (text) text.textContent = isChineseText(document.title) ? "一键下单" : "One Click Checkout";
		}
	}
	function insertButton(container) {
		for (const selector of [
			"#orderSummary .panel-footer",
			"#orderSummary .order-summary-actions",
			"#orderSummary .order-summary",
			"#orderSummary .summary-container"
		]) {
			const target = document.querySelector(selector);
			if (target) {
				if (selector.includes("order-summary-actions")) target.prepend(container);
				else target.appendChild(container);
				`${selector}`;
				showToast(isChineseText(document.title) ? "一键下单按钮已就绪" : "One Click Checkout button ready", "success");
				return;
			}
		}
	}
	function showOverlay(text) {
		injectStyles();
		const overlay = document.createElement("div");
		overlay.className = "stockvps-overlay";
		overlay.innerHTML = `
    <div class="stockvps-overlay-card">
      <span class="stockvps-spinner" style="width: 24px; height: 24px; border-width: 3px;"></span>
      <span class="stockvps-overlay-text">${escapeHtml(text)}${isChineseText(text) ? "…" : "..."}</span>
    </div>
  `;
		getShadowRoot().appendChild(overlay);
	}
	function getConfig(key, defaultValue) {
		try {
			return _GM_getValue(key, defaultValue);
		} catch {
			return defaultValue;
		}
	}
	function setConfig(key, value) {
		try {
			_GM_setValue(key, value);
			`${key}${value}`;
		} catch (err) {
			`${key}`;
		}
	}
	function getSavedCountry() {
		return getConfig(CONFIG_KEYS.SELECTED_COUNTRY, DEFAULT_CONFIG[CONFIG_KEYS.SELECTED_COUNTRY]);
	}
	function saveCountry(country) {
		setConfig(CONFIG_KEYS.SELECTED_COUNTRY, country);
	}
	function getForceShowButton() {
		return getConfig(CONFIG_KEYS.FORCE_SHOW_BUTTON, DEFAULT_CONFIG[CONFIG_KEYS.FORCE_SHOW_BUTTON]);
	}
	var COUNTRY_NAMES = {
		"AU": "澳大利亚",
		"BR": "巴西",
		"CA": "加拿大",
		"CH": "瑞士",
		"DE": "德国",
		"DK": "丹麦",
		"ES": "西班牙",
		"FI": "芬兰",
		"FR": "法国",
		"GB": "英国",
		"IE": "爱尔兰",
		"IN": "印度",
		"IR": "伊朗",
		"MX": "墨西哥",
		"NL": "荷兰",
		"NO": "挪威",
		"NZ": "新西兰",
		"RS": "塞尔维亚",
		"TR": "土耳其",
		"UA": "乌克兰",
		"US": "美国"
	};
	var COUNTRY_PHONE_CODES = {
		"AU": "+61",
		"BR": "+55",
		"CA": "+1",
		"CH": "+41",
		"DE": "+49",
		"DK": "+45",
		"ES": "+34",
		"FI": "+358",
		"FR": "+33",
		"GB": "+44",
		"IE": "+353",
		"IN": "+91",
		"IR": "+98",
		"MX": "+52",
		"NL": "+31",
		"NO": "+47",
		"NZ": "+64",
		"RS": "+381",
		"TR": "+90",
		"UA": "+380",
		"US": "+1"
	};
	var FIELD_MAPPINGS = {
		firstName: [
			"firstname",
			"first_name",
			"first-name",
			"fname",
			"given_name",
			"givenname"
		],
		lastName: [
			"lastname",
			"last_name",
			"last-name",
			"lname",
			"surname",
			"family_name",
			"familyname"
		],
		fullName: [
			"fullname",
			"full_name",
			"full-name",
			"name",
			"username",
			"user_name",
			"user-name"
		],
		phone: [
			"phone",
			"phonenumber",
			"phone_number",
			"phone-number",
			"tel",
			"telephone",
			"mobile",
			"cell"
		],
		address: [
			"address",
			"street",
			"streetaddress",
			"street_address",
			"street-address",
			"address1",
			"addr1"
		],
		city: [
			"city",
			"town",
			"locality"
		],
		state: [
			"state",
			"province",
			"region",
			"stateprovince",
			"state_province",
			"state-province"
		],
		postcode: [
			"postcode",
			"zipcode",
			"zip",
			"postal",
			"postalcode",
			"postal_code",
			"postal-code",
			"zip_code"
		],
		country: [
			"country",
			"nation",
			"nationality"
		],
		gender: ["gender", "sex"]
	};
	var currentUserData = null;
	var FORM_EVENTS = [
		"input",
		"change",
		"blur",
		"keyup"
	];
	function getInputAttrs(input) {
		return [
			input.name,
			input.id,
			input.getAttribute("placeholder"),
			input.className,
			input.getAttribute("data-field"),
			input.getAttribute("autocomplete")
		].filter(Boolean).join(" ").toLowerCase();
	}
	function generateUserData(countryCode) {
		return new Promise((resolve, reject) => {
			`${countryCode}`;
			_GM_xmlhttpRequest({
				method: "GET",
				url: `https://randomuser.me/api/?nat=${countryCode}&inc=name,location,phone,cell,dob,gender`,
				onload: function(response) {
					try {
						const data = JSON.parse(response.responseText);
						if (data.results && data.results.length > 0) {
							const user = data.results[0];
							user.formattedPhone = (COUNTRY_PHONE_CODES[countryCode] || "") + (user.phone || user.cell).replace(/[^\d]/g, "");
							currentUserData = user;
							resolve(user);
						} else reject(new Error("API未返回有效用户数据"));
					} catch (error) {
						reject(error);
					}
				},
				onerror: function(error) {
					reject(new Error("网络请求失败"));
				}
			});
		});
	}
	function findInputFields() {
		const inputs = document.querySelectorAll("input[type=\"text\"], input[type=\"tel\"], input[type=\"email\"], input:not([type]), select, textarea");
		const fields = {};
		for (const [fieldType, patterns] of Object.entries(FIELD_MAPPINGS)) {
			if (fields[fieldType]) continue;
			for (const input of inputs) {
				const attrs = getInputAttrs(input);
				const label = input.closest("label") || input.id && document.querySelector(`label[for="${input.id}"]`);
				const allText = `${attrs} ${label ? label.textContent?.toLowerCase() : ""}`;
				if (fieldType !== "fullName" && fieldType !== "firstName" && fieldType !== "lastName") {
					if (input.type === "email" || input.type === "password" || allText.includes("email") || allText.includes("password")) continue;
				}
				for (const pattern of patterns) if (allText.includes(pattern)) {
					fields[fieldType] = input;
					break;
				}
				if (fields[fieldType]) break;
			}
		}
		return fields;
	}
	function setFieldValue(element, value) {
		if (!element || typeof value === "undefined") return false;
		element.focus();
		if (element.tagName.toLowerCase() === "select") {
			const selectEl = element;
			const valLower = value.toLowerCase();
			let found = false;
			for (const opt of Array.from(selectEl.options)) if (opt.value.toLowerCase() === valLower || opt.textContent?.toLowerCase() === valLower) {
				selectEl.value = opt.value;
				found = true;
				break;
			}
			if (!found) {
				for (const opt of Array.from(selectEl.options)) if (opt.textContent?.toLowerCase().includes(valLower)) {
					selectEl.value = opt.value;
					found = true;
					break;
				}
			}
			if (!found) return false;
		} else element.value = value;
		FORM_EVENTS.forEach((e) => element.dispatchEvent(new Event(e, {
			bubbles: true,
			cancelable: true
		})));
		element.style.backgroundColor = "#e8f5e8";
		setTimeout(() => {
			element.style.backgroundColor = "";
		}, 1500);
		return true;
	}
	function fillForm() {
		if (!currentUserData) {
			showToast("请先生成用户信息", "error");
			return 0;
		}
		const fieldsToFill = findInputFields();
		const user = currentUserData;
		let filledCount = 0;
		if (fieldsToFill.firstName && fieldsToFill.lastName) delete fieldsToFill.fullName;
		const fillData = {
			firstName: user.name.first,
			lastName: user.name.last,
			fullName: `${user.name.first} ${user.name.last}`,
			phone: user.formattedPhone,
			address: `${user.location.street.number} ${user.location.street.name}`,
			city: user.location.city,
			state: user.location.state,
			postcode: user.location.postcode.toString(),
			country: user.location.country,
			gender: user.gender
		};
		const countryField = fieldsToFill.country;
		const stateField = fieldsToFill.state;
		if (countryField && stateField && stateField.tagName.toLowerCase() === "select") {
			if (setFieldValue(countryField, fillData.country)) filledCount++;
			const stateSelect = stateField;
			const stateName = fillData.state;
			if (setFieldValue(stateSelect, stateName)) filledCount++;
			else {
				const observer = new MutationObserver((_, obs) => {
					if (setFieldValue(stateSelect, stateName)) {
						filledCount++;
						obs.disconnect();
					}
				});
				observer.observe(stateSelect, { childList: true });
				setTimeout(() => observer.disconnect(), 3e3);
			}
			delete fieldsToFill.country;
			delete fieldsToFill.state;
		}
		for (const fieldType in fieldsToFill) if (fieldsToFill[fieldType] && setFieldValue(fieldsToFill[fieldType], fillData[fieldType])) filledCount++;
		return filledCount;
	}
	function clearForm() {
		const inputs = document.querySelectorAll("input[type=\"text\"], input[type=\"tel\"], input:not([type]), select, textarea");
		let clearedCount = 0;
		inputs.forEach((input) => {
			const attrs = getInputAttrs(input);
			if (input.type === "email" || input.type === "password" || attrs.includes("email") || attrs.includes("password")) return;
			if (input.value.trim() !== "" || input.tagName === "SELECT" && input.selectedIndex > 0) {
				input.value = input.tagName === "SELECT" ? input.options[0].value : "";
				FORM_EVENTS.forEach((e) => input.dispatchEvent(new Event(e, { bubbles: true })));
				input.style.backgroundColor = "#ffe8e8";
				setTimeout(() => {
					input.style.backgroundColor = "";
				}, 500);
				clearedCount++;
			}
		});
		return clearedCount;
	}
	function shouldShowButton() {
		if (getForceShowButton()) return true;
		return Object.keys(findInputFields()).length >= 4;
	}
	var isPanelVisible = false;
	function getGenerateBtnHTML(hasChinese) {
		return `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
    </svg>
    ${hasChinese ? "生成用户信息" : "Generate User"}
  `;
	}
	function injectRandomUserStyles() {
		injectStyles();
		const shadow = getShadowRoot();
		if (shadow.querySelector("#stockvps-random-user-styles")) return;
		const style = document.createElement("style");
		style.id = "stockvps-random-user-styles";
		style.textContent = `
    :host {
      all: initial;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      color: #09090b;
      text-align: left;
      text-transform: none;
    }
    *, *::before, *::after {
      box-sizing: border-box;
    }

    /* 随机用户浮动按钮 */
    button#${ELEMENT_IDS.RANDOM_USER_BTN}.stockvps-float-btn {
      all: unset;
      box-sizing: border-box;
      position: fixed;
      top: 50px;
      right: 16px;
      z-index: 2147483647;
      display: none;
      align-items: center;
      gap: 6px;
      padding: 8px 14px;
      background: #18181b;
      color: #fafafa;
      border: 2px solid #fafafa;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      pointer-events: auto;
      transition: all 150ms cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    button#${ELEMENT_IDS.RANDOM_USER_BTN}.stockvps-float-btn:focus {
      outline: none;
    }
    button#${ELEMENT_IDS.RANDOM_USER_BTN}.stockvps-float-btn:hover {
      background: #18181bdd;
    }
    button#${ELEMENT_IDS.RANDOM_USER_BTN}.stockvps-float-btn svg {
      width: 14px;
      height: 14px;
      flex-shrink: 0;
    }

    /* 随机用户面板 */
    div#${ELEMENT_IDS.RANDOM_USER_PANEL}.stockvps-user-panel {
      box-sizing: border-box;
      position: fixed;
      top: 100px;
      right: 16px;
      z-index: 2147483647;
      width: 280px;
      background: #ffffff;
      border: 1px solid #e4e4e7;
      border-radius: 8px;
      box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);
      display: none;
      font-size: 14px;
      color: #09090b;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      animation: stockvps-user-in 150ms ease-out;
      overflow: hidden;
      pointer-events: auto;
    }

    @keyframes stockvps-user-in {
      from { opacity: 0; transform: translateY(-4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* 面板内容 */
    .stockvps-user-panel .stockvps-user-content {
      box-sizing: border-box;
      padding: 14px;
    }

    /* 表单组 */
    .stockvps-user-panel .stockvps-form-group {
      box-sizing: border-box;
      margin-bottom: 12px;
    }
    .stockvps-user-panel .stockvps-form-label {
      box-sizing: border-box;
      display: block;
      margin-bottom: 5px;
      font-weight: 500;
      font-size: 12px;
      color: #71717a;
    }
    .stockvps-user-panel select.stockvps-form-select {
      box-sizing: border-box;
      width: 100%;
      height: 34px;
      padding: 7px 10px;
      border: 1px solid #e4e4e7;
      border-radius: 6px;
      font-size: 13px;
      background: #fff;
      color: #18181b;
      outline: none;
      transition: border-color 150ms;
      appearance: none;
      background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e");
      background-position: right 8px center;
      background-repeat: no-repeat;
      background-size: 14px;
      padding-right: 28px;
    }
    .stockvps-user-panel select.stockvps-form-select:focus {
      border-color: #18181b;
      box-shadow: 0 0 0 2px #18181b1a;
    }

    /* 按钮组 */
    .stockvps-user-panel .stockvps-form-actions {
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .stockvps-user-panel button.stockvps-action-btn {
      all: unset;
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      width: 100%;
      padding: 7px 12px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      pointer-events: auto;
      transition: all 150ms;
      border: 1px solid transparent;
    }
    .stockvps-user-panel button.stockvps-action-btn svg {
      width: 13px;
      height: 13px;
      flex-shrink: 0;
    }
    .stockvps-user-panel button.stockvps-action-btn:disabled {
      pointer-events: none;
      opacity: 0.5;
    }

    /* Primary 按钮 */
    .stockvps-user-panel button.stockvps-btn-primary {
      background: #18181b;
      color: #fafafa;
      border-color: #18181b;
    }
    .stockvps-user-panel button.stockvps-btn-primary:hover {
      background: #18181bdd;
    }

    /* Secondary 按钮 */
    .stockvps-user-panel button.stockvps-btn-secondary {
      background: #f4f4f5;
      color: #18181b;
      border-color: #e4e4e7;
    }
    .stockvps-user-panel button.stockvps-btn-secondary:hover {
      background: #f4f4f5cc;
    }

    /* Outline 按钮 */
    .stockvps-user-panel button.stockvps-btn-outline {
      background: transparent;
      color: #18181b;
      border-color: #e4e4e7;
    }
    .stockvps-user-panel button.stockvps-btn-outline:hover {
      background: #f4f4f5;
    }

    /* 加载动画（复用 injectStyles 注入的 @keyframes stockvps-spin） */
    .stockvps-user-panel .stockvps-spinner {
      width: 13px;
      height: 13px;
      border: 2px solid currentColor;
      border-right-color: transparent;
      border-radius: 50%;
      animation: stockvps-spin 0.6s linear infinite;
      opacity: 0.6;
    }

    /* 用户预览 */
    .stockvps-user-panel .stockvps-user-preview {
      box-sizing: border-box;
      display: none;
      background: #f9fafb;
      border: 1px solid #e4e4e7;
      border-radius: 6px;
      padding: 10px;
      margin-top: 10px;
      font-size: 11px;
      max-height: 240px;
      overflow-y: auto;
    }
    .stockvps-user-panel .stockvps-user-preview-item {
      box-sizing: border-box;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding: 2px 0;
    }
    .stockvps-user-panel .stockvps-user-preview-label {
      box-sizing: border-box;
      font-weight: 500;
      color: #71717a;
      white-space: nowrap;
      margin-right: 10px;
    }
    .stockvps-user-panel .stockvps-user-preview-value {
      box-sizing: border-box;
      color: #18181b;
      text-align: right;
      word-break: break-all;
    }

    /* 状态消息 */
    .stockvps-user-panel .stockvps-user-status {
      box-sizing: border-box;
      margin-top: 8px;
    }
    .stockvps-user-panel .stockvps-user-status-inner {
      box-sizing: border-box;
      padding: 6px 10px;
      border-radius: 6px;
      text-align: center;
      font-size: 11px;
      font-weight: 500;
    }
    .stockvps-user-panel .stockvps-user-status-success {
      background: #f0fdf4;
      color: #166534;
      border: 1px solid #bbf7d0;
    }
    .stockvps-user-panel .stockvps-user-status-error {
      background: #fef2f2;
      color: #991b1b;
      border: 1px solid #fecaca;
    }
    .stockvps-user-panel .stockvps-user-status-loading {
      background: #eff6ff;
      color: #1e40af;
      border: 1px solid #bfdbfe;
    }

    /* 分隔线 */
    .stockvps-user-panel .stockvps-user-separator {
      box-sizing: border-box;
      height: 1px;
      background: #e4e4e7;
      margin: 10px 0;
    }
  `;
		shadow.appendChild(style);
	}
	function createRandomUserButton() {
		injectRandomUserStyles();
		const btn = document.createElement("button");
		btn.id = ELEMENT_IDS.RANDOM_USER_BTN;
		btn.className = "stockvps-float-btn";
		btn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <line x1="19" y1="8" x2="19" y2="14"/>
      <line x1="22" y1="11" x2="16" y2="11"/>
    </svg>
    <span>${pageIsChinese() ? "表单填充" : "Form Fill"}</span>
  `;
		btn.addEventListener("click", togglePanel);
		return btn;
	}
	function createRandomUserPanel() {
		injectRandomUserStyles();
		const panel = document.createElement("div");
		panel.id = ELEMENT_IDS.RANDOM_USER_PANEL;
		panel.className = "stockvps-user-panel";
		const hasChinese = pageIsChinese();
		const savedCountry = getSavedCountry();
		const countryOptions = Object.entries(COUNTRY_NAMES).map(([code, name]) => `<option value="${code}" ${code === savedCountry ? "selected" : ""}>${hasChinese ? name : code}</option>`).join("");
		panel.innerHTML = `
    <div class="stockvps-user-content">
      <div class="stockvps-form-group">
        <label class="stockvps-form-label">${hasChinese ? "国家/地区" : "Country/Region"}</label>
        <select id="stockvps-country-select" class="stockvps-form-select">
          ${countryOptions}
        </select>
      </div>
      <div class="stockvps-form-actions">
        <button id="stockvps-generate-btn" class="stockvps-action-btn stockvps-btn-primary">
          ${getGenerateBtnHTML(hasChinese)}
        </button>
        <button id="stockvps-fill-btn" class="stockvps-action-btn stockvps-btn-secondary" disabled>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
          </svg>
          ${hasChinese ? "自动填充表单" : "Auto Fill Form"}
        </button>
        <button id="stockvps-clear-btn" class="stockvps-action-btn stockvps-btn-outline">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
          </svg>
          ${hasChinese ? "清空表单" : "Clear Form"}
        </button>
      </div>
      <div id="stockvps-user-preview" class="stockvps-user-preview"></div>
      <div id="stockvps-status-message" class="stockvps-user-status"></div>
    </div>
  `;
		return panel;
	}
	function togglePanel() {
		const panel = getShadowRoot().querySelector(`#${ELEMENT_IDS.RANDOM_USER_PANEL}`);
		if (!panel) return;
		isPanelVisible = !isPanelVisible;
		panel.style.display = isPanelVisible ? "block" : "none";
	}
	function hidePanel() {
		const panel = getShadowRoot().querySelector(`#${ELEMENT_IDS.RANDOM_USER_PANEL}`);
		isPanelVisible = false;
		if (panel) panel.style.display = "none";
	}
	function showStatus(message, type = "loading") {
		const statusDiv = getShadowRoot().querySelector("#stockvps-status-message");
		if (!statusDiv) return;
		statusDiv.innerHTML = `
    <div class="stockvps-user-status-inner ${{
			success: "stockvps-user-status-success",
			error: "stockvps-user-status-error",
			loading: "stockvps-user-status-loading"
		}[type]}">
      ${message}
    </div>
  `;
		if (type !== "loading") setTimeout(() => {
			statusDiv.innerHTML = "";
		}, 3e3);
	}
	function displayUserPreview(user) {
		const shadow = getShadowRoot();
		const preview = shadow.querySelector("#stockvps-user-preview");
		if (!preview) return;
		const hasChinese = pageIsChinese();
		const countryCode = shadow.querySelector("#stockvps-country-select")?.value || "US";
		preview.innerHTML = [
			{
				label: hasChinese ? "姓名" : "Name",
				value: `${user.name.first} ${user.name.last}`
			},
			{
				label: hasChinese ? "性别" : "Gender",
				value: user.gender
			},
			{
				label: hasChinese ? "电话" : "Phone",
				value: user.formattedPhone
			},
			{
				label: hasChinese ? "地址" : "Address",
				value: `${user.location.street.number} ${user.location.street.name}`
			},
			{
				label: hasChinese ? "城市" : "City",
				value: user.location.city
			},
			{
				label: hasChinese ? "州/省" : "State",
				value: user.location.state
			},
			{
				label: hasChinese ? "邮编" : "Postal",
				value: String(user.location.postcode)
			},
			{
				label: hasChinese ? "国家" : "Country",
				value: `${user.location.country} (${countryCode})`
			}
		].map((item) => `
    <div class="stockvps-user-preview-item">
      <span class="stockvps-user-preview-label">${item.label}</span>
      <span class="stockvps-user-preview-value">${escapeHtml(String(item.value))}</span>
    </div>
  `).join("");
		preview.style.display = "block";
	}
	function bindPanelEvents() {
		const shadow = getShadowRoot();
		document.addEventListener("click", (e) => {
			const path = e.composedPath();
			const panel = shadow.querySelector(`#${ELEMENT_IDS.RANDOM_USER_PANEL}`);
			const btn = shadow.querySelector(`#${ELEMENT_IDS.RANDOM_USER_BTN}`);
			if (isPanelVisible && panel && btn && !path.includes(panel) && !path.includes(btn)) hidePanel();
		});
		shadow.querySelector("#stockvps-country-select")?.addEventListener("change", (e) => {
			saveCountry(e.target.value);
		});
		shadow.querySelector("#stockvps-generate-btn")?.addEventListener("click", async () => {
			const generateBtn = shadow.querySelector("#stockvps-generate-btn");
			const fillBtn = shadow.querySelector("#stockvps-fill-btn");
			const countryCode = shadow.querySelector("#stockvps-country-select").value;
			const hasChinese = pageIsChinese();
			generateBtn.disabled = true;
			generateBtn.innerHTML = `
      <span class="stockvps-spinner"></span>
      ${hasChinese ? "生成中…" : "Generating..."}
    `;
			showStatus(hasChinese ? "正在生成用户信息…" : "Generating user info...", "loading");
			try {
				displayUserPreview(await generateUserData(countryCode));
				fillBtn.disabled = false;
				showStatus(hasChinese ? "用户信息生成成功" : "User info generated", "success");
			} catch (error) {
				showStatus(hasChinese ? "生成失败，请重试" : "Generation failed", "error");
			} finally {
				generateBtn.disabled = false;
				generateBtn.innerHTML = getGenerateBtnHTML(hasChinese);
			}
		});
		shadow.querySelector("#stockvps-fill-btn")?.addEventListener("click", () => {
			const hasChinese = pageIsChinese();
			const filledCount = fillForm();
			if (filledCount > 0) showToast(hasChinese ? `成功填充 ${filledCount} 个字段` : `Filled ${filledCount} fields`, "success");
			else showToast(hasChinese ? "未找到可填充的字段" : "No fillable fields found", "warning");
		});
		shadow.querySelector("#stockvps-clear-btn")?.addEventListener("click", () => {
			const hasChinese = pageIsChinese();
			const clearedCount = clearForm();
			if (clearedCount > 0) showToast(hasChinese ? `已清空 ${clearedCount} 个字段` : `Cleared ${clearedCount} fields`, "success");
			else showToast(hasChinese ? "没有需要清空的字段" : "No fields to clear", "info");
		});
	}
	function updateButtonVisibility() {
		const btn = getShadowRoot().querySelector(`#${ELEMENT_IDS.RANDOM_USER_BTN}`);
		if (btn) btn.style.display = shouldShowButton() ? "flex" : "none";
	}
	function initRandomUser() {
		const shadow = getShadowRoot();
		const btn = createRandomUserButton();
		const panel = createRandomUserPanel();
		shadow.appendChild(btn);
		shadow.appendChild(panel);
		bindPanelEvents();
		window.addEventListener("load", () => {
			updateButtonVisibility();
		});
	}
	function fillFormFields(fields = DEFAULT_FIELDS) {
		let filledCount = 0;
		const filledNames = [];
		for (const field of fields) {
			const input = document.querySelector(`[name="${field.name}"]`);
			if (!input) continue;
			if (field.condition && !field.condition(input)) continue;
			const value = typeof field.defaultValue === "function" ? field.defaultValue() : field.defaultValue;
			if (value) {
				input.value = value;
				`${field.name}`;
				filledCount++;
				filledNames.push(field.name);
			}
		}
		document.querySelectorAll("label[for^=\"customfield\"]").forEach((label) => {
			label.click();
		});
		if (filledCount > 0) showToast(pageIsChinese() ? "已自动填充主机配置" : "Host configuration auto-filled", "success");
	}
	function getFormData() {
		const form = document.querySelector("#frmConfigureProduct");
		if (!form) return "";
		const formData = new FormData(form);
		const params = new URLSearchParams();
		params.set("a", "confproduct");
		for (const [key, value] of formData.entries()) params.set(key, value.toString());
		return params.toString();
	}
	function findPaymentMethod(container) {
		for (const method of PAYMENT_METHODS) {
			const panels = container.querySelectorAll(".panel, label.radio-inline");
			for (const panel of panels) if (panel.textContent?.includes(method.label)) return panel;
		}
		return null;
	}
	function checkRecaptchaOrTurnstile() {
		const recaptcha = document.querySelector(".recaptcha-container");
		const turnstile = document.querySelector(".cf-turnstile");
		if (recaptcha) {
			recaptcha.scrollIntoView();
			return true;
		}
		if (turnstile) {
			turnstile.scrollIntoView();
			return true;
		}
		return false;
	}
	async function submitOrder() {
		const baseUrl = getWhmcsBaseUrl();
		const formData = getFormData();
		if (!formData) {
			sessionStorage.setItem(SESSION_KEYS.QUICK_CHECKOUT, "1");
			window.location.href = `${baseUrl}/cart.php?a=checkout&e=false`;
			return;
		}
		try {
			if (window.WHMCS?.http?.jqClient) await window.WHMCS.http.jqClient.post(`${baseUrl}/cart.php`, `ajax=1&${formData}`);
			else await fetch(`${baseUrl}/cart.php`, {
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				body: `ajax=1&${formData}`
			});
			sessionStorage.setItem(SESSION_KEYS.QUICK_CHECKOUT, "1");
			window.location.href = `${baseUrl}/cart.php?a=checkout&e=false`;
		} catch (err) {}
	}
	function isLoggedIn() {
		if (document.querySelector("a[href*=\"logout.php\"]")) return true;
		if (document.querySelector(".navbar-nav .dropdown-toggle[href*=\"clientarea\"]")) return true;
		if (document.querySelector("#secondary-sidebar, .client-sidebar, .sidebar-client")) return true;
		const allLinks = document.querySelectorAll("a");
		for (const link of allLinks) {
			const text = link.textContent?.toLowerCase() || "";
			if (text.includes("登出") || text.includes("logout") || text.includes("sign out")) return true;
		}
		return false;
	}
	function hasActiveClient() {
		return !!document.querySelector(".btn-active-client");
	}
	function handleCheckoutCommon(checkoutBtn, options = {}) {
		const hasChinese = pageIsChinese();
		const selectedPayment = findPaymentMethod(document.querySelector("#paymentGatewaysContainer") ?? document.body);
		if (!selectedPayment) return;
		selectedPayment.click();
		showToast(hasChinese ? "已选择支付方式" : "Payment method selected", "info");
		if (checkRecaptchaOrTurnstile()) {
			showToast(hasChinese ? "请完成验证码" : "Please complete captcha", "warning");
			return;
		}
		if (sessionStorage.getItem(SESSION_KEYS.QUICK_CHECKOUT) === "1") {
			sessionStorage.removeItem(SESSION_KEYS.QUICK_CHECKOUT);
			if (isLoggedIn() || (options.checkActiveClient ? hasActiveClient() : false)) {
				showOverlay(hasChinese ? "订单提交中" : "Submitting");
				checkoutBtn.click();
			} else showToast(hasChinese ? "请登录或注册您的账号以完成下单" : "Please log in or register to complete your order", "warning");
		}
	}
	var themes = [{
		name: "lagom",
		detect() {
			return document.body.classList.contains("lagom");
		},
		handleCheckout() {
			const checkoutBtn = document.querySelector("#checkout.btn-checkout");
			if (!checkoutBtn) return;
			const termsLabel = pageIsChinese() ? "服務條款" : "Terms of Service";
			const termsEl = [...document.querySelectorAll("label")].find((l) => l.textContent?.includes(termsLabel));
			if (termsEl) {
				termsEl.click();
				showToast(pageIsChinese() ? "已勾选服务条款" : "Terms of Service accepted", "info");
			}
			handleCheckoutCommon(checkoutBtn);
		},
		handleCart() {
			let isSubmitting = false;
			const observerCallback = debounce(async () => {
				if (document.querySelector(`#${ELEMENT_IDS.OCC_BTN}`)) return;
				if (!document.querySelector("#producttotal")?.textContent?.trim()) return;
				const container = createOneClickButton();
				const btn = container.shadowRoot.querySelector("button");
				btn.addEventListener("click", async () => {
					if (isSubmitting) return;
					isSubmitting = true;
					setButtonLoading(btn, true);
					showToast(pageIsChinese() ? "正在提交订单…" : "Submitting order...", "info");
					await submitOrder();
				});
				[...document.querySelectorAll("#tos-checkbox label")].forEach((label) => label.click());
				const targetBtn = document.querySelector("#btnCompleteProductConfig") || document.querySelector(".summary-actions #checkout.btn-checkout");
				if (targetBtn) targetBtn.classList.add("mb-2");
				fillFormFields();
				insertButton(container);
			}, 100);
			new MutationObserver(observerCallback).observe(document.body, {
				childList: true,
				subtree: true
			});
			try {
				window.recalctotals?.();
			} catch {}
		}
	}, {
		name: "default",
		detect() {
			return !document.body.classList.contains("lagom");
		},
		handleCheckout() {
			const completeOrderBtn = document.querySelector("#btnCompleteOrder");
			if (!completeOrderBtn) return;
			const realTos = document.querySelector("#accepttos");
			const hasChinese = pageIsChinese();
			if (realTos) {
				realTos.checked = true;
				realTos.dispatchEvent(new Event("change", { bubbles: true }));
				try {
					const $ = window.$ || window.jQuery;
					if ($ && typeof $.fn.iCheck === "function") $(realTos).iCheck("check");
				} catch {}
				const parent = realTos.parentElement;
				if (parent && (parent.classList.contains("icheckbox") || [...parent.classList].some((c) => c.startsWith("icheckbox")))) {
					parent.classList.add("checked");
					parent.setAttribute("aria-checked", "true");
				}
				showToast(hasChinese ? "已勾选服务条款" : "Terms of Service accepted", "info");
			} else {
				const acceptTos = document.querySelector("#iCheck-accepttos");
				if (acceptTos) {
					acceptTos.click();
					showToast(hasChinese ? "已勾选服务条款" : "Terms of Service accepted", "info");
				}
			}
			handleCheckoutCommon(completeOrderBtn, { checkActiveClient: true });
		},
		handleCart() {
			const container = createOneClickButton();
			const btn = container.shadowRoot.querySelector("button");
			btn.addEventListener("click", async () => {
				setButtonLoading(btn, true);
				showToast(pageIsChinese() ? "正在提交订单…" : "Submitting order...", "info");
				await submitOrder();
			});
			const targetBtn = document.querySelector("#btnCompleteProductConfig") || document.querySelector("#checkout");
			if (targetBtn) targetBtn.classList.add("mb-2");
			fillFormFields();
			insertButton(container);
		}
	}];
	function getActiveTheme() {
		const theme = themes.find((t) => t.detect());
		if (!theme) throw new Error("No matching theme found");
		return theme;
	}
	function isCartPage() {
		const { pathname } = window.location;
		return pathname.includes("/cart.php") || pathname.includes("/order.php");
	}
	async function bootstrap() {
		await waitForReady();
		initRandomUser();
		if (isCartPage()) {
			const theme = getActiveTheme();
			`${theme.name}`;
			if (getParam("a") === "checkout") theme.handleCheckout();
			else theme.handleCart();
		}
	}
	bootstrap();
})();
